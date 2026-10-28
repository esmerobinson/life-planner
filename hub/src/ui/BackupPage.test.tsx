import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { AppShell } from "./AppShell";
import { BackupPage } from "./BackupPage";
import { ShellContext } from "./shellContext";

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
    expect(await screen.findByRole("alert")).toHaveTextContent(/not an Esmeworld backup/i);
    expect(await db.items.count()).toBe(1);
  });
});

describe("Import from a file (moved here from the Inbox)", () => {
  const BACKLOG = "- [ ] Water the ferns #home\n- [ ] Email Sam !p1\n- [ ] Call mum [due 2026-11-01]\n";

  it("is a collapsed section at the bottom of the page holding both import panels", () => {
    render(<BackupPage today="2026-10-28" />);
    const summary = screen.getByText("Import from a file", { selector: "summary" });
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByLabelText("Backlog text")).toBeInTheDocument();
    expect(within(details).getByLabelText("Google Tasks text")).toBeInTheDocument();
    const all = Array.from(document.querySelector(".backup-page")!.children);
    expect(all[all.length - 1]).toBe(details);
  });

  it("the Backlog import still shows counts, and repeating is safe", async () => {
    render(<BackupPage today="2026-10-28" />);
    await userEvent.click(screen.getByLabelText("Backlog text"));
    await userEvent.paste(BACKLOG);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Added 3, already had 0, notes 0")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Added 0, already had 3, notes 0")).toBeInTheDocument();
    expect(await db.items.count()).toBe(3);
  });

  it("Backlog notes are listed under a collapsed Notes (K) section", async () => {
    render(<BackupPage today="2026-10-28" />);
    await userEvent.click(screen.getByLabelText("Backlog text"));
    await userEvent.paste("- [ ] Pay rent [due 2026-13-45]\n- [ ] Odd one !p7\n");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Added 2, already had 0, notes 2")).toBeInTheDocument();
    const details = screen.getByText("Notes (2)", { selector: "summary" }).closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getAllByRole("listitem", { hidden: true }).map((li) => li.textContent)).toEqual([
      "invalid due date 2026-13-45, imported without due: - [ ] Pay rent [due 2026-13-45]",
      "unknown priority !p7, defaulted to 2: - [ ] Odd one !p7",
    ]);
  });

  it("gives a short message for empty text, and double-clicking imports once", async () => {
    render(<BackupPage today="2026-10-28" />);
    const btn = screen.getByRole("button", { name: "Import" });
    await userEvent.click(btn);
    expect(screen.getByText("Paste some text or choose a file first.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Backlog text"));
    await userEvent.paste(BACKLOG);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(await screen.findByText("Added 3, already had 0, notes 0")).toBeInTheDocument();
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(await db.items.count()).toBe(3);
  });
});

describe("shell", () => {
  it("Backup link is always visible in the shell and the sidebar still has exactly thirteen items", () => {
    vi.stubGlobal("navigator", {});
    render(
      <MemoryRouter initialEntries={["/x"]}>
        <Routes><Route element={<AppShell />}><Route path="/x" element={<p>x</p>} /></Route></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Backup" })).toHaveAttribute("href", "/backup");
    expect(within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link")).toHaveLength(13);
  });
});

describe("BackupPage extras", () => {
  it("explains the localhost:5173 address", () => {
    render(<BackupPage today="2026-10-28" />);
    expect(
      screen.getByText(
        "If you used localhost:5173 before, that is a different address with its own saved data. Open it, download a backup there, then restore it here with Merge.",
      ),
    ).toBeInTheDocument();
  });

  it("revokes the download URL only after a delay, and says 'Backup file made.'", async () => {
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(<BackupPage today="2026-10-28" />);
      fireEvent.click(screen.getByRole("button", { name: "Download backup" }));
      await vi.waitFor(() => expect(click).toHaveBeenCalled());
      expect(revoke).not.toHaveBeenCalled();
      expect(screen.getByText("Backup file made.")).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(60000);
      expect(revoke).toHaveBeenCalledWith("blob:x");
    } finally {
      vi.useRealTimers();
      click.mockRestore();
    }
  });

  it("un-ticks the confirmation when the mode changes", async () => {
    const user = userEvent.setup();
    render(<BackupPage today="2026-10-28" />);
    await user.click(screen.getByRole("radio", { name: "Replace everything" }));
    await user.click(screen.getByRole("checkbox", { name: /replace/i }));
    expect(screen.getByRole("checkbox", { name: /replace/i })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /Merge/ }));
    await user.click(screen.getByRole("radio", { name: "Replace everything" }));
    expect(screen.getByRole("checkbox", { name: /replace/i })).not.toBeChecked();
  });

  it("a refresh failure after a successful restore does not say nothing was changed", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn().mockRejectedValue(new Error("refresh"));
    render(
      <ShellContext.Provider value={{ refresh, version: 0, today: "2026-10-28" }}>
        <BackupPage today="2026-10-28" />
      </ShellContext.Provider>,
    );
    await user.upload(screen.getByLabelText("Backup file"), fileOf(backup));
    await user.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByText(/Added 1 task/)).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText(/Nothing was changed/)).not.toBeInTheDocument();
    expect(await db.items.count()).toBe(1);
  });

  it("merge counts an existing goal as skipped and leaves it unchanged", async () => {
    const user = userEvent.setup();
    const g = { id: "g1", title: "Mine", areaId: "art", kind: "finite", milestones: [], createdAt: "2026-10-01" };
    await db.goals.add(g as never);
    render(<BackupPage today="2026-10-28" />);
    await user.upload(
      screen.getByLabelText("Backup file"),
      fileOf({ ...backup, items: [], goals: [{ ...g, title: "Changed" }] }),
    );
    await user.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByText(/Added 0 tasks and 0 goals. 1 already here./)).toBeInTheDocument();
    expect((await db.goals.get("g1"))?.title).toBe("Mine");
  });
});
