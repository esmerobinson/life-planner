import { render } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NATIVE_NAVIGATE, useNativeNavigate } from "./nativeNavigate";

let path = "";
function Probe() {
  useNativeNavigate();
  path = useLocation().pathname;
  return null;
}

const go = (p: unknown) => (window as unknown as Record<string, (p: unknown) => boolean>)[NATIVE_NAVIGATE](p);

describe("the Mac app's way in (a clicked reminder)", () => {
  it("opens app paths and refuses anything else", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Probe />
      </MemoryRouter>,
    );
    let ok = false;
    act(() => {
      ok = go("/journal/morning");
    });
    expect(ok).toBe(true);
    expect(path).toBe("/journal/morning");
    for (const bad of ["//evil.example/x", "https://example.org/", "today", 42, null, undefined]) {
      act(() => {
        ok = go(bad);
      });
      expect(ok).toBe(false);
      expect(path).toBe("/journal/morning");
    }
    unmount();
    expect(NATIVE_NAVIGATE in window).toBe(false);
  });
});
