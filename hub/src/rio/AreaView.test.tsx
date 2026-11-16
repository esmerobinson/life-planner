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
  const counts = (c: Partial<{ monthlyGoals: number; wholeGoals: number; readingBooks: number; recipes: number }>) =>
    ({ monthlyGoals: 0, wholeGoals: 0, readingBooks: 0, recipes: 0, ...c });
  const area = () => document.querySelector(".rio-area")!;

  it("each opens outside, with its inside a button away", async () => {
    const names: Record<string, [string, string]> = {
      "zona-sul": ["Zona Sul", "The aisles"], "jardim-botanico": ["Jardim Botânico", "The orchid house"], quilo: ["Quilo", "The buffet"],
      sult: ["Sult", "The dining room"], "os-esquilos": ["Os Esquilos", "The dining room"], "santa-teresa": ["Santa Teresa", "The studio"],
    };
    for (const [key, [out, inside]] of Object.entries(names)) {
      const { unmount } = render(<AreaView area={key} look="night" day={200} placed={[]} onBack={() => undefined} />);
      expect(heading()).toBe(out);
      await userEvent.click(within(screen.getByRole("group", { name: "Go inside" })).getByRole("button", { name: inside }));
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
    await userEvent.click(screen.getByRole("button", { name: "The studio" }));
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
