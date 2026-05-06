// popup.js — Rysh AI popup controller (streaming-aware, rysh-server backend)

import authService from './authService.js';
import apiService  from './api.js';

// ── DOM references ────────────────────────────────────────────────────────────
const setupScreen      = document.getElementById('setup-screen');
const chatScreen       = document.getElementById('chat-screen');
const openAuthBtn      = document.getElementById('open-auth-btn');
const shareBtn         = document.getElementById('share-btn');
const newChatBtn       = document.getElementById('new-chat-btn');
const menuBtn          = document.getElementById('menu-btn');
const dropdownMenu     = document.getElementById('dropdown-menu');
const menuPageContext  = document.getElementById('menu-page-context');
const menuSignout      = document.getElementById('menu-signout');
const messagesArea     = document.getElementById('messages-area');
const emptyState       = document.getElementById('empty-state');
const loadingIndicator = document.getElementById('loading-indicator');
const errorBanner      = document.getElementById('error-banner');
const errorText        = document.getElementById('error-text');
const errorClose       = document.getElementById('error-close');
const messageInput     = document.getElementById('message-input');
const sendBtn          = document.getElementById('send-btn');
const headerTitle      = document.querySelector('.header-title');

// ── State ─────────────────────────────────────────────────────────────────────
let isLoading           = false;
let currentBubble       = null;   // streaming: current assistant bubble element
let currentBubbleText   = '';     // streaming: accumulated text for current bubble
let pendingApproval     = null;   // current approval request waiting for user
let activeShareID       = null;   // shareID if pane is currently shared

// ── Startup: load server URL config, wire up event handlers ───────────────────
(async () => {
  await apiService.loadServerURL();

  apiService.onOutput(handleOutput);
  apiService.onStatus(handleStatus);
  apiService.onApproval(handleApproval);
})();

// ── Auth state ────────────────────────────────────────────────────────────────
authService.onAuthStateChanged(async user => {
  if (user) {
    showScreen('chat');
    // Eagerly create a pane on auth so the WebSocket is ready before the first prompt.
    const token = await authService.getToken();
    if (token) {
      try {
        await apiService.ensurePane(token);
      } catch (err) {
        showError('Could not connect to Rysh server: ' + err.message);
      }
    }
  } else {
    showScreen('setup');
  }
});

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(name) {
  setupScreen.classList.toggle('hidden', name !== 'setup');
  chatScreen.classList.toggle('hidden',  name !== 'chat');
}

// ── Auth button ───────────────────────────────────────────────────────────────
openAuthBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_AUTH' });
});

