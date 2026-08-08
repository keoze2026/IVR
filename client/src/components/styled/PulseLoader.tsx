/**
 * Waiting.
 *
 * Adapted from the supplied Loader: same five pulsing dots, same staggered
 * delays. Recoloured from blue to `--signal`, and the glow ring dropped to a
 * faint halo — on a dark console the original box-shadow bloomed.
 *
 * Reads as a line of channels lighting up in sequence, which is close enough
 * to what the system is doing while you wait for it.
 */

import styled, { keyframes } from "styled-components";

const pulse = keyframes`
  0%   { transform: scale(0.72); background-color: var(--color-signal-dim); }
  50%  { transform: scale(1.08); background-color: var(--color-signal); }
  100% { transform: scale(0.72); background-color: var(--color-signal-dim); }
`;

const Dots = styled.div<{ $scale: number }>`
  display: flex;
  align-items: center;
  gap: ${(p) => 7 * p.$scale}px;

  .dot {
    height: ${(p) => 9 * p.$scale}px;
    width: ${(p) => 9 * p.$scale}px;
    border-radius: 50%;
    background-color: var(--color-signal-dim);
    animation: ${pulse} 1.4s infinite ease-in-out;
  }

  .dot:nth-child(1) {
    animation-delay: -0.32s;
  }
  .dot:nth-child(2) {
    animation-delay: -0.16s;
  }
  .dot:nth-child(3) {
    animation-delay: 0s;
  }
  .dot:nth-child(4) {
    animation-delay: 0.16s;
  }
  .dot:nth-child(5) {
    animation-delay: 0.32s;
  }
`;

export function PulseLoader({
  label,
  scale = 1,
}: {
  label?: string;
  scale?: number;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-10"
      role="status"
    >
      <Dots $scale={scale}>
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </Dots>
      {label && <span className="eyebrow">{label}</span>}
    </div>
  );
}
