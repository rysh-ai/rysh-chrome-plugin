// api.ts — rysh-server backed API client (TypeScript port of api.js).
// Handles pane lifecycle, NATS subscriptions, and per-mode message routing.

import { storage }    from './storage';
import { NATSClient } from './nats-client';
import { debugLog }   from './debug-log';
import { BrowserActionExecutor } from './browser-executor';
import type { InputMode, OutputEvent, StatusEvent, PendingApproval, ConversationMessage } from '../types';

const DEFAULT_SERVER_URL = 'https://rysh.ai';

// NATSEnvelope TypeTag constants (must match rysh-shared/msg constants).
const TAG_AGENTIC_PROMPT          = 'MsgAgenticPrompt';
const TAG_AGENTIC_CANCEL          = 'MsgAgenticCancel';
const TAG_APPROVAL_RESPONSE       = 'MsgApprovalResponse';
const TAG_BROWSER_ACTION_RESPONSE = 'MsgBrowserActionResponse';

type OutputHandler       = (ev: OutputEvent) => void;
type ConversationHandler = (cm: ConversationMessage) => void;
type StatusHandler       = (ev: StatusEvent) => void;
type ApprovalHandler     = (ev: PendingApproval) => void;
type VoidHandler         = () => void;

class APIService {
  private _serverURL       = DEFAULT_SERVER_URL;
  private _paneID: string | null = null;
  private _wsURL:  string | null = null;
  private _natsClient: NATSClient | null = null;
  private _outputHandlers:       OutputHandler[]       = [];
  private _conversationHandlers: ConversationHandler[] = [];
  private _statusHandlers:       StatusHandler[]       = [];
  private _approvalHandlers:     ApprovalHandler[]     = [];
  private _connectHandlers:      VoidHandler[]         = [];
  private _disconnectHandlers:   VoidHandler[]         = [];
  private _unsubs: Array<() => void>                   = [];
  private _browserExecutor = new BrowserActionExecutor();
  // Track active share so ##share list can report it.
  private _activeShareID: string | null = null;

  // ── Configuration ────────────────────────────────────────────────────────

  setServerURL(url: string) {
    if (url?.trim()) this._serverURL = url.trim().replace(/\/$/, '');
  }

  async loadServerURL() {
    const url = await storage.get('server_url') as string | null;
    if (url) this.setServerURL(url);
  }

  /** Fetch workspace name from the server and cache it in storage.
   *  Sends the stored API key so the server returns the user's own workspace
   *  name rather than the server-level default.
   */
  async fetchServerInfo(): Promise<string> {
    try {
      const token = await storage.get('auth_token') as string | null;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch(`${this._serverURL}/api/server-info`, { headers });
      if (!resp.ok) return 'default';
      const data = await resp.json() as { workspace?: string };
      const workspace = data.workspace || 'default';
      await storage.set({ server_workspace: workspace });
      return workspace;
    } catch {
      return 'default';
    }
  }

  /** Return cached workspace (fetched during createPane / fetchServerInfo). */
  async getServerWorkspace(): Promise<string> {
    const cached = await storage.get('server_workspace') as string | null;
    if (cached) return cached;
    return this.fetchServerInfo();
  }

  get paneID(): string | null { return this._paneID; }

  // ── Pane lifecycle ────────────────────────────────────────────────────────

