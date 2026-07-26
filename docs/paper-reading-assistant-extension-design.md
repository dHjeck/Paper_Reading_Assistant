# Paper Reading Assistant Chrome Extension

## 1. Product Summary

### 1.1 Positioning

Paper Reading Assistant is a Chrome extension for students reading academic papers, prioritizing PDF reading scenarios. It provides in-context explanation while users read, helping them understand difficult paragraphs, figures, and terms without leaving the paper.

### 1.2 Target Users

- Undergraduate and graduate students
- Students reading papers for courses, thesis work, or research projects
- Users who are unfamiliar with domain-specific terminology and paper structure

### 1.3 Core Value

The extension does not aim to replace reading. It reduces friction at the point of confusion by giving immediate, contextual explanations inside the reading flow.

### 1.4 Product Goal

Enable a student to open a paper PDF in Chrome, select confusing content, and get a useful explanation within seconds.

### 1.5 Problem Statement

Students reading papers usually get stuck in three places:

- Dense technical paragraphs
- Unfamiliar terminology
- Hard-to-read figures, charts, and model diagrams

When that happens, they often leave the paper to search externally, which breaks concentration and slows learning. The extension should resolve this by keeping explanation, note capture, and review inside the PDF reading flow.

### 1.6 Jobs To Be Done

When I am reading a paper and get stuck on a paragraph, term, or figure, I want to ask for help on just that local part so that I can continue reading without losing context.

### 1.7 Product Hypothesis

If students can request context-aware explanations directly from selected text and figures inside the PDF, then they will understand papers faster and save more useful study artifacts than with generic summarization tools.

## 2. Product Scope

### 2.1 V1 Scope

V1 focuses on five high-frequency learning actions:

1. Select text and get an immediate explanation.
2. Select a paragraph and get a simpler restatement.
3. Select a term and get a contextual definition.
4. Select or capture an image or figure and get an explanation.
5. Save important explanations and notes for later review.

### 2.2 V1 Product Promise

The first version should reliably solve one narrow problem:

`I am stuck on this part of the paper right now. Help me understand it quickly.`

### 2.3 Non-Goals for V1

- Full literature management
- Multi-user collaboration
- Citation graph or knowledge graph
- Full paper auto-reading agent
- Local model inference
- Firefox or Safari support
- Full chat workspace
- Cross-device note sync

## 3. Primary Scenarios

### 3.1 Scenario A: Paragraph Is Hard to Understand

The user reads a PDF and finds a paragraph dense or technical. They highlight the text and click `Explain`. The extension returns:

- A plain-language explanation
- Key terms and what they mean in context
- Why this paragraph matters in the paper

### 3.2 Scenario B: A Sentence Uses Unfamiliar Terms

The user highlights a sentence or phrase and clicks `Define`. The extension returns:

- Term definitions
- Context-specific meaning in this paper
- Related prerequisite concepts

### 3.3 Scenario C: A Figure or Diagram Is Confusing

The user selects a figure area or right-clicks an image and clicks `Explain Figure`. The extension returns:

- What the figure shows
- How to read axes, labels, legends, or blocks
- What conclusion the author wants the reader to draw

### 3.4 Scenario D: The User Wants to Save Learning Artifacts

The user saves an explanation as:

- Note
- Flashcard
- Question to revisit

### 3.5 Core User Stories

- As a student, I want to highlight a difficult sentence and get a simpler explanation.
- As a student, I want to highlight a technical term and understand its meaning in the context of this paper.
- As a student, I want to select a figure and understand what conclusion it supports.
- As a student, I want to save a useful explanation without copying content into another tool.
- As a student, I want the extension to remember explanations for the current paper so I can revisit them later in the same session.

## 4. Design Principles

1. Stay inside the reading flow.
2. Respond to a local reading problem, not generic summarization.
3. Keep outputs structured and brief by default.
4. Make actions obvious after text or image selection.
5. Prefer context-aware explanation over one-click full automation.
6. Degrade gracefully when PDF support is imperfect.

## 5. Feature Design

### 5.1 Text Selection Explanation

#### Goal

