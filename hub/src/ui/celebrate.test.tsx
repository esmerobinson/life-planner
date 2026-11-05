import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import * as repo from "../data/repo";
import { createItem } from "../data/repo";
import { CELEBRATION_MS, CONFETTI_COLOURS, confettiBurst, starPop } from "./celebrate";
import { TodayPanel } from "./TodayPanel";
import { AreaPage } from "./AreaPage";
import { SortPage } from "./SortPage";

// jsdom has no Web Animations API, so nothing is drawn there; these tests give elements a
// stand-in `animate` that records each call and lets the test end the animations.
type Call = { el: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions; anim: { onfinish: (() => void) | null; oncancel: (() => void) | null } };
let calls: Call[] = [];
const proto = HTMLElement.prototype as unknown as { animate?: unknown };

function fakeAnimate() {
  proto.animate = function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const anim = { onfinish: null, oncancel: null };
    calls.push({ el: this, frames, options, anim });
    return anim;
  };
}
const finishAll = () => calls.forEach((c) => c.anim.onfinish?.());
const layers = () => document.querySelectorAll(".celebration-layer");
const stars = () => document.querySelectorAll(".celebration-layer .celebration-star");
const bits = () => document.querySelectorAll(".celebration-layer .celebration-bit");

function reduceMotion(on: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: on && query === "(prefers-reduced-motion: reduce)", media: query, addEventListener: () => {}, removeEventListener: () => {},
  }));
}

