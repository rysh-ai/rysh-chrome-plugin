import { create } from 'zustand';
import type { InputMode, Message, PendingApproval } from './types';
import { MODE_CYCLE } from './types';

// Per-mode history (newest-first, matching internal/web).
interface PerModeStr { shell: string; prompt: string; rysh: string; chat: string; }
interface PerModeNum { shell: number; prompt: number; rysh: number; chat: number; }
interface PerModeArr { shell: string[]; prompt: string[]; rysh: string[]; chat: string[]; }

interface Store {
  // ── Input mode ──────────────────────────────────────────────────────────
  inputMode: InputMode;
  setInputMode: (mode: InputMode) => void;
  /** Double-ESC: shell → prompt → rysh → chat → shell */
  cycleInputMode: () => void;

  // ── Messages (AI/prompt and chat modes use chat-bubble display) ─────────
  messages: Message[];
  addMessage: (msg: Message) => void;
  clearMessages: () => void;

  // ── Streaming assistant response ─────────────────────────────────────────
  /** Text being accumulated for the current streaming assistant turn. */
  streamingContent: string | null;
  /** InputMode of the active streaming response. */
  streamingMode: InputMode | null;
  startStreaming: (mode: InputMode) => void;
  appendStreaming: (chunk: string) => void;
  /** Commit the streaming buffer as a finished Message. */
  finalizeStreaming: () => void;

  // ── Terminal output (shell / rysh modes) ─────────────────────────────────
  shellOutput: string;
  ryshOutput:  string;
  chatOutput:  string;
  appendShellOutput: (text: string) => void;
  appendRyshOutput:  (text: string) => void;
  appendChatOutput:  (text: string) => void;
  clearOutput: () => void;

  // ── Connection ───────────────────────────────────────────────────────────
  connected: boolean;
  paneID: string | null;
  setConnected: (v: boolean) => void;
  setPaneID: (id: string | null) => void;

  // ── Loading / status ─────────────────────────────────────────────────────
  isLoading:   boolean;
  statusText:  string;
  setIsLoading:  (v: boolean) => void;
  setStatusText: (text: string) => void;

  // ── Approval ──────────────────────────────────────────────────────────────
  pendingApproval: PendingApproval | null;
  setPendingApproval: (v: PendingApproval | null) => void;

  // ── Error ─────────────────────────────────────────────────────────────────
  errorMessage: string | null;
  setErrorMessage: (msg: string | null) => void;

  // ── Input text ────────────────────────────────────────────────────────────
  inputText: string;
  setInputText: (text: string) => void;

  // ── History (per mode, newest-first) ─────────────────────────────────────
  history:       PerModeArr;
  historyIdx:    PerModeNum;
  historySaved:  PerModeStr;
  /** Prepend entry to the front (newest-first). */
  addToHistory:    (mode: InputMode, text: string) => void;
  setHistoryIdx:   (mode: InputMode, idx: number) => void;
  setHistorySaved: (mode: InputMode, text: string) => void;

  // ── Double-ESC detection ──────────────────────────────────────────────────
  escCount: number;
  escTimer: ReturnType<typeof setTimeout> | null;
  setEscCount: (n: number) => void;
  setEscTimer: (t: ReturnType<typeof setTimeout> | null) => void;

  // ── Share ─────────────────────────────────────────────────────────────────
  shareActive:          boolean;
  activeShareID:        string | null;
  activeShareWorkspace: string | null; // NATS workspace returned by server on share creation
  setShareActive:            (v: boolean) => void;
  setActiveShareID:          (id: string | null) => void;
  setActiveShareWorkspace:   (ws: string | null) => void;

  // ── Browser action ──────────────────────────────────────────────────────
  browserAction: string | null;
  setBrowserAction: (action: string | null) => void;
}

