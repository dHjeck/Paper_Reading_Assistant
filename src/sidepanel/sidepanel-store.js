/**
 * Paper Reading Assistant — Side Panel Store
 *
 * Owns panel state, follow-up composer state, and dispatches
 * actions to the background service worker.  Implements the
 * state machines from side-panel-state-spec §7–§11.
 *
 * Spec references:
 *   §7   Current Workspace State Machine
 *   §9   Follow-Up State Machine
 *   §10  Tab State Machine
 *   §11  Saved Workspace State Machine
 */
(function () {
  var Shared = globalThis.PaperReadingAssistantShared;
  var HISTORY_PAPER_MAP_KEY = `${Shared.APP_NAMESPACE}.historyPaperMap`;

  // ─── Internal State ───────────────────────────────────────
  //
  // `state` mirrors PanelState (§6.1) and is kept in sync with
  // the background worker via chrome.runtime messages.
  // `followUpDraft` and `followUpStatus` are UI-local state that
  // the spec says should NOT be persisted (§13.1).

  var state = Shared.createEmptyState();
  var followUpDraft = '';
  var followUpStatus = Shared.FollowUpStatus.IDLE;
  var subscribers = [];
  var toastTimer = null;
  var historyPaperMap = loadHistoryPaperMap();
  var paperToThreads = {}; // reverse index: paperId → [threadId, ...]
  var currentLanguage = 'en'; // updated from config storage

  // ─── Reverse Index Management ───────────────────────────
  //
  // historyPaperMap maps threadId → paperId.
  // paperToThreads is the reverse (paperId → [threadIds]) for
  // O(1) lookup when filtering history items by paper.

  function rebuildPaperToThreadsIndex() {
    paperToThreads = {};
    for (var threadId in historyPaperMap) {
      if (Object.prototype.hasOwnProperty.call(historyPaperMap, threadId)) {
        var paperId = historyPaperMap[threadId];
        if (!paperToThreads[paperId]) {
          paperToThreads[paperId] = [];
        }
        paperToThreads[paperId].push(threadId);
      }
    }
  }

  rebuildPaperToThreadsIndex();

  // ─── Public API ────────────────────────────────────────────

  function init() {
    // Load language from config storage
    chrome.storage.local
      .get(Shared.CONFIG_STORAGE_KEY)
      .then(stored => {
        var cfg = stored[Shared.CONFIG_STORAGE_KEY];
        if (cfg && typeof cfg.language === 'string' && cfg.language !== currentLanguage) {
          currentLanguage = cfg.language;
          notify();
        }
      })
      .catch(() => {
        /* keep default */
      });

    // Fetch initial state from background
    chrome.runtime
      .sendMessage({ type: Shared.MessageType.GET_APP_STATE })
      .then(response => {
        absorbResponseState(response);
        notify();
      })
      .catch(() => {
        notify();
      });

    // Listen for language changes from the options page
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[Shared.CONFIG_STORAGE_KEY]) {
        return;
      }
      var newCfg = changes[Shared.CONFIG_STORAGE_KEY].newValue;
      if (newCfg && typeof newCfg.language === 'string' && newCfg.language !== currentLanguage) {
        currentLanguage = newCfg.language;
        notify(); // trigger re-render with new language
      }
    });

    // Listen for state pushes from background
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === Shared.MessageType.STATE_UPDATED && message.state) {
        absorbIncomingState(message.state);
        notify();
      }
    });
  }

  function getState() {
    return state;
  }

  function getLanguage() {
    return currentLanguage;
  }

  function getFollowUpDraft() {
    return followUpDraft;
  }

  function getFollowUpStatus() {
    return followUpStatus;
  }

  function setFollowUpDraft(value) {
    followUpDraft = value;
  }

  function setFollowUpStatus(status) {
    followUpStatus = status;
    notify();
  }

  function subscribe(callback) {
    subscribers.push(callback);
  }

  function getHistoryPaperId(threadId) {
    return historyPaperMap[threadId] || null;
  }

  /**
   * O(1) reverse lookup: get all thread IDs for a given paper ID.
   * @param {string} paperId
   * @returns {string[]|null}
   */
  function getThreadsForPaper(paperId) {
    return paperToThreads[paperId] || null;
  }

  // ─── Dispatch ──────────────────────────────────────────────
  //
  // Actions map 1:1 to chrome.runtime.sendMessage calls.
  // Each action is fire-and-forget from the UI's perspective —
  // the background worker processes the request and pushes a
  // STATE_UPDATED message, which the onMessage listener catches.

  function dispatch(action) {
    switch (action.type) {
      case 'SWITCH_TAB':
        return send({
          type: Shared.MessageType.SWITCH_PANEL_TAB,
          tab: action.tab,
        });

      case 'REFRESH_ACTIVE_TAB':
        return send({
          type: Shared.MessageType.REFRESH_ACTIVE_TAB,
        });

      case 'START_FIGURE_SELECTION':
        return startFigureSelection(action);

      case 'SAVE_RESULT':
        return send({
          type: Shared.MessageType.SAVE_ITEM_REQUESTED,
          kind: action.kind || 'note',
          front: action.front,
          back: action.back,
          sourceSelectionId: action.sourceSelectionId,
        });

      case 'SUBMIT_FOLLOW_UP':
        return submitFollowUp(action);

      case 'REOPEN_HISTORY':
        return send({
          type: Shared.MessageType.REOPEN_HISTORY,
          threadId: action.threadId,
        });

      case 'RETRY':
        return send({
          type: Shared.MessageType.RETRY_REQUESTED,
        });

      case 'SET_SAVED_FILTER':
        return send({
          type: Shared.MessageType.SET_SAVED_FILTER,
          filter: action.filter,
        });

      case 'SUMMARIZE':
        return send({
          type: Shared.MessageType.SUMMARY_ACTION_REQUESTED,
        });

      case 'SHOW_TOAST':
        showToast(action.message, action.kind || 'info', action.duration || 0);
        return Promise.resolve();

      case 'DISMISS_TOAST':
        dismissToast();
        return Promise.resolve();

      default:
        return Promise.resolve();
    }
  }

  // ─── Action Implementations ────────────────────────────────

  async function send(message) {
    try {
      var response = await chrome.runtime.sendMessage(message);
      absorbResponseState(response);
      notify();
      return response;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function startFigureSelection(_action) {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs.length || !tabs[0].id) {
      return;
    }
    await send({
      type: Shared.MessageType.START_FIGURE_SELECTION,
      tabId: tabs[0].id,
    });
  }

  async function submitFollowUp(action) {
    var question = (followUpDraft || '').trim();
    if (!question) {
      return;
    }

    // §9.3: submitting → success or error
    followUpStatus = Shared.FollowUpStatus.SUBMITTING;
    notify();

    try {
      var response = await chrome.runtime.sendMessage({
        type: Shared.MessageType.FOLLOW_UP_REQUESTED,
        threadId: action.threadId,
        sourceResultId: action.sourceResultId,
        question,
      });

      if (response && response.state) {
        absorbIncomingState(response.state);
      }

      if (response && response.ok) {
        followUpDraft = '';
        followUpStatus = Shared.FollowUpStatus.IDLE;
      } else {
        followUpStatus = Shared.FollowUpStatus.ERROR;
      }
    } catch (e) {
      followUpStatus = Shared.FollowUpStatus.ERROR;
    }

    notify();
  }

  // ─── Toast ─────────────────────────────────────────────────

  function showToast(message, kind, duration) {
    state.ui = state.ui || { toast: null, confirmMenu: null };
    state.ui.toast = { message, kind, duration };

    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    if (duration && duration > 0) {
      toastTimer = setTimeout(() => {
        dismissToast();
      }, duration);
    }

    notify();
  }

  function dismissToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }

    if (state.ui) {
      state.ui.toast = null;
    }
    notify();
  }

  // ─── Internal ───────────────────────────────────────────────

  function notify() {
    subscribers.forEach(cb => {
      try {
        cb();
      } catch (e) {
        // Swallow — one broken subscriber shouldn't block others
      }
    });
  }

  function absorbResponseState(response) {
    if (response && response.state) {
      absorbIncomingState(response.state);
    }
  }

  function absorbIncomingState(nextState) {
    if (!nextState) {
      return;
    }

    var previousThread = state.currentWorkspace && state.currentWorkspace.activeThread;
    state = nextState;
    indexCurrentPaperThread(state);
    reconcileFollowUpUiState(previousThread, state.currentWorkspace.activeThread);
  }

  function reconcileFollowUpUiState(previousThread, nextThread) {
    var previousLatest = getLatestFollowUp(previousThread);
    var nextLatest = getLatestFollowUp(nextThread);

    if (!nextLatest) {
      if (followUpStatus === Shared.FollowUpStatus.SUBMITTING) {
        followUpStatus = Shared.FollowUpStatus.ERROR;
      }
      return;
    }

    if (
      followUpStatus === Shared.FollowUpStatus.SUBMITTING &&
      previousLatest &&
      previousLatest.followUpId === nextLatest.followUpId
    ) {
      return;
    }

    if (nextLatest.answerStatus === 'success') {
      followUpDraft = '';
      followUpStatus = Shared.FollowUpStatus.IDLE;
      return;
    }

    if (nextLatest.answerStatus === 'error') {
      followUpStatus = Shared.FollowUpStatus.ERROR;
    }
  }

  function getLatestFollowUp(thread) {
    if (!thread || !thread.followUps || !thread.followUps.length) {
      return null;
    }
    return thread.followUps[thread.followUps.length - 1];
  }

  function indexCurrentPaperThread(nextState) {
    var paperId = nextState.currentPaper && nextState.currentPaper.paperId;
    var activeThread = nextState.currentWorkspace && nextState.currentWorkspace.activeThread;

    if (!paperId || !activeThread || !activeThread.threadId) {
      return;
    }

    if (historyPaperMap[activeThread.threadId] === paperId) {
      return;
    }

    historyPaperMap[activeThread.threadId] = paperId;

    // Keep reverse index in sync
    if (!paperToThreads[paperId]) {
      paperToThreads[paperId] = [];
    }
    if (paperToThreads[paperId].indexOf(activeThread.threadId) === -1) {
      paperToThreads[paperId].push(activeThread.threadId);
    }

    persistHistoryPaperMap();
  }

  function loadHistoryPaperMap() {
    try {
      var raw = globalThis.localStorage
        ? globalThis.localStorage.getItem(HISTORY_PAPER_MAP_KEY)
        : null;
      if (!raw) {
        return {};
      }

      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function persistHistoryPaperMap() {
    try {
      if (globalThis.localStorage) {
        globalThis.localStorage.setItem(HISTORY_PAPER_MAP_KEY, JSON.stringify(historyPaperMap));
      }
    } catch (error) {
      // Best-effort local cache only.
    }
  }

  // ─── Export ────────────────────────────────────────────────

  globalThis.PaperReadingAssistantStore = {
    init,
    getState,
    getLanguage,
    getFollowUpDraft,
    getFollowUpStatus,
    getHistoryPaperId,
    getThreadsForPaper,
    setFollowUpDraft,
    setFollowUpStatus,
    subscribe,
    dispatch,
  };
})();
