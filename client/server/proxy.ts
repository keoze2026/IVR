/**
 * /bff/api/* → Django /api/v1/*
 *
 * A deliberately dumb pipe. Status codes and bodies pass through untouched so
 * the SPA sees the backend's real error envelope — the whole point of that
 * envelope is that there is exactly one error path, and rewriting it here
 * would create a second one.
 *
 * The only thing added is the Authorization header.
 */

import { Hono } from "hono";

import { authorizationHeader } from "./auth/provider.js";
import { readSession } from "./auth/session.js";
import { apiUrl } from "./upstream.js";

/** Hop-by-hop headers must not be forwarded. */
const STRIP_REQUEST = new Set([
  "host",
  "connection",
  "cookie",
  "authorization",
  "content-length",
  "accept-encoding",
]);
const STRIP_RESPONSE = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "set-cookie",
]);

/**
 * The peer address, via the node-server adapter's raw request.
 *
 * Typed loosely because the adapter's env shape is not part of Hono's public
 * contract; an absent address is fine, it just means no XFF is forwarded.
 */
function remoteAddress(env: unknown): string {
  const incoming = (env as { incoming?: { socket?: { remoteAddress?: string } } })
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? "";
}

export const proxyRoutes = new Hono();

proxyRoutes.all("/*", async (c) => {
  const session = await readSession(c);
  if (!session) {
    return c.json(
      {
        error: {
          code: "not_authenticated",
          message: "Your session has expired. Sign in again.",
        },
      },
      401,
    );
  }

  // /bff/api/campaigns/?status=running → campaigns/?status=running
  const path = c.req.path.replace(/^\/bff\/api\/?/, "");
  const query = new URL(c.req.url).search;
  const target = apiUrl(path) + query;

  const headers = new Headers();
  for (const [key, value] of c.req.raw.headers) {
    if (!STRIP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  }
  headers.set("Authorization", authorizationHeader(session));

  // X-Forwarded-For matters: APIKey.allowed_cidrs is checked against the first
  // hop, so dropping it would let a CIDR-restricted key work from anywhere.
  const clientIp = c.req.header("x-forwarded-for") ?? remoteAddress(c.env);
  if (clientIp) headers.set("X-Forwarded-For", clientIp);

  const method = c.req.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? c.req.raw.body : undefined,
      // Node needs this to stream a request body without buffering it.
      ...(hasBody ? { duplex: "half" } : {}),
      redirect: "manual",
    } as RequestInit);
  } catch (cause) {
    return c.json(
      {
        error: {
          code: "upstream_unreachable",
          message: "The API is not responding.",
          detail: String(cause),
        },
      },
      502,
    );
  }

  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers) {
    if (!STRIP_RESPONSE.has(key.toLowerCase())) responseHeaders.set(key, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
});
