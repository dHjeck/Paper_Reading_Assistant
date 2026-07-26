/**
 * Paper Reading Assistant — Content Script
 *
 * Owns selection detection, floating toolbar, and figure capture overlay.
 * Sends structured payloads to background via chrome.runtime.sendMessage.
 *
 * Spec references:
 *   - interaction-spec §5 (text selection), §6 (figure capture)
 *   - interaction-spec §10 (unsupported / edge cases)
 *   - interaction-spec §11 (accessibility / keyboard)
 *   - extension-design §5.1–§5.2 (selection rules, context rules)
 */
(function () {
  'use strict';

  var Shared = globalThis.PaperReadingAssistantShared;
  if (!Shared) {
    return;
  }

  // ─── Constants ───────────────────────────────────────────

  var DEBOUNCE_MS = 800;
  var EDGE_MARGIN = 8; // spec §5.3: at least 8 px from viewport edges
  var MIN_DRAG_SIZE = 20; // px — ignore micro-drags
  var SMALL_REGION_THRESHOLD = 80; // px — warn on very small crops (spec §6.7)
  var CAPTION_SEARCH_RANGE = 200; // px — search radius for nearby caption text

  // ─── State ───────────────────────────────────────────────

  // Toolbar
  var toolbar;
  var toolbarWarning;
  var toolbarState = Shared.ToolbarStatus.HIDDEN;

  // Overlay
  var overlay;
  var overlayHint;
  var overlaySelection;
  var overlayActions;
  var overlayWarning;
  var overlayState = Shared.FigureOverlayStatus.IDLE;

  // Selection
  var activeSelection = null;
  var dragState = null;
  var pendingHide = false;
  var lastActionSignature = null;
  var lastActionTime = 0;

  // ─── Init ────────────────────────────────────────────────

  init();

  function init() {
    createToolbar();
    createOverlay();
    bindEvents();
  }

  // ─── Event Binding ───────────────────────────────────────

  function bindEvents() {
    // Selection detection: mouse + keyboard
    document.addEventListener('mouseup', onSelectionEvent);
    document.addEventListener('keyup', onKeyUp);

    // Toolbar dismissal: mousedown outside starts pending hide
    document.addEventListener('mousedown', onDocumentMouseDown, true);

    // Scroll reposition (spec §5.3)
    document.addEventListener('scroll', onScroll, { passive: true });

    // Escape key (spec §11.1)
    document.addEventListener('keydown', onKeyDown, true);

    // Runtime messages from background / side panel
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }

  // ─── Selection Detection & Normalization ────────────────
  //
  // Flow:
  //   mousedown (outside toolbar) → set pendingHide
  //   mouseup → cancel pendingHide, evaluate selection
  //   if valid → show toolbar
  //   if invalid / empty → hide toolbar (executes pending hide)
  //
  // This eliminates the flicker caused by immediate hide-on-mousedown.

  function onDocumentMouseDown(event) {
    if (isOverlayActive()) {
      return;
    }

    // Click on toolbar: prevent default to keep text selection (spec §5.4)
    if (toolbar.contains(event.target)) {
      event.preventDefault();
      return;
    }

    // Click elsewhere: defer hide to next mouseup
    pendingHide = true;
  }

  function onSelectionEvent() {
    if (isOverlayActive()) {
      return;
    }

    // Cancel any pending hide from mousedown
    pendingHide = false;

    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      return;
    }

    var rawText = selection.toString();
    var text = Shared.normalizeSelectionText(rawText);

    // Empty or whitespace-only (spec §5.1)
    if (!text) {
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      return;
    }

    // Below minimum length (spec §5.2)
    if (text.length < Shared.MIN_SELECTION_LENGTH) {
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      return;
    }

    var range = selection.getRangeAt(0);
    var rect = range.getBoundingClientRect();

    // Selection rect might be zero-size in some edge cases
    if (rect.width === 0 && rect.height === 0) {
      setToolbarState(Shared.ToolbarStatus.HIDDEN);
      return;
    }

    // Selection too long (spec §5.2)
    if (text.length > Shared.MAX_SELECTION_LENGTH) {
      activeSelection = null;
      showToolbarWarning('Selection is too long. Please select a smaller section.');
      showToolbar(rect, true);
      return;
    }

    // Valid selection
    activeSelection = {
      selectionId: Shared.createId('selection'),
      text,
      context: extractNearbyContext(range),
      pageNumber: detectPageNumber() || undefined,
    };

    hideToolbarWarning();
    showToolbar(rect, false);
  }

  function onKeyUp(event) {
    // Shift+arrow keyboard selection (spec §11.1 keyboard support)
    if (event.shiftKey && typeof event.key === 'string' && event.key.indexOf('Arrow') === 0) {
      onSelectionEvent();
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') {
      return;
    }

    // Escape cancels figure overlay (spec §11.1)
    if (isOverlayActive()) {
      event.stopPropagation();
      event.preventDefault();
      cancelFigureSelection();
      return;
    }

    // Escape closes toolbar (spec §11.1)
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

    // Reposition toolbar (spec §5.3)
    positionToolbar(rect);
  }

  // ─── Toolbar UI ─────────────────────────────────────────

  function createToolbar() {
    toolbar = document.createElement('div');
    toolbar.className = 'pra-toolbar';
    toolbar.dataset.visible = 'false';
    toolbar.dataset.state = Shared.ToolbarStatus.HIDDEN;

    // Prevent mousedown on toolbar from stealing selection (spec §5.4)
    toolbar.addEventListener('mousedown', event => {
      event.preventDefault();
    });

    var actions = [
      [Shared.ActionType.EXPLAIN, 'Explain'],
      [Shared.ActionType.SIMPLIFY, 'Simplify'],
      [Shared.ActionType.DEFINE, 'Define'],
      ['save', 'Save'],
    ];

    actions.forEach(item => {
      var action = item[0];
      var label = item[1];

      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.textContent = label;

      button.addEventListener('click', () => {
        if (action === 'save') {
          void saveRawSelection();
        } else {
          void submitTextAction(action);
        }
      });

      toolbar.appendChild(button);
    });

    // Inline warning for "selection too long" etc. (spec §5.2)
    toolbarWarning = document.createElement('span');
    toolbarWarning.className = 'pra-toolbar__warning';
    toolbarWarning.setAttribute('role', 'status');
    toolbarWarning.hidden = true;
    toolbar.appendChild(toolbarWarning);

    document.documentElement.appendChild(toolbar);
  }

  function showToolbar(rect, isWarning) {
    positionToolbar(rect);
    setToolbarState(isWarning ? Shared.ToolbarStatus.DISABLED : Shared.ToolbarStatus.VISIBLE);
  }

  function positionToolbar(rect) {
    var scrollX = window.scrollX;
    var scrollY = window.scrollY;
    var toolbarW = toolbar.offsetWidth || 300;
    var toolbarH = toolbar.offsetHeight || 44;

    // Prefer above selection (spec §5.3)
    var aboveTop = scrollY + rect.top - toolbarH - EDGE_MARGIN;
    var belowTop = scrollY + rect.bottom + EDGE_MARGIN;
    var top;

    if (aboveTop >= scrollY + EDGE_MARGIN) {
      top = aboveTop;
    } else {
      top = belowTop;
    }

    // Clamp: keep within viewport vertically
    var maxTop = scrollY + window.innerHeight - toolbarH - EDGE_MARGIN;
    if (top > maxTop) {
      top = maxTop;
    }
    if (top < scrollY + EDGE_MARGIN) {
      top = scrollY + EDGE_MARGIN;
    }

    // Horizontal: center on selection, clamp to viewport (spec §5.3)
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

  function setToolbarState(state) {
    toolbarState = state;
    toolbar.dataset.state = state;

    var visible =
      state === Shared.ToolbarStatus.VISIBLE ||
      state === Shared.ToolbarStatus.DISABLED ||
      state === Shared.ToolbarStatus.BUSY;
    toolbar.dataset.visible = visible ? 'true' : 'false';
  }

  function isToolbarVisible() {
    return toolbar.dataset.visible === 'true';
  }

  function setToolbarBusy(busy) {
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
    toolbarWarning.textContent = message;
    toolbarWarning.hidden = false;
    var buttons = toolbar.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.style.display = 'none';
    });
  }

  function hideToolbarWarning() {
    toolbarWarning.hidden = true;
    var buttons = toolbar.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.style.display = '';
    });
  }

  // ─── Text Actions ───────────────────────────────────────

  async function submitTextAction(action) {
    if (!activeSelection) {
      return;
    }

    // Debounce duplicate submissions (spec §10.3)
    var sig = `${action}:${activeSelection.selectionId}`;
    var now = Date.now();
    if (sig === lastActionSignature && now - lastActionTime < DEBOUNCE_MS) {
      return;
    }
    lastActionSignature = sig;
    lastActionTime = now;

    setToolbarBusy(true);

    var paper = Shared.createPaperContext({
      title: document.title || 'Untitled Paper',
      url: location.href,
      sourceType: Shared.inferSourceType(location.href),
      pageNumber: activeSelection.pageNumber || undefined,
    });

    try {
      await chrome.runtime.sendMessage({
        type: Shared.MessageType.TEXT_ACTION_REQUESTED,
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

  async function saveRawSelection() {
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

  // ─── Context Extraction ──────────────────────────────────
  //
  // Best-effort extraction of surrounding text for better LLM context.
  // Walks up to the nearest block-level element.

  function extractNearbyContext(range) {
    var container = range.commonAncestorContainer;
    var element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;

    if (!element) {
      return '';
    }

    var block = findContainingBlock(element);
    var source = block || element;
    var text = Shared.normalizeSelectionText(source.textContent || '');

    return text.slice(0, Shared.MAX_SELECTION_LENGTH);
  }

  function findContainingBlock(element) {
    var blockTags = {
      P: true,
      DIV: true,
      LI: true,
      BLOCKQUOTE: true,
      SECTION: true,
      ARTICLE: true,
      TD: true,
      DD: true,
      DT: true,
    };

    var node = element;
    while (node && node !== document.body) {
      if (blockTags[node.tagName]) {
        return node;
      }
      node = node.parentElement;
    }
    return element;
  }

  // ─── Page Number Detection ───────────────────────────────
  //
  // Best-effort: checks URL fragment, DOM data attributes, and
  // common PDF viewer page indicators. Returns null if not found.

  function detectPageNumber() {
    var url = location.href;

    // URL fragment: #page=N (common in PDF viewers)
    var pageMatch = url.match(/[#&?]page=(\d+)/);
    if (pageMatch) {
      var pageNum = parseInt(pageMatch[1], 10);
      if (pageNum > 0) {
        return pageNum;
      }
    }

    // DOM: elements with page-related data attributes
    var pageElements = document.querySelectorAll(
      '[data-page-number], [data-page], [data-pagenumber]'
    );

    var bestMatch = null;
    var bestVisibility = 0;

    pageElements.forEach(el => {
      var num =
        el.getAttribute('data-page-number') ||
        el.getAttribute('data-page') ||
        el.getAttribute('data-pagenumber');
      if (!num) {
        return;
      }

      var parsed = parseInt(num, 10);
      if (parsed <= 0) {
        return;
      }

      // Prefer elements that are visible in the viewport
      var rect = el.getBoundingClientRect();
      var visibility = 0;
      if (rect.top >= 0 && rect.top <= window.innerHeight) {
        visibility = window.innerHeight - rect.top;
      }
      if (rect.bottom >= 0 && rect.bottom <= window.innerHeight) {
        visibility = Math.max(visibility, rect.bottom);
      }

      if (visibility > bestVisibility) {
        bestVisibility = visibility;
        bestMatch = parsed;
      }
    });

    if (bestMatch) {
      return bestMatch;
    }

    return null;
  }

  // ─── Page Support Detection ─────────────────────────────

  function isPageSupported() {
    var url = location.href;

    // Chrome internal pages
    if (
      url.indexOf('chrome://') === 0 ||
      url.indexOf('chrome-extension://') === 0 ||
      url.indexOf('edge://') === 0 ||
      url.indexOf('about:') === 0
    ) {
      return false;
    }

    return true;
  }

  // ─── Figure Capture Overlay ──────────────────────────────
  //
  // State machine (spec §6.6):
  //   idle → selecting → review → submitting → idle
  //                          ↓              ↓
  //                       canceled → idle

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'pra-overlay';
    overlay.dataset.visible = 'false';
    overlay.dataset.state = Shared.FigureOverlayStatus.IDLE;

    // Top instruction hint (spec §6.3)
    overlayHint = document.createElement('div');
    overlayHint.className = 'pra-overlay__hint';
    overlayHint.textContent = 'Drag to select a figure region';
    overlay.appendChild(overlayHint);

    // Cancel button in hint area (spec §6.5)
    var hintCancel = document.createElement('button');
    hintCancel.type = 'button';
    hintCancel.className = 'pra-overlay__hint-cancel';
    hintCancel.textContent = 'Cancel';
    hintCancel.addEventListener('click', event => {
      event.stopPropagation();
      cancelFigureSelection();
    });
    overlayHint.appendChild(hintCancel);

    // Selection rectangle (spec §6.4)
    overlaySelection = document.createElement('div');
    overlaySelection.className = 'pra-overlay__selection';
    overlaySelection.hidden = true;
    overlay.appendChild(overlaySelection);

    // Small region warning (spec §6.7)
    overlayWarning = document.createElement('div');
    overlayWarning.className = 'pra-overlay__warning';
    overlayWarning.hidden = true;
    overlayWarning.textContent = 'Region is quite small — results may be less accurate.';
    overlayWarning.setAttribute('role', 'status');
    overlay.appendChild(overlayWarning);

    // Confirmation actions (spec §6.5)
    overlayActions = document.createElement('div');
    overlayActions.className = 'pra-overlay__actions';
    overlayActions.hidden = true;

    var useButton = document.createElement('button');
    useButton.type = 'button';
    useButton.textContent = 'Use This Region';
    useButton.dataset.primary = 'true';
    useButton.addEventListener('click', event => {
      event.stopPropagation();
      void confirmFigureSelection();
    });

    var againButton = document.createElement('button');
    againButton.type = 'button';
    againButton.textContent = 'Select Again';
    againButton.addEventListener('click', event => {
      event.stopPropagation();
      resetOverlaySelection(true);
    });

    var cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', event => {
      event.stopPropagation();
      cancelFigureSelection();
    });

    overlayActions.appendChild(useButton);
    overlayActions.appendChild(againButton);
    overlayActions.appendChild(cancelButton);
    overlay.appendChild(overlayActions);

    // Pointer events for drag selection (spec §6.4)
    overlay.addEventListener('pointerdown', onOverlayPointerDown);
    overlay.addEventListener('pointermove', onOverlayPointerMove);
    overlay.addEventListener('pointerup', onOverlayPointerUp);
    overlay.addEventListener('pointercancel', onOverlayPointerCancel);

    // Prevent context menu during capture
    overlay.addEventListener('contextmenu', event => {
      event.preventDefault();
    });

    document.documentElement.appendChild(overlay);
  }

  function enterFigureSelectionMode() {
    if (!isPageSupported()) {
      // Unsupported page: notify background (spec §10.1)
      void chrome.runtime.sendMessage({
        type: Shared.MessageType.TEXT_ACTION_REQUESTED,
        action: Shared.ActionType.EXPLAIN,
        selection: {
          selectionId: Shared.createId('selection'),
          text: '',
          context: '',
          pageNumber: undefined,
        },
        paper: Shared.createPaperContext({
          title: document.title,
          url: location.href,
          sourceType: Shared.inferSourceType(location.href),
        }),
        unsupported: true,
      });
      return;
    }

    setOverlayState(Shared.FigureOverlayStatus.IDLE);
    overlay.dataset.visible = 'true';
    resetOverlaySelection(true);
  }

  function exitFigureSelectionMode() {
    overlay.dataset.visible = 'false';
    setOverlayState(Shared.FigureOverlayStatus.IDLE);
    dragState = null;
    resetOverlaySelection(false);
  }

  function cancelFigureSelection() {
    setOverlayState(Shared.FigureOverlayStatus.CANCELED);
    // Brief canceled state before returning to idle (spec §6.6)
    setTimeout(exitFigureSelectionMode, 0);
  }

  function setOverlayState(state) {
    overlayState = state;
    overlay.dataset.state = state;
  }

  function isOverlayActive() {
    return overlay.dataset.visible === 'true';
  }

  function resetOverlaySelection(keepMode) {
    dragState = null;
    overlaySelection.hidden = true;
    overlayActions.hidden = true;
    overlayWarning.hidden = true;
    overlaySelection.style.width = '0';
    overlaySelection.style.height = '0';

    if (keepMode) {
      setOverlayState(Shared.FigureOverlayStatus.IDLE);
      overlayHint.hidden = false;
    }
  }

  // ─── Overlay Drag Handlers ───────────────────────────────

  function onOverlayPointerDown(event) {
    // Only start drag from the overlay background, not child elements
    if (event.target !== overlay) {
      return;
    }
    if (overlayState === Shared.FigureOverlayStatus.SUBMITTING) {
      return;
    }

    event.preventDefault();

    setOverlayState(Shared.FigureOverlayStatus.SELECTING);

    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      endX: event.clientX,
      endY: event.clientY,
    };

    overlaySelection.hidden = false;
    overlayActions.hidden = true;
    overlayWarning.hidden = true;
    overlayHint.hidden = true;
    updateOverlaySelection();
  }

  function onOverlayPointerMove(event) {
    if (!dragState) {
      return;
    }
    if (overlayState !== Shared.FigureOverlayStatus.SELECTING) {
      return;
    }

    dragState.endX = event.clientX;
    dragState.endY = event.clientY;
    updateOverlaySelection();
  }

  function onOverlayPointerUp(event) {
    if (!dragState) {
      return;
    }
    if (overlayState !== Shared.FigureOverlayStatus.SELECTING) {
      return;
    }

    dragState.endX = event.clientX;
    dragState.endY = event.clientY;
    updateOverlaySelection();

    var box = getNormalizedBox(dragState);

    // Ignore micro-drags (spec §6.4 — finalize tentative crop)
    if (box.width < MIN_DRAG_SIZE || box.height < MIN_DRAG_SIZE) {
      resetOverlaySelection(true);
      return;
    }

    // Transition to review state (spec §6.6)
    setOverlayState(Shared.FigureOverlayStatus.REVIEW);

    // Warn on small crop (spec §6.7)
    var isSmall = box.width < SMALL_REGION_THRESHOLD || box.height < SMALL_REGION_THRESHOLD;
    overlayWarning.hidden = !isSmall;

    positionOverlayControls(box);
  }

  function onOverlayPointerCancel() {
    if (!dragState) {
      return;
    }
    resetOverlaySelection(true);
  }

  // ─── Overlay Positioning ─────────────────────────────────

  function positionOverlayControls(box) {
    var margin = 12;
    overlayActions.hidden = false;

    var actionsH = overlayActions.offsetHeight || 52;
    var actionsW = overlayActions.offsetWidth || 340;

    // Position actions below selection; fall back above (spec §6.5)
    var belowTop = box.y + box.height + margin;
    var aboveTop = box.y - actionsH - margin;
    var top;

    if (belowTop + actionsH <= window.innerHeight - margin) {
      top = belowTop;
    } else {
      top = Math.max(margin, aboveTop);
    }

    // Center horizontally on selection, clamp to viewport
    var left = box.x + box.width / 2 - actionsW / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - actionsW - margin));

    overlayActions.style.top = `${top}px`;
    overlayActions.style.left = `${left}px`;

    // Position small-region warning above actions
    if (!overlayWarning.hidden) {
      var warningTop = top - 30;
      if (warningTop < margin) {
        warningTop = top + actionsH + 4;
      }
      overlayWarning.style.top = `${warningTop}px`;
      overlayWarning.style.left = `${left}px`;
    }
  }

  function updateOverlaySelection() {
    var box = getNormalizedBox(dragState);
    overlaySelection.style.left = `${box.x}px`;
    overlaySelection.style.top = `${box.y}px`;
    overlaySelection.style.width = `${box.width}px`;
    overlaySelection.style.height = `${box.height}px`;
  }

  // ─── Bounding Box Calculation ────────────────────────────
  //
  // Returns viewport-relative coordinates clamped to the viewport.
  // Viewport coords are correct for captureVisibleTab.

  function getNormalizedBox(state) {
    if (!state) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    var rawX = Math.min(state.startX, state.endX);
    var rawY = Math.min(state.startY, state.endY);
    var rawW = Math.abs(state.endX - state.startX);
    var rawH = Math.abs(state.endY - state.startY);

    // Clamp to viewport bounds
    var x = Math.max(0, rawX);
    var y = Math.max(0, rawY);
    var width = Math.min(rawW, window.innerWidth - x);
    var height = Math.min(rawH, window.innerHeight - y);

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  function createCaptureViewport() {
    return {
      width: Math.max(
        1,
        Math.round(window.innerWidth || document.documentElement.clientWidth || 0)
      ),
      height: Math.max(
        1,
        Math.round(window.innerHeight || document.documentElement.clientHeight || 0)
      ),
      devicePixelRatio: Math.max(1, window.devicePixelRatio || 1),
    };
  }

  // ─── Figure Confirmation ─────────────────────────────────

  async function confirmFigureSelection() {
    if (!dragState) {
      return;
    }
    if (overlayState === Shared.FigureOverlayStatus.SUBMITTING) {
      return;
    }

    setOverlayState(Shared.FigureOverlayStatus.SUBMITTING);

    // Disable action buttons during submission
    var buttons = overlayActions.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.disabled = true;
    });

    var box = getNormalizedBox(dragState);
    var caption = extractFigureCaption(box);
    var pageNumber = detectPageNumber();

    var paper = Shared.createPaperContext({
      title: document.title || 'Untitled Paper',
      url: location.href,
      sourceType: Shared.inferSourceType(location.href),
      pageNumber: pageNumber || undefined,
    });

    var figure = {
      figureId: Shared.createId('figure'),
      imageRef: undefined,
      thumbnailRef: undefined,
      imageData: undefined,
      captureViewport: createCaptureViewport(),
      caption,
      pageNumber: pageNumber || undefined,
      boundingBox: box,
    };

    try {
      await chrome.runtime.sendMessage({
        type: Shared.MessageType.FIGURE_ACTION_REQUESTED,
        action: Shared.ActionType.EXPLAIN_FIGURE,
        figure,
        paper,
      });
    } catch (err) {
      // Swallow — background handles error display
    } finally {
      buttons.forEach(btn => {
        btn.disabled = false;
      });
      exitFigureSelectionMode();
    }
  }

  // ─── Caption Extraction ──────────────────────────────────
  //
  // Best-effort: searches for text near the selection that starts
  // with "Figure", "Fig.", "Table", etc. (extension-design §5.2)

  function extractFigureCaption(box) {
    var docX = box.x + window.scrollX;
    var docY = box.y + window.scrollY;
    var docRight = docX + box.width;

    var captionPattern = /^(figure|fig\.?|table|tab\.?|chart|diagram|scheme)\s*\d+/i;

    var candidates = document.querySelectorAll('p, span, div, caption, figcaption, li, td');

    var bestCaption = '';
    var bestDistance = CAPTION_SEARCH_RANGE;

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var rect = el.getBoundingClientRect();

      // Skip elements with no visible area
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }

      var elDocY = rect.top + window.scrollY;
      var elDocX = rect.left + window.scrollX;
      var elDocRight = elDocX + rect.width;

      // Check vertical proximity: below or above selection
      var distBelow = elDocY - (docY + box.height);
      var distAbove = docY - elDocY - rect.height;
      var dist = -1;

      if (distBelow >= 0 && distBelow < CAPTION_SEARCH_RANGE) {
        dist = distBelow;
      } else if (distAbove >= 0 && distAbove < CAPTION_SEARCH_RANGE) {
        dist = distAbove;
      }

      if (dist < 0) {
        continue;
      }

      // Check horizontal overlap
      if (elDocRight < docX - 50 || elDocX > docRight + 50) {
        continue;
      }

      var text = Shared.normalizeSelectionText(el.textContent || '');
      if (captionPattern.test(text)) {
        if (dist < bestDistance) {
          bestDistance = dist;
          bestCaption = text.slice(0, 500);
        }
      }
    }

    return bestCaption;
  }

  // ─── Page Content Extraction (Summarize feature) ─────────

  var SEMANTIC_SELECTORS = ['article', 'main', "[role='main']"];
  var CONTENT_SELECTORS = [
    '.article-body',
    '.article-content',
    '.article__body',
    '.article__content',
    '.post-content',
    '.post-body',
    '.entry-content',
    '.content-body',
    '.main-content',
    '#main-content',
    '#article-body',
    '#content',
    '.pmc-article-body',
    '.arxiv-content',
    '.NLM_p',
    '.ltx_document',
  ];
  var NOISE_SELECTORS = [
    'script',
    'style',
    'noscript',
    'nav',
    'header',
    'footer',
    'aside',
    'iframe',
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[role='complementary']",
    '.sidebar',
    '#sidebar',
    '.comments',
    '#comments',
    '.related-posts',
    '.recommended',
    '.ads',
    '.advertisement',
    '[data-ad]',
    '.cookie-banner',
    '.cookie-consent',
  ];
  var BLOCK_TAGS = {
    P: 1,
    DIV: 1,
    LI: 1,
    H1: 1,
    H2: 1,
    H3: 1,
    H4: 1,
    H5: 1,
    H6: 1,
    BLOCKQUOTE: 1,
    PRE: 1,
    BR: 1,
    TR: 1,
    TD: 1,
    TH: 1,
    DT: 1,
    DD: 1,
    SECTION: 1,
    ARTICLE: 1,
  };

  function removeNoiseNodes(root) {
    for (var i = 0; i < NOISE_SELECTORS.length; i++) {
      var nodes = root.querySelectorAll(NOISE_SELECTORS[i]);
      for (var j = nodes.length - 1; j >= 0; j--) {
        nodes[j].parentNode.removeChild(nodes[j]);
      }
    }
  }

  function insertBlockSeparators(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    var node;
    while ((node = walker.nextNode())) {
      var tag = node.tagName;
      if (BLOCK_TAGS[tag]) {
        node.parentNode.insertBefore(document.createTextNode('\n'), node);
        if (tag === 'LI') {
          node.insertBefore(document.createTextNode('\u2022 '), node.firstChild);
        } else if (/^H[1-6]$/.test(tag)) {
          var level = parseInt(tag.charAt(1), 10);
          var prefix = '';
          for (var h = 0; h < level; h++) {
            prefix += '#';
          }
          node.insertBefore(document.createTextNode(`${prefix} `), node.firstChild);
        }
      }
    }
  }

  function extractPageContent() {
    var maxLen = Shared.MAX_FULLTEXT_LENGTH || 50000;
    var maxHtmlLen = Shared.MAX_HTML_LENGTH || 2 * 1024 * 1024;
    var minChars = Shared.MIN_FULLTEXT_CHARS || 200;

    function tryExtract(root) {
      var clone = root.cloneNode(true);
      removeNoiseNodes(clone);
      insertBlockSeparators(clone);
      var text = Shared.normalizeSelectionText(clone.textContent || '');
      var html = clone.outerHTML || clone.innerHTML || '';
      return {
        text,
        html: html.slice(0, maxHtmlLen),
      };
    }

    function buildHtmlDocument(extracted, extractionMethod) {
      return {
        kind: 'html',
        html: extracted.html,
        fullText: extracted.text.slice(0, maxLen),
        charCount: extracted.text.length,
        extractionMethod,
      };
    }

    // Priority 1: semantic tags
    for (var i = 0; i < SEMANTIC_SELECTORS.length; i++) {
      var el = document.querySelector(SEMANTIC_SELECTORS[i]);
      if (el) {
        var semanticContent = tryExtract(el);
        if (semanticContent.text.length >= minChars) {
          return {
            ok: true,
            document: buildHtmlDocument(semanticContent, 'semantic'),
          };
        }
      }
    }

    // Priority 2: common CSS selectors
    for (var j = 0; j < CONTENT_SELECTORS.length; j++) {
      var cel = document.querySelector(CONTENT_SELECTORS[j]);
      if (cel) {
        var classContent = tryExtract(cel);
        if (classContent.text.length >= minChars) {
          return {
            ok: true,
            document: buildHtmlDocument(classContent, 'class'),
          };
        }
      }
    }

    // Priority 3: body fallback
    if (document.body) {
      var bodyContent = tryExtract(document.body);
      if (bodyContent.text.length > 0) {
        var result = {
          ok: true,
          document: buildHtmlDocument(bodyContent, 'body'),
        };
        if (bodyContent.text.length < minChars) {
          result.warning = {
            code: 'SHORT_CONTENT',
            message: `Extracted content is very short (${bodyContent.text.length} chars).`,
          };
        }
        return result;
      }
    }

    return { ok: false, error: 'Unable to extract page content from this page.' };
  }

  // ─── Runtime Message Handler ─────────────────────────────

  function onRuntimeMessage(message, sender, sendResponse) {
    if (!message || !message.type) {
      return;
    }

    if (message.type === Shared.MessageType.FIGURE_SELECTION_MODE_REQUESTED) {
      enterFigureSelectionMode();
      return;
    }

    if (message.type === Shared.MessageType.EXTRACT_PAGE_CONTENT) {
      var result = extractPageContent();
      sendResponse(result);
      return;
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────

  function cleanup() {
    setToolbarState(Shared.ToolbarStatus.HIDDEN);
    exitFigureSelectionMode();
    pendingHide = false;
    activeSelection = null;
    lastActionSignature = null;
  }
})();
