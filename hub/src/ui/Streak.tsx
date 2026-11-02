/**
 * The one streak, everywhere a streak shows (VISUAL-LANGUAGE.md "Streak (2026-11-02)", her
 * pick, mockup-streaks.html option D): seven small bars for the last seven days ending today
 * (done days filled), then the number of days in a row. Hidden when the streak is 0 and no
 * day this week was done. Its look lives in styles/streak.css (`.streak`), in one place.
 */
export function Streak({
  week,
  n,
}: {
  /** The last seven days, oldest first, ending today: done or not. */
  week: readonly boolean[];
  /** Days in a row. */
  n: number;
}) {
  if (n <= 0 && !week.some(Boolean)) return null;
  const words = `${n} ${n === 1 ? "day" : "days"} in a row`;
  return (
    <span className="streak" title={words}>
      <span className="streak-week" aria-hidden="true">
        {week.map((on, i) => (
          <span key={i} className={on ? "streak-day on" : "streak-day"} />
        ))}
      </span>
      <span className="streak-n" aria-hidden="true">
        {n}
      </span>
      <span className="visually-hidden">{words}</span>
    </span>
  );
}
