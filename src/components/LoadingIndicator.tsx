import React from 'react';

/** Animated 3-dot loading indicator shown while AI is responding. */
export default function LoadingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-3.5 py-2.5 bg-surface border border-border rounded-[14px] rounded-bl-[4px] self-start mx-3.5 mb-1 animate-[msg-in_180ms_ease]">
      <div className="loading-dot" />
      <div className="loading-dot" />
      <div className="loading-dot" />
    </div>
  );
}
