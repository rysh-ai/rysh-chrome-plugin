import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { authService } from '../services/auth';
import { apiService }  from '../services/api';
import { storage }     from '../services/storage';
import ModeIndicator from './ModeIndicator';

/** Copies text to clipboard with a fallback for restricted contexts. */
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function ShareToast({ visible }: { visible: boolean }) {
  return (
    <div className={`share-toast ${visible ? 'visible' : ''}`}>
      Copied!
    </div>
  );
}

export default function Header() {
  const inputMode   = useStore(s => s.inputMode);
  const statusText  = useStore(s => s.statusText);
  const shareActive = useStore(s => s.shareActive);
  const activeShareID        = useStore(s => s.activeShareID);
  const activeShareWorkspace = useStore(s => s.activeShareWorkspace);
  const setShareActive            = useStore(s => s.setShareActive);
  const setActiveShareID          = useStore(s => s.setActiveShareID);
  const setActiveShareWorkspace   = useStore(s => s.setActiveShareWorkspace);
  const clearMessages    = useStore(s => s.clearMessages);
  const clearOutput      = useStore(s => s.clearOutput);
  const setIsLoading     = useStore(s => s.setIsLoading);
  const setStatusText    = useStore(s => s.setStatusText);
  const setConnected     = useStore(s => s.setConnected);
  const setPaneID        = useStore(s => s.setPaneID);
  const setErrorMessage  = useStore(s => s.setErrorMessage);

  const [menuOpen,         setMenuOpen]         = useState(false);
  const [shareLoading,     setShareLoading]     = useState(false);
  const [toastVisible,     setToastVisible]     = useState(false);
  const [sharePanel,       setSharePanel]       = useState(false);
  const [settingsOpen,     setSettingsOpen]     = useState(false);
  const [serverURLInput,   setServerURLInput]   = useState('');
  const [serverWorkspace,  setServerWorkspace]  = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const connected   = useStore(s => s.connected);

  // Close menu on outside click.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // Fetch server workspace when connected so it shows in the header.
  useEffect(() => {
    if (connected) {
      apiService.getServerWorkspace().then(ws => setServerWorkspace(ws)).catch(() => {});
    }
  }, [connected]);

  // Load server URL and workspace when settings panel opens.
  async function openSettings() {
    setMenuOpen(false);
    const [savedURL, cachedWS] = await Promise.all([
      storage.get('server_url') as Promise<string | null>,
      apiService.getServerWorkspace(),
    ]);
    setServerURLInput(savedURL || '');
    setServerWorkspace(cachedWS);
    setSettingsOpen(true);
  }

  async function saveSettings() {
    const url = serverURLInput.trim().replace(/\/$/, '');
    await storage.set({ server_url: url });
    apiService.setServerURL(url);
    // Re-fetch workspace for the new server URL.
    const ws = await apiService.fetchServerInfo();
    setServerWorkspace(ws);
    setSettingsOpen(false);
  }

  async function handleShare() {
    const token = await authService.getToken();
    if (!token) return;

    // If already sharing, just open the share panel.
    if (activeShareID) {
      setSharePanel(true);
      return;
    }

    setShareLoading(true);
    try {
      const data = await apiService.sharePane(token);
      setActiveShareID(data.share_id);
      setActiveShareWorkspace(data.workspace || 'default');
      setShareActive(true);
      setSharePanel(true);
    } catch (err) {
      setErrorMessage('Share failed: ' + (err as Error).message);
    } finally {
      setShareLoading(false);
    }
  }

  async function copyShareCommand() {
    if (!activeShareID) return;
    await copyToClipboard('##upstream subscribe ' + activeShareID);
    flashToast();
  }

  async function handleNewChat() {
    const token = await authService.getToken();
    if (token) {
      try { await apiService.clearHistory(token); } catch { /* ignore */ }
      try {
        const id = await apiService.createPane(token);
        setPaneID(id);
        setConnected(true);
      } catch (err) {
        setErrorMessage('Could not create new session: ' + (err as Error).message);
      }
    }
    clearMessages();
    clearOutput();
    setIsLoading(false);
    setStatusText('');
    setActiveShareID(null);
    setActiveShareWorkspace(null);
    setShareActive(false);
    setSharePanel(false);
    setMenuOpen(false);
  }

  async function handleSignOut() {
    setMenuOpen(false);
    const token = await authService.getToken();
    if (token) {
      try { await apiService.clearHistory(token); } catch { /* ignore */ }
    }
    await authService.signOut();
    clearMessages();
    clearOutput();
    setConnected(false);
    setPaneID(null);
  }

  async function handlePageContext() {
    setMenuOpen(false);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
      const ctx = (res as { context?: { title?: string; url?: string; description?: string; selected?: string } })?.context;
      if (!ctx) return;
      let msg = `[Page context]\nTitle: ${ctx.title || ''}\nURL: ${ctx.url || ''}`;
      if (ctx.description) msg += `\nDescription: ${ctx.description}`;
      if (ctx.selected)    msg += `\n\nSelected text:\n${ctx.selected}`;
      useStore.getState().setInputText(msg + '\n\n');
    } catch { /* best-effort */ }
  }

  function flashToast() {
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 1800);
  }

  const titleText = statusText || 'Rysh AI';

  // Derived: is workspace non-default?
  const ws = activeShareWorkspace || 'default';
  const wsNonDefault = ws !== 'default';

  return (
    <>
      {/* ── Share info panel ─────────────────────────────────────────────── */}
      {sharePanel && activeShareID && (
        <div className="absolute inset-0 z-50 flex items-start justify-center pt-10 bg-black/60"
             onClick={() => setSharePanel(false)}>
          <div className="bg-surface2 border border-border rounded-[12px] shadow-xl p-4 mx-3 w-full max-w-sm"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-text">Pane shared</span>
              <button onClick={() => setSharePanel(false)}
                      className="text-muted hover:text-text text-[18px] leading-none">×</button>
            </div>

            {/* Share ID */}
            <div className="text-[11px] text-muted mb-1">Share ID</div>
            <div className="font-mono text-[11px] text-text bg-surface px-2 py-1.5 rounded-md mb-3 break-all select-all">
              {activeShareID}
            </div>

            {/* Workspace note */}
            <div className="text-[11px] text-muted mb-1">CLI workspace</div>
            <div className="font-mono text-[11px] text-text bg-surface px-2 py-1.5 rounded-md mb-1 select-all">
              {ws}
            </div>
            {wsNonDefault ? (
              <p className="text-[11px] text-amber-400 mb-3">
                Add to <code className="text-amber-300">rysh.config</code>:
                &nbsp;<code className="text-amber-300">[upstream]<br/>workspace = {ws}</code>
                &nbsp;or set <code className="text-amber-300">RYSH_UPSTREAM_WORKSPACE={ws}</code>
              </p>
            ) : (
              <p className="text-[11px] text-muted mb-3">
                Default workspace — no extra CLI config needed.
              </p>
            )}

            {/* Subscribe command */}
            <div className="text-[11px] text-muted mb-1">Subscribe command</div>
            <div className="font-mono text-[11px] text-text bg-surface px-2 py-1.5 rounded-md mb-3 select-all">
              ##upstream subscribe {activeShareID}
            </div>

            <button
              onClick={copyShareCommand}
              className="w-full bg-primary hover:bg-primary-hover text-white rounded-[8px] py-2 text-[12px] font-semibold transition-colors"
            >
              Copy subscribe command
            </button>
          </div>
        </div>
      )}

      {/* ── Settings panel ───────────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="absolute inset-0 z-50 flex items-start justify-center pt-10 bg-black/60"
             onClick={() => setSettingsOpen(false)}>
          <div className="bg-surface2 border border-border rounded-[12px] shadow-xl p-4 mx-3 w-full max-w-sm"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] font-semibold text-text">Settings</span>
              <button onClick={() => setSettingsOpen(false)}
                      className="text-muted hover:text-text text-[18px] leading-none">×</button>
            </div>

            <label className="block text-[11px] text-muted mb-1">Server URL</label>
            <input
              type="text"
              value={serverURLInput}
              onChange={e => setServerURLInput(e.target.value)}
              placeholder="https://rysh.ai"
              className="w-full bg-surface border border-border rounded-[8px] px-3 py-2 text-[12px] text-text outline-none focus:border-primary mb-4"
            />

            <label className="block text-[11px] text-muted mb-1">
              NATS workspace
              <span className="ml-1 text-[10px] opacity-60">(from server)</span>
            </label>
            <div className="w-full bg-surface border border-border rounded-[8px] px-3 py-2 text-[12px] font-mono text-text mb-1 select-all">
              {serverWorkspace || '…'}
            </div>
            {serverWorkspace && serverWorkspace !== 'default' ? (
              <p className="text-[11px] text-amber-400 mb-4">
                Set in rysh.config: <code className="text-amber-300">[upstream] workspace = {serverWorkspace}</code>
                <br/>or env: <code className="text-amber-300">RYSH_UPSTREAM_WORKSPACE={serverWorkspace}</code>
              </p>
            ) : (
              <p className="text-[11px] text-muted mb-4">
                Default workspace — CLI works without any extra config.
              </p>
            )}

            <button
              onClick={saveSettings}
              className="w-full bg-primary hover:bg-primary-hover text-white rounded-[8px] py-2 text-[12px] font-semibold transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}

      <header className="flex items-center gap-2 px-3.5 py-3 bg-surface border-b border-border shrink-0 z-10 relative">
        {/* Logo */}
        <div className="w-7 h-7 bg-gradient-to-br from-primary to-primary-light rounded-[7px] flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
        </div>

        {/* Title + mode badge + workspace + connection dot */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[14px] font-bold text-text tracking-tight truncate">
            {titleText}
          </span>
          <ModeIndicator mode={inputMode} />
          {serverWorkspace && (
            <span
              className="text-[10px] font-mono text-muted bg-surface2 border border-border px-1.5 py-0.5 rounded-md shrink-0 truncate max-w-[80px]"
              title={`NATS workspace: ${serverWorkspace}`}
            >
              {serverWorkspace}
            </span>
          )}
          {/* Connection status indicator */}
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}
            title={connected ? 'Connected to server' : 'Disconnected — reconnecting…'}
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5">
          {/* Share */}
          <button
            onClick={handleShare}
            disabled={shareLoading}
            title={shareActive ? 'Pane shared — click to copy ##upstream subscribe command' : 'Share pane'}
            className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
              shareActive
                ? 'text-[#34d399] bg-[#1e3a2f]'
                : 'text-muted hover:text-text hover:bg-surface3'
            } disabled:opacity-40`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>

          {/* New chat */}
          <button
            onClick={handleNewChat}
            title="New chat"
            className="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-text hover:bg-surface3 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>

          {/* Menu */}
          <div ref={menuRef} className="relative">
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
              title="Menu"
              className="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-text hover:bg-surface3 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute top-[calc(100%+4px)] right-0 bg-surface2 border border-border rounded-[10px] shadow-lg min-w-[170px] overflow-hidden z-50">
                <button
                  onClick={handlePageContext}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-text text-[12.5px] hover:bg-surface3 transition-colors text-left"
                >
                  <svg className="w-3.5 h-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  Use page context
                </button>
                <div className="h-px bg-border mx-1" />
                <button
                  onClick={openSettings}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-text text-[12.5px] hover:bg-surface3 transition-colors text-left"
                >
                  <svg className="w-3.5 h-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                  Settings
                </button>
                <div className="h-px bg-border mx-1" />
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-error text-[12.5px] hover:bg-surface3 transition-colors text-left"
                >
                  <svg className="w-3.5 h-3.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <ShareToast visible={toastVisible} />
    </>
  );
}
