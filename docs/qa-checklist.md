# Paper Reading Assistant — QA Checklist

This document defines the manual verification matrix, smoke test procedures, and known limitations for the V1 release.

## 1. QA Test Matrix

Each row is a core flow that must pass before release. Run each test in a fresh Chrome window with the extension loaded.

### 1.1 Extension Load

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| L1 | Load unpacked | `chrome://extensions` → Developer mode → Load unpacked → select project root | Extension loads with no errors in the Extensions page | |
| L2 | Service worker starts | Click "service worker" link on the Extensions page | DevTools console shows no red errors | |
| L3 | Side panel opens | Click extension icon → "Open Side Panel" | Side panel opens, shows empty state with "Highlight text or select a figure" | |
| L4 | Content script injects | Open any `https://` page → open DevTools Console | Content script loaded (check `globalThis.PaperReadingAssistantShared` exists) | |

### 1.2 Text Selection Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| T1 | Toolbar appears on selection | Open a webpage → select 2+ chars of text | Floating toolbar fades in above or below selection with Explain, Simplify, Define, Save buttons | |
| T2 | Toolbar dismisses on Escape | Select text → press `Escape` | Toolbar disappears, selection cleared | |
| T3 | Toolbar dismisses on outside click | Select text → click elsewhere on page | Toolbar disappears | |
| T4 | Empty selection ignored | Click on text without dragging | No toolbar appears | |
| T5 | Single-char selection ignored | Select exactly 1 character | No toolbar appears | |
| T6 | Selection too long warning | Select >1200 chars of text | Toolbar appears in disabled state with "Selection is too long" warning | |
| T7 | Explain action | Select text → click Explain | Side panel opens, shows loading card ("Explaining selection"), then result card with structured sections | |
| T8 | Simplify action | Select text → click Simplify | Side panel shows result with "Simplified Explanation" and "One-Sentence Takeaway" sections | |
| T9 | Define action | Select text → click Define | Side panel shows result with "Definition" and "Meaning In This Paper" sections | |
| T10 | Save from toolbar | Select text → click Save on toolbar | Item saved (no visible feedback in toolbar; check Saved tab in panel) | |
| T11 | Debounce duplicate clicks | Select text → click Explain twice rapidly | Only one request is sent (second click ignored within 800ms) | |
| T12 | Scroll repositions toolbar | Select text → scroll page | Toolbar moves to stay near selection; hides if selection scrolls out of viewport | |

### 1.3 Figure Capture Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| F1 | Enter figure mode | Click "Start Figure Selection" in side panel | Full-screen overlay with crosshair cursor, "Drag to select a figure region" hint | |
| F2 | Drag selection | In overlay → drag a rectangle on screen | Selection rectangle visible, non-selected area dimmed | |
| F3 | Confirm region | After drag → click "Use This Region" | Overlay closes, side panel shows loading card ("Analyzing figure"), then figure result card with partial-success caution note | |
| F4 | Select Again | After drag → click "Select Again" | Current rectangle clears, stays in overlay mode | |
| F5 | Cancel overlay | In overlay → click "Cancel" or press Escape | Overlay closes, page returns to normal | |
| F6 | Small region warning | Drag a very small region (<80px) | Warning text "Region is quite small" appears | |
| F7 | Micro-drag ignored | Drag less than 20px | No selection rectangle forms, stays in idle overlay mode | |
| F8 | Re-crop from result | On figure result card → click "Re-crop" | Figure selection overlay starts again | |
| F9 | Context menu (image) | Right-click an `<img>` element → "Explain this figure" | Side panel opens with loading, then figure result | |

### 1.4 Side Panel — Current Tab

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| P1 | Empty state | Open side panel with no prior actions | Shows "Highlight text or select a figure" with Start Figure Selection button | |
| P2 | Loading state | Trigger any text/figure action | Loading card with spinner, "Explaining selection" or "Analyzing figure" label | |
| P3 | Success state | After successful Explain | Result card with source summary, action title, sections, action row (Save, Ask Follow-Up, Copy) | |
| P4 | Partial success state | After figure explain (mock) | Result card with caution note "Some details may be unclear" at top | |
| P5 | Error state | Switch API to real mode, kill backend, trigger action | Error card with "The last request failed", Retry button | |
| P6 | Retry from error | On error card → click Retry | Loading card appears, then result (if backend recovered) or error again | |
| P7 | Copy button | On text result → click Copy | Content copied to clipboard, toast "Copied to clipboard" | |
| P8 | Save button | On result → click Save | Item saved, toast "Saved to this paper" | |

