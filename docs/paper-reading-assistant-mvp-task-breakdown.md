# Paper Reading Assistant MVP Task Breakdown

## 1. Document Goal

This document turns the V1 product and interaction specs into an executable engineering plan.

Related documents:

- [paper-reading-assistant-extension-design.md](/D:/project/Paper_Reading_Assistant/docs/paper-reading-assistant-extension-design.md)
- [paper-reading-assistant-interaction-spec.md](/D:/project/Paper_Reading_Assistant/docs/paper-reading-assistant-interaction-spec.md)
- [paper-reading-assistant-side-panel-state-spec.md](/D:/project/Paper_Reading_Assistant/docs/paper-reading-assistant-side-panel-state-spec.md)
- [paper-reading-assistant-backend-api-spec.md](/D:/project/Paper_Reading_Assistant/docs/paper-reading-assistant-backend-api-spec.md)

## 2. MVP Objective

Ship a Chrome-only extension that lets a student:

- highlight text in a paper and request `Explain`, `Simplify`, or `Define`
- capture a figure region and request `Explain Figure`
- view results in a side panel
- save useful outputs locally as notes
- ask one follow-up question on the latest result

## 3. Delivery Strategy

Recommended implementation order:

1. Extension shell and side panel foundation
2. Text selection flow end to end
3. Backend text explanation endpoint
4. Figure capture flow end to end
5. Save and history
6. Follow-up flow
7. Hardening, analytics, and QA

## 4. Workstreams

Primary workstreams:

- Extension foundation
- Side panel UI and state
- Text selection flow
- Figure capture flow
- Backend API and model orchestration
- Local persistence
- QA and release hardening

## 5. Milestone Plan

### Milestone 1: Usable Skeleton

Goal:

- Extension loads in Chrome
- Side panel opens
- Basic panel layout renders

### Milestone 2: Text Explain End to End

Goal:

- User can highlight text and get a structured result in the side panel

### Milestone 3: Figure Explain End to End

Goal:

- User can drag-select a figure and get a structured result in the side panel

### Milestone 4: Learning Workflow

Goal:

- User can save results locally, revisit history, and ask one follow-up

### Milestone 5: Ship Readiness

Goal:

- Core flows are reliable enough for internal testing or first beta

## 6. Detailed Task Breakdown

## 6.1 Workstream A: Extension Foundation

### A1. Initialize Chrome Extension Project

Deliverables:

- Manifest V3 scaffold
- Build setup
- Extension folder structure
- Local development run instructions

Suggested outputs:

- `manifest.json`
- `src/background/`
- `src/content/`
- `src/side-panel/`
- `src/popup/`
- `src/shared/`

Acceptance:

- Extension can be loaded as an unpacked extension in Chrome
- Background worker starts without runtime errors
- Side panel entry is registered

Dependencies:

- None

### A2. Create Shared Type Definitions

Deliverables:

- Shared TypeScript types for paper context, selection payloads, result payloads, saved items, and error responses

Acceptance:

- Frontend modules compile against shared API and state types

Dependencies:

- A1

### A3. Runtime Message Layer

Deliverables:

- Internal message contract between content script, background worker, and side panel

Acceptance:

- Side panel can receive a test event from background worker
- Content script can dispatch a test action

Dependencies:

- A1
- A2

## 6.2 Workstream B: Side Panel UI and State

### B1. Implement Side Panel Shell

Deliverables:

- Header
- Tab bar
- Empty content area

Acceptance:

- Side panel shows `Current`, `Saved`, and `History`
- Header shows placeholder paper info and settings entry

Dependencies:

- A1
- A2

### B2. Implement Panel Store and State Machine

Deliverables:

- Panel state store
- State transitions for empty, loading, success, partial success, and error

Acceptance:

- Mock events can move the panel through all core states
- Tab switching does not reset current result state

Dependencies:

- A2
- A3
- B1

### B3. Implement Result Card Components

Deliverables:

- Text result card
- Figure result card
- Warning banner
- Action row

Acceptance:

- Structured JSON response can render without manual string parsing

Dependencies:

- B2

### B4. Implement Saved and History Views

Deliverables:

- Saved list
- History list
- Reopen history into `Current`

Acceptance:

- Mock saved items display correctly
- Clicking a history item restores its thread into `Current`

Dependencies:

- B2
- G1

### B5. Implement Follow-Up Composer UI

Deliverables:

- Inline input for follow-up
- Loading and error states for follow-up

Acceptance:

- User can type and submit a follow-up on the active thread
- Failed follow-up preserves input text

Dependencies:

- B2
- E5

