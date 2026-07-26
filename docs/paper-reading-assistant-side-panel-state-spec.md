# Paper Reading Assistant Side Panel Component Tree and State Machine

## 1. Document Goal

This document defines the V1 side panel structure, component responsibilities, state model, and event flow for the Chrome extension.

Related documents:

- [paper-reading-assistant-extension-design.md](/D:/project/Paper_Reading_Assistant/docs/paper-reading-assistant-extension-design.md)
- [paper-reading-assistant-interaction-spec.md](/D:/project/Paper_Reading_Assistant/docs/paper-reading-assistant-interaction-spec.md)

## 2. Scope

This document covers:

- Side panel component tree
- Shared UI state for the side panel
- State machines for result generation and browsing
- Event flow between content script, background worker, and side panel

This document does not cover:

- Backend internals
- Billing or account pages
- Popup implementation details

## 3. Side Panel Role

The side panel is the primary workspace of the extension. It is responsible for:

- Displaying the current paper context
- Rendering the active explanation result
- Showing loading, empty, partial-success, and error states
- Browsing saved notes and recent history
- Starting figure capture
- Accepting one follow-up question on the latest result

## 4. Top-Level Component Tree

```text
SidePanelApp
|- PanelShell
|  |- PanelHeader
|  |  |- PaperMeta
|  |  |- BackendStatusBadge
|  |  |- StartFigureSelectionButton
|  |  |- SettingsButton
|  |
|  |- PanelTabs
|  |  |- CurrentTabButton
|  |  |- SavedTabButton
|  |  |- HistoryTabButton
|  |
|  |- PanelContentRouter
|     |- CurrentWorkspace
|     |  |- EmptyStateCard
|     |  |- LoadingCard
|     |  |- ResultThread
|     |  |  |- ResultCard
|     |  |  |  |- ResultSourceSummary
|     |  |  |  |- ResultSectionList
|     |  |  |  |- ResultActionRow
|     |  |  |
|     |  |  |- FollowUpComposer
|     |  |  |- FollowUpResponseCard
|     |  |
|     |  |- ErrorCard
|     |
|     |- SavedWorkspace
|     |  |- SavedFilterBar
|     |  |- SavedItemList
|     |  |  |- SavedItemCard
|     |
|     |- HistoryWorkspace
|        |- HistoryList
|           |- HistoryItemCard
|
|- ToastHost
|- ConfirmMenuHost
```

## 5. Component Responsibilities

### 5.1 `SidePanelApp`

Responsibilities:

- Bootstraps state from local storage
- Subscribes to extension runtime messages
- Owns high-level panel store
- Routes active tab content

Inputs:

- Runtime messages
- Persisted local data

Outputs:

- UI updates
- Commands to background worker

### 5.2 `PanelShell`

Responsibilities:

- Layout only
- Hosts header, tabs, content, and global feedback surfaces

Should not:

- Own business logic

### 5.3 `PanelHeader`

Responsibilities:

- Show current paper title
- Show page number when available
- Show backend availability
- Expose `Start Figure Selection`
- Expose settings entry

### 5.4 `PanelTabs`

Responsibilities:

- Reflect active workspace
- Switch between `Current`, `Saved`, and `History`

### 5.5 `PanelContentRouter`

Responsibilities:

- Render the correct workspace by active tab
- Keep tab-local state mounted only if needed by implementation

### 5.6 `CurrentWorkspace`

Responsibilities:

- Show the active working state for the current paper
- Render empty, loading, success, partial-success, or error views
- Render the latest result thread

### 5.7 `ResultThread`

Responsibilities:

- Group one primary result and its follow-up exchanges
- Keep ordering stable
- Associate thread with one source selection or figure capture

### 5.8 `ResultCard`

Responsibilities:

- Show source summary
- Show action type such as `Explain` or `Explain Figure`
- Render structured sections returned by backend
- Offer actions like `Save`, `Copy`, `Ask Follow-Up`, `Re-crop`

### 5.9 `FollowUpComposer`

Responsibilities:

- Accept one follow-up input for the latest thread
- Submit follow-up via background worker
- Preserve typed text during retry if possible

### 5.10 `SavedWorkspace`

Responsibilities:

- List saved notes, flashcards, and questions for the current paper
- Filter by item type
- Reopen item detail in place

### 5.11 `HistoryWorkspace`

Responsibilities:

- Show generated results for the current paper
- Allow reopening a prior result into `Current`

## 6. State Model

## 6.1 Global Panel State

```ts
type PanelTab = "current" | "saved" | "history";

type PanelState = {
  activeTab: PanelTab;
  backendStatus: "unknown" | "available" | "degraded" | "offline";
  currentPaper: PaperContext | null;
  currentWorkspace: CurrentWorkspaceState;
  savedWorkspace: SavedWorkspaceState;
  historyWorkspace: HistoryWorkspaceState;
  ui: {
    toast: ToastState | null;
    confirmMenu: ConfirmMenuState | null;
  };
};
```

