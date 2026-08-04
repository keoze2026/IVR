/**
 * The typed fetch wrapper. Everything talks to the API through here.
 *
 * All requests go to the BFF on the same origin, so there are no credentials
 * to manage client-side — the session cookie rides along and the BFF adds the
 * upstream Authorization header.
 */

import { ApiError, NetworkError, type ApiErrorBody } from "./errors";

const BASE = "/bff/api";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Absolute URL, used to follow `next`/`previous` cursors verbatim. */
  absoluteUrl?: string;
}

export async function request<T>(
  path: string,
  { method = "GET", body, signal, absoluteUrl }: RequestOptions = {},
): Promise<T> {
  const url = absoluteUrl ? rewriteUpstreamUrl(absoluteUrl) : join(path);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new NetworkError(cause);
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const envelope =
      payload && typeof payload === "object" && "error" in payload
        ? ((payload as { error: ApiErrorBody }).error ?? null)
        : null;
    throw new ApiError(response.status, envelope, defaultMessage(response.status));
  }

  return payload as T;
}

function join(path: string): string {
  const clean = path.replace(/^\/+/, "");
  // DRF's DefaultRouter requires the trailing slash; a missing one is a 301
  // that silently drops the request body on POST.
  return `${BASE}/${clean}`;
}

/**
 * Pagination links come back pointing at Django's own host. Rewrite them onto
 * the BFF so the browser never tries a cross-origin call it has no
 * credentials for.
 */
function rewriteUpstreamUrl(absolute: string): string {
  try {
    const parsed = new URL(absolute, window.location.origin);
    const index = parsed.pathname.indexOf("/api/v1/");
    if (index === -1) return absolute;
    return BASE + parsed.pathname.slice(index + "/api/v1".length) + parsed.search;
  } catch {
    return absolute;
  }
}

function defaultMessage(status: number): string {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "Your role does not permit this action.";
  if (status === 404) return "Not found.";
  if (status === 429) return "Too many requests. Slow down and try again.";
  if (status >= 500) return "The server hit an unexpected error.";
  return "The request failed.";
}

// --- pagination -------------------------------------------------------

/** campaigns, caller-ids, contact-lists, flows, flow-versions, calling-windows */
export interface PagedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * contacts, calls, dnc, consent.
 *
 * No `count` — cursor pagination omits it by design, so the UI never promises
 * a total or a last page. See docs/API-GAPS.md G-11.
 */
export interface CursorResponse<T> {
  next: string | null;
  previous: string | null;
  results: T[];
}

export function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

// --- session ----------------------------------------------------------

export async function login(apiKey: string): Promise<void> {
  const response = await fetch("/bff/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ apiKey }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const envelope =
      payload && typeof payload === "object" && "error" in payload
        ? ((payload as { error: ApiErrorBody }).error ?? null)
        : null;
    throw new ApiError(response.status, envelope, "Sign in failed.");
  }
}

export async function logout(): Promise<void> {
  await fetch("/bff/logout", { method: "POST", credentials: "same-origin" });
}
