import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import type { Item } from "../../domain/types";
import { FILES_HANDLER } from "../../native/files";
import { renderApp } from "../../test/renderApp";

// The "What I did" log (Esme, 19 Nov 2026): by week (Monday to Sunday), newest first, filter by
// area. Made-up to-dos only.

const TODAY = "2026-11-19";
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "writing", priority: 2, status: "done",
  completedAt: "2026-11-18", createdAt: "2026-11-01", touchedAt: "2026-11-01", ...extra,
});

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear(), db.syncMeta.clear()]);
  delete (window as unknown as { webkit?: unknown }).webkit;
});
afterEach(() => vi.useRealTimers());

async function seed() {
  await db.items.bulkPut([
    todo("chapter", { did: [{ id: "e1", on: "2026-11-18", note: "Pretend wrote the ending", files: [{ name: "ending.docx", folder: "~/Desktop/Writing" }] }] }),
    todo("tax", { areaId: "admin", did: [{ id: "e2", on: "2026-11-10", note: "Pretend filed it" }] }),
    todo("zine", {
      areaId: "art", status: "open", completedAt: undefined, sessions: [{ id: "s1", doneOn: "2026-11-17" }, { id: "s2" }],
      did: [{ id: "e3", on: "2026-11-17", session: "s1", note: "Pretend sketches" }],
    }),
  ]);
}

it("the footer link opens it; weeks newest first, each entry with its date, to-do, area, project, note and files", async () => {
  await seed();
  renderApp("/", TODAY);
  await userEvent.click(within(document.querySelector(".sidebar-footer") as HTMLElement).getByRole("link", { name: "What I did" }));
  expect(await screen.findByRole("heading", { level: 1, name: "What I did" })).toBeInTheDocument();
  const weeks = await screen.findAllByRole("region", { name: /^Week of/ });
  expect(weeks.map((w) => w.getAttribute("aria-label"))).toEqual(["Week of 16 Nov – 22 Nov", "Week of 9 Nov – 15 Nov"]);
  const first = within(weeks[0]!).getAllByRole("listitem").filter((li) => li.classList.contains("did-entry"));
  expect(first).toHaveLength(2);
  expect(first[0]).toHaveTextContent("Wed 18 Nov");
  expect(first[0]).toHaveTextContent("Pretend chapter");
  expect(first[0]).toHaveTextContent("Writing");
  expect(first[0]).toHaveTextContent("Pretend wrote the ending");
  expect(first[0]).toHaveTextContent("ending.docx");
  expect(first[1]).toHaveTextContent("Session 1");
  expect(first[1]).toHaveTextContent("Project: Pretend zine");
  expect(first[1]).toHaveTextContent("Art");
  expect(within(weeks[1]!).getByText("Pretend filed it")).toBeInTheDocument();
});

it("filter by area", async () => {
  await seed();
  renderApp("/what-i-did", TODAY);
  const filter = await screen.findByRole("group", { name: "Area" });
  await userEvent.click(within(filter).getByRole("button", { name: "Admin" }));
  expect(within(filter).getByRole("button", { name: "Admin" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Pretend filed it")).toBeInTheDocument();
  expect(screen.queryByText("Pretend wrote the ending")).toBeNull();
  await userEvent.click(within(filter).getByRole("button", { name: "All" }));
  expect(screen.getByText("Pretend wrote the ending")).toBeInTheDocument();
});

it("empty: a kind line, no filter", async () => {
  renderApp("/what-i-did", TODAY);
  expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Area" })).toBeNull();
});

it("opened from search: that entry is marked", async () => {
  await seed();
  renderApp("/what-i-did?entry=tax:e2", TODAY);
  await waitFor(() => expect(document.getElementById("did-tax:e2")).toHaveClass("is-target"));
});

it("the folder setting shows only in the Mac app, and changes through the Mac's folder picker", async () => {
  const first = renderApp("/what-i-did", TODAY);
  await screen.findByText(/Nothing here yet/);
  expect(screen.queryByRole("region", { name: "Where files go" })).toBeNull();
  first.unmount();
  vi.useRealTimers();
  (window as unknown as { webkit: unknown }).webkit = {
    messageHandlers: { [FILES_HANDLER]: { postMessage: async () => ({ root: "~/Documents/Pretend work" }) } },
  };
  renderApp("/what-i-did", TODAY);
  const setting = await screen.findByRole("region", { name: "Where files go" });
  expect(await within(setting).findByText(/~\/Desktop/)).toBeInTheDocument();
  await userEvent.click(within(setting).getByRole("button", { name: "Choose folder…" }));
  expect(await within(setting).findByText(/~\/Documents\/Pretend work/)).toBeInTheDocument();
  expect((await db.syncMeta.get("whatIDidRoot"))!.value).toBe("~/Documents/Pretend work");
  await userEvent.click(within(setting).getByRole("button", { name: "Use the Desktop" }));
  expect(await within(setting).findByText(/~\/Desktop/)).toBeInTheDocument();
});
