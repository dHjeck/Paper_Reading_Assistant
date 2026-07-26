/**
 * JSON Schema definitions for request validation.
 *
 * These mirror the schemas in docs/paper-reading-assistant-backend-api-spec.md
 * §11 and are used by the AJV validation middleware.
 */

// ── Reusable Sub-schemas ──────────────────────────────────

const paperSchema = {
  type: 'object',
  required: ['title', 'url', 'sourceType'],
  properties: {
    paperId: { type: 'string', maxLength: 200 },
    title: { type: 'string', minLength: 1, maxLength: 1000 },
    // URI format is enforced by the custom keyword in validate.js;
    // we also constrain length to prevent abuse.
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    sourceType: { type: 'string', enum: ['pdf', 'html'] },
    pageNumber: { type: 'integer', minimum: 1, maximum: 100000 },
    authors: {
      type: 'array',
      maxItems: 100,
      items: { type: 'string', maxLength: 300 },
    },
  },
  additionalProperties: false,
};

const clientSchema = {
  type: 'object',
  required: ['platform', 'version'],
  properties: {
    platform: { type: 'string', maxLength: 100 },
    version: { type: 'string', maxLength: 50 },
  },
  additionalProperties: false,
};

const boundingBoxSchema = {
  type: 'object',
  required: ['x', 'y', 'width', 'height'],
  properties: {
    x: { type: 'number', minimum: 0 },
    y: { type: 'number', minimum: 0 },
    width: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
    height: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
  },
  additionalProperties: false,
};

const imageDataSchema = {
  type: 'object',
  required: ['mimeType', 'dataUrl'],
  properties: {
    // Only allow image MIME types
    mimeType: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      enum: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'],
    },
    // dataUrl must start with data:image/...;base64,
    dataUrl: {
      type: 'string',
      minLength: 1,
      maxLength: 1048576, // 1MB max for base64 data URL
      pattern: '^data:image/[a-z+]+;base64,[A-Za-z0-9+/=]+$',
    },
  },
  additionalProperties: false,
};

// ── Request Schemas ──────────────────────────────────────

export const explainTextRequestSchema = {
  type: 'object',
  required: ['paper', 'selection', 'action', 'client'],
  properties: {
    paper: paperSchema,
    selection: {
      type: 'object',
      required: ['text'],
      properties: {
        selectionId: { type: 'string', maxLength: 200 },
        text: { type: 'string', minLength: 1, maxLength: 10000 },
        context: { type: 'string', maxLength: 10000 },
        pageNumber: { type: 'integer', minimum: 1, maximum: 100000 },
      },
      additionalProperties: false,
    },
    action: {
      type: 'string',
      enum: ['explain', 'simplify', 'define'],
    },
    client: clientSchema,
  },
  additionalProperties: false,
};

export const explainFigureRequestSchema = {
  type: 'object',
  required: ['paper', 'figure', 'action', 'client'],
  properties: {
    paper: paperSchema,
    figure: {
      type: 'object',
      anyOf: [{ required: ['imageRef'] }, { required: ['imageData'] }],
      properties: {
        figureId: { type: 'string', maxLength: 200 },
        imageRef: { type: 'string', minLength: 1, maxLength: 2048 },
        imageData: imageDataSchema,
        thumbnailRef: { type: 'string', maxLength: 1048576 },
        caption: { type: 'string', maxLength: 1000 },
        pageNumber: { type: 'integer', minimum: 1, maximum: 100000 },
        boundingBox: boundingBoxSchema,
      },
      additionalProperties: false,
    },
    action: {
      type: 'string',
      const: 'explain_figure',
    },
    client: clientSchema,
  },
  additionalProperties: false,
};

export const followUpRequestSchema = {
  type: 'object',
  required: ['threadId', 'sourceResultId', 'question', 'client'],
  properties: {
    threadId: { type: 'string', minLength: 1, maxLength: 200 },
    sourceResultId: { type: 'string', minLength: 1, maxLength: 200 },
    question: { type: 'string', minLength: 1, maxLength: 2000 },
    client: clientSchema,
  },
  additionalProperties: false,
};

export const testLlmRequestSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const documentSchema = {
  type: 'object',
  required: ['kind'],
  properties: {
    kind: { type: 'string', enum: ['html', 'pdf_file'] },
    html: { type: 'string', maxLength: 2097152 },
    fullText: { type: 'string', maxLength: 100000 },
    fileData: { type: 'string', maxLength: 41943040 },
    filename: { type: 'string', maxLength: 500 },
    fileSize: { type: 'integer', minimum: 0 },
    pageCount: { type: 'integer', minimum: 0, maximum: 100000 },
    charCount: { type: 'integer', minimum: 0 },
    extractionMethod: { type: 'string', maxLength: 100 },
  },
  additionalProperties: false,
};

export const summarizeRequestSchema = {
  type: 'object',
  required: ['paper', 'document', 'action', 'client'],
  properties: {
    paper: paperSchema,
    document: documentSchema,
    action: {
      type: 'string',
      const: 'summarize',
    },
    client: clientSchema,
  },
  additionalProperties: false,
};

// ── Response Schemas (for self-validation) ───────────────

export const resultResponseSchema = {
  type: 'object',
  required: ['requestId', 'status', 'result'],
  properties: {
    requestId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['success', 'partial_success'],
    },
    result: {
      type: 'object',
      required: [
        'resultId',
        'threadId',
        'sourceType',
        'action',
        'sections',
        'warnings',
        'createdAt',
      ],
      properties: {
        resultId: { type: 'string' },
        threadId: { type: 'string' },
        sourceType: { type: 'string', enum: ['text', 'figure', 'document'] },
        action: { type: 'string' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'content'],
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        warnings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        createdAt: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const followUpResponseSchema = {
  type: 'object',
  required: ['requestId', 'status', 'followUp'],
  properties: {
    requestId: { type: 'string' },
    status: {
      type: 'string',
      enum: ['success', 'partial_success'],
    },
    followUp: {
      type: 'object',
      required: [
        'followUpId',
        'threadId',
        'sourceResultId',
        'question',
        'sections',
        'warnings',
        'createdAt',
      ],
      properties: {
        followUpId: { type: 'string' },
        threadId: { type: 'string' },
        sourceResultId: { type: 'string' },
        question: { type: 'string' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'content'],
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        warnings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        createdAt: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const errorResponseSchema = {
  type: 'object',
  required: ['requestId', 'status', 'error'],
  properties: {
    requestId: { type: 'string' },
    status: { type: 'string', const: 'error' },
    error: {
      type: 'object',
      required: ['code', 'message', 'retryable'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const healthResponseSchema = {
  type: 'object',
  required: ['requestId', 'status', 'service', 'time'],
  properties: {
    requestId: { type: 'string' },
    status: { type: 'string', enum: ['ok', 'degraded'] },
    service: { type: 'string' },
    time: { type: 'string' },
  },
  additionalProperties: false,
};

// ── Schema Registry ──────────────────────────────────────

export const schemas = {
  explainTextRequest: explainTextRequestSchema,
  explainFigureRequest: explainFigureRequestSchema,
  followUpRequest: followUpRequestSchema,
  testLlmRequest: testLlmRequestSchema,
  summarizeRequest: summarizeRequestSchema,
  resultResponse: resultResponseSchema,
  followUpResponse: followUpResponseSchema,
  errorResponse: errorResponseSchema,
  healthResponse: healthResponseSchema,
};
