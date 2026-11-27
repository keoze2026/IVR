/**
 * Installing the portal as an app.
 *
 * There are two apps on this origin: the operator portal, and system
 * administration under /admin. Each has its own manifest, so each gets its own
 * name and icon on a phone.
 */

import { useSyncExternalStore } from "react";

/** Chrome's install event. Not part of the DOM typings. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

// Listening at load time: the event can fire before React has mounted.
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferred = event as InstallPromptEvent;
  changed();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  installed = true;
  changed();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when the portal is already running as an installed app. */
function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export const isAppleDevice = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function useInstall() {
  const prompt = useSyncExternalStore(subscribe, () => deferred);
  const done = useSyncExternalStore(subscribe, () => installed);

  return {
    /** Whether there is any point offering to install. */
    available: !done && !isStandalone(),
    /** The browser's own install box, when it offers one. */
    canPrompt: prompt !== null,
    install: async () => {
      if (!prompt) return;
      deferred = null;
      changed();
      await prompt.prompt();
      await prompt.userChoice;
    },
  };
}

const APPS = {
  portal: {
    manifest: "/assets/pwa/app.webmanifest.json",
    icon: "/assets/pwa/app-180.png",
    name: "Outbound",
    title: "Outbound IVR — Operator Portal",
  },
  admin: {
    manifest: "/assets/pwa/admin.webmanifest.json",
    icon: "/assets/pwa/admin-180.png",
    name: "Admin",
    title: "Outbound IVR — System administration",
  },
};

/** Points the page at the manifest, icon and name of the area being shown. */
export function useAppIdentity(pathname: string) {
  const app = /^\/admin(\/|$)/.test(pathname) ? APPS.admin : APPS.portal;
  const set = (selector: string, attribute: string, value: string) => {
    const element = document.head.querySelector(selector);
    if (element && element.getAttribute(attribute) !== value) {
      element.setAttribute(attribute, value);
    }
  };
  set('link[rel="manifest"]', "href", app.manifest);
  set('link[rel="apple-touch-icon"]', "href", app.icon);
  set('meta[name="apple-mobile-web-app-title"]', "content", app.name);
  if (document.title !== app.title) document.title = app.title;
}

/**
 * Registers the service worker, which only shows an "offline" page when there is
 * no connection. Screens and figures are never cached, so nothing goes stale.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/bff/sw.js", { scope: "/" }).catch((error) => {
      console.warn("Offline support is unavailable", error);
    });
  });
}
