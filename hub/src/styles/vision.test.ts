import { describe, expect, it } from "vitest";

// The project has no @types/node; vitest runs in node, so declare just what is used.
declare const process: { cwd(): string };
declare function require(id: string): { readFileSync(p: string, enc: string): string; resolve(...p: string[]): string };
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const css = read("src/styles/vision.css");
const main = read("src/main.tsx");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((s) => s.trim()).includes(selector)) return m[2].replace(/\s+/g, " ");
  }
  throw new Error(`no rule for ${selector}`);
}

describe("vision.css (the chosen collage, tab D)", () => {
  it("is imported", () => {
    expect(main).toContain('import "./styles/vision.css"');
  });

  it("brings no new colour, type or motion", () => {
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(code).not.toMatch(/rgba?\(/);
    for (const bad of ["transition", "animation", "font-family", "!important", "font-weight"]) expect(code).not.toContain(bad);
  });

  it("packs the photos edge to edge: 4 columns of at least 220px, no gaps, borders, radii or shadows", () => {
    expect(rule(".vision-collage")).toContain("columns: 4 220px");
    expect(rule(".vision-collage")).toContain("column-gap: 0");
    expect(rule(".vision-collage a")).toContain("display: block");
    expect(rule(".vision-collage a")).toContain("break-inside: avoid");
    expect(rule(".vision-collage img")).toContain("display: block");
    expect(rule(".vision-collage img")).toContain("width: 100%");
    for (const sel of [".vision-collage", ".vision-collage a", ".vision-collage img"]) {
      for (const bad of ["border", "radius", "shadow", "margin", "padding", "gap: 1", "gap: 2"]) {
        expect(rule(sel)).not.toContain(bad);
      }
    }
  });

  it("uses 2 columns on phone", () => {
    expect(rule(".is-phone .vision-collage")).toContain("columns: 2");
  });

  it("uses the mockup's small source line", () => {
    expect(rule(".vision-source")).toContain("font-size: 13px");
    expect(rule(".vision-source")).toContain("opacity: 0.8");
    expect(rule(".vision-head")).toContain("gap: 12px");
  });
});
