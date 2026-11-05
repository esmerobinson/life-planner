import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../ui/Sidebar";
import { NAV } from "../ui/areas";

// The project has no @types/node; vitest runs in node, so declare just what is used.
declare const process: { cwd(): string };
declare function require(id: string): { readFileSync(p: string, enc: string): string; resolve(...p: string[]): string };
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const css = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the first rule whose selector list contains `selector`. */
function rule(code: string, selector: string): string {
  for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((s) => s.trim()).includes(selector)) return m[2].replace(/\s+/g, " ");
  }
  throw new Error(`no rule for ${selector}`);
}

describe("design quick wins (VISUAL-LANGUAGE.md, 2026-11-05)", () => {
  it("the sidebar's current page fills with its own area colour, dark bold text, no magenta ring", () => {
    const r = rule(css("src/styles/tokens.css"), '.sidebar-item[aria-current="page"]');
    expect(r).toContain("background: var(--tile)");
    expect(r).toContain("color: var(--text)");
    expect(r).toContain("font-weight: 700");
    expect(r).not.toContain("placeholder");
    expect(r).not.toContain("outline");
  });

  it("each sidebar row carries its area tile colour, so the current one can use it", () => {
    render(
      <MemoryRouter initialEntries={["/area/writing"]}>
        <Sidebar />
      </MemoryRouter>,
    );
    const writing = screen.getByRole("link", { name: "Writing" });
    expect(writing).toHaveAttribute("aria-current", "page");
    expect(writing.style.getPropertyValue("--tile")).toBe(NAV.find((n) => n.id === "writing")!.tile);
  });

  it("the Undo line next to the + button has no placeholder outline (placement chosen)", () => {
    expect(rule(css("src/styles/add.css"), ".shell-undo.has-note")).not.toContain("placeholder");
  });
});
