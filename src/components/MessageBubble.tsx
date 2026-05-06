import React from 'react';
import type { Message } from '../types';
import { renderMarkdown } from '../utils/ansi';

interface Props {
  message: Message;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Single chat bubble (user, assistant, or tool note).
 * Uses the same CSS classes as the original popup.css for visual continuity.
 */
export default function MessageBubble({ message }: Props) {
  const { role, content, timestamp } = message;

  if (role === 'tool') {
    return (
      <div className="message tool self-start max-w-[92%]">
        <div className="message-bubble">{content}</div>
      </div>
    );
  }

  return (
    <div className={`message ${role}`}>
      <div
        className="message-bubble"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
      <div className="message-meta">{formatTime(timestamp)}</div>
    </div>
  );
}

/** Streaming assistant bubble — re-renders as content accumulates. */
export function StreamingBubble({ content }: { content: string }) {
  return (
    <div className="message assistant">
      <div
        className="message-bubble"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content || '…') }}
      />
    </div>
  );
}
