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

  describe("a skipped question goes back into circulation (Esme, 2026-11-04)", () => {
    // Morning: M1 M2 (noticing), D3 D6 (skill), K5 + more kindness ones are on.
    const active = ["M1", "M2", "M4", "D3", "D6", "K2", "K4", "K5"];

    it("comes up first in its slot on the next check-in, still three questions in slot order", () => {
      const date = "2026-11-04";
      const base = pickPrompts({ date, hour: 8, active, history: [] });
      // Yesterday D6 was asked and skipped (no answer); the other two were answered.
      const skippedD6 = [{ date: "2026-11-03", prompts: ["M2", "D6", "K4"], answered: new Set(["M2", "K4"]) }];
      const three = pickPrompts({ date, hour: 8, active, history: skippedD6 });
      expect(three).toHaveLength(3);
      expect(three[1]).toBe("D6");
      expect(three.map(slotOf)).toEqual(["noticing", "skill", "kindness"]);
      // The same on every device, whatever order things arrive in.
      expect(pickPrompts({ date, hour: 8, active: [...active].reverse(), history: [...skippedD6] })).toEqual(three);
      // Answered, it would have waited out the no-repeat window instead.
      const answered = [{ date: "2026-11-03", prompts: ["M2", "D6", "K4"], answered: new Set(["M2", "D6", "K4"]) }];
      expect(pickPrompts({ date, hour: 8, active, history: answered })).not.toContain("D6");
      expect(base).toHaveLength(3);
    });

    it("the oldest skip comes first when two in a slot were skipped", () => {
      const history = [
        { date: "2026-11-01", prompts: ["M1", "D3", "K2"], answered: new Set(["M1", "K2"]) },
        { date: "2026-11-02", prompts: ["M4", "D6", "K5"], answered: new Set(["M4", "K5"]) },
      ];
      expect(pickPrompts({ date: "2026-11-04", hour: 8, active, history })[1]).toBe("D3");
    });

    it("a question not reached (the check-in left half done) counts as missed too", () => {
      const history = [{ date: "2026-11-03", prompts: ["M2", "D6", "K4"], answered: new Set(["M2"]) }];
      const three = pickPrompts({ date: "2026-11-04", hour: 8, active, history });
      expect(three[1]).toBe("D6");
      expect(three[2]).toBe("K4");
    });

    it("skipped again straight after coming back: back to normal circulation (no nagging)", () => {
      const history = [
        { date: "2026-11-02", prompts: ["M2", "D6", "K4"], answered: new Set(["M2", "K4"]) },
        { date: "2026-11-03", prompts: ["M1", "D6", "K5"], answered: new Set(["M1", "K5"]) },
      ];
      expect(pickPrompts({ date: "2026-11-04", hour: 8, active, history })[1]).toBe("D3");
    });

    it("waits for a check-in at its time of day", () => {
      // M6 is an evening question, skipped last evening: a morning check-in doesn't ask it.
      const history = [{ date: "2026-11-03", prompts: ["M6", "D3", "K4"], answered: new Set(["D3", "K4"]) }];
      const on = [...active, "M6"];
      expect(pickPrompts({ date: "2026-11-04", hour: 8, active: on, history })).not.toContain("M6");
      expect(pickPrompts({ date: "2026-11-04", hour: 20, active: on, history })[0]).toBe("M6");
    });
  });

  it("falls back to other prompts when a slot is switched off, and to fewer when few are on", () => {
    const three = pickPrompts({ date: "2026-10-28", hour: 20, active: ["M6", "E3", "E5", "E6"], history: [] });
    expect(three).toHaveLength(3);
    expect(new Set(three).size).toBe(3);
    expect(pickPrompts({ date: "2026-10-28", hour: 20, active: ["E3"], history: [] })).toEqual(["E3"]);
    expect(pickPrompts({ date: "2026-10-28", hour: 20, active: [], history: [] })).toEqual([]);
  });
});
