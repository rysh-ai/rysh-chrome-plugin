import React from 'react';
import type { InputMode } from '../types';
import { MODE_LABELS } from '../types';

const MODE_COLORS: Record<InputMode, string> = {
  shell:  'bg-[#1e3a2f] text-[#34d399] border-[#34d399]/30',
  prompt: 'bg-[#1e1e3a] text-[#818cf8] border-[#818cf8]/30',
  rysh:   'bg-[#2a1e1e] text-[#f87171] border-[#f87171]/30',
  chat:   'bg-[#1e2a2a] text-[#22d3ee] border-[#22d3ee]/30',
};

interface Props {
  mode: InputMode;
}

/** Small badge showing the current input mode. */
export default function ModeIndicator({ mode }: Props) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold font-mono tracking-wider select-none ${MODE_COLORS[mode]}`}
      title="Double-ESC to cycle modes"
    >
      {MODE_LABELS[mode]}
    </span>
  );
}
