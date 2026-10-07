// F-86: the pane socket's credential goes in the WebSocket subprotocol
// ("rysh.bearer.<token>", next to "rysh.browser-pane.v1"), not in the URL —
// URLs land in access logs. A server that predates the subprotocol selects
// none, and the browser then fails the handshake before the socket opens;
// the client falls back ONCE to ?token= for that server, so the plugin keeps
// working against today's production until the server ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NATSClient } from '../src/services/nats-client';
import { PANE_WS_PROTOCOL, BEARER_PREFIX } from '../src/services/ws-auth';

type Behaviour = 'open' | 'fail';
class FakeWebSocket {
  static OPEN = 1;
  static behaviours: Behaviour[] = [];
  static dials: { url: string; protocols?: string | string[] }[] = [];
  readyState = 0;
  protocol = '';
  onopen: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string, public protocols?: string | string[]) {
    FakeWebSocket.dials.push({ url, protocols });
    const behaviour = FakeWebSocket.behaviours.shift() ?? 'open';
    setTimeout(() => {
      if (behaviour === 'open') {
        this.readyState = 1;
        this.protocol = Array.isArray(protocols) && protocols.includes(PANE_WS_PROTOCOL) ? PANE_WS_PROTOCOL : '';
        this.onopen?.();
      } else {
        this.readyState = 3;
        this.onerror?.({});
        this.onclose?.({ code: 1006, reason: '', wasClean: false });
      }
    }, 0);
  }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;

const BASE = 'wss://rysh.example/api/browser-panes/p-1/ws';

test('a new server: the token rides the subprotocol, never the URL', async () => {
  FakeWebSocket.dials = [];
  FakeWebSocket.behaviours = ['open'];
  const client = new NATSClient();
  await client.connect(BASE, 'rysh_secret');
  assert.equal(FakeWebSocket.dials.length, 1);
  const dial = FakeWebSocket.dials[0];
  assert.equal(dial.url, BASE);
  assert.ok(!dial.url.includes('rysh_secret') && !dial.url.includes('token='));
  assert.deepEqual(dial.protocols, [PANE_WS_PROTOCOL, BEARER_PREFIX + 'rysh_secret']);
  client.close();
});

test('an old server: the handshake fails, the client falls back once to ?token=', async () => {
  FakeWebSocket.dials = [];
  FakeWebSocket.behaviours = ['fail', 'open'];
  const client = new NATSClient();
  await client.connect(BASE, 'rysh secret');
  assert.equal(FakeWebSocket.dials.length, 2);
  assert.deepEqual(FakeWebSocket.dials[0].protocols, [PANE_WS_PROTOCOL, BEARER_PREFIX + 'rysh secret']);
  assert.equal(FakeWebSocket.dials[1].url, BASE + '?token=rysh%20secret');
  assert.equal(FakeWebSocket.dials[1].protocols, undefined);
  client.close();
});

test('after the subprotocol has worked, a later drop never falls back to the URL', async () => {
  FakeWebSocket.dials = [];
  FakeWebSocket.behaviours = ['open', 'open'];
  const client = new NATSClient();
  (client as unknown as { _baseReconnectDelay: number })._baseReconnectDelay = 1;
  await client.connect(BASE, 'rysh_secret');
  // The connection drops; the client reconnects on its own.
  (client as unknown as { _ws: FakeWebSocket })._ws.onclose?.({ code: 1006, reason: '', wasClean: false });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(FakeWebSocket.dials.length, 2);
  for (const dial of FakeWebSocket.dials) {
    assert.ok(!dial.url.includes('token='), `reconnect put the token in the URL: ${dial.url}`);
  }
  client.close();
});
