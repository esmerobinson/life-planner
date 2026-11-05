import { describe, expect, it } from "vitest";

// VISUAL-LANGUAGE.md "Full, no blank space (2026-11-05)": her picks, as CSS rules. The real
// sizes are checked in a browser by e2e/no-blank-space.spec.ts.

// The project has no @types/node; vitest runs in node, so declare just what is used.
declare const process: { cwd(): string };
declare function require(id: string): { readFileSync(p: string, enc: string): string; resolve(...p: string[]): string };
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const css = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = css("src/styles/tokens.css");
const goals = css("src/styles/goals.css");
const sort = css("src/styles/sort.css");
const journal = css("src/styles/journal.css");
const controls = css("src/styles/controls.css");

/** Declarations of the first rule whose selector list contains `selector` (inside @media too). */
function rule(code: string, selector: string): string {
  for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(selector)) return m[2].replace(/\s+/g, " ");
  }
  throw new Error(`no rule for ${selector}`);
}

/** Declarations of the rule written with exactly this selector text (a :has() list has commas). */
function exact(code: string, selector: string): string {
  const at = code.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = code.indexOf("{", at);
  return code.slice(open + 1, code.indexOf("}", open)).replace(/\s+/g, " ");
}

/** The body of the at-rule that starts with `head` (one level of nesting). */
function block(code: string, head: string): string {
  const at = code.indexOf(head);
  if (at < 0) throw new Error(`no ${head}`);
  let depth = 0;
  for (let i = code.indexOf("{", at); i < code.length; i++) {
    if (code[i] === "{") depth++;
    if (code[i] === "}" && --depth === 0) return code.slice(code.indexOf("{", at) + 1, i);
  }
  throw new Error(`unclosed ${head}`);
}

describe("full, no blank space (2026-11-05)", () => {
  it("adds no colour, font or motion: the new rules use tokens only", () => {
    const added = [
      exact(tokens, ".app-content:has(> .page-sheet, > .page-fill)"),
      exact(tokens, ".page-sheet"),
      rule(goals, ".goal-grid"),
      rule(goals, ".goal-grid > .goal-tile-a"),
      rule(goals, ".suggested-list > .suggested-item"),
      block(tokens, "@media (min-width: 1000px)"),
      block(journal, "@container journal-tabs (min-width: 680px)"),
    ].join(" ");
    expect(added).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|font-family|transition|animation|!important/);
    for (const code of [tokens, goals, sort, controls, journal]) expect(code).not.toMatch(/transition:|animation/);
  });

  it("1 · A: an area's goal cards share its row (a third each at most, never under 280px), and so do Suggested goals", () => {
    const grid = rule(goals, ".goal-grid");
    expect(grid).toContain("display: flex");
    expect(grid).toContain("flex-wrap: wrap");
    expect(grid).toContain("gap: var(--space-4)");
    expect(grid).not.toContain("auto-fill");
    expect(rule(goals, ".goal-grid > .goal-tile-a")).toContain("flex: 1 1 max(280px, calc((100% - 2 * var(--space-4)) / 3))");
    const suggested = rule(goals, ".suggested-list");
    expect(suggested).toContain("display: flex");
    expect(suggested).not.toContain("auto-fill");
    expect(rule(goals, ".suggested-list > .suggested-item")).toContain("flex: 1 1 max(200px, calc((100% - 2 * 10px) / 3))");
  });

  it("2 · B: side by side, Home's goal cards share out the goals column's height and spread their lines evenly", () => {
    const wide = block(tokens, "@media (min-width: 1000px)");
    expect(rule(wide, ".home-goals-body")).toContain("flex-direction: column");
    expect(rule(wide, ".home-goals-body > .goal-mini-list")).toContain("flex-grow: 1");
    expect(rule(wide, ".home-goals-body .goal-mini")).toContain("flex-grow: 1");
    expect(rule(wide, ".home-goals-body .goal-mini-body")).toContain("justify-content: space-evenly");
    // Narrow (goals under Today) nothing grows.
    expect(block(tokens, "@media (max-width: 999.98px)")).not.toContain("goal-mini");
  });

  it("3 · A: one shared cream sheet reaching the window's bottom; Sort one by one's card is the sheet, full width", () => {
    const column = exact(tokens, ".app-content:has(> .page-sheet, > .page-fill)");
    expect(column).toContain("display: flex");
    expect(column).toContain("flex-direction: column");
    expect(column).toContain("min-height: 100vh");
    expect(column).toContain("min-height: 100dvh");
    expect(column).toContain("padding-bottom: max(var(--space-5), env(safe-area-inset-bottom))");
    expect(exact(tokens, ".is-phone .app-content:has(> .page-sheet, > .page-fill)")).toContain(
      "padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom))",
    );
    expect(rule(tokens, ".page-sheet")).toContain("flex: 1 0 auto"); // `.page-sheet, .page-fill`
    const look = exact(tokens, ".page-sheet");
    expect(look).toContain("background: var(--panel)");
    expect(look).toContain("border-radius: var(--radius-panel)");
    expect(look).toContain("padding: var(--pad-card)");
    // Sort: no 520px cap; the stage and the card grow to the bottom.
    expect(rule(sort, ".sort-card")).not.toContain("max-width");
    expect(rule(sort, ".sort-card")).toContain("flex: 1 0 auto");
    expect(rule(sort, ".sort-stage")).toContain("flex: 1 0 auto");
    // Each short page uses the one shared class, no per-page copies.
    for (const page of ["BinPage", "SyncPage", "BackupPage", "RepeatingPage", "RemindersPage"]) {
      expect(read(`src/ui/${page}.tsx`)).toMatch(/className="[a-z]+-page page-sheet"/);
    }
    expect(read("src/ui/SortPage.tsx")).toContain('className="sort-page page-fill"');
    for (const file of ["goals.css", "sort.css", "controls.css", "journal.css", "reminders.css", "pairing.css"]) {
      expect(css(`src/styles/${file}`)).not.toContain("page-sheet");
    }
  });

  it("4 · A: on the Mac the Journal tabs are one row of equal columns (labels wrap); stacked otherwise, never scrolling", () => {
    expect(rule(journal, ".journal-tabs-room")).toContain("container: journal-tabs / inline-size");
    expect(rule(journal, ".journal-tabs")).toContain("flex-direction: column");
    const row = block(journal, "@container journal-tabs (min-width: 680px)");
    expect(rule(row, ".journal-tabs:not(.is-stacked)")).toContain("display: grid");
    expect(rule(row, ".journal-tabs:not(.is-stacked)")).toContain("grid-auto-columns: minmax(0, 1fr)");
    expect(rule(row, ".journal-tabs:not(.is-stacked) .journal-tab-label")).toContain("overflow-wrap: break-word");
    expect(journal).not.toContain("overflow-x");
  });

  it("5: labelled text boxes run the full width; in a row (Add to inbox) the field takes what its button leaves", () => {
    for (const sel of ['.form-field input[type="text"]', '.form-field input[type="url"]', '.form-field input[type="password"]', ".form-field input:not([type])", ".form-field textarea"]) {
      expect(rule(controls, sel)).toContain("width: 100%");
    }
    expect(exact(controls, ".form-row > .form-field")).toContain("flex: 1 1 0");
  });
});