beforeEach(async () => {
  calls = [];
  fakeAnimate();
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => {
  delete proto.animate;
  layers().forEach((l) => l.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the star pop and the confetti (mockup option C, quick)", () => {
  it("a star pop: 5 gold stars from the point, 650ms, the stars' easing; removed when they end", () => {
    starPop({ x: 100, y: 200 });
    expect(layers()).toHaveLength(1);
    expect(layers()[0].parentElement).toBe(document.body);
    expect(layers()[0]).toHaveAttribute("aria-hidden", "true");
    expect(stars()).toHaveLength(5);
    for (const s of stars()) {
      expect((s as HTMLElement).style.left).toBe("100px");
      expect((s as HTMLElement).style.top).toBe("200px");
      const path = s.querySelector("svg path")!;
      expect(path.getAttribute("fill")).toBe("#ecca7d");
      expect(path.getAttribute("stroke")).toBe("#3a412f");
      expect(path.getAttribute("stroke-width")).toBe("1.4");
    }
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      expect(c.options).toEqual({ duration: CELEBRATION_MS, easing: "cubic-bezier(.2,.8,.3,1)" });
      expect(c.frames[0]).toEqual({ transform: "translate(-50%,-50%) scale(.2)", opacity: 0 });
      expect(c.frames[1]).toMatchObject({ opacity: 1, offset: 0.4 });
      expect(c.frames[2]).toMatchObject({ opacity: 0 });
    }
    expect(CELEBRATION_MS).toBe(650);
    calls[0].anim.onfinish!();
    expect(stars()).toHaveLength(4);
    finishAll();
    expect(layers()).toHaveLength(0);
  });

  it("confetti: 40 pieces in the NookPhone colours, in order; 650 to 845ms; the confetti easing; removed when they end", () => {
    confettiBurst({ x: 10, y: 20 });
    expect(bits()).toHaveLength(40);
    [...bits()].forEach((b, i) => {
      // jsdom reports colours as rgb(); compare through a probe element.
      const probe = document.createElement("i");
      probe.style.background = CONFETTI_COLOURS[i % 9];
      expect((b as HTMLElement).style.background).toBe(probe.style.background);
    });
    expect(CONFETTI_COLOURS).toEqual(["#e6aeaf", "#a3d5c2", "#ecca7d", "#9eb4e6", "#b693ec", "#e39876", "#e8dd6e", "#a6ced6", "#98c293"]);
    for (const c of calls) {
      expect(c.options.easing).toBe("cubic-bezier(.2,.7,.3,1)");
      expect(c.options.duration).toBeGreaterThanOrEqual(650);
      expect(c.options.duration).toBeLessThanOrEqual(845);
      expect(c.frames).toHaveLength(3);
      expect(c.frames[1]).toMatchObject({ opacity: 1, offset: 0.55 });
    }
    finishAll();
    expect(layers()).toHaveLength(0);
  });

  it("a cancelled animation cleans up too", () => {
    starPop({ x: 0, y: 0 });
    calls.forEach((c) => c.anim.oncancel?.());
    expect(layers()).toHaveLength(0);
  });

  it("with reduce motion on, nothing is drawn or animated", () => {
    reduceMotion(true);
    starPop({ x: 0, y: 0 });
    confettiBurst({ x: 0, y: 0 });
    expect(layers()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("without the Web Animations API, nothing is drawn", () => {
    delete proto.animate;
    starPop({ x: 0, y: 0 });
    confettiBurst({ x: 0, y: 0 });
    expect(layers()).toHaveLength(0);
  });
});

const TODAY = "2026-10-27"; // a Tuesday
const task = (title: string, extra: Record<string, unknown> = {}) =>
  createItem({ kind: "task", title, areaId: "writing", priority: 1, ...extra }, TODAY);

describe("which moment gets what", () => {
  it("Home's Today: a tick that leaves a to-do gives stars; the tick that leaves none gives confetti instead", async () => {
    await task("First pretend chore");
    await task("Second pretend chore");
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: First pretend chore" }));
    await waitFor(() => expect(stars()).toHaveLength(5));
    expect(bits()).toHaveLength(0);
    expect(await screen.findByTestId("celebration")).toHaveTextContent("Done");
    finishAll();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Second pretend chore" }));
    await waitFor(() => expect(bits()).toHaveLength(40));
    expect(stars()).toHaveLength(0);
    finishAll();
    expect(layers()).toHaveLength(0);
  });

  it("Home's Today: a habit still to do counts as a to-do; ticking it last gives the confetti", async () => {
    await task("Pretend stretch", { recur: ["tue"], priority: 2 });
    await task("Only pretend chore");
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Only pretend chore" }));
    await waitFor(() => expect(stars()).toHaveLength(5));
    expect(bits()).toHaveLength(0);
    finishAll();
    await userEvent.click(screen.getByRole("checkbox", { name: "Mark done: Pretend stretch" }));
    await waitFor(() => expect(bits()).toHaveLength(40));
    expect(stars()).toHaveLength(0);
  });

  it("Home's Today with reduce motion: the tick and the Done status, nothing drawn", async () => {
    reduceMotion(true);
    await task("Quiet pretend chore");
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Quiet pretend chore" }));
    expect(await screen.findByTestId("celebration")).toBeInTheDocument();
    expect(layers()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("Home's Today: a tick that does not save draws nothing", async () => {
    await task("Stubborn pretend chore");
    vi.spyOn(repo, "tickItem").mockRejectedValueOnce(new Error("write failed"));
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Stubborn pretend chore" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    expect(layers()).toHaveLength(0);
  });

  it("an area page: every tick gives stars (never confetti), from where the box was", async () => {
    await task("Pretend draft", { areaId: "body" });
    render(
      <MemoryRouter initialEntries={["/area/body"]}>
        <Routes>
          <Route path="/area/:areaId" element={<AreaPage today={TODAY} />} />
        </Routes>
      </MemoryRouter>,
    );
    const box = await screen.findByRole("checkbox", { name: "Mark done: Pretend draft" });
    vi.spyOn(box, "getBoundingClientRect").mockReturnValue({ left: 40, top: 60, width: 20, height: 20 } as DOMRect);
    await userEvent.click(box);
    await waitFor(() => expect(stars()).toHaveLength(5));
    expect((stars()[0] as HTMLElement).style.left).toBe("50px");
    expect((stars()[0] as HTMLElement).style.top).toBe("70px");
    expect(bits()).toHaveLength(0);
  });

  it("Sort one by one: sorting the last one gives confetti from All sorted; arriving with nothing to sort does not", async () => {
    const show = () =>
      render(
        <MemoryRouter initialEntries={["/inbox/sort"]}>
          <Routes>
            <Route path="/inbox/sort" element={<SortPage today={TODAY} />} />
          </Routes>
        </MemoryRouter>,
      );
    const empty = show();
    expect(await screen.findByText("All sorted")).toBeInTheDocument();
    expect(layers()).toHaveLength(0);
    empty.unmount();

    await createItem({ kind: "task", title: "Last pretend note", areaId: "inbox", priority: 2 }, TODAY);
    show();
    const card = await screen.findByRole("region", { name: "Item to sort" });
    await within(card).findByText("Last pretend note");
    await userEvent.click(within(card).getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("All sorted")).toBeInTheDocument();
    await waitFor(() => expect(bits()).toHaveLength(40));
    expect(stars()).toHaveLength(0);
    expect(screen.getByTestId("celebration")).toHaveTextContent("Done");
  });
});
