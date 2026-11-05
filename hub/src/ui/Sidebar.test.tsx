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
  it("lists the thirteen entries in order (no Today: Home is the Today page)", () => {
    renderAt("/");
    const labels = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link").map((a) => a.textContent?.trim());
    expect(labels).toEqual([
      "Home", "Goals", "Admin", "Mind", "Writing", "Art", "Content", "Body",
      "Tech projects", "Production", "Journal", "Vision board", "Esme's Farm",
    ]);
  });

  it("has no Today link (Esme, 2026-11-04: Home is the Today page)", () => {
    renderAt("/");
    expect(screen.queryByRole("link", { name: "Today" })).toBeNull();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  });

  it("marks only the active route with aria-current=page", () => {
    renderAt("/area/art");
    expect(screen.getByRole("link", { name: "Art" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("separates the entries into three named groups", () => {
    renderAt("/");
    const groups = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("group");
    expect(groups).toHaveLength(3);
    expect(within(groups[0]).getAllByRole("link")).toHaveLength(3);
    expect(within(groups[1]).getAllByRole("link")).toHaveLength(7);
    expect(within(groups[2]).getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("group", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Reflect" })).toBeInTheDocument();
  });

  it("has a quiet Backup link in the footer, outside the twelve navigation items", () => {
    renderAt("/backup");
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(within(main).queryByRole("link", { name: "Backup" })).toBeNull();
    const link = screen.getByRole("link", { name: "Backup" });
    expect(link).toHaveAttribute("href", "/backup");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.closest(".sidebar-footer")).not.toBeNull();
    expect(link.closest(".sidebar")).not.toBeNull();
    expect(link.querySelector("img")).toBeNull();
  });
});
