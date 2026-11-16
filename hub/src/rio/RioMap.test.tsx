import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { areaStatuses } from "./areas";
import { RioMap } from "./RioMap";

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
