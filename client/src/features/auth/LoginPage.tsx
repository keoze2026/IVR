/**
 * Sign in.
 *
 * "Paste your API key" is the whole login because it is the only credential
 * the backend accepts (docs/API-GAPS.md G-05). The key goes to the BFF, is
 * validated upstream, and is exchanged for a session cookie — it is never
 * stored in the browser. When JWT lands this becomes email + password and
 * nothing else here changes.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Field, Input } from "@/components/ui";
import { login } from "@/lib/api";
import { ApiError } from "@/lib/errors";

export function LoginPage() {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(apiKey.trim());
      // Drop anything cached under a previous identity before navigating.
      queryClient.clear();
      navigate("/campaigns", { replace: true });
    } catch (cause) {
      // The upstream messages are already the right words — "API key is
      // revoked or expired", "Source address not permitted for this key".
      setError(
        cause instanceof ApiError || cause instanceof Error
          ? cause.message
          : "Sign in failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <header className="mb-8">
          <h1 className="text-lg font-semibold text-ink">Outbound IVR</h1>
          <p className="mt-1 text-sm text-muted">Operator portal</p>
        </header>

        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-lg border border-line bg-surface p-6"
          noValidate
        >
          <Field
            label="API key"
            htmlFor="api-key"
            error={error ?? undefined}
            hint={
              <>
                Issued by <code className="text-xs">manage.py bootstrap_org</code>.
                It is stored on the server, never in your browser.
              </>
            }
          >
            <Input
              id="api-key"
              type="password"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              placeholder="ivrk_…"
              value={apiKey}
              invalid={Boolean(error)}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={busy}
            disabled={apiKey.trim().length === 0}
          >
            Sign in
          </Button>
        </form>
      </div>
    </main>
  );
}
