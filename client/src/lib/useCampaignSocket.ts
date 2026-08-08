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
        const neverOpened = attemptRef.current === 0 && state !== "open";
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
    // `state` is read inside onclose only as a hint; re-subscribing on every
    // state change would tear the socket down constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, enabled, enqueue, send, refresh]);

  const isStale =
    state === "open" &&
    lastTickAt !== null &&
    Date.now() - lastTickAt > STALE_AFTER_MS;

  return { frame, state, isStale, refresh, lastTickAt };
}
