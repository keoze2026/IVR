/**
 * Administrator sign-in.
 *
 * A username and a password. Nothing to paste, nothing to be issued first —
 * this is the one door into the system that does not require somebody to have
 * already let you in.
 */

import { useState } from "react";

import { SettingsIcon } from "@/components/icons";
import { Waveform } from "@/components/Waveform";
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
    <main className="grid min-h-dvh gap-4 lg:grid-cols-[1.15fr_1fr] lg:p-4">
      <section className="surface-forest relative hidden flex-col justify-between overflow-hidden rounded-[var(--radius-shell)] p-12 lg:flex">
        <div aria-hidden className="absolute -right-40 -top-40 size-[520px] rounded-full border-[60px] border-white/[0.04]" />
        <div aria-hidden className="absolute -bottom-52 -left-32 size-[460px] rounded-full border-[46px] border-mint/[0.07]" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl neon">
            <SettingsIcon className="size-6" />
          </span>
          <span className="display text-2xl">Outbound</span>
        </div>
        <div className="relative max-w-xl">
          <Waveform className="mb-10" />
        </div>
        <div aria-hidden />
      </section>

      <section className="flex items-center justify-center bg-void p-5 lg:rounded-[var(--radius-shell)]">
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
