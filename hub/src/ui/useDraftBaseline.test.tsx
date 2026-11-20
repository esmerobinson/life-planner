import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useDraft } from "./useDraft";

// The save gets the text the field last loaded or saved (re-review RI1, 20 Nov 2026): a page save
// can then tell what was removed IN the editor from what simply arrived meanwhile from another device.

it("save(text, shown): shown is what was loaded, then what was last saved; a new stored value arriving while typing is not", async () => {
  const save = vi.fn(async () => undefined);
  const { result, rerender } = renderHook(({ stored }) => useDraft(stored, save), { initialProps: { stored: "a" } });
  act(() => result.current.set("a b"));
  act(() => result.current.flush());
  expect(save).toHaveBeenLastCalledWith("a b", "a");
  // Arrives while nothing is unsaved: taken in, so it is what the editor shows.
  rerender({ stored: "c" });
  act(() => result.current.set("c d"));
  // Arrives while typing is unsaved: ignored, so never the baseline.
  rerender({ stored: "c with a picture from the phone" });
  act(() => result.current.flush());
  expect(save).toHaveBeenLastCalledWith("c d", "c");
});
