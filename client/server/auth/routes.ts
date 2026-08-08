/**
 * Session endpoints.
 *
 * Login is "paste your ivrk_ key once" because that is the only credential
 * the backend accepts (docs/API-GAPS.md G-05). The key is validated upstream
 * before a session exists, so a bad paste fails immediately with the real
 * message rather than 401-ing on the next screen.
 */

import { Hono } from "hono";

import { getWebSocketToken } from "./provider.js";
import { createSession, destroySession, readSession } from "./session.js";
import { probeCredential } from "../upstream.js";

const KEY_PATTERN = /^ivrk_[A-Za-z0-9_-]{20,}$/;

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ apiKey?: string }>().catch(() => ({}) as never);
  const apiKey = (body.apiKey ?? "").trim();

  // One shape of failure for everything a caller could get wrong: blank,
  // malformed, unknown, revoked, expired, or out-of-network. Distinguishing
  // them tells whoever is probing which of those they are looking at, and the
  // legitimate user cannot act on the difference anyway.
  const rejected = c.json(
    {
      error: {
        code: "invalid_credentials",
        message: "That key was not accepted.",
      },
    },
    401,
  );

  if (!apiKey || !KEY_PATTERN.test(apiKey)) return rejected;

  const probe = await probeCredential(apiKey);
  if (!probe.ok) {
    // A 5xx upstream is not a credential problem, and saying so stops the
    // user hunting for a key that was fine all along.
    if (probe.status >= 500) {
      return c.json(
        {
          error: {
            code: "upstream_unavailable",
            message: "The service is unavailable. Try again shortly.",
          },
        },
        503,
      );
    }
    return rejected;
  }

  await createSession(c, apiKey);
  return c.json({ me: probe.me });
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.body(null, 204);
});

authRoutes.get("/ws-token", async (c) => {
  const session = await readSession(c);
  if (!session) {
    return c.json(
      { error: { code: "not_authenticated", message: "No session." } },
      401,
    );
  }
  return c.json(getWebSocketToken(session));
});
