import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import { db } from "../data/db";
import { FakeSyncServer } from "../sync/fakeServer";
import { SyncController } from "../sync/controller";
import { getMeta, saveSyncSettings } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { saveJournalKeyFromSync, unlockJournal, loadJournalKey } from "../journal/keyStore";
import { pairingText } from "../pairing/pairingText";
import { qrModules, qrPath, readFrame } from "../pairing/qr";
import { keyFor, verifierRow } from "../test/journalKey";
import { renderApp } from "../test/renderApp";
import { CAMERA_DENIED, NOT_PAIRING, PAIRING_WARNING, PairingCode, hidesIn } from "./Pairing";
import { SyncPage } from "./SyncPage";

// Pair a device by QR code. Fictional passphrases only; the camera and the frame decoder are
// mocked (jsdom has neither).

vi.mock("../pairing/qr", async (orig) => ({ ...(await orig<typeof import("../pairing/qr")>()), readFrame: vi.fn() }));
vi.mock("../journal/keyStore", async (orig) => {
  const real = await orig<typeof import("../journal/keyStore")>();
  return { ...real, saveJournalKeyFromSync: vi.fn(real.saveJournalKeyFromSync), unlockJournal: vi.fn(real.unlockJournal) };
});

const PASSPHRASE = "fake-pairing-passphrase-for-tests-3c1d";
const ADDRESS = "https://sync.example.test";
let token: string;
beforeAll(async () => {
  token = await deriveToken(PASSPHRASE);
});

/** A fake camera: getUserMedia resolves with one track whose stop() is watched. */
function fakeCamera(opts: { deny?: string } = {}) {
  const stop = vi.fn();
  const track = { stop, kind: "video" } as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => {
    if (opts.deny) throw new DOMException("denied", opts.deny);
    return stream;
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  return { stop, getUserMedia };
}

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear(), db.pending.clear(), db.syncMeta.clear(), db.journal.clear()]);
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(readFrame).mockReset().mockResolvedValue(null);
  vi.mocked(saveJournalKeyFromSync).mockClear();
  vi.mocked(unlockJournal).mockClear();
  // jsdom has no media playback.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

function setup() {
  const server = new FakeSyncServer(token);
  const controller = new SyncController({ db, fetch: server.fetch });
  const view = render(<SyncPage controller={controller} />);
  return { server, controller, view };
}

async function setAddress() {
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Sync address"));
  await user.type(screen.getByLabelText("Sync address"), ADDRESS);
  return user;
}

/** Every value in IndexedDB, localStorage and sessionStorage, as text. */
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
  for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)!, localStorage.getItem(localStorage.key(i)!) ?? "");
  for (let i = 0; i < sessionStorage.length; i++) out.push(sessionStorage.key(i)!, sessionStorage.getItem(sessionStorage.key(i)!) ?? "");
  return out.join("\n");
}

/** The passphrase appears nowhere in the page's markup or text (the QR's modules aside). */
function notInDom() {
  expect(document.body.innerHTML).not.toContain(PASSPHRASE);
  expect(document.body.textContent).not.toContain(PASSPHRASE);
  expect(screen.queryByDisplayValue(PASSPHRASE)).toBeNull();
  expect(location.href).not.toContain(PASSPHRASE);
}

async function saveTyped(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Passphrase"), PASSPHRASE);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(async () => expect(await getMeta(db, "token")).toBe(token));
}

/** Shows the code until it hides itself; "Show" brings it back (another tap). */
function Harness() {
  const [shown, setShown] = useState(true);
  return shown ? (
    <PairingCode passphrase={PASSPHRASE} onHide={() => setShown(false)} />
  ) : (
    <button type="button" onClick={() => setShown(true)}>
      Show
    </button>
  );
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  fireEvent(document, new Event("visibilitychange"));
}