## 6.3 Workstream C: Text Selection Flow

### C1. Selection Detection in Content Script

Deliverables:

- Detect valid text selection
- Extract selected text
- Extract nearby context when possible

Acceptance:

- Valid selection emits a normalized payload
- Empty or whitespace-only selection is ignored

Dependencies:

- A1
- A2

### C2. Floating Toolbar UI

Deliverables:

- Toolbar rendering
- Positioning logic
- Dismiss behavior

Acceptance:

- Toolbar appears on valid selection
- Toolbar dismisses on outside click or `Escape`
- Toolbar stays within viewport bounds

Dependencies:

- C1

### C3. Toolbar Action Wiring

Deliverables:

- `Explain`
- `Simplify`
- `Define`
- `Save`

Acceptance:

- Clicking an action sends the correct event to background worker
- Side panel opens automatically on explanation actions

Dependencies:

- A3
- B2
- C2

### C4. Text Flow End-to-End Integration

Deliverables:

- Full selection-to-response path using backend API

Acceptance:

- User can highlight text and receive a response in side panel
- Error state displays retry path when backend fails

Dependencies:

- C3
- E2
- E3

## 6.4 Workstream D: Figure Capture Flow

### D1. Figure Capture Entry Points

Deliverables:

- `Start Figure Selection` button in side panel
- Context menu support for image explanation where applicable

Acceptance:

- User can enter figure mode from side panel
- Image context-menu action is registered

Dependencies:

- A1
- A3
- B1

### D2. Capture Overlay Implementation

Deliverables:

- Full-screen overlay
- Drag-to-select rectangle
- Confirm and cancel actions

Acceptance:

- User can select a visible region
- `Use This Region`, `Select Again`, and `Cancel` all work

Dependencies:

- D1

### D3. Visible Region Capture

Deliverables:

- Capture image region from current page view
- Produce preview reference or blob

Acceptance:

- Selected region becomes a usable image payload
- Small-image warning can be surfaced before submit

Dependencies:

- D2

### D4. Figure Flow End-to-End Integration

Deliverables:

- Full capture-to-response path using backend API

Acceptance:

- User can capture a figure region and receive a structured explanation
- User can re-crop after a result or after a failed request

Dependencies:

- D3
- E4

## 6.5 Workstream E: Backend API and Model Orchestration

### E1. Backend Service Scaffold

Deliverables:

- API project scaffold
- Basic routing
- Health endpoint
- Environment configuration

Acceptance:

- `GET /api/health` returns a valid status response

Dependencies:

- None

### E2. Implement `POST /api/explain-text`

Deliverables:

- Request validation
- Prompt assembly
- Model call
- Response shaping

Acceptance:

- Endpoint accepts `explain`, `simplify`, and `define`
- Response matches documented schema

Dependencies:

- E1

### E3. Implement Text Endpoint Error Handling

Deliverables:

- Error mapping
- Retryable vs non-retryable response behavior
- Selection size validation

Acceptance:

- Invalid input returns stable error schema
- Upstream failures do not leak raw provider errors

Dependencies:

- E2

### E4. Implement `POST /api/explain-figure`

Deliverables:

- Figure request validation
- Multimodal model call
- Partial-success handling for low-confidence cases

Acceptance:

- Endpoint accepts image-based payloads
- Response matches documented schema

Dependencies:

- E1

### E5. Implement `POST /api/follow-up`

Deliverables:

- Thread-based follow-up request handling
- Response shaping for follow-up answers

Acceptance:

- Follow-up returns structured sections
- Invalid thread references return stable error schema

Dependencies:

- E2
- E4

### E6. Structured Output Validation

Deliverables:

- Backend-side validation against response schema
- Fallback behavior when model output is malformed

Acceptance:

- Invalid model output is not passed directly to client
- Backend can downgrade uncertain output to `partial_success`

Dependencies:

- E2
- E4
- E5

## 6.6 Workstream F: Background Worker and Networking

### F1. Background Request Orchestrator

Deliverables:

- Message handlers for text actions, figure actions, and follow-up actions
- API request dispatch

Acceptance:

- Background worker receives action payload and returns normalized result event

Dependencies:

- A3
- E2
- E4
- E5

### F2. API Client Module

Deliverables:

- Typed client for all V1 endpoints
- Error normalization

Acceptance:

- Frontend receives a consistent success or error shape regardless of endpoint

Dependencies:

- A2
- E2
- E4
- E5

### F3. Health and Availability Check

Deliverables:

- Periodic or on-demand health check
- Backend status mapping for side panel badge

Acceptance:

