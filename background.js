// background.js — MV3 service worker

import authService from './authService.js';

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
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { context: null };
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            title:       document.title,
            url:         location.href,
            selected:    getSelection()?.toString() ?? '',
            description: document.querySelector('meta[name="description"]')?.content ?? '',
          }),
        });
        return { context: result };
      } catch {
        return { context: null };
      }
    }

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}
