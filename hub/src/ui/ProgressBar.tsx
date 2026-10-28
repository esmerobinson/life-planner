/** A bar for a 0-1 ratio. Out-of-range clamps; NaN/undefined count as 0. */
export function ProgressBar({ ratio, label }: { ratio: number; label: string }) {
  const safe = typeof ratio === "number" && Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const percent = Math.round(safe * 100);
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
