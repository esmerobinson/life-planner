import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";
import { AutoGrowTextarea, growTo } from "./useAutoGrow";

// Answer boxes grow downwards as she types, so she sees her whole answer (Esme, 2026-11-04):
// never shorter than they start, up to a generous maximum, then they scroll inside.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("growTo", () => {
  it("fits the content (plus borders), up to the maximum; past it, scrolls inside", () => {
    expect(growTo(300, 2, 600)).toEqual({ height: 302, scroll: false });
    expect(growTo(900, 2, 600)).toEqual({ height: 600, scroll: true });
  });
});

/** A box whose content is `content` px tall (jsdom lays nothing out). */
function Box({ content }: { content: () => number }) {
  const [v, setV] = useState("");
  return (
    <AutoGrowTextarea
      aria-label="Pretend answer"
      value={v}
      onChange={(e) => setV(e.target.value)}
      ref={(el) => {
        if (el) Object.defineProperty(el, "scrollHeight", { configurable: true, get: content });
      }}
    />
  );
}

it("grows with the text as she types, with no inner scrollbar", () => {
  let h = 120;
  render(<Box content={() => h} />);
  const box = screen.getByRole("textbox", { name: "Pretend answer" });
  h = 260;
  fireEvent.change(box, { target: { value: "Pretend line\n".repeat(10) } });
  expect(box.style.height).toBe("260px");
  expect(box.style.overflowY).toBe("hidden");
});

it("stops at 70% of the window and scrolls inside after that", () => {
  vi.stubGlobal("innerHeight", 1000);
  let h = 120;
  render(<Box content={() => h} />);
  const box = screen.getByRole("textbox", { name: "Pretend answer" });
  h = 2000;
  fireEvent.change(box, { target: { value: "Pretend line\n".repeat(80) } });
  expect(box.style.height).toBe("700px");
  expect(box.style.overflowY).toBe("auto");
});

it("keeps the page where it was and the caret in view (typing at the end)", () => {
  vi.stubGlobal("innerHeight", 800);
  const scrollTo = vi.fn();
  const scrollBy = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
  vi.stubGlobal("scrollBy", scrollBy);
  let h = 120;
  render(<Box content={() => h} />);
  const box = screen.getByRole("textbox", { name: "Pretend answer" });
  vi.spyOn(box, "getBoundingClientRect").mockReturnValue({ top: 500, bottom: 850 } as DOMRect);
  box.focus();
  // The page was at 400; the brief "auto" height lets the browser pull it up to 300.
  let reads = 0;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => (reads++ === 0 ? 400 : 300));
  h = 350;
  const text = "Pretend line\n".repeat(12);
  fireEvent.change(box, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } });
  expect(scrollTo).toHaveBeenCalledWith(window.scrollX, 400); // no jump from the brief "auto" height
  expect(scrollBy).toHaveBeenCalledWith(0, 850 - 800 + 16); // the box's bottom (the caret) into view
});
