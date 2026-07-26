/**
 * Paper Reading Assistant — Background State Store
 *
 * Single responsibility: read, write, and broadcast the persisted
 * PanelState in chrome.storage.local.  No business logic, no API
 * calls — pure state I/O.
 *
 * The background worker delegates all state access through this
 * module so that storage key management and STATE_UPDATED
 * broadcasting live in exactly one place.
 *
 * Loaded via importScripts in background.js (after contracts.js).
 */
(function () {
  'use strict';

  var Shared = globalThis.PaperReadingAssistantShared;
  if (!Shared) {
    throw new Error('state-store.js requires contracts.js to be loaded first');
  }

  var STORAGE_KEY = Shared.STORAGE_KEY;
  var LOADING_STATE_TTL_MS = 2 * 60 * 1000;

  // ─── Persistence Sanitization ────────────────────────────
  //
  // Per side-panel-state-spec §13.1:
  //   Do not persist: Transient loading state, Open menus,
  //                   In-flight requests
  //
  // sanitizeForStorage strips these fields so that a panel reopened
  // after a close-during-loading never shows a stale "loading"
  // state or an orphaned toast.
  //
  // The broadcast in setState() still sends the FULL state so that
  // active listeners (side panel, popup) see loading state and
  // toasts during the session — only the persisted copy is cleaned.

  function sanitizeForStorage(state) {
    if (!state || typeof state !== 'object') {
      return Shared.createEmptyState();
    }

    var copy = JSON.parse(JSON.stringify(state));
    var cw = copy.currentWorkspace;

    if (cw && cw.status !== 'loading') {
      // pendingRequest is always transient — clear it
      cw.pendingRequest = null;
    }

    // UI overlays are ephemeral
    if (copy.ui) {
      copy.ui.toast = null;
      copy.ui.confirmMenu = null;
    }

    return copy;
  }

  /**
   * Validate that a stored state has the minimum required fields.
   * If the shape is malformed (e.g. after a version upgrade or
   * corrupted storage), reset to a clean empty state.
   */
  function isValidState(state) {
    if (!state || typeof state !== 'object') {
      return false;
    }
    if (!state.currentWorkspace || typeof state.currentWorkspace !== 'object') {
      return false;
    }
    if (!state.savedWorkspace || typeof state.savedWorkspace !== 'object') {
      return false;
    }
    if (!state.historyWorkspace || typeof state.historyWorkspace !== 'object') {
      return false;
    }
    if (typeof state.currentWorkspace.status !== 'string') {
      return false;
    }
    return true;
  }

  function parseRequestedAt(value) {
    if (!value) {
      return NaN;
    }

    var timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : NaN;
  }

  function shouldExpireLoadingState(state) {
    if (
      !state ||
      !state.currentWorkspace ||
      state.currentWorkspace.status !== Shared.WorkspaceStatus.LOADING
    ) {
      return false;
    }

    var pendingRequest = state.currentWorkspace.pendingRequest;
    if (!pendingRequest || !pendingRequest.requestedAt) {
      return true;
    }

    var requestedAt = parseRequestedAt(pendingRequest.requestedAt);
    if (!Number.isFinite(requestedAt)) {
      return true;
    }

    return Date.now() - requestedAt > LOADING_STATE_TTL_MS;
  }

  function expireLoadingState(state) {
    var cleaned = sanitizeForStorage(state);
    cleaned.currentWorkspace.status = Shared.WorkspaceStatus.EMPTY;
    cleaned.currentWorkspace.activeThread = null;
    cleaned.currentWorkspace.lastAction = null;
    cleaned.currentWorkspace.pendingRequest = null;
    cleaned.currentWorkspace.error = null;
    return cleaned;
  }

  // ─── State I/O ────────────────────────────────────────────

  /**
   * Ensure chrome.storage.local contains a valid PanelState.
   * Called on install and before every read.  If the stored state
   * is missing or malformed, it is reset to an empty state.
   */
  async function ensureInitialState() {
    var existing = await chrome.storage.local.get(STORAGE_KEY);
    var stored = existing[STORAGE_KEY];

    if (!stored || !isValidState(stored)) {
      var fresh = Shared.createEmptyState();
      await chrome.storage.local.set({ [STORAGE_KEY]: fresh });
      return;
    }

    if (shouldExpireLoadingState(stored)) {
      var cleaned = expireLoadingState(stored);
      await chrome.storage.local.set({ [STORAGE_KEY]: cleaned });
    }
  }

  /**
   * Read the current PanelState from storage.
   * @returns {Promise<PanelState>}
   */
  async function getState() {
    await ensureInitialState();
    var stored = await chrome.storage.local.get(STORAGE_KEY);
    return stored[STORAGE_KEY];
  }

  /**
   * Persist a new PanelState and broadcast STATE_UPDATED to all
   * runtime listeners (side panel, popup).
   *
   * The persisted copy is sanitized (transient fields stripped) but
   * the broadcast sends the full state so active listeners see
   * loading indicators and toasts during the session.
   *
   * @param {PanelState} nextState
   * @returns {Promise<PanelState>}
   */
  async function setState(nextState) {
    var persisted = sanitizeForStorage(nextState);
    await chrome.storage.local.set({
      [STORAGE_KEY]: persisted,
    });
    broadcast(nextState);
    return nextState;
  }

  /**
   * Read-modify-write helper.  The updater receives the current
   * state, mutates it in place (or returns a replacement), and the
   * result is persisted + broadcast in one step.
   *
   * @param {(state: PanelState) => (PanelState | void)} updater
   * @returns {Promise<PanelState>}
   */
  async function updateState(updater) {
    var state = await getState();
    var result = updater(state);
    var nextState = result !== undefined ? result : state;
    return setState(nextState);
  }

  // ─── Broadcast ────────────────────────────────────────────

  function broadcast(state) {
    chrome.runtime
      .sendMessage({
        type: Shared.MessageType.STATE_UPDATED,
        state,
      })
      .catch(() => {
        // No listeners (e.g. side panel closed) — ignore
      });
  }

  // ─── Export ───────────────────────────────────────────────

  globalThis.PaperReadingAssistantStateStore = {
    ensureInitialState,
    getState,
    setState,
    updateState,
    sanitizeForStorage,
    isValidState,
    shouldExpireLoadingState,
  };
})();