### 6.2 Paper Context

```ts
type PaperContext = {
  paperId: string;
  title: string;
  url: string;
  sourceType: "pdf" | "html";
  pageNumber?: number;
  authors?: string[];
};
```

### 6.3 Current Workspace State

```ts
type CurrentWorkspaceState = {
  status: "empty" | "loading" | "success" | "partial_success" | "error";
  activeThread: ResultThreadState | null;
  lastAction:
    | "explain"
    | "simplify"
    | "define"
    | "explain_figure"
    | "follow_up"
    | null;
  pendingRequest: PendingRequestState | null;
  error: WorkspaceError | null;
};
```

### 6.4 Result Thread State

```ts
type ResultThreadState = {
  threadId: string;
  source:
    | TextSourceState
    | FigureSourceState;
  resultCards: ResultCardState[];
  followUps: FollowUpState[];
  createdAt: string;
  updatedAt: string;
};
```

### 6.5 Text Source State

```ts
type TextSourceState = {
  type: "text";
  selectionId: string;
  text: string;
  context?: string;
  pageNumber?: number;
};
```

### 6.6 Figure Source State

```ts
type FigureSourceState = {
  type: "figure";
  figureId: string;
  imageRef: string;
  thumbnailRef?: string;
  pageNumber?: number;
  caption?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};
```

### 6.7 Result Card State

```ts
type ResultCardState = {
  resultId: string;
  action: "explain" | "simplify" | "define" | "explain_figure";
  status: "success" | "partial_success";
  sections: {
    title: string;
    content: string;
  }[];
  createdAt: string;
};
```

### 6.8 Follow-Up State

```ts
type FollowUpState = {
  followUpId: string;
  question: string;
  answerStatus: "loading" | "success" | "error";
  answerSections?: {
    title: string;
    content: string;
  }[];
  error?: string;
  createdAt: string;
};
```

### 6.9 Saved Workspace State

```ts
type SavedWorkspaceState = {
  filter: "all" | "note" | "flashcard" | "question";
  items: SavedItemState[];
};
```

### 6.10 History Workspace State

```ts
type HistoryWorkspaceState = {
  items: HistoryItemState[];
};
```

## 7. Current Workspace State Machine

### 7.1 States

- `empty`
- `loading`
- `success`
- `partial_success`
- `error`

### 7.2 Events

- `TEXT_ACTION_REQUESTED`
- `FIGURE_ACTION_REQUESTED`
- `REQUEST_SUCCEEDED`
- `REQUEST_PARTIALLY_SUCCEEDED`
- `REQUEST_FAILED`
- `RETRY_REQUESTED`
- `THREAD_REOPENED`
- `PAPER_CONTEXT_CLEARED`

### 7.3 State Diagram

```text
empty
  -> loading                 on TEXT_ACTION_REQUESTED
  -> loading                 on FIGURE_ACTION_REQUESTED

loading
  -> success                 on REQUEST_SUCCEEDED
  -> partial_success         on REQUEST_PARTIALLY_SUCCEEDED
  -> error                   on REQUEST_FAILED

error
  -> loading                 on RETRY_REQUESTED
  -> loading                 on TEXT_ACTION_REQUESTED
  -> loading                 on FIGURE_ACTION_REQUESTED

success
  -> loading                 on TEXT_ACTION_REQUESTED
  -> loading                 on FIGURE_ACTION_REQUESTED
  -> success                 on THREAD_REOPENED
  -> empty                   on PAPER_CONTEXT_CLEARED

partial_success
  -> loading                 on RETRY_REQUESTED
  -> loading                 on TEXT_ACTION_REQUESTED
  -> loading                 on FIGURE_ACTION_REQUESTED
  -> success                 on THREAD_REOPENED
  -> empty                   on PAPER_CONTEXT_CLEARED
```

### 7.4 State Semantics

`empty`

- No active result for the current paper

`loading`

- A request is in flight
- UI should show the source summary as early as possible

`success`

- Latest request completed successfully

`partial_success`

- Result is usable but incomplete

`error`

- Latest request failed
- Previous successful history should remain accessible

## 8. Result Thread State Machine

### 8.1 Thread Lifecycle

```text
not_created
  -> active                  on REQUEST_SUCCEEDED
  -> active                  on REQUEST_PARTIALLY_SUCCEEDED

active
  -> active                  on FOLLOW_UP_STARTED
  -> active                  on FOLLOW_UP_SUCCEEDED
  -> active                  on FOLLOW_UP_FAILED
  -> reopened                on THREAD_REOPENED

reopened
  -> active                  on FOLLOW_UP_STARTED
```

### 8.2 Thread Rules

- One thread corresponds to one source selection or one figure capture
- A new text selection creates a new thread
- A follow-up appends to the latest thread only
- Reopening history should not mutate source content

## 9. Follow-Up State Machine

### 9.1 States

- `idle`
- `editing`
- `submitting`
- `success`
- `error`

### 9.2 Events

