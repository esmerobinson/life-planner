import { screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createBook, createGoal, createItem, ensureCheckinSet, finishMorningPage, saveAnswer } from "../data/repo";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { JOURNAL_CANDIDATE_META, JOURNAL_KEY_META } from "../journal/keyStore";
import { currentUrl, renderApp } from "../test/renderApp";

// ⌘K search (option 3A): a pop-up over any page; on the phone the 🔍 in the top bar opens it
// full screen. Fictional data only.
const TODAY = "2026-11-04";

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear(), db.journal.clear(), db.syncMeta.clear(), db.pending.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function pretend() {
  const todo = await createItem({ kind: "task", title: "Draw the pretend market stall", areaId: "art", priority: 2 }, "2026-10-01");
  await createItem({ kind: "idea", title: "Pretend market zine", areaId: "content", priority: 2 }, "2026-10-01");
  await createBook({ title: "Night Pretend Bazaar", author: "Lena Market", bookStatus: "want" }, "2026-10-01");
  const goal = await createGoal({ title: "Sell pretend prints at the market", areaId: "art", kind: "practice" }, "2026-10-01");
  await createItem(
    { kind: "task", title: "Blender pretend project", areaId: "art", priority: 2, notes: "Reference folder: market photos" },
    "2026-10-01",
  );
  return { todo, goal };
}

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document, { key, ...init });

async function openSearch() {
  press("k", { ctrlKey: true });
  return screen.findByRole("dialog", { name: "Search" });
}