// ── Share pane ────────────────────────────────────────────────────────────────
shareBtn.addEventListener('click', async () => {
  const token = await authService.getToken();
  if (!token || !apiService._paneID) return;

  // If already shared, just re-copy the command to clipboard.
  if (activeShareID) {
    const cmd = '##upstream subscribe ' + activeShareID;
    await copyToClipboard(cmd);
    flashShareBtn('Copied!');
    return;
  }

  shareBtn.disabled = true;
  try {
    const serverURL = await authService.getServerURL();
    const resp = await fetch(`${serverURL}/api/browser-panes/${apiService._paneID}/share`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Share failed: ${resp.status}`);
    const data = await resp.json();
    activeShareID = data.share_id;
    await copyToClipboard(data.subscribe_cmd);
    setShareActive(true);
    flashShareBtn('Copied!');
  } catch (err) {
    showError('Share failed: ' + err.message);
  } finally {
    shareBtn.disabled = false;
  }
});

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    // Fallback for contexts where clipboard API is restricted.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function setShareActive(active) {
  shareBtn.classList.toggle('share-active', active);
  shareBtn.title = active
    ? 'Pane shared — click to copy ##upstream subscribe command again'
    : 'Share pane — copies ##upstream subscribe command';
}

function flashShareBtn(label) {
  const toast = document.createElement('div');
  toast.className = 'share-toast';
  toast.textContent = label;
  document.body.appendChild(toast);
  // Trigger reflow then animate in.
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 1800);
}

// ── New chat ──────────────────────────────────────────────────────────────────
newChatBtn.addEventListener('click', async () => {
  const token = await authService.getToken();
  if (token) {
    try { await apiService.clearHistory(token); } catch (_) {}
    // Create a fresh pane.
    try { await apiService.createPane(token); } catch (err) {
      showError('Could not create new session: ' + err.message);
    }
  }
  clearMessages();
  hideError();
  closeMenu();
  resetStatus();
  activeShareID = null;
  setShareActive(false);
});

// ── Menu ──────────────────────────────────────────────────────────────────────
menuBtn.addEventListener('click', e => {
  e.stopPropagation();
  dropdownMenu.classList.toggle('open');
});

document.addEventListener('click', () => closeMenu());

function closeMenu() {
  dropdownMenu.classList.remove('open');
}

// ── Page context ──────────────────────────────────────────────────────────────
menuPageContext.addEventListener('click', async () => {
  closeMenu();
  const ctx = await capturePageContext();
  if (!ctx) return;

  let contextMsg = `[Page context]\nTitle: ${ctx.title}\nURL: ${ctx.url}`;
  if (ctx.description) contextMsg += `\nDescription: ${ctx.description}`;
  if (ctx.selected)    contextMsg += `\n\nSelected text:\n${ctx.selected}`;

  messageInput.value = contextMsg + '\n\n';
  messageInput.dispatchEvent(new Event('input'));
  messageInput.focus();
  messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length);
});

// ── Sign out ──────────────────────────────────────────────────────────────────
menuSignout.addEventListener('click', async () => {
  closeMenu();
  const token = await authService.getToken();
  if (token) {
    try { await apiService.clearHistory(token); } catch (_) {}
  }
  await authService.signOut();
  clearMessages();
  resetStatus();
});

// ── Input auto-resize ─────────────────────────────────────────────────────────
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  sendBtn.disabled = messageInput.value.trim() === '' || isLoading;
});

// ── Send on Enter ─────────────────────────────────────────────────────────────
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

sendBtn.addEventListener('click', () => {
  if (!sendBtn.disabled) sendMessage();
});

// ── Error close ───────────────────────────────────────────────────────────────
errorClose.addEventListener('click', hideError);

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isLoading) return;

  hideError();
  isLoading = true;
  sendBtn.disabled = true;

  // Clear input.
  messageInput.value = '';
  messageInput.style.height = 'auto';

  // Hide empty state.
  emptyState.style.display = 'none';

  // Append user message.
  appendMessage('user', text);

  // Show loading indicator.
  loadingIndicator.classList.remove('hidden');
  scrollToBottom();

  // Reset streaming state — a new assistant bubble will be created on first output chunk.
  currentBubble     = null;
  currentBubbleText = '';

  // Capture page context (best-effort; sent to server before the prompt).
  const pageCtx = await capturePageContext();

  const token = await authService.getToken();
  if (!token) {
    loadingIndicator.classList.add('hidden');
    showError('Not authenticated — please sign in.');
    isLoading = false;
    sendBtn.disabled = false;
    return;
  }

  try {
    await apiService.sendPrompt(text, pageCtx ? {
      url:           pageCtx.url           || '',
      title:         pageCtx.title         || '',
      selected_text: pageCtx.selected      || '',
      body_text:     pageCtx.body          || '',
    } : null, token);
  } catch (err) {
    loadingIndicator.classList.add('hidden');
    showError(err.message || 'Failed to send message.');
    isLoading = false;
    sendBtn.disabled = messageInput.value.trim() === '';
  }
  // Loading state continues until MsgAgenticStatus phase === "done" or "error".
}

// ── Output handler (streaming) ────────────────────────────────────────────────
function handleOutput({ type, content }) {
  loadingIndicator.classList.add('hidden');

  if (type === 'error') {
    showError(content || 'Unknown error from backend.');
    return;
  }

  if (!content) return;

  if (type === 'text' || type === 'diff') {
    // Append to the current streaming bubble (or start a new one).
    if (!currentBubble) {
      currentBubble = createStreamingBubble();
    }
    currentBubbleText += content;
    currentBubble.innerHTML = renderMarkdown(currentBubbleText);
    scrollToBottom();
  } else if (type === 'tool_call') {
    // Show tool call as an inline note (not inside the main bubble).
    appendToolNote('▶ ' + content);
  } else if (type === 'tool_result') {
    // Show tool result summary.
    appendToolNote('✓ ' + content);
  }
}

// ── Status handler ────────────────────────────────────────────────────────────
function handleStatus({ phase, iteration, maxIterations }) {
  if (phase === 'done' || phase === 'error') {
    // Finalise the streaming bubble.
    currentBubble     = null;
    currentBubbleText = '';
    isLoading = false;
    sendBtn.disabled = messageInput.value.trim() === '';
    loadingIndicator.classList.add('hidden');
    resetStatus();
    if (phase === 'error') {
      showError('The agentic run ended with an error.');
    }
  } else {
    let statusLabel = phase.charAt(0).toUpperCase() + phase.slice(1) + '…';
    if (iteration > 0 && maxIterations > 0) {
      statusLabel += ` (${iteration}/${maxIterations})`;
    }
    setStatus(statusLabel);
  }
}

// ── Approval handler ──────────────────────────────────────────────────────────
function handleApproval({ requestID, type: _type, description, diff }) {
  pendingApproval = { requestID };

  // Remove any existing approval dialog.
  const existing = document.getElementById('approval-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id        = 'approval-dialog';
  dialog.className = 'approval-dialog';

  let html = `<div class="approval-header">⚠ Approval Required</div>`;
  html += `<div class="approval-description">${escapeHtml(description)}</div>`;
  if (diff && diff.unified_diff) {
    html += `<details class="approval-diff"><summary>View diff: ${escapeHtml(diff.file_path || '')}</summary><pre><code>${escapeHtml(diff.unified_diff)}</code></pre></details>`;
  }
  html += `<div class="approval-actions">`;
  html += `<button class="approval-btn approval-yes"     data-decision="yes">Yes</button>`;
  html += `<button class="approval-btn approval-always"  data-decision="yes_always">Yes, Always</button>`;
  html += `<button class="approval-btn approval-no"      data-decision="no">No</button>`;
  html += `</div>`;
  dialog.innerHTML = html;

  dialog.querySelectorAll('.approval-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const decision = btn.dataset.decision;
      if (pendingApproval) {
        apiService.sendApprovalResponse(pendingApproval.requestID, decision, '');
        pendingApproval = null;
      }
      dialog.remove();
    });
  });

  messagesArea.appendChild(dialog);
  scrollToBottom();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function appendMessage(role, text) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = renderMarkdown(text);

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = formatTime(new Date());

  wrapper.appendChild(bubble);
  wrapper.appendChild(meta);
  messagesArea.appendChild(wrapper);
  scrollToBottom();
}

/** createStreamingBubble adds a new (empty) assistant bubble and returns its inner div. */
function createStreamingBubble() {
  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant streaming';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = formatTime(new Date());

  wrapper.appendChild(bubble);
  wrapper.appendChild(meta);
  messagesArea.appendChild(wrapper);
  scrollToBottom();

  // Remove streaming class once done (caller sets currentBubble = null on done).
  return bubble;
}

function appendToolNote(text) {
  const note = document.createElement('div');
  note.className = 'tool-note';
  note.textContent = text;
  messagesArea.appendChild(note);
  scrollToBottom();
}

function clearMessages() {
  const messages = messagesArea.querySelectorAll('.message, .tool-note, .approval-dialog');
  messages.forEach(m => m.remove());
  emptyState.style.display = '';
  currentBubble     = null;
  currentBubbleText = '';
}

function scrollToBottom() {
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

function showError(msg) {
  errorText.textContent = msg;
  errorBanner.classList.remove('hidden');
}

function hideError() {
  errorBanner.classList.add('hidden');
  errorText.textContent = '';
}

function setStatus(label) {
  if (headerTitle) headerTitle.textContent = label;
}

function resetStatus() {
  if (headerTitle) headerTitle.textContent = 'Rysh AI';
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ── Page context capture ──────────────────────────────────────────────────────

/**
 * capturePageContext asks the background service worker for the current tab's
 * page content. Returns null if not available.
 */
async function capturePageContext() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
    return res?.context || null;
  } catch (_) {
    return null;
  }
}

// ── Minimal markdown renderer ─────────────────────────────────────────────────
function renderMarkdown(text) {
  let html = escapeHtml(text);

  // Fenced code blocks.
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code.
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold.
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic.
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered lists.
  html = html.replace(/^[ \t]*[-*+] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Paragraphs.
  html = html.replace(/\n\n+/g, '</p><p>');

  // Single newlines.
  html = html.replace(/\n/g, '<br>');

  return `<p>${html}</p>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
