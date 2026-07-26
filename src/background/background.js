/**
 * Paper Reading Assistant — Background Service Worker (Orchestration Layer)
 *
 * This file is intentionally thin: it routes runtime messages to
 * the appropriate handler, and each handler coordinates between
 * the State Store (persistence) and the API Client (network/mock).
 *
 * Architecture:
 *   background.js    → message routing + orchestration (this file)
 *   state-store.js   → PanelState read / write / broadcast
 *   api-client.js    → backend API calls with mock/real switching
 *   contracts.js     → shared constants, factories, mock generators
 *
 * Message flow (side-panel-state-spec §12):
 *   content script → sendMessage → background handler
 *     → StateStore.updateState(loading)
 *     → ApiClient.explainText / explainFigure / followUp
 *     → StateStore.updateState(result or error)
 *     → STATE_UPDATED broadcast → side panel re-renders
 *
 * Error flow:
 *   ApiClient returns { status: "error", error: { code, message, retryable } }
 *     → handler maps to currentWorkspace.error = { code, message }
 *     → currentWorkspace.status = "error"
 *     → STATE_UPDATED broadcast → side panel renders ErrorCard with Retry
 *
 * Spec references:
 *   - side-panel-state-spec §12 (message flow)
 *   - backend-api-spec §3 (endpoint scope), §6–§9 (endpoints), §10 (errors)
 */
importScripts('../shared/contracts.js');
importScripts('./state-store.js');
importScripts('./api-client.js');

var Shared = globalThis.PaperReadingAssistantShared;
var StateStore = globalThis.PaperReadingAssistantStateStore;
var ApiClient = globalThis.PaperReadingAssistantApiClient;
var runtimeReadyPromise = null;
var contextMenuReadyPromise = null;
var DEBUG_PREFIX = '[PRA background]';

// ─── Storage Limits ──────────────────────────────────────────
//
// chrome.storage.local has a 10MB default quota.  History items
// contain full threads (with result sections text), so we cap the
// list to prevent storage overflow.  Saved items are smaller but
// still bounded for the same reason.

var MAX_HISTORY_ITEMS = 200;
var MAX_SAVED_ITEMS = 500;

// In-memory cache for document payloads (PDF base64 data).
// Never persisted to chrome.storage — only lives for the service
// worker lifetime so retry can reuse the extracted content.
var pendingDocumentCache = {};

function debugLog(level, message, details) {
  var logger = console[level] || console.log;
  if (details === undefined) {
    logger.call(console, `${DEBUG_PREFIX} ${message}`);
    return;
  }

  logger.call(console, `${DEBUG_PREFIX} ${message}`, details);
}

