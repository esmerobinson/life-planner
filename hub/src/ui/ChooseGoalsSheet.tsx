import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { setGoalOnHome } from "../data/repo";
import { isActive } from "../domain/goalCounts";
import type { Goal } from "../domain/types";
import { GOAL_AREAS_MIND_FIRST, NAV } from "./areas";
import { areaLabel } from "./GoalProgress";
import { useSaveError } from "./messages";

/** Goals in Mind-first area order (then any other area), keeping their order within an area. */
export function byArea(goals: Goal[]): Goal[] {
  const rank = (g: Goal) => {
    const n = GOAL_AREAS_MIND_FIRST.findIndex((a) => a.id === g.areaId);
    return n === -1 ? GOAL_AREAS_MIND_FIRST.length : n;
  };
  return goals.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * "Choose goals" as a pop-up (Esme: "selecting goals can be a tab that pops up";
 * mockup-choose-goals.html): a --panel sheet over a dimmed page, "Goals on Home", "N chosen",
 * the active goals by area (Mind first) as small colour-band cards with a ✓ box. Tapping a
 * card puts it on Home or takes it off at once (green outline and ✓ when on). Done, Escape or
 * a click on the dimmed page closes it; focus stays inside while it is open and goes back to
 * what opened it after. On a phone it is a full-screen sheet.
 */
export function ChooseGoalsSheet({
  goals, onChanged, onClose,
}: { goals: Goal[]; onChanged: () => Promise<void>; onClose: () => void }) {
  const { attempt, saveError } = useSaveError();
  // A card shows its new state at once; a failed save puts it back.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const shown = byArea(goals.filter(isActive));
  const areas = [...new Set(shown.map((g) => g.areaId))];
  const on = (g: Goal) => ticks[g.id] ?? g.onHome === true;
  const chosen = shown.filter(on).length;

  useEffect(() => {
    opener.current = document.activeElement;
    sheet.current?.focus();
    return () => {
      const back = opener.current as HTMLElement | null;
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
    };
  }, []);

  async function toggle(g: Goal) {
    const next = !on(g);
    setTicks((t) => ({ ...t, [g.id]: next }));
    if (await attempt(() => setGoalOnHome(g.id, next))) await onChanged();
    else
      setTicks((t) => {
        const { [g.id]: _drop, ...rest } = t;
        return rest;
      });
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !sheet.current) return;
    const all = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (all.length === 0) return;
    const first = all[0]!;
    const last = all[all.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === sheet.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="choose-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className="choose-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choose-goals-heading"
        tabIndex={-1}
        onKeyDown={onKey}
      >
        <div className="choose-top">
          <div>
            <h2 id="choose-goals-heading">Goals on Home</h2>
            <div className="choose-muted">Tap the goals you want beside Today.</div>
          </div>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="choose-count" aria-live="polite">{`${chosen} chosen`}</div>
        {saveError && <p className="form-message">{saveError}</p>}
        {areas.map((areaId) => {
          const nav = NAV.find((n) => n.id === areaId);
          return (
            <section key={areaId} aria-label={areaLabel(areaId)}>
              <h3 className="choose-area">{areaLabel(areaId)}</h3>
              <div className="choose-grid">
                {shown
                  .filter((g) => g.areaId === areaId)
                  .map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={on(g) ? "choose-card is-on" : "choose-card"}
                      aria-pressed={on(g)}
                      onClick={() => void toggle(g)}
                    >
                      <span className="choose-band" style={{ background: nav?.tile }}>
                        {nav && <img src={nav.icon} alt="" width={18} height={18} />}
                        <span className="choose-title">{g.title}</span>
                        <span className="choose-chk" aria-hidden="true">
                          {on(g) && "✓"}
                        </span>
                      </span>
                    </button>
                  ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
