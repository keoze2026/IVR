/** "Install app" on the sign-in screens. */

import { useState } from "react";

import { InstallIcon } from "@/components/icons";
import { InstallHelp } from "@/components/shell/InstallHelp";
import { useInstall } from "@/lib/pwa";

export function InstallLink() {
  const { available, canPrompt, install } = useInstall();
  const [help, setHelp] = useState(false);
  if (!available) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (canPrompt ? void install() : setHelp(true))}
        className="press mx-auto flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold text-signal hover:bg-live"
      >
        <InstallIcon className="size-4" />
        Install app
      </button>
      {help && <InstallHelp onClose={() => setHelp(false)} />}
    </>
  );
}
