/** Decorative sound bars for brand panels. Carries no data. */

const BARS = [18, 34, 52, 30, 68, 92, 56, 40, 76, 100, 62, 44, 84, 58, 30, 48, 72, 38, 22, 54, 88, 60, 36, 26];

export function Waveform({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`glow flex h-24 items-center gap-1.5 ${className}`}>
      {BARS.map((height, i) => (
        <span
          key={i}
          className="w-2 rounded-full bg-gradient-to-b from-mint to-sky"
          style={{ height: `${height}%`, opacity: 0.35 + (height / 100) * 0.65 }}
        />
      ))}
    </div>
  );
}
