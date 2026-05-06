// api.js — rysh-server backed API client.
// Replaces the direct Anthropic API call with the rysh NATS remote-pane protocol.
// Auth: rysh-server JWT (Bearer token stored by authService).

import { storage }    from './storage.js';
import { NATSClient } from './nats-client.js';

// Default server URL — can be overridden via storage key "server_url".
const DEFAULT_SERVER_URL = 'https://rysh.ai';

// NATSEnvelope TypeTag constants for outbound messages (must match rysh-shared/msg constants).
const TAG_AGENTIC_PROMPT    = 'MsgAgenticPrompt';
const TAG_AGENTIC_CANCEL    = 'MsgAgenticCancel';
const TAG_APPROVAL_RESPONSE = 'MsgApprovalResponse';

class APIService {
  constructor() {
    this._serverURL       = DEFAULT_SERVER_URL;
    this._paneID          = null;
    this._wsURL           = null;
    this._natsClient      = null;
    this._outputHandlers  = [];
    this._statusHandlers  = [];
    this._approvalHandlers = [];
    this._unsubs          = [];   // unsubscribe callbacks
    this._initialized     = false;
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  /** setServerURL overrides the rysh-server base URL. */
  setServerURL(url) {
    if (url && url.trim()) {
      this._serverURL = url.trim().replace(/\/$/, '');
    }
  }

  /** loadServerURL reads the server URL from storage (call once at startup). */
  async loadServerURL() {
    const url = await storage.get('server_url');
    if (url) this.setServerURL(url);
  }

  // ── Pane lifecycle ────────────────────────────────────────────────────────

  /**
   * createPane creates a browser pane on the server, connects the WebSocket,
   * and subscribes to the three output subjects.
   * @param {string} token  JWT Bearer token from authService
   * @returns {Promise<string>} pane ID
   */
  async createPane(token) {
    const resp = await fetch(`${this._serverURL}/api/browser-panes`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      let msg = `Server error ${resp.status}`;
      try { const err = await resp.json(); msg = err?.error || msg; } catch (_) {}
      throw new Error(msg);
    }

    const data = await resp.json();
    this._paneID = data.pane_id;

    // Build WebSocket URL (same host, replace http/https scheme with ws/wss).
    const wsPath   = data.ws_url; // e.g. "/api/browser-panes/{id}/ws"
    const wsOrigin = this._serverURL
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://');
    this._wsURL = `${wsOrigin}${wsPath}?token=${encodeURIComponent(token)}`;

    // Connect and subscribe.
    this._natsClient = new NATSClient();
    await this._natsClient.connect(this._wsURL);

    this._subscribeOutputSubjects();

    return this._paneID;
  }

  /**
   * ensurePane ensures a pane exists, creating one if needed.
   * @param {string} token  JWT Bearer token
   */
  async ensurePane(token) {
    if (!this._paneID) {
      await this.createPane(token);
    }
  }

  // ── Prompts ───────────────────────────────────────────────────────────────

  /**
   * sendPrompt sends a user prompt to the agentic backend.
   * If a pane does not yet exist it is created first.
   * @param {string} text         prompt text
   * @param {object} pageContext  optional { url, title, selected_text, body_text }
   * @param {string} token        JWT Bearer token
   */
  async sendPrompt(text, pageContext, token) {
    await this.ensurePane(token);

    // Optionally upload page context first so the page_context tool can use it.
    if (pageContext && (pageContext.url || pageContext.body_text)) {
      try {
        await fetch(`${this._serverURL}/api/browser-panes/${this._paneID}/context`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(pageContext),
        });
      } catch (_) {
        // Non-fatal — context upload is best-effort.
      }
    }

    const requestID = crypto.randomUUID();
    this._natsClient.publish(
      `rysh.pane.${this._paneID}.agentic.inbox`,
      TAG_AGENTIC_PROMPT,
      { request_id: requestID, prompt: text },
    );
  }