- `FOLLOW_UP_OPENED`
- `FOLLOW_UP_CHANGED`
- `FOLLOW_UP_SUBMITTED`
- `FOLLOW_UP_SUCCEEDED`
- `FOLLOW_UP_FAILED`
- `FOLLOW_UP_CLOSED`

### 9.3 State Diagram

```text
idle
  -> editing                 on FOLLOW_UP_OPENED

editing
  -> editing                 on FOLLOW_UP_CHANGED
  -> submitting              on FOLLOW_UP_SUBMITTED
  -> idle                    on FOLLOW_UP_CLOSED

submitting
  -> success                 on FOLLOW_UP_SUCCEEDED
  -> error                   on FOLLOW_UP_FAILED

error
  -> editing                 on FOLLOW_UP_CHANGED
  -> submitting              on FOLLOW_UP_SUBMITTED
  -> idle                    on FOLLOW_UP_CLOSED

success
  -> editing                 on FOLLOW_UP_OPENED
  -> idle                    on FOLLOW_UP_CLOSED
```

### 9.4 Follow-Up Rules

- Only one composer is open at a time
- Composer belongs to the active thread only
- If follow-up fails, preserve typed content when possible

## 10. Tab State Machine

### 10.1 States

- `current`
- `saved`
- `history`

### 10.2 Events

- `TAB_SELECTED_CURRENT`
- `TAB_SELECTED_SAVED`
- `TAB_SELECTED_HISTORY`

### 10.3 Transition Rules

```text
current <-> saved
current <-> history
saved   <-> history
```

Rules:

- Tab switches must not clear current in-memory result state
- Returning to `Current` restores the prior active thread view

## 11. Saved Workspace State Machine

### 11.1 States

- `ready`

V1 note:

- No separate loading state is required if items load from local storage during panel bootstrap

### 11.2 Events

- `SAVE_ITEM_CREATED`
- `SAVE_ITEM_DELETED`
- `SAVE_FILTER_CHANGED`

### 11.3 Rules

- New saves should appear immediately
- Deleting a saved item should not remove history or the original generated result

## 12. Message Flow

### 12.1 Text Action Flow

```text
User selects text
-> Content script detects selection
-> User clicks toolbar action
-> Content script sends TEXT_ACTION_REQUESTED
-> Background worker creates request
-> Side panel receives pending event
-> Current workspace enters loading
-> Backend responds
-> Background worker sends success or error event
-> Side panel updates thread and history
```

### 12.2 Figure Action Flow

```text
User starts figure selection
-> Content script enters overlay mode
-> User confirms region
-> Content script captures region
-> Content script sends FIGURE_ACTION_REQUESTED
-> Background worker creates request
-> Side panel opens and enters loading
-> Backend responds
-> Side panel renders figure result
```

### 12.3 Save Flow

```text
User clicks Save
-> Side panel opens save menu
-> User selects save type
-> Side panel writes to local storage
-> Saved workspace updates
-> Toast confirms success
```

### 12.4 Follow-Up Flow

```text
User clicks Ask Follow-Up
-> Composer opens
-> User submits question
-> Side panel dispatches FOLLOW_UP_SUBMITTED
-> Background worker calls backend
-> Side panel appends loading follow-up item
-> Backend responds
-> Follow-up item becomes success or error
```

## 13. Persistence Strategy

### 13.1 Persisted State

Persist:

- Current paper identity
- Saved items
- History items
- Last opened tab

Do not persist:

- Transient loading state
- Open menus
- In-flight requests

### 13.2 Rehydration Rules

On panel startup:

- Load last known paper context if it matches the active tab context
- Restore `Saved` and `History`
- Default `Current` to latest valid thread if one exists, otherwise `empty`

## 14. Rendering Rules

### 14.1 Current Workspace Priority

Render order:

1. If `status = loading`, show loading card
2. Else if `status = error`, show error card
3. Else if `activeThread` exists, show result thread
4. Else show empty state

### 14.2 Action Availability

Text result card:

- `Save`
- `Ask Follow-Up`
- `Copy`

Figure result card:

- `Save`
- `Re-crop`
- `Ask Follow-Up`

Error card:

- `Retry`
- `Select Again` for figure failures where appropriate

## 15. Engineering Split Suggestion

Suggested modules:

- `panel-store.ts`
- `panel-events.ts`
- `panel-selectors.ts`
- `side-panel-app.tsx`
- `panel-header.tsx`
- `panel-tabs.tsx`
- `current-workspace.tsx`
- `result-thread.tsx`
- `result-card.tsx`
- `follow-up-composer.tsx`
- `saved-workspace.tsx`
- `history-workspace.tsx`

## 16. Acceptance Checklist

The side panel architecture is acceptable for V1 if:

- A new text or figure action moves `Current` into `loading` immediately
- Successful responses create a thread with stable source context
- Follow-up answers append to the active thread correctly
- Switching tabs does not lose the current result
- Saved items update immediately after save
- History can reopen prior results without re-requesting backend output
