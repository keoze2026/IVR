/** How to install by hand, for browsers that offer no install button. */

import { Button, Modal } from "@/components/ui";
import { isAppleDevice } from "@/lib/pwa";

export function InstallHelp({ onClose }: { onClose: () => void }) {
  const steps = isAppleDevice()
    ? ["Open this page in Safari.", "Tap the Share button.", "Tap “Add to Home Screen”, then “Add”."]
    : [
        "Open this page in Chrome or Edge.",
        "Open the browser menu (three dots).",
        "Choose “Install app” or “Add to Home screen”.",
      ];

  return (
    <Modal title="Install app" subtitle="Opens from your home screen, like any other app." onClose={onClose}>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step} className="flex items-center gap-3 text-sm font-medium text-chalk">
            <span className="num flex size-8 shrink-0 items-center justify-center rounded-full bg-live font-bold text-live-bright">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <div className="mt-6 flex justify-end">
        <Button type="button" variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
