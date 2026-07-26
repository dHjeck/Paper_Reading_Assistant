(function () {
  'use strict';

  var Shared = globalThis.PaperReadingAssistantShared;
  var status = document.getElementById('status');
  var activeTabId = null;

  function setStatus(message) {
    status.textContent = message || '';
  }

  void inspectActiveTab();

  async function inspectActiveTab() {
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs && tabs.length ? tabs[0] : null;
      activeTabId = tab && tab.id ? tab.id : null;
      var url = tab && tab.url ? tab.url : '';

      if (url.indexOf('file://') === 0) {
        setStatus(
          "If you test local files, enable 'Allow access to file URLs' in the extension details first."
        );
        return;
      }

      if (
        url.indexOf('chrome://') === 0 ||
        url.indexOf('edge://') === 0 ||
        url.indexOf('about:') === 0 ||
        url.indexOf('chrome-extension://') === 0
      ) {
        setStatus(
          "Chrome internal pages and Chrome's built-in PDF viewer do not allow this extension to inject selection tools."
        );
      }
    } catch (error) {
      // Ignore passive tab inspection failures.
    }
  }

  document.getElementById('open-side-panel').addEventListener('click', async () => {
    try {
      if (!activeTabId) {
        setStatus('No active tab found.');
        return;
      }

      void chrome.sidePanel
        .setOptions({
          tabId: activeTabId,
          path: 'src/sidepanel/sidepanel.html',
          enabled: true,
        })
        .catch(() => {
          // Best-effort enablement; open() is the gesture-critical call.
        });
      await chrome.sidePanel.open({ tabId: activeTabId });

      window.close();
    } catch (error) {
      setStatus('Unable to open the side panel on this tab.');
    }
  });

  document.getElementById('open-pdf-workspace').addEventListener('click', async () => {
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL('src/pdf-viewer/pdf-viewer.html'),
      });
      window.close();
    } catch (error) {
      setStatus('Unable to open the PDF workspace.');
    }
  });

  document.getElementById('refresh-current-tab').addEventListener('click', async () => {
    try {
      var response = await chrome.runtime.sendMessage({
        type: Shared.MessageType.REFRESH_ACTIVE_TAB,
      });

      if (response && response.ok) {
        setStatus('Current tab context refreshed.');
        return;
      }

      setStatus((response && response.error) || 'Unable to refresh the current tab context.');
    } catch (error) {
      setStatus('Unable to refresh the current tab context.');
    }
  });

  document.getElementById('reload-current-page').addEventListener('click', async () => {
    try {
      if (!activeTabId) {
        setStatus('No active tab found.');
        return;
      }

      await chrome.tabs.reload(activeTabId);
      setStatus(
        'Current page reloading. This helps attach selection tools to tabs opened before install.'
      );
    } catch (error) {
      setStatus('Unable to reload the current page.');
    }
  });

  document.getElementById('open-settings').addEventListener('click', async () => {
    try {
      await chrome.runtime.openOptionsPage();
      window.close();
    } catch (error) {
      setStatus('Unable to open settings.');
    }
  });
})();
