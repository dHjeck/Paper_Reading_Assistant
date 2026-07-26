# Paper Reading Assistant Backend API Contract

## 1. Document Goal

This document defines the V1 backend API contract for the Chrome extension.

Related documents:

- [paper-reading-assistant-extension-design.md](/D:/project/Paper_Reading_Assistant/docs/paper-reading-assistant-extension-design.md)
- [paper-reading-assistant-interaction-spec.md](/D:/project/Paper_Reading_Assistant/docs/paper-reading-assistant-interaction-spec.md)
- [paper-reading-assistant-side-panel-state-spec.md](/D:/project/Paper_Reading_Assistant/docs/paper-reading-assistant-side-panel-state-spec.md)

## 2. API Design Principles

1. Keep requests scoped to the user's current selection.
2. Return structured JSON, not free-form markdown blobs.
3. Separate success, partial success, and error clearly.
4. Make responses renderable by the side panel without post-hoc parsing.
5. Preserve source context so results can be stored and reopened locally.

## 3. V1 Endpoint Scope

V1 includes:

- `POST /api/explain-text`
- `POST /api/explain-figure`
- `POST /api/follow-up`
- `GET /api/health`

V1 excludes:

- User sync APIs
- Billing APIs
- Full paper ingestion APIs
- Batch summarization APIs

## 4. Common Conventions

### 4.1 Content Type

Requests:

- `Content-Type: application/json`

Responses:

- `Content-Type: application/json`

### 4.2 Authentication

Recommended V1 approach:

- `Authorization: Bearer <token>`

If V1 starts without user accounts, the backend may temporarily accept a project API key from the extension backend layer, but the extension client should still be designed to support bearer auth later.

### 4.3 Request ID

Each response should include:

- `requestId`

Purpose:

- Log correlation
- Retry debugging
- Client-side tracing

### 4.4 Timestamps

All timestamps should use ISO 8601 UTC format, for example:

- `2026-07-22T10:05:00Z`

### 4.5 Result Status

Allowed result statuses:

- `success`
- `partial_success`
- `error`

`partial_success` is used when the model returns a useful answer but cannot reliably interpret all details.

## 5. Shared Data Shapes

### 5.1 Paper Context

```json
{
  "paperId": "paper_123",
  "title": "Attention Is All You Need",
  "url": "https://example.com/paper.pdf",
  "sourceType": "pdf",
  "pageNumber": 4,
  "authors": ["Ashish Vaswani", "Noam Shazeer"]
}
```

### 5.2 Text Selection

```json
{
  "selectionId": "sel_123",
  "text": "selected text",
  "context": "nearby paragraph text",
  "pageNumber": 4
}
```

### 5.3 Figure Selection

```json
{
  "figureId": "fig_123",
  "imageData": {
    "mimeType": "image/png",
    "dataUrl": "data:image/png;base64,iVBORw0KGgoAAA..."
  },
  "thumbnailRef": "thumb_abc123",
  "caption": "Figure 2: Model architecture",
  "pageNumber": 5,
  "boundingBox": {
    "x": 120,
    "y": 300,
    "width": 420,
    "height": 260
  }
}
```

### 5.4 Response Section

```json
{
  "title": "Plain Explanation",
  "content": "This paragraph says ..."
}
```

### 5.5 Warning Item

```json
{
  "code": "LOW_IMAGE_CONFIDENCE",
  "message": "Some labels are too small to read reliably."
}
```

## 6. Endpoint: `POST /api/explain-text`

### 6.1 Purpose

Generate a structured explanation for selected text.

### 6.2 Request Body

```json
{
  "paper": {
    "paperId": "paper_123",
    "title": "Attention Is All You Need",
    "url": "https://example.com/paper.pdf",
    "sourceType": "pdf",
    "pageNumber": 4
  },
  "selection": {
    "selectionId": "sel_123",
    "text": "The Transformer uses multi-head attention ...",
    "context": "Full nearby paragraph text ...",
    "pageNumber": 4
  },
  "action": "explain",
  "client": {
    "platform": "chrome-extension",
    "version": "0.1.0"
  }
}
```

