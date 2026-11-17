import { vi } from "vitest";
import { setMotionPref } from "../farm/motion";
import { playTickSparkle, SPARKLE_BURSTS, SPARKLE_CALM_MS, SPARKLE_FRAME_MS, SPARKLE_TOTAL_MS } from "./tickSparkle";

// Esme's pick (2026-11-17, option C "Pixel sparkles"): the farm's fx-sparkle flashes three times
// round the tick box, 100 ms apart, each 3 stepped frames of 100 ms; 0.5 s in all. Calm: one
// still frame for 0.3 s.

const layer = () => document.querySelector<HTMLElement>('[data-testid="tick-sparkle"]');
const bursts = () => Array.from(document.querySelectorAll<HTMLElement>(".tick-sparkle-px"));
const shown = () => bursts().filter((b) => b.style.visibility === "visible");
const rect = { left: 100, top: 200, width: 22, height: 22 } as DOMRect;

beforeEach(() => {
  vi.useFakeTimers();
  setMotionPref("off");
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  setMotionPref("system");
  document.body.replaceChildren();
});

describe("the tick sparkle", () => {
  it("is the approved timing: bursts at (-6,-4) 0 ms, (4,-26) 100 ms, (-18,-20) 200 ms; 100 ms frames; 0.5 s", () => {
    expect(SPARKLE_BURSTS).toEqual([
      { x: -6, y: -4, at: 0 },
      { x: 4, y: -26, at: 100 },
      { x: -18, y: -20, at: 200 },
    ]);
    expect(SPARKLE_FRAME_MS).toBe(100);
    expect(SPARKLE_TOTAL_MS).toBe(500);
    expect(SPARKLE_CALM_MS).toBe(300);
  });

  it("sits on the box's centre, above the list, never takes a click, hidden from screen readers", () => {
    playTickSparkle(rect);
    const l = layer()!;
    expect(l.style.position).toBe("fixed");
    expect(l.style.left).toBe("111px");
    expect(l.style.top).toBe("211px");
    expect(l.style.pointerEvents).toBe("none");
    expect(l.getAttribute("aria-hidden")).toBe("true");
    expect(l.parentElement).toBe(document.body);
  });

  it("plays frames 0, 1, 2 of each burst, stepped, and is gone after 0.5 s", () => {
    playTickSparkle(rect);
    expect(bursts()).toHaveLength(3);
    expect(bursts().map((b) => b.style.transform)).toEqual([
      "translate(-6px, -4px)", "translate(4px, -26px)", "translate(-18px, -20px)",
    ]);
    // 0 ms: the first burst, frame 0.
    expect(shown()).toHaveLength(1);
    expect(bursts()[0].style.backgroundPosition).toBe("0px 0px");
    vi.advanceTimersByTime(100);
    expect(shown()).toHaveLength(2);
    expect(bursts()[0].style.backgroundPosition).toBe("-60px 0px");
    expect(bursts()[1].style.backgroundPosition).toBe("0px 0px");
    vi.advanceTimersByTime(100);
    expect(shown()).toHaveLength(3);
    expect(bursts()[0].style.backgroundPosition).toBe("-120px 0px");
    vi.advanceTimersByTime(100); // 300 ms: the first burst has shown its three frames
    expect(bursts()).toHaveLength(2);
    vi.advanceTimersByTime(199);
    expect(layer()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(layer()).toBeNull();
  });

  it("calm (reduced motion): one still frame 0 for 0.3 s, then gone", () => {
    setMotionPref("on");
    playTickSparkle(rect);
    expect(bursts()).toHaveLength(1);
    expect(shown()).toHaveLength(1);
    expect(bursts()[0].style.transform).toBe("translate(-6px, -4px)");
    expect(bursts()[0].style.backgroundPosition).toBe("0px 0px");
    vi.advanceTimersByTime(299);
    expect(bursts()[0].style.backgroundPosition).toBe("0px 0px");
    expect(layer()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(layer()).toBeNull();
  });

  it("follows the device's reduced-motion setting by default", () => {
    setMotionPref("system");
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    playTickSparkle(rect);
    expect(bursts()).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("an element: plays at its box", () => {
    const box = document.createElement("input");
    document.body.append(box);
    box.getBoundingClientRect = () => rect;
    playTickSparkle(box);
    expect(layer()!.style.left).toBe("111px");
  });
});
