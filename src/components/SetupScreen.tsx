import React from 'react';

/** Unauthenticated landing screen — prompts user to set up API key. */
export default function SetupScreen() {
  function openAuth() {
    chrome.runtime.sendMessage({ type: 'OPEN_AUTH' });
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-bg text-center px-8 gap-0">
      {/* Logo */}
      <div className="w-[72px] h-[72px] bg-gradient-to-br from-primary to-primary-light rounded-[20px] flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(79,70,229,0.25)]">
        <svg className="w-10 h-10 fill-white" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
        </svg>
      </div>

      <h1 className="text-[22px] font-bold text-text mb-2 tracking-tight">Set up Rysh AI</h1>
      <p className="text-[13px] text-muted mb-9 leading-relaxed max-w-[260px]">
        Connect your Rysh API key to start using your AI assistant right in your browser.
      </p>

      <button
        onClick={openAuth}
        className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white border-none rounded-[10px] px-6 py-3 text-[14px] font-semibold cursor-pointer transition-all hover:shadow-[0_0_20px_rgba(79,70,229,0.25)] hover:-translate-y-px active:translate-y-0"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
        </svg>
        Authorize API Key
      </button>
    </div>
  );
}
