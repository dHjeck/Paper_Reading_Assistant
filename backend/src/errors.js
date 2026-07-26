/**
 * Custom API error class.
 *
 * Thrown by route handlers and services when a known error condition
 * is met.  The error handler middleware converts it into the standard
 * error response contract (backend-api-spec §10).
 */
export class ApiError extends Error {
  /**
   * @param {string} code   — one of the ErrorCode values from the spec
   * @param {string} message
   * @param {object} [opts]
   * @param {number} [opts.statusCode] — HTTP status code override
   * @param {boolean} [opts.retryable] — whether the client should retry
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable;
  }
}

/**
 * Convenience factory for common error scenarios.
 */
export const errors = {
  unauthorized: (msg = 'Authentication required.') =>
    new ApiError('UNAUTHORIZED', msg, { statusCode: 401, retryable: false }),

  forbidden: (msg = 'You do not have access to this resource.') =>
    new ApiError('FORBIDDEN', msg, { statusCode: 403, retryable: false }),

  invalidRequest: (msg = 'The request is invalid.') =>
    new ApiError('INVALID_REQUEST', msg, { statusCode: 400, retryable: false }),

  invalidSelection: (msg = 'The selected text is invalid or too long.') =>
    new ApiError('INVALID_SELECTION', msg, { statusCode: 400, retryable: false }),

  imageTooSmall: (msg = 'The selected image is too small to analyze reliably.') =>
    new ApiError('IMAGE_TOO_SMALL', msg, { statusCode: 400, retryable: false }),

  unsupportedPage: (msg = 'This page type is not supported for selection.') =>
    new ApiError('UNSUPPORTED_PAGE', msg, { statusCode: 400, retryable: false }),

  rateLimited: (msg = 'Rate limit exceeded. Please try again later.') =>
    new ApiError('RATE_LIMITED', msg, { statusCode: 429, retryable: true }),

  upstreamModelError: (msg = 'The model provider returned an error.') =>
    new ApiError('UPSTREAM_MODEL_ERROR', msg, { statusCode: 502, retryable: true }),

  timeout: (msg = 'The request timed out.') =>
    new ApiError('TIMEOUT', msg, { statusCode: 408, retryable: true }),

  conversionFailed: (msg = 'Document conversion failed.') =>
    new ApiError('CONVERSION_FAILED', msg, { statusCode: 500, retryable: false }),

  conversionTimeout: (msg = 'Document conversion timed out.') =>
    new ApiError('CONVERSION_TIMEOUT', msg, { statusCode: 504, retryable: true }),

  conversionUnavailable: (msg = 'Document conversion service is unavailable.') =>
    new ApiError('CONVERSION_UNAVAILABLE', msg, { statusCode: 503, retryable: false }),

  documentTooLarge: (msg = 'The document is too large to process.') =>
    new ApiError('DOCUMENT_TOO_LARGE', msg, { statusCode: 413, retryable: false }),

  emptyDocument: (msg = 'The document content is empty or too short to summarize.') =>
    new ApiError('EMPTY_DOCUMENT', msg, { statusCode: 400, retryable: false }),

  internal: (msg = 'An internal error occurred.') =>
    new ApiError('INTERNAL_ERROR', msg, { statusCode: 500, retryable: true }),
};
