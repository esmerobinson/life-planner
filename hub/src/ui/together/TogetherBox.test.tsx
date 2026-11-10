import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { readLearned, readSharePrivate } from "../../data/repo";
import { todayISO } from "../../domain/dates";
import { SyncController } from "../../sync/controller";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { makeRunner } from "../../together/runner";
import { readAuth } from "../../together/store";
import { clock, EMAIL, emptyDb, fakeTogether, journalDay, PASSWORD } from "../../together/testKit";
import { LearnedToday } from "./LearnedToday";
import { PrivateDayTick } from "./PrivateDayTick";
import { TogetherBox } from "./TogetherBox";
import { TOGETHER_WORDS as W } from "./wording";

// The Together box, the private tick and the "what I learned" box (placeholder looks). Made-up values only.

beforeEach(emptyDb);

function setup() {
  const c = clock("2026-11-04T10:00:00");
  const fake = fakeTogether(c);
  fake.now = () => Date.now(); // the box runs on the real clock
  const runner = makeRunner(fake.fetch);
  render(<TogetherBox runner={runner} fetchFn={fake.fetch} />);
  return { fake, runner };
}

async function signIn(fake: ReturnType<typeof fakeTogether>, password = PASSWORD) {
  const form = screen.getByRole("form", { name: "Sign in to Together" });
  await userEvent.type(within(form).getByLabelText(W.address), fake.url);
  await userEvent.type(within(form).getByLabelText(W.anonKey), fake.anonKey);
  await userEvent.type(within(form).getByLabelText(W.email), EMAIL);
  await userEvent.type(within(form).getByLabelText(W.password), password);
  await userEvent.click(within(form).getByRole("button", { name: W.signIn }));
}

it("never signed in: only what it is and the sign-in form; no Together lines, no private ticks", async () => {
  setup();
  expect(screen.getByText(W.intro)).toBeInTheDocument();
  expect(screen.getByText(W.onlyThisDevice)).toBeInTheDocument();
  for (const t of [W.privateWarning, W.notEncrypted, W.howItSends]) expect(screen.queryByText(t)).toBeNull();
  expect(screen.queryByText(W.privateHeading)).toBeNull();
  expect(W.intro).toContain("To-dos never go");
});

