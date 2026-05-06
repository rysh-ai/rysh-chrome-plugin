import React from 'react';
import { useStore } from '../store';

/** Dismissible error banner shown above the input area. */
export default function ErrorBanner() {
  const errorMessage   = useStore(s => s.errorMessage);
  const setErrorMessage = useStore(s => s.setErrorMessage);

  if (!errorMessage) return null;

  return (
    <div className="flex items-center gap-2.5 mx-3.5 mb-1 px-3.5 py-2.5 bg-error-bg border border-error/30 rounded-[10px] text-error text-[12px] shrink-0">
      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span className="flex-1">{errorMessage}</span>
      <button
        onClick={() => setErrorMessage(null)}
        className="ml-auto text-error opacity-70 hover:opacity-100 transition-opacity text-base leading-none"
        aria-label="Dismiss error"
      >
        ×
      </button>
    </div>
  );
}
