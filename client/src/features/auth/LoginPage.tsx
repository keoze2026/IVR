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
import { useNavigate } from "react-router-dom";

import { ClipButton } from "@/components/styled/ClipButton";
import { Field, Input } from "@/components/ui";
import { ApiError } from "@/lib/errors";
import { useSession } from "@/lib/session";

export function LoginPage() {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { signIn } = useSession();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Resolves the session before returning, so the guarded route we are
      // about to land on already knows who we are.
      await signIn(apiKey.trim());
      navigate("/campaigns", { replace: true });
    } catch (cause) {
      // One message for every rejection. The server distinguishes unknown,
      // revoked, expired and out-of-network keys; repeating that distinction
      // here would let someone with a stolen key learn which of those it is.
      // Rate limiting still applies upstream.
      setError(
        cause instanceof ApiError && cause.status >= 500
          ? "Something went wrong at our end. Try again shortly."
          : "That key was not accepted. Check it and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* --- the standing rules ---------------------------------------- */}
      <section className="hidden flex-col justify-between border-r border-edge bg-panel p-12 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-signal" aria-hidden />
          <span className="display text-sm font-semibold tracking-wide text-chalk">
            Outbound
          </span>
        </div>

        <div className="max-w-md">
          <h1 className="display text-4xl font-semibold leading-[1.1] text-chalk">
            Every call on this system
            <br />
            can be reconstructed.
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-ash">
            Which consent record authorised it, which flow version ran, which
            node the caller reached, what they pressed, and what it cost.
          </p>

          <dl className="stagger mt-10 space-y-4 border-t border-edge pt-8">
            {[
              [
                "Consent first",
                "A number with no consent on file is never dialled",
              ],
              [
                "Paced, not blasted",
                "Rate and channel limits apply to your whole account",
              ],
              [
                "Local hours",
                "Calling windows follow the time where the person answers",
              ],
            ].map(([term, detail]) => (
              <div key={term} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4">
                <dt className="eyebrow pt-0.5">{term}</dt>
                <dd className="text-sm leading-snug text-ash">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-xs text-ash-dim">
          Automated outbound calling is regulated. Controls enforced here do not
          substitute for legal review of your consent model.
        </p>
      </section>

      {/* --- the key --------------------------------------------------- */}
      <section className="flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm" noValidate>
          <h2 className="display text-lg font-semibold text-chalk">
            Open the console
          </h2>
          <p className="mt-1 text-sm text-ash">
            Your administrator issues access keys. Ask them if you need one.
          </p>

          <div className="mt-8 space-y-6">
            <Field label="Access key" htmlFor="api-key" error={error ?? undefined}>
              <Input
                id="api-key"
                type="password"
                autoComplete="off"
                autoFocus
                spellCheck={false}
                placeholder="Paste your key"
                className="font-mono"
                value={apiKey}
                invalid={Boolean(error)}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </Field>

            <ClipButton
              type="submit"
              disabled={apiKey.trim().length === 0 || busy}
              style={{ width: "100%" }}
            >
              {busy ? "Checking…" : "Sign in"}
            </ClipButton>
          </div>
        </form>
      </section>
    </main>
  );
}