it("signed in: says plainly what goes (her challenge, no habits), that it goes on Send now, that private or editing replaces and removing only hides", async () => {
  const { fake } = setup();
  await signIn(fake);
  await screen.findByText(W.copying);
  for (const t of [W.privateWarning, W.notEncrypted, W.howItSends, W.onlyThisDevice]) expect(screen.getByText(t)).toBeInTheDocument();
  expect(screen.getByText(W.howItSends)).toHaveClass("together-warning"); // magenta placeholder
  expect(W.intro).toContain("“Mental Health Work” challenge");
  expect(document.body.textContent).not.toMatch(/habit/i);
  expect(W.howItSends).toBe("Press Send now to copy your Mental health exercise and Daily check-in to Together. Days you tick private send only titles and questions.");
  // Sending is manual: nothing about waiting, past days or a second button.
  expect(document.body.textContent).not.toMatch(/24 hours|Past days|Send everything|Send past/);
  expect(W.privateWarning).toMatch(/replaces that day's entry/);
  expect(W.privateWarning).toMatch(/only marked deleted there: it isn't wiped/);
});

it("a press as it goes, or one that stopped part way: \"Sent N of M days\" (placeholder look); a finished one says nothing more", async () => {
  const { fake } = setup();
  await signIn(fake);
  await screen.findByText(W.copying);
  const { readSent, saveSent } = await import("../../together/store");
  await saveSent(db, { ...(await readSent(db))!, progress: { done: 12, total: 30 } });
  const line = await screen.findByText("Sent 12 of 30 days");
  expect(line).toHaveClass("together-warning");
  await saveSent(db, { ...(await readSent(db))!, progress: { done: 30, total: 30 } });
  await waitFor(() => expect(screen.queryByText(/^Sent \d+ of \d+ days?$/)).toBeNull());
  expect(W.progress(1, 1)).toBe("Sent 1 of 1 day");
});

it("no challenge found in Together: says so plainly; days she logged by hand and a backlog are said too", async () => {
  const { fake } = setup();
  await signIn(fake);
  await screen.findByText(W.copying);
  const { readSent, saveSent } = await import("../../together/store");
  await saveSent(db, { ...(await readSent(db))!, challengeMissing: true, byHand: { "2026-11-01": true, "2026-11-02": true }, backlog: true });
  expect(await screen.findByText(W.challengeMissing)).toBeInTheDocument();
  expect(W.challengeMissing).toBe("Couldn't find your “BPD research” challenge in Together.");
  expect(screen.getByText(W.byHand(2))).toBeInTheDocument();
  expect(screen.getByText(W.backlog)).toBeInTheDocument();
});

it("after a backup was restored and sync hasn't caught up: says so (bug #65)", async () => {
  const { fake } = setup();
  await signIn(fake);
  await screen.findByText(W.copying);
  const { readSent, saveSent } = await import("../../together/store");
  await saveSent(db, { ...(await readSent(db))!, waitingRestore: true });
  expect(await screen.findByText(W.restoreWaiting)).toBeInTheDocument();
});

it("signs in; the password is cleared from the field and kept nowhere", async () => {
  const { fake } = setup();
  await signIn(fake);
  expect(await screen.findByText(W.copying)).toBeInTheDocument();
  expect(await readAuth(db)).toBeTruthy();
  expect(JSON.stringify(await db.syncMeta.toArray())).not.toContain(PASSWORD);
});

it("a wrong password: says so, clears the field, keeps nothing", async () => {
  const { fake } = setup();
  await signIn(fake, "pretend-wrong");
  expect(await screen.findByRole("alert")).toHaveTextContent(/didn't accept/);
  expect(screen.getByLabelText(W.password)).toHaveValue("");
  expect(await readAuth(db)).toBeUndefined();
});

it("Send now; a login Together no longer accepts shows \"Sign in to Together again\"", async () => {
  const { fake } = setup();
  await signIn(fake);
  await userEvent.click(await screen.findByRole("button", { name: W.sendNow }));
  expect(await screen.findByText(/^Last copied/)).toBeInTheDocument();
  fake.expireAccessTokens();
  fake.revokeRefreshTokens();
  await db.syncMeta.put({ key: "together", value: { ...(await readAuth(db))!, expiresAt: 0 } });
  await userEvent.click(screen.getByRole("button", { name: W.sendNow }));
  expect(await screen.findByText(W.signInAgain)).toBeInTheDocument();
  expect(screen.getByLabelText(W.address)).toHaveValue(fake.url); // only email and password to type again
});

it("Stop copying offers (doesn't force) marking everything deleted", async () => {
  const { fake } = setup();
  await signIn(fake);
  await userEvent.click(await screen.findByRole("button", { name: W.stop }));
  const offer = screen.getByLabelText(W.stopMarkDeleted);
  expect(offer).not.toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: W.stopConfirm }));
  expect(await screen.findByText(W.stopped)).toBeInTheDocument();
  expect(await readAuth(db)).toBeUndefined();
});

it("a day's private ticks in the box (once signed in), sealed in the journal, with the warning beside them", async () => {
  const jk = await keyFor("fake-journal-box");
  await confirmedDevice(db, jk);
  const { fake } = setup();
  await signIn(fake);
  const tick = await screen.findByLabelText(W.privateCheckin);
  await waitFor(() => expect(tick).toBeEnabled());
  await userEvent.click(tick);
  await waitFor(async () => expect(await readSharePrivate(jk, todayISO())).toEqual({ exercise: false, checkin: true }));
  expect(screen.getAllByText(W.privateWarning).length).toBeGreaterThanOrEqual(3);
});

