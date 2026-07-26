/**
 * Paper Reading Assistant — Shared Type Definitions
 *
 * These types mirror the side-panel-state-spec, backend-api-spec,
 * and interaction-spec.  Field names and optionality match the specs
 * exactly.  contracts.js runtime values must stay aligned with these
 * declarations.
 *
 * Spec references:
 *   - docs/paper-reading-assistant-side-panel-state-spec.md   (§6 state model)
 *   - docs/paper-reading-assistant-backend-api-spec.md         (§5–§11 API shapes)
 *   - docs/paper-reading-assistant-interaction-spec.md         (§5.5, §6.6 UI states)
 *   - docs/paper-reading-assistant-extension-design.md         (§13 data model)
 */

// ─── Tab & Status Enums ───────────────────────────────────

export type PanelTab = "current" | "saved" | "history";

export type BackendStatus = "unknown" | "available" | "degraded" | "offline";

export type WorkspaceStatus =
  | "empty"
  | "loading"
  | "success"
  | "partial_success"
  | "error";

export type ResultStatus = "success" | "partial_success" | "error";

export type ActionType =
  | "explain"
  | "simplify"
  | "define"
  | "explain_figure"
  | "follow_up"
  | "summarize";

/** Paper source format (extension design §13.1) */
export type SourceType = "pdf" | "html";

/** What kind of selection produced a result (backend spec §5) */
export type ResultSourceType = "text" | "figure" | "document";

/** Saved artifact kinds (extension design §13.4) */
export type SaveKind = "note" | "flashcard" | "question";

/** Saved workspace filter (side-panel-state-spec §6.9) */
export type SaveFilter = "all" | SaveKind;

// ─── Content-Script UI States (interaction-spec §5.5, §6.6) ──

export type ToolbarStatus = "hidden" | "visible" | "disabled" | "busy";

export type FigureOverlayStatus =
  | "idle"
  | "selecting"
  | "review"
  | "submitting"
  | "canceled";

/** Follow-up composer states (side-panel-state-spec §9.1) */
export type FollowUpStatus =
  | "idle"
  | "editing"
  | "submitting"
  | "success"
  | "error";

// ─── Backend Error Codes (backend spec §10.2) ─────────────

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "INVALID_SELECTION"
  | "IMAGE_TOO_SMALL"
  | "UNSUPPORTED_PAGE"
  | "RATE_LIMITED"
  | "UPSTREAM_MODEL_ERROR"
  | "TIMEOUT"
  | "INTERNAL_ERROR";

// ─── Core Data Shapes ─────────────────────────────────────

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

/**
 * Input for buildPdfPaperContext.
 * Remote PDFs provide pdfSourceUrl; local PDFs provide filename + pdfFileSize.
 * These fields drive the paperId derivation and are NOT part of the resulting PaperContext.
 */
export interface PdfPaperInput {
  /** Opt-in flag for createPaperContext to use PDF identity rules. */
  pdf?: boolean;
  title?: string;
  /** Remote PDF source URL (http/https). Empty or absent for local files. */
  pdfSourceUrl?: string;
  /** Local file name from File.name. */
  filename?: string;
  /** Local file size in bytes from File.size. */
  pdfFileSize?: number;
  pageNumber?: number;
  authors?: string[];
}

/**
 * Paper identity rules:
 *   - HTML pages:  paperId = hash of normalized page URL
 *   - Remote PDFs: paperId = hash of normalized PDF source URL
 *   - Local PDFs:  paperId = hash of "pdf-local:<filename>:<filesize>"
 *   - Fallback:    paperId = random id (per-session, no stable identity)
 *
 * The url field holds the source URL for remote PDFs and is empty for local PDFs.
 */
export interface PaperContext {
  paperId: string;
  title: string;
  url: string;
  sourceType: SourceType;
  pageNumber?: number;
  authors?: string[];
}

export interface TextSelectionPayload {
  selectionId: string;
  text: string;
  context?: string;
  pageNumber?: number;
}

export interface FigureSelectionPayload {
  figureId: string;
  imageRef?: string;
  imageData?: {
    mimeType: string;
    dataUrl: string;
  };
  /**
   * Internal extension-only viewport metadata used to crop a
   * captureVisibleTab screenshot into the selected figure region.
   * This must not be forwarded to the backend API.
   */
  captureViewport?: CaptureViewport;
  thumbnailRef?: string;
  caption?: string;
  pageNumber?: number;
  boundingBox?: BoundingBox;
}

export interface ResultSection {
  title: string;
  content: string;
}

export interface ResultWarning {
  code: string;
  message: string;
}

// ─── Panel State (side-panel-state-spec §6) ────────────────

export interface ResultCardState {
  resultId: string;
  action: ActionType;
  status: "success" | "partial_success";
  sections: ResultSection[];
  /**
   * Warnings from the backend response.
   *
   * The side-panel-state-spec (§6.7) does not model this field
   * explicitly, but the backend-api-spec includes `warnings` on
   * every result and the partial-success UI needs them.  This is
   * an intentional, minimal extension of the spec.
   */
  warnings?: ResultWarning[];
  createdAt: string;
}

export interface FollowUpState {
  followUpId: string;
  question: string;
  answerStatus: "loading" | "success" | "error";
  answerSections?: ResultSection[];
  error?: string;
  createdAt: string;
}

export interface TextSourceState {
  type: "text";
  selectionId: string;
  text: string;
  context?: string;
  pageNumber?: number;
}

