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

  /*
   * The body is buffered rather than streamed, and content-length is set
   * explicitly.
   *
   * Forwarding `c.req.raw.body` as a stream drops content-length, so fetch
   * falls back to Transfer-Encoding: chunked — and Django reads an empty body
   * from a chunked request. Every POST and PATCH then failed validation as
   * though no fields had been sent, which reads as a client bug and is not:
   * the bytes arrive, Django just does not consume them.
   *
   * Buffering is acceptable here because this proxy carries JSON only; nginx
   * caps request bodies at 1 MB and file uploads go straight to object
   * storage, so there is no large payload to hold.
   */
  let payload: ArrayBuffer | undefined;
  if (hasBody) {
    payload = await c.req.arrayBuffer();
    headers.set("Content-Length", String(payload.byteLength));
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: payload,
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
