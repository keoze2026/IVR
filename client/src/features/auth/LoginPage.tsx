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

import { SoundIcon } from "@/components/icons";
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
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-signal p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white text-signal">
            <SoundIcon />
          </span>
          <span className="display text-xl">Outbound</span>
        </div>
        <div className="max-w-md">
          <h1 className="display text-4xl leading-tight">Reach people with voice.</h1>
          <p className="mt-4 text-base text-white/85">
            Create calling jobs, follow them live and review every call in one place.
          </p>
        </div>
        <p className="text-sm text-white/70">Only call people who agreed to be called.</p>
      </section>

      <section className="flex items-center justify-center bg-panel p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm" noValidate>
          <h2 className="display text-2xl text-chalk">Sign in</h2>
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
