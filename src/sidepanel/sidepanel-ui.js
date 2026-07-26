/**
 * Paper Reading Assistant — Side Panel UI
 *
 * All DOM rendering for the side panel.  Reads state from the
 * Store module and dispatches actions back to it.
 *
 * Spec references:
 *   §4   Component Tree
 *   §5   Component Responsibilities
 *   §7   Current Workspace State Machine
 *   §9   Follow-Up State Machine
 *   §14  Rendering Rules
 */
(function () {
  var Shared = globalThis.PaperReadingAssistantShared;
  var Store = globalThis.PaperReadingAssistantStore;
  var root = document.getElementById('app');
  var I18N = globalThis.I18N;

  /**
   * Translate a key using the current language from the Store.
   * Falls back to English if the key is missing.
   */
  function t(key) {
    var lang = Store.getLanguage ? Store.getLanguage() : 'en';
    var dict = (I18N && I18N[lang]) || (I18N && I18N.en) || {};
    return dict[key] || (I18N && I18N.en && I18N.en[key]) || key;
  }

  function getLanguage() {
    return Store.getLanguage ? Store.getLanguage() : 'en';
  }

  function trInline(map) {
    var lang = getLanguage();
    return map[lang] || map.en;
  }

  // ─── Render Shell Caching (T4) ───────────────────────────
  //
  // The header and tabs only change when the active tab, paper,
  // or backend status changes.  For all other state updates
  // (toast, follow-up status, loading, etc.) we skip rebuilding
  // the shell and only rebuild the content area.

  var prevShellKey = null;
  var shellElement = null;

  function computeShellKey(state) {
    return [
      state.activeTab,
      state.currentPaper ? state.currentPaper.paperId : '',
      state.currentPaper ? state.currentPaper.title : '',
      state.backendStatus,
      state.currentPaper ? state.currentPaper.sourceType : '',
      state.currentPaper ? state.currentPaper.pageNumber : '',
      Store.getLanguage ? Store.getLanguage() : 'en',
    ].join('|');
  }

  // ─── Main Render Entry ──────────────────────────────────────

  function render() {
    var state = Store.getState();
    var shellKey = computeShellKey(state);

    if (shellKey !== prevShellKey || !shellElement) {
      // Full rebuild — shell dependencies changed
      root.innerHTML = '';
      shellElement = el('div', 'panel');
      shellElement.appendChild(renderHeader());
      shellElement.appendChild(renderTabs());

      var content = renderContent();
      content.id = 'panel__content';
      shellElement.appendChild(content);

      root.appendChild(shellElement);
      prevShellKey = shellKey;
    } else {
      // Shell unchanged — only swap the content area
      var oldContent = document.getElementById('panel__content');
      var newContent = renderContent();
      newContent.id = 'panel__content';
      if (oldContent && shellElement) {
        shellElement.replaceChild(newContent, oldContent);
      } else if (shellElement) {
        shellElement.appendChild(newContent);
      }
    }

    // Toast re-renders independently of shell/content
    var existingToast = root.querySelector('.toast-host');
    var toast = renderToast();
    if (toast) {
      if (existingToast) {
        root.replaceChild(toast, existingToast);
      } else {
        root.appendChild(toast);
      }
    } else if (existingToast) {
      root.removeChild(existingToast);
    }
  }

  // ─── PanelHeader (§5.3) ─────────────────────────────────────

  function renderHeader() {
    var state = Store.getState();
    var header = el('section', 'panel__header');

    var eyebrow = el('div', 'panel__eyebrow');
    eyebrow.textContent = t('sp_app_name');

    var title = el('h1', 'panel__title');
    title.textContent = state.currentPaper ? state.currentPaper.title : t('sp_ready');

    var meta = el('div', 'panel__meta');
    meta.textContent = buildHeaderMeta(state);

    var actions = el('div', 'panel__header-actions');

    // Summarize button — visible when a paper is loaded
    if (state.currentPaper) {
      var summarizeBtn = el('button', 'panel__button panel__button--summarize');
      summarizeBtn.textContent = t('sp_summarize');
      summarizeBtn.addEventListener('click', () => {
        Store.dispatch({ type: 'SUMMARIZE' });
      });
      actions.appendChild(summarizeBtn);
    }

    var figureBtn = el('button', 'panel__button panel__button--accent');
    figureBtn.textContent = t('sp_start_figure');
    figureBtn.addEventListener('click', () => {
      Store.dispatch({ type: 'START_FIGURE_SELECTION' });
    });

    var refreshBtn = el('button', 'panel__button');
    refreshBtn.textContent = t('sp_refresh');
    refreshBtn.addEventListener('click', () => {
      Store.dispatch({ type: 'REFRESH_ACTIVE_TAB' }).then(response => {
        if (response && response.ok === false) {
          Store.dispatch({
            type: 'SHOW_TOAST',
            message:
              response.error ||
              trInline({
                en: 'Unable to refresh the current tab',
                zh: '\u65e0\u6cd5\u5237\u65b0\u5f53\u524d\u6807\u7b7e\u9875',
                ja: '\u73fe\u5728\u306e\u30bf\u30d6\u3092\u66f4\u65b0\u3067\u304d\u307e\u305b\u3093',
              }),
            kind: 'error',
            duration: 3000,
          });
          return;
        }

        Store.dispatch({
          type: 'SHOW_TOAST',
          message: trInline({
            en: 'Current tab refreshed',
            zh: '\u5f53\u524d\u6807\u7b7e\u9875\u5df2\u5237\u65b0',
            ja: '\u73fe\u5728\u306e\u30bf\u30d6\u3092\u66f4\u65b0\u3057\u307e\u3057\u305f',
          }),
          kind: 'info',
          duration: 2000,
        });
      });
    });

    var pdfWorkspaceBtn = el('button', 'panel__button');
    pdfWorkspaceBtn.textContent = t('sp_pdf_workspace');
    pdfWorkspaceBtn.addEventListener('click', () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL('src/pdf-viewer/pdf-viewer.html'),
      });
    });

    var settingsBtn = el('button', 'panel__button');
    settingsBtn.textContent = t('sp_settings');
    settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage().catch(() => {
        Store.dispatch({
          type: 'SHOW_TOAST',
          message: trInline({
            en: 'Unable to open settings',
            zh: '\u65e0\u6cd5\u6253\u5f00\u8bbe\u7f6e',
            ja: '\u8a2d\u5b9a\u3092\u958b\u3051\u307e\u305b\u3093',
          }),
          kind: 'error',
          duration: 3000,
        });
      });
    });

    actions.appendChild(figureBtn);
    actions.appendChild(refreshBtn);
    actions.appendChild(pdfWorkspaceBtn);
    actions.appendChild(settingsBtn);

    header.appendChild(eyebrow);
    header.appendChild(title);
    header.appendChild(meta);
    header.appendChild(actions);
    return header;
  }

  // ─── PanelTabs (§5.4, §10) ──────────────────────────────────

  function renderTabs() {
    var state = Store.getState();
    var tabs = el('nav', 'panel__tabs');

    var tabEntries = [
      [Shared.Tabs.CURRENT, t('sp_tab_current')],
      [Shared.Tabs.SAVED, t('sp_tab_saved')],
      [Shared.Tabs.HISTORY, t('sp_tab_history')],
    ];

    tabEntries.forEach(entry => {
      var key = entry[0];
      var label = entry[1];
      var btn = el('button', 'panel__tab');
      btn.dataset.active = String(state.activeTab === key);
      btn.textContent = label;
      btn.addEventListener('click', () => {
        Store.dispatch({ type: 'SWITCH_TAB', tab: key });
      });
      tabs.appendChild(btn);
    });

    return tabs;
  }

  // ─── PanelContentRouter (§5.5) ───────────────────────────────

  function renderContent() {
    var state = Store.getState();
    var content = el('main', 'panel__content');

    // §10.3: Tab switches must not clear in-memory result state.
    // We just route to the correct workspace renderer.
    if (state.activeTab === Shared.Tabs.SAVED) {
      content.appendChild(renderSavedWorkspace());
      return content;
    }

    if (state.activeTab === Shared.Tabs.HISTORY) {
      content.appendChild(renderHistoryWorkspace());
      return content;
    }

    content.appendChild(renderCurrentWorkspace());
    return content;
  }

  // ─── CurrentWorkspace (§5.6, §7, §14.1) ────────────────────
  //
  // Rendering priority per spec §14.1:
  //   1. loading  → LoadingCard
  //   2. error    → ErrorCard
  //   3. thread   → ResultThread
  //   4. else     → EmptyStateCard

  function renderCurrentWorkspace() {
    var state = Store.getState();
    var ws = state.currentWorkspace;
    var card = el('section', 'panel__card');

    // §14.1(1): loading
    if (ws.status === Shared.WorkspaceStatus.LOADING) {
      return renderLoadingCard(ws);
    }

    // §14.1(2): error
    if (ws.status === Shared.WorkspaceStatus.ERROR) {
      return renderErrorCard(ws);
    }

    // §14.1(3): activeThread exists (success or partial_success)
    if (ws.activeThread) {
      return renderResultThread(ws);
    }

    // §14.1(4): empty
    return renderEmptyState();
  }

  // ─── EmptyStateCard (§7.6) ──────────────────────────────────

  function renderEmptyState() {
    var card = el('section', 'panel__card panel__card--empty');
    card.appendChild(createLabel(t('sp_empty_label')));
    card.appendChild(createTitle(t('sp_empty_title')));
    card.appendChild(createParagraph(t('sp_empty_desc')));

    var btn = el('button', 'panel__button panel__button--accent');
    btn.textContent = t('sp_start_figure');
    btn.addEventListener('click', () => {
      Store.dispatch({ type: 'START_FIGURE_SELECTION' });
    });

    var actions = el('div', 'panel__header-actions');
    actions.appendChild(btn);
    card.appendChild(actions);
    return card;
  }

  // ─── LoadingCard (§7.7) ─────────────────────────────────────
  //
  // Spec: "Explaining selection" or "Analyzing figure"

  function renderLoadingCard(ws) {
    var card = el('section', 'panel__card panel__card--loading');
    card.appendChild(createLabel(t('sp_working')));

    var isFigure = ws.pendingRequest && ws.pendingRequest.kind === 'figure';
    var isDocument = ws.pendingRequest && ws.pendingRequest.kind === 'document';
    var titleText = isDocument
      ? t('sp_summarizing')
      : isFigure
        ? t('sp_analyzing')
        : t('sp_explaining');

    card.appendChild(createTitle(titleText));
    card.appendChild(createParagraph(t('sp_loading_desc')));
    return card;
  }

  // ─── ErrorCard (§7.10, §14.2) ───────────────────────────────
  //
  // Spec: short error title + short explanation + primary recovery action.
  // Recovery: Retry (always), Select Again (for figure failures).
  // For UNSUPPORTED_PAGE, Retry is hidden — the user should navigate
  // to a supported page instead (spec §10.1, §7.10 "Open Supported PDF").

  function renderErrorCard(ws) {
    var card = el('section', 'panel__card panel__card--error');
    card.appendChild(createLabel(t('sp_error_label')));

    var isUnsupported = ws.error && ws.error.code === Shared.ErrorCode.UNSUPPORTED_PAGE;

    card.appendChild(createTitle(isUnsupported ? t('sp_error_unsupported') : t('sp_error_failed')));

    card.appendChild(createParagraph(ws.error ? ws.error.message : t('sp_error_try_again')));

    if (isUnsupported) {
      // No retry — guide the user to a supported page
      var hint = el('div', 'card__warning');
      hint.textContent = t('sp_error_unsupported_hint');
      card.appendChild(hint);
      return card;
    }

    var actions = el('div', 'card__actions');

    var retryBtn = el('button', 'card__button card__button--accent');
    retryBtn.textContent = t('sp_retry');
    retryBtn.addEventListener('click', () => {
      Store.dispatch({ type: 'RETRY' });
    });
    actions.appendChild(retryBtn);

    // If the last action was a figure, offer Select Again
    var lastAction = ws.lastAction;
    if (lastAction === Shared.ActionType.EXPLAIN_FIGURE) {
      var selectAgainBtn = el('button', 'card__button');
      selectAgainBtn.textContent = t('sp_select_again');
      selectAgainBtn.addEventListener('click', () => {
        Store.dispatch({ type: 'START_FIGURE_SELECTION' });
      });
      actions.appendChild(selectAgainBtn);
    }

    card.appendChild(actions);
    return card;
  }

  // ─── ResultThread (§5.7, §8) ────────────────────────────────
  //
  // Groups one primary result card + follow-up exchanges.
  // For partial_success, shows caution note per §7.9.

  function renderResultThread(ws) {
    var state = Store.getState();
    var thread = ws.activeThread;
    var card = el('section', 'panel__card');

    // Source summary
    card.appendChild(createLabel(formatSourceSummary(thread.source)));

    // Get the latest result card
    var result = thread.resultCards[thread.resultCards.length - 1];

    card.appendChild(createTitle(formatActionTitle(result.action)));

    // §7.9: Partial Success caution note
    if (
      ws.status === Shared.WorkspaceStatus.PARTIAL_SUCCESS ||
      result.status === Shared.ResultStatus.PARTIAL_SUCCESS
    ) {
      var caution = el('div', 'card__warning');
      caution.textContent = t('sp_partial_warning');
      card.appendChild(caution);
    }

    // Also render any backend warnings
    if (result.warnings && result.warnings.length > 0) {
      result.warnings.forEach(warning => {
        var warnNode = el('div', 'card__warning');
        warnNode.textContent = warning.message;
        card.appendChild(warnNode);
      });
    }

    // Result sections
    result.sections.forEach(section => {
      var sectionEl = el('section', 'card__section');

      var sectionTitle = el('h3', 'card__section-title');
      sectionTitle.textContent = section.title;

      sectionEl.appendChild(sectionTitle);
      sectionEl.appendChild(createParagraph(section.content));
      card.appendChild(sectionEl);
    });

    // Action row (§14.2)
    card.appendChild(renderResultActions(thread, result));

    // Existing follow-up exchanges
    card.appendChild(renderFollowUps(thread));

    // Follow-up composer (§9 state machine)
    card.appendChild(renderFollowUpComposer(thread, result));

    return card;
  }

  // ─── ResultActionRow (§14.2) ────────────────────────────────
  //
  // Text card: Save, Ask Follow-Up, Copy
  // Figure card: Save, Re-crop, Ask Follow-Up

  function renderResultActions(thread, result) {
    var actions = el('div', 'card__actions');
    var isFigure = result.action === Shared.ActionType.EXPLAIN_FIGURE;

    // Save
    var saveBtn = el('button', 'card__button');
    saveBtn.textContent = t('sp_save');
    saveBtn.addEventListener('click', () => {
      var front =
        thread.source.type === 'text'
          ? thread.source.text
          : thread.source.type === 'document'
            ? t('sp_source_document')
            : t('sp_figure_explanation');
      var back = result.sections
        .map(s => {
          return `${s.title}: ${s.content}`;
        })
        .join('\n');

      Store.dispatch({
        type: 'SAVE_RESULT',
        kind: 'note',
        front,
        back,
        sourceSelectionId:
          thread.source.type === 'text' ? thread.source.selectionId : thread.source.figureId,
      }).then(response => {
        Store.dispatch({
          type: 'SHOW_TOAST',
          message: response && response.ok ? t('sp_saved_toast') : t('sp_save_failed'),
          kind: response && response.ok ? 'success' : 'error',
          duration: 3000,
        });
      });
    });
    actions.appendChild(saveBtn);

    // Re-crop (figure only, before Ask Follow-Up per §14.2)
    if (isFigure) {
      var recropBtn = el('button', 'card__button');
      recropBtn.textContent = t('sp_recrop');
      recropBtn.addEventListener('click', () => {
        Store.dispatch({ type: 'START_FIGURE_SELECTION' });
      });
      actions.appendChild(recropBtn);
    }

    // Ask Follow-Up
    var askBtn = el('button', 'card__button');
    askBtn.textContent = t('sp_followup_ask');
    askBtn.addEventListener('click', () => {
      // §9.3: idle → editing
      Store.setFollowUpStatus(Shared.FollowUpStatus.EDITING);
      // Focus the input after render
      setTimeout(() => {
        var input = document.getElementById('followup-input');
        if (input) {
          input.focus();
        }
      }, 50);
    });
    actions.appendChild(askBtn);

    // Copy (text only per §14.2)
    if (!isFigure) {
      var copyBtn = el('button', 'card__button');
      copyBtn.textContent = t('sp_copy');
      copyBtn.addEventListener('click', () => {
        var text = result.sections
          .map(s => {
            return `${s.title}\n${s.content}`;
          })
          .join('\n\n');
        navigator.clipboard
          .writeText(text)
          .then(() => {
            Store.dispatch({
              type: 'SHOW_TOAST',
              message: t('sp_copied'),
              kind: 'info',
              duration: 2000,
            });
          })
          .catch(() => {
            Store.dispatch({
              type: 'SHOW_TOAST',
              message: t('sp_copy_failed'),
              kind: 'error',
              duration: 3000,
            });
          });
      });
      actions.appendChild(copyBtn);
    }

    return actions;
  }

  // ─── FollowUp Responses (existing Q&A) ──────────────────────

  function renderFollowUps(thread) {
    var container = el('div');
    if (!thread.followUps || thread.followUps.length === 0) {
      return container;
    }

    thread.followUps.forEach(entry => {
      var card = el('section', 'card__section followup__response');

      var question = el('h3', 'card__section-title');
      question.textContent = t('sp_followup_prefix') + entry.question;
      card.appendChild(question);

      if (entry.answerStatus === 'loading') {
        var loading = el('div', 'card__label');
        loading.textContent = t('sp_loading_answer');
        card.appendChild(loading);
      } else if (entry.answerStatus === 'error') {
        var errEl = el('div', 'card__warning');
        errEl.textContent = entry.error || t('sp_followup_failed_short');
        card.appendChild(errEl);
      } else if (entry.answerSections) {
        entry.answerSections.forEach(section => {
          var answerTitle = el('div', 'card__label');
          answerTitle.textContent = section.title;
          card.appendChild(answerTitle);
          card.appendChild(createParagraph(section.content));
        });
      }

      container.appendChild(card);
    });

    return container;
  }

  // ─── FollowUpComposer (§9 State Machine) ────────────────────
  //
  // §9.3 State Diagram:
  //   idle → editing → submitting → success/error
  //   error → editing (on FOLLOW_UP_CHANGED)
  //   success → editing (on FOLLOW_UP_OPENED)

  function renderFollowUpComposer(thread, result) {
    var status = Store.getFollowUpStatus();

    // idle: show nothing (the Ask Follow-Up button is in the action row)
    if (status === Shared.FollowUpStatus.IDLE) {
      return el('div');
    }

    var wrap = el('section', 'followup');

    if (status === Shared.FollowUpStatus.EDITING) {
      // §9.3: editing — input + Send
      wrap.appendChild(createLabel(t('sp_followup_label')));

      var input = el('input', 'followup__input');
      input.id = 'followup-input';
      input.type = 'text';
      input.placeholder = t('sp_followup_placeholder');
      input.value = Store.getFollowUpDraft();
      input.addEventListener('input', event => {
        // §9.3: FOLLOW_UP_CHANGED keeps us in editing
        Store.setFollowUpDraft(event.target.value);
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          Store.dispatch({
            type: 'SUBMIT_FOLLOW_UP',
            threadId: thread.threadId,
            sourceResultId: result.resultId,
          });
        }
      });

      var actions = el('div', 'followup__actions');
      var sendBtn = el('button', 'followup__button');
      sendBtn.textContent = t('sp_send');
      sendBtn.addEventListener('click', () => {
        Store.dispatch({
          type: 'SUBMIT_FOLLOW_UP',
          threadId: thread.threadId,
          sourceResultId: result.resultId,
        });
      });

      var cancelBtn = el('button', 'followup__button followup__button--ghost');
      cancelBtn.textContent = t('sp_cancel');
      cancelBtn.addEventListener('click', () => {
        // §9.3: FOLLOW_UP_CLOSED → idle
        Store.setFollowUpDraft('');
        Store.setFollowUpStatus(Shared.FollowUpStatus.IDLE);
      });

      actions.appendChild(sendBtn);
      actions.appendChild(cancelBtn);
      wrap.appendChild(input);
      wrap.appendChild(actions);
      return wrap;
    }

    if (status === Shared.FollowUpStatus.SUBMITTING) {
      // §9.3: submitting — show disabled state
      wrap.appendChild(createLabel(t('sp_followup_label')));

      var input2 = el('input', 'followup__input');
      input2.id = 'followup-input';
      input2.type = 'text';
      input2.disabled = true;
      input2.value = Store.getFollowUpDraft();
      input2.placeholder = t('sp_sending');

      var sending = el('div', 'followup__status');
      sending.textContent = t('sp_sending_followup');

      wrap.appendChild(input2);
      wrap.appendChild(sending);
      return wrap;
    }

    if (status === Shared.FollowUpStatus.ERROR) {
      // §9.3: error — preserve typed content, show Retry
      wrap.appendChild(createLabel(t('sp_followup_label')));

      var errorNote = el('div', 'card__warning');
      errorNote.textContent = t('sp_followup_failed');
      wrap.appendChild(errorNote);

      var input3 = el('input', 'followup__input');
      input3.id = 'followup-input';
      input3.type = 'text';
      input3.value = Store.getFollowUpDraft();
      input3.addEventListener('input', event => {
        // §9.3: FOLLOW_UP_CHANGED transitions error → editing
        Store.setFollowUpDraft(event.target.value);
        Store.setFollowUpStatus(Shared.FollowUpStatus.EDITING);
      });

      var actions3 = el('div', 'followup__actions');
      var retryBtn = el('button', 'followup__button');
      retryBtn.textContent = t('sp_retry');
      retryBtn.addEventListener('click', () => {
        Store.dispatch({
          type: 'SUBMIT_FOLLOW_UP',
          threadId: thread.threadId,
          sourceResultId: result.resultId,
        });
      });

      var cancelBtn3 = el('button', 'followup__button followup__button--ghost');
      cancelBtn3.textContent = t('sp_cancel');
      cancelBtn3.addEventListener('click', () => {
        Store.setFollowUpDraft('');
        Store.setFollowUpStatus(Shared.FollowUpStatus.IDLE);
      });

      actions3.appendChild(retryBtn);
      actions3.appendChild(cancelBtn3);
      wrap.appendChild(input3);
      wrap.appendChild(actions3);
      return wrap;
    }

    // success: brief — the response is now in thread.followUps,
    // so just return to idle
    return el('div');
  }

  // ─── SavedWorkspace (§5.10, §6.9, §11) ──────────────────────

  function renderSavedWorkspace() {
    var state = Store.getState();
    var card = el('section', 'panel__card');
    card.appendChild(createLabel(t('sp_saved_label')));
    card.appendChild(createTitle(t('sp_saved_label')));

    // Filter bar (§6.9: all/note/flashcard/question)
    var filterBar = el('div', 'saved__filter-bar');
    var filters = [
      [Shared.SaveFilter.ALL, t('sp_filter_all')],
      [Shared.SaveFilter.NOTE, t('sp_filter_notes')],
      [Shared.SaveFilter.FLASHCARD, t('sp_filter_flashcards')],
      [Shared.SaveFilter.QUESTION, t('sp_filter_questions')],
    ];

    filters.forEach(entry => {
      var key = entry[0];
      var label = entry[1];
      var btn = el('button', 'saved__filter-btn');
      btn.dataset.active = String(state.savedWorkspace.filter === key);
      btn.textContent = label;
      btn.addEventListener('click', () => {
        Store.dispatch({ type: 'SET_SAVED_FILTER', filter: key });
      });
      filterBar.appendChild(btn);
    });

    card.appendChild(filterBar);

    // Filter items
    var items = getVisibleSavedItems(state);
    var filter = state.savedWorkspace.filter;
    var visibleItems =
      filter === Shared.SaveFilter.ALL
        ? items
        : items.filter(item => {
            return item.kind === filter;
          });

    if (!visibleItems.length) {
      var empty = el('div', 'panel__list-empty');
      empty.textContent = t('sp_saved_empty');
      card.appendChild(empty);
      return card;
    }

    visibleItems.forEach(item => {
      var block = el('section', 'saved__item');
      block.appendChild(createLabel(formatSavedKind(item.kind)));
      block.appendChild(
        createParagraph(
          item.front ||
            trInline({
              en: '(no title)',
              zh: '\uff08\u65e0\u6807\u9898\uff09',
              ja: '\uff08\u7121\u984c\uff09',
            })
        )
      );
      if (item.back) {
        block.appendChild(createParagraph(item.back));
      }
      card.appendChild(block);
    });

    return card;
  }

  // ─── HistoryWorkspace (§5.11) ────────────────────────────────

  function renderHistoryWorkspace() {
    var state = Store.getState();
    var card = el('section', 'panel__card');
    card.appendChild(createLabel(t('sp_history_label')));
    card.appendChild(createTitle(t('sp_history_title')));
    var visibleItems = getVisibleHistoryItems(state);

    if (!visibleItems.length) {
      var empty = el('div', 'panel__list-empty');
      empty.textContent = state.currentPaper ? t('sp_history_empty') : t('sp_history_none');
      card.appendChild(empty);
      return card;
    }

    visibleItems.forEach(item => {
      var block = el('section', 'history__item');

      var reopenBtn = el('button', 'card__button');
      reopenBtn.textContent = t('sp_open');
      reopenBtn.addEventListener('click', () => {
        // §5.11: reopen history item into Current
        Store.dispatch({
          type: 'REOPEN_HISTORY',
          threadId: item.threadId,
        });
      });

      block.appendChild(
        createLabel(
          item.thread && item.thread.source
            ? formatSourceSummary(item.thread.source)
            : item.sourceSummary || formatSourceSummary(null)
        )
      );
      block.appendChild(createParagraph(formatActionTitle(item.action)));
      block.appendChild(reopenBtn);
      card.appendChild(block);
    });

    return card;
  }

  // ─── Toast (§6.1 ui.toast) ──────────────────────────────────

  function renderToast() {
    var state = Store.getState();
    if (!state.ui || !state.ui.toast) {
      return null;
    }

    var toast = state.ui.toast;
    var node = el('div', `toast-host toast-host--${toast.kind || 'info'}`);
    node.textContent = toast.message;
    node.addEventListener('click', () => {
      Store.dispatch({ type: 'DISMISS_TOAST' });
    });
    return node;
  }

  // ─── Helpers ────────────────────────────────────────────────

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    return node;
  }

  function createLabel(text) {
    var label = el('div', 'card__label');
    label.textContent = text;
    return label;
  }

  function createTitle(text) {
    var title = el('h2', 'card__title');
    title.textContent = text;
    return title;
  }

  function createParagraph(text) {
    var p = el('p');
    p.textContent = text;
    return p;
  }

  function buildHeaderMeta(state) {
    var parts = [];
    parts.push(formatBackendStatus(state.backendStatus));
    if (state.currentPaper && state.currentPaper.sourceType) {
      parts.push(formatSourceType(state.currentPaper.sourceType));
    }
    if (state.currentPaper && state.currentPaper.pageNumber) {
      parts.push(formatPageLabel(state.currentPaper.pageNumber));
    }
    return parts.join(' · ');
  }

  function formatActionTitle(action) {
    switch (action) {
      case Shared.ActionType.SIMPLIFY:
        return t('sp_action_simplify');
      case Shared.ActionType.DEFINE:
        return t('sp_action_define');
      case Shared.ActionType.EXPLAIN_FIGURE:
        return t('sp_action_explain_figure');
      case Shared.ActionType.FOLLOW_UP:
        return t('sp_action_follow_up');
      case Shared.ActionType.SUMMARIZE:
        return t('sp_action_summarize');
      default:
        return t('sp_action_explain');
    }
  }

  function formatBackendStatus(status) {
    switch (status) {
      case Shared.BackendStatus.AVAILABLE:
        return trInline({
          en: 'Available',
          zh: '\u53ef\u7528',
          ja: '\u5229\u7528\u53ef\u80fd',
        });
      case Shared.BackendStatus.DEGRADED:
        return trInline({
          en: 'Degraded',
          zh: '\u964d\u7ea7',
          ja: '\u4f4e\u4e0b',
        });
      case Shared.BackendStatus.OFFLINE:
        return trInline({
          en: 'Offline',
          zh: '\u79bb\u7ebf',
          ja: '\u30aa\u30d5\u30e9\u30a4\u30f3',
        });
      default:
        return trInline({
          en: 'Unknown',
          zh: '\u672a\u77e5',
          ja: '\u4e0d\u660e',
        });
    }
  }

  function formatSourceType(sourceType) {
    if (sourceType === Shared.SourceType.PDF) {
      return 'PDF';
    }

    if (sourceType === Shared.SourceType.HTML) {
      return trInline({
        en: 'Web',
        zh: '\u7f51\u9875',
        ja: '\u30a6\u30a7\u30d6',
      });
    }

    return trInline({
      en: 'Unknown source',
      zh: '\u672a\u77e5\u6765\u6e90',
      ja: '\u4e0d\u660e\u306a\u30bd\u30fc\u30b9',
    });
  }

  function formatPageLabel(pageNumber) {
    if (!pageNumber) {
      return '';
    }

    if (getLanguage() === 'zh') {
      return `\u7b2c ${pageNumber} \u9875`;
    }

    if (getLanguage() === 'ja') {
      return `${pageNumber}\u30da\u30fc\u30b8`;
    }

    return `Page ${pageNumber}`;
  }

  function formatSourceSummary(source) {
    if (!source) {
      return trInline({
        en: 'Unknown source',
        zh: '\u672a\u77e5\u6765\u6e90',
        ja: '\u4e0d\u660e\u306a\u30bd\u30fc\u30b9',
      });
    }

    var base =
      source.type === Shared.ResultSourceType.FIGURE
        ? trInline({
            en: 'Figure selection',
            zh: '\u56fe\u7247\u9009\u533a',
            ja: '\u56f3\u306e\u9078\u629e',
          })
        : source.type === Shared.ResultSourceType.DOCUMENT
          ? t('sp_source_document')
          : trInline({
              en: 'Text selection',
              zh: '\u6587\u672c\u9009\u533a',
              ja: '\u30c6\u30ad\u30b9\u30c8\u9078\u629e',
            });

    return source.pageNumber ? `${base} · ${formatPageLabel(source.pageNumber)}` : base;
  }

  function formatSavedKind(kind) {
    switch (kind) {
      case Shared.SaveFilter.FLASHCARD:
        return t('sp_filter_flashcards');
      case Shared.SaveFilter.QUESTION:
        return t('sp_filter_questions');
      case Shared.SaveFilter.NOTE:
      default:
        return t('sp_filter_notes');
    }
  }

  function getVisibleSavedItems(state) {
    var items =
      state.savedWorkspace && state.savedWorkspace.items ? state.savedWorkspace.items : [];
    var currentPaperId = state.currentPaper && state.currentPaper.paperId;

    if (!currentPaperId) {
      return [];
    }

    return items.filter(item => {
      return item.paperId === currentPaperId;
    });
  }

  function getVisibleHistoryItems(state) {
    var items =
      state.historyWorkspace && state.historyWorkspace.items ? state.historyWorkspace.items : [];
    var currentPaperId = state.currentPaper && state.currentPaper.paperId;
    var activeThreadId =
      state.currentWorkspace &&
      state.currentWorkspace.activeThread &&
      state.currentWorkspace.activeThread.threadId;

    if (!currentPaperId) {
      return activeThreadId
        ? items.filter(item => {
            return item.threadId === activeThreadId;
          })
        : [];
    }

    // M13: Use the pre-computed reverse index for O(1) lookup
    var threadIds = Store.getThreadsForPaper(currentPaperId);
    if (threadIds && threadIds.length) {
      var threadIdSet = {};
      for (var i = 0; i < threadIds.length; i++) {
        threadIdSet[threadIds[i]] = true;
      }
      return items.filter(item => {
        return threadIdSet[item.threadId];
      });
    }

    // Fallback: include the active thread even if not yet indexed
    return items.filter(item => {
      return !!activeThreadId && item.threadId === activeThreadId;
    });
  }

  // ─── Export ──────────────────────────────────────────────────

  globalThis.PaperReadingAssistantUI = {
    render,
  };
})();