describe("⌘K search", () => {
  it("Ctrl+K opens it on any page; Escape closes it and gives focus back", async () => {
    renderApp("/area/art", TODAY);
    const before = await screen.findByRole("button", { name: "Add" });
    before.focus();
    const dialog = await openSearch();
    expect(within(dialog).getByRole("combobox", { name: "Search" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    expect(before).toHaveFocus();
  });

  it("⌘K (Command) opens it on a Mac", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    renderApp("/", TODAY);
    await screen.findByRole("button", { name: "Add" });
    press("k", { metaKey: true });
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("results are grouped by type with the matching words in bold", async () => {
    await pretend();
    renderApp("/", TODAY);
    const dialog = within(await openSearch());
    await userEvent.type(dialog.getByRole("combobox", { name: "Search" }), "market");
    const todos = await dialog.findByRole("group", { name: "To-dos" });
    expect(within(todos).getByRole("option", { name: /Draw the pretend market stall/ })).toBeInTheDocument();
    expect(within(todos).getByText("market", { selector: "mark" })).toBeInTheDocument();
    for (const g of ["Ideas", "Books", "Goals", "Notes"]) expect(dialog.getByRole("group", { name: g })).toBeInTheDocument();
    expect(within(dialog.getByRole("group", { name: "Books" })).getByText(/Lena/)).toBeInTheDocument();
    // Locked journal: the quiet line.
    expect(await dialog.findByText("Journal results appear when your journal is unlocked.")).toBeInTheDocument();
  });

  it("↑ ↓ move the highlight; Enter opens the item's side panel and closes search", async () => {
    const { goal } = await pretend();
    renderApp("/area/art", TODAY);
    const dialog = within(await openSearch());
    const input = dialog.getByRole("combobox", { name: "Search" });
    await userEvent.type(input, "prints");
    const option = await dialog.findByRole("option", { name: /Sell pretend prints at the market/ });
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", option.id);
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    await vi.waitFor(() => expect(currentUrl).toBe(`/area/art?open=${goal.id}`));
    expect(await screen.findByRole("complementary", { name: "Sell pretend prints at the market" })).toBeInTheDocument();
  });

  it("arrow keys walk across groups and wrap", async () => {
    await pretend();
    renderApp("/", TODAY);
    const dialog = within(await openSearch());
    await userEvent.type(dialog.getByRole("combobox", { name: "Search" }), "market");
    const options = await dialog.findAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(dialog.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    const all = dialog.getAllByRole("option");
    expect(all[all.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a result opens it too", async () => {
    const { todo } = await pretend();
    renderApp("/", TODAY);
    const dialog = within(await openSearch());
    await userEvent.type(dialog.getByRole("combobox", { name: "Search" }), "stall");
    await userEvent.click(await dialog.findByRole("option", { name: /Draw the pretend market stall/ }));
    await vi.waitFor(() => expect(currentUrl).toBe(`/?open=${todo.id}`));
  });

  it("a click on a heading, the hint or the padding keeps focus in the box: Escape, arrows and Tab still work (I-2)", async () => {
    await pretend();
    renderApp("/", TODAY);
    const sheet = await openSearch();
    const dialog = within(sheet);
    const input = dialog.getByRole("combobox", { name: "Search" });
    await userEvent.type(input, "market");
    await dialog.findByRole("group", { name: "To-dos" });
    await userEvent.click(dialog.getByText("To-dos"));
    expect(input).toHaveFocus();
    await userEvent.click(dialog.getByText(/to move/));
    expect(input).toHaveFocus();
    await userEvent.click(sheet);
    expect(input).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(dialog.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    // Even if focus does land on the sheet itself, the keys are heard there.
    sheet.focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("past 8 rows a group offers See all N", async () => {
    for (let i = 0; i < 11; i++) await createItem({ kind: "task", title: `Pretend lantern errand ${i}`, areaId: "art", priority: 2 }, "2026-10-01");
    renderApp("/", TODAY);
    const dialog = within(await openSearch());
    await userEvent.type(dialog.getByRole("combobox", { name: "Search" }), "lantern");
    const todos = await dialog.findByRole("group", { name: "To-dos" });
    expect(within(todos).getAllByRole("option")).toHaveLength(8);
    await userEvent.click(within(todos).getByRole("button", { name: "See all 11" }));
    expect(within(todos).getAllByRole("option")).toHaveLength(11);
    expect(within(todos).queryByRole("button", { name: /See all/ })).toBeNull();
    expect(dialog.getByRole("combobox", { name: "Search" })).toHaveFocus();
  });

  it("Enter while an input method is composing does not open anything", async () => {
    await pretend();
    renderApp("/", TODAY);
    const dialog = within(await openSearch());
    const input = dialog.getByRole("combobox", { name: "Search" });
    await userEvent.type(input, "stall");
    await dialog.findByRole("option", { name: /Draw the pretend market stall/ });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  });

  it("no match says so", async () => {
    await pretend();
    renderApp("/", TODAY);
    const dialog = within(await openSearch());
    await userEvent.type(dialog.getByRole("combobox", { name: "Search" }), "zzzz");
    expect(await dialog.findByText('Nothing matches "zzzz".')).toBeInTheDocument();
  });
});

describe("⌘K search: the journal", () => {
  it("unlocked: her check-in words are found (in memory); a morning page under 28 days never is; Enter opens the Journal tab", async () => {
    const jk = await keyFor("fake-journal-search-ui");
    await confirmedDevice(db, jk);
    await ensureCheckinSet(jk, "2026-10-22", ["M10"]);
    await saveAnswer(jk, "2026-10-22", "M10", "device-pretend-01", "The pretend lantern festival was loud", true);
    await finishMorningPage(jk, "2026-10-30", "device-pretend-01", "A recent pretend lantern dream");
    renderApp("/", TODAY);
    const dialog = within(await openSearch());
    await userEvent.type(dialog.getByRole("combobox", { name: "Search" }), "lantern");
    const journal = await dialog.findByRole("group", { name: "Journal" });
    expect(await within(journal).findByRole("option", { name: /pretend lantern festival/ })).toBeInTheDocument();
    expect(within(journal).queryByText(/recent pretend lantern dream/)).toBeNull();
    expect(dialog.queryByText("Journal results appear when your journal is unlocked.")).toBeNull();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(currentUrl).toBe("/journal/check-in"));
  });
});

describe("⌘K search: the journal is opened only when needed, and follows the key", () => {
  it("nothing is decrypted until something is typed", async () => {
    const jk = await keyFor("fake-journal-search-ui");
    await confirmedDevice(db, jk);
    await ensureCheckinSet(jk, "2026-10-22", ["M10"]);
    await saveAnswer(jk, "2026-10-22", "M10", "device-pretend-01", "The pretend lantern festival", true);
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    renderApp("/area/art", TODAY);
    await screen.findByRole("button", { name: "Add" });
    await new Promise((r) => setTimeout(r, 200));
    decrypt.mockClear(); // only what search itself opens counts
    const dialog = within(await openSearch());
    await new Promise((r) => setTimeout(r, 200));
    expect(decrypt).not.toHaveBeenCalled();
    await userEvent.type(dialog.getByRole("combobox", { name: "Search" }), "lantern");
    expect(await dialog.findByRole("option", { name: /pretend lantern festival/ })).toBeInTheDocument();
    expect(decrypt).toHaveBeenCalled();
  });

  it("a passphrase still being checked (no confirmed key) shows the locked line", async () => {
    const jk = await keyFor("fake-journal-search-ui");
    await db.syncMeta.put({ key: JOURNAL_CANDIDATE_META, value: { key: jk.key, mac: jk.mac, fp: jk.fp, id: "pretend-candidate" } });
    renderApp("/", TODAY);
    const dialog = within(await openSearch());
    await userEvent.type(dialog.getByRole("combobox", { name: "Search" }), "lantern");
    expect(await dialog.findByText("Journal results appear when your journal is unlocked.")).toBeInTheDocument();
  });

  it("if the key goes while search is open, the journal results go with it", async () => {
    const jk = await keyFor("fake-journal-search-ui");
    await confirmedDevice(db, jk);
    await ensureCheckinSet(jk, "2026-10-22", ["M10"]);
    await saveAnswer(jk, "2026-10-22", "M10", "device-pretend-01", "The pretend lantern festival", true);
    renderApp("/", TODAY);
    const dialog = within(await openSearch());
    await userEvent.type(dialog.getByRole("combobox", { name: "Search" }), "lantern");
    await dialog.findByRole("option", { name: /pretend lantern festival/ });
    await db.syncMeta.delete(JOURNAL_KEY_META);
    expect(await dialog.findByText("Journal results appear when your journal is unlocked.")).toBeInTheDocument();
    expect(dialog.queryByRole("option", { name: /pretend lantern festival/ })).toBeNull();
  });
});

describe("⌘K search on the phone", () => {
  it("the 🔍 in the top bar opens search full screen; Back closes it", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(dialog).toHaveClass("is-full");
    await userEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });
});
