/**
 * The proxy's forwarding-header behaviour.
 *
 * Django checks `APIKey.allowed_cidrs` against the first entry of
 * X-Forwarded-For. A browser can set that header on a fetch — it is not on the
 * Fetch spec's forbidden list — so forwarding the client's value would let
 * anyone holding a stolen key defeat its network restriction by naming an
 * address inside the allowed range.
 *
 * These tests pin the two modes: by default the client's value is discarded in
 * favour of the socket peer, and under TRUST_PROXY_XFF the inbound chain is
 * preserved with this hop appended.
 */

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth/session.js", () => ({
  readSession: async () => ({
    id: "test-session",
    credential: "ivrk_test",
    kind: "key" as const,
    createdAt: 0,
    lastSeenAt: 0,
  }),
}));

import { proxyRoutes } from "./proxy.js";

/** Headers the fake upstream last received. */
let received: Headers | undefined;

const app = new Hono();
app.route("/bff/api", proxyRoutes);

/** Hono's node adapter exposes the peer here; the proxy reads it via c.env. */
const ENV = { incoming: { socket: { remoteAddress: "198.51.100.4" } } };

beforeEach(() => {
  received = undefined;
  process.env.IVR_API_BASE = "http://upstream.invalid";
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    received = init.headers as Headers;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TRUST_PROXY_XFF;
});

function get(headers: Record<string, string> = {}) {
  return app.request("/bff/api/campaigns/", { headers }, ENV);
}

describe("X-Forwarded-For", () => {
  it("ignores a client-supplied value and reports the socket peer", async () => {
    await get({ "X-Forwarded-For": "10.9.9.9" });
    expect(received?.get("x-forwarded-for")).toBe("198.51.100.4");
  });

  it("does not leak the spoofed address anywhere in the forwarded headers", async () => {
    await get({ "X-Forwarded-For": "10.9.9.9", "X-Real-IP": "10.9.9.9" });
    const all = [...(received?.entries() ?? [])].map(([k, v]) => `${k}:${v}`).join("|");
    expect(all).not.toContain("10.9.9.9");
  });

  it("sends the peer even when the client sends nothing", async () => {
    await get();
    expect(received?.get("x-forwarded-for")).toBe("198.51.100.4");
  });

  it("preserves the inbound chain and appends this hop when behind a trusted proxy", async () => {
    process.env.TRUST_PROXY_XFF = "1";
    await get({ "X-Forwarded-For": "203.0.113.7" });
    expect(received?.get("x-forwarded-for")).toBe("203.0.113.7, 198.51.100.4");
  });

  it("never forwards the caller's cookies or Authorization header", async () => {
    await get({ Cookie: "ivr_session=abc", Authorization: "Bearer stolen" });
    expect(received?.get("cookie")).toBeNull();
    expect(received?.get("authorization")).toBe("Bearer ivrk_test");
  });
});

describe("request bodies", () => {
  it("forwards a JSON body with an explicit Content-Length", async () => {
    let seen: { body: unknown; headers: Headers } | undefined;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      seen = { body: init.body, headers: init.headers as Headers };
      return new Response("{}", { status: 201 });
    });

    await app.request(
      "/bff/api/api-keys/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Jane", role: "operator" }),
      },
      ENV,
    );

    // Streaming the body drops Content-Length, which makes fetch fall back to
    // Transfer-Encoding: chunked — and Django reads an empty body from that,
    // failing every POST as though no fields were sent.
    expect(seen?.headers.get("content-length")).toBe("33");
    const text = new TextDecoder().decode(seen?.body as ArrayBuffer);
    expect(JSON.parse(text)).toEqual({ name: "Jane", role: "operator" });
  });

  it("sends no body or Content-Length on a GET", async () => {
    let seen: RequestInit | undefined;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      seen = init;
      return new Response("{}", { status: 200 });
    });
    await app.request("/bff/api/campaigns/", {}, ENV);
    expect(seen?.body).toBeUndefined();
    expect((seen?.headers as Headers).get("content-length")).toBeNull();
  });
});
