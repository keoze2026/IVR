/**
 * The service worker.
 *
 * It does one thing: when a page cannot be loaded because there is no
 * connection, it shows a short "offline" page. It never stores screens or API
 * answers, so an installed app cannot show old figures or an old build, and no
 * call data is left on the device.
 *
 * Served from here so that it can be allowed to cover the whole site.
 */

import { Hono } from "hono";

const WORKER = `
const CACHE = "outbound-offline-v1";
const OFFLINE = "/assets/pwa/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  if (new URL(event.request.url).pathname.startsWith("/bff/")) return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE).then((page) => page || Response.error()),
    ),
  );
});
`;

export const pwaRoutes = new Hono();

pwaRoutes.get("/sw.js", (c) =>
  c.body(WORKER, 200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-cache",
    "Service-Worker-Allowed": "/",
  }),
);
