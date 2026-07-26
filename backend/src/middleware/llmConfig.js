/**
 * LLM provider configuration middleware.
 *
 * Extracts per-request LLM provider credentials from custom
 * headers (X-LLM-Base-Url / X-LLM-Api-Key / X-LLM-Model / X-LLM-Language)
 * and attaches them to req.llmConfig for downstream use by route
 * handlers and model adapters.
 *
 * When headers are absent, req.llmConfig fields are null,
 * signalling the model adapter to fall back to server-side
 * environment defaults.
 */

const ALLOWED_LANGUAGES = new Set(['en', 'zh', 'ja']);

export function llmConfigMiddleware(req, _res, next) {
  const baseUrl = (req.get('X-LLM-Base-Url') || '').trim().replace(/\/+$/, '');
  const apiKey = (req.get('X-LLM-Api-Key') || '').trim();
  const model = (req.get('X-LLM-Model') || '').trim();
  const language = (req.get('X-LLM-Language') || 'en').trim().toLowerCase();

  req.llmConfig = {
    baseUrl: baseUrl || null,
    apiKey: apiKey || null,
    model: model || null,
    language: ALLOWED_LANGUAGES.has(language) ? language : 'en',
  };

  next();
}
