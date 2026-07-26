/**
 * Structured logger with request-scoped context.
 *
 * Uses pino for JSON-formatted output and AsyncLocalStorage so that
 * any code (including non-middleware modules like the model adapter)
 * can obtain the current request's child logger without explicit
 * parameter passing.
 */
import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

const root = pino({
  level: config.logLevel || 'info',
  // pino-http serializes request headers by default. Keep credentials out
  // of terminal output, log files, CI artifacts, and copied bug reports.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-llm-api-key"]',
      'req.raw.headers.authorization',
      'req.raw.headers.cookie',
      'req.raw.headers["x-api-key"]',
      'req.raw.headers["x-llm-api-key"]',
    ],
    censor: '[REDACTED]',
  },
});
const als = new AsyncLocalStorage();

/**
 * Execute `fn` inside an AsyncLocalStorage context bound to `logger`.
 * Typically called once per request from the pino-http middleware.
 *
 * @param {import("pino").Logger} logger
 * @param {Function} fn
 * @returns {*}
 */
export function runWithLogger(logger, fn) {
  return als.run(logger, fn);
}

/**
 * Retrieve the request-scoped child logger.
 * Falls back to the root logger when called outside a request context
 * (e.g. during startup or in background timers).
 *
 * @returns {import("pino").Logger}
 */
export function getLogger() {
  return als.getStore() || root;
}

export { root as logger };
