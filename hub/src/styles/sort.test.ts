import { describe, expect, it } from "vitest";

// The project has no @types/node; vitest runs in node, so declare just what is used.
declare const process: { cwd(): string };
declare function require(id: string): { readFileSync(p: string, enc: string): string; resolve(...p: string[]): string };
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const sort = read("src/styles/sort.css");
const main = read("src/main.tsx");
const code = sort.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((s) => s.trim()).includes(selector)) return m[2].replace(/\s+/g, " ");
  }
  throw new Error(`no rule for ${selector}`);
}

describe("sort.css (the chosen sort card, tab B)", () => {
  it("is imported after strips.css", () => {
    expect(main.indexOf('import "./styles/sort.css"')).toBeGreaterThan(main.indexOf('import "./styles/strips.css"'));
  });

  it("brings no new colour, type or motion", () => {
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(code).not.toMatch(/rgba?\(/);
    for (const bad of ["transition", "animation", "font-family", "!important"]) expect(code).not.toContain(bad);
  });

  it("uses the mockup's values for the card, the type tiles and the app grid", () => {
    expect(rule(".sort-card")).toContain("background: var(--panel)");
    expect(rule(".sort-card")).toContain("border-radius: var(--radius-panel)");
    expect(rule(".sort-card")).toContain("padding: 24px");
    expect(rule(".sort-card")).toContain("max-width: 520px");
    expect(rule("button.sort-type")).toContain("background: var(--row)");
    expect(rule("button.sort-type")).toContain("padding: 18px 8px");
    expect(rule(".sort-type .sort-tile")).toContain("width: 44px");
    expect(rule(".sort-type .sort-tile img")).toContain("width: 30px");
    expect(rule(".sort-apps")).toContain("grid-template-columns: repeat(4, 1fr)");
    expect(rule(".sort-app .sort-tile")).toContain("width: 56px");
    expect(rule(".sort-app .sort-tile")).toContain("border-radius: 16px");
    expect(rule(".sort-app .sort-tile img")).toContain("width: 36px");
    expect(rule("button.sort-app")).toContain("font-size: 13px");
    expect(rule("textarea.sort-notes")).toContain("background: var(--row)");
    expect(rule("textarea.sort-notes")).toContain("border-radius: var(--radius-tile)");
    expect(rule("textarea.sort-notes")).toContain("font-size: 14px");
    expect(code).toMatch(/@media \(max-width: 720px\) \{\s*\.sort-apps \{\s*grid-template-columns: repeat\(3, 1fr\);/);
  });
});
