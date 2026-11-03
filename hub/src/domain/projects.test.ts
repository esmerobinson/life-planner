import { describe, expect, it } from "vitest";
import type { Item, Session } from "./types";
import {
  countdown, isProject, newSessions, nextSessionIndex, projectLine, sessionName, todayLine, withSessions,
} from "./projects";

const TODAY = "2026-11-02";
const proj = (sessions: Session[] | undefined, o: Partial<Item> = {}): Item => ({
  id: "p", kind: "task", title: "Pretend street scene", links: [], areaId: "art", priority: 2, status: "open",
  createdAt: "2026-10-29", touchedAt: "2026-10-29", due: "2026-11-09", ...(sessions ? { sessions } : {}), ...o,
});

describe("projects", () => {
  it("a project is a to-do with sessions", () => {
    expect(isProject(proj([{ id: "a" }]))).toBe(true);
    expect(isProject(proj([]))).toBe(false);
    expect(isProject(proj(undefined))).toBe(false);
  });

  it("newSessions makes unnamed sessions with distinct ids", () => {
    const s = newSessions(4);
    expect(s).toHaveLength(4);
    expect(new Set(s.map((x) => x.id)).size).toBe(4);
    expect(s.every((x) => Object.keys(x).join() === "id")).toBe(true);
  });

  it("an unnamed session is called by its place", () => {
    expect(sessionName({ id: "a" }, 2)).toBe("Session 3");
    expect(sessionName({ id: "a", title: "Market stalls" }, 2)).toBe("Market stalls");
  });

  it("the next session is the first not done, or the first one planned for today", () => {
    const p = proj([{ id: "a", doneOn: "2026-10-30" }, { id: "b" }, { id: "c", plannedFor: TODAY }, { id: "d" }]);
    expect(nextSessionIndex(p, TODAY)).toBe(2);
    expect(nextSessionIndex(p, "2026-11-03")).toBe(1);
    expect(nextSessionIndex(proj([{ id: "a", doneOn: TODAY }]), TODAY)).toBe(-1);
  });

  it("area line: Next: <title> when named, else Session N of M; plus the due line with days left", () => {
    const named = proj([
      { id: "a", doneOn: "2026-10-30" }, { id: "b", doneOn: "2026-11-01" }, { id: "c", title: "Lighting and papel picado" }, { id: "d" },
    ]);
    expect(projectLine(named, TODAY)).toEqual({ lead: "Next: Lighting and papel picado", due: "Due Mon 9 Nov · 7 days left", late: false });
    const unnamed = proj([{ id: "a", doneOn: "2026-10-30" }, { id: "b", doneOn: "2026-11-01" }, { id: "c" }, { id: "d" }]);
    expect(projectLine(unnamed, TODAY).lead).toBe("Session 3 of 4");
    expect(projectLine(proj([{ id: "a" }], { due: "2026-11-03" }), TODAY).due).toBe("Due tomorrow");
    expect(projectLine(proj([{ id: "a" }], { due: "2026-10-31" }), TODAY)).toMatchObject({
      due: "Due Sat 31 Oct · 2 days late", late: true,
    });
    expect(projectLine(proj([{ id: "a" }], { due: undefined }), TODAY).due).toBeUndefined();
  });

  it("Today line: Session N of M today · <title if named>, and Due …; done today once ticked", () => {
    const p = proj([{ id: "a", doneOn: "2026-10-30" }, { id: "b", doneOn: "2026-11-01" }, { id: "c", title: "Lighting" }, { id: "d" }]);
    expect(todayLine(p, TODAY)).toEqual({ lead: "Session 3 of 4 today · Lighting", due: "Due Mon 9 Nov", late: false });
    expect(todayLine(proj([{ id: "a" }, { id: "b" }]), TODAY).lead).toBe("Session 1 of 2 today");
    const ticked = proj([
      { id: "a", doneOn: "2026-10-30" }, { id: "b", doneOn: "2026-11-01" }, { id: "c", title: "Lighting", doneOn: TODAY }, { id: "d" },
    ]);
    expect(todayLine(ticked, TODAY).lead).toBe("Session 3 of 4 done today · Lighting");
  });

  it("the countdown is the share of the time left until the deadline", () => {
    expect(countdown(proj([{ id: "a" }]), TODAY)).toBeCloseTo(7 / 11);
    expect(countdown(proj([{ id: "a" }], { due: "2026-10-31" }), TODAY)).toBe(0);
    expect(countdown(proj([{ id: "a" }], { due: TODAY, createdAt: TODAY }), TODAY)).toBe(0);
    expect(countdown(proj([{ id: "a" }], { due: undefined }), TODAY)).toBeNull();
    expect(countdown(proj([{ id: "a" }], { createdAt: "2026-11-05" }), TODAY)).toBe(1);
  });

  it("withSessions marks it done (completedAt that day) when every session is done, open otherwise", () => {
    const done = withSessions(proj([]), [{ id: "a", doneOn: "2026-10-30" }, { id: "b", doneOn: TODAY }], TODAY);
    expect(done).toMatchObject({ status: "done", completedAt: TODAY });
    const open = withSessions({ ...done }, [{ id: "a", doneOn: "2026-10-30" }, { id: "b" }], TODAY);
    expect(open.status).toBe("open");
    expect("completedAt" in open).toBe(false);
    // Already done stays done on the day it was completed.
    const again = withSessions({ ...done, completedAt: "2026-11-01" }, done.sessions!, TODAY);
    expect(again.completedAt).toBe("2026-11-01");
  });
});
