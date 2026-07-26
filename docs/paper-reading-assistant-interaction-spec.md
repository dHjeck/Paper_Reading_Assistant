# Paper Reading Assistant Interaction Spec

## 1. Document Goal

This document defines the interaction behavior for the V1 Chrome extension. It is intended to be specific enough for frontend implementation and product review.

Related product document:

- [paper-reading-assistant-extension-design.md](/D:/project/Paper_Reading_Assistant/docs/paper-reading-assistant-extension-design.md)

## 2. V1 Interaction Scope

This spec covers:

- Text selection and floating toolbar
- Figure selection and crop overlay
- Side panel behavior
- Save actions
- Follow-up question interaction
- Error, loading, and empty states

This spec does not cover:

- Billing
- Full account management
- Cross-device sync
- Whole-paper summarization

## 3. Interaction Principles

1. Reading flow comes first.
2. The extension should appear only when invited by user action.
3. Primary actions must be reachable in one step after selection.
4. Result UI should stay compact by default.
5. Failures must be recoverable without forcing the user to repeat the entire action.

## 4. UI Surfaces

### 4.1 In-Page Floating Toolbar

Purpose:

- Immediate actions after text selection

Primary actions:

- `Explain`
- `Simplify`
- `Define`
- `Save`

### 4.2 Figure Capture Overlay

Purpose:

- Let the user drag-select a figure region from the visible PDF page

Primary actions:

- `Use This Region`
- `Select Again`
- `Cancel`

### 4.3 Side Panel

Purpose:

- Main workspace for results, saved items, and recent history

Tabs:

- `Current`
- `Saved`
- `History`

### 4.4 Context Menu

Purpose:

- Entry point for figure explanation on image elements

Primary menu item:

- `Explain this figure`

### 4.5 Popup

Purpose:

- Lightweight entry for settings and status only

Primary contents:

- Sign-in state
- API connectivity state
- Open side panel
- Open settings

## 5. Text Selection Interaction

### 5.1 Trigger Conditions

The floating toolbar should appear when:

- The user selects non-empty text
- The selection is inside a supported webpage or PDF view
- The selection length is within V1 limits

The toolbar should not appear when:

- The selection is empty or whitespace only
- The selection is inside the extension UI
- The page is detected as unsupported

### 5.2 Selection Constraints

- Minimum length: 2 characters
- Maximum length: implementation-defined V1 limit
- If the selection exceeds the limit, show a compact message:
  `Selection is too long. Please select a smaller section.`

### 5.3 Toolbar Placement

Rules:

- Anchor the toolbar near the selection endpoint
- Prefer above-selection placement
- Fall back below selection if there is not enough space
- Keep at least 8 px from viewport edges
- Reposition on scroll if the selection remains active

### 5.4 Toolbar Behavior

On first appearance:

- Fade in quickly
- Do not steal text selection focus

On action click:

- Keep the selected text visually intact if possible
- Open the side panel if not already open
- Show loading state in the side panel immediately

Dismiss when:

- User clicks outside selection and toolbar
- User presses `Escape`
- Selection collapses
- Page navigation occurs

### 5.5 Toolbar States

`Hidden`

- Default state

`Visible`

- Shown after valid selection

`Disabled`

- Used only when the page is partially supported but action cannot run

`Busy`

- Optional short state after user clicks an action

### 5.6 Toolbar Wireframe

```text
+---------------------------------------------------+
| Explain | Simplify | Define | Save                |
+---------------------------------------------------+
```

### 5.7 Text Action Behavior

#### `Explain`

Input:

- Selected text
- Nearby context if available
- Paper metadata
- Current page number if available

Result:

- Creates a result card in `Current`

#### `Simplify`

Input:

- Same as `Explain`

Result:

- Creates a simplified explanation card in `Current`

#### `Define`

Input:

- Selected text
- Nearby context

Result:

- Creates a term-definition style card in `Current`

#### `Save`

Behavior:

- If no explanation exists yet, save the raw selection as a note seed
- If an explanation card already exists for the same active selection, let the user save that result directly

## 6. Figure Selection Interaction

### 6.1 Entry Points

Entry point A:

