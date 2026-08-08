/**
 * The channel meter — the console's signature.
 *
 * Concurrent channels is the number a dialer operator actually watches. It is
 * a *level*, not a rate: bounded by trunk capacity and, on a transfer
 * campaign, by how many agents are free. Exceed it and the carrier starts
 * answering 503 about twenty seconds in.
 *
 * So it is drawn as discrete segments rather than a continuous bar — one
 * segment per channel, countable, the way a trunk actually is. A percentage
 * would hide the thing that matters, which is how many are left.
 *
 * Lives in the top chrome on every screen; enlarges on the live dashboard.
 */

import styled, { css, keyframes } from "styled-components";

import { useIsNarrow } from "@/lib/useMediaQuery";

/**
 * Segment count is responsive because the point of this meter is that the
 * segments are *countable*. Forty of them across a 340px phone leaves ~5px
 * each, which reads as texture rather than as channels — so narrow screens
 * get fewer, larger segments instead.
 */
const SEGMENTS_WIDE = 40;
const SEGMENTS_NARROW = 20;

const breathe = keyframes`
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
`;

const Track = styled.div<{ $size: "sm" | "lg" }>`
  display: flex;
  align-items: stretch;
  gap: ${(p) => (p.$size === "lg" ? "3px" : "2px")};
  height: ${(p) => (p.$size === "lg" ? "28px" : "12px")};
  width: 100%;
`;

const Segment = styled.span<{
  $state: "empty" | "filled" | "edge" | "over";
  $size: "sm" | "lg";
}>`
  flex: 1 1 0;
  min-width: 2px;
  border-radius: ${(p) => (p.$size === "lg" ? "2px" : "1px")};

  /* Unused channels are hatched, not blank. Blank reads as "no data";
     hatched reads as headroom, which is what it is. Hard stops — no blend. */
  background-color: transparent;
  background-image: repeating-linear-gradient(
    -45deg,
    var(--color-edge) 0px,
    var(--color-edge) 1.5px,
    transparent 1.5px,
    transparent 4px
  );
  transition:
    background-color 220ms ease-out,
    opacity 220ms ease-out;

  ${(p) =>
    p.$state === "filled" &&
    css`
      background: var(--color-live);
    `}

  /* The leading segment breathes, so a glance tells you it is moving and not
     a frozen dashboard. One moving element, not forty. */
  ${(p) =>
    p.$state === "edge" &&
    css`
      background: var(--color-live-bright);
      animation: ${breathe} 1.8s ease-in-out infinite;
    `}

  /* Over ceiling should never happen — acquire_channel over-admits slightly
     under races. If it shows, the semaphore has drifted. */
  ${(p) =>
    p.$state === "over" &&
    css`
      background: var(--color-rust);
    `}
`;

export interface ChannelMeterProps {
  live: number;
  ceiling: number;
  size?: "sm" | "lg";
  label?: string;
}

export function ChannelMeter({
  live,
  ceiling,
  size = "sm",
  label,
}: ChannelMeterProps) {
  const narrow = useIsNarrow();
  const segments = narrow ? SEGMENTS_NARROW : SEGMENTS_WIDE;

  const safeCeiling = Math.max(1, ceiling);
  const ratio = Math.min(1, live / safeCeiling);
  const filled = Math.round(ratio * segments);
  const over = live > safeCeiling;

  return (
    <div className="w-full">
      {label && (
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="eyebrow">{label}</span>
          <span className="num text-xs text-ash">
            <span className={live > 0 ? "text-chalk" : undefined}>{live}</span>
            <span className="text-ash-dim"> / {ceiling}</span>
          </span>
        </div>
      )}
      <Track
        $size={size}
        role="meter"
        aria-valuenow={live}
        aria-valuemin={0}
        aria-valuemax={ceiling}
        aria-label={`${live} of ${ceiling} channels in use`}
      >
        {Array.from({ length: segments }, (_, i) => (
          <Segment
            key={i}
            $size={size}
            $state={
              over
                ? "over"
                : i < filled - 1
                  ? "filled"
                  : i === filled - 1
                    ? "edge"
                    : "empty"
            }
          />
        ))}
      </Track>
    </div>
  );
}
