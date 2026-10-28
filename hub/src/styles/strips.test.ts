import { describe, expect, it } from "vitest";

// The project has no @types/node; vitest runs in node, so declare just what is used.
declare const process: { cwd(): string };
declare function require(id: string): { readFileSync(p: string, enc: string): string; resolve(...p: string[]): string };
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const strips = read("src/styles/strips.css");
const tokens = read("src/styles/tokens.css");
const main = read("src/main.tsx");
const visual = read("../VISUAL-LANGUAGE.md");
const code = strips.replace(/\/\*[\s\S]*?\*\//g, "");

const hexes = (s: string) => (s.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toLowerCase());
const paletteText = visual.slice(visual.indexOf("## Extracted palette"), visual.indexOf("## Not decided"));
const allowed = new Set(hexes(paletteText));

/** Declarations of the first rule whose selector list contains `selector`. */
function rule(selector: string): string {
  for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((s) => s.trim()).includes(selector)) return m[2].replace(/\s+/g, " ");
  }
  throw new Error(`no rule for ${selector}`);
}

describe("strips.css (design round 2, values from the chosen mockups)", () => {
  it("is imported after controls.css, and the old OVERDUE sticker is gone", () => {
    expect(main.indexOf('import "./styles/strips.css"')).toBeGreaterThan(main.indexOf('import "./styles/controls.css"'));
    expect(tokens).not.toContain("overdue-sticker");
  });

  it("uses only palette colours (sage, Happy Home red) and the mockup's forest-green shadow", () => {
    expect(hexes(code).filter((h) => !allowed.has(h))).toEqual([]);
    expect(code).toContain("--late: #bf6564");
    expect(code).toContain("--sage: #a09f88");
    for (const m of code.matchAll(/rgba\(([^)]*)\)/g)) expect(m[1].replace(/\s/g, "")).toBe("58,65,47,0.25");
    for (const bad of ["transition", "animation", "font-family", "!important"]) expect(code).not.toContain(bad);
  });

  it("strips (A)", () => {
    const r = rule(".strip");
    expect(r).toContain("background: var(--row)");
    expect(r).toContain("border-radius: var(--radius-tile)");
    expect(r).toContain("padding: 10px 12px");
    expect(r).toContain("grid-template-columns: auto 1fr auto");
    expect(r).toContain("gap: 12px");
    const l = rule(".strip-list");
    expect(l).toContain("list-style: none");
    expect(l).toContain("gap: 8px");
    expect(rule(".plain-list")).toContain("list-style: none");
    expect(rule(".goal-list")).toContain("list-style: none");
  });

  it("tick box and icons (1B)", () => {
    const t = rule('input[type="checkbox"].tick');
    expect(t).toContain("width: 22px");
    expect(t).toContain("height: 22px");
    expect(t).toContain("border-radius: 7px");
    expect(t).toContain("background: var(--panel)");
    expect(t).toContain("border: 2px solid var(--sage)");
    const i = rule("button.icon");
    expect(i).toContain("width: 30px");
    expect(i).toContain("height: 30px");
    expect(i).toContain("border-radius: 8px");
    expect(i).toContain("background: var(--panel)");
    expect(rule("button.icon svg")).toContain("width: 16px");
    expect(rule(".strip-actions")).toContain("gap: 4px");
  });

  it("due line (2D) and popover (1A menu look)", () => {
    expect(rule(".strip-meta")).toContain("font-size: 13px");
    const late = rule(".strip-late");
    expect(late).toContain("color: var(--late)");
    expect(late).toContain("font-weight: 600");
    const m = rule(".pop-menu");
    expect(m).toContain("background: var(--panel)");
    expect(m).toContain("border-radius: 12px");
    expect(m).toContain("padding: 6px");
    expect(m).toContain("min-width: 190px");
  });

  it("goal cards (3A), month count and done fold-out (4A)", () => {
    const c = rule(".goal-card");
    expect(c).toContain("background: var(--panel)");
    expect(c).toContain("border-radius: var(--radius-panel)");
    expect(c).toContain("padding: 16px");
    expect(c).toContain("gap: 10px");
    expect(rule(".goal-tile")).toContain("width: 32px");
    expect(rule(".goal-title")).toContain("font-size: 17px");
    expect(rule(".goal-next")).toContain("background: var(--row)");
    const mp = rule(".month-progress");
    expect(mp).toContain("background: var(--panel)");
    expect(mp).toContain("padding: 12px 16px");
    const done = rule(".done-fold .strip-title");
    expect(done).toContain("text-decoration: line-through");
    expect(done).toContain("opacity: 0.6");
  });
});
