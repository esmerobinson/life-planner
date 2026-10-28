import { describe, expect, it } from "vitest";

// The project has no @types/node; vitest runs in node, so declare just what is used.
declare const process: { cwd(): string };
declare function require(id: string): { readFileSync(p: string, enc: string): string; resolve(...p: string[]): string };
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

// Vitest runs from hub/. (CSS ?raw comes back empty under vitest, and Vite refuses ?raw outside hub/.)
const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const controls = read("src/styles/controls.css");
const tokens = read("src/styles/tokens.css");
const main = read("src/main.tsx");
const visual = read("../VISUAL-LANGUAGE.md");

const hexes = (s: string) => (s.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toLowerCase());
const allowed = new Set([...hexes(visual), "#ff00ff"]);

/** Declarations of the first rule whose selector list contains `selector`. */
function rule(selector: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of controls.matchAll(re)) {
    if (m[1].split(",").map((s) => s.trim()).includes(selector)) return m[2].replace(/\s+/g, " ");
  }
  throw new Error(`no rule for ${selector}`);
}

describe("controls.css (approved mockup A, soft pills)", () => {
  it("maps the approved colours onto tokens that hold the approved hex values", () => {
    expect(tokens).toContain("--bar-fill: #98c293");
    expect(tokens).toContain("--track: #d4d1c3");
    expect(tokens).toContain("--row: #e3ddcd");
    expect(tokens).toContain("--text: #3a412f");
  });

  it("styles the primary button", () => {
    const r = rule("button");
    expect(r).toContain("padding: 8px 16px");
    expect(r).toContain("border-radius: 999px");
    expect(r).toContain("border: 0");
    expect(r).toContain("background: var(--bar-fill)");
    expect(r).toContain("color: var(--text)");
    expect(r).toContain("font: inherit");
  });

  it("styles the secondary button", () => {
    expect(rule("button.btn-secondary")).toContain("background: var(--track)");
  });

  it("styles toggle buttons", () => {
    const r = rule("button[aria-pressed]");
    expect(r).toContain("padding: 6px 14px");
    expect(r).toContain("border-radius: 999px");
    expect(r).toContain("background: var(--track)");
    expect(rule('button[aria-pressed="true"]')).toContain("background: var(--bar-fill)");
  });

  it("styles text fields", () => {
    const r = rule("select");
    expect(r).toContain("padding: 9px 12px");
    expect(r).toContain("border-radius: 12px");
    expect(r).toContain("border: 0");
    expect(r).toContain("background: var(--row)");
    expect(r).toContain("color: var(--text)");
    expect(r).toContain("font: inherit");
    expect(r).not.toMatch(/width/);
    expect(controls).toContain("textarea");
    expect(controls).toContain('input[type="date"]');
  });

  it("styles checkboxes as 18px rounded squares", () => {
    const r = rule('input[type="checkbox"]');
    expect(r).toContain("appearance: none");
    expect(r).toContain("width: 18px");
    expect(r).toContain("height: 18px");
    expect(r).toContain("border-radius: 6px");
    expect(r).toContain("background: var(--track)");
    expect(rule('input[type="checkbox"]:checked')).toContain("background: var(--bar-fill)");
  });

  it("disabled uses palette greys only", () => {
    const r = rule("button:disabled");
    expect(r).toContain("background: var(--track)");
    expect(r).toContain("color: var(--control-disabled-text)");
    expect(r).toContain("cursor: default");
    expect(r).not.toContain("opacity");
    expect(controls).toContain("--control-disabled-text: #a09f88");
  });

  it("focus ring is the magenta placeholder", () => {
    expect(rule("button:focus-visible")).toContain("outline: 2px solid var(--placeholder)");
  });

  it("uses only palette colours and no unapproved effects", () => {
    for (const h of hexes(controls)) expect(allowed.has(h)).toBe(true);
    const code = controls.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const bad of ["transition", "animation", "box-shadow", ":hover", "!important", "opacity"]) {
      expect(code).not.toContain(bad);
    }
  });

  it("does not target sidebar links and is imported by main.tsx", () => {
    const code = controls.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/sidebar|nav/);
    expect(code).not.toMatch(/(^|[\s,}])a[\s,{:]/);
    expect(main).toContain('import "./styles/controls.css"');
  });
});
