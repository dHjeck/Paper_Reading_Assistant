/**
 * Paper Reading Assistant — PDF Viewer (Shell + Coordination)
 *
 * This module wires the toolbar UI to the pdf-loader and pdf-renderer.
 * It manages viewer state: the currently loaded document, current
 * page number, and zoom level, updating the DOM after each action.
 *
 * Scope: load + render + page navigation + zoom only.
 * No text/figure explanation logic lives here.
 *
 * Loaded via <script> tag in pdf-viewer.html.
 * Uses: globalThis.pdfjsLib, globalThis.PraPdfLoader, globalThis.PraPdfRenderer
 */
(function () {
  var pdfjsLib = globalThis.pdfjsLib;
  var Loader = globalThis.PraPdfLoader;
  var Renderer = globalThis.PraPdfRenderer;
  var Shared = globalThis.PaperReadingAssistantShared;
  var I18N = globalThis.I18N;
  var currentLanguage = 'en';

  // ─── DOM References ───────────────────────────────────

  var fileInput = document.getElementById('file-input');
  var openFileBtn = document.getElementById('open-file-btn');
  var emptyOpenBtn = document.getElementById('empty-open-btn');
  var filenameLabel = document.getElementById('filename');
  var prevPageBtn = document.getElementById('prev-page-btn');
  var nextPageBtn = document.getElementById('next-page-btn');
  var pageInfo = document.getElementById('page-info');
  var zoomInBtn = document.getElementById('zoom-in-btn');
  var zoomOutBtn = document.getElementById('zoom-out-btn');
  var zoomFitBtn = document.getElementById('zoom-fit-btn');
  var zoomLevel = document.getElementById('zoom-level');
  var emptyState = document.getElementById('empty-state');
  var loadingState = document.getElementById('loading-state');
  var errorState = document.getElementById('error-state');
  var errorMessage = document.getElementById('error-message');
  var errorRetryBtn = document.getElementById('error-retry-btn');
  var canvasContainer = document.getElementById('canvas-container');
  var pageWrapper = document.getElementById('page-wrapper');
  var textLayer = document.getElementById('text-layer');
  var canvas = document.getElementById('pdf-canvas');
  var statusBar = document.getElementById('status-bar');

  // Figure capture
  var figureCaptureBtn = document.getElementById('figure-capture-btn');
  var figureOverlay = document.getElementById('figure-overlay');
  var figureOverlayCancel = document.getElementById('figure-overlay-cancel');
  var figureSelection = figureOverlay
    ? figureOverlay.querySelector('.pra-figure-overlay__selection')
    : null;
  var figureWarning = figureOverlay
    ? figureOverlay.querySelector('.pra-figure-overlay__warning')
    : null;
  var figureActions = figureOverlay
    ? figureOverlay.querySelector('.pra-figure-overlay__actions')
    : null;
  var figureUseBtn = document.getElementById('figure-use-btn');
  var figureAgainBtn = document.getElementById('figure-again-btn');
  var figureCancelBtn = document.getElementById('figure-cancel-btn');

  // ─── Viewer State ─────────────────────────────────────

  var state = {
    docHandle: null,
    currentPage: 1,
    numPages: 0,
    scale: 1.0,
    filename: '',
    rendering: false,
    pendingPage: null,
    pdfPaperContext: null,
    cachedFileData: null, // base64 data URL for summarize feature
    originalFileSize: 0, // original file size in bytes
  };

  // Selection & Toolbar
  var toolbar;
  var toolbarWarning;
  var toolbarState = Shared ? Shared.ToolbarStatus.HIDDEN : 'hidden';
  var activeSelection = null;
  var pendingHide = false;
  var lastActionSignature = null;
  var lastActionTime = 0;

  // Own tab ID — needed so the background can open the side panel
  // on this extension page (chrome-extension:// pages have no sender.tab).
  var ownTabId = null;

  // Figure capture state
  var figureState = {
    active: false, // is figure selection mode on
    dragging: false, // user is dragging
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    phase: 'idle', // idle | selecting | review | submitting
  };

  // ─── Constants ────────────────────────────────────────

  var MIN_SCALE = 0.2;
  var MAX_SCALE = 3.0;
  var SCALE_STEP = 0.2;
  var DEFAULT_SCALE = 1.0;

  var DEBOUNCE_MS = 800;
  var EDGE_MARGIN = 8;
  var CONTEXT_WINDOW = 500;

  // Figure capture constants
  var FIGURE_MIN_DRAG = 20; // px — ignore micro-drags
  var FIGURE_SMALL_REGION = 80; // px — warn on small crops

  // ─── Utilities ────────────────────────────────────────

  function getUrlParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  /**
   * Translate a key using the current language.
   */
  function t(key) {
    var dict = (I18N && I18N[currentLanguage]) || (I18N && I18N.en) || {};
    return dict[key] || (I18N && I18N.en && I18N.en[key]) || key;
  }

  function trInline(map) {
    return map[currentLanguage] || map.en;
  }

  function getErrorDetails(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return trInline({
      en: 'Unknown error',
      zh: '\u672a\u77e5\u9519\u8bef',
      ja: '\u4e0d\u660e\u306a\u30a8\u30e9\u30fc',
    });
  }

  function buildRuntimeMessage(kind, error) {
    var details = error ? getErrorDetails(error) : '';
    var prefix;

    switch (kind) {
      case 'missingPdfJs':
        prefix = trInline({
          en: 'Warning: pdf.js library not found. PDF viewing is unavailable.',
          zh: '\u8b66\u544a\uff1a\u672a\u627e\u5230 pdf.js\uff0c\u65e0\u6cd5\u67e5\u770b PDF\u3002',
          ja: '\u8b66\u544a: pdf.js \u304c\u898b\u3064\u304b\u3089\u305a\u3001PDF \u3092\u8868\u793a\u3067\u304d\u307e\u305b\u3093\u3002',
        });
        return prefix;
      case 'loadPdf':
        prefix = trInline({
          en: 'Failed to load PDF:',
          zh: '\u52a0\u8f7d PDF \u5931\u8d25\uff1a',
          ja: 'PDF \u306e\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f:',
        });
        break;
      case 'fitPdf':
        prefix = trInline({
          en: 'Unable to fit page:',
          zh: '\u65e0\u6cd5\u8c03\u6574\u5230\u9002\u5408\u9875\u5bbd\uff1a',
          ja: '\u30da\u30fc\u30b8\u5e45\u306b\u5408\u308f\u305b\u3089\u308c\u307e\u305b\u3093:',
        });
        break;
      case 'renderPdf':
      default:
        prefix = trInline({
          en: 'Failed to render page:',
          zh: '\u6e32\u67d3\u9875\u9762\u5931\u8d25\uff1a',
          ja: '\u30da\u30fc\u30b8\u306e\u63cf\u753b\u306b\u5931\u6557\u3057\u307e\u3057\u305f:',
        });
        break;
    }

    return `${prefix} ${details}`;
  }

  /**
   * Apply i18n translations to all [data-i18n-*] elements in the page.
   */
  function applyI18n() {
    // data-i18n-text → textContent
    var textEls = document.querySelectorAll('[data-i18n-text]');
    for (var i = 0; i < textEls.length; i++) {
      var key = textEls[i].getAttribute('data-i18n-text');
      if (t(key) !== key) {
        textEls[i].textContent = t(key);
      }
    }
    // data-i18n-title → title attribute
    var titleEls = document.querySelectorAll('[data-i18n-title]');
    for (var j = 0; j < titleEls.length; j++) {
      var tKey = titleEls[j].getAttribute('data-i18n-title');
      if (t(tKey) !== tKey) {
        titleEls[j].title = t(tKey);
      }
    }
    // Re-apply toolbar button labels if toolbar exists
    if (toolbar) {
      var btns = toolbar.querySelectorAll('button[data-action]');
      var actionMap = {
        explain: t('pv_action_explain'),
        simplify: t('pv_action_simplify'),
        define: t('pv_action_define'),
        save: t('pv_action_save'),
      };
      btns.forEach(btn => {
        var action = btn.dataset.action;
        if (actionMap[action]) {
          btn.textContent = actionMap[action];
        }
      });
    }
  }

  // ─── Init ──────────────────────────────────────────────

  function init() {
    // Retrieve own tab ID so background can open side panel on this page.
    if (chrome.tabs && chrome.tabs.getCurrent) {
      chrome.tabs.getCurrent(tab => {
        if (tab) {
          ownTabId = tab.id;
        }
      });
    }

    // Load language from config storage
    chrome.storage.local
      .get(Shared.CONFIG_STORAGE_KEY)
      .then(stored => {
        var cfg = stored[Shared.CONFIG_STORAGE_KEY];
        if (cfg && typeof cfg.language === 'string') {
          currentLanguage = cfg.language;
        }
        applyI18n();
      })
      .catch(() => {
        applyI18n();
      });

    // Listen for language changes from the options page
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[Shared.CONFIG_STORAGE_KEY]) {
        return;
      }
      var newCfg = changes[Shared.CONFIG_STORAGE_KEY].newValue;
      if (newCfg && typeof newCfg.language === 'string' && newCfg.language !== currentLanguage) {
        currentLanguage = newCfg.language;
        applyI18n();
      }
    });

    if (!pdfjsLib) {
      showStatus(buildRuntimeMessage('missingPdfJs'));
      openFileBtn.disabled = true;
      emptyOpenBtn.disabled = true;
      return;
    }

    // Configure the pdf.js worker to use the extension-bundled file.
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
      'src/pdf-viewer/lib/pdf.worker.min.js'
    );

    openFileBtn.addEventListener('click', triggerFileInput);
    emptyOpenBtn.addEventListener('click', triggerFileInput);
    fileInput.addEventListener('change', handleFileChange);
    prevPageBtn.addEventListener('click', goToPrevPage);
    nextPageBtn.addEventListener('click', goToNextPage);
    zoomInBtn.addEventListener('click', zoomIn);
    zoomOutBtn.addEventListener('click', zoomOut);
    zoomFitBtn.addEventListener('click', zoomFitToWidth);
    errorRetryBtn.addEventListener('click', triggerFileInput);

    // Figure capture
    figureCaptureBtn.addEventListener('click', toggleFigureCapture);
    if (figureOverlayCancel) {
      figureOverlayCancel.addEventListener('click', cancelFigureCapture);
    }
    if (figureUseBtn) {
      figureUseBtn.addEventListener('click', confirmFigureCapture);
    }
    if (figureAgainBtn) {
      figureAgainBtn.addEventListener('click', resetFigureSelection);
    }
    if (figureCancelBtn) {
      figureCancelBtn.addEventListener('click', cancelFigureCapture);
    }
    if (figureOverlay) {
      figureOverlay.addEventListener('pointerdown', onFigurePointerDown);
      figureOverlay.addEventListener('pointermove', onFigurePointerMove);
      figureOverlay.addEventListener('pointerup', onFigurePointerUp);
      figureOverlay.addEventListener('pointercancel', onFigurePointerCancel);
      figureOverlay.addEventListener('contextmenu', e => {
        e.preventDefault();
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown);

    // Text selection & toolbar
    createToolbar();
    bindSelectionEvents();

    // Listen for figure selection requests from the side panel.
    // The side panel's "Start Figure Selection" button sends this
    // message to the active tab; the PDF viewer needs to handle it
    // directly since it runs as an extension page, not a content script.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        message &&
        message.type === Shared.MessageType.FIGURE_SELECTION_MODE_REQUESTED &&
        (!message.target || message.target === 'pdf-workspace')
      ) {
        toggleFigureCapture();
      }

      // Handle page content extraction for summarize feature
      if (message && message.type === Shared.MessageType.EXTRACT_PAGE_CONTENT) {
        if (!state.cachedFileData) {
          sendResponse({ ok: false, error: 'No PDF file is currently loaded.' });
          return;
        }
        sendResponse({
          ok: true,
          paper:
            state.pdfPaperContext ||
            Shared.buildPdfPaperContext({
              title: state.filename || 'Untitled Paper',
              filename: state.filename || 'untitled.pdf',
              pdfFileSize: state.originalFileSize,
            }),
          document: {
            kind: 'pdf_file',
            fileData: state.cachedFileData,
            filename: state.filename,
            fileSize: state.originalFileSize,
            pageCount: state.numPages,
          },
        });
        return;
      }
    });
  }

  // ─── File Input ────────────────────────────────────────

  function triggerFileInput() {
    fileInput.click();
  }

  async function handleFileChange() {
    var file = fileInput.files && fileInput.files[0];
    if (!file) {
      return;
    }

    // Clean up any previously loaded document.
    if (state.docHandle) {
      Loader.destroyDocument(state.docHandle);
      state.docHandle = null;
    }

    state.filename = file.name;
    state.currentPage = 1;
    state.scale = DEFAULT_SCALE;
    state.originalFileSize = file.size;

    // Cache file as base64 data URL for summarize feature.
    // Files > 30MB are not cached (summarize disabled for large files).
    var maxSize = Shared.MAX_PDF_FILE_SIZE || 30 * 1024 * 1024;
    if (file.size <= maxSize) {
      state.cachedFileData = await new Promise(resolve => {
        var reader = new FileReader();
        reader.onload = function () {
          resolve(reader.result);
        };
        reader.onerror = function () {
          resolve(null);
        };
        reader.readAsDataURL(file);
      });
    } else {
      state.cachedFileData = null;
    }

    // Reset text selection state
    textLayer.textContent = '';
    activeSelection = null;
    setToolbarState(Shared.ToolbarStatus.HIDDEN);

    showLoading();
    filenameLabel.textContent = file.name;

    try {
      var handle = await Loader.loadDocument(file);
      state.docHandle = handle;
      state.numPages = handle.numPages;

      // Pre-compute paper identity from file metadata.
      // Remote PDFs: pass the source URL from ?url= query parameter.
      // Local PDFs: filename + filesize produce a stable paperId.
      state.pdfPaperContext = Shared.buildPdfPaperContext({
        title: file.name,
        filename: file.name,
        pdfFileSize: file.size,
        pdfSourceUrl: getUrlParam('url') || '',
      });

      hideStates();
      canvasContainer.hidden = false;
      enableControls(true);
      updateMetadata();

      await renderCurrentPage();
    } catch (error) {
      showError(buildRuntimeMessage('loadPdf', error));
    } finally {
      // Reset the input so the same file can be re-selected later.
      fileInput.value = '';
    }
  }

  // ─── Page Navigation ──────────────────────────────────

  function goToPrevPage() {
    if (state.currentPage <= 1 || !state.docHandle) {
      return;
    }
    state.currentPage--;
    renderCurrentPage();
  }

  function goToNextPage() {
    if (state.currentPage >= state.numPages || !state.docHandle) {
      return;
    }
    state.currentPage++;
    renderCurrentPage();
  }

  // ─── Zoom ──────────────────────────────────────────────

  function zoomIn() {
    var next = Math.min(MAX_SCALE, state.scale + SCALE_STEP);
    if (next === state.scale) {
      return;
    }
    state.scale = next;
    renderCurrentPage();
  }

  function zoomOut() {
    var next = Math.max(MIN_SCALE, state.scale - SCALE_STEP);
    if (next === state.scale) {
      return;
    }
    state.scale = next;
    renderCurrentPage();
  }

  async function zoomFitToWidth() {
    if (!state.docHandle) {
      return;
    }
    try {
      var containerWidth = canvasContainer.clientWidth || window.innerWidth;
      var fitScale = await Renderer.getFitToWidthScale(
        state.docHandle.doc,
        state.currentPage,
        containerWidth
      );
      state.scale = Math.round(fitScale * 100) / 100;
      renderCurrentPage();
    } catch (error) {
      showStatus(buildRuntimeMessage('fitPdf', error));
    }
  }

  // ─── Rendering ─────────────────────────────────────────

  async function renderCurrentPage() {
    if (!state.docHandle || state.rendering) {
      return;
    }

    // Hide stale text layer during render
    textLayer.hidden = true;

    // If a render is requested while one is pending,
    // store the desired page and apply after the current render finishes.
    state.rendering = true;
    state.pendingPage = null;

    try {
      await Renderer.renderPage(state.docHandle.doc, state.currentPage, state.scale, canvas);
      updatePageWrapper();
      updateMetadata();

      // Re-render text layer after canvas is drawn
      await renderTextLayerForCurrentPage();
    } catch (error) {
      // If the render was cancelled by pdf.js (e.g. a new render started),
      // the error name is "RenderingCancelledException". Treat as non-fatal.
      if (error && error.name === 'RenderingCancelledException') {
        // Re-render if a different page was requested during cancellation.
        if (state.pendingPage !== null) {
          state.currentPage = state.pendingPage;
          state.pendingPage = null;
          state.rendering = false;
          renderCurrentPage();
        }
        return;
      }
      showError(buildRuntimeMessage('renderPdf', error));
    } finally {
      state.rendering = false;
    }
  }

  // ─── UI Helpers ────────────────────────────────────────

  function updateMetadata() {
    pageInfo.textContent =
      state.numPages > 0 ? `${state.currentPage} / ${state.numPages}` : '— / —';
    zoomLevel.textContent = `${Math.round(state.scale * 100)}%`;

    prevPageBtn.disabled = state.currentPage <= 1;
    nextPageBtn.disabled = state.currentPage >= state.numPages;
  }

  function enableControls(enabled) {
    prevPageBtn.disabled = !enabled || state.currentPage <= 1;
    nextPageBtn.disabled = !enabled || state.currentPage >= state.numPages;
    zoomInBtn.disabled = !enabled;
    zoomOutBtn.disabled = !enabled;
    zoomFitBtn.disabled = !enabled;
    figureCaptureBtn.disabled = !enabled;
  }

  function showLoading() {
    hideStates();
    loadingState.hidden = false;
  }

  function showError(message) {
    hideStates();
    errorMessage.textContent = message;
    errorState.hidden = false;
    enableControls(false);
    showStatus(message);
  }

  function hideStates() {
    emptyState.hidden = true;
    loadingState.hidden = true;
    errorState.hidden = true;
    canvasContainer.hidden = true;
  }

  function showStatus(message) {
    statusBar.textContent = message || '';
  }

  // ─── Page Wrapper & Text Layer ─────────────────────────

  function updatePageWrapper() {
    if (!pageWrapper || !canvas) {
      return;
    }
    pageWrapper.style.width = canvas.style.width;
    pageWrapper.style.height = canvas.style.height;
  }

  async function renderTextLayerForCurrentPage() {
    if (!state.docHandle || !textLayer) {
      return;
    }
    try {
      textLayer.hidden = false;
      await Renderer.renderTextLayer(
        state.docHandle.doc,
        state.currentPage,
        state.scale,
        textLayer
      );
    } catch (error) {
      // Non-fatal — text selection degrades gracefully.
      textLayer.hidden = true;
    }
  }

  // ─── Selection Event Binding ───────────────────────────

  function bindSelectionEvents() {
    document.addEventListener('mouseup', onSelectionMouseUp);
    document.addEventListener('mousedown', onDocumentMouseDown, true);
    document.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onSelectionKeyDown, true);
    document.addEventListener('keyup', onSelectionKeyUp);
  }

  function onDocumentMouseDown(event) {
    // Click on toolbar: prevent default to keep text selection
    if (toolbar && toolbar.contains(event.target)) {
      event.preventDefault();
      return;
    }
    // Click elsewhere: defer hide to next mouseup
    pendingHide = true;
  }

  function onSelectionMouseUp() {
    // Cancel any pending hide from mousedown
    pendingHide = false;

    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      return;
    }

    var rawText = selection.toString();
    var text = Shared.normalizeSelectionText(rawText);

    if (!text) {
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      return;
    }

    if (text.length < Shared.MIN_SELECTION_LENGTH) {
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      return;
    }

    var range = selection.getRangeAt(0);
    var rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      return;
    }

    if (text.length > Shared.MAX_SELECTION_LENGTH) {
      activeSelection = null;
      showToolbarWarning(t('pv_selection_long'));
      showToolbar(rect, true);
      return;
    }

    // Valid selection — build selection payload
    activeSelection = {
      selectionId: Shared.createId('selection'),
      text,
      context: extractSelectionContext(text),
      pageNumber: state.currentPage || undefined,
    };

    hideToolbarWarning();
    showToolbar(rect, false);
  }

  function onSelectionKeyUp(event) {
    // Shift+arrow keyboard selection support
    if (event.shiftKey && typeof event.key === 'string' && event.key.indexOf('Arrow') === 0) {
      onSelectionMouseUp();
    }
  }

  function onSelectionKeyDown(event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') {
      return;
    }

    // Escape cancels figure capture overlay
    if (figureState.active) {
      event.stopPropagation();
      event.preventDefault();
      cancelFigureCapture();
      return;
    }

    // Escape closes toolbar
    if (
      toolbarState === Shared.ToolbarStatus.VISIBLE ||
      toolbarState === Shared.ToolbarStatus.DISABLED ||
      toolbarState === Shared.ToolbarStatus.BUSY
    ) {
      event.stopPropagation();
      event.preventDefault();
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      var sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
      }
    }
  }

  function onScroll() {
    if (!isToolbarVisible()) {
      return;
    }
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      return;
    }
    var rect = selection.getRangeAt(0).getBoundingClientRect();
    // Hide if selection scrolled out of viewport
    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      return;
    }
    positionToolbar(rect);
  }

  // ─── Toolbar UI ────────────────────────────────────────

  function createToolbar() {
    toolbar = document.createElement('div');
    toolbar.className = 'pra-toolbar';
    toolbar.dataset.visible = 'false';
    toolbar.dataset.state = Shared.ToolbarStatus.HIDDEN;

    // Prevent mousedown on toolbar from stealing selection
    toolbar.addEventListener('mousedown', event => {
      event.preventDefault();
    });

    var actions = [
      [Shared.ActionType.EXPLAIN, 'pv_action_explain'],
      [Shared.ActionType.SIMPLIFY, 'pv_action_simplify'],
      [Shared.ActionType.DEFINE, 'pv_action_define'],
      ['save', 'pv_action_save'],
    ];

    actions.forEach(item => {
      var action = item[0];
      var labelKey = item[1];

      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.textContent = t(labelKey);

      button.addEventListener('click', () => {
        if (action === 'save') {
          void saveSelection();
        } else {
          void submitTextAction(action);
        }
      });

      toolbar.appendChild(button);
    });

    // Inline warning for "selection too long" etc.
    toolbarWarning = document.createElement('span');
    toolbarWarning.className = 'pra-toolbar__warning';
    toolbarWarning.setAttribute('role', 'status');
    toolbarWarning.hidden = true;
    toolbar.appendChild(toolbarWarning);

    document.getElementById('viewer-body').appendChild(toolbar);
  }

  function showToolbar(rect, isWarning) {
    positionToolbar(rect);
    setToolbarState(isWarning ? Shared.ToolbarStatus.DISABLED : Shared.ToolbarStatus.VISIBLE);
  }

  function positionToolbar(rect) {
    var scrollY = window.scrollY || document.documentElement.scrollTop;
    var scrollX = window.scrollX || document.documentElement.scrollLeft;
    var toolbarW = toolbar.offsetWidth || 300;
    var toolbarH = toolbar.offsetHeight || 44;

    // Prefer above selection
    var aboveTop = scrollY + rect.top - toolbarH - EDGE_MARGIN;
    var belowTop = scrollY + rect.bottom + EDGE_MARGIN;
    var top;

    if (aboveTop >= scrollY + EDGE_MARGIN) {
      top = aboveTop;
    } else {
      top = belowTop;
    }

    // Clamp vertically
    var maxTop = scrollY + window.innerHeight - toolbarH - EDGE_MARGIN;
    if (top > maxTop) {
      top = maxTop;
    }
    if (top < scrollY + EDGE_MARGIN) {
      top = scrollY + EDGE_MARGIN;
    }

    // Horizontal: center on selection, clamped to viewport
    var selectionCenter = scrollX + rect.left + rect.width / 2;
    var left = selectionCenter - toolbarW / 2;

    var minLeft = scrollX + EDGE_MARGIN;
    var maxLeft = scrollX + window.innerWidth - toolbarW - EDGE_MARGIN;
    if (left < minLeft) {
      left = minLeft;
    }
    if (left > maxLeft) {
      left = maxLeft;
    }

    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
  }

  function setToolbarState(newState) {
    toolbarState = newState;
    if (!toolbar) {
      return;
    }
    toolbar.dataset.state = newState;

    var visible =
      newState === Shared.ToolbarStatus.VISIBLE ||
      newState === Shared.ToolbarStatus.DISABLED ||
      newState === Shared.ToolbarStatus.BUSY;
    toolbar.dataset.visible = visible ? 'true' : 'false';
  }

  function isToolbarVisible() {
    return toolbar && toolbar.dataset.visible === 'true';
  }

  function setToolbarBusy(busy) {
    if (!toolbar) {
      return;
    }
    var buttons = toolbar.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.disabled = busy;
    });

    if (busy) {
      setToolbarState(Shared.ToolbarStatus.BUSY);
    } else {
      setToolbarState(Shared.ToolbarStatus.VISIBLE);
    }
  }

  function showToolbarWarning(message) {
    if (!toolbarWarning) {
      return;
    }
    toolbarWarning.textContent = message;
    toolbarWarning.hidden = false;
    var buttons = toolbar.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.style.display = 'none';
    });
  }

  function hideToolbarWarning() {
    if (!toolbarWarning) {
      return;
    }
    toolbarWarning.hidden = true;
    var buttons = toolbar.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.style.display = '';
    });
  }

  // ─── Text Actions ─────────────────────────────────────

  async function submitTextAction(action) {
    if (!activeSelection) {
      return;
    }

    // Debounce duplicate submissions
    var sig = `${action}:${activeSelection.selectionId}`;
    var now = Date.now();
    if (sig === lastActionSignature && now - lastActionTime < DEBOUNCE_MS) {
      return;
    }
    lastActionSignature = sig;
    lastActionTime = now;

    setToolbarBusy(true);

    var paper = Object.assign(
      {},
      state.pdfPaperContext ||
        Shared.createPaperContext({
          title: state.filename || 'Untitled Paper',
          sourceType: Shared.SourceType.PDF,
          pdf: true,
        }),
      {
        pageNumber: activeSelection.pageNumber || undefined,
      }
    );

    try {
      await chrome.runtime.sendMessage({
        type: Shared.MessageType.TEXT_ACTION_REQUESTED,
        tabId: ownTabId,
        action,
        selection: activeSelection,
        paper,
      });
    } catch (err) {
      // Swallow — background handles retry / error display
    } finally {
      setToolbarBusy(false);
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
    }
  }

  async function saveSelection() {
    if (!activeSelection) {
      return;
    }

    setToolbarBusy(true);

    try {
      await chrome.runtime.sendMessage({
        type: Shared.MessageType.SAVE_ITEM_REQUESTED,
        kind: 'note',
        front: activeSelection.text,
        back: activeSelection.context || '',
        sourceSelectionId: activeSelection.selectionId,
      });
    } catch (err) {
      // Swallow
    } finally {
      setToolbarBusy(false);
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
    }
  }

  // ─── Context Extraction ───────────────────────────────

  /**
   * Extract surrounding context from the text layer of the current page.
   * Finds the selected text within the full page text and returns a window
   * of CONTEXT_WINDOW characters before and after.
   */
  function extractSelectionContext(selectedText) {
    var pageText = getPageTextContent();
    if (!pageText) {
      return '';
    }

    var idx = pageText.indexOf(selectedText);
    if (idx === -1) {
      return pageText.slice(0, Shared.MAX_SELECTION_LENGTH);
    }

    var start = Math.max(0, idx - CONTEXT_WINDOW);
    var end = Math.min(pageText.length, idx + selectedText.length + CONTEXT_WINDOW);
    return pageText.slice(start, end);
  }

  function getPageTextContent() {
    if (!textLayer) {
      return '';
    }
    var spans = textLayer.querySelectorAll('.textLayer span');
    var parts = [];
    spans.forEach(span => {
      parts.push(span.textContent);
    });
    return Shared.normalizeSelectionText(parts.join(' '));
  }

  // ─── Keyboard ─────────────────────────────────────────

  function handleKeyDown(e) {
    if (!state.docHandle) {
      return;
    }
    // Don't intercept if the user is typing in an input.
    if (e.target && e.target.tagName === 'INPUT') {
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        goToPrevPage();
        break;
      case 'ArrowRight':
      case 'PageDown':
        e.preventDefault();
        goToNextPage();
        break;
      case '+':
      case '=':
        e.preventDefault();
        zoomIn();
        break;
      case '-':
        e.preventDefault();
        zoomOut();
        break;
      case '0':
        e.preventDefault();
        state.scale = DEFAULT_SCALE;
        renderCurrentPage();
        break;
    }
  }

  // ─── Figure Capture ───────────────────────────────────
  //
  // Coordinate system:
  //   - User drags on the overlay which is position:absolute over #page-wrapper
  //   - #page-wrapper is sized to the CSS-pixel canvas dimensions
  //   - Drag coordinates are relative to #page-wrapper (offsetX/offsetY)
  //   - The canvas buffer is scaled by devicePixelRatio, so cropping
  //     requires multiplying CSS coords by (canvas.width / canvas.offsetWidth)
  //   - The pdf.js viewport is already at state.scale, so the CSS-pixel
  //     region maps directly to the rendered page area.

  function toggleFigureCapture() {
    if (!state.docHandle) {
      return;
    }
    if (figureState.active) {
      cancelFigureCapture();
    } else {
      enterFigureCapture();
    }
  }

  function enterFigureCapture() {
    figureState.active = true;
    figureState.phase = 'idle';
    figureCaptureBtn.dataset.active = 'true';
    if (figureOverlay) {
      figureOverlay.hidden = false;
    }
    resetFigureOverlayUI();
    showStatus(t('pv_drag_status'));
  }

  function cancelFigureCapture() {
    figureState.active = false;
    figureState.dragging = false;
    figureState.phase = 'idle';
    figureCaptureBtn.dataset.active = 'false';
    if (figureOverlay) {
      figureOverlay.hidden = true;
    }
    resetFigureOverlayUI();
    showStatus('');
  }

  function resetFigureSelection() {
    figureState.dragging = false;
    figureState.phase = 'idle';
    resetFigureOverlayUI();
  }

  function resetFigureOverlayUI() {
    if (figureSelection) {
      figureSelection.hidden = true;
      figureSelection.style.width = '0';
      figureSelection.style.height = '0';
    }
    if (figureActions) {
      figureActions.hidden = true;
    }
    if (figureWarning) {
      figureWarning.hidden = true;
    }
  }

  // ─── Figure Pointer Handlers ─────────────────────────────

  function getFigureLocalCoords(event) {
    // Coordinates relative to the page-wrapper (overlay's positioned parent)
    var rect = pageWrapper.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
    };
  }

  function onFigurePointerDown(event) {
    if (event.target !== figureOverlay) {
      return;
    }
    if (figureState.phase === 'submitting') {
      return;
    }
    event.preventDefault();

    var coords = getFigureLocalCoords(event);
    figureState.dragging = true;
    figureState.phase = 'selecting';
    figureState.startX = coords.x;
    figureState.startY = coords.y;
    figureState.endX = coords.x;
    figureState.endY = coords.y;

    if (figureSelection) {
      figureSelection.hidden = false;
      updateFigureSelectionRect();
    }
    if (figureActions) {
      figureActions.hidden = true;
    }
    if (figureWarning) {
      figureWarning.hidden = true;
    }
  }

  function onFigurePointerMove(event) {
    if (!figureState.dragging || figureState.phase !== 'selecting') {
      return;
    }
    var coords = getFigureLocalCoords(event);
    figureState.endX = coords.x;
    figureState.endY = coords.y;
    updateFigureSelectionRect();
  }

  function onFigurePointerUp(event) {
    if (!figureState.dragging || figureState.phase !== 'selecting') {
      return;
    }
    var coords = getFigureLocalCoords(event);
    figureState.endX = coords.x;
    figureState.endY = coords.y;
    figureState.dragging = false;
    updateFigureSelectionRect();

    var box = getFigureBox();
    if (box.width < FIGURE_MIN_DRAG || box.height < FIGURE_MIN_DRAG) {
      resetFigureSelection();
      return;
    }

    figureState.phase = 'review';
    var isSmall = box.width < FIGURE_SMALL_REGION || box.height < FIGURE_SMALL_REGION;
    if (figureWarning) {
      figureWarning.hidden = !isSmall;
    }
    positionFigureActions(box);
  }

  function onFigurePointerCancel() {
    if (!figureState.dragging) {
      return;
    }
    resetFigureSelection();
  }

  function getFigureBox() {
    var x = Math.min(figureState.startX, figureState.endX);
    var y = Math.min(figureState.startY, figureState.endY);
    var w = Math.abs(figureState.endX - figureState.startX);
    var h = Math.abs(figureState.endY - figureState.startY);
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h),
    };
  }

  function updateFigureSelectionRect() {
    if (!figureSelection) {
      return;
    }
    var box = getFigureBox();
    figureSelection.style.left = `${box.x}px`;
    figureSelection.style.top = `${box.y}px`;
    figureSelection.style.width = `${box.width}px`;
    figureSelection.style.height = `${box.height}px`;
  }

  function positionFigureActions(box) {
    if (!figureActions) {
      return;
    }
    figureActions.hidden = false;

    var actionsH = figureActions.offsetHeight || 52;
    var actionsW = figureActions.offsetWidth || 340;
    var margin = 12;

    // Position below the selection; fall back above
    var wrapperRect = pageWrapper.getBoundingClientRect();
    var belowTop = wrapperRect.top + box.y + box.height + margin;
    var aboveTop = wrapperRect.top + box.y - actionsH - margin;
    var top;

    if (belowTop + actionsH <= window.innerHeight - margin) {
      top = belowTop;
    } else {
      top = Math.max(margin, aboveTop);
    }

    var left = wrapperRect.left + box.x + box.width / 2 - actionsW / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - actionsW - margin));

    figureActions.style.top = `${top}px`;
    figureActions.style.left = `${left}px`;

    if (figureWarning && !figureWarning.hidden) {
      var warningTop = top - 30;
      if (warningTop < margin) {
        warningTop = top + actionsH + 4;
      }
      figureWarning.style.top = `${warningTop}px`;
      figureWarning.style.left = `${left}px`;
    }
  }

  // ─── Figure Crop & Submit ────────────────────────────────

  function cropCanvasRegion(box) {
    // Map CSS-pixel box to the canvas buffer coordinates.
    var cssW = canvas.offsetWidth || canvas.clientWidth || 1;
    var cssH = canvas.offsetHeight || canvas.clientHeight || 1;
    var bufW = canvas.width;
    var bufH = canvas.height;

    var scaleX = bufW / cssW;
    var scaleY = bufH / cssH;

    var sx = Math.round(box.x * scaleX);
    var sy = Math.round(box.y * scaleY);
    var sw = Math.max(1, Math.round(box.width * scaleX));
    var sh = Math.max(1, Math.round(box.height * scaleY));

    // Clamp to buffer bounds
    sx = Math.max(0, Math.min(sx, bufW));
    sy = Math.max(0, Math.min(sy, bufH));
    if (sx + sw > bufW) {
      sw = bufW - sx;
    }
    if (sy + sh > bufH) {
      sh = bufH - sy;
    }

    if (sw < 1 || sh < 1) {
      return null;
    }

    var cropCanvas = document.createElement('canvas');
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    var ctx = cropCanvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    try {
      return cropCanvas.toDataURL('image/png');
    } catch (securityError) {
      // Canvas is tainted (cross-origin PDF without CORS headers).
      // We cannot extract pixel data — return null so the caller
      // falls back to sending the figure metadata without image data.
      return null;
    }
  }

  async function confirmFigureCapture() {
    if (figureState.phase === 'submitting') {
      return;
    }
    figureState.phase = 'submitting';

    // Disable action buttons during submission
    var btns = figureActions ? figureActions.querySelectorAll('button') : [];
    btns.forEach(btn => {
      btn.disabled = true;
    });

    var box = getFigureBox();
    var dataUrl = cropCanvasRegion(box);

    var figure = {
      figureId: Shared.createId('figure'),
      imageRef: undefined,
      thumbnailRef: dataUrl || undefined,
      imageData: dataUrl ? { mimeType: 'image/png', dataUrl } : undefined,
      captureViewport: undefined,
      caption: '',
      pageNumber: state.currentPage || undefined,
      boundingBox: box,
    };

    var paper = Object.assign(
      {},
      state.pdfPaperContext ||
        Shared.createPaperContext({
          title: state.filename || 'Untitled Paper',
          sourceType: Shared.SourceType.PDF,
          pdf: true,
        }),
      {
        pageNumber: state.currentPage || undefined,
      }
    );

    try {
      await chrome.runtime.sendMessage({
        type: Shared.MessageType.FIGURE_ACTION_REQUESTED,
        tabId: ownTabId,
        action: Shared.ActionType.EXPLAIN_FIGURE,
        figure,
        paper,
      });
    } catch (err) {
      showStatus(t('pv_figure_failed'));
    } finally {
      btns.forEach(btn => {
        btn.disabled = false;
      });
      cancelFigureCapture();
    }
  }

  // ─── Cleanup on Unload ─────────────────────────────────

  window.addEventListener('pagehide', () => {
    if (state.docHandle) {
      Loader.destroyDocument(state.docHandle);
    }
  });

  // ─── Boot ──────────────────────────────────────────────

  init();
})();
