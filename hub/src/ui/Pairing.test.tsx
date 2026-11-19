import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import { db } from "../data/db";
import { FakeSyncServer } from "../sync/fakeServer";
import { SyncController } from "../sync/controller";
import { DEFAULT_SYNC_URL, getMeta, saveSyncSettings } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { deriveJournalSecret } from "../journal/crypto";
import { journalSecretForPairing, saveJournalKeyFromSync, unlockJournal, loadJournalKey } from "../journal/keyStore";
import { pairingText, pairingTextV2 } from "../pairing/pairingText";
import { qrModules, qrPath, readFrame } from "../pairing/qr";
import { confirmedDevice, keyFor, verifierRow } from "../test/journalKey";
import { renderApp } from "../test/renderApp";
import { currentUpdateHold } from "../native/updateHolds";
import {
  CAMERA_DENIED, CODE_FAILED, NOT_PAIRING, PAIRING_WARNING, PairingCode, SCANNER_FAILED, SYNC_ONLY_NOTE, ScanPairingCode, TOO_LONG, hidesIn,
} from "./Pairing";
import {
  SyncPage, CONFIRM_ADDRESS_BUTTON, JOURNAL_MAY_ASK_NOTE, OTHER_JOURNAL, OWNER_REFUSED, OWNER_UNAVAILABLE, TYPE_PASSPHRASE_ONCE, otherAddressLine,
} from "./SyncPage";
import { CODE_REFUSED_LINE } from "./journal/JournalPage";

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
    <PairingCode text={pairingText(PASSPHRASE)} onHide={() => setShown(false)} />
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
    // Spies first: a spy made on a faked setInterval would otherwise be "restored" to the fake
    // one after real timers are back, leaving later tests with a setInterval that never fires.
    vi.restoreAllMocks();
    vi.useRealTimers();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("formats the countdown", () => {
    expect(hidesIn(120)).toBe("Hides in 2:00");
    expect(hidesIn(60)).toBe("Hides in 1:00");
    expect(hidesIn(45)).toBe("Hides in 0:45");
    expect(hidesIn(5)).toBe("Hides in 0:05");
    expect(hidesIn(-1)).toBe("Hides in 0:00");
  });

  it("counts down under the warning and hides at 2 minutes; showing again starts afresh", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const line = screen.getByText("Hides in 2:00");
    expect(line).toHaveClass("journal-muted");
    expect(screen.getByText(PAIRING_WARNING).nextElementSibling).toBe(line);
    act(() => vi.advanceTimersByTime(75_000));
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
    expect(screen.getByText("Hides in 2:00")).toBeInTheDocument();
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

  it("hides at 2 minutes even when the countdown's ticks never run (a timeout for the exact time)", () => {
    vi.useFakeTimers();
    const realSetInterval = window.setInterval;
    vi.spyOn(window, "setInterval").mockImplementation((() => 0) as unknown as typeof realSetInterval);
    render(<Harness />);
    act(() => vi.advanceTimersByTime(119_999));
    expect(screen.getByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
  });

  it("a passphrase too long for a QR code shows a plain error instead of throwing", () => {
    const onHide = vi.fn();
    render(<PairingCode text={pairingText("p".repeat(3000))} onHide={onHide} />);
    expect(screen.getByRole("alert")).toHaveTextContent(CODE_FAILED);
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    expect(document.body.innerHTML).not.toContain("p".repeat(100));
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(onHide).toHaveBeenCalled();
  });

  it("on the Sync page: backgrounding hides it; showing it again is another tap (no passphrase)", async () => {
    setup();
    const user = await setAddress();
    await saveTyped(user);
    await user.click(await screen.findByRole("button", { name: "Pair another device" }));
    expect(await screen.findByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    setVisibility("hidden");
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    setVisibility("visible");
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Pair another device" }));
    expect(await screen.findByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    expect(screen.getByText("Hides in 2:00")).toBeInTheDocument();
    // Let this Save's journal step finish before the next test clears the database.
    await waitFor(async () => expect(await journalSecretForPairing(db)).toBeTruthy(), { timeout: 5000 });
  });
});

describe("show a pairing code (Sync page)", () => {
  it("after Save: 'Pair another device' shows the v2 code (token, journal secret, address), the warning and Hide", async () => {
    setup();
    const user = await setAddress();
    expect(screen.queryByRole("button", { name: "Pair another device" })).toBeNull();
    await saveTyped(user);
    await waitFor(async () => expect(await journalSecretForPairing(db)).toBeTruthy(), { timeout: 5000 });
    await user.click(await screen.findByRole("button", { name: "Pair another device" }));
    const qr = await screen.findByRole("img", { name: "Pairing code" });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(qr).toHaveAttribute("width", "240");
    expect(qr.querySelector("rect")).toHaveAttribute("fill", "#ffffff");
    expect(qr.querySelector("path")).toHaveAttribute("fill", "#000000");
    // Exactly the code for the v2 pairing text.
    const text = pairingTextV2({ token, secret: await deriveJournalSecret(PASSPHRASE), serverUrl: ADDRESS });
    expect(qr.querySelector("path")!.getAttribute("d")).toBe(qrPath(qrModules(text)));
    expect(screen.getByText(PAIRING_WARNING)).toBeInTheDocument();
    expect(screen.queryByText(SYNC_ONLY_NOTE)).toBeNull();
    notInDom();
    expect(document.body.innerHTML).not.toContain(text.slice(18, 40));

    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    // Showing it again is just another tap.
    expect(screen.getByRole("button", { name: "Pair another device" })).toBeInTheDocument();
    expect(await everythingStored()).not.toContain(PASSPHRASE);
    expect(await everythingStored()).not.toContain(text.slice(18));
  });

  it("a fresh visit to the page (no passphrase typed): 'Pair another device' shows the full code straight away", async () => {
    const { view, controller } = setup();
    const user = await setAddress();
    await saveTyped(user);
    await waitFor(async () => expect(await journalSecretForPairing(db)).toBeTruthy(), { timeout: 5000 });
    await user.click(await screen.findByRole("button", { name: "Pair another device" }));
    expect(await screen.findByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    view.unmount();
    expect(document.body.innerHTML).not.toContain("Pairing code");
    render(<SyncPage controller={controller} />);
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Pair another device" }));
    const qr = await screen.findByRole("img", { name: "Pairing code" });
    const text = pairingTextV2({ token, secret: await deriveJournalSecret(PASSPHRASE), serverUrl: ADDRESS });
    expect(qr.querySelector("path")!.getAttribute("d")).toBe(qrPath(qrModules(text)));
    expect(screen.queryByText(SYNC_ONLY_NOTE)).toBeNull();
    expect(await everythingStored()).not.toContain(PASSPHRASE);
  });

  it("a journal key from before the re-key update: a sync-only code with a note; the passphrase field then brings the journal along", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    await confirmedDevice(db, await keyFor(PASSPHRASE)); // key only, no copy of S
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Pair another device" }));
    const qr = await screen.findByRole("img", { name: "Pairing code" });
    expect(qr.querySelector("path")!.getAttribute("d")).toBe(qrPath(qrModules(pairingTextV2({ token, secret: null, serverUrl: ADDRESS }))));
    expect(screen.getByText(SYNC_ONLY_NOTE)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide" }));

    // Typing the passphrase shows the v1 code, and keeps this device's copy of S for next time.
    await user.type(screen.getByLabelText("Passphrase for the pairing code"), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Show pairing code" }));
    const v1 = await screen.findByRole("img", { name: "Pairing code" });
    expect(v1.querySelector("path")!.getAttribute("d")).toBe(qrPath(qrModules(pairingText(PASSPHRASE))));
    await user.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(async () => expect(await journalSecretForPairing(db)).toBeTruthy(), { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: "Pair another device" }));
    const full = await screen.findByRole("img", { name: "Pairing code" });
    expect(full.querySelector("path")!.getAttribute("d")).toBe(
      qrPath(qrModules(pairingTextV2({ token, secret: await deriveJournalSecret(PASSPHRASE), serverUrl: ADDRESS }))),
    );
    expect(screen.queryByText(SYNC_ONLY_NOTE)).toBeNull();
    expect(await everythingStored()).not.toContain(PASSPHRASE);
  });

  it("a code made while the page went to the background is not shown", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    setup();
    const button = await screen.findByRole("button", { name: "Pair another device" });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      fireEvent.click(button);
      await new Promise((r) => setTimeout(r, 300));
      expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
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

  it("a code from a passphrase that doesn't open this journal says the journal may ask (review M4)", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    await confirmedDevice(db, await keyFor("fake-first-passphrase-of-this-journal")); // no wrap for PASSPHRASE here
    setup();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Passphrase for the pairing code"), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Show pairing code" }));
    const qr = await screen.findByRole("img", { name: "Pairing code" });
    expect(qr.querySelector("path")!.getAttribute("d")).toBe(qrPath(qrModules(pairingText(PASSPHRASE))));
    expect(screen.getByText(JOURNAL_MAY_ASK_NOTE)).toBeInTheDocument();
  });

  it("'Show pairing code' refuses a passphrase over 1024 characters", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    setup();
    const field = await screen.findByLabelText("Passphrase for the pairing code");
    fireEvent.change(field, { target: { value: "p".repeat(3000) } });
    fireEvent.click(screen.getByRole("button", { name: "Show pairing code" }));
    expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
    expect(field).toHaveValue("");
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
    // A plain field: a password field would let the browser offer to save the code (review M5).
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
    expect(field).toHaveAttribute("autocapitalize", "off");
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

describe("scan or paste a v2 code (no passphrase)", () => {
  /** A Mac that syncs with PASSPHRASE: the v2 text it would show (the server has the journal's verifier). */
  async function macCode(server: FakeSyncServer, opts: { secret?: boolean; serverUrl?: string | null } = {}) {
    const jk = await keyFor(PASSPHRASE);
    const verifier = await verifierRow(jk);
    server.rows.set("journal\u0000verifier", {
      table: "journal", id: "verifier", updatedAt: 1_700_000_000_000, deviceId: "the-mac-device", seq: ++server.seq,
      data: JSON.stringify({ ...verifier, updatedAt: 1_700_000_000_000 }),
    });
    const secret = opts.secret === false ? null : await deriveJournalSecret(PASSPHRASE);
    return pairingTextV2({ token, secret, serverUrl: opts.serverUrl === undefined ? ADDRESS : opts.serverUrl });
  }

  it("scanned: saves the code's token and address, opens the journal, never derives anything from a passphrase", async () => {
    const { stop } = fakeCamera();
    const { server } = setup();
    const text = await macCode(server);
    vi.mocked(readFrame).mockResolvedValue(text);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Scan pairing code" }));
    // A new device and an address other than the usual one: she is asked first, in plain words.
    const ask = await screen.findByRole("group", { name: "Sync address in the code" });
    expect(ask).toHaveTextContent(ADDRESS);
    expect(stop).toHaveBeenCalled();
    expect(await getMeta(db, "token")).toBeUndefined();
    await user.click(screen.getByRole("button", { name: CONFIRM_ADDRESS_BUTTON }));
    await waitFor(async () => expect(await getMeta(db, "token")).toBe(token), { timeout: 5000 });
    expect(await getMeta(db, "serverUrl")).toBe(ADDRESS);
    expect(screen.getByLabelText("Sync address")).toHaveValue(ADDRESS);
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    await waitFor(() => expect(server.syncRequests.length).toBeGreaterThan(0));
    await waitFor(async () => expect((await loadJournalKey(db))?.fp).toBe((await keyFor(PASSPHRASE)).fp), { timeout: 5000 });
    expect(saveJournalKeyFromSync).not.toHaveBeenCalled();
    expect(await everythingStored()).not.toContain(text.slice(18));
    expect(document.body.innerHTML).not.toContain(text.slice(18, 40));
    // And it can show the code on to the next device straight away.
    await user.click(await screen.findByRole("button", { name: "Pair another device" }));
    expect(await screen.findByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    expect(screen.queryByText(SYNC_ONLY_NOTE)).toBeNull();
  });

  it("pasted, with the usual address left out: uses the usual address", async () => {
    const { server } = setup();
    const text = await macCode(server, { serverUrl: null });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Paste pairing code"), text);
    await user.click(screen.getByRole("button", { name: "Use pairing code" }));
    await waitFor(async () => expect(await getMeta(db, "token")).toBe(token), { timeout: 5000 });
    expect(await getMeta(db, "serverUrl")).toBe("https://esmeworld-sync.esme-brain.workers.dev");
  });

  it("a sync-only code sets up sync; the journal stays locked here", async () => {
    const { server } = setup();
    const text = await macCode(server, { secret: false });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Paste pairing code"), text);
    await user.click(screen.getByRole("button", { name: "Use pairing code" }));
    await user.click(await screen.findByRole("button", { name: CONFIRM_ADDRESS_BUTTON }));
    await waitFor(async () => expect(await getMeta(db, "token")).toBe(token), { timeout: 5000 });
    await waitFor(() => expect(server.syncRequests.length).toBeGreaterThan(0));
    expect(await loadJournalKey(db)).toBeUndefined();
  });

  it("a code with an address this app can't use is refused; nothing is saved", async () => {
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Paste pairing code"), pairingTextV2({ token, secret: null, serverUrl: "http://sync.example.test" }));
    await user.click(screen.getByRole("button", { name: "Use pairing code" }));
    expect(await screen.findByText("That pairing code's sync address can't be used here.")).toBeInTheDocument();
    expect(await getMeta(db, "token")).toBeUndefined();
  });

  it("a new device: Cancel on the address question saves nothing", async () => {
    const { server } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Paste pairing code"), await macCode(server));
    await user.click(screen.getByRole("button", { name: "Use pairing code" }));
    const ask = await screen.findByRole("group", { name: "Sync address in the code" });
    await user.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Sync address in the code" })).toBeNull();
    expect(await getMeta(db, "token")).toBeUndefined();
    expect(await getMeta(db, "serverUrl")).toBeUndefined();
    expect(server.syncRequests).toHaveLength(0);
  });
});

describe("a device that already syncs only takes a code that matches it (review C1)", () => {
  /** This device syncs with ADDRESS and has its journal key (confirmed by a real first sync). */
  async function syncing() {
    const { server, controller } = setup();
    const user = await setAddress();
    await saveTyped(user);
    await waitFor(async () => expect(await journalSecretForPairing(db)).toBeTruthy(), { timeout: 5000 });
    return { server, controller, user };
  }
  const snapshot = async () => JSON.stringify({
    token: await getMeta(db, "token"), url: await getMeta(db, "serverUrl"), key: (await db.syncMeta.get("journalKey"))?.value && (await loadJournalKey(db))?.fp,
    candidate: !!(await db.syncMeta.get("journalCandidate")), journal: (await db.journal.toArray()).map((r) => [r.id, r.fp]),
  });

  it("another address: refused in plain words, nothing changed, nothing sent there", async () => {
    const { user } = await syncing();
    const before = await snapshot();
    const evil = pairingTextV2({ token, secret: await deriveJournalSecret("fake-other-journal"), serverUrl: "https://elsewhere.example.test" });
    await user.type(screen.getByLabelText("Paste pairing code"), evil);
    await user.click(screen.getByRole("button", { name: "Use pairing code" }));
    expect(await screen.findByText(otherAddressLine("https://elsewhere.example.test"))).toBeInTheDocument();
    // The way forward is said too (review RM4).
    expect(otherAddressLine("https://elsewhere.example.test")).toContain("Stop syncing on this device");
    expect(screen.queryByRole("group", { name: "Sync address in the code" })).toBeNull();
    expect(await snapshot()).toBe(before);
  });

  it("its own address but another journal's secret: refused, nothing changed", async () => {
    const { user } = await syncing();
    const before = await snapshot();
    await user.type(screen.getByLabelText("Paste pairing code"), pairingTextV2({ token, secret: await deriveJournalSecret("fake-other-journal"), serverUrl: ADDRESS }));
    await user.click(screen.getByRole("button", { name: "Use pairing code" }));
    expect(await screen.findByText(OTHER_JOURNAL)).toBeInTheDocument();
    expect(await snapshot()).toBe(before);
  });

  it("locked, with an older retired key and nothing here to prove the code: sync is saved, and it says to type the passphrase once (review RI1)", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token: await deriveToken("fake-old-passphrase-before-a-change") });
    const older = await keyFor("fake-older-losing-key");
    await db.syncMeta.put({ key: "journalRetired", value: [{ key: older.key, mac: older.mac, fp: older.fp }] });
    setup();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Paste pairing code"), pairingTextV2({ token, secret: await deriveJournalSecret(PASSPHRASE), serverUrl: ADDRESS }));
    await user.click(screen.getByRole("button", { name: "Use pairing code" }));
    expect(await screen.findByText(TYPE_PASSPHRASE_ONCE)).toBeInTheDocument();
    expect(screen.queryByText(OTHER_JOURNAL)).toBeNull();
    await waitFor(async () => expect(await getMeta(db, "token")).toBe(token));
    expect(await db.syncMeta.get("journalCandidate")).toBeUndefined();
  });

  it("its own address and journal: accepted with no question; the journal key is left exactly as it was", async () => {
    const { user, server } = await syncing();
    const keyBefore = (await db.syncMeta.get("journalKey"))!.value;
    const sent = server.syncRequests.length;
    await user.type(screen.getByLabelText("Paste pairing code"), pairingTextV2({ token, secret: await deriveJournalSecret(PASSPHRASE), serverUrl: ADDRESS }));
    await user.click(screen.getByRole("button", { name: "Use pairing code" }));
    await waitFor(() => expect(server.syncRequests.length).toBeGreaterThan(sent));
    expect(screen.queryByRole("group", { name: "Sync address in the code" })).toBeNull();
    expect((await db.syncMeta.get("journalKey"))!.value).toEqual(keyBefore);
    expect(await db.syncMeta.get("journalCandidate")).toBeUndefined();
  });
});

describe("showing a code in the Mac app needs Touch ID or the Mac password (review I2)", () => {
  type W = { webkit?: { messageHandlers?: Record<string, unknown> } };
  afterEach(() => Reflect.deleteProperty(window as W, "webkit"));
  function macApp(reply?: unknown) {
    const postMessage = vi.fn(async () => reply);
    (window as W).webkit = { messageHandlers: { esmeworldReminders: { postMessage: vi.fn(async () => ({ status: "denied" })) }, ...(reply === undefined ? {} : { esmeworldDeviceOwner: { postMessage } }) } };
    return postMessage;
  }

  it("refused: no code; allowed: the code; the passphrase field needs no check", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const ask = macApp({ ok: false });
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Pair another device" }));
    expect(await screen.findByText(OWNER_REFUSED)).toBeInTheDocument();
    expect(ask).toHaveBeenCalledWith({ action: "confirm" });
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();

    ask.mockResolvedValue({ ok: true });
    await user.click(screen.getByRole("button", { name: "Pair another device" }));
    expect(await screen.findByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide" }));

    ask.mockClear();
    await user.type(screen.getByLabelText("Passphrase for the pairing code"), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: "Show pairing code" }));
    expect(await screen.findByRole("img", { name: "Pairing code" })).toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
  });

  it("allowed, but the window doesn't get its focus back: the code is shown anyway, never nothing (review RM5)", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    macApp({ ok: true });
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Pair another device" }));
    expect(await screen.findByRole("img", { name: "Pairing code" }, { timeout: 6000 })).toBeInTheDocument();
  }, 15_000);

  it("a Mac app without the check never shows a one-tap code", async () => {
    await saveSyncSettings(db, { serverUrl: ADDRESS, token });
    macApp();
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Pair another device" }));
    expect(await screen.findByText(OWNER_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Pairing code" })).toBeNull();
  });
});

