import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as hooks from "../farm/hooks";
import { areaStatuses } from "./areas";
import { RioMap } from "./RioMap";

vi.mock("../farm/hooks", async (orig) => {
  const real = await orig<typeof import("../farm/hooks")>();
  return { ...real, useTicker: vi.fn(() => 0), useReducedMotion: vi.fn(() => false) };
});
const useTicker = vi.mocked(hooks.useTicker);
const useReducedMotion = vi.mocked(hooks.useReducedMotion);
beforeEach(() => {
  useTicker.mockClear();
  useReducedMotion.mockReturnValue(false);
});

const day1 = areaStatuses(1, new Set());

describe("the map", () => {
  it("a hidden list mirrors the canvas: one button per place", () => {
    render(<RioMap statuses={day1} look="day" onOpen={() => undefined} />);
    const list = screen.getByRole("list", { name: "Places in Rio" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(21);
    expect(buttons.map((b) => b.textContent)).toContain("Fazenda");
    expect(document.querySelector(".rio-map")).toHaveAttribute("data-look", "day");
  });

  it("pressing an open place opens it", async () => {
    const onOpen = vi.fn();
    render(<RioMap statuses={day1} look="day" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Lagoa house" }));
    expect(onOpen).toHaveBeenCalledWith("lagoa-house");
  });

  it("pressing the next place says when it opens, and doesn't open it", async () => {
    const onOpen = vi.fn();
    render(<RioMap statuses={day1} look="day" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Barraca" }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Opens on day 3");
  });

  it("a place with no art yet is coming soon", async () => {
    render(<RioMap statuses={day1} look="night" onOpen={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Zona Sul" }));
    expect(screen.getByRole("status")).toHaveTextContent("Coming soon");
  });

  it("each place's state is on its button (new, open, next, locked)", () => {
    render(<RioMap statuses={areaStatuses(3, new Set(["lagoa-house"]))} look="day" onOpen={() => undefined} />);
    expect(screen.getByRole("button", { name: "Lagoa house" })).toHaveAttribute("data-status", "open");
    expect(screen.getByRole("button", { name: "Barraca" })).toHaveAttribute("data-status", "new");
    expect(screen.getByRole("button", { name: "Clothing store" })).toHaveAttribute("data-status", "next");
    expect(screen.getByRole("button", { name: "Museum" })).toHaveAttribute("data-status", "locked");
  });
});

describe("the map in the rain", () => {
  it("the falling rain plays in the rain, not on a dry day, and never with reduced motion", () => {
    const a = render(<RioMap statuses={day1} look="rain" onOpen={() => undefined} />);
    expect(document.querySelector(".rio-map")).toHaveAttribute("data-look", "rain");
    expect(useTicker.mock.calls.some(([ms, on]) => on === true && ms === 110)).toBe(true);
    a.unmount();
    useTicker.mockClear();
    const b = render(<RioMap statuses={day1} look="day" onOpen={() => undefined} />);
    expect(useTicker.mock.calls.every(([, on]) => on === false)).toBe(true);
    b.unmount();
    useTicker.mockClear();
    useReducedMotion.mockReturnValue(true);
    render(<RioMap statuses={day1} look="rain" onOpen={() => undefined} />);
    expect(useTicker.mock.calls.length).toBeGreaterThan(0);
    expect(useTicker.mock.calls.every(([, on]) => on === false)).toBe(true);
  });
});

describe("holiday takeovers on the map", () => {
  it("Carnaval dresses the whole city, locked places too; none in March", () => {
    const { unmount } = render(<RioMap statuses={day1} look="day" now={new Date("2027-02-10T15:00:00Z")} onOpen={() => undefined} />);
    expect(document.querySelector(".rio-map")).toHaveAttribute("data-event", "carnaval");
    unmount();
    render(<RioMap statuses={day1} look="day" now={new Date("2027-03-10T15:00:00Z")} onOpen={() => undefined} />);
    expect(document.querySelector(".rio-map")).not.toHaveAttribute("data-event");
  });

  it("Réveillon's fireworks play at night, and not with reduced motion", () => {
    const nye = new Date("2027-01-01T01:00:00Z"); // 22:00 on 31 Dec in Rio
    const { unmount } = render(<RioMap statuses={day1} look="night" now={nye} onOpen={() => undefined} />);
    expect(document.querySelector(".rio-map")).toHaveAttribute("data-event", "reveillon");
    expect(useTicker.mock.calls.some(([, on]) => on === true)).toBe(true);
    unmount();
    useTicker.mockClear();
    useReducedMotion.mockReturnValue(true);
    render(<RioMap statuses={day1} look="night" now={nye} onOpen={() => undefined} />);
    expect(useTicker.mock.calls.every(([, on]) => on === false)).toBe(true);
  });
});
