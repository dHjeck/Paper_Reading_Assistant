/**
 * Paper Reading Assistant — Shared Contracts
 *
 * Runtime constants, message types, state factories, and mock response
 * generators.  Every value in this file must stay 1:1 aligned with the
 * type declarations in types.d.ts.
 *
 * Spec references:
 *   - docs/paper-reading-assistant-side-panel-state-spec.md   (§6 state model)
 *   - docs/paper-reading-assistant-backend-api-spec.md         (§5–§11 API shapes)
 *   - docs/paper-reading-assistant-interaction-spec.md         (§5.5, §6.6 UI states)
 *
 * Loaded via:
 *   - manifest.json content_scripts  (content script)
 *   - background.js importScripts    (service worker)
 *   - <script> tag in sidepanel.html and popup.html
 */
(function () {
  // ─── App-level Constants ─────────────────────────────────

  const APP_NAMESPACE = 'paperReadingAssistant';
  const STORAGE_KEY = `${APP_NAMESPACE}.appState`;
  const CONFIG_STORAGE_KEY = `${APP_NAMESPACE}.apiConfig`;
  const MAX_SELECTION_LENGTH = 1200;
  const MIN_SELECTION_LENGTH = 2;
  const MAX_FULLTEXT_LENGTH = 50000;
  const MAX_HTML_LENGTH = 2 * 1024 * 1024;
  const MIN_FULLTEXT_CHARS = 200;
  const MAX_PDF_FILE_SIZE = 30 * 1024 * 1024;
  const CLIENT_INFO = {
    platform: 'chrome-extension',
    version: '0.1.0',
  };

  // ─── Enum Constants ───────────────────────────────────────
  //
  // These mirror the union types in types.d.ts.  Other modules
  // should reference Shared.Tabs.CURRENT instead of the raw
  // string "current" so that a rename only touches one place.

  const Tabs = {
    CURRENT: 'current',
    SAVED: 'saved',
    HISTORY: 'history',
  };

  const BackendStatus = {
    UNKNOWN: 'unknown',
    AVAILABLE: 'available',
    DEGRADED: 'degraded',
    OFFLINE: 'offline',
  };

  const WorkspaceStatus = {
    EMPTY: 'empty',
    LOADING: 'loading',
    SUCCESS: 'success',
    PARTIAL_SUCCESS: 'partial_success',
    ERROR: 'error',
  };

  const ResultStatus = {
    SUCCESS: 'success',
    PARTIAL_SUCCESS: 'partial_success',
    ERROR: 'error',
  };

  const ActionType = {
    EXPLAIN: 'explain',
    SIMPLIFY: 'simplify',
    DEFINE: 'define',
    EXPLAIN_FIGURE: 'explain_figure',
    FOLLOW_UP: 'follow_up',
    SUMMARIZE: 'summarize',
  };

  const SourceType = {
    PDF: 'pdf',
    HTML: 'html',
  };

  const ResultSourceType = {
    TEXT: 'text',
    FIGURE: 'figure',
    DOCUMENT: 'document',
  };

  const SaveFilter = {
    ALL: 'all',
    NOTE: 'note',
    FLASHCARD: 'flashcard',
    QUESTION: 'question',
  };

  /** interaction-spec §5.5 — floating toolbar states */
  const ToolbarStatus = {
    HIDDEN: 'hidden',
    VISIBLE: 'visible',
    DISABLED: 'disabled',
    BUSY: 'busy',
  };

  /** interaction-spec §6.6 — figure capture overlay states */
  const FigureOverlayStatus = {
    IDLE: 'idle',
    SELECTING: 'selecting',
    REVIEW: 'review',
    SUBMITTING: 'submitting',
    CANCELED: 'canceled',
  };

  /** side-panel-state-spec §9.1 — follow-up composer states */
  const FollowUpStatus = {
    IDLE: 'idle',
    EDITING: 'editing',
    SUBMITTING: 'submitting',
    SUCCESS: 'success',
    ERROR: 'error',
  };

  /** backend-api-spec §10.2 — error codes */
  const ErrorCode = {
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    INVALID_REQUEST: 'INVALID_REQUEST',
    INVALID_SELECTION: 'INVALID_SELECTION',
    IMAGE_TOO_SMALL: 'IMAGE_TOO_SMALL',
    UNSUPPORTED_PAGE: 'UNSUPPORTED_PAGE',
    RATE_LIMITED: 'RATE_LIMITED',
    UPSTREAM_MODEL_ERROR: 'UPSTREAM_MODEL_ERROR',
    TIMEOUT: 'TIMEOUT',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  };

  // ─── Runtime Message Types ───────────────────────────────
  //
  // These are chrome.runtime.sendMessage type strings for
  // cross-context communication (content ↔ background ↔ panel).
  // They are distinct from the state-machine events defined in
  // side-panel-state-spec §7–§9, which are internal to the panel
  // store and dispatched as in-process actions, not runtime messages.

  const MessageType = {
    PING: 'PRA/PING',
    GET_APP_STATE: 'PRA/GET_APP_STATE',
    REFRESH_ACTIVE_TAB: 'PRA/REFRESH_ACTIVE_TAB',
    STATE_UPDATED: 'PRA/STATE_UPDATED',
    OPEN_SIDE_PANEL: 'PRA/OPEN_SIDE_PANEL',
    START_FIGURE_SELECTION: 'PRA/START_FIGURE_SELECTION',
    FIGURE_SELECTION_MODE_REQUESTED: 'PRA/FIGURE_SELECTION_MODE_REQUESTED',
    TEXT_ACTION_REQUESTED: 'PRA/TEXT_ACTION_REQUESTED',
    FIGURE_ACTION_REQUESTED: 'PRA/FIGURE_ACTION_REQUESTED',
    FOLLOW_UP_REQUESTED: 'PRA/FOLLOW_UP_REQUESTED',
    SAVE_ITEM_REQUESTED: 'PRA/SAVE_ITEM_REQUESTED',
    REOPEN_HISTORY: 'PRA/REOPEN_HISTORY',
    RETRY_REQUESTED: 'PRA/RETRY_REQUESTED',
    SET_SAVED_FILTER: 'PRA/SET_SAVED_FILTER',
    SWITCH_PANEL_TAB: 'PRA/SWITCH_PANEL_TAB',
    CHECK_HEALTH: 'PRA/CHECK_HEALTH',
    SUMMARY_ACTION_REQUESTED: 'PRA/SUMMARY_ACTION_REQUESTED',
    EXTRACT_PAGE_CONTENT: 'PRA/EXTRACT_PAGE_CONTENT',
  };

  // ─── Utility Functions ───────────────────────────────────

  function createId(prefix) {
    var suffix;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      // crypto.randomUUID provides 122 bits of entropy — collision-proof.
      suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    } else {
      // Fallback for very old environments (pre-Chrome 92)
      suffix = Math.random().toString(36).slice(2, 10);
    }
    return `${prefix}_${suffix}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function inferSourceType(url) {
    return (url || '').toLowerCase().indexOf('.pdf') !== -1 ? SourceType.PDF : SourceType.HTML;
  }

  function normalizePaperUrl(url) {
    return typeof url === 'string' ? url.split('#')[0].trim() : '';
  }

  /**
   * Normalize a remote PDF source URL.  Strips fragment and trailing
   * whitespace.  Returns empty string for non-http(s) schemes so that
   * blob: / data: / extension URLs never produce a misleading paperId.
   */
  function normalizePdfSourceUrl(url) {
    var normalized = normalizePaperUrl(url);
    if (!normalized) {
      return '';
    }
    if (normalized.indexOf('http://') === 0 || normalized.indexOf('https://') === 0) {
      return normalized;
    }
    return '';
  }

  /**
   * Local PDFs do not have a real remote URL, but the backend request
   * schema requires a non-empty http(s) URI. Use a synthetic, never-fetched
   * URL as metadata so local PDF requests stay schema-compliant.
   */
  function buildLocalPdfUrl(filename, pdfFileSize) {
    var safeName = filename ? encodeURIComponent(filename) : 'untitled.pdf';
    var size = Number.isFinite(Number(pdfFileSize)) ? String(pdfFileSize) : '0';
    return `https://local.paper-reading-assistant.invalid/${safeName}?size=${size}`;
  }

  function createStablePaperId(url) {
    var normalized = normalizePaperUrl(url);
    if (!normalized) {
      return '';
    }

    var hash = 5381;
    for (var i = 0; i < normalized.length; i += 1) {
      hash = ((hash << 5) + hash + normalized.charCodeAt(i)) >>> 0;
    }

    return `paper_${hash.toString(36)}`;
  }

  /**
   * Build a PaperContext for a PDF document.
   *
   * Identity rules:
   *   - Remote PDF (pdfSourceUrl is http/https): paperId = hash of URL
   *   - Local PDF  (filename + pdfFileSize):     paperId = hash of "pdf-local:<name>:<size>"
   *   - Fallback:                                paperId = random id (per-session)
   *
   * The caller is responsible for providing the correct source metadata.
   * pdf-viewer.js passes {title: filename, pdfSourceUrl: urlParam, filename, pdfFileSize}.
   */
  function buildPdfPaperContext(input) {
    var pdfSourceUrl = normalizePdfSourceUrl(input.pdfSourceUrl || '');
    var filename = typeof input.filename === 'string' ? input.filename.trim() : '';
    var title = input.title || inferPdfTitle(pdfSourceUrl, filename) || 'Untitled Paper';
    var url = pdfSourceUrl;
    var paperId;

    if (pdfSourceUrl) {
      // Strip query string before hashing so that session tokens,
      // access keys, and other volatile parameters don't produce
      // unstable paperIds for the same PDF.  The url field below
      // still retains the full URL for display/navigation.
      var urlForId = pdfSourceUrl.split('?')[0];
      paperId = createStablePaperId(urlForId);
    } else if (filename) {
      var size = input.pdfFileSize ? String(input.pdfFileSize) : '0';
      paperId = createStablePaperId(`pdf-local:${filename}:${size}`);
      url = buildLocalPdfUrl(filename, input.pdfFileSize);
    } else {
      paperId = createId('paper');
      url = buildLocalPdfUrl('untitled.pdf', 0);
    }

    return {
      paperId,
      title,
      url,
      sourceType: SourceType.PDF,
      pageNumber: input.pageNumber || undefined,
      authors: input.authors || [],
    };
  }

  /**
   * Infer a display title for a PDF from its source URL or filename.
   * URL: extracts the last path segment and strips the .pdf extension.
   * Filename: used as-is.
   */
  function inferPdfTitle(sourceUrl, filename) {
    if (sourceUrl) {
      try {
        var pathname = sourceUrl.split('?')[0];
        var segments = pathname.split('/');
        var last = segments[segments.length - 1];
        if (last && last.toLowerCase().indexOf('.pdf') === last.length - 4 && last.length > 4) {
          return decodeURIComponent(last.slice(0, -4));
        }
        if (last) {
          return decodeURIComponent(last);
        }
      } catch (e) {
        // fall through to filename
      }
    }
    return filename || '';
  }

  function normalizeSelectionText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  // ─── State Factory Functions ─────────────────────────────
  //
  // Aligned with side-panel-state-spec §6.1 PanelState shape.

  function createEmptyState() {
    return {
      activeTab: Tabs.CURRENT,
      backendStatus: BackendStatus.UNKNOWN,
      currentPaper: null,
      currentWorkspace: {
        status: WorkspaceStatus.EMPTY,
        activeThread: null,
        lastAction: null,
        pendingRequest: null,
        error: null,
      },
      savedWorkspace: {
        filter: SaveFilter.ALL,
        items: [],
      },
      historyWorkspace: {
        items: [],
      },
      ui: {
        toast: null,
        confirmMenu: null,
      },
    };
  }

  function createPaperContext(input) {
    // Explicit PDF source — use PDF-specific identity rules.
    // Callers must pass { pdf: true } to opt in.  This ensures the
    // PDF viewer page URL (chrome-extension://…) never becomes the
    // paperId; instead we use the actual PDF source URL or
    // filename+filesize.
    // We check input.pdf rather than sourceType so that content-script
    // (which may infer sourceType "pdf" from a .pdf URL) is not
    // accidentally routed to the PDF identity path.
    if (input.pdf) {
      return buildPdfPaperContext(input);
    }

    var fallbackTitle =
      typeof document !== 'undefined' && document.title ? document.title : 'Untitled Paper';
    var fallbackUrl = typeof location !== 'undefined' && location.href ? location.href : '';
    var resolvedUrl = input.url || fallbackUrl;
    var normalizedUrl = normalizePaperUrl(resolvedUrl);

    return {
      paperId: input.paperId || createStablePaperId(normalizedUrl) || createId('paper'),
      title: input.title || fallbackTitle,
      url: normalizedUrl,
      sourceType: input.sourceType || inferSourceType(resolvedUrl),
      // Spec uses `pageNumber?: number` — omit when absent rather than null
      pageNumber: input.pageNumber || undefined,
      authors: input.authors || [],
    };
  }

  function createSourceSummary(source) {
    if (!source) {
      return 'Unknown source';
    }

    if (source.type === ResultSourceType.FIGURE) {
      return source.pageNumber
        ? `Figure selection · Page ${source.pageNumber}`
        : 'Figure selection';
    }

    if (source.type === ResultSourceType.DOCUMENT) {
      return source.documentKind === 'pdf_file' ? 'PDF Document' : 'Full Page';
    }

    return source.pageNumber ? `Text selection · Page ${source.pageNumber}` : 'Text selection';
  }

  // ─── Mock Response Generators ────────────────────────────
  //
  // These produce scaffold responses so the end-to-end UI path
  // works before the backend API is wired.  Replace with real
  // API client calls in Workstream F.

  function createMockTextResult(payload) {
    var action = payload.action;
    var selectedText = normalizeSelectionText(payload.selection.text);
    var truncated = selectedText.length > 180 ? `${selectedText.slice(0, 180)}...` : selectedText;
    var resultId = createId('result');
    var threadId = createId('thread');
    var sections = [];

    if (action === ActionType.SIMPLIFY) {
      sections = [
        {
          title: 'Simplified Explanation',
          content: `In simpler terms, this part says: ${truncated}`,
        },
        {
          title: 'One-Sentence Takeaway',
          content:
            'This section is describing an idea the reader should understand before moving on.',
        },
      ];
    } else if (action === ActionType.DEFINE) {
      sections = [
        {
          title: 'Definition',
          content:
            "This selected term or phrase refers to a concept used in the paper's local context.",
        },
        {
          title: 'Meaning In This Paper',
          content:
            'Here, the authors are using it to support the current argument or method description.',
        },
      ];
    } else {
      sections = [
        {
          title: 'Plain Explanation',
          content: `This selected passage is saying: ${truncated}`,
        },
        {
          title: 'Why It Matters',
          content:
            "This likely matters because it supports the paper's method, assumption, or result interpretation.",
        },
        {
          title: 'Key Terms',
          content:
            'Important terms in this passage should be interpreted using the local paragraph and section context.',
        },
      ];
    }

    return {
      requestId: createId('req'),
      status: ResultStatus.SUCCESS,
      result: {
        resultId,
        threadId,
        sourceType: ResultSourceType.TEXT,
        action,
        sections,
        warnings: [],
        createdAt: nowIso(),
      },
    };
  }

  function createMockFigureResult(_payload) {
    return {
      requestId: createId('req'),
      status: ResultStatus.PARTIAL_SUCCESS,
      result: {
        resultId: createId('result'),
        threadId: createId('thread'),
        sourceType: ResultSourceType.FIGURE,
        action: ActionType.EXPLAIN_FIGURE,
        sections: [
          {
            title: 'What This Figure Shows',
            content:
              'This selected figure region appears to contain a visual comparison or model component layout.',
          },
          {
            title: 'How To Read It',
            content:
              'Read the visible blocks, labels, or chart elements from left to right and compare the main visual groups.',
          },
          {
            title: 'Main Takeaway',
            content:
              'The figure is likely intended to make the method or experimental result easier to interpret than text alone.',
          },
        ],
        warnings: [
          {
            code: 'MOCK_CAPTURE_ONLY',
            message:
              'This is a scaffold response. Real image analysis will be wired to the backend API next.',
          },
        ],
        createdAt: nowIso(),
      },
    };
  }

  function createMockSummarizeResult(payload) {
    var resultId = createId('result');
    var threadId = createId('thread');
    var paperTitle = (payload && payload.paper && payload.paper.title) || 'Untitled Paper';
    var truncatedTitle = paperTitle.length > 80 ? `${paperTitle.slice(0, 80)}...` : paperTitle;

    return {
      requestId: createId('req'),
      status: ResultStatus.SUCCESS,
      result: {
        resultId,
        threadId,
        sourceType: ResultSourceType.DOCUMENT,
        action: ActionType.SUMMARIZE,
        sections: [
          {
            title: 'Paper Overview',
            content: `"${truncatedTitle}" presents a study that addresses a significant problem in its field. The paper provides a comprehensive analysis with clear methodology and supporting evidence.`,
          },
          {
            title: 'Key Contributions',
            content:
              'The main contributions include a novel approach to the core problem, empirical validation on standard benchmarks, and insights that advance the state of the art.',
          },
          {
            title: 'Methodology',
            content:
              'The authors employ a systematic methodology combining theoretical analysis with experimental evaluation. The approach is compared against existing baselines to demonstrate its effectiveness.',
          },
          {
            title: 'Main Findings',
            content:
              'Key findings show improvements over prior methods, with detailed ablation studies confirming the contribution of each component. Limitations and future directions are also discussed.',
          },
        ],
        warnings: [],
        createdAt: nowIso(),
      },
    };
  }

  function createMockFollowUpResponse(payload) {
    return {
      requestId: createId('req'),
      status: ResultStatus.SUCCESS,
      followUp: {
        followUpId: createId('followup'),
        threadId: payload.threadId,
        sourceResultId: payload.sourceResultId,
        question: payload.question,
        sections: [
          {
            title: 'Answer',
            content:
              'This follow-up answer is scoped to the current result thread and should later be replaced by a backend response.',
          },
        ],
        warnings: [],
        createdAt: nowIso(),
      },
    };
  }

  // ─── Exports ─────────────────────────────────────────────

  globalThis.PaperReadingAssistantShared = {
    // App-level constants
    APP_NAMESPACE,
    STORAGE_KEY,
    CONFIG_STORAGE_KEY,
    MAX_SELECTION_LENGTH,
    MIN_SELECTION_LENGTH,
    MAX_FULLTEXT_LENGTH,
    MAX_HTML_LENGTH,
    MIN_FULLTEXT_CHARS,
    MAX_PDF_FILE_SIZE,
    CLIENT_INFO,

    // Enum constants
    Tabs,
    BackendStatus,
    WorkspaceStatus,
    ResultStatus,
    ActionType,
    SourceType,
    ResultSourceType,
    SaveFilter,
    ToolbarStatus,
    FigureOverlayStatus,
    FollowUpStatus,
    ErrorCode,

    // Message types
    MessageType,

    // Utility functions
    createId,
    nowIso,
    inferSourceType,
    normalizePaperUrl,
    normalizePdfSourceUrl,
    createStablePaperId,
    buildPdfPaperContext,
    normalizeSelectionText,

    // State factories
    createEmptyState,
    createPaperContext,
    createSourceSummary,

    // Mock generators (replace with real API client in Workstream F)
    createMockTextResult,
    createMockFigureResult,
    createMockFollowUpResponse,
    createMockSummarizeResult,
  };
})();
