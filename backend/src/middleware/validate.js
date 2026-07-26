/**
 * Request validation middleware (AJV).
 *
 * Compiles a JSON Schema once and validates the request body
 * against it on every request.  On failure, returns a 400 with
 * a structured error response listing the validation issues.
 */
import Ajv from 'ajv';

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  // The explain-figure schema uses anyOf with required to express
  // "at least one of imageRef / imageData must be present".
  // strictRequired flags this valid JSON Schema pattern, so disable it.
  strictRequired: false,
  useDefaults: false,
});

// Custom format: "uri" — validates that a string is a well-formed URI
// with an allowed scheme (http, https).  This prevents SSRF via
// javascript:, file:, data: schemes.
ajv.addFormat('uri', value => {
  if (typeof value !== 'string' || value.length === 0) {
    return true;
  } // let minLength handle empty
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
});

// Use "uri" format on paper.url by adding a format keyword to the schema
// at compile time via a macro — we patch the schema before compilation.
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Create a validation middleware bound to a specific schema.
 *
 * @param {object} schema — AJV-compatible JSON Schema object
 * @returns {(req, res, next) => void} Express middleware
 */
export function createValidator(schema) {
  // Patch paper.url to use the "uri" format if not already set
  if (
    schema.properties &&
    schema.properties.paper &&
    schema.properties.paper.properties &&
    schema.properties.paper.properties.url
  ) {
    schema.properties.paper.properties.url.format = 'uri';
  }

  const validate = ajv.compile(schema);

  return function validateRequest(req, res, next) {
    const valid = validate(req.body);

    if (!valid) {
      // In production, return a generic message to avoid leaking schema structure.
      // In development, include detailed AJV errors for debugging.
      let message;
      if (isProduction) {
        message = 'Request body does not match the expected schema.';
      } else {
        const details = (validate.errors || []).map(err => {
          const path = err.instancePath || '/';
          return `${path}: ${err.message}`;
        });
        message = details.length
          ? `Request validation failed: ${details.join('; ')}`
          : 'Request body does not match the expected schema.';
      }

      return res.status(400).json({
        requestId: req.requestId || 'req_unknown',
        status: 'error',
        error: {
          code: 'INVALID_REQUEST',
          message,
          retryable: false,
        },
      });
    }

    next();
  };
}
