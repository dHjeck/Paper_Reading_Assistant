/**
 * Centralized error handler middleware.
 *
 * Catches any unhandled errors thrown during request processing
 * and converts them into the standard API error contract defined
 * in backend-api-spec §10.
 *
 * Must be registered as the last middleware in the Express app.
 */

/**
 * Map known error codes to HTTP status codes.
 * See backend-api-spec §10.3.
 */
const statusCodeMap = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_REQUEST: 400,
  INVALID_SELECTION: 400,
  IMAGE_TOO_SMALL: 400,
  UNSUPPORTED_PAGE: 400,
  RATE_LIMITED: 429,
  UPSTREAM_MODEL_ERROR: 502,
  TIMEOUT: 408,
  INTERNAL_ERROR: 500,
  CONVERSION_FAILED: 500,
  CONVERSION_TIMEOUT: 504,
  CONVERSION_UNAVAILABLE: 503,
  DOCUMENT_TOO_LARGE: 413,
  EMPTY_DOCUMENT: 400,
};

/**
 * Determine whether an error is safe to retry.
 */
const retryableCodes = new Set([
  'RATE_LIMITED',
  'UPSTREAM_MODEL_ERROR',
  'TIMEOUT',
  'INTERNAL_ERROR',
  'CONVERSION_TIMEOUT',
]);

/**
 * Map Express body-parser error types to API error codes and HTTP statuses.
 * Body-parser uses err.type (not err.code) and err.status (not err.statusCode).
 */
const bodyParserErrorMap = {
  'entity.parse.failed': { code: 'INVALID_REQUEST', statusCode: 400 },
  'entity.too.large': { code: 'INVALID_REQUEST', statusCode: 413 },
  'encoding.unsupported': { code: 'INVALID_REQUEST', statusCode: 415 },
  'request.aborted': { code: 'INVALID_REQUEST', statusCode: 400 },
};

/**
 * Normalize any thrown value into an API-compliant error object.
 *
 * @param {Error & {code?: string, statusCode?: number, retryable?: boolean}} err
 * @returns {{ code: string, message: string, retryable: boolean, statusCode: number }}
 */
export function normalizeError(err) {
  // Handle Express body-parser errors (they use err.type and err.status)
  if (err && err.type && bodyParserErrorMap[err.type]) {
    const mapping = bodyParserErrorMap[err.type];
    return {
      code: mapping.code,
      message: err.message || 'Request body error.',
      retryable: false,
      statusCode: mapping.statusCode,
    };
  }

  // If the error already carries a known API error code, use it.
  // Check both err.statusCode and err.status (Express convention).
  if (err && err.code && statusCodeMap[err.code]) {
    return {
      code: err.code,
      message: err.message || 'An error occurred.',
      retryable: err.retryable !== undefined ? err.retryable : retryableCodes.has(err.code),
      statusCode: err.statusCode || err.status || statusCodeMap[err.code],
    };
  }

  // If the error has an HTTP status property (Express/Node convention),
  // map it to the closest API error code.
  const httpStatus = (err && (err.statusCode || err.status)) || 500;
  if (httpStatus !== 500 && err && err.message) {
    const code =
      httpStatus === 400
        ? 'INVALID_REQUEST'
        : httpStatus === 401
          ? 'UNAUTHORIZED'
          : httpStatus === 403
            ? 'FORBIDDEN'
            : httpStatus === 408
              ? 'TIMEOUT'
              : httpStatus === 413
                ? 'INVALID_REQUEST'
                : httpStatus === 429
                  ? 'RATE_LIMITED'
                  : httpStatus === 502
                    ? 'UPSTREAM_MODEL_ERROR'
                    : 'INTERNAL_ERROR';
    return {
      code,
      message: err.message,
      retryable: retryableCodes.has(code),
      statusCode: httpStatus,
    };
  }

  // Fallback: treat as internal error (never leak raw stack to client)
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected internal error occurred.',
    retryable: true,
    statusCode: 500,
  };
}

// Express requires all four parameters (err, req, res, next) to identify
// this as error-handling middleware, even though `next` is not used.
export function errorHandlerMiddleware(err, req, res, _next) {
  const normalized = normalizeError(err);

  if (normalized.statusCode >= 500) {
    // Log full error server-side; client only sees the generic message
    req.log.error({ err }, 'Request error');
  } else if (normalized.statusCode >= 400) {
    // Log 4xx errors at warn level for observability
    req.log.warn(
      { statusCode: normalized.statusCode, code: normalized.code, message: normalized.message },
      'Client error'
    );
  }

  res.status(normalized.statusCode).json({
    requestId: req.requestId || 'req_unknown',
    status: 'error',
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
    },
  });
}
