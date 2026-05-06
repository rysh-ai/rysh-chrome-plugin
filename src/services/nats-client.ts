// nats-client.ts — TypeScript port of nats-client.js
// Thin WebSocket wrapper speaking the rysh NATSEnvelope protocol.
// Includes auto-reconnect on unexpected disconnections.

import { debugLog } from './debug-log';

interface NATSEnvelope {
  t: string;   // TypeTag
  r: string;   // replyTo (optional)
  p: string;   // base64(JSON(payload))
}

interface DecodedEnvelope {
  typeTag: string;
  replyTo: string;
  payload: Record<string, unknown>;
}

type MessageCallback = (typeTag: string, payload: Record<string, unknown>, subject: string) => void;

export class NATSClient {
  private _ws: WebSocket | null = null;
  private _handlers = new Map<string, MessageCallback[]>();
  private _onOpenCb: (() => void) | null = null;
  private _onCloseCb: ((ev: CloseEvent) => void) | null = null;
  private _onErrorCb: ((ev: Event) => void) | null = null;
  private _closed = false;

  // ── Reconnection state ──────────────────────────────────────────────────
  private _wsUrl: string | null = null;
  private _reconnecting = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempt = 0;
  private _maxReconnectAttempts = 20;
  private _baseReconnectDelay = 1000; // ms, doubles each attempt up to 30s

  connect(wsUrl: string): Promise<void> {
    this._closed = false;
    this._wsUrl = wsUrl;
    this._reconnectAttempt = 0;
    return this._doConnect(wsUrl);
  }

  private _doConnect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this._ws = new WebSocket(wsUrl);
      } catch (err) {
        reject(err);
        return;
      }

      this._ws.onopen = () => {
        const safeUrl = wsUrl.replace(/token=[^&]+/, 'token=***');
        debugLog('WS opened: ' + safeUrl);
        this._reconnectAttempt = 0;
        this._reconnecting = false;
        this._onOpenCb?.();
        resolve();
      };

      this._ws.onerror = (ev) => {
        debugLog('WS error: ' + String(ev));
        this._onErrorCb?.(ev);
        // Only reject the initial connect() promise, not reconnects.
        if (!this._reconnecting) reject(new Error('WebSocket connection failed'));
      };

      this._ws.onclose = (ev) => {
        debugLog(`WS closed: code=${ev.code} reason=${ev.reason} clean=${ev.wasClean}`);
        if (!this._closed) {
          this._onCloseCb?.(ev);
          this._scheduleReconnect();
        }
      };

      this._ws.onmessage = (ev) => {
        this._onMessage(ev.data as string);
      };
    });
  }

  onOpen(cb: () => void)                  { this._onOpenCb = cb; }
  onClose(cb: (ev: CloseEvent) => void)   { this._onCloseCb = cb; }
  onError(cb: (ev: Event) => void)        { this._onErrorCb = cb; }

  subscribe(subject: string, callback: MessageCallback): () => void {
    if (!this._handlers.has(subject)) {
      this._handlers.set(subject, []);
    }
    this._handlers.get(subject)!.push(callback);
    console.log('[NATSClient] subscribed to', subject, 'total handlers:', this._handlers.get(subject)!.length);
    return () => {
      const list = this._handlers.get(subject);
      if (list) {
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  }

  publish(subject: string, typeTag: string, payload: Record<string, unknown>): void {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      console.warn('[NATSClient] publish called while disconnected', subject, 'readyState:', this._ws?.readyState);
      return;
    }
    debugLog(`→ pub ${subject.split('.').slice(-2).join('.')} ${typeTag}`);
    this._ws.send(JSON.stringify({
      subject,
      data: NATSClient.encode(typeTag, payload),
    }));
  }

  close(): void {
    console.log('[NATSClient] close() called — intentional disconnect');
    this._closed = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._handlers.clear();
  }

  get isConnected(): boolean {
    return this._ws?.readyState === WebSocket.OPEN;
  }

  // ── Auto-reconnect ────────────────────────────────────────────────────────

  private _scheduleReconnect(): void {
    if (this._closed || !this._wsUrl) return;
    if (this._reconnectAttempt >= this._maxReconnectAttempts) {
      console.error('[NATSClient] max reconnect attempts reached, giving up');
      return;
    }

    const delay = Math.min(
      this._baseReconnectDelay * Math.pow(2, this._reconnectAttempt),
      30000,
    );
    this._reconnectAttempt++;
    this._reconnecting = true;

    console.log(`[NATSClient] scheduling reconnect #${this._reconnectAttempt} in ${delay}ms`);

    this._reconnectTimer = setTimeout(() => {
      if (this._closed || !this._wsUrl) return;
      console.log(`[NATSClient] reconnecting (attempt ${this._reconnectAttempt})...`);

      this._doConnect(this._wsUrl).then(() => {
        console.log('[NATSClient] reconnected successfully, handlers intact:',
          [...this._handlers.keys()]);
      }).catch(err => {
        console.warn('[NATSClient] reconnect failed', err);
        // onclose will fire and schedule the next attempt.
      });
    }, delay);
  }

  // ── Message handling ──────────────────────────────────────────────────────

  private _onMessage(rawData: string): void {
    let frame: { subject: string; data: NATSEnvelope };
    try {
      frame = JSON.parse(rawData);
    } catch (err) {
      console.warn('[NATSClient] failed to parse frame', err);
      return;
    }

    const { subject, data } = frame;
    if (!subject || !data) {
      console.warn('[NATSClient] frame missing subject or data', frame);
      return;
    }

    let decoded: DecodedEnvelope;
    try {
      decoded = NATSClient.decode(data);
    } catch (err) {
      console.warn('[NATSClient] failed to decode envelope', err);
      return;
    }

    const preview = typeof decoded.payload.content === 'string'
      ? decoded.payload.content.slice(0, 60)
      : JSON.stringify(decoded.payload).slice(0, 60);
    debugLog(`← recv ${subject.split('.').slice(-2).join('.')} ${decoded.typeTag} ${preview}`);

    const handlers = this._handlers.get(subject);
    if (!handlers || handlers.length === 0) {
      console.warn('[NATSClient] no handlers for subject', subject,
        'registered subjects:', [...this._handlers.keys()]);
      return;
    }
    for (const cb of handlers) {
      try {
        cb(decoded.typeTag, decoded.payload, subject);
      } catch (err) {
        console.error('[NATSClient] handler error', subject, err);
      }
    }
  }

  /**
   * Encode a payload to a NATSEnvelope.
   * btoa() only handles Latin-1; run through TextEncoder→UTF-8 bytes first
   * so Unicode characters (page body text, etc.) never cause a range error.
   */
  static encode(typeTag: string, payload: Record<string, unknown>): NATSEnvelope {
    const json  = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);  // UTF-8 byte array
    let binary  = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return { t: typeTag, r: '', p: btoa(binary) };
  }

  /**
   * Decode a NATSEnvelope.  The Go server encodes payloads as UTF-8 JSON then
   * base64, so we reverse: base64 → binary string → UTF-8 bytes → JSON.parse.
   */
  static decode(env: NATSEnvelope): DecodedEnvelope {
    let payload: Record<string, unknown> = {};
    if (env.p) {
      try {
        const binary = atob(env.p);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch { /* leave empty */ }
    }
    return { typeTag: env.t || '', replyTo: env.r || '', payload };
  }
}
