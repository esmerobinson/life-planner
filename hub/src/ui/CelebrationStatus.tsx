/**
 * What a screen reader hears for a celebration (the stars and confetti are drawn by
 * celebrate.ts, aria-hidden): a visually hidden status, "Done" after a tick.
 */
export function CelebrationStatus({ text = "Done" }: { text?: string }) {
  return (
    <p data-testid="celebration" role="status" className="visually-hidden">
      {text}
    </p>
  );
}
