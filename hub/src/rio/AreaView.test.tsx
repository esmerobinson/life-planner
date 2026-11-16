import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { COLLECTION } from "../farm/catalogue";
import * as hooks from "../farm/hooks";
import { layout } from "./placement";
import { AreaView } from "./AreaView";

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

const heading = () => screen.getByRole("heading", { level: 2 }).textContent;

describe("an area, outside and inside", () => {
  it("shows the outside first, with a button for each inside; pressing one goes in", async () => {
    render(<AreaView area="lagoa-house" look="day" day={1} placed={[]} onBack={() => undefined} />);
    expect(heading()).toBe("Lagoa house");
    const insides = within(screen.getByRole("group", { name: "Go inside" })).getAllByRole("button");
    expect(insides.map((b) => b.textContent)).toEqual(["Living room", "Bedroom", "Kitchen"]);
    await userEvent.click(screen.getByRole("button", { name: "Bedroom" }));
    expect(heading()).toBe("Bedroom");
    expect(document.querySelector(".rio-area")).toHaveAttribute("data-scene", "lagoa-house/bedroom");
    await userEvent.click(screen.getByRole("button", { name: "Outside" }));
    expect(heading()).toBe("Lagoa house");
  });

  it("Ipanema beach: no way into the sea before day 30; on day 30 it's a button away (Esme, 2026-11-16)", async () => {
    const { unmount } = render(<AreaView area="ipanema-beach" look="day" day={29} placed={[]} onBack={() => undefined} />);
    expect(screen.queryByRole("group", { name: "Go inside" })).toBeNull();
    expect(screen.queryByRole("button", { name: "The sea off Arpoador" })).toBeNull();
    unmount();
    render(<AreaView area="ipanema-beach" look="day" day={30} placed={[]} onBack={() => undefined} />);
    await userEvent.click(within(screen.getByRole("group", { name: "Go inside" })).getByRole("button", { name: "The sea off Arpoador" }));
    expect(document.querySelector(".rio-area")).toHaveAttribute("data-scene", "ipanema-beach/sea");
  });

  it("the fazenda has no inside yet", () => {
    render(<AreaView area="fazenda" look="day" day={1} placed={[]} onBack={() => undefined} />);
    expect(screen.queryByRole("group", { name: "Go inside" })).toBeNull();
  });

  it("Back to the map", async () => {
    const onBack = vi.fn();
    render(<AreaView area="fazenda" look="night" day={1} placed={[]} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to the map" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("names every sticker drawn, and says how many more wait in the book", () => {
    const beds = COLLECTION.filter((s) => s.group === "beds");
    render(<AreaView area="fazenda" look="day" day={1} placed={beds.map((s) => s.key)} onBack={() => undefined} />);
    const shown = layout("fazenda/outside", beds.map((s) => s.key)).bySlot.size;
    const list = screen.getByRole("list", { name: "Stickers here" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(shown);
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(beds[0]!.name);
    expect(screen.getByText(`${beds.length - shown} more in your sticker book`)).toBeInTheDocument();
    expect(document.querySelector(".rio-area")).toHaveAttribute("data-state", "full");
  });

  it("no overflow line when everything fits", () => {
    render(<AreaView area="fazenda" look="day" day={1} placed={["seeds-mind"]} onBack={() => undefined} />);
    expect(screen.queryByText(/more in your sticker book/)).toBeNull();
    expect(document.querySelector(".rio-area")).toHaveAttribute("data-state", "start");
  });

  it("in the rain, the falling rain animates; with reduced motion, no animation timer starts", () => {
    const { unmount } = render(<AreaView area="lagoa-house" look="rain" day={1} placed={[]} onBack={() => undefined} />);
    expect(useTicker.mock.calls.some(([, on]) => on === true)).toBe(true);
    unmount();
    useTicker.mockClear();
    useReducedMotion.mockReturnValue(true);
    render(<AreaView area="lagoa-house" look="rain" day={1} placed={[]} onBack={() => undefined} />);
    expect(useTicker.mock.calls.length).toBeGreaterThan(0);
    expect(useTicker.mock.calls.every(([, on]) => on === false)).toBe(true);
  });

  it("on a sunny day nothing animates", () => {
    render(<AreaView area="lagoa-house" look="day" day={1} placed={[]} onBack={() => undefined} />);
    expect(useTicker.mock.calls.every(([, on]) => on === false)).toBe(true);
  });
});