Allow users to highlight text in a PDF or webpage and receive immediate contextual help.

#### Trigger

- User highlights text
- A mini toolbar appears near the selection

#### Toolbar Actions

- `Explain`
- `Simplify`
- `Define`
- `Save`

#### Output Structure

For `Explain`:

- Plain-language explanation
- Role in the paper
- Related terms

For `Simplify`:

- Rewritten simpler version
- One-sentence takeaway

For `Define`:

- Definition
- Meaning in this paper
- Common confusion or contrast term

#### Selection Rules

- Ignore selections shorter than 2 characters
- Collapse repeated whitespace before sending text to backend
- Cap default selection length in V1 to avoid very large prompts
- If selection is too long, prompt the user to narrow the scope

#### Context Rules

- Try to capture surrounding sentence or paragraph text near the selection
- Include current page number when detectable
- Attach current paper title and source URL

#### Interaction Notes

- Default output should fit in a compact side panel card
- Users can expand for more detail
- Users can ask one short follow-up question in the same context

### 5.2 Image and Figure Explanation

#### Goal

Help users understand figures, charts, model diagrams, tables-as-images, and other visual paper elements.

#### Trigger

- Right-click image: `Explain this figure`
- Click figure selection tool and drag a region over the PDF
- Optional toolbar button after image click

#### Input Modes

- Native HTML image element
- Screenshot region from rendered PDF page
- Cropped figure region sent to the AI service

#### Figure Selection Modes

Mode A: `Right-click image`

- Best for HTML image elements on paper landing pages
- Lowest interaction cost

Mode B: `Drag to capture`

- Best for PDF-rendered figures where no image DOM node exists
- Should be the default figure workflow for PDF-first V1

#### Output Structure

- Figure summary
- How to read it
- Important visual elements
- Main claim or conclusion supported by the figure
- If chart: axis and trend explanation
- If model diagram: module-by-module walkthrough

#### Figure Context Rules

- Include page number if available
- Include nearby caption text if extractable
- Include a short user instruction such as `explain this figure`

#### Special UX Considerations

- Show the captured figure preview in the side panel
- Let the user re-crop if the capture is wrong
- Warn when the image is too small or blurry

### 5.3 Contextual Side Panel

#### Purpose

The side panel is the primary workspace. It should preserve recent context and saved artifacts during reading.

#### Sections

- Current Paper
- Recent Explanations
- Saved Notes
- Flashcards
- Questions

#### Panel Tabs for V1

- `Current`
- `Saved`
- `History`

`Current` is the default workspace. `Saved` contains notes and flashcards. `History` shows recent generated results for the current paper.

#### Behaviors

- Opens on demand or after first use
- Keeps history for the current paper
- Groups outputs by source selection
- Preserves the latest result while the user continues reading

### 5.4 Save and Review

#### Save Targets

- `Note`
- `Flashcard`
- `Question`

#### Flashcard Format

- Front: user-selected text, term, or figure question
- Back: explanation generated by AI

#### Save Entry Points

- Save from a text explanation card
- Save from a figure explanation card
- Convert any saved note into a flashcard later

#### Review Intent

V1 only needs basic storage and browsing. Spaced repetition can be V2.

### 5.5 Paper Metadata Detection

#### Goal

Associate notes with the current paper automatically.

#### Metadata to Extract

- Title
- Source URL
- Authors if available
- PDF filename
- Access timestamp

#### Sources

- Page title
- PDF URL
- Visible metadata on arXiv or paper landing pages

### 5.6 Follow-Up Question

#### Goal

Allow the user to ask one short follow-up on the most recent explanation without starting over.

#### Scope for V1

- Single-thread follow-up only on the latest result
- No full chat workspace
- Reuse the selected text or figure as conversation context

#### Example Follow-Ups

- `Explain the last sentence more simply`
- `What is the difference between these two terms`
- `Why does this figure support the method`

## 6. User Experience Flow

### 6.1 First-Time User Flow

1. User installs extension.
2. User opens a paper PDF in Chrome.
3. Extension shows a lightweight onboarding tip:
   `Highlight text or select a figure to get explanations.`
