import React, { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { buildOutputHtml } from '../utils/ansi';
import MessageBubble, { StreamingBubble } from './MessageBubble';
import LoadingIndicator from './LoadingIndicator';
import type { InputMode } from '../types';

/** Empty-state shown when there are no messages yet for the current mode. */
function EmptyState({ mode }: { mode: InputMode }) {
  const hints: Record<InputMode, { title: string; body: string }> = {
    shell:  { title: 'Shell',        body: 'Run shell commands on your remote pane.' },
    prompt: { title: 'How can I help?', body: 'Ask anything — I can code, explain, research, or assist with tasks.' },
    rysh:   { title: 'Rysh commands', body: 'Enter ## commands to control your workspace.' },
    chat:   { title: 'Chat',          body: 'Have a conversation with Rysh AI.' },
  };
  const { title, body } = hints[mode];
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-5 py-8">
      <div className="w-11 h-11 bg-surface2 rounded-[12px] flex items-center justify-center mb-1">
        <svg className="w-5 h-5 text-primary-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <h3 className="text-[14px] font-semibold text-text">{title}</h3>
      <p className="text-[11.5px] text-muted leading-relaxed max-w-[200px]">{body}</p>
    </div>
  );
}

/** Terminal-style output display (shell / rysh modes). */
function TerminalOutput({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);

  if (!text) return null;

  return (
    <div
      ref={ref}
      className="pane-output flex-1"
      dangerouslySetInnerHTML={{ __html: buildOutputHtml(text) }}
    />
  );
}

/**
 * PaneOutput — switches display strategy based on input mode:
 *   shell / rysh  → TerminalOutput (ANSI-coloured text lines)
 *   prompt / chat → Chat bubbles  (markdown, streaming support)
 */
export default function PaneOutput() {
  const inputMode       = useStore(s => s.inputMode);
  const messages        = useStore(s => s.messages);
  const streamingContent = useStore(s => s.streamingContent);
  const streamingMode   = useStore(s => s.streamingMode);
  const shellOutput     = useStore(s => s.shellOutput);
  const ryshOutput      = useStore(s => s.ryshOutput);
  const isLoading       = useStore(s => s.isLoading);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef      = useRef<HTMLDivElement>(null);
  const scrollLockedRef = useRef(false);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    if (scrollLockedRef.current) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    });
  }, [messages.length, streamingContent]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    scrollLockedRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) > 20;
  }, []);

  // ── Terminal modes ─────────────────────────────────────────────────────────
  if (inputMode === 'shell') {
    return shellOutput
      ? <TerminalOutput text={shellOutput} />
      : <EmptyState mode="shell" />;
  }

  if (inputMode === 'rysh') {
    return ryshOutput
      ? <TerminalOutput text={ryshOutput} />
      : <EmptyState mode="rysh" />;
  }

  // ── Chat-bubble modes (prompt / chat) ──────────────────────────────────────
  const visibleMessages = messages.filter(m => m.mode === inputMode);
  const isStreamingForThisMode = streamingMode === inputMode;

  if (visibleMessages.length === 0 && !isStreamingForThisMode && !isLoading) {
    return <EmptyState mode={inputMode} />;
  }

  return (
    <div
      ref={scrollRef}
      className="messages-area"
      onScroll={handleScroll}
    >
      {visibleMessages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Live streaming bubble */}
      {isStreamingForThisMode && streamingContent !== null && (
        <StreamingBubble content={streamingContent} />
      )}

      {/* Loading dots (shown before first chunk arrives) */}
      {isLoading && !isStreamingForThisMode && (
        <LoadingIndicator />
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
