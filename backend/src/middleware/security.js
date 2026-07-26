/**
 * Authentication and rate limiting middleware.
 *
 * Auth:  If config.apiKey is set, requests must include
 *        `Authorization: Bearer <key>` or `X-API-Key: <key>`.
 *        If config.apiKey is empty, auth is disabled (mock/dev mode).
 *
 * Rate limit:  Simple in-memory sliding-window limiter.
 *              Limits requests per IP per time window.
 */
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { errors } from '../errors.js';

// ── Auth Middleware ──────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns false immediately on length mismatch (timingSafeEqual throws otherwise).
 */
function safeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function authMiddleware(req, res, next) {
  // If no API key is configured, auth is disabled
  if (!config.apiKey) {
    return next();
  }

  // Accept token from Authorization: Bearer <key> or X-API-Key: <key>
  const authHeader = req.get('Authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const xApiKey = req.get('X-API-Key');

  const providedKey = (bearerMatch && bearerMatch[1]) || xApiKey || '';

  if (!providedKey || !safeCompare(providedKey, config.apiKey)) {
    return next(errors.unauthorized('Invalid or missing API key.'));
  }

  next();
}

// ── Rate Limit Middleware ───────────────────────────────────
//
// In-memory sliding window: maps IP → array of request timestamps.
// Prunes entries older than the window on each check.

const requestLog = new Map();

// Periodically purge stale IPs from the rate-limit map to prevent unbounded growth.
const CLEANUP_INTERVAL_MS = config.rateLimit.windowMs;
setInterval(() => {
  const cutoff = Date.now() - config.rateLimit.windowMs;
  for (const [ip, timestamps] of requestLog) {
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
    if (timestamps.length === 0) {
      requestLog.delete(ip);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

export function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = config.rateLimit.windowMs;
  const max = config.rateLimit.max;

  let timestamps = requestLog.get(ip);
  if (!timestamps) {
    timestamps = [];
    requestLog.set(ip, timestamps);
  }

  // Prune entries outside the sliding window
  const cutoff = now - windowMs;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= max) {
    const retryAfterSec = Math.ceil(windowMs / 1000);
    res.set('Retry-After', String(retryAfterSec));
    return next(errors.rateLimited());
  }

  timestamps.push(now);
  next();
}

// ── Security Headers ─────────────────────────────────────────

export function securityHeadersMiddleware(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Download-Options': 'noopen',
  });

  // HSTS only over HTTPS
  if (req.secure || req.get('X-Forwarded-Proto') === 'https') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}
