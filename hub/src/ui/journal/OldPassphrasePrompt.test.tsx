import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { deriveKeyWrapKey } from "../../journal/crypto";
import { journalNeedsOldPassphrase, keyWrapId, loadJournalKey, saveJournalKeyFromSync } from "../../journal/keyStore";
import { SyncController } from "../../sync/controller";
import { FakeSyncServer } from "../../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../../sync/engine";
import { deriveToken } from "../../sync/token";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { SyncPage } from "../SyncPage";
import { OLD_PASSPHRASE_DONE, OLD_PASSPHRASE_HEADING, OLD_PASSPHRASE_LABEL, OLD_PASSPHRASE_WRONG } from "./OldPassphrasePrompt";

// The one-time old-passphrase prompt (journal-rekey brief point 5): a device whose journal key
// was confirmed before the re-key update has no copy of the journal secret, so after sync
// accepts a new passphrase it asks once for the old one. Fictional passphrases only.

const ADDRESS = "https://sync.example.test";
const OLD = "pretend-prompt-old-passphrase";
const NEW = "pretend-prompt-new-passphrase";

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});

/** This device as it was before the update: journal confirmed with OLD (no copy of S), synced. */
async function preUpdateDevice(server: FakeSyncServer) {
  await saveSyncSettings(db, { serverUrl: ADDRESS, token: await deriveToken(OLD) });
  await confirmedDevice(db, await keyFor(OLD));
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
}

it("Sync page: after Save of the new passphrase, it asks for the old one once; the right one writes the wrap", async () => {
  const server = new FakeSyncServer(await deriveToken(OLD));
  await preUpdateDevice(server);
  (server as unknown as { token: string }).token = await deriveToken(NEW);
  const controller = new SyncController({ db, fetch: server.fetch });
  render(<SyncPage controller={controller} />);
  expect(screen.queryByRole("heading", { name: OLD_PASSPHRASE_HEADING })).toBeNull();

  await userEvent.type(screen.getByLabelText("Passphrase"), NEW);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  const prompt = (await screen.findByRole("heading", { name: OLD_PASSPHRASE_HEADING }, { timeout: 8000 })).closest("section")!;
  const field = within(prompt).getByLabelText(OLD_PASSPHRASE_LABEL);

  await userEvent.type(field, NEW);
  await userEvent.click(within(prompt).getByRole("button", { name: "Save" }));
  expect(await within(prompt).findByRole("alert", {}, { timeout: 8000 })).toHaveTextContent(OLD_PASSPHRASE_WRONG);
  expect(field).toHaveValue("");

  await userEvent.type(field, OLD);
  await userEvent.click(within(prompt).getByRole("button", { name: "Save" }));
  expect(await screen.findByText(OLD_PASSPHRASE_DONE, {}, { timeout: 8000 })).toBeInTheDocument();
  expect(await db.journal.get(keyWrapId((await deriveKeyWrapKey(NEW)).fp))).toBeTruthy();
  expect(await journalNeedsOldPassphrase(db)).toBe(false);
  expect((await loadJournalKey(db))!.fp).toBe((await keyFor(OLD)).fp);
}, 30_000);

it("Journal: the same prompt shows above the open journal", async () => {
  const server = new FakeSyncServer(await deriveToken(OLD));
  await preUpdateDevice(server);
  (server as unknown as { token: string }).token = await deriveToken(NEW);
  await saveSyncSettings(db, { serverUrl: ADDRESS, token: await deriveToken(NEW) });
  await saveJournalKeyFromSync(db, NEW);
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  renderApp("/journal/morning", "2026-11-04");
  expect(await screen.findByRole("heading", { name: OLD_PASSPHRASE_HEADING }, { timeout: 8000 })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Unlock journal" })).toBeNull(); // the journal itself stays open
}, 30_000);
