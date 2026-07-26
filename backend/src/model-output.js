import { ApiError } from './errors.js';

const SUCCESS_STATUSES = new Set(['success', 'partial_success']);
const ERROR_STATUS_CODE_MAP = {
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
const RETRYABLE_CODES = new Set([
  'RATE_LIMITED',
  'UPSTREAM_MODEL_ERROR',
  'TIMEOUT',
  'INTERNAL_ERROR',
  'CONVERSION_TIMEOUT',
]);

function createApiErrorFromModelOutput(modelOutput, fallbackMessage) {
  const modelError = modelOutput && modelOutput.error ? modelOutput.error : null;
  const firstWarning =
    modelOutput && Array.isArray(modelOutput.warnings) && modelOutput.warnings.length > 0
      ? modelOutput.warnings[0]
      : null;
  const code =
    modelError && typeof modelError.code === 'string' && ERROR_STATUS_CODE_MAP[modelError.code]
      ? modelError.code
      : 'UPSTREAM_MODEL_ERROR';
  const message =
    (modelError && modelError.message) ||
    (firstWarning && firstWarning.message) ||
    fallbackMessage ||
    'Model provider request failed.';
  const retryable =
    modelError && typeof modelError.retryable === 'boolean'
      ? modelError.retryable
      : RETRYABLE_CODES.has(code);

  return new ApiError(code, message, {
    statusCode: ERROR_STATUS_CODE_MAP[code] || 500,
    retryable,
  });
}

export function normalizeModelOutput(modelOutput, fallbackMessage) {
  if (!modelOutput || typeof modelOutput !== 'object') {
    throw new ApiError(
      'INTERNAL_ERROR',
      fallbackMessage || 'Model provider returned an invalid response.',
      { statusCode: 500, retryable: true }
    );
  }

  if (modelOutput.status === 'error') {
    throw createApiErrorFromModelOutput(modelOutput, fallbackMessage);
  }

  if (!SUCCESS_STATUSES.has(modelOutput.status)) {
    throw new ApiError(
      'INTERNAL_ERROR',
      fallbackMessage || 'Model provider returned an invalid status.',
      { statusCode: 500, retryable: true }
    );
  }

  return {
    status: modelOutput.status,
    sections: Array.isArray(modelOutput.sections) ? modelOutput.sections : [],
    warnings: Array.isArray(modelOutput.warnings) ? modelOutput.warnings : [],
  };
}
