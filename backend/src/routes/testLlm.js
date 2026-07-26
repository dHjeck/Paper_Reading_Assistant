/**
 * POST /api/test-llm
 *
 * Test LLM provider connectivity by sending a minimal
 * OpenAI-compatible /chat/completions request using the
 * per-request credentials from req.llmConfig (X-LLM-* headers).
 *
 * Returns success with latency on 2xx, or spec-compliant error
 * on auth failure / upstream error / timeout.
 */
import { Router } from 'express';
import { createValidator } from '../middleware/validate.js';
import { schemas } from '../schemas.js';
import { errors } from '../errors.js';
import { getLogger } from '../logger.js';

const router = Router();
const TEST_TIMEOUT_MS = 15000;
const DEFAULT_MODEL = 'gpt-3.5-turbo';

router.post('/', createValidator(schemas.testLlmRequest), async (req, res, next) => {
  try {
    const { baseUrl, apiKey, model } = req.llmConfig;

    if (!baseUrl) {
      return next(errors.invalidRequest('LLM Base URL is required for connectivity test.'));
    }

    const modelName = model || DEFAULT_MODEL;
    const targetUrl = `${baseUrl}/chat/completions`;

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const body = JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    const startMs = Date.now();
    let llmRes;
    try {
      llmRes = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const elapsed = Date.now() - startMs;

      if (err && err.name === 'AbortError') {
        getLogger().warn({ baseUrl, modelName, elapsed }, 'LLM test timed out');
        return next(
          errors.upstreamModelError(
            `LLM provider did not respond within ${TEST_TIMEOUT_MS / 1000}s.`
          )
        );
      }

      getLogger().warn({ baseUrl, err: err.message }, 'LLM test network error');
      return next(
        errors.upstreamModelError(`Could not reach LLM provider at ${baseUrl}: ${err.message}`)
      );
    }
    clearTimeout(timer);

    const latencyMs = Date.now() - startMs;

    // ── Read response body ──
    let llmBody = null;
    try {
      llmBody = await llmRes.json();
    } catch {
      // Non-JSON response — fall through to status checks
    }

    // ── Success ──
    if (llmRes.ok) {
      getLogger().info({ baseUrl, modelName, latencyMs }, 'LLM test succeeded');
      return res.status(200).json({
        requestId: req.requestId,
        status: 'success',
        model: modelName,
        latencyMs,
      });
    }

    // ── Auth errors ──
    if (llmRes.status === 401 || llmRes.status === 403) {
      const detail = (llmBody && llmBody.error && llmBody.error.message) || `HTTP ${llmRes.status}`;
      getLogger().warn({ baseUrl, modelName, status: llmRes.status }, 'LLM test auth failed');
      return next(errors.unauthorized(`LLM provider rejected the API key: ${detail}`));
    }

    // ── Other upstream errors ──
    const detail = (llmBody && llmBody.error && llmBody.error.message) || `HTTP ${llmRes.status}`;
    getLogger().warn(
      { baseUrl, modelName, status: llmRes.status, detail },
      'LLM test upstream error'
    );
    return next(errors.upstreamModelError(`LLM provider returned error: ${detail}`));
  } catch (err) {
    next(err);
  }
});

export default router;
