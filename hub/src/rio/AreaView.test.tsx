import { act, render, screen, within } from "@testing-library/react";
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
  const doors = () => within(screen.getByRole("navigation", { name: "Ways in and out" }));

  it("shows the outside first; its doors and stairs lead into the rooms, the rooms connect, and back out (no buttons)", async () => {
    render(<AreaView area="lagoa-house" look="day" day={1} placed={[]} onBack={() => undefined} />);
    expect(heading()).toBe("Lagoa house");
    expect(screen.queryByRole("group", { name: "Go inside" })).toBeNull();
    expect(doors().getAllByRole("button").map((b) => b.getAttribute("aria-label")).sort())
      .toEqual(["Back to the map", "Bedroom", "Kitchen", "Living room", "Living room"]);
    await userEvent.click(doors().getByRole("button", { name: "Bedroom" }));
    expect(heading()).toBe("Bedroom");
    expect(document.querySelector(".rio-area")).toHaveAttribute("data-scene", "lagoa-house/bedroom");
    await userEvent.click(doors().getByRole("button", { name: "Living room" }));
    expect(heading()).toBe("Living room");
    await userEvent.click(doors().getByRole("button", { name: "Kitchen" }));
    expect(heading()).toBe("Kitchen");
    await userEvent.click(doors().getByRole("button", { name: "Garden" }));
    expect(heading()).toBe("Lagoa house");
  });

  it("hovering or focusing a door names it in a small tooltip", async () => {
    render(<AreaView area="lagoa-house" look="day" day={1} placed={[]} onBack={() => undefined} />);
    await userEvent.hover(doors().getByRole("button", { name: "Kitchen" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Kitchen");
    await userEvent.unhover(doors().getByRole("button", { name: "Kitchen" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => doors().getAllByRole("button", { name: "Living room" })[0]!.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Living room");
  });

  it("a door to a place that isn't open yet isn't there; stepping into another area's scene counts as a visit", async () => {
    const onVisit = vi.fn();
    const shut = render(<AreaView area="ipanema-beach" look="day" day={30} placed={[]} onBack={() => undefined} canEnter={(s) => s !== "barraca/inside"} />);
    expect(doors().queryByRole("button", { name: "Barraca" })).toBeNull();
    shut.unmount();
    render(<AreaView area="ipanema-beach" look="day" day={30} placed={[]} onBack={() => undefined} onVisit={onVisit} />);
    await userEvent.click(doors().getByRole("button", { name: "Barraca" }));
    expect(document.querySelector(".rio-area")).toHaveAttribute("data-scene", "barraca/inside");
    expect(onVisit).toHaveBeenCalledWith("barraca");
  });

  it("the beach noticeboard opens the menu's Noticeboard; the store's fitting room, the Wardrobe", async () => {
    const onOpenMenu = vi.fn();
    const r = render(<AreaView area="ipanema-beach" look="day" day={30} placed={[]} onBack={() => undefined} onOpenMenu={onOpenMenu} />);
    await userEvent.click(doors().getByRole("button", { name: "Noticeboard" }));
    expect(onOpenMenu).toHaveBeenLastCalledWith("noticeboard");
    r.unmount();
    render(<AreaView area="clothing-store" look="day" day={30} placed={[]} onBack={() => undefined} onOpenMenu={onOpenMenu} />);
    await userEvent.click(doors().getByRole("button", { name: "Shop door" }));
    await userEvent.click(doors().getByRole("button", { name: "Fitting room" }));
    expect(onOpenMenu).toHaveBeenLastCalledWith("wardrobe");
  });

  it("Ipanema beach: no way into the sea before day 30; on day 30 it's a button away (Esme, 2026-11-16)", async () => {
    const { unmount } = render(<AreaView area="ipanema-beach" look="day" day={29} placed={[]} onBack={() => undefined} />);
    expect(doors().queryByRole("button", { name: "Swim out to Arpoador" })).toBeNull();
    unmount();
    render(<AreaView area="ipanema-beach" look="day" day={30} placed={[]} onBack={() => undefined} />);
    await userEvent.click(doors().getByRole("button", { name: "Swim out to Arpoador" }));
    expect(document.querySelector(".rio-area")).toHaveAttribute("data-scene", "ipanema-beach/sea");
  });

  it("the fazenda: its barn, coop and greenhouse wait for their insides; the boat is the way back to the map", async () => {
    const onBack = vi.fn();
    render(<AreaView area="fazenda" look="night" day={1} placed={[]} onBack={onBack} />);
    expect(doors().getAllByRole("button")).toHaveLength(1);
    await userEvent.click(doors().getByRole("button", { name: "Boat back to Rio" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("hovering a placed sticker names it and says what it's for, beside it (never over it)", async () => {
    render(<AreaView area="fazenda" look="day" day={1} placed={["seeds-mind"]} onBack={() => undefined} />);
    const sticker = document.querySelector<HTMLElement>('.rio-sticker[data-sticker="seeds-mind"]')!;
    expect(sticker).not.toBeNull();
    await userEvent.hover(sticker);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Mind: seeds");
    expect(tip).toHaveTextContent("1 to-do ticked off in Mind");
    const side = tip.getAttribute("data-side");
    expect(["right", "left"]).toContain(side);
    const s = { left: parseFloat(sticker.style.left), width: parseFloat(sticker.style.width) };
    const t = parseFloat(tip.style.left);
    if (side === "right") expect(t).toBeGreaterThan(s.left + s.width);
    else expect(t).toBeLessThan(s.left);
    await userEvent.unhover(sticker);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("names every sticker drawn, and says how many more wait in the book", () => {
    const beds = COLLECTION.filter((s) => s.group === "beds");
    render(<AreaView area="fazenda" look="day" day={1} placed={beds.map((s) => s.key)} onBack={() => undefined} />);
    const shown = layout("fazenda/outside", beds.map((s) => s.key)).bySlot.size;
    const list = screen.getByRole("list", { name: "Stickers here" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(shown);
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(beds[0]!.name);
    expect(screen.getByText(`${beds.length - shown} more in your collection`)).toBeInTheDocument();
    expect(document.querySelector(".rio-area")).toHaveAttribute("data-state", "full");
  });

  it("no overflow line when everything fits", () => {
    render(<AreaView area="fazenda" look="day" day={1} placed={["seeds-mind"]} onBack={() => undefined} />);
    expect(screen.queryByText(/more in your collection/)).toBeNull();
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

describe("phase 2a: the new areas", () => {
  const counts = (c: Partial<{ monthlyGoals: number; wholeGoals: number; readingBooks: number; recipes: number; weeklyReviews: number }>) =>
    ({ monthlyGoals: 0, wholeGoals: 0, readingBooks: 0, recipes: 0, weeklyReviews: 0, ...c });
  const area = () => document.querySelector(".rio-area")!;

  it("each opens outside, with its inside a button away", async () => {
    const names: Record<string, [string, string]> = {
      "zona-sul": ["Zona Sul", "Zona Sul sliding doors"], "jardim-botanico": ["Jardim Botânico", "Orchid house doors"], quilo: ["Quilo", "Quilo door"],
      sult: ["Sult", "Sult door"], "os-esquilos": ["Os Esquilos", "Blue doors"], "santa-teresa": ["Santa Teresa", "Casarao door"],
    };
    for (const [key, [out, inside]] of Object.entries(names)) {
      const { unmount } = render(<AreaView area={key} look="night" day={200} placed={[]} onBack={() => undefined} />);
      expect(heading()).toBe(out);
      await userEvent.click(screen.getByRole("button", { name: inside }));
      expect(area()).toHaveAttribute("data-scene", `${key}/inside`);
      unmount();
    }
  });

  it("Os Esquilos lays a celebration piece per whole goal, over its quiet start", () => {
    render(<AreaView area="os-esquilos" look="day" day={200} placed={[]} counts={counts({ wholeGoals: 3 })} onBack={() => undefined} />);
    expect(area()).toHaveAttribute("data-celebrations", "3");
    expect(area()).toHaveAttribute("data-state", "start");
  });

  it("Santa Teresa's studio shows its milestones and books", async () => {
    render(<AreaView area="santa-teresa" look="rain" day={200} placed={[]} counts={counts({ readingBooks: 10 })} onBack={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Casarao door" }));
    expect(area()).toHaveAttribute("data-milestones", "reading-lamp second-bookcase rug");
    expect(area()).toHaveAttribute("data-books", "10");
  });

  it("Sult is full at seven monthly goals; the Jardim starts quiet", () => {
    const { unmount } = render(<AreaView area="sult" look="day" day={200} placed={[]} counts={counts({ monthlyGoals: 7 })} onBack={() => undefined} />);
    expect(area()).toHaveAttribute("data-state", "full");
    unmount();
    render(<AreaView area="jardim-botanico" look="day" day={200} placed={[]} onBack={() => undefined} />);
    expect(area()).toHaveAttribute("data-state", "start");
  });

  it("orchard trees are named among the Jardim's stickers", () => {
    render(<AreaView area="jardim-botanico" look="day" day={200} placed={["sapling", "orchid"]} onBack={() => undefined} />);
    expect(within(screen.getByRole("list", { name: "Stickers here" })).getByText("Sapling")).toBeInTheDocument();
  });

  it("a themed night (dev preview) shows at the boteco at night only, and stays still with reduced motion", () => {
    const { unmount } = render(<AreaView area="boteco" look="night" day={200} placed={[]} night="samba" onBack={() => undefined} />);
    expect(area()).toHaveAttribute("data-night", "samba");
    expect(useTicker.mock.calls.some(([, on]) => on === true)).toBe(true);
    unmount();
    useTicker.mockClear();
    useReducedMotion.mockReturnValue(true);
    const r = render(<AreaView area="boteco" look="night" day={200} placed={[]} night="samba" onBack={() => undefined} />);
    expect(useTicker.mock.calls.every(([, on]) => on === false)).toBe(true);
    r.unmount();
    render(<AreaView area="boteco" look="day" day={200} placed={[]} night="samba" onBack={() => undefined} />);
    expect(area()).not.toHaveAttribute("data-night");
  });
});

it("Esme swims in the sea off Arpoador (day 30), still with reduced motion", async () => {
  render(<AreaView area="ipanema-beach" look="day" day={30} placed={[]} onBack={() => undefined} />);
  await userEvent.click(screen.getByRole("button", { name: "Swim out to Arpoador" }));
  expect(document.querySelector(".rio-area")).toHaveAttribute("data-player", "esme");
});

it("the goal moment plays in the stands at a full match only when asked (dev preview)", async () => {
  const full = { monthlyGoals: 0, wholeGoals: 0, readingBooks: 0, recipes: 0, weeklyReviews: 4 };
  const { unmount } = render(<AreaView area="flamengo-match" look="night" day={60} placed={[]} counts={full} goal onBack={() => undefined} />);
  expect(document.querySelector(".rio-area")).not.toHaveAttribute("data-goal"); // outside: no goal art
  await userEvent.click(screen.getByRole("button", { name: "Stadium gates" }));
  expect(document.querySelector(".rio-area")).toHaveAttribute("data-goal", "true");
  unmount();
  render(<AreaView area="flamengo-match" look="night" day={60} placed={[]} goal onBack={() => undefined} />);
  await userEvent.click(screen.getByRole("button", { name: "Stadium gates" }));
  expect(document.querySelector(".rio-area")).not.toHaveAttribute("data-goal"); // start: the goal is drawn for the full stands
});