### 1.5 Side Panel — Saved Tab

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| S1 | Saved list populates | Save a few results → switch to Saved tab | Saved items appear with kind label, front text, and back text | |
| S2 | Filter: All | Save note + flashcard + question → click "All" | All items visible | |
| S3 | Filter: Notes | Click "Notes" filter | Only note items visible | |
| S4 | Filter: Flashcards | Click "Flashcards" filter | Only flashcard items visible | |
| S5 | Filter: Questions | Click "Questions" filter | Only question items visible | |
| S6 | Empty saved state | Clear storage → open Saved tab | "No saved items yet." message | |
| S7 | Persistence after reload | Save an item → reload page → reopen side panel → Saved tab | Saved items still present | |

### 1.6 Side Panel — History Tab

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| H1 | History populates | Trigger a few explain actions → switch to History tab | Each result appears with source summary, action title, and Open button | |
| H2 | Reopen history item | Click "Open" on a history item | Switches to Current tab, restores the full result thread | |
| H3 | History persistence | Trigger actions → reload page → reopen panel → History tab | History items still present | |
| H4 | Empty history | Clear storage → open History tab | "No history yet." message | |

### 1.7 Follow-Up Flow

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| FU1 | Open composer | On result card → click "Ask Follow-Up" | Input field appears below result with placeholder "Why is this important?" | |
| FU2 | Submit follow-up | Type question → press Enter or click Send | Input shows "Sending follow-up..." then follow-up response appears below result | |
| FU3 | Cancel follow-up | Open composer → click Cancel | Composer closes, draft text cleared | |
| FU4 | Empty submit blocked | Open composer → click Send without typing | No request sent (empty input ignored) | |
| FU5 | Follow-up error → retry | Switch to real mode, kill backend, submit follow-up | Error message "Follow-up failed" with Retry button, typed question preserved | |

### 1.8 Persistence and Recovery

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| PR1 | Loading not persisted | Trigger action → close side panel during loading → reopen panel | Panel shows empty state (not stuck in loading) | |
| PR2 | Toast not persisted | Trigger a toast → close panel → reopen | No toast appears on reopen | |
| PR3 | Success persisted | Get a successful result → close panel → reopen | Result thread still visible in Current tab | |
| PR4 | History persisted across restart | Generate results → close panel → close all extension pages → reopen panel | History items still present | |
| PR5 | Saved persisted across restart | Save items → close panel → close all extension pages → reopen panel | Saved items still present | |
| PR6 | State survives SW restart | Generate a result → navigate to `chrome://extensions` → click "service worker" → wait for SW to stop → trigger new action | New action works correctly; old state preserved in storage | |

### 1.9 Unsupported and Edge Cases

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| U1 | Unsupported page (figure) | On `chrome://extensions` page → click "Start Figure Selection" | Error card "This page isn't supported" with guidance text, no Retry button | |
| U2 | Scanned PDF | Open a scanned PDF (image-only) → try selecting text | No toolbar appears (text selection unavailable); figure capture still works | |
| U3 | Tab switch preserves state | Get a result → switch to Saved tab → switch back to Current | Result thread still visible | |
| U4 | Rapid action switching | Select text → click Explain → immediately select new text → click Simplify | Latest action wins, both results in history | |
| U5 | Page navigation during request | Trigger Explain → immediately navigate to another page | Side panel keeps the result if already shown; no crash | |

## 2. Manual Smoke Test (Quick Pass)

This is the minimum set to run before a beta release. Estimated time: 10 minutes.

**Prerequisites**: Extension loaded in mock mode (default).

**Step 1 — Load and open**:
- Open `chrome://extensions`, verify extension loaded with no errors.
- Open any webpage (e.g., `https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)`).
- Click extension icon → "Open Side Panel".
- Verify: side panel shows empty state.

**Step 2 — Text explain**:
- Select a paragraph of text on the page.
- Verify: floating toolbar appears.
- Click "Explain".
- Verify: side panel shows loading, then result card with "Plain Explanation", "Why It Matters", "Key Terms" sections.

**Step 3 — Save and history**:
- Click "Save" on the result card.
- Verify: toast "Saved to this paper" appears.
- Switch to "Saved" tab → verify item appears.
- Switch to "History" tab → verify entry appears with "Open" button.
- Click "Open" → verify it returns to Current tab with the result thread.

**Step 4 — Follow-up**:
- Click "Ask Follow-Up" on the result.
- Type "Why is this important?" and press Enter.
- Verify: follow-up response appears below the result.

**Step 5 — Figure capture**:
- Click "Start Figure Selection" in the header.
- Drag a rectangle on any image or figure on the page.
- Click "Use This Region".
- Verify: side panel shows loading, then figure result with caution note (partial success in mock mode).

**Step 6 — Persistence**:
- Close the side panel.
- Reopen the side panel.
- Verify: the last result is still visible in Current tab.
- Verify: Saved and History tabs still have their items.

