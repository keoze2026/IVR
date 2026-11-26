/**
 * Administrator sign-in.
 *
 * A username and a password. Nothing to paste, nothing to be issued first —
 * this is the one door into the system that does not require somebody to have
 * already let you in.
 */

import { useState } from "react";

import { SettingsIcon } from "@/components/icons";
import { Button, Field, Input } from "@/components/ui";

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
    <main className="flex min-h-dvh flex-col items-center justify-center p-5">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-lg btn-solid">
          <SettingsIcon className="size-6" />
        </span>
        <span className="display text-xl text-chalk">Outbound</span>
      </div>
      <section className="flex w-full justify-center">
        <form
          onSubmit={submit}
          className="w-full max-w-md rounded-[var(--radius-shell)] border border-edge/70 bg-panel p-8 shadow-[var(--shadow-card)] sm:p-10"
        >
          <h1 className="display text-3xl text-chalk">System administration</h1>
          <p className="mt-2 text-sm text-ash">
            Sign in with the administrator account for this system. If you manage
            campaigns rather than the system itself,{" "}
            <a href="/login" className="font-semibold text-signal underline">
              sign in here instead
            </a>
            .
          </p>

          <div className="mt-8 space-y-5">
            <Field label="Username" htmlFor="admin-username">
              <Input
                id="admin-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                invalid={Boolean(error)}
              />
            </Field>

            <Field label="Password" htmlFor="admin-password" error={error ?? undefined}>
              <Input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                invalid={Boolean(error)}
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!username || !password}
              className="w-full"
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
