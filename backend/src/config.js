/**
 * Environment configuration.
 *
 * All runtime settings are read from environment variables with
 * sensible fallbacks so the server boots without a .env file.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const env = process.env;
const BACKEND_DIR = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

/**
 * Parse an integer from an environment variable, returning a fallback
 * if the value is missing or not a valid finite number.
 * @param {string} value
 * @param {number} fallback
 * @returns {number}
 */
function parseIntSafe(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolvePythonBin() {
  if (env.PYTHON_BIN) {
    return env.PYTHON_BIN;
  }

  const venvPython = process.platform === 'win32'
    ? join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe')
    : join(BACKEND_DIR, '.venv', 'bin', 'python');

  return existsSync(venvPython)
    ? venvPython
    : process.platform === 'win32' ? 'python' : 'python3';
}

const maxPdfFileSize = parseIntSafe(env.MAX_PDF_FILE_SIZE, 31457280);

export const config = {
  port: parseIntSafe(env.PORT, 3000),

  isProduction: env.NODE_ENV === 'production',

  modelProvider: env.MODEL_PROVIDER || 'mock',

  limits: {
    maxSelectionLength: parseIntSafe(env.MAX_SELECTION_LENGTH, 1200),
    minSelectionLength: parseIntSafe(env.MIN_SELECTION_LENGTH, 2),
    maxFollowUpLength: parseIntSafe(env.MAX_FOLLOWUP_LENGTH, 500),
    maxPayloadBytes: parseIntSafe(env.MAX_PAYLOAD_BYTES, 524288),
    maxFullTextLength: parseIntSafe(env.MAX_FULLTEXT_LENGTH, 50000),
    minFullTextChars: parseIntSafe(env.MIN_FULLTEXT_CHARS, 200),
    maxPdfFileSize,
    maxSummarizePayloadBytes: parseIntSafe(
      env.MAX_SUMMARIZE_PAYLOAD_BYTES,
      Math.ceil(maxPdfFileSize * 4 / 3) + 1048576
    ),
  },

  // Rate limiting (requests per minute per IP)
  rateLimit: {
    windowMs: 60 * 1000,
    max: parseIntSafe(env.RATE_LIMIT_MAX, 60),
  },

  // CORS — comma-separated list of allowed origins, or "*" for all
  corsOrigins: env.CORS_ORIGINS || '*',

  // API key for authentication. If empty, auth is disabled (mock/dev mode).
  apiKey: env.API_KEY || '',

  // Structured logging level (trace, debug, info, warn, error, fatal)
  logLevel: env.LOG_LEVEL || 'info',

  // Thread store (in-memory persistence for follow-up context)
  threadStore: {
    maxThreads: parseIntSafe(env.THREAD_STORE_MAX, 10000),
    ttlMs: parseIntSafe(env.THREAD_STORE_TTL_MS, 86400000),
  },

  // LLM provider defaults (can be overridden per-request via X-LLM-* headers)
  llm: {
    defaultModel: env.LLM_MODEL || 'gpt-4o-mini',
    defaultBaseUrl: env.LLM_BASE_URL || null,
    defaultApiKey: env.LLM_API_KEY || null,
    timeoutMs: parseIntSafe(env.LLM_TIMEOUT_MS, 30000),
  },

  // Document conversion (markitdown subprocess)
  conversion: {
    markitdownBin: env.MARKITDOWN_BIN || 'markitdown',
    pythonBin: resolvePythonBin(),
    timeoutMs: parseIntSafe(env.CONVERSION_TIMEOUT_MS, 60000),
    maxOutputBytes: parseIntSafe(env.CONVERSION_MAX_OUTPUT, 10485760),
  },

  // Summarize settings
  summarize: {
    chunkThreshold: parseIntSafe(env.SUMMARIZE_CHUNK_THRESHOLD, 30000),
    chunkSize: parseIntSafe(env.SUMMARIZE_CHUNK_SIZE, 25000),
    maxInputChars: parseIntSafe(env.SUMMARIZE_MAX_INPUT, 80000),
    model: env.SUMMARIZE_MODEL || null,
  },
};
