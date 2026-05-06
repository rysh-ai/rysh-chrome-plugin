import { useState, useEffect } from 'react';
import { onDebugEntries, getDebugEntries } from '../services/debug-log';
import { useStore } from '../store';

/**
 * DebugOverlay — renders a small scrollable log panel at the bottom of the
 * extension UI.  Shows timestamped debug messages from the pipeline so we can
 * trace WS connect/disconnect and message flow without needing DevTools.
 *
 * Toggle with the 🔧 button.  Remove this component once debugging is done.
 */
export default function DebugOverlay() {
  const [open, setOpen]       = useState(true); // Start open for debugging
  const [entries, setEntries] = useState(getDebugEntries());
  const connected = useStore(s => s.connected);
  const paneID    = useStore(s => s.paneID);

  useEffect(() => onDebugEntries(setEntries), []);

  return (
    <div className="shrink-0 border-t border-border bg-[#1a1a2e]">
      {/* Toggle bar */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-2 py-1 text-[10px] text-muted hover:text-text"
      >
        <span>
          Debug
          {' '}
          <span className={connected ? 'text-green-400' : 'text-red-400'}>
            {connected ? '● connected' : '● disconnected'}
          </span>
          {paneID && <span className="ml-1 opacity-60">pane:{paneID.slice(0, 8)}</span>}
        </span>
        <span>{open ? '▼' : '▲'} {entries.length} msgs</span>
      </button>

      {/* Log area */}
      {open && (
        <div
          className="max-h-[120px] overflow-y-auto px-2 pb-1 font-mono text-[9px] leading-[14px] text-[#9ca3af]"
          ref={el => { if (el) el.scrollTop = el.scrollHeight; }}
        >
          {entries.length === 0 && (
            <div className="text-[#6b7280] italic">No debug messages yet…</div>
          )}
          {entries.map((e, i) => (
            <div key={i}>
              <span className="text-[#6b7280]">{e.ts}</span>{' '}
              <span>{e.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