  async createPane(token: string): Promise<string> {
    const resp = await fetch(`${this._serverURL}/api/browser-panes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) {
      let msg = `Server error ${resp.status}`;
      try { const err = await resp.json(); msg = (err as { error?: string })?.error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const data = await resp.json() as { pane_id: string; ws_url: string };
    this._paneID = data.pane_id;

    const wsOrigin = this._serverURL
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://');
    this._wsURL = `${wsOrigin}${data.ws_url}?token=${encodeURIComponent(token)}`;

    debugLog('creating NATSClient for pane ' + this._paneID);
    this._natsClient = new NATSClient();
    this._natsClient.onOpen(() => {
      debugLog('WS connected (onOpen)');
      this._connectHandlers.forEach(h => h());
    });
    this._natsClient.onClose(() => {
      debugLog('WS disconnected (onClose) — reconnecting');
      this._disconnectHandlers.forEach(h => h());
    });
    debugLog('connecting WS...');
    await this._natsClient.connect(this._wsURL);
    debugLog('subscribing to output subjects');
    this._subscribeOutputSubjects();
    debugLog('pane ready: ' + this._paneID);
    // Fetch workspace in the background so it's ready before ##share is run.
    void this.fetchServerInfo();
    return this._paneID;
  }

  async ensurePane(token: string): Promise<string> {
    if (!this._paneID) await this.createPane(token);
    return this._paneID!;
  }

  // ── Input routing (mode-aware) ────────────────────────────────────────────

  /**
   * submitInput routes input based on mode:
   *
   *   prompt  → MsgAgenticPrompt to .agentic.inbox (with optional page context prefix)
   *   chat    → MsgAgenticPrompt to .agentic.inbox (no page context)
   *   shell / rysh + "##" prefix → _handleRyshCommand (client-side, no NATS round-trip)
   *   shell / rysh without "##"  → error: no shell in browser panes
   *
   * Browser panes have no PTY/shell. All non-## non-AI input is an error.
   * ## commands (share, help, …) are executed locally and output is emitted
   * through the normal output handler pipeline so the UI stays reactive.
   */
  async submitInput(
    text: string,
    mode: InputMode,
    token: string,
    pageContext?: Record<string, string> | null,
  ) {
    await this.ensurePane(token);
    if (!this._natsClient || !this._paneID) return;

    // ── Prompt mode: inject page context and call agentic actor ──────────────
    if (mode === 'prompt') {
      // 1) Store context server-side so page_context tool works in follow-ups.
      if (pageContext) {
        try {
          await fetch(`${this._serverURL}/api/browser-panes/${this._paneID}/context`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(pageContext),
          });
        } catch { /* best-effort */ }
      }

      // 2) Prepend page context directly so Claude sees it without a tool call.
      let finalPrompt = text;
      if (pageContext && (pageContext.url || pageContext.title || pageContext.body_text)) {
        const lines: string[] = [];
        if (pageContext.url)           lines.push(`URL: ${pageContext.url}`);
        if (pageContext.title)         lines.push(`Title: ${pageContext.title}`);
        if (pageContext.selected_text) lines.push(`Selected text: ${pageContext.selected_text}`);
        if (pageContext.body_text)     lines.push(`\nPage content:\n${pageContext.body_text}`);
        finalPrompt = `<browser_page>\n${lines.join('\n')}\n</browser_page>\n\n${text}`;
      }

      this._natsClient.publish(
        `rysh.pane.${this._paneID}.llm_prompt_execution.inbox`,
        TAG_AGENTIC_PROMPT,
        { request_id: crypto.randomUUID(), prompt: finalPrompt },
      );
      return;
    }

    // ── Chat mode: plain AI prompt (no page context injection) ───────────────
    if (mode === 'chat') {
      this._natsClient.publish(
        `rysh.pane.${this._paneID}.llm_prompt_execution.inbox`,
        TAG_AGENTIC_PROMPT,
        { request_id: crypto.randomUUID(), prompt: text },
      );
      return;
    }

    // ── Shell / rysh: ## commands are handled client-side ────────────────────
    if (text.startsWith('##')) {
      await this._handleRyshCommand(text, token, mode);
      return;
    }

    // Non-## shell/rysh input: browser panes have no PTY.
    this._emitOutput(mode === 'rysh' ? 'rysh' : 'shell',
      `[rysh] No shell available in browser panes.\n` +
      `Use ## commands (e.g. ##share pane control, ##help) or switch to AI mode (double-Esc).\n`,
    );
  }

