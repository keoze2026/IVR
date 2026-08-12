/**
 * ★ The credential swap point.
 *
 * Everything upstream of here — the proxy, the WS token route — asks this
 * module for a credential and never thinks about where it came from. Today
 * that is a long-lived `ivrk_` API key the operator pasted once. When the
 * backend grows a token endpoint (see docs/API-GAPS.md G-05), only this file
 * changes: `getUpstreamCredential` returns an access token and refreshes it,
 * `getWebSocketToken` returns a short-lived scoped one. Nothing in client/src
 * is affected.
 *
 * The key is never sent to the browser. The session cookie carries an opaque
 * id; the key itself lives in the server-side store in session.ts.
 */

import type { Session } from "./session.js";

export interface Credential {
  /** Value for the upstream `Authorization` header, minus the scheme. */
  token: string;
  scheme: "Bearer";
}

export function getUpstreamCredential(session: Session): Credential {
  return { token: session.credential, scheme: "Bearer" };
}

export function authorizationHeader(session: Session): string {
  const { scheme, token } = getUpstreamCredential(session);
  return `${scheme} ${token}`;
}

/**
 * Credential for the WebSocket query string.
 *
 * Browsers cannot set headers on a WS handshake, so this value lands in nginx
 * and proxy access logs. Today it is the org key, which is more exposure than
 * we would like — G-07 tracks minting a short-lived read-only key instead,
 * which the APIKey model already supports (`role`, `expires_at`).
 *
 * `expiresAt` is advisory: the client refetches when it passes.
 */
export function getWebSocketToken(session: Session): {
  token: string;
  expiresAt: string;
} {
  return {
    token: session.credential,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}
