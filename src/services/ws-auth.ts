// ws-auth.ts — how the pane socket carries its credential (F-86).
//
// The token goes in the WebSocket subprotocol list, not the URL: a browser
// cannot set Authorization on a WebSocket, and URLs land in access logs. The
// client offers [PANE_WS_PROTOCOL, BEARER_PREFIX + token]; rysh-server selects
// PANE_WS_PROTOCOL and never echoes the bearer entry. A server that predates
// this selects nothing, the browser fails the handshake, and the client falls
// back to the 'query' form (?token=) for that server.

export const PANE_WS_PROTOCOL = 'rysh.browser-pane.v1';
export const BEARER_PREFIX = 'rysh.bearer.';

export type WsAuthMode = 'subprotocol' | 'query';

export function wsDialArgs(baseUrl: string, token: string, mode: WsAuthMode): { url: string; protocols?: string[] } {
  if (mode === 'subprotocol') {
    return { url: baseUrl, protocols: [PANE_WS_PROTOCOL, BEARER_PREFIX + token] };
  }
  const sep = baseUrl.includes('?') ? '&' : '?';
  return { url: `${baseUrl}${sep}token=${encodeURIComponent(token)}` };
}