4. User makes first selection.
5. Extension opens side panel with result.

### 6.2 Text Explanation Flow

1. User highlights text.
2. Mini toolbar appears.
3. User clicks `Explain`.
4. Content, local context, and paper metadata are sent to backend.
5. Result appears in side panel.
6. User optionally saves as note or flashcard.

### 6.3 Figure Explanation Flow

1. User activates figure selection mode or right-clicks an image.
2. Extension captures image or selection region.
3. User confirms crop if needed.
4. Backend receives image plus local page context.
5. Result appears in side panel with figure preview.
6. User optionally saves result.

### 6.4 Save Flow

1. User reads an explanation result.
2. User clicks `Save`.
3. User chooses `Note`, `Flashcard`, or `Question`.
4. Extension creates a saved artifact linked to the current paper and source selection.
5. User can access the saved item from the `Saved` tab.

### 6.5 Failure Flow

1. User submits a request.
2. Backend fails or returns a timeout.
3. Side panel shows a clear error card with:
   - short reason
   - `Retry`
   - `Edit selection`
4. The original selection stays available so the user does not need to repeat the action.

## 7. Information Architecture

### 7.1 Main UI Surfaces

- Chrome side panel
- In-page mini toolbar
- Right-click context menu
- Small popup for login and settings only

### 7.2 Why Side Panel First

Popup is too constrained for iterative reading assistance. The side panel supports:

- Rich answers
- Follow-up questions
- Saved items
- Figure previews
- Persistent context across multiple selections

### 7.3 Wireframe: Floating Toolbar

```text
+---------------------------------------------------+
| Explain | Simplify | Define | Save                |
+---------------------------------------------------+
```

Behavior:

- Appears near selected text
- Dismisses on outside click or escape
- Repositions to avoid going off-screen

### 7.4 Wireframe: Side Panel Default State

```text
+--------------------------------------------------+
| Paper Reading Assistant                          |
| Paper: Attention Is All You Need                 |
| Page 4                                           |
+--------------------------------------------------+
| Tabs: [Current] [Saved] [History]                |
+--------------------------------------------------+
| Empty state                                      |
| Highlight text or select a figure to get help.   |
| [Start Figure Selection]                         |
+--------------------------------------------------+
```

### 7.5 Wireframe: Text Explanation Card

```text
+--------------------------------------------------+
| Selection: "multi-head attention allows..."      |
| Action: Explain                                  |
| Source: Page 4                                   |
+--------------------------------------------------+
| Plain Explanation                                |
| This paragraph says...                           |
|                                                  |
| Why It Matters                                   |
| The authors use this to...                       |
|                                                  |
| Key Terms                                        |
| - multi-head attention: ...                      |
| - projection: ...                                |
|                                                  |
| [Save] [Ask Follow-Up] [Copy]                    |
+--------------------------------------------------+
```

### 7.6 Wireframe: Figure Explanation Card

```text
+--------------------------------------------------+
| Figure Selection                                 |
| Preview: [thumbnail]                             |
| Source: Page 5                                   |
+--------------------------------------------------+
| What This Figure Shows                           |
| The chart compares...                            |
|                                                  |
| How To Read It                                   |
| The x-axis represents...                         |
|                                                  |
| Main Takeaway                                    |
| The method performs better when...               |
|                                                  |
| [Save] [Re-crop] [Ask Follow-Up]                 |
+--------------------------------------------------+
```

### 7.7 Wireframe: Figure Capture Overlay

```text
+--------------------------------------------------+
| Capture Figure                                   |
| Drag to select a figure region                   |
| [Cancel]                                         |
|                                                  |
|  ---------------- selected region -------------  |
| |                                              | |
| |                                              | |
|  ----------------------------------------------  |
|                                                  |
| [Use This Region] [Select Again]                |
+--------------------------------------------------+
```

## 8. Functional Requirements

### 8.1 Text Selection

- Detect text selection on supported pages and PDF viewers
- Show floating action toolbar near selection
- Capture selected text
- Capture nearby context when possible
- Send request to AI backend
- Render structured result

