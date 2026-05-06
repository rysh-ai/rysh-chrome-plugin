// nats-client.js — thin WebSocket wrapper that speaks the rysh NATSEnvelope protocol.
// Connects to the rysh-server browser pane WebSocket endpoint.
//
// Wire format (bidirectional):
//   WebSocket frame: JSON { subject: string, data: NATSEnvelope }
//   NATSEnvelope:    { t: TypeTag, r: replyTo, p: base64(JSON(payload)) }

export class NATSClient {
  constructor() {
    this._ws         = null;
    this._handlers   = new Map();   // subject (exact) → [callback]
    this._onOpenCb   = null;
    this._onCloseCb  = null;
    this._onErrorCb  = null;
    this._wsUrl      = null;
    this._closed     = false;
  }

  // ── Connection ───────────────────────────────────────────────────────────────

  /**
   * connect opens the WebSocket to wsUrl.
   * @param {string} wsUrl  full WebSocket URL, e.g. "wss://rysh.ai/api/browser-panes/{id}/ws"
   * @returns {Promise<void>}  resolves on open, rejects on error.
   */
  connect(wsUrl) {
    this._wsUrl  = wsUrl;
    this._closed = false;
    return new Promise((resolve, reject) => {
      try {
        this._ws = new WebSocket(wsUrl);
      } catch (err) {
        reject(err);
        return;
      }

      this._ws.onopen = () => {
        if (this._onOpenCb) this._onOpenCb();
        resolve();
      };

      this._ws.onerror = (ev) => {
        if (this._onErrorCb) this._onErrorCb(ev);
        reject(new Error('WebSocket connection failed'));
      };

      this._ws.onclose = (ev) => {
        if (!this._closed && this._onCloseCb) this._onCloseCb(ev);
      };

      this._ws.onmessage = (ev) => {
        this._onMessage(ev.data);
      };
    });
  }

  // ── Event hooks ──────────────────────────────────────────────────────────────

  /** onOpen sets a callback invoked when the connection opens. */
  onOpen(cb) { this._onOpenCb = cb; }

  /** onClose sets a callback invoked when the connection closes. */
  onClose(cb) { this._onCloseCb = cb; }

  /** onError sets a callback invoked on connection error. */
  onError(cb) { this._onErrorCb = cb; }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  /**
   * subscribe registers a callback for messages on an exact subject.
   * @param {string}   subject   exact NATS subject to listen on
   * @param {Function} callback  called with (typeTag, payload, subject)
   *                             where payload is the decoded JS object.
   * @returns {Function} unsubscribe function
   */
  subscribe(subject, callback) {
    if (!this._handlers.has(subject)) {
      this._handlers.set(subject, []);
    }
    this._handlers.get(subject).push(callback);
    return () => {
      const list = this._handlers.get(subject);
      if (list) {
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  }

  // ── Publishing ────────────────────────────────────────────────────────────

  /**
   * publish sends a message to a NATS subject via the WebSocket.
   * @param {string} subject  NATS subject to publish to
   * @param {string} typeTag  NATSEnvelope TypeTag (e.g. "MsgAgenticPrompt")
   * @param {object} payload  JS object — will be JSON-encoded and base64'd
   */
  publish(subject, typeTag, payload) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      console.warn('[NATSClient] publish called while disconnected', subject);
      return;
    }
    const frame = {
      subject,
      data: NATSClient.encode(typeTag, payload),
    };
    this._ws.send(JSON.stringify(frame));
  }

  // ── Close ─────────────────────────────────────────────────────────────────

  close() {
    this._closed = true;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._handlers.clear();
  }

  // ── Internal: message dispatch ────────────────────────────────────────────

  _onMessage(rawData) {
    let frame;
    try {
      frame = JSON.parse(rawData);
    } catch (err) {
      console.warn('[NATSClient] failed to parse WebSocket frame', err);
      return;
    }

    const { subject, data } = frame;
    if (!subject || !data) return;

    let decoded;
    try {
      decoded = NATSClient.decode(data);
    } catch (err) {
      console.warn('[NATSClient] failed to decode NATSEnvelope', err, data);
      return;
    }

    // Dispatch to exact-subject handlers.
    const handlers = this._handlers.get(subject);
    if (handlers && handlers.length > 0) {
      for (const cb of handlers) {
        try {
          cb(decoded.typeTag, decoded.payload, subject);
        } catch (err) {
          console.error('[NATSClient] handler error', subject, err);
        }
      }
    }
  }

  // ── Static encode/decode helpers ──────────────────────────────────────────

  /**
   * encode serializes a typed message as a NATSEnvelope object.
   * @param {string} typeTag  TypeTag string constant
   * @param {object} payload  JS object to encode
   * @returns {object}  NATSEnvelope as a plain JS object (not yet JSON-stringified)
   */
  static encode(typeTag, payload) {
    const jsonStr = JSON.stringify(payload);
    // Go marshals []byte as base64; we replicate that encoding here.
    const base64p = btoa(jsonStr);
    return { t: typeTag, r: '', p: base64p };
  }

  /**
   * decode parses a NATSEnvelope object into { typeTag, replyTo, payload }.
   * @param {object} env  NATSEnvelope object with { t, r, p }
   * @returns {{ typeTag: string, replyTo: string, payload: object }}
   */
  static decode(env) {
    const typeTag = env.t || '';
    const replyTo = env.r || '';
    let payload   = {};
    if (env.p) {
      try {
        const jsonStr = atob(env.p);
        payload = JSON.parse(jsonStr);
      } catch (_) {
        // payload remains {}
      }
    }
    return { typeTag, replyTo, payload };
  }
}
