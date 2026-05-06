// debug-log.ts — In-UI debug logger.
// Writes timestamped messages to a ring buffer that renders directly in the
// extension UI, bypassing DevTools console entirely.

type Entry = { ts: string; msg: string };

const MAX_ENTRIES = 50;
const entries: Entry[] = [];
let listeners: Array<(entries: Entry[]) => void> = [];

export function debugLog(msg: string) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entries.push({ ts, msg });
  if (entries.length > MAX_ENTRIES) entries.shift();
  // Also console.log for good measure.
  console.log(`[debug ${ts}] ${msg}`);
  listeners.forEach(fn => fn([...entries]));
}

export function onDebugEntries(fn: (entries: Entry[]) => void): () => void {
  listeners.push(fn);
  // Send current state immediately.
  fn([...entries]);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

export function getDebugEntries(): Entry[] {
  return [...entries];
}
