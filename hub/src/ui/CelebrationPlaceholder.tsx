/*
 * Sort one by one's "All sorted" moment is undecided: a magenta box stands in. (Ticking a to-do or
 * habit has its chosen celebration, the pixel sparkle: tickSparkle.ts.)
 */
export function CelebrationPlaceholder() {
  return (
    <div
      data-testid="celebration-placeholder"
      role="status"
      aria-label="Celebration placeholder"
      style={{ background: "var(--placeholder)", width: 120, height: 48 }}
    />
  );
}