### 8.2 Image Selection

- Support HTML image right-click action
- Support screen-region capture for PDF figures
- Allow crop confirmation
- Upload image securely to backend
- Render figure explanation with preview

### 8.3 Persistence

- Save per-paper history
- Save notes, flashcards, and questions locally
- Restore recent session state

### 8.4 Account and API

- Support user login or API token session
- Handle usage limits and errors gracefully
- Show loading, retry, and failed states

### 8.5 State Requirements

The UI must support the following states:

- Empty state
- Loading state
- Success state
- Partial success state
- Error state
- Offline or unavailable state

#### Empty State

Shown before the first selection on a paper.

#### Loading State

Show skeleton UI and the action type such as `Explaining selection` or `Analyzing figure`.

#### Partial Success State

Use when the model can explain the text but cannot confidently read all labels from an image.

#### Error State

Must include a recoverable next action.

### 8.6 Acceptance Criteria

#### Text Explanation

- When the user highlights text, the floating toolbar appears.
- When the user clicks `Explain`, the side panel opens automatically if hidden.
- The generated result includes at least `Plain Explanation`.
- The user can save the result as a note.

#### Figure Explanation

- When the user activates figure selection, they can complete a crop on the visible page.
- The captured image preview appears before or with the result.
- The generated result includes at least `What This Figure Shows`.
- The user can re-crop without refreshing the page.

#### Persistence

- Saved notes remain available after page reload.
- History is grouped under the current paper identity.

## 9. Non-Functional Requirements

### 9.1 Performance

- Toolbar should appear within 150 ms after selection
- Side panel result request should start immediately
- Image capture flow should feel lightweight and not block reading

### 9.2 Privacy

- Only send selected text, selected image region, and minimal context
- Clearly disclose what is uploaded
- Allow users to delete stored local notes

### 9.3 Reliability

- Graceful fallback when PDF text selection is unavailable
- Graceful fallback when image capture fails
- Clear empty and error states

### 9.4 Usability Constraints

- Default explanations should be readable in under 20 seconds
- Core actions should be reachable within one click after selection
- The extension should not permanently obscure paper content

## 10. Technical Architecture

### 10.1 Chrome Extension Structure

- `manifest.json` using Manifest V3
- `background service worker`
- `content scripts`
- `side panel app`
- `popup`
- `options page`

### 10.2 Recommended Frontend Modules

- `selection-detector`
- `floating-toolbar`
- `pdf-adapter`
- `image-capture`
- `side-panel-ui`
- `storage-layer`
- `backend-client`

### 10.3 Backend Responsibilities

The backend should:

- Authenticate users
- Proxy requests to the LLM or multimodal model
- Store user artifacts if cloud sync is later enabled
- Enforce rate limits
- Log errors

### 10.4 AI Capability Split

Text tasks:

- Explain selected text
- Simplify text
- Define terms

Image tasks:

- Explain figures
- Explain diagrams and charts
- Describe tables rendered as images

### 10.5 PDF Handling Strategy

V1 should prioritize Chrome-native PDF reading scenarios.

Recommended approach:

- Support text selection where Chrome exposes it normally
- For figure explanation, use visible page screenshot or region capture
- Avoid building a custom PDF parser in V1 unless required

### 10.6 Request Flow

#### Text Request

1. Content script reads selected text and nearby context.
2. Content script sends payload to background worker.
3. Background worker sends request to backend.
4. Backend calls LLM.
5. Result is returned to side panel and stored in local history.

#### Figure Request

1. Content script enters figure capture mode.
2. User selects a region.
3. Extension captures visible image region.
4. Background worker sends image and metadata to backend.
5. Backend calls multimodal model.
6. Result is returned to side panel and stored in local history.

### 10.7 Suggested API Surface

#### `POST /api/explain-text`

Request:

```json
{
  "paper": {
    "title": "Attention Is All You Need",
    "url": "https://example.com/paper.pdf",
    "pageNumber": 4
  },
  "selection": {
    "text": "selected text",
    "context": "nearby paragraph"
  },
  "action": "explain"
}
```

