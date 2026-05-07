import React from 'react';

interface Props {
  action: string | null;
}

/**
 * BrowserActionIndicator — shows when the AI is executing a browser action.
 * Displayed in the chat screen between the header and the output.
 */
export default function BrowserActionIndicator({ action }: Props) {
  if (!action) return null;
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 mx-2 mt-1 bg-blue-900/40 border border-blue-800/50 rounded text-xs text-blue-300 animate-pulse shrink-0">
      <span className="inline-block w-2 h-2 bg-blue-400 rounded-full" />
      <span className="font-medium">Browser:</span>
      <span className="text-blue-200">{action}</span>
    </div>
  );
}