export const useStore = create<Store>((set, get) => ({
  // ── Input mode ─────────────────────────────────────────────────────────────
  inputMode:    'prompt',  // Default to AI mode (extension use-case)
  setInputMode: (mode) => set({ inputMode: mode }),
  cycleInputMode: () => {
    const current = get().inputMode;
    const idx     = MODE_CYCLE.indexOf(current);
    const next    = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    set({ inputMode: next });
  },

  // ── Messages ───────────────────────────────────────────────────────────────
  messages:      [],
  addMessage:    (msg)  => set(s => ({ messages: [...s.messages, msg] })),
  clearMessages: ()     => set({ messages: [], streamingContent: null, streamingMode: null }),

  // ── Streaming ──────────────────────────────────────────────────────────────
  streamingContent: null,
  streamingMode:    null,
  startStreaming: (mode) => set({ streamingContent: '', streamingMode: mode }),
  appendStreaming: (chunk) => set(s => ({
    streamingContent: (s.streamingContent ?? '') + chunk,
  })),
  finalizeStreaming: () => {
    const { streamingContent, streamingMode, messages } = get();
    if (streamingContent === null || !streamingMode) return;
    const msg: Message = {
      id:        crypto.randomUUID(),
      role:      'assistant',
      content:   streamingContent,
      timestamp: new Date(),
      mode:      streamingMode,
    };
    set({ messages: [...messages, msg], streamingContent: null, streamingMode: null });
  },

  // ── Terminal output ────────────────────────────────────────────────────────
  shellOutput: '',
  ryshOutput:  '',
  chatOutput:  '',
  appendShellOutput: (text) => set(s => ({ shellOutput: s.shellOutput + text })),
  appendRyshOutput:  (text) => set(s => ({ ryshOutput:  s.ryshOutput  + text })),
  appendChatOutput:  (text) => set(s => ({ chatOutput:  s.chatOutput  + text })),
  clearOutput: () => set({ shellOutput: '', ryshOutput: '', chatOutput: '' }),

  // ── Connection ─────────────────────────────────────────────────────────────
  connected:    false,
  paneID:       null,
  setConnected: (v)  => set({ connected: v }),
  setPaneID:    (id) => set({ paneID: id }),

  // ── Loading ────────────────────────────────────────────────────────────────
  isLoading:     false,
  statusText:    '',
  setIsLoading:  (v)    => set({ isLoading: v }),
  setStatusText: (text) => set({ statusText: text }),

  // ── Approval ───────────────────────────────────────────────────────────────
  pendingApproval:    null,
  setPendingApproval: (v) => set({ pendingApproval: v }),

  // ── Error ──────────────────────────────────────────────────────────────────
  errorMessage:    null,
  setErrorMessage: (msg) => set({ errorMessage: msg }),

  // ── Input text ─────────────────────────────────────────────────────────────
  inputText:    '',
  setInputText: (text) => set({ inputText: text }),

  // ── History ────────────────────────────────────────────────────────────────
  history:      { shell: [], prompt: [], rysh: [], chat: [] },
  historyIdx:   { shell: -1, prompt: -1, rysh: -1, chat: -1 },
  historySaved: { shell: '',  prompt: '',  rysh: '',  chat: ''  },

  addToHistory: (mode, text) => set(s => ({
    history: { ...s.history, [mode]: [text, ...s.history[mode]].slice(0, 200) },
  })),
  setHistoryIdx: (mode, idx) => set(s => ({
    historyIdx: { ...s.historyIdx, [mode]: idx },
  })),
  setHistorySaved: (mode, text) => set(s => ({
    historySaved: { ...s.historySaved, [mode]: text },
  })),

  // ── Double-ESC ─────────────────────────────────────────────────────────────
  escCount: 0,
  escTimer: null,
  setEscCount: (n) => set({ escCount: n }),
  setEscTimer: (t) => set({ escTimer: t }),

  // ── Share ──────────────────────────────────────────────────────────────────
  shareActive:           false,
  activeShareID:         null,
  activeShareWorkspace:  null,
  setShareActive:            (v)  => set({ shareActive: v }),
  setActiveShareID:          (id) => set({ activeShareID: id }),
  setActiveShareWorkspace:   (ws) => set({ activeShareWorkspace: ws }),

  // ── Browser action ──────────────────────────────────────────────────────
  browserAction: null,
  setBrowserAction: (action) => set({ browserAction: action }),
}));