#### `POST /api/explain-figure`

Request:

```json
{
  "paper": {
    "title": "Attention Is All You Need",
    "url": "https://example.com/paper.pdf",
    "pageNumber": 5
  },
  "figure": {
    "imageRef": "uploaded-image-reference",
    "caption": "optional nearby caption"
  },
  "action": "explain_figure"
}
```

#### `POST /api/follow-up`

Request:

```json
{
  "sourceResultId": "result_123",
  "question": "Why is this important?"
}
```

## 11. Permissions and Browser Capabilities

### 11.1 Likely Chrome Permissions

- `storage`
- `activeTab`
- `scripting`
- `contextMenus`
- `sidePanel`

Potential additional permissions depending on implementation:

- `tabs`
- `clipboardWrite`

For image capture, evaluate whether `tabs.captureVisibleTab` is required.

### 11.2 Permission Philosophy

Request the minimum set needed for:

- reading selected content
- showing UI
- capturing user-requested figure regions
- saving notes locally

### 11.3 Permission Notes

- `activeTab` is enough for user-initiated interaction in many cases
- `tabs.captureVisibleTab` may be needed for PDF figure capture
- Avoid broad host permissions in V1 unless site compatibility requires them

## 12. Output Design

### 12.1 Response Template for Text Explanation

- `Plain Explanation`
- `Why It Matters`
- `Key Terms`
- `Possible Confusion`

### 12.2 Response Template for Figure Explanation

- `What This Figure Shows`
- `How To Read It`
- `Important Details`
- `Main Takeaway`

### 12.3 Tone and Length

- Short by default
- Expandable for more detail
- Educational, not overly academic
- Avoid hallucinated claims not grounded in selected content

### 12.4 Response Guardrails

- Prefer `I cannot tell from the selected figure` over guessing
- Do not claim causal conclusions unless the source supports them
- Separate observation from interpretation where useful

## 13. Data Model

### 13.1 Paper

```json
{
  "id": "paper_123",
  "title": "Attention Is All You Need",
  "url": "https://example.com/paper.pdf",
  "sourceType": "pdf",
  "authors": ["..."],
  "createdAt": "2026-07-22T10:00:00Z"
}
```

### 13.2 Selection Item

```json
{
  "id": "sel_123",
  "paperId": "paper_123",
  "type": "text",
  "content": "selected text",
  "context": "nearby context",
  "pageNumber": 4,
  "createdAt": "2026-07-22T10:05:00Z"
}
```

### 13.3 Figure Selection

```json
{
  "id": "fig_123",
  "paperId": "paper_123",
  "type": "image",
  "imageRef": "local-or-uploaded-ref",
  "pageNumber": 5,
  "boundingBox": {
    "x": 120,
    "y": 300,
    "width": 420,
    "height": 260
  },
  "createdAt": "2026-07-22T10:08:00Z"
}
```

### 13.4 Saved Artifact

```json
{
  "id": "artifact_123",
  "paperId": "paper_123",
  "sourceSelectionId": "sel_123",
  "kind": "flashcard",
  "front": "What does this paragraph mean?",
  "back": "Generated explanation",
  "createdAt": "2026-07-22T10:10:00Z"
}
```

### 13.5 Result Object

```json
{
  "id": "result_123",
  "paperId": "paper_123",
  "sourceSelectionId": "sel_123",
  "action": "explain",
  "status": "success",
  "sections": [
    {
      "title": "Plain Explanation",
      "content": "..."
    }
  ],
  "createdAt": "2026-07-22T10:06:00Z"
}
```

## 14. MVP Definition

### 14.1 Must Have

- Chrome extension skeleton
- Side panel UI
- Text selection detection
- Floating toolbar
- Explain and simplify actions
- Define action
- Image or figure explanation
- Save as note
- Local storage
- Basic settings and login state

### 14.2 Should Have

- Save as flashcard
- Per-paper history
- Right-click context menu for figures
- Follow-up question on latest result

### 14.3 Can Wait

- Export to Notion or Anki
- Spaced repetition scheduling
- Cross-device sync
- Collaboration
- Deep citation linking

