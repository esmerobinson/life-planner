/* Confetti and stars are undecided: a magenta box stands in. */
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