- User clicks `Start Figure Selection` in the side panel

Entry point B:

- User right-clicks an image and selects `Explain this figure`

### 6.2 Mode Choice

For V1:

- Use `drag to capture` as the default figure flow for PDFs
- Use context-menu image explanation where native image elements exist

### 6.3 Overlay Activation

When figure mode starts:

- Show a translucent page overlay
- Freeze extension UI actions unrelated to capture
- Change cursor to crosshair
- Show top instruction text:
  `Drag to select a figure region`

### 6.4 Drag Selection Behavior

On pointer down:

- Record origin point

On drag:

- Draw selection rectangle
- Dim non-selected area
- Show current rectangle feedback

On pointer up:

- Finalize tentative crop
- Show confirm controls

### 6.5 Capture Confirmation

After drag completes, show:

- `Use This Region`
- `Select Again`
- `Cancel`

If user clicks `Use This Region`:

- Capture selected region
- Open side panel if hidden
- Show loading card with preview placeholder

If user clicks `Select Again`:

- Clear current rectangle
- Stay in overlay mode

If user clicks `Cancel`:

- Exit overlay mode
- Restore page to idle state

### 6.6 Figure Overlay States

`Idle`

- Not active

`Selecting`

- User is dragging a region

`Review`

- Region drawn and awaiting confirmation

`Submitting`

- Region accepted and request in flight

`Canceled`

- Short-lived exit state before returning to idle

### 6.7 Figure Capture Rules

- Crop only the user-selected visible region
- Do not auto-expand crop in V1
- If the crop is very small, warn before submit
- If image quality is low, still allow submit but show a caution note

### 6.8 Figure Explanation Result

The result card must include:

- Figure preview thumbnail
- Source page if available
- `What This Figure Shows`
- `How To Read It`
- `Main Takeaway`

Secondary actions:

- `Save`
- `Re-crop`
- `Ask Follow-Up`

## 7. Side Panel Interaction

### 7.1 Panel Open Rules

The side panel opens automatically when:

- User clicks a text action from the toolbar
- User confirms a figure crop
- User invokes figure explanation from the context menu

The side panel may also open manually from:

- Extension popup
- Extension action icon

### 7.2 Default Layout

```text
+--------------------------------------------------+
| Paper Reading Assistant                          |
| Paper title                                      |
| Page indicator                                   |
+--------------------------------------------------+
| Tabs: [Current] [Saved] [History]                |
+--------------------------------------------------+
| Content area                                     |
+--------------------------------------------------+
```

### 7.3 Header Area

Header fields:

- Extension name
- Current paper title
- Current page number if available
- Small status indicator for backend availability

Header actions:

- `Start Figure Selection`
- `Settings`

### 7.4 Tab Behavior

#### `Current`

Purpose:

- Shows the latest active result and current task state

Behavior:

- Always receives new explanation cards first
- If multiple results exist in one session, latest result appears at top

#### `Saved`

Purpose:

- Shows saved notes, flashcards, and questions for the current paper

Behavior:

- Group by item type or reverse chronological order

#### `History`

Purpose:

- Shows recent generated outputs for the current paper

Behavior:

- Read-only by default
- Clicking a history item reopens the full card in `Current`

### 7.5 Side Panel States

`Empty`

- Shown before first action on the current paper

`Loading`

- Shown while waiting for response

`Success`

- Shown after result arrives

`Partial Success`

- Shown when result is usable but incomplete

`Error`

- Shown when request fails or page is unsupported

### 7.6 Empty State

Display:

- Short helper text:
  `Highlight text or select a figure to get help.`
- Primary button:
  `Start Figure Selection`

### 7.7 Loading State

Display:

- Skeleton result card
- Action label:
  `Explaining selection` or `Analyzing figure`
- Optional cancel button only if implementation supports request cancelation

### 7.8 Success State

Each result card should contain:

- Source summary
- Action label
- Structured answer sections
- Action row

Action row:

- `Save`
- `Ask Follow-Up`
- `Copy`

Figure card action row:

- `Save`
- `Re-crop`
- `Ask Follow-Up`

### 7.9 Partial Success State

Use when:

