(function () {
  'use strict';

  var Shared = globalThis.PaperReadingAssistantShared;
  var STORAGE_KEY = Shared.CONFIG_STORAGE_KEY;
  var DEFAULT_CONFIG = {
    baseUrl: 'http://localhost:3000',
    mode: 'mock',
    timeoutMs: 30000,
    authToken: '',
    llmBaseUrl: '',
    llmApiKey: '',
    llmModel: '',
    language: 'en',
  };

  var currentLang = 'en';

  var form = document.getElementById('settings-form');
  var modeInput = document.getElementById('mode');
  var baseUrlInput = document.getElementById('base-url');
  var timeoutInput = document.getElementById('timeout-ms');
  var authTokenInput = document.getElementById('auth-token');
  var llmBaseUrlInput = document.getElementById('llm-base-url');
  var llmApiKeyInput = document.getElementById('llm-api-key');
  var llmModelInput = document.getElementById('llm-model');
  var languageInput = document.getElementById('language');
  var statusNode = document.getElementById('status');
  var resetButton = document.getElementById('reset-settings');
  var reloadButton = document.getElementById('reload-settings');
  var testLlmButton = document.getElementById('test-llm');

  init();

  function init() {
    form.addEventListener('submit', onSubmit);
    resetButton.addEventListener('click', onReset);
    reloadButton.addEventListener('click', () => {
      void loadFromStorage(true);
    });
    testLlmButton.addEventListener('click', () => {
      void onTestLlm();
    });
    languageInput.addEventListener('change', () => {
      currentLang = languageInput.value;
      applyI18n(currentLang);
    });

    void loadFromStorage(false);
  }

  async function onSubmit(event) {
    event.preventDefault();

    var config = readForm();
    if (!config) {
      return;
    }

    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          baseUrl: config.baseUrl,
          mode: config.mode,
          timeoutMs: config.timeoutMs,
          authToken: config.authToken || null,
          llmBaseUrl: config.llmBaseUrl || null,
          llmApiKey: config.llmApiKey || null,
          llmModel: config.llmModel || null,
          language: config.language || 'en',
        },
      });
      setStatus(t('status_saved'), 'success');
    } catch (error) {
      setStatus(t('status_save_failed'), 'error');
    }
  }

  function onReset() {
    writeForm(DEFAULT_CONFIG);
    setStatus(t('status_reset'), 'success');
  }

  async function loadFromStorage(announce) {
    try {
      var stored = await chrome.storage.local.get(STORAGE_KEY);
      var config = normalizeConfig(stored[STORAGE_KEY]);
      writeForm(config);
      if (announce) {
        setStatus(t('status_reloaded'), 'success');
      }
    } catch (error) {
      writeForm(DEFAULT_CONFIG);
      setStatus(t('status_load_failed'), 'error');
    }
  }

  function readForm() {
    var mode = modeInput.value;
    var baseUrl = (baseUrlInput.value || '').trim().replace(/\/+$/, '');
    var timeoutMs = Number(timeoutInput.value);
    var authToken = (authTokenInput.value || '').trim();
    var llmBaseUrl = (llmBaseUrlInput.value || '').trim().replace(/\/+$/, '');
    var llmApiKey = (llmApiKeyInput.value || '').trim();
    var llmModel = (llmModelInput.value || '').trim();
    var language = languageInput.value;

    if (!baseUrl) {
      setStatus(t('error_base_url_required'), 'error');
      baseUrlInput.focus();
      return null;
    }

    if (mode !== 'mock' && mode !== 'real' && mode !== 'auto') {
      setStatus(t('error_mode_invalid'), 'error');
      return null;
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
      setStatus(t('error_timeout_invalid'), 'error');
      timeoutInput.focus();
      return null;
    }

    return {
      baseUrl,
      mode,
      timeoutMs: Math.round(timeoutMs),
      authToken,
      llmBaseUrl,
      llmApiKey,
      llmModel,
      language,
    };
  }

  function writeForm(config) {
    modeInput.value = config.mode;
    baseUrlInput.value = config.baseUrl;
    timeoutInput.value = String(config.timeoutMs);
    authTokenInput.value = config.authToken || '';
    llmBaseUrlInput.value = config.llmBaseUrl || '';
    llmApiKeyInput.value = config.llmApiKey || '';
    llmModelInput.value = config.llmModel || '';
    languageInput.value = config.language || 'en';
    currentLang = languageInput.value;
    applyI18n(currentLang);
  }

  function normalizeConfig(input) {
    var next = Object.assign({}, DEFAULT_CONFIG, input || {});
    return {
      baseUrl:
        typeof next.baseUrl === 'string' && next.baseUrl.trim()
          ? next.baseUrl.trim().replace(/\/+$/, '')
          : DEFAULT_CONFIG.baseUrl,
      mode:
        next.mode === 'mock' || next.mode === 'real' || next.mode === 'auto'
          ? next.mode
          : DEFAULT_CONFIG.mode,
      timeoutMs:
        Number.isFinite(Number(next.timeoutMs)) && Number(next.timeoutMs) >= 1000
          ? Math.round(Number(next.timeoutMs))
          : DEFAULT_CONFIG.timeoutMs,
      authToken:
        typeof next.authToken === 'string'
          ? next.authToken
          : next.authToken === null
            ? ''
            : String(next.authToken),
      llmBaseUrl:
        typeof next.llmBaseUrl === 'string' && next.llmBaseUrl.trim()
          ? next.llmBaseUrl.trim().replace(/\/+$/, '')
          : '',
      llmApiKey:
        typeof next.llmApiKey === 'string' && next.llmApiKey.trim() ? next.llmApiKey.trim() : '',
      llmModel:
        typeof next.llmModel === 'string' && next.llmModel.trim() ? next.llmModel.trim() : '',
      language:
        next.language === 'en' || next.language === 'zh' || next.language === 'ja'
          ? next.language
          : DEFAULT_CONFIG.language,
    };
  }

  function setStatus(message, kind) {
    statusNode.textContent = message || '';
    statusNode.dataset.kind = kind || '';
  }

  async function onTestLlm() {
    var config = readForm();
    if (!config) {
      return;
    }

    if (!config.llmBaseUrl) {
      setStatus(t('error_llm_url_required'), 'error');
      llmBaseUrlInput.focus();
      return;
    }

    // Save first so api-client picks up the latest config
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          baseUrl: config.baseUrl,
          mode: config.mode,
          timeoutMs: config.timeoutMs,
          authToken: config.authToken || null,
          llmBaseUrl: config.llmBaseUrl || null,
          llmApiKey: config.llmApiKey || null,
          llmModel: config.llmModel || null,
          language: config.language || 'en',
        },
      });
    } catch (error) {
      // Continue anyway — test may still work with in-memory config
    }

    testLlmButton.disabled = true;
    testLlmButton.textContent = t('testing_button');
    setStatus(t('status_testing'), '');

    try {
      var apiClient = globalThis.PaperReadingAssistantApiClient;
      if (!apiClient) {
        setStatus(t('error_api_client_unavailable'), 'error');
        return;
      }

      await apiClient.loadConfig({ forceReload: true });
      var result = await apiClient.testLlm();

      if (result && result.status === 'success') {
        var model = result.model || config.llmModel || '(unknown)';
        var latency = result.latencyMs !== null ? `${result.latencyMs}ms` : '';
        var msg = `${t('status_test_ok')} Model: ${model}${latency ? ` (${latency})` : ''}`;
        setStatus(msg, 'success');
      } else if (result && result.status === 'error' && result.error) {
        setStatus(`LLM test failed: [${result.error.code}] ${result.error.message}`, 'error');
      } else {
        setStatus(t('status_test_unexpected'), 'error');
      }
    } catch (error) {
      setStatus(
        `LLM test error: ${error && error.message ? error.message : String(error)}`,
        'error'
      );
    } finally {
      testLlmButton.disabled = false;
      testLlmButton.textContent = t('test_button');
    }
  }

  // ── i18n helpers ──────────────────────────────────────────

  function t(key) {
    var dict =
      (typeof I18N !== 'undefined' && I18N[currentLang]) ||
      (typeof I18N !== 'undefined' && I18N.en) ||
      {};
    return dict[key] || key;
  }

  function applyI18n(lang) {
    var dict =
      (typeof I18N !== 'undefined' && I18N[lang]) || (typeof I18N !== 'undefined' && I18N.en) || {};

    // Update page title
    document.title = dict.page_title || document.title;

    // Update textContent for [data-i18n] elements
    var elements = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < elements.length; i++) {
      var key = elements[i].getAttribute('data-i18n');
      if (dict[key] !== null) {
        elements[i].textContent = dict[key];
      }
    }

    // Update placeholder for [data-i18n-placeholder] elements
    var phElements = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < phElements.length; j++) {
      var phKey = phElements[j].getAttribute('data-i18n-placeholder');
      if (dict[phKey] !== null) {
        phElements[j].placeholder = dict[phKey];
      }
    }

    // Update innerHTML for [data-i18n-html] elements (e.g. hint with <code> tags)
    var htmlElements = document.querySelectorAll('[data-i18n-html]');
    for (var k = 0; k < htmlElements.length; k++) {
      var htmlKey = htmlElements[k].getAttribute('data-i18n-html');
      if (dict[htmlKey] !== null) {
        htmlElements[k].innerHTML = dict[htmlKey];
      }
    }
  }
})();