- Side panel can show `available`, `degraded`, or `offline`

Dependencies:

- E1
- F2

## 6.7 Workstream G: Local Persistence

### G1. Storage Layer

Deliverables:

- Local storage adapter
- Read and write methods for saved items, history, and current paper metadata

Acceptance:

- Storage reads and writes succeed through a single abstraction

Dependencies:

- A2

### G2. Save Result as Note

Deliverables:

- Save action wiring
- Note persistence
- Save confirmation feedback

Acceptance:

- User can save text or figure result as a note
- Saved note persists after page reload

Dependencies:

- B3
- G1

### G3. History Persistence

Deliverables:

- Save generated results into local history
- Rehydrate history on panel open

Acceptance:

- Prior results for the same paper are visible in `History`

Dependencies:

- B2
- G1
- F1

### G4. Saved Item Filtering

Deliverables:

- Filter items by note, flashcard, or question

Acceptance:

- Filter updates the saved list without data loss

Dependencies:

- B4
- G1

## 6.8 Workstream H: QA and Release Hardening

### H1. Unsupported Page Handling

Deliverables:

- Detection for unsupported selection scenarios
- User-facing fallback messages

Acceptance:

- Unsupported flows fail gracefully with actionable guidance

Dependencies:

- C4
- D4

### H2. Core Flow QA Matrix

Deliverables:

- Test checklist across:
  - standard webpage
  - Chrome PDF
  - arXiv PDF
  - figure capture
  - backend failure

Acceptance:

- Each core flow has a pass or fail record and reproduction notes

Dependencies:

- C4
- D4
- G2
- G3

### H3. Analytics Events

Deliverables:

- Event hooks for selection actions, figure capture, saves, follow-ups, and failures

Acceptance:

- Core user actions emit expected analytics events

Dependencies:

- C4
- D4
- G2
- B5

### H4. Beta Release Checklist

Deliverables:

- Permissions review
- Manual smoke test
- Known limitations list
- Internal install instructions

Acceptance:

- Team can install and exercise the extension without developer intervention

Dependencies:

- H1
- H2

## 7. Dependency Summary

Critical path:

1. A1 -> A2 -> A3
2. A1 -> B1 -> B2 -> B3
3. A1 -> C1 -> C2 -> C3 -> C4
4. E1 -> E2 -> E3
5. A3 + E2 + B2 + C3 -> C4
6. D1 -> D2 -> D3 -> D4
7. E1 -> E4
8. G1 -> G2 -> G3 -> B4
9. E2 + E4 -> E5 -> B5
10. C4 + D4 + G2 + G3 -> H2

## 8. Suggested Sprint Cut

### Sprint 1

- A1
- A2
- A3
- B1
- B2
- E1
- F2

Goal:

- Loaded extension shell, panel shell, backend scaffold, typed plumbing

### Sprint 2

- C1
- C2
- C3
- E2
- E3
- F1
- C4

Goal:

- Text explanation flow works end to end

### Sprint 3

- D1
- D2
- D3
- E4
- D4

Goal:

- Figure explanation flow works end to end

### Sprint 4

- G1
- G2
- G3
- B4
- E5
- B5

Goal:

- Save, history, and follow-up are usable

### Sprint 5

- H1
- H2
- H3
- H4
- G4
- F3

Goal:

- Hardening, QA, and beta-readiness

## 9. Roles and Ownership Suggestion

If more than one engineer is available:

- Engineer A: extension shell, content script, toolbar, figure capture
- Engineer B: side panel state, result rendering, persistence
- Engineer C: backend API, model orchestration, schema validation

If only one engineer is available:

- Build in milestone order and defer flashcards and advanced filters until after end-to-end text and figure flows work reliably

## 10. Explicit De-Scope for MVP

Do not pull these into the first implementation:

- Full user account settings UI
- Cross-browser support
- OCR for scanned PDFs
- Notion or Anki export
- Rich multi-turn assistant chat
- Automatic whole-paper summary generation

## 11. Definition of Done

MVP is done when:

- The extension loads cleanly in Chrome
- A user can highlight text and get `Explain`, `Simplify`, and `Define`
- A user can drag-select a figure and get `Explain Figure`
- Results appear in the side panel with success, partial-success, and error states
- The user can save at least notes locally
- The user can reopen prior results from history
- The user can ask one follow-up question on the latest result
- Core failure states offer retry or fallback guidance

## 12. Recommended Next Step

After task breakdown, the most useful next artifact is one of:

1. Repository scaffold and initial folder structure
2. Shared TypeScript types and message contracts
3. Backend service skeleton with mock responses
