/**
 * Administrator sign-in.
 *
 * A username and a password. Nothing to paste, nothing to be issued first —
 * this is the one door into the system that does not require somebody to have
 * already let you in.
 */

import { useState } from "react";

export function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/bff/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(
          payload?.error?.message ?? "That username and password were not accepted.",
        );
        return;
      }
      // Full reload rather than a client navigation: the session identity is
      // fetched once at boot, and this is the moment it changes.
      window.location.href = "/admin";
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <h1 className="display text-2xl font-semibold text-chalk">
          System administration
        </h1>
        <p className="mt-2 text-sm text-ash">
          Sign in with the administrator account for this system. If you manage
          campaigns rather than the system itself,{" "}
          <a href="/login" className="text-live-bright underline">
            sign in here instead
          </a>
          .
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
              Username
            </span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className="w-full rounded border border-steel bg-graphite px-3 py-2 text-sm text-chalk focus:border-live-bright focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-ash">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded border border-steel bg-graphite px-3 py-2 text-sm text-chalk focus:border-live-bright focus:outline-none"
            />
          </label>

          {error && <p className="text-sm text-rust">{error}</p>}

          <button
            type="submit"
            disabled={busy || !username || !password}
            className="w-full rounded bg-live-bright px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-ink disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