  /** Backward compatibility alias. */
  async sendPrompt(text: string, pageContext: Record<string, string> | null, token: string) {
    return this.submitInput(text, 'prompt', token, pageContext);
  }

  cancelPrompt() {
    if (!this._natsClient || !this._paneID) return;
    this._natsClient.publish(`rysh.pane.${this._paneID}.llm_prompt_execution.inbox`, TAG_AGENTIC_CANCEL, {});
  }

  sendApprovalResponse(requestID: string, decision: string, reason = '') {
    if (!this._natsClient || !this._paneID) return;
    this._natsClient.publish(
      `rysh.pane.${this._paneID}.approval.response`,
      TAG_APPROVAL_RESPONSE,
      { request_id: requestID, decision, reason },
    );
  }

  // ── Share pane ────────────────────────────────────────────────────────────

  async sharePane(token: string): Promise<{ share_id: string; subscribe_cmd: string; workspace: string }> {
    if (!this._paneID) throw new Error('No active pane');
    const resp = await fetch(`${this._serverURL}/api/browser-panes/${this._paneID}/share`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Share failed: ${resp.status}`);
    return resp.json() as Promise<{ share_id: string; subscribe_cmd: string; workspace: string }>;
  }

  // ── History ───────────────────────────────────────────────────────────────

  async clearHistory(token: string): Promise<void> {
    if (this._natsClient) {
      this._natsClient.close();
      this._natsClient = null;
    }
    if (this._paneID) {
      try {
        await fetch(`${this._serverURL}/api/browser-panes/${this._paneID}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        });
      } catch { /* best-effort */ }
      this._paneID = null;
      this._wsURL  = null;
    }
    this._activeShareID = null;
    this._unsubs.forEach(fn => fn());
    this._unsubs = [];
  }

  // ── Event handler registration (returns unsubscribe fn) ──────────────────

  onOutput(handler: OutputHandler): () => void {
    this._outputHandlers.push(handler);
    return () => { this._outputHandlers = this._outputHandlers.filter(h => h !== handler); };
  }

  onStatus(handler: StatusHandler): () => void {
    this._statusHandlers.push(handler);
    return () => { this._statusHandlers = this._statusHandlers.filter(h => h !== handler); };
  }

  onConversation(handler: ConversationHandler): () => void {
    this._conversationHandlers.push(handler);
    return () => { this._conversationHandlers = this._conversationHandlers.filter(h => h !== handler); };
  }

  onApproval(handler: ApprovalHandler): () => void {
    this._approvalHandlers.push(handler);
    return () => { this._approvalHandlers = this._approvalHandlers.filter(h => h !== handler); };
  }

  onConnect(handler: VoidHandler): () => void {
    this._connectHandlers.push(handler);
    return () => { this._connectHandlers = this._connectHandlers.filter(h => h !== handler); };
  }

  onDisconnect(handler: VoidHandler): () => void {
    this._disconnectHandlers.push(handler);
    return () => { this._disconnectHandlers = this._disconnectHandlers.filter(h => h !== handler); };
  }

  // ── ## command dispatcher (client-side, no NATS round-trip) ──────────────

  private async _handleRyshCommand(text: string, token: string, mode: InputMode) {
    // Choose which output buffer the response lands in (matches current mode).
    const out = (content: string) =>
      this._emitOutput(mode === 'rysh' ? 'rysh' : 'shell', content);

    const parts = text.trim().split(/\s+/);
    const cmd   = parts[0].toLowerCase();

    // ── ##share ─────────────────────────────────────────────────────────────
    if (cmd === '##share') {
      const sub = (parts[1] || '').toLowerCase();

      if (sub === 'pane' || sub === 'panegroup' || sub === 'tab') {
        try {
          await this.ensurePane(token);
          const { share_id, subscribe_cmd, workspace } = await this.sharePane(token);
          this._activeShareID = share_id;
          // Persist workspace so Settings panel can show it without another round-trip.
          await storage.set({ server_workspace: workspace || 'default' });
          const ws = workspace || 'default';
          const wsNote = ws !== 'default'
            ? `Workspace: ${ws}\n` +
              `  Add to rysh.config: [upstream]\n` +
              `                      workspace = ${ws}\n` +
              `  Or set: RYSH_UPSTREAM_WORKSPACE=${ws}\n`
            : `Workspace: ${ws}  (CLI default — no extra config needed)\n`;
          out(
            `[share] Pane shared.\n` +
            `Share ID:  ${share_id}\n` +
            wsNote +
            `Subscribe: ${subscribe_cmd}\n`,
          );
        } catch (err) {
          out(`[share] Error: ${(err as Error).message}\n`);
        }
        return;
      }

      if (sub === 'list') {
        if (this._activeShareID) {
          out(`[share] Active share: ${this._activeShareID}\n`);
        } else {
          out(`[share] No active shares.\n`);
        }
        return;
      }

      if (sub === 'status') {
        out(`[share] ${this._activeShareID ? `Connected — share ${this._activeShareID}` : 'Not sharing.'}\n`);
        return;
      }

      out(
        `[share] Usage:\n` +
        `  ##share pane [view|control]  — share this pane\n` +
        `  ##share list                 — list active shares\n` +
        `  ##share status               — show share connection status\n`,
      );
      return;
    }

    // ── ##unshare ────────────────────────────────────────────────────────────
    if (cmd === '##unshare') {
      out(`[unshare] Unsharing browser panes is not yet implemented.\n`);
      return;
    }

    // ── ##help ───────────────────────────────────────────────────────────────
    if (cmd === '##help') {
      out(
        `[rysh] Available ## commands for browser panes:\n\n` +
        `  ##share pane [view|control]  Share this pane with remote collaborators.\n` +
        `                               Remote users subscribe with the printed command.\n` +
        `  ##share list                 List active shares.\n` +
        `  ##share status               Show share connection status.\n` +
        `  ##help                       Show this help.\n\n` +
        `Tip: double-Esc cycles input modes (shell → AI → rysh → chat).\n` +
        `     AI mode sends your message to the Claude agentic assistant.\n`,
      );
      return;
    }

    // ── Unknown command ──────────────────────────────────────────────────────
    out(`[rysh] Unknown command: ${parts[0]}\nType ##help for available commands.\n`);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private _emitOutput(type: OutputEvent['type'], content: string) {
    this._outputHandlers.forEach(h => h({ type, content }));
  }

  /**
   * Handle a command forwarded from a remote CLI via the share.
   * Captures the current browser tab's page context, stores it server-side,
   * and submits the prompt with context prepended — same as a local prompt
   * submission in prompt mode.
   */
  private async _handleInboundShareCommand(prompt: string, sender = 'remote') {
    if (!this._natsClient || !this._paneID) return;

    const token = await storage.get('auth_token') as string | null;
    if (!token) {
      debugLog('share command: no auth token, submitting without context');
      this._natsClient.publish(
        `rysh.pane.${this._paneID}.llm_prompt_execution.inbox`,
        TAG_AGENTIC_PROMPT,
        { request_id: crypto.randomUUID(), prompt },
      );
      return;
    }

    // 1) Capture page context from the active browser tab.
    let pageContext: Record<string, string> | null = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
      const ctx = (res as { context?: Record<string, string> })?.context;
      if (ctx && (ctx.url || ctx.title || ctx.body)) {
        pageContext = {
          url:           ctx.url   || '',
          title:         ctx.title || '',
          selected_text: ctx.selected || '',
          body_text:     ctx.body  || '',
        };
      }
    } catch {
      debugLog('share command: page context capture failed');
    }

    // 2) Store context server-side so page_context tool works.
    if (pageContext) {
      try {
        await fetch(`${this._serverURL}/api/browser-panes/${this._paneID}/context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(pageContext),
        });
        debugLog('share command: page context stored (' + (pageContext.url || '').slice(0, 40) + ')');
      } catch { /* best-effort */ }
    }

    // 3) Prepend page context to the prompt (same as submitInput in prompt mode).
    let finalPrompt = prompt;
    if (pageContext && (pageContext.url || pageContext.title || pageContext.body_text)) {
      const lines: string[] = [];
      if (pageContext.url)           lines.push(`URL: ${pageContext.url}`);
      if (pageContext.title)         lines.push(`Title: ${pageContext.title}`);
      if (pageContext.selected_text) lines.push(`Selected text: ${pageContext.selected_text}`);
      if (pageContext.body_text)     lines.push(`\nPage content:\n${pageContext.body_text}`);
      finalPrompt = `<browser_page>\n${lines.join('\n')}\n</browser_page>\n\n${prompt}`;
      debugLog('share command: context injected, prompt length=' + finalPrompt.length);
    } else {
      debugLog('share command: no context available, raw prompt');
    }

    // 4) Show the user prompt in the chat UI (same as PaneInput does for local prompts).
    this._outputHandlers.forEach(h => h({
      type: 'user_prompt',
      content: prompt,
      metadata: { sender },
    }));

    // 5) Submit to agentic actor.
    this._natsClient.publish(
      `rysh.pane.${this._paneID}.llm_prompt_execution.inbox`,
      TAG_AGENTIC_PROMPT,
      { request_id: crypto.randomUUID(), prompt: finalPrompt },
    );
  }

  private _subscribeOutputSubjects() {
    if (!this._natsClient || !this._paneID) return;
    const id = this._paneID;

    // AI/prompt mode — streaming agentic output.
    const u1 = this._natsClient.subscribe(`rysh.pane.${id}.llm_prompt_execution.output`, (_tag, payload) => {
      const type    = (payload.type as OutputEvent['type']) || 'text';
      const content = (payload.content as string)           || '';
      debugLog(`agentic.output → ${type}: ${content.slice(0, 50)}`);
      this._outputHandlers.forEach(h => h({
        type,
        content,
        metadata: (payload.metadata as Record<string, unknown>) || {},
      }));
    });

    // AI/prompt phase status.
    const u2 = this._natsClient.subscribe(`rysh.pane.${id}.llm_prompt_execution.status`, (_tag, payload) => {
      debugLog(`agentic.status → ${payload.phase}`);
      this._statusHandlers.forEach(h => h({
        phase:         (payload.phase as string)          || 'unknown',
        iteration:     (payload.iteration as number)      || 0,
        maxIterations: (payload.max_iterations as number) || 0,
      }));
    });

    // Approval requests.
    const u3 = this._natsClient.subscribe(`rysh.pane.${id}.approval.request`, (_tag, payload) => {
      this._approvalHandlers.forEach(h => h({
        requestID:   (payload.request_id as string)  || '',
        type:        (payload.type as string)        || '',
        description: (payload.description as string) || '',
        diff:        (payload.diff as { file_path: string; unified_diff: string } | null) || null,
        choices:     (payload.choices as { label: string; description: string }[]) || [],
      }));
    });

    // ── Unified ConversationMessage handler ──────────────────────────────────
    // Subscribes to per-mode output topics. When a MsgConversationAppend arrives,
    // extracts the ConversationMessage and dispatches to both the structured
    // conversation handlers AND the legacy output handlers for backward compat.
    const conversationTopics = ['shell', 'ai', 'rysh', 'chat', 'email', 'slack', 'chatbot'];
    const conversationUnsubs: Array<() => void> = [];

    for (const mode of conversationTopics) {
      const unsub = this._natsClient.subscribe(`rysh.pane.${id}.output.${mode}`, (tag, payload) => {
        // Handle unified MsgConversationAppend format.
        if (tag === 'MsgConversationAppend' && payload.message) {
          const cm = payload.message as unknown as ConversationMessage;
          debugLog(`conversation.${mode} → ${cm.turn_type}: ${(cm.content || '').slice(0, 50)}`);
          // Dispatch to structured conversation handlers.
          this._conversationHandlers.forEach(h => h(cm));
          // Also dispatch to legacy output handlers for backward compat.
          const outputType = this._conversationTypeToOutputType(cm.conversation_type);
          this._outputHandlers.forEach(h => h({ type: outputType, content: cm.content || '' }));
          return;
        }

        // Legacy per-mode text format.
        const text = (payload.text as string) || '';
        if (text) {
          const outputType = mode === 'ai' ? 'text' : mode as OutputEvent['type'];
          debugLog(`output.${mode} → ${text.slice(0, 50)}`);
          this._outputHandlers.forEach(h => h({ type: outputType, content: text }));
        }
      });
      conversationUnsubs.push(unsub);
    }

    // Also subscribe to merged output topic for shell+ai interleaved stream.
    const uMerged = this._natsClient.subscribe(`rysh.pane.${id}.output`, (tag, payload) => {
      if (tag === 'MsgConversationAppend' && payload.message) {
        const cm = payload.message as unknown as ConversationMessage;
        this._conversationHandlers.forEach(h => h(cm));
        return;
      }
      // Legacy MsgPaneOutputAppend.
      const text = (payload.text as string) || '';
      if (text) {
        this._outputHandlers.forEach(h => h({ type: 'text', content: text }));
      }
    });

    // Share command inbound — a remote CLI user sent a command via the share.
    // Capture page context from the active tab and resubmit as a prompt so the
    // AgenticActor sees the browser page content.
    const u7 = this._natsClient.subscribe(`rysh.pane.${id}.share.command.inbound`, (_tag, payload) => {
      const prompt = (payload.prompt as string) || '';
      const sender = (payload.sender_name as string) || (payload.sender_id as string) || 'remote';
      debugLog(`share.command.inbound from ${sender}: ${prompt.slice(0, 50)}`);
      if (!prompt) return;
      // Fire-and-forget: capture context and submit.
      void this._handleInboundShareCommand(prompt, sender);
    });

    // Browser action requests — the server-side AI tool sends browser actions
    // (navigate, click, type, screenshot, etc.) to be executed in the browser.
    const u8 = this._natsClient.subscribe(`rysh.pane.${id}.browser.request`, async (_tag, payload) => {
      const requestId = (payload.request_id as string) || '';
      const action    = (payload.action as string) || '';
      debugLog(`browser.request → ${action} (${requestId.slice(0, 8)})`);

      // Show the action in the UI as a tool call.
      this._outputHandlers.forEach(h => h({
        type: 'tool_call',
        content: `Browser: ${action}`,
        metadata: { action, request_id: requestId },
      }));

      // Execute the browser action.
      const result = await this._browserExecutor.execute({
        request_id: requestId,
        action,
        params: (payload.params as Record<string, any>) || {},
      });

      debugLog(`browser.response ← ${result.success ? 'ok' : 'error'} (${requestId.slice(0, 8)})`);

      // Publish the result back to the server.
      this._natsClient!.publish(
        `rysh.pane.${id}.browser.response`,
        TAG_BROWSER_ACTION_RESPONSE,
        { ...result },
      );
    });

    this._unsubs.push(u1, u2, u3, ...conversationUnsubs, uMerged, u7, u8);
  }

  /** Map ConversationType to OutputEvent type for legacy handler compatibility. */
  private _conversationTypeToOutputType(convType: string): OutputEvent['type'] {
    switch (convType) {
      case 'shell':   return 'shell';
      case 'ai':      return 'text';
      case 'rysh':    return 'rysh';
      case 'chat':    return 'chat';
      case 'email':   return 'text';
      case 'slack':   return 'text';
      case 'chatbot': return 'chat';
      default:        return 'text';
    }
  }
}

export const apiService = new APIService();
export default apiService;
