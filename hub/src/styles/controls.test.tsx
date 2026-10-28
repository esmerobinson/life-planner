import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { QuickAdd } from "../ui/QuickAdd";
import { MoveToMenu } from "../ui/MoveToMenu";
import { JournalCardStub } from "../ui/JournalCardStub";
import { AreaPage } from "../ui/AreaPage";

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
// Only the palette sections of VISUAL-LANGUAGE.md (sampled palette and role assignments), not the prose elsewhere.
const paletteText = visual.slice(visual.indexOf("## Extracted palette"), visual.indexOf("## Not decided"));
const allowed = new Set(hexes(paletteText));
const PLACEHOLDER = "#ff00ff";
/** Hex colours in `css` that are neither palette values nor the magenta placeholder. */
const unapprovedHexes = (css: string, ok: Set<string> = allowed): string[] =>
  hexes(css).filter((h) => !ok.has(h) && h !== PLACEHOLDER);

/** Declarations of the first rule whose selector list contains `selector`. */
function rule(selector: string, source: string = controls): string {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(re)) {
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

  it("styles the native file input button as the soft-pill secondary", () => {
    const r = rule('input[type="file"]::file-selector-button');
    expect(r.split(";").map((d) => d.trim()).filter(Boolean)).toEqual([
      "padding: 8px 16px",
      "border-radius: 999px",
      "border: 0",
      "background: #d4d1c3",
      "color: #3a412f",
      "font: inherit",
      "margin-right: 8px",
      "cursor: default",
    ]);
    expect(controls).not.toMatch(/input\[type="file"\]\s*\{/);
    expect(allowed.has("#d4d1c3") && allowed.has("#3a412f")).toBe(true);
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
    expect(unapprovedHexes(controls)).toEqual([]);
    const code = controls.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const bad of ["transition", "animation", "box-shadow", ":hover", "!important", "opacity"]) {
      expect(code).not.toContain(bad);
    }
  });

  it("does not target sidebar links and is imported by main.tsx", () => {
    const code = controls.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/sidebar|nav/);
    // Any anchor selector must be scoped to the content area or be the pill variant.
    for (const m of code.matchAll(/([^{}]+)\{/g)) {
      for (const sel of m[1].split(",").map((x) => x.trim())) {
        if (/(^|[\s>])a([\s.:[]|$)/.test(sel)) {
          expect(sel.startsWith(".app-content a") || sel.startsWith("a.btn-secondary")).toBe(true);
        }
      }
    }
    expect(main).toContain('import "./styles/controls.css"');
  });

  it("form grid layout from mockup A", () => {
    const g = rule(".form-grid");
    expect(g).toContain("display: grid");
    expect(g).toContain("grid-template-columns: 1fr 1fr");
    expect(g).toContain("gap: 8px 12px");
    expect(rule(".form-full")).toContain("grid-column: 1 / -1");
    const l = rule(".form-field");
    expect(l).toContain("display: block");
    expect(rule(".form-label")).toContain("font-size: 11px");
    expect(l).toContain("margin: 8px 0 4px");
    expect(rule(".form-grid .form-field input[type=\"text\"]")).toContain("width: 100%");
    const f = rule("fieldset");
    expect(f).toContain("border: 0");
    expect(f).toContain("padding: 0");
    expect(f).toContain("margin: 0");
    expect(rule("legend")).toContain("font-size: 11px");
    const c = rule(".form-check");
    expect(c).toContain("display: inline-flex");
    expect(c).toContain("align-items: center");
    expect(c).toContain("gap: 6px");
    const a = rule(".form-actions");
    expect(a).toContain("display: flex");
    expect(a).toContain("gap: 8px");
    expect(a).toContain("margin-top: 12px");
  });

  it("pill links and content links", () => {
    const a = rule("a.btn-secondary");
    expect(a).toContain("padding: 8px 16px");
    expect(a).toContain("border-radius: 999px");
    expect(a).toContain("background: var(--track)");
    expect(a).toContain("color: var(--text)");
    expect(a).toContain("text-decoration: none");
    const row = rule(".shell-actions");
    expect(row).toContain("display: flex");
    expect(row).toContain("gap: 8px");
    expect(row).toContain("flex-wrap: wrap");
    expect(row).toContain("align-items: center");
    expect(rule(".app-content a:not(.btn-secondary)")).toContain("color: var(--text)");
  });

  it("QuickAdd markup uses the grid classes and every control has a label", () => {
    const { container } = render(<QuickAdd today="2026-10-27" onAdded={() => {}} />);
    const form = container.querySelector("form") as HTMLElement;
    expect(form.classList.contains("form-grid")).toBe(true);
    expect(screen.getByLabelText("Title").closest("label")?.classList.contains("form-full")).toBe(true);
    expect(container.querySelector("fieldset.form-full")).not.toBeNull();
    expect(container.querySelector(".form-actions.form-full")).not.toBeNull();
    for (const el of Array.from(form.querySelectorAll("input, select"))) {
      expect(el.closest("label")).not.toBeNull();
    }
    expect(form.querySelectorAll("label.form-field").length).toBeGreaterThanOrEqual(6);
    expect(form.querySelectorAll("label.form-check").length).toBe(7);
  });

  it("the palette checker rejects made-up hexes and accepts palette ones", () => {
    expect(allowed.has("#98c293")).toBe(true);
    expect(allowed.has("#ff00ff")).toBe(false);
    expect(unapprovedHexes("a { color: #123456; }")).toEqual(["#123456"]);
    expect(unapprovedHexes("a { color: #98c293; background: #FF00FF; }")).toEqual([]);
  });

  it("pins the sidebar while the page scrolls", () => {
    const r = rule(".sidebar", tokens);
    expect(r).toContain("position: sticky");
    expect(r).toContain("top: 0");
    expect(r).toContain("height: 100vh");
    expect(r).toContain("overflow-y: auto");
    expect(rule(".app-shell", tokens)).toContain("align-items: flex-start");
  });

  it("button groups have spacing", async () => {
    const g = rule(".btn-group");
    expect(g).toContain("display: flex");
    expect(g).toContain("flex-wrap: wrap");
    expect(g).toContain("gap: 8px");
    expect(g).toContain("align-items: center");

    const area = render(
      <MemoryRouter initialEntries={["/area/art"]}>
        <Routes>
          <Route path="/area/:areaId" element={<AreaPage today="2026-10-27" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByRole("group", { name: "Show" })).classList.contains("btn-group")).toBe(true);
    area.unmount();

    const journal = render(<JournalCardStub />);
    expect(screen.getByRole("button", { name: "Morning pages" }).parentElement?.classList.contains("btn-group")).toBe(true);
    journal.unmount();

    // Move to is now a popover in the 1A menu look (strips.css), not a row of pills.
    render(<MoveToMenu itemId="x" today="2026-10-27" onMoved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Move to" }));
    const menu = screen.getByRole("group", { name: "Move to" });
    expect(menu.classList.contains("pop-menu")).toBe(true);
    const choices = Array.from(menu.querySelectorAll("button"));
    expect(choices.length).toBe(11); // eight areas, This week, Remove from today, Archive
  });

  it("grid items can shrink", () => {
    expect(rule(".form-grid > *")).toContain("min-width: 0");
  });

  it("top row pushes Inbox right; Backup footer uses the sidebar text colour", () => {
    expect(rule(".shell-inbox")).toContain("margin-left: auto");
    expect(rule(".sidebar-footer", tokens)).toContain("margin-top: auto");
    expect(rule(".sidebar-footer a", tokens)).toContain("color: var(--sidebar-text)");
  });
});
