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

/**
 * Hop-by-hop headers must not be forwarded.
 *
 * The forwarding headers are in here for a different reason than the rest.
 * Django checks `APIKey.allowed_cidrs` against the first entry of
 * X-Forwarded-For, and a browser is free to set that header on a fetch — it is
 * not on the Fetch spec's forbidden list. Passing the client's value through
 * would let anyone holding a stolen key defeat its network restriction by
 * naming an allowed address. The value this proxy sends is derived below from
 * the socket peer, never from the request.
 */
const STRIP_REQUEST = new Set([
  "host",
  "connection",
  "cookie",
  "authorization",
  "content-length",
  "accept-encoding",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "forwarded",
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
  // hop, so dropping it entirely would let a CIDR-restricted key work from
  // anywhere. Taking it from the request would do the same, since the client
  // chooses that value — hence the socket peer.
  //
  // Set TRUST_PROXY_XFF=1 only when this process genuinely sits behind a proxy
  // that overwrites the header. Then the inbound chain is preserved and this
  // hop is appended, which is what Django's "first entry" check expects.
  const trustInbound = process.env.TRUST_PROXY_XFF === "1";
  const inbound = trustInbound ? c.req.header("x-forwarded-for") : undefined;
  const peer = remoteAddress(c.env);
  const chain = [inbound, peer].filter(Boolean).join(", ");
  if (chain) headers.set("X-Forwarded-For", chain);

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
