import { addDays } from "../domain/dates";
import { PROMPTS, PROMPT_BY_ID, STARTER_IDS, workbookPage } from "./prompts";
import { flavourAt, pickPrompts, REPEAT_WINDOW_DAYS, slotOf } from "./rotation";

const ALL = PROMPTS.map((p) => p.id);

describe("the prompt bank", () => {
  it("has the 61 prompts, 21 of them starters, and no safety lines", () => {
    expect(PROMPTS).toHaveLength(61);
    expect(STARTER_IDS).toHaveLength(21);
    expect(PROMPTS.every((p) => ["morning", "evening", "any"].includes(p.when))).toBe(true);
    expect(JSON.stringify(PROMPTS)).not.toMatch(/Samaritans|116 123|85258/);
  });

  it("shows the workbook page when the ref has one", () => {
    expect(workbookPage("book p. 134; Mindful Mornings article")).toBe("Workbook p. 134");
    expect(workbookPage("book p. 154–158")).toBe("Workbook p. 154–158");
    expect(workbookPage("book p. 27–29, 77")).toBe("Workbook p. 27–29, 77");
    expect(workbookPage("book p. 212; word list p. 139")).toBe("Workbook p. 212");
    expect(workbookPage("Mindful Mornings article")).toBeNull();
  });
});

describe("rotation", () => {
  it("puts prompts in their slots", () => {
    expect(["M1", "M12", "E1", "E2", "E3", "E7", "E12"].map(slotOf)).toEqual(Array(7).fill("noticing"));
    expect(["D1", "D11", "E4", "E5", "E6", "E8", "I1", "I11"].map(slotOf)).toEqual(Array(8).fill("skill"));
    expect(["K1", "K11"].map(slotOf)).toEqual(["kindness", "kindness"]);
    expect(["S1", "S4"].map(slotOf)).toEqual(["own", "own"]);
  });

  it("is morning before 14:00 and evening from 14:00", () => {
    expect(flavourAt(13)).toBe("morning");
    expect(flavourAt(14)).toBe("evening");
  });

  it("is deterministic for a day (every device shows the same three)", () => {
    const input = { date: "2026-10-28", hour: 9, active: STARTER_IDS, history: [] };
    expect(pickPrompts(input)).toEqual(pickPrompts({ ...input, active: [...STARTER_IDS].reverse() }));
    expect(pickPrompts(input)).toHaveLength(3);
  });

  it("asks three different prompts in slot order, for the time of day", () => {
    for (let i = 0; i < 60; i++) {
      const date = addDays("2026-10-01", i);
      for (const hour of [8, 20]) {
        const three = pickPrompts({ date, hour, active: STARTER_IDS, history: [] });
        expect(new Set(three).size).toBe(3);
        const slots = three.map(slotOf);
        ["noticing", "skill", "kindness"].forEach((slot, s) => expect([slot, "own"]).toContain(slots[s]));
        const flavour = hour < 14 ? "morning" : "evening";
        for (const id of three) expect(["any", flavour]).toContain(PROMPT_BY_ID.get(id)!.when);
      }
    }
  });

  it("never repeats a bank prompt within 10 days when the slot has other choices", () => {
    const history: { date: string; prompts: string[] }[] = [];
    for (let i = 0; i < 90; i++) {
      const date = addDays("2026-10-01", i);
      const three = pickPrompts({ date, hour: 20, active: ALL, history });
      for (const h of history.filter((h) => h.date > addDays(date, -REPEAT_WINDOW_DAYS))) {
        for (const id of three) if (slotOf(id) !== "own") expect(h.prompts).not.toContain(id);
      }
      history.push({ date, prompts: three });
    }
  });

  it("with only a few prompts on, uses the one asked longest ago", () => {
    const active = ["M1", "M2", "D6", "K5"]; // morning ones
    const history = [
      { date: "2026-10-27", prompts: ["M1", "D6", "K5"] },
      { date: "2026-10-25", prompts: ["M2", "D6", "K5"] },
    ];
    expect(pickPrompts({ date: "2026-10-28", hour: 8, active, history })).toEqual(["M2", "D6", "K5"]);
  });

  it("her own starters come up roughly twice a week each", () => {
    const counts = new Map<string, number>();
    const history: { date: string; prompts: string[] }[] = [];
    for (let i = 0; i < 140; i++) {
      const date = addDays("2026-10-01", i);
      const three = pickPrompts({ date, hour: 20, active: STARTER_IDS, history });
      history.push({ date, prompts: three });
      for (const id of three) if (id.startsWith("S")) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // 20 weeks: about 40 each for the evening/any ones (S3 is a morning prompt).
    for (const id of ["S1", "S2", "S4"]) {
      expect(counts.get(id)).toBeGreaterThan(25);
      expect(counts.get(id)).toBeLessThan(60);
    }
    expect(counts.get("S3") ?? 0).toBe(0);
  });

  it("falls back to other prompts when a slot is switched off, and to fewer when few are on", () => {
    const three = pickPrompts({ date: "2026-10-28", hour: 20, active: ["M6", "E3", "E5", "E6"], history: [] });
    expect(three).toHaveLength(3);
    expect(new Set(three).size).toBe(3);
    expect(pickPrompts({ date: "2026-10-28", hour: 20, active: ["E3"], history: [] })).toEqual(["E3"]);
    expect(pickPrompts({ date: "2026-10-28", hour: 20, active: [], history: [] })).toEqual([]);
  });
});
