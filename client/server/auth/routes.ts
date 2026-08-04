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

  if (!apiKey) {
    return c.json(
      { error: { code: "missing_key", message: "Enter your API key." } },
      400,
    );
  }
  if (!KEY_PATTERN.test(apiKey)) {
    return c.json(
      {
        error: {
          code: "malformed_key",
          message: "That does not look like an API key. Keys start with ivrk_.",
        },
      },
      400,
    );
  }

  const probe = await probeCredential(apiKey);
  if (!probe.ok) {
    // Pass the upstream message through — "API key is revoked or expired" and
    // "Source address not permitted for this key" are already the right words.
    return c.json(probe.body ?? { error: { code: "unauthorized", message: "Rejected." } },
      probe.status as 401);
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