- The model can interpret the overall figure but not all small labels
- The text context is incomplete but explanation is still useful

Display:

- Normal result sections
- A small caution note at the top:
  `Some details may be unclear from the selected content.`

### 7.10 Error State

Error card should include:

- Short error title
- Short explanation
- Primary recovery action

Examples:

- `Retry`
- `Select Again`
- `Open Supported PDF`

## 8. Save Interaction

### 8.1 Save Entry Points

- Text result card
- Figure result card
- Toolbar `Save`

### 8.2 Save Modal or Menu

V1 recommended behavior:

- Use a lightweight inline menu rather than a full modal

Options:

- `Save as Note`
- `Save as Flashcard`
- `Save as Question`

### 8.3 Save Success Feedback

After save:

- Show a short toast or inline confirmation
- Example:
  `Saved to this paper`

### 8.4 Save Failure Feedback

If local save fails:

- Keep user in current context
- Show retry action
- Do not discard the generated content

## 9. Follow-Up Question Interaction

### 9.1 Entry Point

The `Ask Follow-Up` button appears on result cards after a successful response.

### 9.2 V1 Scope

- Only one active follow-up box at a time
- Follow-up attaches only to the most recent result thread
- No multi-branch conversation tree

### 9.3 Follow-Up UI

Inline field below result card:

```text
+--------------------------------------------------+
| Ask a follow-up about this result                |
| [ input field                          ] [Send]  |
+--------------------------------------------------+
```

### 9.4 Follow-Up Behavior

On submit:

- Keep source result visible
- Append follow-up answer beneath the original result
- Preserve local thread order

On error:

- Keep typed question if possible
- Show `Retry`

## 10. Unsupported and Edge Cases

### 10.1 Unsupported PDF or Page

If the extension cannot read selection context reliably:

- Do not silently fail
- Show message:
  `This page is not fully supported yet. Try selecting a smaller region or use figure capture.`

### 10.2 Scanned PDF

If text selection is not available:

- Hide text toolbar behavior
- Keep figure capture available if technically possible
- Show suggestion:
  `Text selection is unavailable on this PDF. Try figure capture or open a text-based PDF.`

### 10.3 Repeated Requests

If the user clicks the same action repeatedly:

- Debounce duplicate submissions for the same active selection

### 10.4 Navigation During Request

If the page changes while a request is in flight:

- Keep the side panel result if already opened
- Mark the result as detached from the previous page context if needed

## 11. Accessibility and Keyboard Behavior

### 11.1 Keyboard

- `Escape` closes the floating toolbar
- `Escape` cancels figure capture overlay
- `Enter` submits follow-up if input is focused
- `Tab` order must be logical in toolbar and side panel

### 11.2 Accessibility

- Buttons need visible focus states
- Overlay controls need clear contrast
- Side panel should be usable at narrow widths
- Do not rely on color alone to indicate status

## 12. Analytics Events

Recommended V1 events:

- `text_selection_toolbar_shown`
- `text_explain_clicked`
- `text_simplify_clicked`
- `text_define_clicked`
- `figure_capture_started`
- `figure_capture_confirmed`
- `figure_explain_requested`
- `result_saved`
- `follow_up_submitted`
- `request_failed`

## 13. Implementation Notes

### 13.1 Suggested Frontend State Machines

Text toolbar:

- `hidden -> visible -> submitting -> hidden`

Figure capture:

- `idle -> selecting -> review -> submitting -> idle`

Side panel:

- `empty -> loading -> success`
- `empty -> loading -> partial_success`
- `empty -> loading -> error`

### 13.2 Coordination Between Surfaces

- Content script owns selection detection and overlay rendering
- Background worker owns request orchestration
- Side panel owns result rendering and saved-item browsing

## 14. Acceptance Checklist

The interaction implementation is acceptable for V1 if:

- Text selection shows the correct toolbar reliably on supported pages
- Clicking a toolbar action opens the side panel and starts loading immediately
- Figure capture can be started, confirmed, canceled, and retried without page refresh
- Result cards are readable and actionable in the side panel
- Save flow works without removing the current reading context
- Common failure states provide a concrete recovery action