function previewText(text, maxLength) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }

  var normalized = text.replace(/\s+/g, ' ').trim();
  var limit = Number(maxLength) > 0 ? Math.round(maxLength) : 80;
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}...`;
}

function summarizeApiClientConfig() {
  if (!ApiClient || typeof ApiClient.getConfig !== 'function') {
    return null;
  }

  var cfg = ApiClient.getConfig() || {};
  return {
    mode: cfg.mode || 'mock',
    baseUrl: cfg.baseUrl || null,
    timeoutMs: cfg.timeoutMs || null,
    hasAuthToken: !!cfg.authToken,
    llmBaseUrl: cfg.llmBaseUrl || null,
    hasLlmApiKey: !!cfg.llmApiKey,
    llmModel: cfg.llmModel || null,
    language: cfg.language || 'en',
  };
}

function summarizePaper(paper) {
  if (!paper) {
    return null;
  }

  return {
    paperId: paper.paperId || null,
    title: paper.title || null,
    sourceType: paper.sourceType || null,
    pageNumber: paper.pageNumber || null,
    url: paper.url || null,
  };
}

function summarizeSelection(selection) {
  if (!selection) {
    return null;
  }

  return {
    selectionId: selection.selectionId || null,
    pageNumber: selection.pageNumber || null,
    textLength: selection.text ? selection.text.length : 0,
    contextLength: selection.context ? selection.context.length : 0,
    textPreview: previewText(selection.text, 80),
  };
}

function summarizeFigure(figure) {
  if (!figure) {
    return null;
  }

  return {
    figureId: figure.figureId || null,
    pageNumber: figure.pageNumber || null,
    hasImageRef: !!figure.imageRef,
    hasImageData: !!(figure.imageData && figure.imageData.dataUrl),
    imageDataBytes:
      figure.imageData && figure.imageData.dataUrl ? figure.imageData.dataUrl.length : 0,
    hasThumbnailRef: !!figure.thumbnailRef,
    hasBoundingBox: !!figure.boundingBox,
    captionPreview: previewText(figure.caption, 60),
  };
}

function summarizeResponse(response) {
  if (!response || typeof response !== 'object') {
    return {
      status: null,
    };
  }

  return {
    requestId: response.requestId || null,
    status: response.status || null,
    errorCode: response.error && response.error.code ? response.error.code : null,
    retryable: !!(response.error && response.error.retryable),
    resultId: response.result && response.result.resultId ? response.result.resultId : null,
    threadId:
      (response.result && response.result.threadId) ||
      (response.followUp && response.followUp.threadId) ||
      null,
    sectionTitles:
      response.result && Array.isArray(response.result.sections)
        ? response.result.sections.slice(0, 3).map(section => {
            return section && (section.title || section.heading)
              ? section.title || section.heading
              : null;
          })
        : response.followUp && Array.isArray(response.followUp.sections)
          ? response.followUp.sections.slice(0, 3).map(section => {
              return section && (section.title || section.heading)
                ? section.title || section.heading
                : null;
            })
          : [],
  };
}

// ─── Lifecycle ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await initializeRuntime();
  await refreshBackendStatus();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeRuntime();
});

chrome.tabs.onActivated.addListener(() => {
  void syncCurrentTabContext();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab || !tab.active) {
    return;
  }

  if (!changeInfo.url && !changeInfo.title && changeInfo.status !== 'complete') {
    return;
  }

  void syncCurrentTabContext(tab);
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  void syncCurrentTabContext();
});

void initializeRuntime();

// ─── Context Menu ───────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'pra-explain-figure' || !tab || !tab.id) {
    return;
  }

  await openSidePanel(tab.id);
  await handleFigureAction({
    tabId: tab.id,
    figure: {
      figureId: Shared.createId('figure'),
      imageRef: info.srcUrl || '',
      thumbnailRef: info.srcUrl || '',
      caption: '',
      pageNumber: undefined,
    },
    paper: {
      title: tab.title || 'Untitled Paper',
      url: tab.url || '',
      sourceType: Shared.inferSourceType(tab.url || ''),
    },
  });
});

// ─── Message Router ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Defense in depth: only accept messages from this extension.
  // Content scripts and extension pages have sender.id === chrome.runtime.id.
  if (sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }

  void handleMessage(message, sender)
    .then(response => {
      sendResponse(response);
    })
    .catch(error => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

  return true; // keep message channel open for async response
});

async function handleMessage(message, sender) {
  var tabId = message.tabId || (sender.tab && sender.tab.id);

  switch (message.type) {
    case Shared.MessageType.PING:
      await initializeRuntime();
      return { ok: true, pong: true };

    case Shared.MessageType.GET_APP_STATE:
      await initializeRuntime();
      return { ok: true, state: await getAppStateForPanel() };

    case Shared.MessageType.REFRESH_ACTIVE_TAB:
      await initializeRuntime();
      return { ok: true, state: await syncCurrentTabContext() };

    case Shared.MessageType.OPEN_SIDE_PANEL: {
      if (tabId) {
        await openSidePanel(tabId);
      }
      return { ok: true };
    }

    case Shared.MessageType.SWITCH_PANEL_TAB: {
      await initializeRuntime();
      var tabState = await StateStore.updateState(s => {
        s.activeTab = message.tab;
      });
      return { ok: true, state: tabState };
    }

    case Shared.MessageType.START_FIGURE_SELECTION:
      if (tabId) {
        await openSidePanel(tabId);
      }
      await initializeRuntime();
      return handleStartFigureSelection(message, sender, true);

    case Shared.MessageType.TEXT_ACTION_REQUESTED:
      if (tabId) {
        await openSidePanel(tabId);
      }
      await initializeRuntime();
      return handleTextAction({
        tabId,
        action: message.action,
        selection: message.selection,
        paper: message.paper,
        unsupported: message.unsupported,
        panelOpened: !!tabId,
      });

    case Shared.MessageType.FIGURE_ACTION_REQUESTED:
      if (tabId) {
        await openSidePanel(tabId);
      }
      await initializeRuntime();
      return handleFigureAction({
        tabId,
        figure: message.figure,
        paper: message.paper,
        panelOpened: !!tabId,
      });

    case Shared.MessageType.FOLLOW_UP_REQUESTED:
      await initializeRuntime();
      return handleFollowUp(message);

    case Shared.MessageType.SAVE_ITEM_REQUESTED:
      await initializeRuntime();
      return handleSaveItem(message);

    case Shared.MessageType.REOPEN_HISTORY:
      await initializeRuntime();
      return handleReopenHistory(message);

    case Shared.MessageType.RETRY_REQUESTED:
      await initializeRuntime();
      return handleRetry(message);

    case Shared.MessageType.SET_SAVED_FILTER: {
      await initializeRuntime();
      var filterState = await StateStore.updateState(s => {
        s.savedWorkspace.filter = message.filter || Shared.SaveFilter.ALL;
      });
      return { ok: true, state: filterState };
    }

    case Shared.MessageType.SUMMARY_ACTION_REQUESTED:
      if (tabId) {
        await openSidePanel(tabId);
      }
      await initializeRuntime();
      return handleSummarize(message, sender);

    case Shared.MessageType.CHECK_HEALTH:
      await initializeRuntime();
      return handleCheckHealth();

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

// ─── Utilities ──────────────────────────────────────────────

async function openSidePanel(tabId) {
  if (!tabId) {
    return;
  }
  void chrome.sidePanel
    .setOptions({
      tabId,
      path: 'src/sidepanel/sidepanel.html',
      enabled: true,
    })
    .catch(() => {
      // Best-effort enablement; side_panel.default_path already exists in manifest.
    });
  await chrome.sidePanel.open({ tabId });
}

function createWorkerErrorResponse(code, message, retryable) {
  return {
    requestId: Shared.createId('req'),
    status: Shared.ResultStatus.ERROR,
    error: {
      code,
      message,
      retryable: !!retryable,
    },
  };
}

function normalizeErrorEnvelope(error, fallbackMessage) {
  return {
    code: error && error.code ? error.code : Shared.ErrorCode.INTERNAL_ERROR,
    message: error && error.message ? error.message : fallbackMessage,
    retryable: !!(error && error.retryable),
  };
}

function normalizeResultResponse(response, fallbackMessage) {
  if (!response || typeof response !== 'object') {
    return createWorkerErrorResponse(Shared.ErrorCode.INTERNAL_ERROR, fallbackMessage, true);
  }

  if (response.status === Shared.ResultStatus.ERROR) {
    var normalizedError = normalizeErrorEnvelope(response.error, fallbackMessage);
    return createWorkerErrorResponse(
      normalizedError.code,
      normalizedError.message,
      normalizedError.retryable
    );
  }

  if (
    (response.status === Shared.ResultStatus.SUCCESS ||
      response.status === Shared.ResultStatus.PARTIAL_SUCCESS) &&
    response.result &&
    Array.isArray(response.result.sections)
  ) {
    if (!Array.isArray(response.result.warnings)) {
      response.result.warnings = [];
    }
    return response;
  }

  return createWorkerErrorResponse(Shared.ErrorCode.INTERNAL_ERROR, fallbackMessage, true);
}

function normalizeFollowUpResponse(response, fallbackMessage) {
  if (!response || typeof response !== 'object') {
    return createWorkerErrorResponse(Shared.ErrorCode.INTERNAL_ERROR, fallbackMessage, true);
  }

  if (response.status === Shared.ResultStatus.ERROR) {
    var normalizedError = normalizeErrorEnvelope(response.error, fallbackMessage);
    return createWorkerErrorResponse(
      normalizedError.code,
      normalizedError.message,
      normalizedError.retryable
    );
  }

  if (
    (response.status === Shared.ResultStatus.SUCCESS ||
      response.status === Shared.ResultStatus.PARTIAL_SUCCESS) &&
    response.followUp &&
    Array.isArray(response.followUp.sections)
  ) {
    if (!Array.isArray(response.followUp.warnings)) {
      response.followUp.warnings = [];
    }
    return response;
  }

  return createWorkerErrorResponse(Shared.ErrorCode.INTERNAL_ERROR, fallbackMessage, true);
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }
  // structuredClone preserves undefined properties that
  // JSON.parse(JSON.stringify()) would drop, and handles Date,
  // Map, Set, ArrayBuffer, etc. natively.
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (e) {
      // structuredClone throws for non-cloneable objects (e.g. functions);
      // fall back to JSON round-trip.
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeOptionalPageNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stripUrlHash(url) {
  return typeof url === 'string' ? url.split('#')[0] : '';
}

function createEmptyWorkspaceState() {
  return {
    status: Shared.WorkspaceStatus.EMPTY,
    activeThread: null,
    lastAction: null,
    pendingRequest: null,
    error: null,
  };
}

function buildTextSource(selection) {
  return {
    type: Shared.ResultSourceType.TEXT,
    selectionId: selection.selectionId,
    text: selection.text,
    context: normalizeOptionalString(selection.context),
    pageNumber: normalizeOptionalPageNumber(selection.pageNumber),
  };
}

function buildFigureSource(figure) {
  return {
    type: Shared.ResultSourceType.FIGURE,
    figureId: figure.figureId,
    imageRef: normalizeOptionalString(figure.imageRef),
    imageData: figure.imageData || undefined,
    captureViewport: figure.captureViewport || undefined,
    thumbnailRef: normalizeOptionalString(figure.thumbnailRef),
    caption: normalizeOptionalString(figure.caption),
    pageNumber: normalizeOptionalPageNumber(figure.pageNumber),
    boundingBox: figure.boundingBox || undefined,
  };
}

function buildHistoryItem(thread, action, createdAt) {
  return {
    threadId: thread.threadId,
    sourceSummary: Shared.createSourceSummary(thread.source),
    action,
    createdAt,
    thread: cloneValue(thread),
  };
}

function getLatestResultCardStatus(thread) {
  if (!thread || !thread.resultCards || !thread.resultCards.length) {
    return Shared.WorkspaceStatus.SUCCESS;
  }

  return thread.resultCards[thread.resultCards.length - 1].status ===
    Shared.ResultStatus.PARTIAL_SUCCESS
    ? Shared.WorkspaceStatus.PARTIAL_SUCCESS
    : Shared.WorkspaceStatus.SUCCESS;
}

async function resolveRetryCaptureTabId(currentPaper) {
  var preferredUrl = stripUrlHash(currentPaper && currentPaper.url);
  var tabs = await chrome.tabs.query({});
  var activeFallback = null;

  for (var i = 0; i < tabs.length; i += 1) {
    var tab = tabs[i];
    if (!tab || !tab.id) {
      continue;
    }

    if (!activeFallback && tab.active) {
      activeFallback = tab.id;
    }

    if (preferredUrl && stripUrlHash(tab.url) === preferredUrl) {
      return tab.id;
    }
  }

  return activeFallback || null;
}

function normalizeSaveKind(kind) {
  if (kind === Shared.SaveFilter.FLASHCARD || kind === Shared.SaveFilter.QUESTION) {
    return kind;
  }

  return Shared.SaveFilter.NOTE;
}

function sanitizeCaptureViewport(captureViewport) {
  if (!captureViewport) {
    return undefined;
  }

  var width = Number(captureViewport.width);
  var height = Number(captureViewport.height);
  var devicePixelRatio = Number(captureViewport.devicePixelRatio);

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return undefined;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
    devicePixelRatio:
      Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
  };
}

function sanitizeBoundingBox(box) {
  if (!box) {
    return undefined;
  }

  var x = Number(box.x);
  var y = Number(box.y);
  var width = Number(box.width);
  var height = Number(box.height);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  return {
    x: Math.round(Math.max(0, x)),
    y: Math.round(Math.max(0, y)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

async function dataUrlToImageBitmap(dataUrl) {
  var response = await fetch(dataUrl);
  var blob = await response.blob();
  return createImageBitmap(blob);
}

async function blobToDataUrl(blob) {
  var arrayBuffer = await blob.arrayBuffer();
  var bytes = new Uint8Array(arrayBuffer);
  var chunkSize = 32768;
  var binary = '';

  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function cropFigureCapture(captureDataUrl, boundingBox, captureViewport) {
  var normalizedBox = sanitizeBoundingBox(boundingBox);
  var viewport = sanitizeCaptureViewport(captureViewport);

  if (!normalizedBox) {
    throw new Error('Missing or invalid figure bounding box');
  }

  var bitmap = await dataUrlToImageBitmap(captureDataUrl);

  try {
    var scaleX =
      viewport && viewport.width > 0
        ? bitmap.width / viewport.width
        : viewport && viewport.devicePixelRatio
          ? viewport.devicePixelRatio
          : 1;
    var scaleY =
      viewport && viewport.height > 0
        ? bitmap.height / viewport.height
        : viewport && viewport.devicePixelRatio
          ? viewport.devicePixelRatio
          : 1;

    if (!Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) {
      throw new Error('Unable to determine capture scale');
    }

    var sourceX = Math.max(0, Math.min(bitmap.width, Math.round(normalizedBox.x * scaleX)));
    var sourceY = Math.max(0, Math.min(bitmap.height, Math.round(normalizedBox.y * scaleY)));
    var sourceWidth = Math.max(1, Math.round(normalizedBox.width * scaleX));
    var sourceHeight = Math.max(1, Math.round(normalizedBox.height * scaleY));

    if (sourceX + sourceWidth > bitmap.width) {
      sourceWidth = bitmap.width - sourceX;
    }
    if (sourceY + sourceHeight > bitmap.height) {
      sourceHeight = bitmap.height - sourceY;
    }

    if (sourceWidth < 1 || sourceHeight < 1) {
      throw new Error('The selected figure region is too small to crop');
    }

    var canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
    var context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Unable to create a canvas context for figure capture');
    }

    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight
    );

    var croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
    var croppedDataUrl = await blobToDataUrl(croppedBlob);

    return {
      mimeType: 'image/png',
      dataUrl: croppedDataUrl,
    };
  } finally {
    if (bitmap && typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}

async function hydrateFigurePayload(tabId, figure) {
  var nextFigure = Object.assign({}, figure || {});
  nextFigure.boundingBox = sanitizeBoundingBox(nextFigure.boundingBox);
  nextFigure.captureViewport = sanitizeCaptureViewport(nextFigure.captureViewport);

  // If imageData is already provided (e.g. from PDF viewer canvas crop),
  // skip the captureVisibleTab + crop path entirely.
  if (nextFigure.imageData) {
    // Ensure thumbnailRef is set if not already
    if (!nextFigure.thumbnailRef && nextFigure.imageData.dataUrl) {
      nextFigure.thumbnailRef = nextFigure.imageData.dataUrl;
    }
    return nextFigure;
  }

  // If no bounding box either, nothing we can do
  if (!nextFigure.boundingBox) {
    return nextFigure;
  }

  if (!tabId) {
    throw new Error('Missing tab id for figure capture');
  }

  var tab = await chrome.tabs.get(tabId);
  var captureDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'png',
  });
  var imageData = await cropFigureCapture(
    captureDataUrl,
    nextFigure.boundingBox,
    nextFigure.captureViewport
  );

  nextFigure.imageData = imageData;
  if (!nextFigure.thumbnailRef) {
    nextFigure.thumbnailRef = imageData.dataUrl;
  }

  return nextFigure;
}

async function initializeRuntime() {
  if (runtimeReadyPromise) {
    return runtimeReadyPromise;
  }

  runtimeReadyPromise = (async function () {
    await StateStore.ensureInitialState();
    await ApiClient.loadConfig();
    await ensureContextMenu();
    debugLog('info', 'runtime initialized', {
      apiClientConfig: summarizeApiClientConfig(),
    });
  })().catch(error => {
    runtimeReadyPromise = null;
    throw error;
  });

  return runtimeReadyPromise;
}

async function ensureContextMenu() {
  if (contextMenuReadyPromise) {
    return contextMenuReadyPromise;
  }

  contextMenuReadyPromise = (async function () {
    await chrome.contextMenus.removeAll();
    await chrome.contextMenus.create({
      id: 'pra-explain-figure',
      title: 'Explain this figure',
      contexts: ['image'],
    });
  })().catch(error => {
    contextMenuReadyPromise = null;
    throw error;
  });

  return contextMenuReadyPromise;
}

async function getAppStateForPanel() {
  var state = await StateStore.getState();
  return refreshBackendStatusIfNeeded(state);
}

async function refreshBackendStatusIfNeeded(state) {
  var nextState = state || (await StateStore.getState());

  if (nextState.backendStatus === Shared.BackendStatus.UNKNOWN) {
    return refreshBackendStatus();
  }

  return nextState;
}

async function refreshBackendStatus() {
  var health = await ApiClient.health();
  var status = mapHealthToBackendStatus(health);

  debugLog('info', 'backend status refreshed', {
    backendStatus: status,
    health,
  });

  return StateStore.updateState(s => {
    s.backendStatus = status;
  });
}

function mapHealthToBackendStatus(health) {
  if (!health) {
    return Shared.BackendStatus.OFFLINE;
  }
  if (health.status === 'ok') {
    return Shared.BackendStatus.AVAILABLE;
  }
  if (health.status === 'degraded') {
    return Shared.BackendStatus.DEGRADED;
  }
  return Shared.BackendStatus.OFFLINE;
}

async function getActiveTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs.length ? tabs[0] : null;
}

async function syncCurrentTabContext(tabOverride) {
  var tab = tabOverride || (await getActiveTab());
  if (!tab || !tab.id) {
    return StateStore.getState();
  }

  // Skip extension pages (PDF viewer, side panel, etc.) and chrome:// internals.
  // These contexts manage their own paper identity via explicit action messages —
  // syncing from the tab URL would overwrite correct PDF paper data.
  if (
    tab.url &&
    (tab.url.indexOf('chrome-extension://') === 0 || tab.url.indexOf('chrome://') === 0)
  ) {
    return StateStore.getState();
  }

  var nextPaper = Shared.createPaperContext({
    title: tab.title || 'Untitled Paper',
    url: tab.url || '',
    sourceType: Shared.inferSourceType(tab.url || ''),
  });

  return StateStore.updateState(s => {
    var previousPaperId = s.currentPaper && s.currentPaper.paperId;
    s.currentPaper = nextPaper;

    if (previousPaperId && previousPaperId !== nextPaper.paperId) {
      s.currentWorkspace = createEmptyWorkspaceState();
      s.activeTab = Shared.Tabs.CURRENT;
    }
  });
}

// ─── Handlers: Figure Selection ─────────────────────────────

async function handleStartFigureSelection(message, sender, panelOpened) {
  var tabId = message.tabId || (sender.tab && sender.tab.id);
  if (!tabId) {
    return { ok: false, error: 'Missing tab id for figure selection' };
  }

  if (!panelOpened) {
    await openSidePanel(tabId);
  }
  try {
    var tab = await chrome.tabs.get(tabId);
    var pdfWorkspaceUrl = chrome.runtime.getURL('src/pdf-viewer/pdf-viewer.html');

    if (tab && tab.url && tab.url.indexOf(pdfWorkspaceUrl) === 0) {
      await chrome.runtime.sendMessage({
        type: Shared.MessageType.FIGURE_SELECTION_MODE_REQUESTED,
        target: 'pdf-workspace',
      });
      return { ok: true };
    }

    await chrome.tabs.sendMessage(tabId, {
      type: Shared.MessageType.FIGURE_SELECTION_MODE_REQUESTED,
    });
    return { ok: true };
  } catch (error) {
    var tab = await chrome.tabs.get(tabId);
    var paper = Shared.createPaperContext({
      title: tab && tab.title ? tab.title : 'Untitled Paper',
      url: tab && tab.url ? tab.url : '',
      sourceType: Shared.inferSourceType(tab && tab.url ? tab.url : ''),
    });
    var unsupportedState = await StateStore.updateState(s => {
      s.currentPaper = paper;
      s.currentWorkspace = {
        status: Shared.WorkspaceStatus.ERROR,
        activeThread: null,
        lastAction: Shared.ActionType.EXPLAIN_FIGURE,
        pendingRequest: null,
        error: {
          code: Shared.ErrorCode.UNSUPPORTED_PAGE,
          message:
            "Figure selection is not available in Chrome's built-in PDF viewer or other protected pages. Try a regular webpage, or load the PDF in a viewer the extension can inject into.",
        },
      };
    });

    return {
      ok: false,
      error: 'Figure selection is not available on this page.',
      state: unsupportedState,
    };
  }
}

// ─── Handlers: Text Action ──────────────────────────────────
//
// Flow (side-panel-state-spec §12.1):
//   1. Set loading state + open side panel
//   2. Build API request per backend-api-spec §6.2
//   3. Call ApiClient.explainText
//   4. On success → build thread, set success/partial_success
//      On error  → set error state with code + message

async function handleTextAction(payload) {
  var paper = Shared.createPaperContext(payload.paper || {});
  var action = payload.action;

  debugLog('info', 'handleTextAction received', {
    action,
    tabId: payload.tabId || null,
    panelOpened: !!payload.panelOpened,
    unsupported: !!payload.unsupported,
    apiClientConfig: summarizeApiClientConfig(),
    paper: summarizePaper(paper),
    selection: summarizeSelection(payload.selection),
  });

  // Unsupported page guard (content-script sends unsupported: true)
  if (payload.unsupported) {
    debugLog('warn', 'handleTextAction aborted: unsupported page', {
      paper: summarizePaper(paper),
    });
    var unsupState = await StateStore.updateState(s => {
      s.currentPaper = paper;
      s.currentWorkspace = {
        status: Shared.WorkspaceStatus.ERROR,
        activeThread: null,
        lastAction: action,
        pendingRequest: null,
        error: {
          code: Shared.ErrorCode.UNSUPPORTED_PAGE,
          message: 'This page type does not support text explanation.',
        },
      };
    });
    if (payload.tabId && !payload.panelOpened) {
      await openSidePanel(payload.tabId);
    }
    return { ok: true, state: unsupState };
  }

  // 1. Set loading state
  await StateStore.updateState(s => {
    s.currentPaper = paper;
    s.currentWorkspace = {
      status: Shared.WorkspaceStatus.LOADING,
      activeThread: null,
      lastAction: action,
      pendingRequest: {
        kind: 'text',
        requestedAt: Shared.nowIso(),
      },
      error: null,
    };
  });

  if (payload.tabId && !payload.panelOpened) {
    await openSidePanel(payload.tabId);
  }

  // 2. Build API request (backend-api-spec §6.2)
  var request = {
    paper,
    selection: payload.selection,
    action,
    client: Shared.CLIENT_INFO,
  };

  debugLog('info', 'handleTextAction calling ApiClient.explainText', {
    action,
    paper: summarizePaper(request.paper),
    selection: summarizeSelection(request.selection),
  });

  // 3. Call API client
  var response = await ApiClient.explainText(request);
  response = normalizeResultResponse(
    response,
    'The backend returned an invalid text explanation response.'
  );

  debugLog(
    response.status === Shared.ResultStatus.ERROR ? 'warn' : 'info',
    'handleTextAction received response',
    {
      action,
      response: summarizeResponse(response),
    }
  );

  // 4. Handle result
  if (response.status === Shared.ResultStatus.ERROR) {
    var errState = await StateStore.updateState(s => {
      s.currentWorkspace.status = Shared.WorkspaceStatus.ERROR;
      s.currentWorkspace.pendingRequest = null;
      s.currentWorkspace.error = {
        code: response.error.code,
        message: response.error.message,
      };
      // Preserve source in a minimal thread so retry can
      // reconstruct the request (spec §7.3: error → loading
      // on RETRY_REQUESTED).  activeThread stays null for
      // unsupported-page errors (no payload.selection).
      if (payload.selection && !payload.unsupported) {
        s.currentWorkspace.activeThread = buildRetryThread(payload);
      }
    });
    return { ok: true, response, state: errState };
  }

  var thread = buildTextThread(payload, response);

  var finalState = await StateStore.updateState(s => {
    s.currentWorkspace = {
      status: response.status,
      activeThread: thread,
      lastAction: action,
      pendingRequest: null,
      error: null,
    };
    s.historyWorkspace.items.unshift(buildHistoryItem(thread, action, response.result.createdAt));
    // Enforce storage limit — prune oldest entries from the tail
    if (s.historyWorkspace.items.length > MAX_HISTORY_ITEMS) {
      s.historyWorkspace.items.length = MAX_HISTORY_ITEMS;
    }
  });

  return { ok: true, response, state: finalState };
}

function buildTextThread(payload, response) {
  return {
    threadId: response.result.threadId,
    source: buildTextSource(payload.selection),
    resultCards: [
      {
        resultId: response.result.resultId,
        action: response.result.action,
        status: response.status,
        sections: response.result.sections,
        warnings: response.result.warnings,
        createdAt: response.result.createdAt,
      },
    ],
    followUps: [],
    createdAt: response.result.createdAt,
    updatedAt: response.result.createdAt,
  };
}

// ─── Helpers: Retry Thread ──────────────────────────────────
//
// When a text or figure action fails, we preserve the source
// info in a minimal thread (no result cards) so the retry
// handler can reconstruct the API request.
// The UI shows ErrorCard (status=error), so this thread is
// invisible to the user until retry succeeds.

function buildRetryThread(payload) {
  var now = Shared.nowIso();

  if (payload.selection) {
    return {
      threadId: Shared.createId('thread'),
      source: buildTextSource(payload.selection),
      resultCards: [],
      followUps: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  if (payload.figure) {
    return {
      threadId: Shared.createId('thread'),
      source: buildFigureSource(payload.figure),
      resultCards: [],
      followUps: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  return null;
}

// ─── Handlers: Figure Action ────────────────────────────────
//
// Flow (side-panel-state-spec §12.2):
//   1. Set loading state + open side panel
//   2. Build API request per backend-api-spec §7.2
//   3. Call ApiClient.explainFigure
//   4. On success → build thread, set success/partial_success
//      On error  → set error state

async function handleFigureAction(payload) {
  var paper = Shared.createPaperContext(payload.paper || {});
  var figure;

  debugLog('info', 'handleFigureAction received', {
    tabId: payload.tabId || null,
    panelOpened: !!payload.panelOpened,
    apiClientConfig: summarizeApiClientConfig(),
    paper: summarizePaper(paper),
    figure: summarizeFigure(payload.figure),
  });

  // 1. Set loading state
  await StateStore.updateState(s => {
    s.currentPaper = paper;
    s.currentWorkspace = {
      status: Shared.WorkspaceStatus.LOADING,
      activeThread: null,
      lastAction: Shared.ActionType.EXPLAIN_FIGURE,
      pendingRequest: {
        kind: 'figure',
        requestedAt: Shared.nowIso(),
      },
      error: null,
    };
  });

  if (payload.tabId && !payload.panelOpened) {
    await openSidePanel(payload.tabId);
  }

  try {
    figure = await hydrateFigurePayload(payload.tabId, payload.figure);
  } catch (error) {
    debugLog('warn', 'handleFigureAction capture failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
      figure: summarizeFigure(payload.figure),
    });
    var captureError = createWorkerErrorResponse(
      Shared.ErrorCode.IMAGE_TOO_SMALL,
      error instanceof Error ? error.message : 'Unable to capture the selected figure region',
      true
    );
    var captureErrState = await StateStore.updateState(s => {
      s.currentWorkspace.status = Shared.WorkspaceStatus.ERROR;
      s.currentWorkspace.pendingRequest = null;
      s.currentWorkspace.error = {
        code: captureError.error.code,
        message: captureError.error.message,
      };
      if (payload.figure) {
        s.currentWorkspace.activeThread = buildRetryThread({
          figure: payload.figure,
        });
      }
    });
    return { ok: true, response: captureError, state: captureErrState };
  }

  // 2. Build API request (backend-api-spec §7.2)
  var request = {
    paper,
    figure: {
      figureId: figure.figureId,
      imageRef: figure.imageRef || undefined,
      imageData: figure.imageData || undefined,
      thumbnailRef: figure.thumbnailRef || undefined,
      caption: figure.caption || undefined,
      pageNumber: figure.pageNumber || undefined,
      boundingBox: figure.boundingBox || undefined,
    },
    action: Shared.ActionType.EXPLAIN_FIGURE,
    client: Shared.CLIENT_INFO,
  };

  debugLog('info', 'handleFigureAction calling ApiClient.explainFigure', {
    paper: summarizePaper(request.paper),
    figure: summarizeFigure(request.figure),
  });

  // 3. Call API client
  var response = await ApiClient.explainFigure(request);
  response = normalizeResultResponse(
    response,
    'The backend returned an invalid figure explanation response.'
  );

  debugLog(
    response.status === Shared.ResultStatus.ERROR ? 'warn' : 'info',
    'handleFigureAction received response',
    {
      response: summarizeResponse(response),
    }
  );

  // 4. Handle result
  if (response.status === Shared.ResultStatus.ERROR) {
    var errState = await StateStore.updateState(s => {
      s.currentWorkspace.status = Shared.WorkspaceStatus.ERROR;
      s.currentWorkspace.pendingRequest = null;
      s.currentWorkspace.error = {
        code: response.error.code,
        message: response.error.message,
      };
      // Preserve source for retry (spec §7.3: error → loading
      // on RETRY_REQUESTED)
      if (figure) {
        s.currentWorkspace.activeThread = buildRetryThread({
          figure,
        });
      }
    });
    return { ok: true, response, state: errState };
  }

  var thread = buildFigureThread({ figure }, response);

  var finalState = await StateStore.updateState(s => {
    s.currentWorkspace = {
      status: response.status,
      activeThread: thread,
      lastAction: Shared.ActionType.EXPLAIN_FIGURE,
      pendingRequest: null,
      error: null,
    };
    s.historyWorkspace.items.unshift(
      buildHistoryItem(thread, Shared.ActionType.EXPLAIN_FIGURE, response.result.createdAt)
    );
  });

  return { ok: true, response, state: finalState };
}

function buildFigureThread(payload, response) {
  return {
    threadId: response.result.threadId,
    source: buildFigureSource(payload.figure),
    resultCards: [
      {
        resultId: response.result.resultId,
        action: response.result.action,
        status: response.status,
        sections: response.result.sections,
        warnings: response.result.warnings,
        createdAt: response.result.createdAt,
      },
    ],
    followUps: [],
    createdAt: response.result.createdAt,
    updatedAt: response.result.createdAt,
  };
}

function buildDocumentSource(docPayload) {
  return {
    type: Shared.ResultSourceType.DOCUMENT,
    documentKind: docPayload.kind || 'html',
    fullText: docPayload.fullText || undefined,
    pageCount: docPayload.pageCount || undefined,
  };
}

function buildDocumentThread(payload, response) {
  return {
    threadId: response.result.threadId,
    source: buildDocumentSource(payload.document),
    resultCards: [
      {
        resultId: response.result.resultId,
        action: response.result.action,
        status: response.status,
        sections: response.result.sections,
        warnings: response.result.warnings,
        createdAt: response.result.createdAt,
      },
    ],
    followUps: [],
    createdAt: response.result.createdAt,
    updatedAt: response.result.createdAt,
  };
}

// ─── Handlers: Follow-Up ────────────────────────────────────
//
// Flow (side-panel-state-spec §12.4):
//   1. Find active thread
//   2. Build API request per backend-api-spec §8.2
//   3. Call ApiClient.followUp
//   4. On success → append follow-up to thread
//      On error  → append failed follow-up with error message

async function handleFollowUp(message) {
  var state = await StateStore.getState();
  var activeThread = state.currentWorkspace.activeThread;
  if (!activeThread) {
    return { ok: false, error: 'No active thread' };
  }

  var threadId = message.threadId || activeThread.threadId;
  var sourceResultId =
    message.sourceResultId ||
    (activeThread.resultCards.length > 0 ? activeThread.resultCards[0].resultId : null);

  if (!sourceResultId) {
    return { ok: false, error: 'No source result for follow-up' };
  }

  // Build API request (backend-api-spec §8.2)
  var request = {
    threadId,
    sourceResultId,
    question: message.question,
    client: Shared.CLIENT_INFO,
  };

  debugLog('info', 'handleFollowUp calling ApiClient.followUp', {
    apiClientConfig: summarizeApiClientConfig(),
    threadId,
    sourceResultId,
    questionPreview: previewText(message.question, 80),
  });

  var response = await ApiClient.followUp(request);
  response = normalizeFollowUpResponse(
    response,
    'The backend returned an invalid follow-up response.'
  );

  debugLog(
    response.status === Shared.ResultStatus.ERROR ? 'warn' : 'info',
    'handleFollowUp received response',
    {
      response: summarizeResponse(response),
    }
  );

  if (response.status === Shared.ResultStatus.ERROR) {
    var errState = await StateStore.updateState(s => {
      var thread = s.currentWorkspace.activeThread;
      if (thread) {
        thread.followUps.push({
          followUpId: Shared.createId('followup'),
          question: message.question,
          answerStatus: 'error',
          error: response.error.message,
          createdAt: Shared.nowIso(),
        });
        thread.updatedAt = Shared.nowIso();
      }
    });
    return {
      ok: false,
      error: response.error.message,
      state: errState,
    };
  }

  var okState = await StateStore.updateState(s => {
    var thread = s.currentWorkspace.activeThread;
    if (thread) {
      thread.followUps.push({
        followUpId: response.followUp.followUpId,
        question: response.followUp.question,
        answerStatus: 'success',
        answerSections: response.followUp.sections,
        error: null,
        createdAt: response.followUp.createdAt,
      });
      thread.updatedAt = response.followUp.createdAt;
    }
    s.currentWorkspace.status = Shared.WorkspaceStatus.SUCCESS;
  });

  return { ok: true, response, state: okState };
}

// ─── Handlers: Save Item ────────────────────────────────────

async function handleSaveItem(message) {
  var item = null;

  var state = await StateStore.updateState(s => {
    item = {
      id: Shared.createId('saved'),
      paperId: s.currentPaper ? s.currentPaper.paperId : Shared.createId('paper'),
      kind: normalizeSaveKind(message.kind),
      front: message.front || '',
      back: message.back || '',
      sourceSelectionId: normalizeOptionalString(message.sourceSelectionId),
      createdAt: Shared.nowIso(),
    };
    s.savedWorkspace.items.unshift(item);
    // Enforce storage limit — prune oldest entries from the tail
    if (s.savedWorkspace.items.length > MAX_SAVED_ITEMS) {
      s.savedWorkspace.items.length = MAX_SAVED_ITEMS;
    }
  });

  return { ok: true, item, state };
}

// ─── Handlers: Reopen History ───────────────────────────────
//
// side-panel-state-spec §5.11 — reopen a history item into Current.
// Restores the thread as activeThread without mutating source content.

async function handleReopenHistory(message) {
  var found = false;

  var state = await StateStore.updateState(s => {
    var historyItem = null;
    for (var i = 0; i < s.historyWorkspace.items.length; i++) {
      if (s.historyWorkspace.items[i].threadId === message.threadId) {
        historyItem = s.historyWorkspace.items[i];
        break;
      }
    }
    if (historyItem) {
      found = true;
      s.currentWorkspace = {
        status: getLatestResultCardStatus(historyItem.thread),
        activeThread: cloneValue(historyItem.thread),
        lastAction: historyItem.action,
        pendingRequest: null,
        error: null,
      };
      s.activeTab = Shared.Tabs.CURRENT;
    }
  });

  if (!found) {
    return { ok: false, error: 'History item not found' };
  }
  return { ok: true, state };
}

// ─── Handlers: Retry ────────────────────────────────────────
//
// side-panel-state-spec §7.3 — retry from error or partial_success.
// Re-dispatches the last text or figure action through the API client,
// reconstructing the request from the active thread's source.

async function handleRetry(message) {
  var state = await StateStore.getState();
  var ws = state.currentWorkspace;
  var nextSource = null;

  if (!ws.lastAction) {
    return { ok: false, error: 'No previous action to retry' };
  }

  var thread = ws.activeThread;
  if (!thread) {
    return { ok: false, error: 'No active thread to retry' };
  }

  // Set loading
  var sourceKind =
    thread.source.type === 'figure'
      ? 'figure'
      : thread.source.type === 'document'
        ? 'document'
        : 'text';

  await StateStore.updateState(s => {
    s.currentWorkspace.status = Shared.WorkspaceStatus.LOADING;
    s.currentWorkspace.error = null;
    s.currentWorkspace.pendingRequest = {
      kind: sourceKind,
      requestedAt: Shared.nowIso(),
    };
  });

  var response;

  if (thread.source.type === 'figure') {
    try {
      var retryFigure = {
        figureId: thread.source.figureId,
        imageRef: normalizeOptionalString(thread.source.imageRef),
        imageData: thread.source.imageData || undefined,
        thumbnailRef: normalizeOptionalString(thread.source.thumbnailRef),
        caption: normalizeOptionalString(thread.source.caption),
        pageNumber: normalizeOptionalPageNumber(thread.source.pageNumber),
        boundingBox: thread.source.boundingBox || undefined,
        captureViewport: thread.source.captureViewport || undefined,
      };

      if (!retryFigure.imageData && retryFigure.boundingBox) {
        retryFigure = await hydrateFigurePayload(
          await resolveRetryCaptureTabId(state.currentPaper),
          retryFigure
        );
      }

      nextSource = buildFigureSource(retryFigure);

      response = await ApiClient.explainFigure({
        paper: state.currentPaper || Shared.createPaperContext({}),
        figure: {
          figureId: retryFigure.figureId,
          imageRef: retryFigure.imageRef || undefined,
          imageData: retryFigure.imageData || undefined,
          thumbnailRef: retryFigure.thumbnailRef || undefined,
          caption: retryFigure.caption || undefined,
          pageNumber: retryFigure.pageNumber || undefined,
          boundingBox: retryFigure.boundingBox || undefined,
        },
        action: Shared.ActionType.EXPLAIN_FIGURE,
        client: Shared.CLIENT_INFO,
      });
      response = normalizeResultResponse(
        response,
        'The backend returned an invalid figure retry response.'
      );
    } catch (error) {
      response = createWorkerErrorResponse(
        Shared.ErrorCode.IMAGE_TOO_SMALL,
        error instanceof Error ? error.message : 'Unable to retry the selected figure region',
        true
      );
    }
  } else if (thread.source.type === 'document') {
    // Document retry — re-extract content and call summarize
    var documentPayload = null;
    var retryPaper = state.currentPaper;

    if (thread.source.documentKind === 'html') {
      // HTML: reuse cached fullText from source, or re-extract from tab
      if (thread.source.fullText) {
        documentPayload = {
          kind: 'html',
          fullText: thread.source.fullText,
        };
      } else {
        var retryTab = await resolveRetryCaptureTabId(state.currentPaper);
        if (retryTab) {
          try {
            var htmlExtractResponse = await chrome.tabs.sendMessage(retryTab, {
              type: Shared.MessageType.EXTRACT_PAGE_CONTENT,
            });
            if (htmlExtractResponse && htmlExtractResponse.ok) {
              documentPayload = htmlExtractResponse.document;
            }
          } catch (extractErr) {
            debugLog('warn', 'handleRetry HTML document extraction failed', {
              message: extractErr instanceof Error ? extractErr.message : 'Unknown error',
            });
          }
        }
      }
    } else {
      // PDF: request from pdf-viewer tab
      var pdfTabs = await chrome.tabs.query({});
      var pdfViewerUrl = chrome.runtime.getURL('src/pdf-viewer/pdf-viewer.html');
      var pdfViewerTab = null;
      for (var i = 0; i < pdfTabs.length; i++) {
        if (pdfTabs[i].url && pdfTabs[i].url.indexOf(pdfViewerUrl) === 0) {
          pdfViewerTab = pdfTabs[i];
          break;
        }
      }
      if (pdfViewerTab) {
        try {
          var pdfExtractResponse = await chrome.runtime.sendMessage({
            type: Shared.MessageType.EXTRACT_PAGE_CONTENT,
            target: 'pdf-workspace',
          });
          if (pdfExtractResponse && pdfExtractResponse.ok) {
            documentPayload = pdfExtractResponse.document;
            if (pdfExtractResponse.paper) {
              retryPaper = pdfExtractResponse.paper;
            }
            if (documentPayload && documentPayload.fileData) {
              pendingDocumentCache = {
                fileData: documentPayload.fileData,
                filename: documentPayload.filename,
                fileSize: documentPayload.fileSize,
                pageCount: documentPayload.pageCount,
              };
            }
          }
        } catch (extractErr) {
          debugLog('warn', 'handleRetry PDF document extraction failed', {
            message: extractErr instanceof Error ? extractErr.message : 'Unknown error',
          });
        }
      }
    }

    if (!documentPayload) {
      var extractError = createWorkerErrorResponse(
        Shared.ErrorCode.UNSUPPORTED_PAGE,
        'Unable to extract document content for retry',
        true
      );
      var extractErrState = await StateStore.updateState(s => {
        s.currentWorkspace.status = Shared.WorkspaceStatus.ERROR;
        s.currentWorkspace.pendingRequest = null;
        s.currentWorkspace.error = {
          code: extractError.error.code,
          message: extractError.error.message,
        };
      });
      return { ok: true, response: extractError, state: extractErrState };
    }

    if (documentPayload.kind === 'pdf_file') {
      var existingRetryPaper = retryPaper || {};
      retryPaper = Shared.buildPdfPaperContext({
        title:
          existingRetryPaper.title && existingRetryPaper.title !== 'Untitled Paper'
            ? existingRetryPaper.title
            : documentPayload.filename || 'Untitled Paper',
        filename: documentPayload.filename || existingRetryPaper.title || 'untitled.pdf',
        pdfFileSize: documentPayload.fileSize,
        pdfSourceUrl: existingRetryPaper.url || '',
        pageNumber: existingRetryPaper.pageNumber,
        authors: existingRetryPaper.authors,
      });
    }

    try {
      response = await ApiClient.summarize({
        paper: retryPaper || Shared.createPaperContext({}),
        document: documentPayload,
        action: Shared.ActionType.SUMMARIZE,
        client: Shared.CLIENT_INFO,
      });
      response = normalizeResultResponse(
        response,
        'The backend returned an invalid summarize retry response.'
      );
    } catch (error) {
      response = createWorkerErrorResponse(
        Shared.ErrorCode.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Unable to summarize document',
        true
      );
    }
  } else {
    nextSource = buildTextSource({
      selectionId: thread.source.selectionId,
      text: thread.source.text,
      context: thread.source.context,
      pageNumber: thread.source.pageNumber,
    });

    response = await ApiClient.explainText({
      paper: state.currentPaper || Shared.createPaperContext({}),
      selection: {
        selectionId: nextSource.selectionId,
        text: nextSource.text,
        context: nextSource.context,
        pageNumber: nextSource.pageNumber,
      },
      action: ws.lastAction,
      client: Shared.CLIENT_INFO,
    });
    response = normalizeResultResponse(
      response,
      'The backend returned an invalid text retry response.'
    );
  }

  // Update thread with new result
  var finalState = await StateStore.updateState(s => {
    var t = s.currentWorkspace.activeThread;
    if (!t) {
      return;
    }

    if (response.status === Shared.ResultStatus.ERROR) {
      s.currentWorkspace.status = Shared.WorkspaceStatus.ERROR;
      s.currentWorkspace.pendingRequest = null;
      s.currentWorkspace.error = {
        code: response.error.code,
        message: response.error.message,
      };
      return;
    }

    if (nextSource) {
      t.source = nextSource;
    }
    t.resultCards = [
      {
        resultId: response.result.resultId,
        action: response.result.action,
        status: response.status,
        sections: response.result.sections,
        warnings: response.result.warnings,
        createdAt: response.result.createdAt,
      },
    ];
    t.updatedAt = Shared.nowIso();
    s.currentWorkspace.status = response.status;
    s.currentWorkspace.pendingRequest = null;
    s.currentWorkspace.error = null;
  });

  return { ok: true, state: finalState };
}

// ─── Handlers: Summarize ────────────────────────────────────
//
// Full-document summarization flow:
//   1. Set loading state with pendingRequest kind "document"
//   2. Extract document content from content-script (HTML) or
//      pdf-viewer (PDF) via EXTRACT_PAGE_CONTENT message
//   3. Call ApiClient.summarize with the document payload
//   4. Build document thread and update state

async function handleSummarize(message, sender) {
  var state = await StateStore.getState();
  var paper = state.currentPaper;

  if (!paper) {
    return { ok: false, error: 'No current paper to summarize' };
  }

  debugLog('info', 'handleSummarize start', {
    paperTitle: paper.title,
    sourceType: paper.sourceType,
    apiClientConfig: summarizeApiClientConfig(),
  });

  // 1. Set loading state
  await StateStore.updateState(s => {
    s.currentWorkspace = {
      status: Shared.WorkspaceStatus.LOADING,
      activeThread: null,
      lastAction: Shared.ActionType.SUMMARIZE,
      pendingRequest: {
        kind: 'document',
        requestedAt: Shared.nowIso(),
      },
      error: null,
    };
  });

  // 2. Extract document content based on source type
  var documentPayload = null;
  var pdfViewerUrl = chrome.runtime.getURL('src/pdf-viewer/pdf-viewer.html');
  var isPdfSource =
    paper.sourceType === Shared.SourceType.PDF ||
    (paper.url && paper.url.indexOf(pdfViewerUrl) === 0);

  if (isPdfSource) {
    // PDF: request from pdf-viewer via chrome.runtime broadcast
    try {
      var pdfResponse = await chrome.runtime.sendMessage({
        type: Shared.MessageType.EXTRACT_PAGE_CONTENT,
        target: 'pdf-workspace',
      });
      if (pdfResponse && pdfResponse.ok && pdfResponse.document) {
        documentPayload = pdfResponse.document;
        if (pdfResponse.paper) {
          paper = pdfResponse.paper;
        }
        // Cache PDF data in memory for retry (not persisted to storage)
        if (documentPayload.fileData) {
          pendingDocumentCache = {
            fileData: documentPayload.fileData,
            filename: documentPayload.filename,
            fileSize: documentPayload.fileSize,
            pageCount: documentPayload.pageCount,
          };
        }
      }
    } catch (pdfError) {
      debugLog('warn', 'handleSummarize PDF extraction failed', {
        message: pdfError instanceof Error ? pdfError.message : 'Unknown error',
      });
    }
  } else {
    // HTML: request from content-script on the active tab
    var tabId = message.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
      var activeTab = await getActiveTab();
      tabId = activeTab && activeTab.id;
    }

    if (tabId) {
      try {
        var htmlResponse = await chrome.tabs.sendMessage(tabId, {
          type: Shared.MessageType.EXTRACT_PAGE_CONTENT,
        });
        if (htmlResponse && htmlResponse.ok && htmlResponse.document) {
          documentPayload = htmlResponse.document;
        }
      } catch (htmlError) {
        debugLog('warn', 'handleSummarize HTML extraction failed', {
          message: htmlError instanceof Error ? htmlError.message : 'Unknown error',
        });
      }
    }
  }

  // Extraction failure — no usable document content
  if (!documentPayload) {
    var extractError = createWorkerErrorResponse(
      Shared.ErrorCode.UNSUPPORTED_PAGE,
      isPdfSource
        ? 'Unable to extract PDF content. Please ensure the PDF viewer is open.'
        : 'Unable to extract page content from this webpage.',
      true
    );
    debugLog('warn', 'handleSummarize extraction failed', {
      isPdfSource,
    });
    var extractErrState = await StateStore.updateState(s => {
      s.currentWorkspace.status = Shared.WorkspaceStatus.ERROR;
      s.currentWorkspace.pendingRequest = null;
      s.currentWorkspace.error = {
        code: extractError.error.code,
        message: extractError.error.message,
      };
    });
    return { ok: true, response: extractError, state: extractErrState };
  }

  // The extracted document kind is authoritative. PDF Workspace is an
  // extension page, so tab synchronization may have classified its
  // chrome-extension:// URL as HTML before the file context was available.
  // Rebuild a schema-safe PDF context here even for stale persisted state.
  if (documentPayload.kind === 'pdf_file') {
    var existingPaper = paper || {};
    paper = Shared.buildPdfPaperContext({
      paperId: existingPaper.paperId,
      title:
        existingPaper.title && existingPaper.title !== 'Untitled Paper'
          ? existingPaper.title
          : documentPayload.filename || 'Untitled Paper',
      filename: documentPayload.filename || existingPaper.title || 'untitled.pdf',
      pdfFileSize: documentPayload.fileSize,
      pdfSourceUrl: existingPaper.url || '',
      pageNumber: existingPaper.pageNumber,
      authors: existingPaper.authors,
    });
    await StateStore.updateState(s => {
      s.currentPaper = paper;
    });
  }

  // 3. Call API client
  var request = {
    paper,
    document: documentPayload,
    action: Shared.ActionType.SUMMARIZE,
    client: Shared.CLIENT_INFO,
  };

  debugLog('info', 'handleSummarize calling ApiClient.summarize', {
    paperTitle: paper.title,
    documentKind: documentPayload.kind,
    charCount: documentPayload.fullText
      ? documentPayload.fullText.length
      : documentPayload.fileSize || 0,
  });

  var response = await ApiClient.summarize(request);
  response = normalizeResultResponse(
    response,
    'The backend returned an invalid summarize response.'
  );

  debugLog(
    response.status === Shared.ResultStatus.ERROR ? 'warn' : 'info',
    'handleSummarize received response',
    { response: summarizeResponse(response) }
  );

  // 4. Handle result
  if (response.status === Shared.ResultStatus.ERROR) {
    var errState = await StateStore.updateState(s => {
      s.currentWorkspace.status = Shared.WorkspaceStatus.ERROR;
      s.currentWorkspace.pendingRequest = null;
      s.currentWorkspace.error = {
        code: response.error.code,
        message: response.error.message,
      };
      // Preserve document source for retry
      s.currentWorkspace.activeThread = {
        threadId: Shared.createId('thread'),
        source: buildDocumentSource(documentPayload),
        resultCards: [],
        followUps: [],
        createdAt: Shared.nowIso(),
        updatedAt: Shared.nowIso(),
      };
    });
    return { ok: true, response, state: errState };
  }

  var thread = buildDocumentThread({ document: documentPayload }, response);

  var finalState = await StateStore.updateState(s => {
    s.currentWorkspace = {
      status: response.status,
      activeThread: thread,
      lastAction: Shared.ActionType.SUMMARIZE,
      pendingRequest: null,
      error: null,
    };
    s.historyWorkspace.items.unshift(
      buildHistoryItem(thread, Shared.ActionType.SUMMARIZE, response.result.createdAt)
    );
    if (s.historyWorkspace.items.length > MAX_HISTORY_ITEMS) {
      s.historyWorkspace.items.length = MAX_HISTORY_ITEMS;
    }
  });

  return { ok: true, response, state: finalState };
}

// ─── Handlers: Health Check ─────────────────────────────────
//
// Calls GET /api/health (backend-api-spec §9) and maps the
// result to BackendStatus for the side panel badge.

async function handleCheckHealth() {
  var health = await ApiClient.health();
  var status = mapHealthToBackendStatus(health);

  var state = await StateStore.updateState(s => {
    s.backendStatus = status;
  });

  return {
    ok: true,
    health,
    backendStatus: status,
    state,
  };
}
