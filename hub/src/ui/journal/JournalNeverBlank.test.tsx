import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { HomePage } from "../HomePage";
import { db } from "../../data/db";
import * as repo from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import * as keyStore from "../../journal/keyStore";
import * as engine from "../../sync/engine";
import { confirmedDevice, keyFor, verifierRow } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { KEYCHAIN_LINE, CANT_OPEN_JOURNAL } from "./JournalPage";
import { SECTION_CANT_OPEN } from "./bits";
import { loadTimeout } from "./loadTimeout";

// The Journal is never blank (2026-11-02, "everything has disappeared from the journal"): a
// key check, a device id or a section read that throws or never settles still leaves the page
// with its tabs (Journal v2), a quiet "Loading…", then a clear line and "Try again".
// Fictional passphrase and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-02";
let jk: JournalKey;
const realTimeout = loadTimeout.ms;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  loadTimeout.ms = 150;
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});
afterEach(() => {
  loadTimeout.ms = realTimeout;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const never = <T,>() => new Promise<T>(() => undefined);
const SECTIONS = ["Morning pages", "Daily check-in", "Mental health exercise"];

/** The tabs show whatever else the page says. */
async function expectSectionStrips() {
  const tabs = await screen.findByRole("navigation", { name: "Journal parts" });
  for (const name of [...SECTIONS, "Read back"]) expect(within(tabs).getByRole("link", { name })).toBeInTheDocument();
}

/** The journal is open (on the exercise tab, with no cards yet). */
const opened = () => screen.findByText("Add your exercise cards", {}, { timeout: 5000 });

describe("the key check", () => {
  it("hanging: 'Loading…' with the tabs, then the can't-open line and Try again (which opens it)", async () => {
    await confirmedDevice(db, jk);
    const real = keyStore.confirmJournalKey;
    const spy = vi.spyOn(keyStore, "confirmJournalKey").mockImplementation(() => never());
    renderApp("/journal", TODAY);
    expect(await screen.findByRole("heading", { level: 1, name: "Journal" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    await expectSectionStrips();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(CANT_OPEN_JOURNAL);
    await expectSectionStrips();
    spy.mockImplementation(real);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await opened()).toBeInTheDocument();
  });

  it("a late answer after the timeout still opens the journal by itself", async () => {
    await confirmedDevice(db, jk);
    let release: (s: keyStore.JournalKeyState) => void = () => undefined;
    vi.spyOn(keyStore, "confirmJournalKey").mockImplementationOnce(() => new Promise((r) => (release = r)));
    renderApp("/journal", TODAY);
    expect(await screen.findByRole("alert")).toHaveTextContent(CANT_OPEN_JOURNAL);
    release("confirmed");
    expect(await opened()).toBeInTheDocument();
  });

  it("throwing: the sections still show, with the can't-open line and Try again (never a blank page)", async () => {
    await confirmedDevice(db, jk);
    vi.spyOn(keyStore, "confirmJournalKey").mockRejectedValue(new Error("pretend disk trouble"));
    renderApp("/journal", TODAY);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(CANT_OPEN_JOURNAL);
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    await expectSectionStrips();
  });

  it("the Mac keychain refusing the key (a WebCrypto error) says what to do, and nothing is deleted", async () => {
    await confirmedDevice(db, jk);
    const before = await db.syncMeta.get(keyStore.JOURNAL_KEY_META);
    vi.spyOn(keyStore, "confirmJournalKey").mockRejectedValue(new DOMException("The operation failed for an operation-specific reason", "OperationError"));
    renderApp("/journal", TODAY);
    expect(await screen.findByRole("alert")).toHaveTextContent(KEYCHAIN_LINE);
    await expectSectionStrips();
    expect(await db.syncMeta.get(keyStore.JOURNAL_KEY_META)).toEqual(before);
  });

  it("a stored key that comes back unreadable (keychain denied) says what to do instead of asking to unlock", async () => {
    await db.journal.put(await verifierRow(jk));
    await db.syncMeta.put({ key: keyStore.JOURNAL_KEY_META, value: null });
    renderApp("/journal", TODAY);
    expect(await screen.findByRole("alert")).toHaveTextContent(KEYCHAIN_LINE);
    expect(screen.queryByLabelText("Sync passphrase")).toBeNull();
    await expectSectionStrips();
    expect((await db.syncMeta.get(keyStore.JOURNAL_KEY_META))?.key).toBe(keyStore.JOURNAL_KEY_META);
  });

  it("locked: Unlock journal above the tabs, and no entries", async () => {
    await db.journal.put(await verifierRow(jk));
    renderApp("/journal", TODAY);
    expect(await screen.findByRole("heading", { name: "Unlock journal" })).toBeInTheDocument();
    await expectSectionStrips();
    expect(screen.queryByText("Add your exercise cards")).toBeNull();
  });

  it("unlocking when the keychain won't store the key says what to do", async () => {
    await db.journal.put(await verifierRow(jk));
    vi.spyOn(keyStore, "unlockJournal").mockRejectedValue(new DOMException("The object can not be cloned.", "DataCloneError"));
    renderApp("/journal", TODAY);
    await userEvent.type(await screen.findByLabelText("Sync passphrase"), PASS);
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(KEYCHAIN_LINE);
  });
});

describe("the device id", () => {
  it("failing: the sections and a Try again instead of a blank page", async () => {
    await confirmedDevice(db, jk);
    const real = engine.getDeviceId;
    const spy = vi.spyOn(engine, "getDeviceId").mockRejectedValue(new Error("pretend"));
    renderApp("/journal", TODAY);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(CANT_OPEN_JOURNAL);
    await expectSectionStrips();
    spy.mockImplementation(real);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await opened()).toBeInTheDocument();
  });

  it("hanging: the same after the timeout", async () => {
    await confirmedDevice(db, jk);
    vi.spyOn(engine, "getDeviceId").mockImplementation(() => never());
    renderApp("/journal", TODAY);
    expect(await screen.findByRole("alert")).toHaveTextContent(CANT_OPEN_JOURNAL);
    await expectSectionStrips();
  });
});

describe("a section's own read", () => {
  it("morning pages hanging: 'Loading…' in its tab, then the can't-open line and Try again", async () => {
    await confirmedDevice(db, jk);
    const real = repo.listMorningDone;
    const spy = vi.spyOn(repo, "listMorningDone").mockImplementation(() => never());
    renderApp("/journal/morning", TODAY);
    const morning = await screen.findByRole("region", { name: "Morning pages" }, { timeout: 5000 });
    expect(await within(morning).findByRole("status")).toHaveTextContent("Loading…");
    const alert = await within(morning).findByRole("alert");
    expect(alert).toHaveTextContent(SECTION_CANT_OPEN);
    spy.mockImplementation(real);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await within(morning).findByLabelText("Today's morning page")).toBeInTheDocument();
  });

  it("morning pages throwing: the can't-open line and Try again (not an empty calendar)", async () => {
    await confirmedDevice(db, jk);
    vi.spyOn(repo, "listMorningDone").mockRejectedValue(new Error("pretend"));
    renderApp("/journal/morning", TODAY);
    const morning = await screen.findByRole("region", { name: "Morning pages" }, { timeout: 5000 });
    expect(await within(morning).findByRole("alert")).toHaveTextContent(SECTION_CANT_OPEN);
    expect(within(morning).queryByRole("group", { name: "Morning pages calendar" })).toBeNull();
  });

  it("the check-in throwing: the can't-open line and Try again", async () => {
    await confirmedDevice(db, jk);
    vi.spyOn(repo, "listCheckinDays").mockRejectedValue(new Error("pretend"));
    renderApp("/journal/check-in", TODAY);
    const checkin = await screen.findByRole("region", { name: "Daily check-in" }, { timeout: 5000 });
    const alert = await within(checkin).findByRole("alert");
    expect(alert).toHaveTextContent(SECTION_CANT_OPEN);
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("the exercise hanging: the can't-open line and Try again", async () => {
    await confirmedDevice(db, jk);
    vi.spyOn(repo, "readExerciseCards").mockImplementation(() => never());
    renderApp("/journal", TODAY);
    const ex = await screen.findByRole("region", { name: "Mental health exercise" }, { timeout: 5000 });
    const alert = await within(ex).findByRole("alert");
    expect(alert).toHaveTextContent(SECTION_CANT_OPEN);
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("Home's Journal rows", () => {
  function renderHome() {
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomePage today={TODAY} />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("a key load that never settles: after the timeout the rows show the not-available box", async () => {
    await confirmedDevice(db, jk);
    vi.spyOn(keyStore, "loadJournalKey").mockImplementation(() => never());
    renderHome();
    const card = await screen.findByRole("region", { name: "Journal" });
    await waitFor(() => expect(within(card).getAllByRole("img", { name: "Not available until the journal is unlocked" })).toHaveLength(3));
  });

  it("a read that throws: the rows still show, with the not-available box", async () => {
    await confirmedDevice(db, jk);
    vi.spyOn(repo, "listMorningDone").mockRejectedValue(new Error("pretend"));
    renderHome();
    const card = await screen.findByRole("region", { name: "Journal" });
    await waitFor(() => expect(within(card).getAllByRole("img", { name: "Not available until the journal is unlocked" })).toHaveLength(3));
    for (const t of SECTIONS) expect(within(card).getByRole("button", { name: t })).toBeInTheDocument();
  });
});
