import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("lists the thirteen entries in order", () => {
    renderAt("/");
    const labels = screen.getAllByRole("link").map((a) => a.textContent?.trim());
    expect(labels).toEqual([
      "Home", "Today", "Goals", "Writing", "Art", "Content", "Mind", "Body",
      "Tech projects", "Production", "Admin", "Journal", "Vision board",
    ]);
  });

  it("links Today to /today", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("href", "/today");
  });

  it("marks only the active route with aria-current=page", () => {
    renderAt("/area/art");
    expect(screen.getByRole("link", { name: "Art" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("separates the entries into three named groups", () => {
    renderAt("/");
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(3);
    expect(within(groups[0]).getAllByRole("link")).toHaveLength(3);
    expect(within(groups[1]).getAllByRole("link")).toHaveLength(8);
    expect(within(groups[2]).getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Reflect" })).toBeInTheDocument();
  });
});