### 6.3 Request Rules

- `action` must be one of:
  - `explain`
  - `simplify`
  - `define`
- `selection.text` is required
- `selection.context` is optional but recommended
- `paper.title` and `paper.url` should be sent when known

### 6.4 Success Response

```json
{
  "requestId": "req_123",
  "status": "success",
  "result": {
    "resultId": "result_123",
    "threadId": "thread_123",
    "sourceType": "text",
    "action": "explain",
    "sections": [
      {
        "title": "Plain Explanation",
        "content": "This paragraph explains ..."
      },
      {
        "title": "Why It Matters",
        "content": "This matters because ..."
      },
      {
        "title": "Key Terms",
        "content": "Multi-head attention means ..."
      }
    ],
    "warnings": [],
    "createdAt": "2026-07-22T10:06:00Z"
  }
}
```

### 6.5 Partial Success Response

```json
{
  "requestId": "req_124",
  "status": "partial_success",
  "result": {
    "resultId": "result_124",
    "threadId": "thread_124",
    "sourceType": "text",
    "action": "define",
    "sections": [
      {
        "title": "Definition",
        "content": "The term likely means ..."
      }
    ],
    "warnings": [
      {
        "code": "LIMITED_CONTEXT",
        "message": "The selected phrase is ambiguous without more context."
      }
    ],
    "createdAt": "2026-07-22T10:07:00Z"
  }
}
```

## 7. Endpoint: `POST /api/explain-figure`

### 7.1 Purpose

Generate a structured explanation for a selected figure or image region.

### 7.2 Request Body

```json
{
  "paper": {
    "paperId": "paper_123",
    "title": "Attention Is All You Need",
    "url": "https://example.com/paper.pdf",
    "sourceType": "pdf",
    "pageNumber": 5
  },
  "figure": {
    "figureId": "fig_123",
    "imageData": {
      "mimeType": "image/png",
      "dataUrl": "data:image/png;base64,iVBORw0KGgoAAA..."
    },
    "thumbnailRef": "thumb_abc123",
    "caption": "Figure 2: Model architecture",
    "pageNumber": 5,
    "boundingBox": {
      "x": 120,
      "y": 300,
      "width": 420,
      "height": 260
    }
  },
  "action": "explain_figure",
  "client": {
    "platform": "chrome-extension",
    "version": "0.1.0"
  }
}
```

### 7.3 Request Rules

- At least one of `figure.imageRef` or `figure.imageData` is required
- `action` must be `explain_figure`
- `figure.imageData` is recommended for PDF drag-capture flows
- `figure.imageRef` remains valid for right-click image flows or pre-uploaded assets
- `figure.caption` is optional
- `boundingBox` is optional but recommended for traceability

### 7.4 Success Response

```json
{
  "requestId": "req_125",
  "status": "success",
  "result": {
    "resultId": "result_125",
    "threadId": "thread_125",
    "sourceType": "figure",
    "action": "explain_figure",
    "sections": [
      {
        "title": "What This Figure Shows",
        "content": "This figure compares ..."
      },
      {
        "title": "How To Read It",
        "content": "The x-axis represents ..."
      },
      {
        "title": "Main Takeaway",
        "content": "The main conclusion is ..."
      }
    ],
    "warnings": [],
    "createdAt": "2026-07-22T10:08:00Z"
  }
}
```

### 7.5 Partial Success Response

```json
{
  "requestId": "req_126",
  "status": "partial_success",
  "result": {
    "resultId": "result_126",
    "threadId": "thread_126",
    "sourceType": "figure",
    "action": "explain_figure",
    "sections": [
      {
        "title": "What This Figure Shows",
        "content": "This looks like a comparison chart ..."
      },
      {
        "title": "Main Takeaway",
        "content": "The selected region suggests ..."
      }
    ],
    "warnings": [
      {
        "code": "LOW_IMAGE_CONFIDENCE",
        "message": "Some labels are too small to read reliably."
      }
    ],
    "createdAt": "2026-07-22T10:08:30Z"
  }
}
```

