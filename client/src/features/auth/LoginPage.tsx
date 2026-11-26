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

import { ClockIcon, PhoneOutIcon, ShieldIcon, SoundIcon } from "@/components/icons";
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
      window.location.assign("/campaigns");
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
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="surface-forest relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">

        <div className="relative flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-lg btn-solid">
            <SoundIcon className="size-6" />
          </span>
          <span className="display text-2xl">Outbound</span>
        </div>

        <div className="relative max-w-xl">
          <h1 className="display text-4xl leading-[1.1]">
            Every call on this system
            <br />
            can be <span className="text-mint">reconstructed</span>.
          </h1>
          <p className="mt-5 text-lg font-medium text-white/75">
            Which consent record authorised it, which flow version ran, which
            node the caller reached, what they pressed, and what it cost.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-3">
            {[
              [
                ShieldIcon,
                "Consent first",
                "A number with no consent on file is never dialled",
              ],
              [
                PhoneOutIcon,
                "Paced, not blasted",
                "Rate and channel limits apply to your whole account",
              ],
              [
                ClockIcon,
                "Local hours",
                "Calling windows follow the time where the person answers",
              ],
            ].map(([Icon, term, detail]) => {
              const Glyph = Icon as typeof PhoneOutIcon;
              return (
                <div key={term as string} className="rounded-xl bg-white/[0.08] p-4">
                  <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-mint">
                    <Glyph />
                  </span>
                  <dt className="mt-3 text-sm font-bold">{term as string}</dt>
                  <dd className="mt-1 text-xs leading-snug text-white/70">{detail as string}</dd>
                </div>
              );
            })}
          </dl>
        </div>

        <p className="relative max-w-xl text-sm font-semibold text-white/60">
          Automated outbound calling is regulated. Controls enforced here do not
          substitute for legal review of your consent model.
        </p>
      </section>

      <section className="flex items-center justify-center p-5 lg:rounded-[var(--radius-shell)]">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-md rounded-[var(--radius-shell)] border border-edge/70 bg-panel p-8 shadow-[var(--shadow-card)] sm:p-10"
          noValidate
        >
          <span className="mb-6 flex size-14 items-center justify-center rounded-lg bg-live text-live-bright lg:hidden">
            <SoundIcon className="size-7" />
          </span>
          <h2 className="display text-3xl text-chalk">Sign in</h2>
          <p className="mt-1 text-sm text-ash">
            Use the name and the five-character code your administrator gave
            you.
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
              {busy ? "Checking…" : "Sign in"}
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
