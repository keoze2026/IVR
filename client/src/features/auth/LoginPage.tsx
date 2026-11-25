/**
 * Sign in.
 *
 * Copy discipline on this screen matters more than anywhere else in the
 * product, because it is the one page an unauthenticated stranger can read.
 * It names no infrastructure, no commands, no storage mechanism, and it does
 * not tell the visitor *why* a credential was rejected — a distinct message
 * for "revoked" versus "unknown" versus "wrong network" is a free oracle for
 * anyone probing. One neutral failure, every time.
 */

import { useState, type FormEvent } from "react";

import { ChartIcon, PhoneOutIcon, ShieldIcon, SoundIcon } from "@/components/icons";
import { Waveform } from "@/components/Waveform";
import { Button, Field, Input } from "@/components/ui";
import { ApiError } from "@/lib/errors";
import { useSession } from "@/lib/session";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { signInWithCode } = useSession();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithCode(username.trim(), code.trim().toUpperCase());
      // Full reload rather than a client navigation. The session is resolved
      // once at boot; a client redirect here can render the guarded route
      // before the refreshed session propagates, and the guard then bounces
      // straight back to this login form. Reloading re-resolves it cleanly —
      // the same approach the admin sign-in uses.
      window.location.assign("/dashboard");
    } catch (cause) {
      // One message for every rejection, except being locked out — that one a
      // person can act on, and withholding it just has them retrying into a
      // wall. The server never says which half was wrong.
      if (cause instanceof ApiError && cause.status === 429) {
        setError(
          "Too many attempts. Wait 15 minutes, or ask your administrator for a new code.",
        );
      } else {
        setError(
          cause instanceof ApiError && cause.status >= 500
            ? "Something went wrong at our end. Try again shortly."
            : "That name and code were not accepted. Check them and try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh gap-4 p-0 lg:grid-cols-[1.15fr_1fr] lg:p-4">
      <section className="surface-forest relative hidden flex-col justify-between overflow-hidden rounded-[var(--radius-shell)] p-12 lg:flex">
        <div aria-hidden className="absolute -right-40 -top-40 size-[520px] rounded-full border-[60px] border-white/[0.04]" />
        <div aria-hidden className="absolute -bottom-52 -left-32 size-[460px] rounded-full border-[46px] border-mint/[0.07]" />

        <div className="relative flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-mint text-forest">
            <SoundIcon className="size-6" />
          </span>
          <span className="display text-2xl">Outbound</span>
        </div>

        <div className="relative max-w-xl">
          <Waveform className="mb-10" />
          <h1 className="display text-5xl leading-[1.08]">
            Reach people with <span className="text-mint">voice</span>.
          </h1>
          <p className="mt-5 text-lg font-medium text-white/75">
            Create calling jobs, follow them live and review every call in one place.
          </p>
          <ul className="mt-8 grid grid-cols-3 gap-3">
            {[
              [PhoneOutIcon, "Calling jobs"],
              [ChartIcon, "Live results"],
              [ShieldIcon, "Do-not-call checks"],
            ].map(([Icon, label]) => {
              const Glyph = Icon as typeof PhoneOutIcon;
              return (
                <li key={label as string} className="rounded-3xl bg-white/[0.08] p-4">
                  <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-mint">
                    <Glyph />
                  </span>
                  <span className="mt-3 block text-sm font-bold">{label as string}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="relative text-sm font-semibold text-white/60">Only call people who agreed to be called.</p>
      </section>

      <section className="flex items-center justify-center bg-void p-5 lg:rounded-[var(--radius-shell)]">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-md rounded-[var(--radius-shell)] border border-edge/70 bg-panel p-8 shadow-[var(--shadow-card)] sm:p-10"
          noValidate
        >
          <span className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-forest text-mint lg:hidden">
            <SoundIcon className="size-7" />
          </span>
          <h2 className="display text-3xl text-chalk">Welcome back</h2>
          <p className="mt-1 text-sm text-ash">
            Use your name and five-character code.
          </p>

          <div className="mt-8 space-y-5">
            <Field label="Your name" htmlFor="username">
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                spellCheck={false}
                placeholder="e.g. jane"
                value={username}
                invalid={Boolean(error)}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>

            <Field label="Access code" htmlFor="code" error={error ?? undefined}>
              <Input
                id="code"
                autoComplete="one-time-code"
                spellCheck={false}
                maxLength={5}
                placeholder="5 characters"
                // Upper-cased as they type: codes are issued in upper case and
                // nobody should be refused for holding shift.
                className="font-mono text-lg uppercase tracking-[0.4em] placeholder:font-sans placeholder:text-sm placeholder:normal-case placeholder:tracking-normal"
                value={code}
                invalid={Boolean(error)}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={username.trim().length === 0 || code.trim().length < 5}
              className="w-full"
            >
              Sign in
            </Button>

            <p className="text-center text-xs text-ash-dim">
              <a href="/admin/login" className="hover:text-signal">
                System administrator sign-in
              </a>
            </p>
          </div>
        </form>
      </section>
    </main>
  );
}
