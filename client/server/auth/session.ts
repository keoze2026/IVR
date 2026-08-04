/**
 * Server-side sessions.
 *
 * The cookie holds an opaque random id, signed so it cannot be forged. The
 * API key lives only in the store on this process — so it is absent from the
 * browser entirely, not merely httpOnly. An attacker with XSS gets a session
 * id that dies on logout, not a credential that dials phones.
 *
 * The store is in-memory, which is correct for a single BFF process and wrong
 * for more than one: a second replica would not recognise the first's
 * sessions. Moving to Redis is a change to this file alone — the interface is
 * already async.
 */

import { randomBytes } from "node:crypto";

import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";

export const SESSION_COOKIE = "ivr_session";

/** Idle lifetime. Re-login is one paste, so this can be short. */
const TTL_MS = 12 * 60 * 60 * 1000;

export interface Session {
  id: string;
  apiKey: string;
  createdAt: number;
  lastSeenAt: number;
}

const store = new Map<string, Session>();

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, session] of store) {
    if (session.lastSeenAt < cutoff) store.delete(id);
  }
}

export function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return value;
}

export async function createSession(c: Context, apiKey: string): Promise<Session> {
  sweep();
  const now = Date.now();
  const session: Session = {
    id: randomBytes(24).toString("base64url"),
    apiKey,
    createdAt: now,
    lastSeenAt: now,
  };
  store.set(session.id, session);

  await setSignedCookie(c, SESSION_COOKIE, session.id, secret(), {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
  return session;
}

export async function readSession(c: Context): Promise<Session | null> {
  const id = await getSignedCookie(c, secret(), SESSION_COOKIE);
  if (!id) return null;

  const session = store.get(id);
  if (!session) return null;

  if (Date.now() - session.lastSeenAt > TTL_MS) {
    store.delete(id);
    return null;
  }
  session.lastSeenAt = Date.now();
  return session;
}

export async function destroySession(c: Context): Promise<void> {
  const id = await getSignedCookie(c, secret(), SESSION_COOKIE);
  if (id) store.delete(id);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
