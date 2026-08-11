/**
 * The one place that knows where Django is.
 */

export function apiBase(): string {
  return (process.env.IVR_API_BASE ?? "http://localhost:8000").replace(/\/+$/, "");
}

export function apiUrl(path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `${apiBase()}/api/v1/${clean}`;
}

/**
 * Verify a pasted key by making the cheapest authenticated call there is.
 *
 * `/me/` is the right probe: it is the only endpoint that needs no capability
 * beyond membership, and its response is exactly what the client wants next.
 * The backend implements it (apps/accounts/views.py). The one-row campaign
 * list remains as a fallback for a backend predating it, since every role can
 * read that.
 */
export async function probeCredential(
  apiKey: string,
): Promise<{ ok: true; me: unknown } | { ok: false; status: number; body: unknown }> {
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

  const response = await fetch(apiUrl("me/"), { headers });
  if (response.ok) return { ok: true, me: await response.json() };

  if (response.status === 404) {
    const legacy = await fetch(apiUrl("campaigns/?page_size=1"), { headers });
    if (legacy.ok) return { ok: true, me: null };
    return { ok: false, status: legacy.status, body: await safeJson(legacy) };
  }

  return { ok: false, status: response.status, body: await safeJson(response) };
}

export async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