## 8. Endpoint: `POST /api/follow-up`

### 8.1 Purpose

Ask one contextual follow-up question about the latest result thread.

### 8.2 Request Body

```json
{
  "threadId": "thread_123",
  "sourceResultId": "result_123",
  "question": "Why is this important?",
  "client": {
    "platform": "chrome-extension",
    "version": "0.1.0"
  }
}
```

### 8.3 Request Rules

- `threadId` is required
- `sourceResultId` is required
- `question` is required
- `question` should be short in V1

### 8.4 Success Response

```json
{
  "requestId": "req_127",
  "status": "success",
  "followUp": {
    "followUpId": "fu_123",
    "threadId": "thread_123",
    "sourceResultId": "result_123",
    "question": "Why is this important?",
    "sections": [
      {
        "title": "Answer",
        "content": "This is important because ..."
      }
    ],
    "warnings": [],
    "createdAt": "2026-07-22T10:09:00Z"
  }
}
```

## 9. Endpoint: `GET /api/health`

### 9.1 Purpose

Provide a lightweight connectivity and service-status check for the extension.

### 9.2 Success Response

```json
{
  "status": "ok",
  "service": "paper-reading-assistant-api",
  "time": "2026-07-22T10:10:00Z"
}
```

### 9.3 Degraded Response

```json
{
  "status": "degraded",
  "service": "paper-reading-assistant-api",
  "time": "2026-07-22T10:10:10Z"
}
```

## 10. Error Contract

### 10.1 Error Response Shape

All non-2xx responses should use:

```json
{
  "requestId": "req_500",
  "status": "error",
  "error": {
    "code": "INVALID_SELECTION",
    "message": "The selected text is too long.",
    "retryable": false
  }
}
```

### 10.2 Error Codes

Recommended V1 error codes:

- `UNAUTHORIZED`
- `FORBIDDEN`
- `INVALID_REQUEST`
- `INVALID_SELECTION`
- `IMAGE_TOO_SMALL`
- `UNSUPPORTED_PAGE`
- `RATE_LIMITED`
- `UPSTREAM_MODEL_ERROR`
- `TIMEOUT`
- `INTERNAL_ERROR`

### 10.3 Status Code Mapping

- `200` success or partial success
- `400` invalid request
- `401` unauthorized
- `403` forbidden
- `404` resource not found when applicable
- `408` request timeout if exposed intentionally
- `409` conflict when thread state is invalid
- `413` payload too large
- `429` rate limited
- `500` internal error
- `502` upstream model provider failure
- `503` service unavailable

## 11. JSON Schema Reference

The schemas below are intentionally compact and sufficient for V1 validation.