describe("scanning safeguards", () => {
  it("a double tap on Scan asks for the camera once; Scan is disabled while it starts", async () => {
    let resolve!: (s: MediaStream) => void;
    const stop = vi.fn();
    const track = { stop } as unknown as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((r) => (resolve = r)));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    render(<ScanPairingCode onCode={vi.fn()} />);
    const scan = screen.getByRole("button", { name: "Scan pairing code" });
    fireEvent.click(scan);
    fireEvent.click(scan);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(scan).toBeDisabled();
    await act(async () => resolve(stream));
    expect(await screen.findByLabelText("Camera")).toBeInTheDocument();
    expect(stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("a camera that arrives after leaving the page is stopped at once", async () => {
    let resolve!: (s: MediaStream) => void;
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(() => new Promise<MediaStream>((r) => (resolve = r))) },
    });
    const view = render(<ScanPairingCode onCode={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan pairing code" }));
    view.unmount();
    await act(async () => resolve(stream));
    expect(stop).toHaveBeenCalled();
  });

  it("if the scanner can't load: stops the camera and the loop, says to paste instead", async () => {
    const { stop } = fakeCamera();
    vi.mocked(readFrame).mockRejectedValue(new Error("chunk failed to load"));
    render(<ScanPairingCode onCode={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan pairing code" }));
    expect(await screen.findByText(SCANNER_FAILED)).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
    expect(screen.queryByLabelText("Camera")).toBeNull();
    const reads = vi.mocked(readFrame).mock.calls.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(vi.mocked(readFrame).mock.calls.length).toBe(reads);
  });

  it("a code read while busy is kept and used once busy clears (never dropped)", async () => {
    const { stop } = fakeCamera();
    vi.mocked(readFrame).mockResolvedValue(pairingText(PASSPHRASE));
    const onPassphrase = vi.fn();
    const view = render(<ScanPairingCode onCode={onPassphrase} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan pairing code" }));
    await screen.findByLabelText("Camera");
    view.rerender(<ScanPairingCode onCode={onPassphrase} busy />);
    await waitFor(() => expect(stop).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 200));
    expect(onPassphrase).not.toHaveBeenCalled();
    view.rerender(<ScanPairingCode onCode={onPassphrase} busy={false} />);
    await waitFor(() => expect(onPassphrase).toHaveBeenCalledTimes(1));
    expect(onPassphrase).toHaveBeenCalledWith({ v: 1, passphrase: PASSPHRASE });
    view.rerender(<ScanPairingCode onCode={onPassphrase} busy />);
    view.rerender(<ScanPairingCode onCode={onPassphrase} busy={false} />);
    expect(onPassphrase).toHaveBeenCalledTimes(1);
  });
});

describe("scan a pairing code (Journal, Unlock journal)", () => {
  it("unlocks exactly as typing the passphrase would (the verifier rule unchanged)", async () => {
    const jk = await keyFor(PASSPHRASE);
    const other = await keyFor("fake-other-device-passphrase");
    await db.journal.put(await verifierRow(other)); // another passphrase's journal is here
    const { stop } = fakeCamera();
    vi.mocked(readFrame).mockResolvedValue(pairingText(PASSPHRASE));
    renderApp("/journal/morning", "2026-10-28");
    await userEvent.click(await screen.findByRole("button", { name: "Scan pairing code" }));
    // Not the journal's passphrase: refused just like a typed one.
    expect(await screen.findByText(/That passphrase doesn't open your journal/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(unlockJournal).toHaveBeenCalledWith(db, PASSPHRASE);
    expect(stop).toHaveBeenCalled();
    expect(await loadJournalKey(db)).toBeUndefined();

    // The right one, pasted: the journal opens.
    await db.journal.put(await verifierRow(jk)); // now this passphrase's journal
    await userEvent.type(await screen.findByLabelText("Paste pairing code"), pairingText(PASSPHRASE));
    await userEvent.click(screen.getByRole("button", { name: "Use pairing code" }));
    expect(await screen.findByLabelText("Today's morning page", {}, { timeout: 5000 })).toBeInTheDocument(); // open
    expect((await loadJournalKey(db))!.fp).toBe(jk.fp);
    expect(await everythingStored()).not.toContain(PASSPHRASE);
  });
  it("a v2 code opens it the same way (its journal secret must open the verifier); a sync-only code says so", async () => {
    const jk = await keyFor(PASSPHRASE);
    await db.journal.put(await verifierRow(jk));
    await saveSyncSettings(db, { serverUrl: DEFAULT_SYNC_URL, token });
    vi.spyOn(globalThis, "fetch").mockImplementation(new FakeSyncServer(token).fetch); // the app's own syncs
    renderApp("/journal/morning", "2026-10-28");
    const field = await screen.findByLabelText("Paste pairing code");
    // A code for another sync address: refused, nothing changed.
    await userEvent.type(field, pairingTextV2({ token, secret: await deriveJournalSecret(PASSPHRASE), serverUrl: "https://elsewhere.example.test" }));
    await userEvent.click(screen.getByRole("button", { name: "Use pairing code" }));
    expect(await screen.findByText(CODE_REFUSED_LINE)).toBeInTheDocument();
    expect(await loadJournalKey(db)).toBeUndefined();
    await userEvent.type(field, pairingTextV2({ token, secret: null, serverUrl: null }));
    await userEvent.click(screen.getByRole("button", { name: "Use pairing code" }));
    expect(await screen.findByText("That pairing code doesn't include your journal. Type your passphrase instead.")).toBeInTheDocument();
    await userEvent.type(field, pairingTextV2({ token, secret: await deriveJournalSecret("fake-other-journal"), serverUrl: null }));
    await userEvent.click(screen.getByRole("button", { name: "Use pairing code" }));
    // Another journal's secret: refused too (it doesn't open the verifier here).
    await waitFor(() => expect(screen.getAllByText(CODE_REFUSED_LINE)).toHaveLength(1));
    expect(await loadJournalKey(db)).toBeUndefined();
    expect(await db.syncMeta.get("journalCandidate")).toBeUndefined();
    await userEvent.type(field, pairingTextV2({ token, secret: await deriveJournalSecret(PASSPHRASE), serverUrl: null }));
    await userEvent.click(screen.getByRole("button", { name: "Use pairing code" }));
    expect(await screen.findByLabelText("Today's morning page", {}, { timeout: 5000 })).toBeInTheDocument();
    expect((await loadJournalKey(db))!.fp).toBe(jk.fp);
    expect(unlockJournal).not.toHaveBeenCalled();
  }, 20_000);
});

describe("the phone's automatic update waits (fix round 1, M2)", () => {
  it("while a pairing code is shown for another device to scan", () => {
    const { unmount } = render(<PairingCode text={pairingText(PASSPHRASE)} onHide={() => {}} />);
    expect(currentUpdateHold()).toBe("pairing");
    unmount();
    expect(currentUpdateHold()).toBeNull();
  });

  it("while the camera scanner is on", async () => {
    fakeCamera();
    const { unmount } = render(<ScanPairingCode onCode={() => {}} />);
    expect(currentUpdateHold()).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Scan pairing code" }));
    await screen.findByLabelText("Camera");
    expect(currentUpdateHold()).toBe("camera");
    unmount();
    expect(currentUpdateHold()).toBeNull();
  });
});
