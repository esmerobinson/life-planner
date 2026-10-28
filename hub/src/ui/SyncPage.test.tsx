import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { FakeSyncServer } from "../sync/fakeServer";
import { SyncController } from "../sync/controller";
import { getMeta, saveSyncSettings } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { syncController } from "../sync";
import { Sidebar } from "./Sidebar";
import { LOCKOUT_LINE, SyncPage } from "./SyncPage";

// Obviously fake: never a real passphrase.
const PASSPHRASE = "fake-passphrase-for-tests-only-7f3a";
const ADDRESS = "https://sync.example.test";

let token: string;
beforeAll(async () => {
  token = await deriveToken(PASSPHRASE);
});

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  await db.pending.clear();
  await db.syncMeta.clear();
  localStorage.clear();
});
afterEach(() => vi.unstubAllEnvs());

function setup() {
  const server = new FakeSyncServer(token);
  const controller = new SyncController({ db, fetch: server.fetch });
  render(<SyncPage controller={controller} />);
  return { server, controller };
}

/** Every value in every object store of every IndexedDB database, as text. */
async function everythingStored(): Promise<string> {
  const out: string[] = [];
  for (const info of await indexedDB.databases()) {
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(info.name!);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const store of Array.from(raw.objectStoreNames)) {
      const values = await new Promise<unknown[]>((resolve, reject) => {
        const req = raw.transaction(store, "readonly").objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      out.push(JSON.stringify(values));
    }
    raw.close();
  }
  for (let i = 0; i < localStorage.length; i++) out.push(localStorage.getItem(localStorage.key(i)!) ?? "");
  for (let i = 0; i < sessionStorage.length; i++) out.push(sessionStorage.getItem(sessionStorage.key(i)!) ?? "");
  return out.join("\n");
}

describe("SyncPage", () => {
  it("saves only the derived token, clears the passphrase field, and syncs", async () => {
    const user = userEvent.setup();
    await db.items.add({ id: "x", kind: "task", title: "Mine", links: [], areaId: "art", priority: 2,
      status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01" });
    const { server } = setup();
    await user.type(screen.getByLabelText("Sync address"), ADDRESS);
    const field = screen.getByLabelText("Passphrase");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await getMeta(db, "token")).toBe(token));
    expect(field).toHaveValue("");
    expect(await getMeta(db, "serverUrl")).toBe(ADDRESS);
    await waitFor(() => expect(server.rows.size).toBe(1));
    expect(await screen.findByText(/^Last synced /)).toBeInTheDocument();

    const stored = await everythingStored();
    expect(stored).toContain(token); // the token is stored (documented on the page)
    expect(stored).not.toContain(PASSPHRASE);
    expect(stored).not.toContain(PASSPHRASE.normalize("NFD"));
    expect(screen.queryByDisplayValue(PASSPHRASE)).toBeNull();
  });

  it("says that wrong passphrases are limited and how long to wait", () => {
    setup();
    expect(screen.getByText(LOCKOUT_LINE)).toBeInTheDocument();
  });

  it("prefills the address from VITE_SYNC_URL", async () => {
    vi.stubEnv("VITE_SYNC_URL", "https://prefilled.example.test");
    setup();
    expect(screen.getByLabelText("Sync address")).toHaveValue("https://prefilled.example.test");
  });

  it("shows how many changes are waiting and when it last synced", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    await db.syncMeta.put({ key: "lastSyncedAt", value: new Date(2026, 9, 28, 9, 5).getTime() });
    await db.items.bulkAdd([
      { id: "a", kind: "task", title: "A", links: [], areaId: "art", priority: 2, status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01" },
      { id: "b", kind: "task", title: "B", links: [], areaId: "art", priority: 2, status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01" },
    ]);
    setup();
    expect(await screen.findByText("2 changes waiting")).toBeInTheDocument();
    expect(screen.getByText(/^Last synced /)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Sync address")).toHaveValue(ADDRESS));
  });

  it("says how many items from another device could not be read yet", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    const data = { id: "q", areaId: "garden" };
    await db.quarantine.bulkPut([
      { table: "items", id: "q1", updatedAt: 5, data, reason: "x", cursor: 1 },
      { table: "goals", id: "q2", updatedAt: 6, data, reason: "x", cursor: 1 },
    ]);
    setup();
    expect(await screen.findByText("2 items from another device couldn't be read yet")).toBeInTheDocument();
    await db.quarantine.clear();
  });

  it("counts changes the server refused (kept here) apart from changes waiting", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    await db.items.add({ id: "s", kind: "task", title: "S", links: [], areaId: "art", priority: 2,
      status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01" });
    const p = (await db.pending.get(["items", "s"]))!;
    await db.pending.put({ ...p, stuck: true });
    setup();
    expect(await screen.findByText("1 change could not be sent. It is kept on this device.")).toBeInTheDocument();
    expect(screen.queryByText(/changes? waiting/)).toBeNull();
  });

  it("asks for the passphrase again after it was not accepted", async () => {
    await db.syncMeta.bulkPut([{ key: "serverUrl", value: ADDRESS }, { key: "needsPassphrase", value: true }]);
    setup();
    expect(await screen.findByText("The passphrase was not accepted. Enter it again to keep syncing.")).toBeInTheDocument();
  });

  it("Stop syncing forgets the token and keeps the data", async () => {
    const user = userEvent.setup();
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    await db.items.add({ id: "keep", kind: "task", title: "Keep", links: [], areaId: "art", priority: 2,
      status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01" });
    setup();
    await user.click(await screen.findByRole("button", { name: "Stop syncing on this device" }));
    await waitFor(async () => expect(await getMeta(db, "token")).toBeUndefined());
    expect(await db.items.get("keep")).toBeTruthy();
    expect(await screen.findByText("Sync is off on this device.")).toBeInTheDocument();
  });

  it("Sync now runs a sync", async () => {
    const user = userEvent.setup();
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    const { server } = setup();
    await user.click(await screen.findByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(server.syncRequests).toHaveLength(1));
  });
});

describe("Sidebar sync link", () => {
  it("sits beside Backup and says when the passphrase is needed", async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Sync" })).toHaveAttribute("href", "/sync");
    expect(screen.getByRole("link", { name: "Sync" }).className).toBe(screen.getByRole("link", { name: "Backup" }).className);
    await db.syncMeta.put({ key: "needsPassphrase", value: true });
    await act(() => syncController.reload());
    expect(screen.getByRole("link", { name: "Sync (needs passphrase)" })).toBeInTheDocument();
    await db.syncMeta.clear();
    await act(() => syncController.reload());
  });
});
