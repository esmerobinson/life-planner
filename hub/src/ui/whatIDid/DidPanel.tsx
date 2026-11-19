import { useMemo } from "react";
import { dayLabel } from "../../domain/display";
import { isProject, lastTickedSession } from "../../domain/projects";
import type { ISODate, Item } from "../../domain/types";
import { didTarget } from "../../domain/whatIDid";
import { asksWhatIDid } from "./context";
import { DidBox } from "./DidBox";
import { DID_WORDS as W } from "./words";

/**
 * The side panel's "What I did" (Esme, 19 Nov 2026: add or edit it later). A to-do's one note (a
 * new one is dated the day it was done, or today); a project's note for each session it has one
 * for. Placement under the page is provisional (for Design).
 */
export function DidPanel({ item, today, onChanged }: { item: Item; today: ISODate; onChanged: () => Promise<void> }) {
  const ids = (item.did ?? []).map((e) => e.id).join(",");
  // Which notes show: every one it has; with none, one new box (it is written once she types).
  const last = isProject(item) ? lastTickedSession(item) : undefined;
  const targets = useMemo(
    () =>
      item.did?.length
        ? item.did.map((e) => ({ id: e.id, on: e.on, ...(e.session ? { session: e.session } : {}) }))
        : last
          ? [didTarget(item, last.doneOn!, last.id)]
          : [didTarget(item, item.completedAt ?? today)],
    // Only when its notes change (not on every edit of the to-do), so a new box keeps its id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id, ids, last?.id],
  );
  if (!asksWhatIDid(item)) return null;
  // Only once something is done (review M8: "did", not "doing"): a to-do ticked, a session
  // ticked, or a note it already has.
  if (!item.did?.length && item.status !== "done" && !last) return null;
  const project = isProject(item);
  return (
    <section className="did-panel" aria-label={W.panelHeading}>
      <h3>{W.panelHeading}</h3>
      {targets.map((at) => {
        const k = at.session ? (item.sessions ?? []).findIndex((s) => s.id === at.session) : -1;
        const session = k >= 0 ? `Session ${k + 1}${item.sessions![k]!.title ? `: ${item.sessions![k]!.title}` : ""}` : null;
        const when = `${session ? `${session} · ` : ""}${dayLabel(at.on, today)}`;
        return (
          <div key={at.id}>
            {(project || item.did?.length) && <p className="choose-muted did-panel-when">{when}</p>}
            <DidBox item={item} at={at} today={today} label={W.panelBox} onSaved={onChanged} />
          </div>
        );
      })}
    </section>
  );
}