describe("the shown code hides itself", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("formats the countdown", () => {
    expect(hidesIn(60)).toBe("Hides in 1:00");
    expect(hidesIn(45)).toBe("Hides in 0:45");
    expect(hidesIn(5)).toBe("Hides in 0:05");
    expect(hidesIn(-1)).toBe("Hides in 0:00");
  });

  it("counts down under the warning and hides at 60 seconds; showing again starts a new minute", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const line = screen.getByText("Hides in 1:00");
    expect(line).toHaveClass("journal-muted");
    expect(screen.getByText(PAIRING_WARNING).nextElementSibling).toBe(line);
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByText("Hides in 0:45")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(44_000));
    expect(screen.getByText("Hides in 0:01")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    // Only another tap shows it again, for a fresh minute.
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("Hides in 1:00")).toBeInTheDocument();
  });

  it("hides at once when the page goes to the background (visibilitychange), not when it comes back", () => {
    render(<Harness />);
    setVisibility("visible");
    expect(screen.getByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    setVisibility("hidden");
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    setVisibility("visible");
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
  });

  it("hides at once on pagehide and when the window loses focus (the Mac app)", () => {
    render(<Harness />);
    fireEvent(window, new Event("pagehide"));
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    fireEvent(window, new Event("blur"));
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
  });

  it("on the Sync page: backgrounding hides it; Pair another device shows it again", async () => {
    setup();
    const user = await setAddress();
    await saveTyped(user);
    await user.click(await screen.findByRole("button", { name: "Pair another device" }));
    expect(screen.getByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    setVisibility("hidden");
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    setVisibility("visible");
    await user.click(screen.getByRole("button", { name: "Pair another device" }));
    expect(screen.getByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    expect(screen.getByText("Hides in 1:00")).toBeInTheDocument();
  });
});

describe("show a pairing code (Sync page)", () => {
  it("after Save: 'Pair another device' shows the code for esmeworld-pair:v1:<passphrase>, the warning and Hide", async () => {
    setup();
    const user = await setAddress();
    expect(screen.queryByRole("button", { name: "Pair another device" })).toBeNull();
    await saveTyped(user);
    await user.click(await screen.findByRole("button", { name: "Pair another device" }));
    const qr = screen.getByRole("img", { name: "Pairing code" });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(qr).toHaveAttribute("width", "240");
    expect(qr.querySelector("rect")).toHaveAttribute("fill", "#ffffff");
    expect(qr.querySelector("path")).toHaveAttribute("fill", "#000000");
    // Exactly the code for the pairing text.
    expect(qr.querySelector("path")!.getAttribute("d")).toBe(qrPath(qrModules(pairingText(PASSPHRASE))));
    expect(screen.getByText(PAIRING_WARNING)).toBeInTheDocument();
    notInDom();

    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pair another device" })).toBeInTheDocument();
    expect(await everythingStored()).not.toContain(PASSPHRASE);
  });

  it("leaving the page hides the code and forgets the passphrase", async () => {
    const { view, controller } = setup();
    const user = await setAddress();
    await saveTyped(user);
    await user.click(await screen.findByRole("button", { name: "Pair another device" }));
    expect(screen.getByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    view.unmount();
    expect(document.body.innerHTML).not.toContain("Pairing code");
    render(<SyncPage controller={controller} />);
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pair another device" })).toBeNull();
    // Later, only by pasting the passphrase again.
    expect(await screen.findByLabelText("Passphrase for the pairing code")).toBeInTheDocument();
    expect(await everythingStored()).not.toContain(PASSPHRASE);
  });

  it("'Show pairing code' later: only for the passphrase this device syncs with", async () => {
    const user = userEvent.setup();
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    setup();
    const field = await screen.findByLabelText("Passphrase for the pairing code");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "fake-not-the-passphrase");
    await user.click(screen.getByRole("button", { name: "Show pairing code" }));
    expect(await screen.findByText("That isn't the passphrase this device syncs with.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    expect(field).toHaveValue("");

    await user.type(field, PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Show pairing code" }));
    const qr = await screen.findByRole("img", { name: "Pairing code" });
    expect(qr.querySelector("path")!.getAttribute("d")).toBe(qrPath(qrModules(pairingText(PASSPHRASE))));
    notInDom();
    expect(await everythingStored()).not.toContain(PASSPHRASE);
  });

  it("no code is offered while the passphrase is refused", async () => {
    await db.syncMeta.bulkPut([{ key: "serverUrl", value: ADDRESS }, { key: "needsPassphrase", value: true }]);
    setup();
    expect(await screen.findByText("The passphrase was not accepted. Enter it again to keep syncing.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Passphrase for the pairing code")).toBeNull();
    expect(screen.queryByRole("button", { name: "Pair another device" })).toBeNull();
  });
});

describe("scan a pairing code (Sync page)", () => {
  it("runs the same save as typing: sync token, journal candidate, sync; the camera stops; nothing kept", async () => {
    const { stop, getUserMedia } = fakeCamera();
    vi.mocked(readFrame).mockResolvedValueOnce(null).mockResolvedValue(pairingText(PASSPHRASE));
    const { server } = setup();
    const user = await setAddress();
    await user.click(screen.getByRole("button", { name: "Scan pairing code" }));
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false });
    const video = await screen.findByLabelText("Camera");
    expect(video).toHaveAttribute("playsinline");
    expect((video as HTMLVideoElement).muted).toBe(true);

    await waitFor(async () => expect(await getMeta(db, "token")).toBe(token), { timeout: 5000 });
    expect(stop).toHaveBeenCalled();
    expect(screen.queryByLabelText("Camera")).toBeNull();
    expect(await getMeta(db, "serverUrl")).toBe(ADDRESS);
    await waitFor(() => expect(saveJournalKeyFromSync).toHaveBeenCalledWith(db, PASSPHRASE));
    await waitFor(() => expect(server.syncRequests.length).toBeGreaterThan(0));
    await waitFor(async () => expect(await loadJournalKey(db)).toBeTruthy(), { timeout: 5000 });
    // The camera loop ended: no more frames are read.
    const reads = vi.mocked(readFrame).mock.calls.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(vi.mocked(readFrame).mock.calls.length).toBe(reads);

    notInDom();
    expect(await everythingStored()).not.toContain(PASSPHRASE);
    // The scanned passphrase can be shown on to the next device, from memory only.
    expect(await screen.findByRole("button", { name: "Pair another device" })).toBeInTheDocument();
  });

  it("camera denied: says to allow it in Settings or paste the code", async () => {
    fakeCamera({ deny: "NotAllowedError" });
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Scan pairing code" }));
    expect(await screen.findByText(CAMERA_DENIED)).toBeInTheDocument();
    expect(screen.queryByLabelText("Camera")).toBeNull();
  });

  it("another QR code: says it isn't a pairing code and keeps looking; Cancel stops the camera", async () => {
    const { stop } = fakeCamera();
    vi.mocked(readFrame).mockResolvedValue("https://example.test/menu");
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Scan pairing code" }));
    expect(await screen.findByText(NOT_PAIRING)).toBeInTheDocument();
    expect(screen.getByLabelText("Camera")).toBeInTheDocument();
    expect(stop).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(stop).toHaveBeenCalled();
    expect(screen.queryByLabelText("Camera")).toBeNull();
    expect(await getMeta(db, "token")).toBeUndefined();
  });

  it("leaving the page while scanning stops the camera", async () => {
    const { stop } = fakeCamera();
    const { view } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Scan pairing code" }));
    await screen.findByLabelText("Camera");
    view.unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("Paste pairing code: the same save; anything else is refused", async () => {
    setup();
    const user = await setAddress();
    const field = screen.getByLabelText("Paste pairing code");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Use pairing code" }));
    expect(await screen.findByText(NOT_PAIRING)).toBeInTheDocument();
    expect(field).toHaveValue("");
    expect(saveJournalKeyFromSync).not.toHaveBeenCalled();

    await user.type(field, `  ${pairingText(PASSPHRASE)}`);
    await user.click(screen.getByRole("button", { name: "Use pairing code" }));
    await waitFor(async () => expect(await getMeta(db, "token")).toBe(token), { timeout: 5000 });
    await waitFor(() => expect(saveJournalKeyFromSync).toHaveBeenCalledWith(db, PASSPHRASE));
    expect(field).toHaveValue("");
    notInDom();
    expect(await everythingStored()).not.toContain(PASSPHRASE);
  });
});

describe("scan a pairing code (Journal, Unlock journal)", () => {
  it("unlocks exactly as typing the passphrase would (the verifier rule unchanged)", async () => {
    const jk = await keyFor(PASSPHRASE);
    const other = await keyFor("fake-other-device-passphrase");
    await db.journal.put(await verifierRow(other)); // another passphrase's journal is here
    const { stop } = fakeCamera();
    vi.mocked(readFrame).mockResolvedValue(pairingText(PASSPHRASE));
    renderApp("/journal", "2026-10-28");
    await userEvent.click(await screen.findByRole("button", { name: "Scan pairing code" }));
    // Not the journal's passphrase: refused just like a typed one.
    expect(await screen.findByText("That isn't the journal's passphrase. Try again.", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(unlockJournal).toHaveBeenCalledWith(db, PASSPHRASE);
    expect(stop).toHaveBeenCalled();
    expect(await loadJournalKey(db)).toBeUndefined();

    // The right one, pasted: the journal opens.
    await db.journal.put(await verifierRow(jk)); // now this passphrase's journal
    await userEvent.type(await screen.findByLabelText("Paste pairing code"), pairingText(PASSPHRASE));
    await userEvent.click(screen.getByRole("button", { name: "Use pairing code" }));
    expect(await screen.findByRole("heading", { name: "Morning pages" }, { timeout: 5000 })).toBeInTheDocument();
    expect((await loadJournalKey(db))!.fp).toBe(jk.fp);
    expect(await everythingStored()).not.toContain(PASSPHRASE);
  });
});