export interface FigureSourceState {
  type: "figure";
  figureId: string;
  imageRef?: string;
  imageData?: {
    mimeType: string;
    dataUrl: string;
  };
  captureViewport?: CaptureViewport;
  thumbnailRef?: string;
  caption?: string;
  pageNumber?: number;
  boundingBox?: BoundingBox;
}

export interface DocumentSourceState {
  type: "document";
  documentKind: "html" | "pdf_file";
  /** HTML: cached fullText for retry; PDF: not stored (too large for storage) */
  fullText?: string;
  pageCount?: number;
}

export interface ResultThreadState {
  threadId: string;
  source: TextSourceState | FigureSourceState | DocumentSourceState;
  resultCards: ResultCardState[];
  followUps: FollowUpState[];
  createdAt: string;
  updatedAt: string;
}

export interface PendingRequestState {
  kind: "text" | "figure" | "document";
  requestedAt: string;
}

export interface WorkspaceError {
  code?: string;
  message: string;
}

export interface CurrentWorkspaceState {
  status: WorkspaceStatus;
  activeThread: ResultThreadState | null;
  lastAction: ActionType | null;
  pendingRequest: PendingRequestState | null;
  error: WorkspaceError | null;
}

export interface SavedItemState {
  id: string;
  paperId: string;
  kind: SaveKind;
  front: string;
  back: string;
  sourceSelectionId?: string;
  createdAt: string;
}

export interface HistoryItemState {
  threadId: string;
  sourceSummary: string;
  action: ActionType;
  createdAt: string;
  thread: ResultThreadState;
}

export interface SavedWorkspaceState {
  filter: SaveFilter;
  items: SavedItemState[];
}

export interface HistoryWorkspaceState {
  items: HistoryItemState[];
}

// ─── Panel UI State (side-panel-state-spec §6.1) ──────────
//
// The spec references ToastState and ConfirmMenuState in the
// PanelState.ui property but does not define them explicitly.
// These interfaces provide reasonable V1 shapes.

export interface ToastState {
  message: string;
  kind: "success" | "error" | "info";
  /** Auto-dismiss timeout in ms; 0 or omitted = manual dismiss */
  duration?: number;
}

export interface ConfirmMenuState {
  prompt: string;
  options: string[];
  /** Identifies the pending action for the panel store to resolve */
  actionId: string;
}

export interface PanelUIState {
  toast: ToastState | null;
  confirmMenu: ConfirmMenuState | null;
}

// ─── Panel State Root (side-panel-state-spec §6.1) ───────

export interface PanelState {
  activeTab: PanelTab;
  backendStatus: BackendStatus;
  currentPaper: PaperContext | null;
  currentWorkspace: CurrentWorkspaceState;
  savedWorkspace: SavedWorkspaceState;
  historyWorkspace: HistoryWorkspaceState;
  ui: PanelUIState;
}

// ─── Runtime Messages ─────────────────────────────────────

export interface RuntimeMessage<T = unknown> {
  type: string;
  tabId?: number;
  payload?: T;
}

// ─── Document Payload (Summarize feature) ─────────────

export interface DocumentPayload {
  kind: "html" | "pdf_file";
  /** HTML: cleaned article markup, bounded by MAX_HTML_LENGTH */
  html?: string;
  /** HTML: extracted full text; optional for pdf_file */
  fullText?: string;
  /** PDF: base64 data URL of the raw file */
  fileData?: string;
  /** PDF: original filename */
  filename?: string;
  /** PDF: original file size in bytes */
  fileSize?: number;
  /** PDF: total page count */
  pageCount?: number;
  /** HTML: character count for diagnostics */
  charCount?: number;
  /** HTML: extraction method identifier */
  extractionMethod?: string;
}

// ─── Backend API Types (backend-api-spec §5–§11) ─────────

export interface ClientInfo {
  platform: "chrome-extension";
  version: string;
}

export interface ExplainTextRequest {
  paper: PaperContext;
  selection: TextSelectionPayload;
  action: "explain" | "simplify" | "define";
  client: ClientInfo;
}

export interface ExplainFigureRequest {
  paper: PaperContext;
  figure: FigureSelectionPayload;
  action: "explain_figure";
  client: ClientInfo;
}

export interface FollowUpRequest {
  threadId: string;
  sourceResultId: string;
  question: string;
  client: ClientInfo;
}

export interface ResultResponse {
  resultId: string;
  threadId: string;
  sourceType: ResultSourceType;
  action: ActionType;
  sections: ResultSection[];
  warnings: ResultWarning[];
  createdAt: string;
}

export interface SuccessResponse {
  requestId: string;
  status: "success" | "partial_success";
  result: ResultResponse;
}

export interface FollowUpResponse {
  followUpId: string;
  threadId: string;
  sourceResultId: string;
  question: string;
  sections: ResultSection[];
  warnings: ResultWarning[];
  createdAt: string;
}

export interface FollowUpSuccessResponse {
  requestId: string;
  status: "success";
  followUp: FollowUpResponse;
}

export interface ErrorResponse {
  requestId: string;
  status: "error";
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

export interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  time: string;
}

// ─── API Client Config ─────────────────────────────────────

/**
 * Configuration for the background API client.
 * Persisted in chrome.storage.local under CONFIG_STORAGE_KEY.
 *
 * mode:
 *   "mock" — return mock data (default; standalone UI development)
 *   "real" — always call the real API
 *   "auto" — try real, fall back to mock on network failure
 */
export interface ApiClientConfig {
  baseUrl: string;
  mode: "mock" | "real" | "auto";
  timeoutMs: number;
  authToken: string | null;
}
