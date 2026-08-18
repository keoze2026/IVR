/**
 * The BFF.
 *
 * Two jobs: hold the API key server-side, and give the browser a session. It
 * is not an application — no business logic lives here, and anything that
 * looks like a decision belongs in Django where it can be audited.
 *
 * In production it also serves the built SP
 * A, so the whole portal is one
 * origin and CORS never enters the picture.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";

import { authRoutes } from "./auth/routes.js";
import { readSession } from "./auth/session.js";
import { proxyRoutes } from "./proxy.js";
import { apiBase, apiUrl, safeJson } from "./upstream.js";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "..", "dist");

const app = new Hono();
app.use("*", logger());

// --- health -----------------------------------------------------------
app.get("/bff/health", (c) => c.json({ status: "ok", upstream: apiBase() }));

// --- session ----------------------------------------------------------
app.route("/bff", authRoutes);

/**
 * Identity for the SPA.
 *
 * Proxied from /api/v1/me/, which the backend now implements. The 404 branch
 * remains for a backend predating it, but note what it costs: with no role and
 * no capabilities, `capabilitiesFor` returns an empty set and the portal hides
 * every control rather than showing them all. That is a deliberately visible
 * failure — an operator staring at an empty page asks why, where a portal that
 * quietly offered buttons which only 403 would waste more of their time.
 */
app.get("/bff/me", async (c) => {
  const session = await readSession(c);
  if (!session) {
    return c.json(
      { error: { code: "not_authenticated", message: "No session." } },
      401,
    );
  }

  const upstream = await fetch(apiUrl("me/"), {
    headers: { Authorization: `Bearer ${session.credential}`, Accept: "application/json" },
  });

  if (upstream.status === 404) {
    return c.json({
      user: null,
      api_key: null,
      organization: null,
      role: "",
      capabilities: [],
      ceilings: null,
      degraded: "backend has no /me endpoint (see docs/API-GAPS.md G-04)",
    });
  }
  const body = (await safeJson(upstream)) as Record<string, unknown> | null;
  return c.json(
    {
      ...(body ?? {}),
      // Which door they came in by. The administration area is rendered from
      // this rather than from a capability, because a platform administrator
      // has no organisation and therefore no capability list to read.
      session_kind: session.kind,
      session_username: session.username ?? null,
    },
    upstream.status as 200,
  );
});

// --- API passthrough --------------------------------------------------
app.route("/bff/api", proxyRoutes);

// --- SPA --------------------------------------------------------------
if (existsSync(distDir)) {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  app.use("/favicon.ico", serveStatic({ root: "./dist" }));

  // Client-side routing: anything not under /bff falls through to the shell.
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/bff")) return c.notFound();
    return c.html(await readFile(join(distDir, "index.html"), "utf8"));
  });
}

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`BFF listening on http://localhost:${info.port}`);
  console.log(`  upstream: ${apiBase()}`);
  console.log(`  spa:      ${existsSync(distDir) ? distDir : "dev (vite on :5173)"}`);
});

export default app;