it("the Journal's tick: syncs at once when saved, says what Oliver still sees, and says when it hasn't reached other devices", async () => {
  const jk = await keyFor("fake-journal-box");
  await confirmedDevice(db, jk);
  const controller = new SyncController({ db, fetch: () => Promise.reject(new TypeError("offline")) });
  await db.syncMeta.put({ key: "token", value: "fake-token" });
  await db.syncMeta.put({ key: "serverUrl", value: "https://sync.example.test" });
  await controller.reload();
  const syncNow = vi.spyOn(controller, "syncNow");
  await db.syncMeta.put({ key: "together", value: { url: "https://together.example.test", anonKey: "x", userId: "u", coupleId: "c" } }); // Together in use here
  render(<PrivateDayTick jk={jk} date="2026-11-04" part="checkin" controller={controller} />);
  const tick = await screen.findByLabelText(W.privateTick);
  await waitFor(() => expect(tick).toBeEnabled());
  expect(screen.getByText(W.oliverSeesCheckin)).toBeInTheDocument();
  expect(screen.getByText(W.privateWarning)).toBeInTheDocument();
  await userEvent.click(tick);
  await waitFor(() => expect(syncNow).toHaveBeenCalled());
  expect(await screen.findByText(W.notSyncedYet)).toBeInTheDocument();
  expect((await readSharePrivate(jk, "2026-11-04")).checkin).toBe(true);
});

describe("what I learned today", () => {
  const DAY = "2026-11-04";
  const ME = "device-pretend-mac-01";

  async function box() {
    const { jk } = await journalDay(DAY, {});
    const view = render(<LearnedToday jk={jk} today={DAY} deviceId={ME} />);
    const field = await screen.findByLabelText(W.learnedLabel);
    return { jk, view, field };
  }

  it("saves itself after a pause in typing, sealed", async () => {
    const { jk, field } = await box();
    await userEvent.type(field, "Pretend learned");
    await waitFor(async () => expect((await readLearned(jk, DAY)).text).toBe("Pretend learned"), { timeout: 3000 });
    expect(JSON.stringify(await db.journal.where("kind").equals("learned").toArray())).not.toContain("Pretend");
  });

  it("saves on leaving the box and when the app is hidden; shows again after a reload", async () => {
    const { jk, field, view } = await box();
    fireEvent.change(field, { target: { value: "Pretend on blur" } });
    fireEvent.blur(field);
    await waitFor(async () => expect((await readLearned(jk, DAY)).text).toBe("Pretend on blur"));
    fireEvent.change(field, { target: { value: "Pretend on hide" } });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await waitFor(async () => expect((await readLearned(jk, DAY)).text).toBe("Pretend on hide"));
    view.unmount();
    render(<LearnedToday jk={jk} today={DAY} deviceId={ME} />);
    expect(await screen.findByDisplayValue("Pretend on hide")).toBeInTheDocument();
  });

  it("saves what was typed when the box goes away (tab switched)", async () => {
    const { jk, field, view } = await box();
    fireEvent.change(field, { target: { value: "Pretend on unmount" } });
    view.unmount();
    await waitFor(async () => expect((await readLearned(jk, DAY)).text).toBe("Pretend on unmount"));
  });

  it("earlier days are listed under it", async () => {
    const { jk } = await journalDay(DAY, {});
    const { saveLearned } = await import("../../data/repo");
    await saveLearned(jk, "2026-11-02", ME, "Pretend earlier lesson");
    render(<LearnedToday jk={jk} today={DAY} deviceId={ME} />);
    await userEvent.click(await screen.findByText(W.learnedEarlier));
    expect(screen.getByText("Pretend earlier lesson")).toBeInTheDocument();
  });
});

it("the Journal's tick where Together isn't in use: the tick, but no Together lines", async () => {
  const jk = await keyFor("fake-journal-box");
  await confirmedDevice(db, jk);
  render(<PrivateDayTick jk={jk} date="2026-11-04" part="exercise" />);
  const tick = await screen.findByLabelText(W.privateTick);
  await waitFor(() => expect(tick).toBeEnabled());
  expect(screen.queryByText(W.oliverSeesExercise)).toBeNull();
  expect(screen.queryByText(W.privateWarning)).toBeNull();
  await userEvent.click(tick); // a tick saved (on any device) means Together is in use
  expect(await screen.findByText(W.oliverSeesExercise)).toBeInTheDocument();
});
