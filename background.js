// background.js — MV3 service worker

import authService from './authService.js';

// ── Side panel: open on toolbar icon click ───────────────────────────────────
// openPanelOnActionClick makes Chrome open the side panel automatically when
// the user clicks the Rysh AI toolbar icon, without needing a popup.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// ── First install: open the auth/onboarding tab ─────────────────────────────
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const isAuth = await authService.isAuthenticated();
    if (!isAuth) {
      chrome.tabs.create({ url: chrome.runtime.getURL('auth.html') });
    }
  }
});

// ── Message bus (popup ↔ background) ────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  handleMessage(request)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true; // keep channel open for async response
});

async function handleMessage({ type }) {
  switch (type) {
    case 'CHECK_AUTH':
      return { authenticated: await authService.isAuthenticated() };

    case 'SIGN_OUT':
      await authService.signOut();
      return { ok: true };

    case 'OPEN_AUTH':
      chrome.tabs.create({ url: chrome.runtime.getURL('auth.html') });
      return { ok: true };

    case 'GET_PAGE_CONTEXT': {
      // Side panels share the window with the active browser tab, but
      // currentWindow refers to the side-panel window, not the tab window.
      // Query lastFocusedWindow first; fall back to currentWindow.
      let tab = null;
      const [lastFocused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (lastFocused?.id) {
        tab = lastFocused;
      } else {
        const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = current ?? null;
      }
      if (!tab?.id) return { context: null };

      // Skip chrome:// and other protected system pages (scripting not allowed).
      const url = tab.url ?? '';
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
          url.startsWith('about:') || url === '') {
        return { context: { url, title: tab.title ?? '', selected: '', description: '', body: '' } };
      }

      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const MAX_BODY = 30000;
            // Capture the full page body text so sidebars, nav lists, etc.
            // are included.  Also capture focused/article content separately
            // for pages where body.innerText is huge but the main content is
            // what the user cares about.
            const fullBody = (document.body?.innerText || '').substring(0, MAX_BODY).trim();
            return {
              title:       document.title,
              url:         location.href,
              selected:    getSelection()?.toString() ?? '',
              description: document.querySelector('meta[name="description"]')?.content ?? '',
              body:        fullBody,
            };
          },
        });
        return { context: result };
      } catch (err) {
        // Script injection failed (CSP, cross-origin iframe, etc.) — return
        // what we already know from the tab metadata.
        return { context: { url, title: tab.title ?? '', selected: '', description: '', body: '' } };
      }
    }

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}
