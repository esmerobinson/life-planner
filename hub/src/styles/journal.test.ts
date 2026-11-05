import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };
declare function require(id: string): { readFileSync(p: string, enc: string): string; resolve(...p: string[]): string };
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const code = read("src/styles/journal.css").replace(/\/\*[\s\S]*?\*\//g, "");

describe("journal.css", () => {
  it("is imported", () => {
    expect(read("src/main.tsx")).toContain('import "./styles/journal.css"');
  });

  it("brings no colour but the Journal tile violet, and no type family or motion", () => {
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g)).toEqual(["#9285c5"]);
    expect(code).not.toMatch(/rgba?\(/);
    for (const bad of ["transition", "animation", "font-family", "!important"]) expect(code).not.toContain(bad);
  });

  it("a done day is mint (the magenta stars are retired); today outlined in the violet", () => {
    expect(code).not.toContain(".journal-star");
    expect(code).not.toMatch(/\.journal-day\.on::after/);
    expect(code).toMatch(/\.journal-day\.on \{[^}]*background: var\(--mint\)/);
    expect(code).toMatch(/\.journal-day\.today \{[^}]*outline: 2px solid var\(--journal-violet\)/);
    expect(code).toMatch(/\.journal-photo\.blurred \{[^}]*filter: blur\(10px\)/);
  });

  it("the Journal page fills the content column (no width cap); desktop calendar cells are a fixed height", () => {
    expect(code).toMatch(/\.journal-page \{[^}]*\}/);
    expect(code.match(/\.journal-page \{[^}]*\}/)![0]).not.toContain("max-width");
    expect(code).not.toMatch(/\.journal-(card|page) \{[^}]*max-width/);
    expect(code).toMatch(/\.app-shell:not\(\.is-phone\) \.journal-day \{[^}]*aspect-ratio: auto;[^}]*height: 56px/);
    expect(code).toMatch(/\.app-shell:not\(\.is-phone\) \.journal-page-box \{[^}]*min-height: max\(260px, 60vh\)/);
  });

  it("the exercise response box is the check-in answer box at 16px or more", () => {
    expect(code).toMatch(/\.journal-answer\.exercise-response \{[^}]*font-size: max\(16px, 1em\)/);
  });

  it("Journal v2 tabs: the mockup's big pills (16px, 12px 18px, --row; selected mint and bold); never scrolling sideways: one row on the Mac, stacked on the phone and when narrow", () => {
    expect(code).not.toContain("overflow-x");
    // Stacked is the default (the phone, a narrow window, no container queries)...
    expect(code).toMatch(/\.journal-tabs \{[^}]*flex-direction: column/);
    expect(code).toMatch(/\.journal-tabs a\.journal-tab \{[^}]*white-space: normal/);
    // ...and with room for five columns, not on the phone, one row of equal columns (2026-11-05).
    expect(code).toMatch(/@container journal-tabs \(min-width: 680px\) \{\s*\.journal-tabs:not\(\.is-stacked\) \{[^}]*display: grid;[^}]*grid-auto-columns: minmax\(0, 1fr\)/);
    expect(code).toMatch(/a\.journal-tab \{[^}]*border-radius: 14px;[^}]*padding: 12px 18px;[^}]*background: var\(--row\);[^}]*font-size: 16px/);
    expect(code).toMatch(/a\.journal-tab\.is-selected \{[^}]*background: var\(--mint\);[^}]*font-weight: 700/);
    expect(code).toMatch(/\.journal-tab \.tick-auto,[^{]*\{[^}]*width: 18px;[^}]*height: 18px;[^}]*border-radius: 6px/);
    expect(code).toMatch(/\.exercise-more-box \{[^}]*background: var\(--row\);[^}]*border-radius: var\(--radius-tile\);[^}]*padding: 12px 14px;[^}]*line-height: 1\.55/);
  });

  it("the streak is drawn in one place: streak.css (7x14 bars, 3px radius and gap; the number 12px, 600)", () => {
    const streak = read("src/styles/streak.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(read("src/main.tsx")).toContain('import "./styles/streak.css"');
    expect(streak).toMatch(/\.streak \{[^}]*font-size: 12px;[^}]*font-weight: 600/);
    expect(streak).toMatch(/\.streak-week \{[^}]*gap: 3px/);
    expect(streak).toMatch(/\.streak-day \{[^}]*width: 7px;[^}]*height: 14px;[^}]*border-radius: 3px;[^}]*background: var\(--track\)/);
    expect(streak).toMatch(/\.streak-day\.on \{[^}]*background: var\(--bar-fill\)/);
    expect(streak).toMatch(/\.journal-row \.streak-day:not\(\.on\)[^{]*\{[^}]*background: var\(--panel\)/);
    expect(streak).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("workbook bars and chapter map: the approved mockup's values (2A + 2C)", () => {
    expect(code).toMatch(/\.wb-bars \{[^}]*flex-direction: column;[^}]*gap: 12px/);
    expect(code).toMatch(/button\.wb-bar \{[^}]*gap: 6px;[^}]*padding: 0;[^}]*background: none/);
    expect(code).toMatch(/\.wb-ch \{[^}]*background: var\(--row\);[^}]*border-radius: var\(--radius-tile\);[^}]*padding: 10px 12px/);
    expect(code).toMatch(/button\.wb-dot \{[^}]*width: 9px;[^}]*height: 9px;[^}]*border-radius: 50%;[^}]*background: var\(--track\)/);
    expect(code).toMatch(/button\.wb-dot\.on \{[^}]*background: var\(--bar-fill\)/);
    expect(code).toMatch(/button\.wb-dot\.now \{[^}]*outline: 2px solid var\(--journal-violet\);[^}]*outline-offset: 1px/);
  });

  it("exercise cards: the Day chip is the Journal violet; the star is drawn in --text on no background", () => {
    expect(code).toMatch(/\.chip\.exercise-day \{[^}]*background: var\(--journal-violet\)/);
    expect(code).toMatch(/button\.exercise-star\[aria-pressed\] \{[^}]*background: none;[^}]*color: var\(--text\)/);
  });
});
