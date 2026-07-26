/**
 * Paper Reading Assistant — Side Panel Entry Point
 *
 * Thin boot layer: creates the Store, subscribes the UI renderer,
 * and calls Store.init() to fetch initial state from the background
 * worker.
 *
 * Architecture:
 *   sidepanel-store.js  → state ownership, action dispatch, message wiring
 *   sidepanel-ui.js     → all DOM rendering, state machine → UI mapping
 *   sidepanel.js        → this file, boot + wiring
 */
(function () {
  var Store = globalThis.PaperReadingAssistantStore;
  var UI = globalThis.PaperReadingAssistantUI;

  // Subscribe UI render to store changes.
  // Every state change from the background worker triggers a re-render.
  Store.subscribe(() => {
    UI.render();
  });

  // Kick off initial state fetch.
  // Store.init() will notify subscribers once state arrives,
  // which triggers the first render.
  Store.init();
})();
