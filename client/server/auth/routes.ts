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
import { apiUrl, probeCredential } from "../upstream.js";

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

/**
 * Administrator sign-in: a username and a password, like anything else.
 *
 * Separate from /login because the credentials are a different shape and the
 * failure messages differ — an employee is told their access key was refused,
 * an administrator is told their password was. Both are deliberately vague
 * about *which* half was wrong.
 */
authRoutes.post("/admin/login", async (c) => {
  const body = await c.req
    .json<{ username?: string; password?: string }>()
    .catch(() => ({}) as never);
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  const rejected = c.json(
    {
      error: {
        code: "invalid_credentials",
        message: "That username and password were not accepted.",
      },
    },
    401,
  );
  if (!username || !password) return rejected;

  let upstream: Response;
  try {
    upstream = await fetch(apiUrl("auth/login/"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    return c.json(
      {
        error: {
          code: "upstream_unreachable",
          message: "The service is not responding. Try again shortly.",
        },
      },
      502,
    );
  }

  if (!upstream.ok) {
    if (upstream.status >= 500) {
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

  const payload = (await upstream.json()) as {
    token: string;
    user: { username: string; is_superuser: boolean };
  };

  // Only platform administrators may hold an admin session. An ordinary user
  // with a password would otherwise be handed a session the portal renders the
  // administration area for — the server would refuse every call behind it,
  // but showing somebody a door that never opens is its own kind of broken.
  if (!payload.user?.is_superuser) {
    return c.json(
      {
        error: {
          code: "not_an_administrator",
          message: "That account is not a system administrator.",
        },
      },
      403,
    );
  }

  await createSession(c, payload.token, "admin", payload.user.username);
  return c.json({ user: payload.user });
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