### 11.1 Explain Text Request Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["paper", "selection", "action", "client"],
  "properties": {
    "paper": {
      "type": "object",
      "required": ["title", "url", "sourceType"],
      "properties": {
        "paperId": { "type": "string" },
        "title": { "type": "string", "minLength": 1 },
        "url": { "type": "string", "minLength": 1 },
        "sourceType": { "type": "string", "enum": ["pdf", "html"] },
        "pageNumber": { "type": "integer", "minimum": 1 },
        "authors": {
          "type": "array",
          "items": { "type": "string" }
        }
      },
      "additionalProperties": false
    },
    "selection": {
      "type": "object",
      "required": ["text"],
      "properties": {
        "selectionId": { "type": "string" },
        "text": { "type": "string", "minLength": 1 },
        "context": { "type": "string" },
        "pageNumber": { "type": "integer", "minimum": 1 }
      },
      "additionalProperties": false
    },
    "action": {
      "type": "string",
      "enum": ["explain", "simplify", "define"]
    },
    "client": {
      "type": "object",
      "required": ["platform", "version"],
      "properties": {
        "platform": { "type": "string" },
        "version": { "type": "string" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### 11.2 Explain Figure Request Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["paper", "figure", "action", "client"],
  "properties": {
    "paper": {
      "type": "object",
      "required": ["title", "url", "sourceType"],
      "properties": {
        "paperId": { "type": "string" },
        "title": { "type": "string", "minLength": 1 },
        "url": { "type": "string", "minLength": 1 },
        "sourceType": { "type": "string", "enum": ["pdf", "html"] },
        "pageNumber": { "type": "integer", "minimum": 1 }
      },
      "additionalProperties": false
    },
    "figure": {
      "type": "object",
      "anyOf": [
        { "required": ["imageRef"] },
        { "required": ["imageData"] }
      ],
      "properties": {
        "figureId": { "type": "string" },
        "imageRef": { "type": "string", "minLength": 1 },
        "imageData": {
          "type": "object",
          "required": ["mimeType", "dataUrl"],
          "properties": {
            "mimeType": { "type": "string", "minLength": 1 },
            "dataUrl": { "type": "string", "minLength": 1 }
          },
          "additionalProperties": false
        },
        "thumbnailRef": { "type": "string" },
        "caption": { "type": "string" },
        "pageNumber": { "type": "integer", "minimum": 1 },
        "boundingBox": {
          "type": "object",
          "required": ["x", "y", "width", "height"],
          "properties": {
            "x": { "type": "number" },
            "y": { "type": "number" },
            "width": { "type": "number", "exclusiveMinimum": 0 },
            "height": { "type": "number", "exclusiveMinimum": 0 }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    },
    "action": {
      "type": "string",
      "const": "explain_figure"
    },
    "client": {
      "type": "object",
      "required": ["platform", "version"],
      "properties": {
        "platform": { "type": "string" },
        "version": { "type": "string" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### 11.3 Success Response Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["requestId", "status", "result"],
  "properties": {
    "requestId": { "type": "string" },
    "status": {
      "type": "string",
      "enum": ["success", "partial_success"]
    },
    "result": {
      "type": "object",
      "required": [
        "resultId",
        "threadId",
        "sourceType",
        "action",
        "sections",
        "warnings",
        "createdAt"
      ],
      "properties": {
        "resultId": { "type": "string" },
        "threadId": { "type": "string" },
        "sourceType": { "type": "string", "enum": ["text", "figure"] },
        "action": { "type": "string" },
        "sections": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["title", "content"],
            "properties": {
              "title": { "type": "string" },
              "content": { "type": "string" }
            },
            "additionalProperties": false
          }
        },
        "warnings": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["code", "message"],
            "properties": {
              "code": { "type": "string" },
              "message": { "type": "string" }
            },
            "additionalProperties": false
          }
        },
        "createdAt": { "type": "string" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### 11.4 Error Response Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["requestId", "status", "error"],
  "properties": {
    "requestId": { "type": "string" },
    "status": { "type": "string", "const": "error" },
    "error": {
      "type": "object",
      "required": ["code", "message", "retryable"],
      "properties": {
        "code": { "type": "string" },
        "message": { "type": "string" },
        "retryable": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

## 12. Backend Prompting Boundary

The API layer should normalize input and call the model with strict output instructions.

Recommended backend responsibilities:

- Trim and sanitize selection text
- Enforce max selection length
- Attach prompt templates based on action type
- Validate model output against response schema
- Downgrade weak model output into `partial_success` when necessary

The extension client should not be responsible for parsing unstructured model text into sections.

## 13. Recommended Validation Rules

- Reject empty text selections
- Reject empty follow-up questions
- Reject figure requests missing both `imageRef` and `imageData`
- Reject oversized payloads explicitly
- Return `partial_success` rather than `success` when confidence is limited

## 14. Acceptance Checklist

The backend contract is acceptable for V1 if:

- Frontend can render every success response without heuristic parsing
- Partial-success responses carry actionable warning metadata
- Error responses are consistent across endpoints
- Text, figure, and follow-up flows all preserve `threadId`
- Schemas are strict enough to catch malformed requests and responses early
