# Paper Reading Assistant

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

A Chrome extension (MV3) that helps students understand academic papers without leaving the reading flow. Highlight text to get explanations, simplifications, or definitions; drag-select a figure region to get a structured breakdown; save useful results locally and revisit them later.

## Current Implementation Status

The following features are currently implemented:

- Chrome Manifest V3 extension with popup, options page, and side panel.
- Text selection toolbar for explaining, simplifying, defining, and saving selected text.
- Structured result cards with contextual follow-up questions.
- Saved items and per-paper reading history stored in `chrome.storage.local`.
- Full webpage summarization using cleaned HTML with a plain-text fallback.
- Local PDF Workspace with PDF rendering, page navigation, zoom, text selection, and full-document summarization.
- HTML and PDF conversion through the bundled MarkItDown source in `html_pdf2md/markitdown`.
- Mock, real, and automatic API modes.
- OpenAI-compatible LLM configuration, including custom base URL, model, API key, and output language.
- English, Simplified Chinese, and Japanese interface text.
- Backend request validation, rate limiting, optional API authentication, request IDs, structured logging, and sensitive-header redaction.
- Retry handling for failed text, figure, and document-summary requests.

> **Testing status:** 图片选择功能未测试。The figure-region selection and figure explanation workflow is implemented but has not yet been manually verified.

## Quick Start

### 1. Load the Extension

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select this repository's root folder (the one containing `manifest.json`).
5. The extension icon appears in your toolbar. Pin it for easy access.

### 2. (Optional) Start the Backend

The extension ships in **mock mode**, meaning all API calls return scaffold responses without a running server. To test against the real backend:

```bash
cd backend
npm install
npm run setup:python # creates backend/.venv and installs the bundled MarkItDown source
npm start          # starts on port 3000
node test-smoke.js # run smoke tests against all endpoints
```

The Python setup command installs
`html_pdf2md/markitdown/packages/markitdown` in editable mode, so document
conversion uses the source bundled with this repository. Set `PYTHON_BIN` only
when you need to use a different Python interpreter.

To switch the extension from mock to real mode, open the extension options page (right-click the extension icon → Options) and update the API config. Alternatively, use Chrome DevTools on the extension's service worker to call:

```js
chrome.storage.local.get("paperReadingAssistant.apiConfig", console.log)
chrome.storage.local.set({
  "paperReadingAssistant.apiConfig": {
    baseUrl: "http://localhost:3000",
    mode: "real",
    timeoutMs: 30000,
    authToken: null
  }
})
```

Set `mode` to `"mock"` for standalone UI development, `"real"` for production, or `"auto"` to try real first and fall back to mock.

### 3. Verify the Extension Works

After loading, run through this quick checklist:

- Click the extension icon → popup appears with "Open Side Panel" and "Open Settings" buttons.
- Click **Open Side Panel** → side panel opens with an empty state showing "Highlight text or select a figure".
- Open any webpage (e.g., a Wikipedia article) and select 2+ characters of text → a floating toolbar appears with Explain, Simplify, Define, Save buttons.
- Click **Explain** → side panel shows a loading card, then a result card with structured sections.
- Click **Save** on the result → toast appears saying "Saved to this paper"; switch to the **Saved** tab to see the item.
- Switch to the **History** tab → the result appears as a history item with an "Open" button.
- Click **Ask Follow-Up** on a result → an input field appears; type a question and press Enter → a follow-up response appears below the result.
- Click **Start Figure Selection** in the side panel header → a full-screen overlay appears with crosshair cursor; drag to select a region → confirm with "Use This Region" → a figure result card appears (partial success with a caution note in mock mode).

For the full QA matrix and manual smoke test procedures, see [docs/qa-checklist.md](docs/qa-checklist.md).

## Architecture

```
manifest.json
src/
├── background/
│   ├── background.js     — message routing + orchestration
│   ├── state-store.js    — chrome.storage.local read/write/broadcast
│   └── api-client.js     — backend API client (mock/real/auto)
├── content/
│   ├── content-script.js — text selection, floating toolbar, figure capture overlay
│   └── content-script.css
├── sidepanel/
│   ├── sidepanel.js      — boot entry (wiring)
│   ├── sidepanel-store.js — state ownership + action dispatch
│   ├── sidepanel-ui.js   — all DOM rendering
│   ├── sidepanel.css
│   └── sidepanel.html
├── shared/
│   ├── contracts.js      — constants, factories, mock generators
│   └── types.d.ts        — type declarations (documentation only)
├── popup/
│   ├── popup.html
│   └── popup.js
└── options/
    ├── options.html
    └── options.js
backend/
├── src/
│   ├── app.js            — Express app config
│   ├── config.js         — env-based configuration
│   ├── routes/           — health, explain-text, explain-figure, follow-up
│   ├── middleware/        — requestId, payloadLimit, validate, errorHandler
│   ├── models/           — mock model adapters
│   └── schemas.js        — AJV schemas for request validation
└── test-smoke.js         — endpoint smoke test
```

### Key Design Decisions

**State flow**: All state lives in `chrome.storage.local` under a single key (`paperReadingAssistant.appState`). The background service worker is the single writer; the side panel and popup are read-only consumers that receive `STATE_UPDATED` broadcasts.

**Persistence boundary**: Transient state (loading status, pending requests, toasts, confirm menus) is stripped by `sanitizeForStorage()` before writing to storage. This prevents stale "loading forever" states when the panel closes mid-request. See [side-panel-state-spec §13](docs/paper-reading-assistant-side-panel-state-spec.md#13-persistence-strategy).

**Retry from error**: When a text or figure action fails, the source payload is preserved in a minimal thread (no result cards) so the retry handler can reconstruct the API request without requiring the user to re-select.

**No build system**: The extension uses vanilla JS with `globalThis`-based module sharing. `contracts.js` is loaded via `manifest.json` (content script), `importScripts` (background), and `<script>` tags (side panel, popup). No bundler, no transpiler.

## Documentation

- [Interaction Spec](docs/paper-reading-assistant-interaction-spec.md) — toolbar, overlay, panel behavior
- [Side Panel State Spec](docs/paper-reading-assistant-side-panel-state-spec.md) — state machines, component tree
- [MVP Task Breakdown](docs/paper-reading-assistant-mvp-task-breakdown.md) — workstreams and milestones
- [Extension Design](docs/paper-reading-assistant-extension-design.md) — product overview
- [Backend API Spec](docs/paper-reading-assistant-backend-api-spec.md) — endpoint contracts
- [QA Checklist](docs/qa-checklist.md) — test matrix, smoke tests, known limitations

## Third-Party Software and Acknowledgements

This project includes and uses
[Microsoft MarkItDown](https://github.com/microsoft/markitdown), licensed under
the MIT License, to convert HTML and PDF documents into Markdown.

The bundled source is located in `html_pdf2md/markitdown`. Its original
copyright notice, license, and third-party notices are preserved in that
directory. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.

MarkItDown is a Microsoft open-source project. Microsoft does not sponsor,
endorse, maintain, or provide support for Paper Reading Assistant.
