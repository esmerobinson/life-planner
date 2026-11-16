import { act, renderHook } from "@testing-library/react";
import { useReducedMotion } from "./hooks";
import { motionPref, reducedMotion, setMotionPref } from "./motion";

// Reduced motion follows the device's setting unless she picks one here, for this device only
// (localStorage "rio-reduced-motion"), and nothing breaks when storage is blocked.

function osSays(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("reduce"), media: q, addEventListener: () => undefined, removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  setMotionPref("system");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("follows the device by default", () => {
  osSays(true);
  expect(motionPref()).toBe("system");
  expect(reducedMotion()).toBe(true);
  osSays(false);
  expect(reducedMotion()).toBe(false);
});

it("'on' reduces motion even when the device doesn't, and is kept for this device", () => {
  osSays(false);
  setMotionPref("on");
  expect(reducedMotion()).toBe(true);
  expect(localStorage.getItem("rio-reduced-motion")).toBe("on");
});

it("'off' keeps full motion even when the device asks to reduce", () => {
  osSays(true);
  setMotionPref("off");
  expect(reducedMotion()).toBe(false);
});

it("back to the device's setting removes the stored choice", () => {
  setMotionPref("on");
  setMotionPref("system");
  expect(localStorage.getItem("rio-reduced-motion")).toBeNull();
  expect(motionPref()).toBe("system");
});

it("blocked storage: nothing throws, and the choice still holds for now", () => {
  osSays(false);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(motionPref()).toBe("system");
  expect(() => setMotionPref("on")).not.toThrow();
  expect(reducedMotion()).toBe(true);
});

it("components follow a change made here at once", () => {
  osSays(false);
  const { result } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(false);
  act(() => setMotionPref("on"));
  expect(result.current).toBe(true);
});