  /**
   * cancelPrompt cancels any in-flight orchestrator run.
   */
  cancelPrompt() {
    if (!this._natsClient || !this._paneID) return;
    this._natsClient.publish(
      `rysh.pane.${this._paneID}.agentic.inbox`,
      TAG_AGENTIC_CANCEL,
      {},
    );
  }

  // ── Approval ──────────────────────────────────────────────────────────────

  /**
   * sendApprovalResponse sends the user's decision for a pending approval.
   * @param {string} requestID  from MsgApprovalRequest.request_id
   * @param {string} decision   "yes" | "yes_always" | "no" | "no_with_explanation"
   * @param {string} reason     optional explanation (for no_with_explanation)
   */
  sendApprovalResponse(requestID, decision, reason = '') {
    if (!this._natsClient || !this._paneID) return;
    this._natsClient.publish(
      `rysh.pane.${this._paneID}.approval.response`,
      TAG_APPROVAL_RESPONSE,
      { request_id: requestID, decision, reason },
    );
  }

  // ── History ───────────────────────────────────────────────────────────────

  /**
   * getHistory fetches the conversation history for the current pane.
   * @param {string} token  JWT Bearer token
   * @returns {Promise<Array>} array of ConversationTurnInfo objects
   */
  async getHistory(token) {
    if (!this._paneID) return [];
    const resp = await fetch(
      `${this._serverURL}/api/browser-panes/${this._paneID}/history`,
      { headers: { 'Authorization': `Bearer ${token}` } },
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.turns || [];
  }

  /**
   * clearHistory deletes the current pane and resets local state.
   * Call this to start a new conversation.
   * @param {string} token  JWT Bearer token
   */
  async clearHistory(token) {
    if (this._paneID) {
      // Disconnect WebSocket first.
      if (this._natsClient) {
        this._natsClient.close();
        this._natsClient = null;
      }
      // Delete pane on server (best-effort).
      try {
        await fetch(`${this._serverURL}/api/browser-panes/${this._paneID}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        });
      } catch (_) {}
      this._paneID = null;
      this._wsURL  = null;
    }
    this._unsubs.forEach(fn => fn());
    this._unsubs = [];
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  /**
   * onOutput registers a callback for streaming AI output.
   * @param {Function} handler  called with { type, content, metadata }
   *                            type is "text" | "tool_call" | "tool_result" | "diff" | "error"
   */
  onOutput(handler) { this._outputHandlers.push(handler); }

  /**
   * onStatus registers a callback for agentic phase status updates.
   * @param {Function} handler  called with { phase, iteration, maxIterations }
   */
  onStatus(handler) { this._statusHandlers.push(handler); }

  /**
   * onApproval registers a callback for incoming approval requests.
   * @param {Function} handler  called with { requestID, type, description, diff, choices }
   */
  onApproval(handler) { this._approvalHandlers.push(handler); }

  // ── Internal ──────────────────────────────────────────────────────────────

  _subscribeOutputSubjects() {
    if (!this._natsClient || !this._paneID) return;

    const unsub1 = this._natsClient.subscribe(
      `rysh.pane.${this._paneID}.agentic.output`,
      (_tag, payload) => {
        this._outputHandlers.forEach(h => h({
          type:     payload.type    || 'text',
          content:  payload.content || '',
          metadata: payload.metadata || {},
        }));
      },
    );

    const unsub2 = this._natsClient.subscribe(
      `rysh.pane.${this._paneID}.agentic.status`,
      (_tag, payload) => {
        this._statusHandlers.forEach(h => h({
          phase:         payload.phase          || 'unknown',
          iteration:     payload.iteration      || 0,
          maxIterations: payload.max_iterations || 0,
        }));
      },
    );

    const unsub3 = this._natsClient.subscribe(
      `rysh.pane.${this._paneID}.approval.request`,
      (_tag, payload) => {
        this._approvalHandlers.forEach(h => h({
          requestID:   payload.request_id   || '',
          type:        payload.type         || '',
          description: payload.description  || '',
          diff:        payload.diff         || null,
          choices:     payload.choices      || [],
        }));
      },
    );

    this._unsubs.push(unsub1, unsub2, unsub3);
  }
}

export const apiService = new APIService();
export default apiService;
