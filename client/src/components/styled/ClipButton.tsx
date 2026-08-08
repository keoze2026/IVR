/**
 * The primary action.
 *
 * Adapted from the supplied Button: the clipped bottom-left/right corners are
 * kept — they read as a machine-cut plate and are the one shape in the console
 * that is not a plain rectangle, so the eye finds the primary action without
 * needing colour alone.
 *
 * The gradient is gone. Flat `--signal` on `--void` instead: this palette does
 * not use gradients, and a two-stop fill on a control that appears once per
 * screen was decoration rather than signal.
 *
 * Used sparingly — one per screen, on the action that commits something.
 */

import styled, { css } from "styled-components";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const CLIP =
  "polygon(0 0, 100% 0, 100% calc(100% - 11px), calc(100% - 11px) 100%, 11px 100%, 0 100%)";

const Root = styled.button<{ $tone: "signal" | "danger" | "quiet" }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  /* 44px — the primary action on a screen always meets the touch minimum,
     even though this console is desktop-first. */
  min-height: 44px;
  padding: 0 24px;
  border: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  cursor: pointer;
  clip-path: ${CLIP};
  transition:
    padding 200ms cubic-bezier(0.22, 0.8, 0.3, 1),
    transform 120ms cubic-bezier(0.22, 0.8, 0.3, 1),
    background-color 160ms ease-out,
    color 160ms ease-out;

  ${(p) =>
    p.$tone === "signal" &&
    css`
      background: var(--color-signal);
      color: var(--color-void);
      &:hover:not(:disabled) {
        background: #c9ff63;
      }
    `}

  ${(p) =>
    p.$tone === "danger" &&
    css`
      background: var(--color-rust);
      color: #fff;
      &:hover:not(:disabled) {
        background: #f05a5f;
      }
    `}

  ${(p) =>
    p.$tone === "quiet" &&
    css`
      background: var(--color-raised);
      color: var(--color-chalk);
      box-shadow: inset 0 0 0 1px var(--color-edge-bright);
      &:hover:not(:disabled) {
        background: var(--color-edge);
      }
    `}

  /* The supplied component widened on hover. Kept — it is a small, physical
     acknowledgement, and on a console where most controls are flat it is the
     one place a little motion is welcome. */
  &:hover:not(:disabled) {
    padding: 0 28px;
  }

  /* Hover never fires on touch, so the press gets its own acknowledgement. */
  &:active:not(:disabled) {
    transform: scale(0.975);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

export interface ClipButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  tone?: "signal" | "danger" | "quiet";
  children: ReactNode;
}

export function ClipButton({
  tone = "signal",
  children,
  ...rest
}: ClipButtonProps) {
  return (
    <Root $tone={tone} {...rest}>
      {children}
    </Root>
  );
}
