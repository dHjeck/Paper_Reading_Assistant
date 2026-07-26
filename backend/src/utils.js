/**
 * Shared utility helpers used across all backend modules.
 *
 * These intentionally mirror the extension-side helpers in
 * src/shared/contracts.js so that IDs and timestamps stay
 * consistent between client and server.
 */

import { randomUUID } from 'node:crypto';

/**
 * Generate a short random ID with a prefix using crypto.randomUUID().
 * @param {string} prefix
 * @returns {string} e.g. "req_a1b2c3d4"
 */
export function createId(prefix) {
  // Use the first 8 chars of a UUID for brevity; full UUID is 122 bits of entropy.
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${prefix}_${suffix}`;
}

/**
 * Current timestamp in ISO 8601 UTC format.
 * @returns {string} e.g. "2026-07-22T10:06:00.123Z"
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Collapse repeated whitespace and trim.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Escape HTML special characters in user-provided text to prevent XSS
 * if the frontend ever renders model output via innerHTML.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Truncate text to a max length, appending an ellipsis.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function truncate(text, max) {
  const safeText = text || '';
  if (safeText.length <= max) {
    return safeText;
  }
  return `${safeText.slice(0, max)}...`;
}
