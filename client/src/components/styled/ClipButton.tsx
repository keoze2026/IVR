/**
 * The primary action on a screen.
 *
 * Kept as its own component so every "commit" button changes in one place.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Button } from "@/components/ui";

export interface ClipButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  tone?: "signal" | "danger" | "quiet";
  children: ReactNode;
}

const VARIANT = { signal: "primary", danger: "danger", quiet: "secondary" } as const;

export function ClipButton({ tone = "signal", children, ...rest }: ClipButtonProps) {
  return (
    <Button {...rest} variant={VARIANT[tone]}>
      {children}
    </Button>
  );
}
