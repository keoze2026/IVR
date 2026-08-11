/**
 * Live KPI socket for one campaign.
 *
 * Three things about this socket shape the code:
 *
 * 1. Ticks are bursty. The 5s flusher fires one, and so does every call that
 *    reaches a terminal state — up to ~20/s on a busy campaign, unthrottled.
 *    Frames are buffered and applied once per animation frame.
 *
 * 2. Counters are absolute, never deltas. A dropped frame self-corrects on the
 *    next one, so state is replaced wholesale and never accumulated.
 *
 * 3. Close codes 4001/4003/4004 are permanent and all fire *before* accept(),
 *    so a browser may only ever observe 1006. We therefore treat an immediate
 *    failure as possibly-permanent and fall back to REST rather than
 *    reconnecting into a wall.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { KpiFrame, ServerMessage } from "@/types/domain";

const PERMANENT = new Set([4001, 4003, 4004]);
const PING_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;
/** No tick within this window on a running campaign means counters are stale. */
const STALE_AFTER_MS = 15_000;

export type SocketState = "connecting" | "open" | "retrying" | "offline";

export function useCampaignSocket(
  campaignId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const [frame, setFrame] = useState<KpiFrame | null>(null);
  const [state, setState] = useState<SocketState>("connecting");
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const pendingRef = useRef<KpiFrame | null>(null);
  const rafRef = useRef<number | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const closedRef = useRef(false);
  /**
   * Whether this socket has ever reached OPEN.
   *
   * A ref rather than the `state` value, because the close handler is created
   * once per effect run and would otherwise close over the state from that
   * first render forever — reading "connecting" even after a successful
   * connection, and so treating every later drop as permanent.
   */
  const openedRef = useRef(false);

  /** Coalesce: hold the newest frame, paint once per frame. */
  const enqueue = useCallback((next: KpiFrame) => {
    pendingRef.current = next;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (pendingRef.current) {
        setFrame(pendingRef.current);
        pendingRef.current = null;
      }
    });
  }, []);

  const send = useCallback((action: string) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action }));
    }
  }, []);

  const refresh = useCallback(() => send("refresh"), [send]);

  useEffect(() => {
    if (!campaignId || !enabled) return;
    closedRef.current = false;

    let pingTimer: ReturnType<typeof setInterval> | undefined;

    async function connect() {
      if (closedRef.current) return;
      setState(attemptRef.current === 0 ? "connecting" : "retrying");

      let token: string;
      try {
        const response = await fetch("/bff/ws-token", {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("no ws token");
        ({ token } = (await response.json()) as { token: string });
      } catch {
        setState("offline");
        return;
      }
      if (closedRef.current) return;

      // The route regex matches lowercase hex only; an uppercase UUID 404s
      // at the router rather than closing with a code.
      const id = String(campaignId).toLowerCase();
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${scheme}://${window.location.host}/ws/campaigns/${id}/?token=${encodeURIComponent(token)}`;

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        attemptRef.current = 0;
        openedRef.current = true;
        setState("open");
        pingTimer = setInterval(() => send("ping"), PING_MS);
      };

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === "kpi.snapshot" || message.type === "kpi.tick") {
          enqueue(message.payload);
          setLastTickAt(Date.now());
        }
      };

      socket.onclose = (event) => {
        if (pingTimer) clearInterval(pingTimer);
        socketRef.current = null;
        if (closedRef.current) return;

        // Permanent: unauthenticated, cross-tenant, or no such campaign.
        // Also treat a close before we ever opened as possibly-permanent —
        // the server rejects before accept(), so the browser sees only 1006.
        // Once a connection has succeeded, 1006 means the network dropped, and
        // that must reconnect rather than give up for the life of the page.
        const neverOpened = !openedRef.current;
        if (PERMANENT.has(event.code) || (neverOpened && event.code === 1006)) {
          setState("offline");
          return;
        }

        attemptRef.current += 1;
        const backoff = Math.min(
          MAX_BACKOFF_MS,
          1000 * 2 ** attemptRef.current + Math.random() * 500,
        );
        setState("retrying");
        timersRef.current.push(setTimeout(connect, backoff));
      };
    }

    void connect();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closedRef.current = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (pingTimer) clearInterval(pingTimer);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      socketRef.current?.close(1000, "unmounted");
      socketRef.current = null;
    };
  }, [campaignId, enabled, enqueue, send, refresh]);

  /*
   * Staleness is the absence of an event, so nothing re-renders to reveal it.
   * Comparing Date.now() during render only re-evaluates when a frame arrives
   * — precisely when the counters are *not* stale — so without this the
   * indicator could never turn on. One cheap timer while the socket is open.
   */
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (state !== "open" || lastTickAt === null) return;
    const id = setInterval(() => setClock((n) => n + 1), STALE_AFTER_MS / 3);
    return () => clearInterval(id);
  }, [state, lastTickAt]);

  const isStale =
    state === "open" &&
    lastTickAt !== null &&
    Date.now() - lastTickAt > STALE_AFTER_MS;
  void clock; // read so the timer above is not optimised away as unused

  return { frame, state, isStale, refresh, lastTickAt };
}
