/**
 * Paper Reading Assistant — API Client
 *
 * Unified client for all V1 backend endpoints with built-in
 * mock/real switching.  The background worker calls this module
 * exclusively — it never constructs fetch URLs or mock responses
 * directly.
 *
 * Endpoints (backend-api-spec §3):
 *   POST /api/explain-text     — §6
 *   POST /api/explain-figure   — §7
 *   POST /api/follow-up        — §8
 *   GET  /api/health           — §9
 *
 * Modes:
 *   "mock"  — return mock data (default; enables standalone UI dev)
 *   "real"  — call the real API (production)
 *   "auto"  — try real, fall back to mock on network failure
 *
 * Config is persisted in chrome.storage.local under
 * CONFIG_STORAGE_KEY so the options page can update it at runtime.
 *
 * Every method returns a spec-compliant response:
 *   - Success/partial: { requestId, status, result/followUp, ... }
 *   - Error:            { requestId, status: "error", error: { code, message, retryable } }
 * (see backend-api-spec §6.4, §7.4, §8.4, §10.1)
 *
 * Loaded via importScripts in background.js (after contracts.js).
 */
(function () {
  'use strict';

  var Shared = globalThis.PaperReadingAssistantShared;
  if (!Shared) {
    throw new Error('api-client.js requires contracts.js to be loaded first');
  }

  var DEBUG_PREFIX = '[PRA api-client]';
  var MIN_REQUEST_TIMEOUT_MS = 75000;

  // ─── Configuration ────────────────────────────────────────

  var DEFAULT_CONFIG = {
    baseUrl: 'http://localhost:3000',
    mode: 'mock', // "mock" | "real" | "auto"
    timeoutMs: MIN_REQUEST_TIMEOUT_MS,
    authToken: null, // Bearer token; null = omit Authorization header
    llmBaseUrl: null, // LLM provider base URL; null = omit X-LLM-Base-Url header
    llmApiKey: null, // LLM provider API key; null = omit X-LLM-Api-Key header
    llmModel: null, // LLM model name; null = omit X-LLM-Model header
    language: 'en', // Response language: "en" | "zh" | "ja"
  };

  var config = Object.assign({}, DEFAULT_CONFIG);
  var configReadyPromise = null;
  var hasRegisteredStorageListener = false;

  function debugLog(level, message, details) {
    var logger = console[level] || console.log;
    if (details === undefined) {
      logger.call(console, `${DEBUG_PREFIX} ${message}`);
      return;
    }

    logger.call(console, `${DEBUG_PREFIX} ${message}`, details);
  }

  function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function previewText(text, maxLength) {
    if (!hasText(text)) {
      return '';
    }

    var normalized = text.replace(/\s+/g, ' ').trim();
    var limit = Number(maxLength) > 0 ? Math.round(maxLength) : 80;
    if (normalized.length <= limit) {
      return normalized;
    }

    return `${normalized.slice(0, limit)}...`;
  }

  function summarizeSecret(value) {
    return {
      present: hasText(value),
      length: hasText(value) ? value.trim().length : 0,
    };
  }

  function summarizeConfigSnapshot(snapshot) {
    var next = snapshot || config || {};
    return {
      mode: next.mode || DEFAULT_CONFIG.mode,
      baseUrl: next.baseUrl || DEFAULT_CONFIG.baseUrl,
      timeoutMs: next.timeoutMs || DEFAULT_CONFIG.timeoutMs,
      authToken: summarizeSecret(next.authToken),
      llmBaseUrl: next.llmBaseUrl || null,
      llmApiKey: summarizeSecret(next.llmApiKey),
      llmModel: next.llmModel || null,
      language: next.language || DEFAULT_CONFIG.language,
    };
  }

  function summarizeHeaders(headers) {
    return {
      hasAuthorization: !!(headers && headers.Authorization),
      hasLlmBaseUrl: !!(headers && headers['X-LLM-Base-Url']),
      llmBaseUrl: (headers && headers['X-LLM-Base-Url']) || null,
      hasLlmApiKey: !!(headers && headers['X-LLM-Api-Key']),
      llmModel: (headers && headers['X-LLM-Model']) || null,
      language: (headers && headers['X-LLM-Language']) || DEFAULT_CONFIG.language,
    };
  }

  function summarizeFigurePayload(figure) {
    if (!figure || typeof figure !== 'object') {
      return null;
    }

    return {
      figureId: figure.figureId || null,
      pageNumber: figure.pageNumber || null,
      hasImageRef: hasText(figure.imageRef),
      hasImageData: !!(figure.imageData && figure.imageData.dataUrl),
      imageDataBytes:
        figure.imageData && figure.imageData.dataUrl ? figure.imageData.dataUrl.length : 0,
      hasThumbnailRef: hasText(figure.thumbnailRef),
      hasBoundingBox: !!figure.boundingBox,
      captionPreview: previewText(figure.caption, 60),
    };
  }

  function summarizeRequest(path, body) {
    var request = body || {};
    return {
      path,
      action: request.action || null,
      paperTitle: request.paper && request.paper.title ? request.paper.title : null,
      paperSourceType: request.paper && request.paper.sourceType ? request.paper.sourceType : null,
      paperId: request.paper && request.paper.paperId ? request.paper.paperId : null,
      selection: request.selection
        ? {
            selectionId: request.selection.selectionId || null,
            pageNumber: request.selection.pageNumber || null,
            textLength: request.selection.text ? request.selection.text.length : 0,
            contextLength: request.selection.context ? request.selection.context.length : 0,
            textPreview: previewText(request.selection.text, 80),
          }
        : null,
      figure: summarizeFigurePayload(request.figure),
      threadId: request.threadId || null,
      sourceResultId: request.sourceResultId || null,
      questionLength: request.question ? request.question.length : 0,
      questionPreview: previewText(request.question, 80),
    };
  }

  function summarizeResponse(response) {
    if (!response || typeof response !== 'object') {
      return {
        status: null,
      };
    }

    var summary = {
      requestId: response.requestId || null,
      status: response.status || null,
    };

    if (response.error) {
      summary.error = {
        code: response.error.code || null,
        message: response.error.message || null,
        retryable: !!response.error.retryable,
      };
    }

    if (response.result) {
      summary.result = {
        threadId: response.result.threadId || null,
        resultId: response.result.resultId || null,
        action: response.result.action || null,
        sections: Array.isArray(response.result.sections) ? response.result.sections.length : 0,
        sectionTitles: Array.isArray(response.result.sections)
          ? response.result.sections.slice(0, 3).map(section => {
              return section && (section.title || section.heading)
                ? section.title || section.heading
                : null;
            })
          : [],
      };
    }

    if (response.followUp) {
      summary.followUp = {
        followUpId: response.followUp.followUpId || null,
        threadId: response.followUp.threadId || null,
        sections: Array.isArray(response.followUp.sections) ? response.followUp.sections.length : 0,
        sectionTitles: Array.isArray(response.followUp.sections)
          ? response.followUp.sections.slice(0, 3).map(section => {
              return section && (section.title || section.heading)
                ? section.title || section.heading
                : null;
            })
          : [],
      };
    }

    if (response.model) {
      summary.model = response.model;
    }

    if (response.latencyMs !== null) {
      summary.latencyMs = response.latencyMs;
    }

    return summary;
  }

  function pathForMethod(method) {
    if (method === 'explainText') {
      return '/api/explain-text';
    }
    if (method === 'explainFigure') {
      return '/api/explain-figure';
    }
    if (method === 'followUp') {
      return '/api/follow-up';
    }
    if (method === 'testLlm') {
      return '/api/test-llm';
    }
    if (method === 'summarize') {
      return '/api/summarize';
    }
    if (method === 'health') {
      return '/api/health';
    }
    return method;
  }

  function dispatcherNameFor(dispatcher) {
    if (dispatcher === mockClient) {
      return 'mock';
    }
    if (dispatcher === realClient) {
      return 'real';
    }
    return 'auto';
  }

  async function runWithDispatcher(method, request, options) {
    var settings = options || {};
    await ensureConfigReady(settings.ensureOptions);

    var dispatcher = getDispatcher();
    var dispatcherName = dispatcherNameFor(dispatcher);
    var path = pathForMethod(method);

    debugLog('info', `${method} start`, {
      dispatcher: dispatcherName,
      config: summarizeConfigSnapshot(config),
      request: summarizeRequest(path, request),
    });

    var response = dispatcher
      ? await dispatcher[method](request)
      : await dispatchWithFallback(method, request);

    debugLog(response && response.status === 'error' ? 'warn' : 'info', `${method} end`, {
      dispatcher: dispatcherName,
      response: summarizeResponse(response),
    });

    return response;
  }

  function normalizeConfig(input) {
    var merged = Object.assign({}, DEFAULT_CONFIG, input || {});
    var baseUrl =
      typeof merged.baseUrl === 'string' && merged.baseUrl.trim()
        ? merged.baseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_CONFIG.baseUrl;
    var mode =
      merged.mode === 'mock' || merged.mode === 'real' || merged.mode === 'auto'
        ? merged.mode
        : DEFAULT_CONFIG.mode;
    var timeoutMs = Number(merged.timeoutMs);
    // The browser must wait longer than the backend's 60-second provider
    // timeout. Clamp legacy and manually-entered shorter values so the
    // client cannot abort a valid in-flight response first.
    if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_REQUEST_TIMEOUT_MS) {
      timeoutMs = MIN_REQUEST_TIMEOUT_MS;
    }
    var authToken =
      typeof merged.authToken === 'string' && merged.authToken.trim()
        ? merged.authToken.trim()
        : null;
    var llmBaseUrl =
      typeof merged.llmBaseUrl === 'string' && merged.llmBaseUrl.trim()
        ? merged.llmBaseUrl.trim().replace(/\/+$/, '')
        : null;
    var llmApiKey =
      typeof merged.llmApiKey === 'string' && merged.llmApiKey.trim()
        ? merged.llmApiKey.trim()
        : null;
    var llmModel =
      typeof merged.llmModel === 'string' && merged.llmModel.trim() ? merged.llmModel.trim() : null;
    var ALLOWED_LANGUAGES = ['en', 'zh', 'ja'];
    var language =
      typeof merged.language === 'string' && ALLOWED_LANGUAGES.indexOf(merged.language) !== -1
        ? merged.language
        : DEFAULT_CONFIG.language;

    return {
      baseUrl,
      mode,
      timeoutMs:
        Number.isFinite(timeoutMs) && timeoutMs >= MIN_REQUEST_TIMEOUT_MS
          ? Math.round(timeoutMs)
          : DEFAULT_CONFIG.timeoutMs,
      authToken,
      llmBaseUrl,
      llmApiKey,
      llmModel,
      language,
    };
  }

  /**
   * Load config from chrome.storage.local, merging over defaults.
   * Called on install and may be called again after options change.
   * @returns {Promise<object>}
   */
  async function loadConfig() {
    try {
      var stored = await chrome.storage.local.get(Shared.CONFIG_STORAGE_KEY);
      var saved = stored[Shared.CONFIG_STORAGE_KEY];
      if (saved) {
        config = normalizeConfig(saved);
      } else {
        config = normalizeConfig();
      }
    } catch (e) {
      config = normalizeConfig();
      debugLog('warn', 'config load failed; using defaults', {
        error: e && e.message ? e.message : String(e),
        config: summarizeConfigSnapshot(config),
      });
      // Storage not available yet — keep defaults
    }
    debugLog('info', 'config loaded', summarizeConfigSnapshot(config));
    return getConfig();
  }

  function registerStorageListener() {
    if (hasRegisteredStorageListener || !chrome.storage || !chrome.storage.onChanged) {
      return;
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[Shared.CONFIG_STORAGE_KEY]) {
        return;
      }

      config = normalizeConfig(changes[Shared.CONFIG_STORAGE_KEY].newValue);
      debugLog('info', 'config updated from storage', summarizeConfigSnapshot(config));
    });

    hasRegisteredStorageListener = true;
  }

  async function ensureConfigReady(options) {
    var forceReload = !!(options && options.forceReload);

    registerStorageListener();

    if (!forceReload && configReadyPromise) {
      return configReadyPromise;
    }

    configReadyPromise = loadConfig().catch(() => {
      configReadyPromise = null;
      config = normalizeConfig();
      return getConfig();
    });

    return configReadyPromise;
  }

  /**
   * Update config in memory only.
   * @param {object} partial
   */
  function configure(partial) {
    config = normalizeConfig(Object.assign({}, config, partial));
    debugLog('info', 'config updated in memory', summarizeConfigSnapshot(config));
  }

  /**
   * Update config in memory AND persist to storage.
   * @param {object} partial
   * @returns {Promise<object>}
   */
  async function saveConfig(partial) {
    configure(partial);
    await chrome.storage.local.set({
      [Shared.CONFIG_STORAGE_KEY]: config,
    });
    configReadyPromise = Promise.resolve(getConfig());
    debugLog('info', 'config saved to storage', summarizeConfigSnapshot(config));
    return getConfig();
  }

  /**
   * @returns {object} shallow copy of current config
   */
  function getConfig() {
    return Object.assign({}, config);
  }

  // ─── Error Normalization ──────────────────────────────────
  //
  // Maps any failure — network error, timeout, non-2xx HTTP —
  // into the spec-compliant error shape (§10.1).

  function errorResponse(code, message, retryable) {
    return {
      requestId: Shared.createId('req'),
      status: 'error',
      error: {
        code,
        message,
        retryable: !!retryable,
      },
    };
  }

  var HTTP_ERROR_CODE_MAP = {
    400: Shared.ErrorCode.INVALID_REQUEST,
    401: Shared.ErrorCode.UNAUTHORIZED,
    403: Shared.ErrorCode.FORBIDDEN,
    404: Shared.ErrorCode.INVALID_REQUEST,
    408: Shared.ErrorCode.TIMEOUT,
    409: Shared.ErrorCode.INVALID_REQUEST,
    413: Shared.ErrorCode.INVALID_REQUEST,
    429: Shared.ErrorCode.RATE_LIMITED,
    500: Shared.ErrorCode.INTERNAL_ERROR,
    502: Shared.ErrorCode.UPSTREAM_MODEL_ERROR,
    503: Shared.ErrorCode.INTERNAL_ERROR,
  };

  function isRetryableStatus(status) {
    return status === 408 || status === 429 || status === 502 || status === 503 || status >= 500;
  }

  function fromHttpError(status, body) {
    // If the server returned a spec-compliant error body, pass it through
    if (body && body.status === 'error' && body.error) {
      return body;
    }
    var code = HTTP_ERROR_CODE_MAP[status] || Shared.ErrorCode.INTERNAL_ERROR;
    var message = (body && body.error && body.error.message) || `HTTP ${status}`;
    return errorResponse(code, message, isRetryableStatus(status));
  }

  // ─── Mock Latency ─────────────────────────────────────────

  /**
   * Simulate network latency in mock mode.
   *
   * Kept short (100ms) because MV3 service workers can be terminated
   * after ~30s of inactivity.  A long setTimeout may never fire if
   * the SW is killed mid-delay, leaving the UI stuck in loading.
   * The 2-minute LADING_STATE_TTL in state-store.js is the safety net.
   */
  function mockDelay(ms) {
    return new Promise(resolve => {
      setTimeout(resolve, ms || 100);
    });
  }

  // ─── Mock Client ──────────────────────────────────────────
  //
  // Wraps Shared.createMock* generators with an async interface
  // identical to the real client, so callers don't know which
  // path they're on.

  var mockClient = {
    async explainText(request) {
      debugLog('info', 'mock explainText selected', summarizeRequest('/api/explain-text', request));
      await mockDelay();
      return Shared.createMockTextResult({
        action: request.action,
        selection: request.selection,
      });
    },

    async explainFigure(request) {
      debugLog(
        'info',
        'mock explainFigure selected',
        summarizeRequest('/api/explain-figure', request)
      );
      await mockDelay();
      return Shared.createMockFigureResult({
        figure: request.figure,
      });
    },

    async followUp(request) {
      debugLog('info', 'mock followUp selected', summarizeRequest('/api/follow-up', request));
      await mockDelay();
      return Shared.createMockFollowUpResponse({
        threadId: request.threadId,
        sourceResultId: request.sourceResultId,
        question: request.question,
      });
    },

    async summarize(request) {
      debugLog('info', 'mock summarize selected', summarizeRequest('/api/summarize', request));
      await mockDelay();
      return Shared.createMockSummarizeResult({
        paper: request.paper,
        document: request.document,
      });
    },

    async health() {
      debugLog('info', 'mock health selected');
      await mockDelay(200);
      return {
        status: 'ok',
        service: 'paper-reading-assistant-api',
        time: Shared.nowIso(),
      };
    },
  };

  // ─── Real Client ──────────────────────────────────────────

  function buildHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    if (config.authToken) {
      headers['Authorization'] = `Bearer ${config.authToken}`;
    }
    if (config.llmBaseUrl) {
      headers['X-LLM-Base-Url'] = config.llmBaseUrl;
    }
    if (config.llmApiKey) {
      headers['X-LLM-Api-Key'] = config.llmApiKey;
    }
    if (config.llmModel) {
      headers['X-LLM-Model'] = config.llmModel;
    }
    headers['X-LLM-Language'] = config.language || 'en';
    return headers;
  }

  async function fetchWithTimeout(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(() => {
      controller.abort();
    }, config.timeoutMs);
    try {
      return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * POST JSON to an API path, returning a normalized response.
   * Never throws — all errors become errorResponse objects.
   */
  async function postJson(path, body) {
    var url = config.baseUrl + path;
    var headers = buildHeaders();

    debugLog('info', 'HTTP request start', {
      url,
      method: 'POST',
      timeoutMs: config.timeoutMs,
      headers: summarizeHeaders(headers),
      request: summarizeRequest(path, body),
    });

    try {
      var res = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      var json = await res.json().catch(() => {
        return null;
      });
      debugLog(res.ok ? 'info' : 'warn', 'HTTP response received', {
        url,
        statusCode: res.status,
        ok: res.ok,
        resolvedProvider: res.headers.get('X-PRA-Resolved-Provider'),
        response: summarizeResponse(json),
      });
      if (!res.ok) {
        var httpError = fromHttpError(res.status, json);
        debugLog('warn', 'HTTP response normalized to error', {
          url,
          statusCode: res.status,
          response: summarizeResponse(httpError),
        });
        return httpError;
      }
      return json;
    } catch (err) {
      var networkError;
      if (err && err.name === 'AbortError') {
        networkError = errorResponse(Shared.ErrorCode.TIMEOUT, 'Request timed out', true);
        debugLog('error', 'HTTP request timed out', {
          url,
          errorName: err.name,
          message: err.message || 'Request timed out',
          response: summarizeResponse(networkError),
        });
        return networkError;
      }
      networkError = errorResponse(
        Shared.ErrorCode.INTERNAL_ERROR,
        (err && err.message) || 'Network error',
        true
      );
      debugLog('error', 'HTTP request failed', {
        url,
        errorName: err && err.name ? err.name : 'Error',
        message: err && err.message ? err.message : 'Network error',
        response: summarizeResponse(networkError),
      });
      return networkError;
    }
  }

  var realClient = {
    explainText(request) {
      return postJson('/api/explain-text', request);
    },

    explainFigure(request) {
      return postJson('/api/explain-figure', request);
    },

    followUp(request) {
      return postJson('/api/follow-up', request);
    },

    summarize(request) {
      return postJson('/api/summarize', request);
    },

    async health() {
      var url = `${config.baseUrl}/api/health`;
      var headers = buildHeaders();
      debugLog('info', 'health check start', {
        url,
        headers: summarizeHeaders(headers),
      });
      try {
        var res = await fetchWithTimeout(url, { headers });
        if (!res.ok) {
          debugLog('warn', 'health check returned non-OK status', {
            url,
            statusCode: res.status,
          });
          return null;
        }
        var health = await res.json();
        debugLog('info', 'health check success', {
          url,
          health,
        });
        return health;
      } catch (err) {
        debugLog('error', 'health check failed', {
          url,
          errorName: err && err.name ? err.name : 'Error',
          message: err && err.message ? err.message : 'Network error',
        });
        return null;
      }
    },

    testLlm() {
      return postJson('/api/test-llm', {});
    },
  };

  // ─── Mode Dispatcher ──────────────────────────────────────
  //
  // "mock"  → mockClient
  // "real"  → realClient
  // "auto"  → try realClient; if network-level failure, fall back
  //           to mockClient so the UI can still be exercised.

  /**
   * A network-level failure is an INTERNAL_ERROR with retryable=true
   * that was NOT produced by fromHttpError (i.e. no HTTP status was
   * ever received).  This is how we distinguish "server returned 500"
   * from "could not reach server".
   */
  function isNetworkLevelError(response) {
    return (
      response &&
      response.status === 'error' &&
      response.error &&
      response.error.code === Shared.ErrorCode.INTERNAL_ERROR &&
      response.error.retryable === true
    );
  }

  async function dispatchWithFallback(method, request) {
    debugLog('info', 'auto mode: trying real client first', {
      method,
      config: summarizeConfigSnapshot(config),
      request: summarizeRequest(pathForMethod(method), request),
    });
    var realResult = await realClient[method](request);

    // Success or partial_success from real API → use it
    if (realResult && realResult.status !== 'error') {
      debugLog('info', 'auto mode: real client succeeded', {
        method,
        response: summarizeResponse(realResult),
      });
      return realResult;
    }

    // Network-level failure (can't reach server) → fall back to mock
    if (isNetworkLevelError(realResult)) {
      debugLog('warn', 'auto mode: network-level failure, falling back to mock', {
        method,
        response: summarizeResponse(realResult),
      });
      var mockResult = await mockClient[method](request);
      debugLog('warn', 'auto mode: mock fallback completed', {
        method,
        response: summarizeResponse(mockResult),
      });
      return mockResult;
    }

    // HTTP error from a reachable server → return as-is
    debugLog('warn', 'auto mode: reachable server returned an error, no fallback applied', {
      method,
      response: summarizeResponse(realResult),
    });
    return realResult;
  }

  function getDispatcher() {
    if (config.mode === 'mock') {
      return mockClient;
    }
    if (config.mode === 'real') {
      return realClient;
    }
    return null; // "auto" — caller uses dispatchWithFallback
  }

  // ─── Public API ───────────────────────────────────────────

  var apiClient = {
    // Config management
    loadConfig,
    configure,
    saveConfig,
    getConfig,

    /**
     * POST /api/explain-text (backend-api-spec §6)
     * @param {ExplainTextRequest} request
     * @returns {Promise<SuccessResponse | ErrorResponse>}
     */
    async explainText(request) {
      return runWithDispatcher('explainText', request);
    },

    /**
     * POST /api/explain-figure (backend-api-spec §7)
     * @param {ExplainFigureRequest} request
     * @returns {Promise<SuccessResponse | ErrorResponse>}
     */
    async explainFigure(request) {
      return runWithDispatcher('explainFigure', request);
    },

    /**
     * POST /api/follow-up (backend-api-spec §8)
     * @param {FollowUpRequest} request
     * @returns {Promise<FollowUpSuccessResponse | ErrorResponse>}
     */
    async followUp(request) {
      return runWithDispatcher('followUp', request);
    },

    /**
     * POST /api/summarize
     * Summarize a full document (HTML page or PDF file).
     * @param {Object} request
     * @returns {Promise<SuccessResponse | ErrorResponse>}
     */
    async summarize(request) {
      return runWithDispatcher('summarize', request);
    },

    /**
     * GET /api/health (backend-api-spec §9)
     * @returns {Promise<HealthResponse | null>} null when unreachable
     */
    async health() {
      await ensureConfigReady();
      debugLog('info', 'health start', {
        dispatcher: config.mode === 'mock' ? 'mock' : 'real',
        config: summarizeConfigSnapshot(config),
      });
      if (config.mode === 'mock') {
        var mockHealth = await mockClient.health();
        debugLog('info', 'health end', {
          dispatcher: 'mock',
          health: mockHealth,
        });
        return mockHealth;
      }
      // "real" and "auto" both hit the real endpoint;
      // auto's fallback for health is simply null → OFFLINE,
      // which is the correct semantic (no mock health needed).
      var realHealth = await realClient.health();
      debugLog(realHealth ? 'info' : 'warn', 'health end', {
        dispatcher: 'real',
        health: realHealth,
      });
      return realHealth;
    },

    /**
     * POST /api/test-llm
     * Test LLM provider connectivity via backend proxy.
     * @returns {Promise<Object>} success or error response
     */
    async testLlm() {
      await ensureConfigReady();
      debugLog('info', 'testLlm start', {
        config: summarizeConfigSnapshot(config),
      });
      // Always use real client — test-llm is a backend-proxied call
      // and has no mock equivalent.
      var result = await realClient.testLlm();
      debugLog(result && result.status === 'error' ? 'warn' : 'info', 'testLlm end', {
        response: summarizeResponse(result),
      });
      return result;
    },
  };

  registerStorageListener();

  globalThis.PaperReadingAssistantApiClient = apiClient;
})();
