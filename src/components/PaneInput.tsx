import React, { useRef, useEffect, useState } from 'react';
import { useStore } from '../store';
import { apiService } from '../services/api';
import { authService } from '../services/auth';
import { MODE_PROMPT, MODE_PLACEHOLDER } from '../types';
import type { ContentBlock } from '../types';

const PROMPT_COLORS: Record<string, string> = {
  shell:  'text-[#34d399]',
  prompt: 'text-[#818cf8]',
  rysh:   'text-[#f87171]',
  chat:   'text-[#22d3ee]',
};

/**
 * PaneInput — mode-aware single-line input.
 * Prompt char changes per mode.  Up/Down arrows navigate per-mode history.
 * Double-ESC (handled globally in useKeyboard) cycles modes.
 */
export default function PaneInput() {
  const inputRef       = useRef<HTMLInputElement>(null);
  const inputMode      = useStore(s => s.inputMode);
  const inputText      = useStore(s => s.inputText);
  const isLoading      = useStore(s => s.isLoading);
  const history        = useStore(s => s.history);
  const historyIdx     = useStore(s => s.historyIdx);
  const historySaved   = useStore(s => s.historySaved);
  const setInputText   = useStore(s => s.setInputText);
  const addToHistory   = useStore(s => s.addToHistory);
  const setHistoryIdx  = useStore(s => s.setHistoryIdx);
  const setHistorySaved = useStore(s => s.setHistorySaved);
  const addMessage     = useStore(s => s.addMessage);
  const startStreaming  = useStore(s => s.startStreaming);
  const setIsLoading   = useStore(s => s.setIsLoading);
  const setErrorMessage = useStore(s => s.setErrorMessage);

  // Pending screenshot to attach to the next prompt (follow-up 1b).
  const [pendingImage, setPendingImage] = useState<ContentBlock | null>(null);
  const [capturing, setCapturing]       = useState(false);

  const aiMode = inputMode === 'prompt' || inputMode === 'chat';

  async function handleCapture() {
    if (capturing || isLoading) return;
    setCapturing(true);
    setErrorMessage(null);
    try {
      const block = await apiService.captureScreenshotBlock();
      setPendingImage(block);
    } catch (err) {
      setErrorMessage((err as Error).message || 'Screenshot capture failed.');
    } finally {
      setCapturing(false);
    }
  }

  // Auto-focus input when mode changes.
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputMode]);

  const promptChar = MODE_PROMPT[inputMode];
  const placeholder = MODE_PLACEHOLDER[inputMode];
  const promptColor = PROMPT_COLORS[inputMode];

  function handleHistoryUp() {
    const modeHistory = history[inputMode];
    if (modeHistory.length === 0) return;
    const idx = historyIdx[inputMode];
    if (idx === -1) {
      setHistorySaved(inputMode, inputText);
    }
    const newIdx = Math.min(idx + 1, modeHistory.length - 1);
    setHistoryIdx(inputMode, newIdx);
    setInputText(modeHistory[newIdx] || '');
  }

  function handleHistoryDown() {
    const idx = historyIdx[inputMode];
    if (idx <= 0) {
      setHistoryIdx(inputMode, -1);
      setInputText(historySaved[inputMode] || '');
      return;
    }
    const modeHistory = history[inputMode];
    const newIdx = idx - 1;
    setHistoryIdx(inputMode, newIdx);
    setInputText(modeHistory[newIdx] || '');
  }

  async function handleSubmit() {
    const text = inputText.trim();
    // Allow an image-only submission (screenshot attached, no text).
    if ((!text && !pendingImage) || isLoading) return;

    const blocks: ContentBlock[] | null = pendingImage ? [pendingImage] : null;

    // Add to history and reset idx (skip empty image-only submissions).
    if (text) {
      addToHistory(inputMode, text);
    }
    setHistoryIdx(inputMode, -1);
    setHistorySaved(inputMode, '');
    setInputText('');
    setPendingImage(null);
    setErrorMessage(null);

    // Add user message bubble (prompt / chat modes).
    if (inputMode === 'prompt' || inputMode === 'chat') {
      addMessage({
        id:        crypto.randomUUID(),
        role:      'user',
        content:   blocks ? (text ? `${text}\n[📷 screenshot attached]` : '[📷 screenshot attached]') : text,
        timestamp: new Date(),
        mode:      inputMode,
      });
      startStreaming(inputMode);
      setIsLoading(true);
    }

    // Capture page context (best-effort).
    let pageCtx: Record<string, string> | null = null;
    if (inputMode === 'prompt') {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
        const ctx = (res as { context?: Record<string, string> })?.context;
        if (ctx) {
          pageCtx = {
            url:           ctx.url           || '',
            title:         ctx.title         || '',
            selected_text: ctx.selected      || '',
            body_text:     ctx.body          || '',
          };
        }
      } catch { /* best-effort */ }
    }

    const token = await authService.getToken();
    if (!token) {
      setErrorMessage('Not authenticated — please sign in.');
      setIsLoading(false);
      return;
    }

    try {
      await apiService.submitInput(text, inputMode, token, pageCtx, blocks);
    } catch (err) {
      setErrorMessage((err as Error).message || 'Failed to send.');
      setIsLoading(false);
    }
  }

  return (
    <div className="flex items-center px-3 py-2 border-t border-border bg-surface shrink-0">
      {/* Mode prompt char */}
      <span
        className={`font-bold font-mono text-[13px] mr-1.5 select-none whitespace-nowrap shrink-0 ${promptColor}`}
      >
        {promptChar}
      </span>

      {/* Pending screenshot chip (follow-up 1b) */}
      {pendingImage && (
        <span
          className="flex items-center gap-1 mr-1.5 px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[11px] font-mono shrink-0"
          title="Screenshot attached to next prompt"
        >
          📷
          <button
            onClick={() => setPendingImage(null)}
            title="Remove screenshot"
            className="hover:text-error leading-none"
          >
            ✕
          </button>
        </span>
      )}

      {/* Text input */}
      <input
        ref={inputRef}
        type="text"
        value={inputText}
        placeholder={placeholder}
        disabled={isLoading && (inputMode === 'prompt' || inputMode === 'chat')}
        className="flex-1 bg-transparent border-none outline-none text-text font-mono text-[13px] caret-cyan placeholder:text-dim disabled:opacity-50"
        onChange={e => setInputText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            handleHistoryUp();
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            handleHistoryDown();
          }
        }}
      />

      {/* Attach screenshot button (AI modes, not loading) — follow-up 1b */}
      {aiMode && !isLoading && (
        <button
          onClick={handleCapture}
          disabled={capturing}
          title="Attach a screenshot of the current tab"
          className="ml-1 w-7 h-7 flex items-center justify-center rounded-md bg-surface hover:bg-border disabled:opacity-40 text-dim hover:text-text transition-colors shrink-0"
        >
          {capturing ? (
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          )}
        </button>
      )}

      {/* Send button (AI/chat modes while loading: show cancel button) */}
      {(inputMode === 'prompt' || inputMode === 'chat') && isLoading ? (
        <button
          onClick={() => apiService.cancelPrompt()}
          title="Cancel"
          className="ml-1 w-7 h-7 flex items-center justify-center rounded-md bg-error/20 hover:bg-error/30 text-error transition-colors shrink-0"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={!inputText.trim() || isLoading}
          title="Send (Enter)"
          className="ml-1 w-7 h-7 flex items-center justify-center rounded-md bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors shrink-0"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      )}
    </div>
  );
}
