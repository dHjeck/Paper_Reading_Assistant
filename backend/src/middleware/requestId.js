/**
 * Request ID middleware.
 *
 * Attaches a unique `requestId` to every request, either from an
 * incoming `X-Request-Id` header or freshly generated.  The ID
 * is stored on `req.requestId` and echoed in all responses via
 * the `X-Request-Id` header.
 */
import { createId } from '../utils.js';

// Safe pattern for request IDs: alphanumeric, underscore, hyphen, max 128 chars.
// Prevents header injection, log injection, and response splitting attacks.
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function requestIdMiddleware(req, res, next) {
  const headerId = req.get('X-Request-Id');
  // Only accept client-provided IDs that match the safe pattern;
  // otherwise generate a fresh one to prevent injection attacks.
  req.requestId = headerId && REQUEST_ID_PATTERN.test(headerId) ? headerId : createId('req');
  res.set('X-Request-Id', req.requestId);
  next();
}
