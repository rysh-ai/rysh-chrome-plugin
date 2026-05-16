// Types shared across the Chrome extension React app.

/** The four input modes — mirrors internal/web/frontend/src/types.ts */
export type InputMode = 'shell' | 'prompt' | 'rysh' | 'chat';

/** Per-mode display name shown in the ModeIndicator badge. */
export const MODE_LABELS: Record<InputMode, string> = {
  shell:  'SHELL',
  prompt: 'AI',
  rysh:   'RYSH',
  chat:   'CHAT',
};

/** Prompt character shown before the input field per mode. */
export const MODE_PROMPT: Record<InputMode, string> = {
  shell:  '>',
  prompt: '<',
  rysh:   '##',
  chat:   '@',
};

/** Placeholder text shown in the input field per mode. */
export const MODE_PLACEHOLDER: Record<InputMode, string> = {
  shell:  'shell command…',
  prompt: 'ai prompt…',
  rysh:   'rysh command…',
  chat:   'chat message…',
};

/** Mode order used by double-ESC cycling (same as web terminal). */
export const MODE_CYCLE: InputMode[] = ['shell', 'prompt', 'rysh', 'chat'];

// ── Message types ──────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface Message {
  id: string;
  role: MessageRole;
  /** Text content (markdown for assistant, plain for user/tool). */
  content: string;
  timestamp: Date;
  /** Which input mode produced this message — used to filter per-mode output. */
  mode: InputMode;
  /** True while the assistant is still streaming this message. */
  streaming?: boolean;
  /** Name of the remote sender (for share commands). */
  sender?: string;
}

// ── Unified conversation types (messaging refactoring) ────────────────────

export type ConversationType =
  | 'shell' | 'ai' | 'rysh' | 'chat'
  | 'email' | 'slack' | 'chatbot';

export type TurnType = 'question' | 'answer';

export type InputTypeEnum =
  | 'shell' | 'prompt' | 'command' | 'approval' | 'message';

export type MessageSource =
  | 'human' | 'ai' | 'external' | 'agent'
  | 'subagent' | 'humanoid' | 'system';

export interface ConversationMessage {
  turn_id: string;
  turn_type: TurnType;
  conversation_type: ConversationType;
  input_type: InputTypeEnum;
  message_source: MessageSource;
  content: string;
  timestamp_ms: number;
  sensitive?: boolean;
  subject_to_share?: boolean;
  role?: string;
  streaming?: boolean;
}

// ── Approval ───────────────────────────────────────────────────────────────

export interface DiffPayload {
  file_path: string;
  unified_diff: string;
}

export interface PendingApproval {
  requestID: string;
  type: string;
  description: string;
  diff: DiffPayload | null;
  choices: { label: string; description: string }[];
}

// ── API event payloads ─────────────────────────────────────────────────────

export interface OutputEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'diff' | 'error' | 'shell' | 'rysh' | 'chat' | 'user_prompt' | 'browser_action';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface StatusEvent {
  phase: string;
  iteration: number;
  maxIterations: number;
}
