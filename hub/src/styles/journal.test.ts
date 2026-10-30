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

  it("keeps stars as the magenta placeholder and today outlined in the violet", () => {
    expect(code).toMatch(/\.journal-day\.on::after \{[^}]*background: var\(--placeholder\)/);
    expect(code).toMatch(/\.journal-day\.today \{[^}]*outline: 2px solid var\(--journal-violet\)/);
    expect(code).toMatch(/\.journal-photo\.blurred \{[^}]*filter: blur\(10px\)/);
  });

  it("exercise cards: the Day chip is the Journal violet; the star is drawn in --text on no background", () => {
    expect(code).toMatch(/\.chip\.exercise-day \{[^}]*background: var\(--journal-violet\)/);
    expect(code).toMatch(/button\.exercise-star\[aria-pressed\] \{[^}]*background: none;[^}]*color: var\(--text\)/);
  });
});