**Step 7 — Reload persistence**:
- Reload the webpage.
- Reopen the side panel.
- Verify: Saved and History items still present.

## 3. Backend Smoke Test

If testing with the real backend:

```bash
cd backend
npm install
npm start
node test-smoke.js
```

The smoke test covers:
1. Health endpoint
2. Explain text (explain, simplify, define)
3. Explain figure
4. Follow-up
5. Error cases (missing field, too short, invalid action, 404)

All 10 tests should print responses. Verify no `status: "error"` on tests 1–6.

## 4. Known Limitations

### 4.1 Figure Capture

- **No actual image capture**: The mock flow captures the bounding box coordinates but does not produce a real image blob. `imageRef` and `thumbnailRef` are empty strings. Real image capture requires `chrome.tabs.captureVisibleTab` integration, which is deferred to post-MVP.
- **Context menu figure explain**: Right-clicking an image sends the image URL as `imageRef`. This works for web-hosted images but not for data URIs or blob URLs from PDF viewers.

### 4.2 PDF Support

- **Chrome built-in PDF viewer**: The content script may not inject into Chrome's built-in PDF viewer URL (`chrome://pdf-viewer`). Text selection may not be available. Use figure capture as a fallback.
- **arXiv PDFs**: HTML abstract pages work fully. PDF direct links may have limited text selection depending on the viewer. Figure capture works on the visible viewport.
- **Scanned PDFs**: Text selection is unavailable. The toolbar will not appear. Figure capture is the only supported flow. OCR is explicitly de-scoped for MVP.

### 4.3 Backend and Model

- **Mock mode default**: The extension ships with `mode: "mock"` so it works without a running backend. All responses are scaffold text, not real model output. Figure explanations always return `partial_success` with a mock warning.
- **No real model integration**: The backend uses a mock model adapter. Real LLM/multimodal model integration requires API keys and provider configuration.
- **No authentication**: The API client supports an auth token but the options page is a placeholder. Token must be set via DevTools or storage manipulation.

### 4.4 Service Worker Lifecycle

- **SW kill during request**: If Chrome kills the MV3 service worker while a request is in flight, the request is lost. On panel reopen, the state is sanitized to `empty` (not stuck in `loading`). The user must re-trigger the action. This is an inherent MV3 limitation.
- **State broadcast to closed panel**: If the side panel is closed when a request completes, the `STATE_UPDATED` broadcast is silently dropped. The state is still persisted to storage and will be visible when the panel reopens.

### 4.5 Follow-Up

- **One follow-up at a time**: Only one follow-up composer is open at a time, attached to the latest thread only. No multi-branch conversation tree.
- **Follow-up draft not persisted**: The follow-up input draft is UI-local state and is lost if the panel closes. This is intentional per spec §13.1.

### 4.6 Save

- **Save as Note only**: The V1 save flow saves all items as `kind: "note"`. The toolbar Save button saves raw selection text. The result card Save button saves the structured result. Flashcard and question kinds are supported in the filter UI but not yet wired to creation flows.
- **No saved item editing**: Saved items can be viewed and filtered but not edited or deleted from the UI.

### 4.7 Options Page

- **Placeholder**: The options page is a static placeholder. API config (baseUrl, mode, authToken) must be changed via Chrome DevTools on the service worker or by writing to `chrome.storage.local` directly.

### 4.8 Analytics

- **No analytics events**: Analytics event hooks (spec §12) are not implemented in V1. The `request_failed` event is the most critical missing one for monitoring.

### 4.9 Accessibility

- **Keyboard navigation**: `Escape` closes the toolbar and cancels figure capture. `Enter` submits follow-up. `Tab` order is logical but not formally tested with screen readers.
- **Focus states**: All buttons have `:focus-visible` outlines. Side panel is usable at narrow widths but has not been tested with assistive technology.

## 5. Pre-Release Checklist

Before tagging a beta release, verify:

- [ ] Extension loads cleanly on a fresh Chrome profile with no console errors.
- [ ] All items in Section 1 (QA Test Matrix) have a pass/fail record.
- [ ] Smoke test (Section 2) completes without issues.
- [ ] Backend smoke test (Section 3) passes if testing with real backend.
- [ ] Known limitations (Section 4) are documented and communicated.
- [ ] Manifest permissions are minimal and reviewed.
- [ ] No hardcoded API keys or secrets in source.
- [ ] `manifest.json` version is bumped.
- [ ] Extension functions correctly after Chrome restart (state survives).
- [ ] Figure capture overlay does not break on pages with iframes.
- [ ] No memory leaks during extended reading sessions (check SW heap usage).
