import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { AppShell } from "./AppShell";
import { BackupPage } from "./BackupPage";
import { NAV } from "./areas";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.unstubAllGlobals());

const backup = {
  app: "life-hub", schema: 1, exportedOn: "2026-10-28",
  items: [{ id: "new", kind: "task", title: "From file", links: [], areaId: "art", priority: 2,
    status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01" }],
  goals: [],
};
const fileOf = (o: unknown) => new File([typeof o === "string" ? o : JSON.stringify(o)], "b.json", { type: "application/json" });

describe("BackupPage", () => {
  it("BackupPage shows the saved-in-this-browser-only line", async () => {
    vi.stubGlobal("navigator", { storage: { persist: async () => true } });
    render(<BackupPage today="2026-10-28" />);
    expect(screen.getByText("Your tasks are saved in this browser only.")).toBeInTheDocument();
    expect(await screen.findByText("Your browser has agreed to keep this data.")).toBeInTheDocument();
  });

  it("replace needs the confirmation checkbox; without it nothing changes", async () => {
    const user = userEvent.setup();
    await db.items.add({ ...backup.items[0], id: "old", title: "Old" } as never);
    render(<BackupPage today="2026-10-28" />);
    await user.upload(screen.getByLabelText("Backup file"), fileOf(backup));
    await user.click(screen.getByRole("radio", { name: "Replace everything" }));
    expect(screen.getByText("Download a backup first.")).toBeInTheDocument();
    const go = screen.getByRole("button", { name: "Replace" });
    expect(go).toBeDisabled();
    await user.click(go);
    expect((await db.items.toArray()).map((i) => i.id)).toEqual(["old"]);
    await user.click(screen.getByRole("checkbox", { name: /replace/i }));
    expect(go).toBeEnabled();
    await user.click(go);
    await waitFor(async () => expect((await db.items.toArray()).map((i) => i.id)).toEqual(["new"]));
  });

  it("merge shows counts; a bad file shows one calm message", async () => {
    const user = userEvent.setup();
    render(<BackupPage today="2026-10-28" />);
    await user.upload(screen.getByLabelText("Backup file"), fileOf(backup));
    await user.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByText(/Added 1 task/)).toBeInTheDocument();
    await user.upload(screen.getByLabelText("Backup file"), fileOf("{oops"));
    await user.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not a Life Hub backup/i);
    expect(await db.items.count()).toBe(1);
  });
});

describe("shell", () => {
  it("Backup link is always visible in the shell and the sidebar still has exactly ten items", () => {
    vi.stubGlobal("navigator", {});
    render(
      <MemoryRouter initialEntries={["/x"]}>
        <Routes><Route element={<AppShell />}><Route path="/x" element={<p>x</p>} /></Route></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Backup" })).toHaveAttribute("href", "/backup");
    expect(NAV).toHaveLength(10);
  });
});
