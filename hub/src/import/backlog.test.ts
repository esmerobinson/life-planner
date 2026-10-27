import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../data/db";
import { parseBacklog, importBacklog } from "./backlog";
import md from "./__fixtures__/Backlog.md?raw";

const TODAY = "2026-10-27";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

describe("parseBacklog", () => {
  it("parses priority, due, recur and tags", () => {
    const { items } = parseBacklog(md);
    const ferns = items.find((i) => i.title === "Water the fictional ferns")!;
    expect(ferns).toMatchObject({ priority: 1, due: "2026-09-01", tags: ["home"], inbox: false });
    expect(ferns.key).toBe("backlog:water the fictional ferns");
    const sketch = items.find((i) => i.title === "Sketch a lighthouse")!;
    expect(sketch.recur).toEqual(["mon", "wed"]);
    expect(sketch.tags).toEqual(["art", "practice"]);
    expect(items.find((i) => i.title === "Reply to the imaginary landlord")!.priority).toBe(2);
    expect(items.find((i) => i.title.includes("pottery"))!.inbox).toBe(true);
  });

  it("skips parked and moved-elsewhere sections and done lines", () => {
    const titles = parseBacklog(md).items.map((i) => i.title);
    expect(titles).not.toContain("Learn the theremin");
    expect(titles).not.toContain("Draft the invented newsletter");
    expect(titles.join("|")).not.toMatch(/Finished|Handed-off/);
    expect(titles).toHaveLength(6);
  });

  it("[due 2026-13-45] is reported in skipped, item imported without due", () => {
    const { items, skipped } = parseBacklog(md);
    const it1 = items.find((i) => i.title === "Renew the made-up library card")!;
    expect(it1.due).toBeUndefined();
    expect(skipped.some((s) => s.line.includes("2026-13-45") && /due/i.test(s.reason))).toBe(true);
  });

  it("empty text line and unknown !p9 do not throw", () => {
    const { items, skipped } = parseBacklog(md);
    expect(items.find((i) => i.title === "Reorganise the spice shelf")!.priority).toBe(2);
    expect(skipped.some((s) => /empty/i.test(s.reason))).toBe(true);
    expect(skipped.some((s) => s.line.includes("!p9") && /priority/i.test(s.reason))).toBe(true);
    expect(() => parseBacklog("- [ ] \n- [ ] !p1\n## \n- [ ]")).not.toThrow();
  });
});

describe("parseBacklog robustness", () => {
  it("strips repeated metadata from the title", () => {
    const { items } = parseBacklog(
      "- [ ] Foo !p1 bar !p3\n- [ ] Ring [due 2026-01-01] x [due 2026-02-02]\n- [ ] Go [recur: mon] on [recur: tue]",
    );
    expect(items.map((i) => i.title)).toEqual(["Foo bar", "Ring x", "Go on"]);
    expect(items[0].priority).toBe(1);
    expect(items[1].due).toBe("2026-01-01");
  });

  it("handles non-ASCII tags", () => {
    const { items } = parseBacklog("- [ ] Visit #café now #naïve-x");
    expect(items[0].title).toBe("Visit now");
    expect(items[0].tags).toEqual(["café", "naïve-x"]);
  });

  it("CRLF file gives the same items as LF", () => {
    expect(parseBacklog(md.replace(/\n/g, "\r\n"))).toEqual(parseBacklog(md));
  });
});

describe("importBacklog", () => {
  it("keeps tags on imported items, none when absent", async () => {
    await importBacklog("- [ ] A thing #home #art\n- [ ] Plain thing", TODAY);
    const a = (await db.items.filter((i) => i.title === "A thing").first())!;
    const b = (await db.items.filter((i) => i.title === "Plain thing").first())!;
    expect(a.tags).toEqual(["home", "art"]);
    expect(b.tags ?? []).toEqual([]);
  });

  it("importing twice adds nothing the second time", async () => {
    const first = await importBacklog(md, TODAY);
    expect(first.added).toBe(6);
    expect(first.skipped).toBeGreaterThan(0);
    const second = await importBacklog(md, TODAY);
    expect(second).toMatchObject({ added: 0, alreadyHad: 6 });
    expect(await db.items.count()).toBe(6);
    const one = (await db.items.toArray())[0];
    expect(one).toMatchObject({ areaId: "inbox", kind: "task", links: [], status: "open" });
    expect(one.source?.kind).toBe("backlog");
  });

  it("re-import does not reopen an item ticked in the app", async () => {
    await importBacklog(md, TODAY);
    const row = (await db.items.filter((i) => i.title === "Reply to the imaginary landlord").first())!;
    await db.items.update(row.id, { status: "done", completedAt: TODAY });
    await importBacklog(md, "2026-10-28");
    expect(await db.items.get(row.id)).toMatchObject({ status: "done", completedAt: TODAY, touchedAt: TODAY });
  });

  it("re-import does not resurrect an archived item", async () => {
    await importBacklog(md, TODAY);
    const row = (await db.items.filter((i) => i.title === "Sketch a lighthouse").first())!;
    await db.items.update(row.id, { status: "archived" });
    const r = await importBacklog(md, TODAY);
    expect(r.alreadyHad).toBe(6);
    expect((await db.items.get(row.id))!.status).toBe("archived");
  });

  it("duplicate titles in one file collapse to one item", async () => {
    const r = await importBacklog("- [ ] Same  thing\n- [ ] same thing", TODAY);
    expect(r).toMatchObject({ added: 1, alreadyHad: 1 });
  });
});