### 14.4 Explicit V1 Cut Line

The following should be excluded from the first implementation even if technically feasible:

- Full conversational copilot panel
- Automatic whole-paper summary on page load
- OCR-heavy document recovery pipeline
- Anki export
- User workspace syncing across browsers

## 15. Risks and Design Challenges

### 15.1 PDF Selection Consistency

Browser PDF viewers are less predictable than normal webpages. Selection handling and figure capture may behave differently across sources.

Mitigation:

- Start with Chrome-native PDF workflow
- Validate on arXiv-hosted PDFs and common PDF URLs
- Keep fallback capture flow simple

### 15.2 Figure Region Capture Quality

Poor cropping or low-resolution capture can degrade explanation quality.

Mitigation:

- Show crop preview before submit
- Allow quick reselect
- Warn on small images

### 15.3 Hallucinated Explanations

AI may over-interpret content beyond the selected evidence.

Mitigation:

- Use structured prompts grounded in selected content
- Ask model to distinguish direct observation from inference
- Keep outputs concise and evidence-aware

### 15.4 Latency

Students expect the tool to feel immediate.

Mitigation:

- Stream response text where possible
- Use lightweight default prompts
- Cache recent results locally

### 15.5 PDF Compatibility Risk

Chrome PDF handling may differ between:

- browser-native PDF viewer
- embedded site viewers
- scanned PDFs

Mitigation:

- Define supported PDF environments for V1
- Detect unsupported pages and show a fallback message
- Delay scanned-PDF support until OCR is intentionally added

## 16. Suggested Prompting Strategy

### 16.1 Text Explanation Prompt Intent

Prompt the model to:

- explain only the selected text and nearby context
- use student-friendly language
- identify unknown terms
- state when the text is ambiguous

### 16.2 Figure Explanation Prompt Intent

Prompt the model to:

- describe only what is visible in the figure
- explain how to read the figure
- connect the figure to likely paper intent
- avoid inventing unreadable labels

### 16.3 Output Schema Preference

Use structured JSON responses from the backend model layer where possible, then map the data into UI sections. This reduces UI fragility and makes retry behavior cleaner.

## 17. Development Plan

### Phase 1: Prototype

- Build extension shell
- Implement side panel
- Implement text selection and toolbar
- Connect `Explain` action to backend

### Phase 2: PDF and Figure Support

- Improve PDF page compatibility
- Implement image or region capture
- Add figure explanation flow

### Phase 3: Learning Retention

- Save note and flashcard flows
- Add per-paper history
- Improve result organization

### Phase 4: Quality Hardening

- Improve unsupported-page detection
- Add analytics events
- Tune prompts for lower hallucination rates
- Add quota and usage messaging

## 18. Success Metrics

### Primary Metrics

- Number of explanation actions per active user
- Time from selection to result
- Save rate for notes and flashcards

### Learning-Oriented Proxy Metrics

- Repeat usage on the same paper
- Repeat usage across different papers
- Share of sessions using both text and figure explanation

### Operational Metrics

- Request success rate
- Median model latency
- Figure capture completion rate
- Retry rate after failure

## 19. Recommended V1 Build Decision

If we are optimizing for speed and product clarity, the first shipped version should be:

- Chrome only
- PDF-first
- Side-panel-centered
- Cloud API backed
- Text explanation plus figure explanation
- Local note saving only

This keeps the product focused on the strongest user value: helping students understand what they are reading at the moment they get stuck.

## 20. Open Decisions for Next Round

The next design pass should settle:

1. Whether figure explanation uses direct image right-click, screenshot crop, or both
2. Whether saved notes are local-only or user-account-backed in V1
3. Whether follow-up chat is available immediately or deferred to V2
4. Whether flashcards are manual-save only or auto-suggested
5. Whether the extension should support bilingual explanations

## 21. Recommended Next Design Deliverables

After this PRD-level draft, the next documents worth producing are:

1. Interaction spec for the floating toolbar and figure capture overlay
2. Side panel component tree and state machine
3. Backend API contract and prompt schema
4. MVP engineering task breakdown
