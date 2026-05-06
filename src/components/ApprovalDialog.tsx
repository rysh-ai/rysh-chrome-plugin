import React, { useState } from 'react';
import { useStore } from '../store';
import { apiService } from '../services/api';

/** Overlay approval dialog — adapated from internal/web ApprovalOverlay.tsx. */
export default function ApprovalDialog() {
  const pendingApproval   = useStore(s => s.pendingApproval);
  const setPendingApproval = useStore(s => s.setPendingApproval);
  const [showDiff, setShowDiff]   = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason]         = useState('');

  if (!pendingApproval) return null;

  const { requestID, description, diff, choices } = pendingApproval;

  function respond(decision: string, r = '') {
    apiService.sendApprovalResponse(requestID, decision, r);
    setPendingApproval(null);
    setShowReason(false);
    setReason('');
    setShowDiff(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a24] border-2 border-[#4f46e5] rounded-[12px] px-5 py-4 max-w-[340px] w-[92%] shadow-xl mx-2">
        {/* Title */}
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="text-[#ffffaf] text-[12px] font-bold tracking-wide">APPROVAL REQUIRED</span>
        </div>

        {/* Description */}
        <p className="text-text text-[12.5px] leading-relaxed mb-2 whitespace-pre-wrap break-words">
          {description || 'A tool action requires your approval.'}
        </p>

        {/* Diff viewer */}
        {diff?.unified_diff && (
          <div className="mb-2">
            <button
              className="text-[11px] text-muted hover:text-text transition-colors"
              onClick={() => setShowDiff(v => !v)}
            >
              {showDiff ? '▲ Hide diff' : `▼ View diff: ${diff.file_path || ''}`}
            </button>
            {showDiff && (
              <div className="mt-1.5 bg-[#111] border border-border rounded p-2 max-h-[160px] overflow-auto font-mono text-[11px] whitespace-pre-wrap text-text leading-relaxed">
                {diff.unified_diff}
              </div>
            )}
          </div>
        )}

        {/* Multiple-choice (if server provided choices) */}
        {choices.length > 0 && (
          <div className="mb-2 space-y-1">
            {choices.map((choice, i) => (
              <button
                key={i}
                onClick={() => respond('choice_selected', String(i))}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-[#2e2e42] text-left transition-colors"
              >
                <kbd className="bg-[#2e2e42] text-text px-1.5 rounded font-mono text-[10px] shrink-0">{i + 1}</kbd>
                <span className="text-text text-[12px] font-medium">{choice.label}</span>
                {choice.description && (
                  <span className="text-muted text-[11px] ml-auto">{choice.description}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Reject-with-reason input */}
        {showReason && (
          <input
            autoFocus
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') respond('no_with_explanation', reason);
              if (e.key === 'Escape') { setShowReason(false); setReason(''); }
            }}
            placeholder="reason for rejection…"
            className="w-full mb-2 bg-[#111] border border-[#4f46e5] rounded px-2.5 py-1.5 text-text font-mono text-[12px] outline-none"
          />
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => respond('yes')}
            className="px-3 py-1.5 bg-[#4f46e5] hover:bg-[#4338ca] text-white rounded-lg text-[12px] font-semibold transition-colors"
          >
            Yes
          </button>
          <button
            onClick={() => respond('yes_always')}
            className="px-3 py-1.5 bg-[#222232] hover:bg-[#2e2e42] text-text border border-border rounded-lg text-[12px] font-semibold transition-colors"
          >
            Yes, Always
          </button>
          <button
            onClick={() => respond('no')}
            className="px-3 py-1.5 bg-[#2a1a1a] hover:bg-[#3a1a1a] text-error border border-error/30 rounded-lg text-[12px] font-semibold transition-colors"
          >
            No
          </button>
          {!showReason && (
            <button
              onClick={() => setShowReason(true)}
              className="px-3 py-1.5 bg-transparent text-muted hover:text-text border border-border rounded-lg text-[11px] transition-colors"
            >
              No + reason
            </button>
          )}
        </div>

        {/* Keyboard hint */}
        <p className="mt-2 text-[10.5px] text-dim">
          Double-ESC cycles input modes · Enter submits rejection reason
        </p>
      </div>
    </div>
  );
}
