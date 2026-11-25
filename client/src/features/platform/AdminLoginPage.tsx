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
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-signal p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white text-signal">
            <SettingsIcon />
          </span>
          <span className="display text-xl">Outbound</span>
        </div>
        <div className="max-w-md">
          <p className="display text-4xl leading-tight">System administration</p>
          <p className="mt-4 text-base text-white/85">
            Manage organisations, people and records.
          </p>
        </div>
        <p className="text-sm text-white/70">Administrators only.</p>
      </section>

      <section className="flex items-center justify-center bg-panel px-6 py-10">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h1 className="display text-2xl text-chalk">Administrator sign-in</h1>

          <div className="mt-8 space-y-5">
            <Field label="Username" htmlFor="admin-username">
              <Input
                id="admin-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                spellCheck={false}
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

            <p className="text-center text-sm text-ash-dim">
              <a href="/login" className="inline-flex min-h-9 items-center hover:text-signal">
                Staff sign-in
              </a>
            </p>
          </div>
        </form>
      </section>
    </main>
  );
}
