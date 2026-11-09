// TESTING (Life Planner - Together Link Testing): Together must never block or break sync or the
// journal. Together unreachable, hung, 401/403, 500, malformed replies, offline at the 3am day
// change, signed out: the journal still saves at once, sync still syncs, no retry storm, no
// unhandled rejection, nothing lost or double-sent when it comes back. Fakes only; every value
// made up. Tests named "BUG:" were expected to fail on together-link @2a6edb2 (fixed since).
// Challenge model (2026-11-09): one row per day in her challenge, checked with liveDays / liveNote.

import { db } from "../data/db";
import { cardRef, saveAnswer, saveLearned, saveSharePrivate, submitExerciseEntry } from "../data/repo";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { PROMPTS } from "../journal/prompts";
import { TogetherRunner, type SyncWatch } from "./runner";
import { sendToTogether, signInToTogether, stopTogether } from "./sender";
import { readAuth, TOGETHER_META } from "./store";
import { clock, DEVICE, EMAIL, emptyDb, fakeTogether, journalDay, liveDays, liveNote, PASSWORD, type Clock } from "./testKit";
import type { FakeSupabase } from "./fakeSupabase";

const DAY = "2026-11-04";
const SIGN_IN = `${DAY}T10:00:00`;
const TITLES_AT = "2026-11-05T03:30:00";
const ANSWERS_AT = "2026-11-06T03:30:00";
const SYNC_TOKEN = "5ec7".padEnd(64, "b"); // fake

type Mode = "up" | "down" | "500" | "hang" | "401" | "403" | "html200";

/** Hung requests across tests, let go after each test (the lock queue is module-wide). */
const hangers: (() => void)[] = [];

/** The fake Together behind a switch: up, unreachable, erroring or never answering. */
function switchable(fake: FakeSupabase) {
  const state = { mode: "up" as Mode, calls: 0, hung: 0 };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    state.calls++;
    switch (state.mode) {
      case "down":
        throw new TypeError("Failed to fetch");
      case "500":
        return new Response(JSON.stringify({ message: "fake: down for a bit" }), { status: 500 });
      case "401":
        return new Response(JSON.stringify({ message: "fake: no" }), { status: 401 });
      case "403":
        return new Response(JSON.stringify({ code: "42501", message: "fake: not allowed" }), { status: 403 });
      case "html200":
        return new Response("<html>pretend portal page</html>", { status: 200, headers: { "Content-Type": "text/html" } });
      case "hang":
        state.hung++;
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          hangers.push(() => reject(new TypeError("Failed to fetch")));
        });
      default:
        return fake.fetch(input, init);
    }
  }) as typeof fetch;
  return { state, fetch: fetchFn };
}

function fakeSync(): SyncWatch & { finish(): void } {
  let state = { status: "idle", lastSyncedAt: 1 as number | null };
  const fns = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (fn) => (fns.add(fn), () => fns.delete(fn)),
    finish() {
      state = { status: "idle", lastSyncedAt: (state.lastSyncedAt ?? 0) + 1 };
      for (const fn of fns) fn();
    },
  };
}

/** Resolves to the value, or "timeout" after `ms` of real time. */
const within = <T,>(p: Promise<T>, ms: number): Promise<T | "timeout"> =>
  Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => void unhandled.push(e);
beforeAll(() => void process.on("unhandledRejection", onUnhandled));
afterAll(() => void process.off("unhandledRejection", onUnhandled));
beforeEach(async () => {
  unhandled.length = 0;
  await emptyDb();
});
afterEach(async () => {
  vi.useRealTimers();
  for (const let_go of hangers.splice(0)) let_go();
  await new Promise((r) => setTimeout(r, 20));
  expect(unhandled).toEqual([]);
});

async function setUp(c: Clock) {
  const fake = fakeTogether(c);
  const sw = switchable(fake);
  const env = { fetch: sw.fetch, now: c.now };
  const day = await journalDay(DAY, { exercise: true, checkin: true });
  expect(await signInToTogether(env, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
  return { fake, sw, env, ...day };
}

for (const mode of ["down", "500"] as const) {
  it(`Together ${mode === "down" ? "unreachable" : "answering 500"} for two days: one request a run at most, nothing forgotten; back again, each day goes once`, async () => {
    const c = clock(SIGN_IN);
    const { fake, sw, env } = await setUp(c);
    sw.state.mode = mode;
    for (const at of ["2026-11-05T03:30:00", "2026-11-05T03:31:00", "2026-11-05T12:00:00", "2026-11-06T03:30:00", "2026-11-06T09:00:00"]) {
      c.set(at);
      const before = sw.state.calls;
      expect(await sendToTogether(env)).toEqual({ kind: "offline" });
      expect(sw.state.calls - before).toBeLessThanOrEqual(1);
    }
    expect((await readAuth(db))!.refreshToken).toBeTruthy(); // not signed out by an outage
    sw.state.mode = "up";
    expect(await sendToTogether(env)).toMatchObject({ kind: "ok", refused: 0 });
    expect(await sendToTogether(env)).toMatchObject({ kind: "ok", sent: 0 }); // replay sends nothing
    expect(liveDays(fake)).toHaveLength(1);
    expect(fake.days.size).toBe(1);
    // Past the delay already: the answers went straight away (no titles stage needed).
    expect(liveNote(fake, DAY)).toContain("Pretend check-in answer");
  });
}

it("offline at the 3am day change: the titles go once it's back, once", async () => {
  const c = clock(SIGN_IN);
  const { fake, sw, env } = await setUp(c);
  c.set("2026-11-05T03:00:30");
  sw.state.mode = "down";
  expect(await sendToTogether(env)).toEqual({ kind: "offline" });
  c.set("2026-11-05T10:00:00");
  sw.state.mode = "up";
  expect(await sendToTogether(env)).toMatchObject({ kind: "ok" });
  expect(fake.days.size).toBe(1);
  expect(JSON.stringify(fake.requests)).not.toContain("Pretend check-in answer");
});

it("a send cut off half-way (503 on the second day's insert) carries on next run without duplicates", async () => {
  const c = clock(SIGN_IN);
  await journalDay("2026-11-03", { checkin: true });
  const { fake, sw, env } = await setUp(c);
  c.set(TITLES_AT);
  let inserts = 0;
  const inner = sw.fetch;
  const cut = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST" && String(input).includes("challenge_days") && ++inserts === 2) return new Response("{}", { status: 503 });
    return inner(input, init);
  }) as typeof fetch;
  expect(await sendToTogether({ ...env, fetch: cut })).toEqual({ kind: "offline" });
  expect(fake.days.size).toBe(1);
  expect(await sendToTogether(env)).toMatchObject({ kind: "ok" });
  expect(liveDays(fake).map((d) => d.day)).toEqual(["2026-11-03", DAY]);
  expect(fake.days.size).toBe(2);
});

it("signed out in Together (401, refresh refused): asks once, then sends nothing at all; signing in again sends nothing twice", async () => {
  const c = clock(SIGN_IN);
  const { fake, sw, env } = await setUp(c);
  c.set(TITLES_AT);
  expect(await sendToTogether(env)).toMatchObject({ kind: "ok" });
  const days = JSON.stringify([...fake.days.values()]);
  c.set("2026-11-05T09:00:00");
  sw.state.mode = "401";
  expect(await sendToTogether(env)).toEqual({ kind: "needs-sign-in" });
  const n = sw.state.calls;
  for (let i = 0; i < 5; i++) expect(await sendToTogether(env)).toEqual({ kind: "needs-sign-in" });
  expect(sw.state.calls).toBe(n); // no storm: nothing is tried until she signs in
  sw.state.mode = "up";
  expect(await signInToTogether(env, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
  expect(await sendToTogether(env)).toMatchObject({ kind: "ok", sent: 0 });
  expect(JSON.stringify([...fake.days.values()])).toBe(days);
});

it("403 on everything: set aside, no storm (at most one request a run), back to normal on Send now", async () => {
  const c = clock(SIGN_IN);
  const { fake, sw, env } = await setUp(c);
  c.set(TITLES_AT);
  // Token still fresh, so only the REST calls get the 403 (a refused refresh rightly signs her out).
  await db.syncMeta.put({ key: TOGETHER_META, value: { ...(await readAuth(db))!, expiresAt: Date.parse("2099-01-01") } });
  sw.state.mode = "403";
  expect(await sendToTogether(env)).toMatchObject({ kind: "ok" });
  for (let i = 0; i < 3; i++) {
    const before = sw.state.calls;
    await sendToTogether(env);
    expect(sw.state.calls - before).toBeLessThanOrEqual(1);
  }
  sw.state.mode = "up";
  expect(await sendToTogether({ ...env, retryRefused: true })).toMatchObject({ kind: "ok", refused: 0 });
  expect(liveDays(fake)).toHaveLength(1);
});

it("malformed replies (an HTML page with 200): no throw, no unhandled rejection, recovers on Send now without duplicates", async () => {
  const c = clock(SIGN_IN);
  const { fake, sw, env } = await setUp(c);
  c.set(TITLES_AT);
  // Token still fresh (no refresh), so the REST calls get the HTML page.
  await db.syncMeta.put({ key: TOGETHER_META, value: { ...(await readAuth(db))!, expiresAt: Date.parse("2099-01-01") } });
  sw.state.mode = "html200";
  const out = await sendToTogether(env);
  expect(["ok", "offline"]).toContain(out.kind);
  sw.state.mode = "up";
  await sendToTogether({ ...env, retryRefused: true });
  await sendToTogether({ ...env, retryRefused: true });
  expect(fake.days.size).toBe(1); // one row for the day, never two
  expect(liveDays(fake)).toHaveLength(1);
});

it("not signed in at all: no request, ever", async () => {
  const c = clock(SIGN_IN);
  const fake = fakeTogether(c);
  const sw = switchable(fake);
  await journalDay(DAY);
  for (const at of [TITLES_AT, ANSWERS_AT]) {
    c.set(at);
    expect(await sendToTogether({ fetch: sw.fetch, now: c.now })).toEqual({ kind: "off" });
  }
  expect(sw.state.calls).toBe(0);
});

it("Together hung (never answers): sync still syncs, the journal still saves at once, no Dexie transaction is held, no storm", async () => {
  const c = clock(SIGN_IN);
  const { sw, env, jk, card, q1 } = await setUp(c);
  c.set(ANSWERS_AT);
  sw.state.mode = "hang";
  const sync = fakeSync();
  const runner = new TogetherRunner((o) => sendToTogether({ ...env, retryRefused: o.retryRefused }));
  const stop = runner.start(sync);
  sync.finish(); // a sync run finished: the sender starts and hangs on Together
  await new Promise((r) => setTimeout(r, 50));
  expect(sw.state.hung).toBe(1);

  // The journal: check-in Finish, exercise Submit, a private tick, what I learned, all at once.
  const t0 = performance.now();
  expect(await within(saveAnswer(jk, "2026-11-06", q1.id, DEVICE, "Pretend later answer", true), 2000)).not.toBe("timeout");
  expect(await within(submitExerciseEntry(jk, "2026-11-06", DEVICE, cardRef(card), "Pretend later exercise"), 2000)).not.toBe("timeout");
  expect(await within(saveSharePrivate(jk, "2026-11-06", "checkin", true), 2000)).not.toBe("timeout");
  expect(await within(saveLearned(jk, "2026-11-06", DEVICE, "Pretend learned later"), 2000)).not.toBe("timeout");
  expect(performance.now() - t0).toBeLessThan(2000);
  // No transaction on any table is held open by the hung send.
  expect(await within(db.transaction("rw", [db.journal, db.syncMeta, db.items, db.pending], async () => db.syncMeta.put({ key: "pretend-probe", value: 1 })), 2000)).not.toBe("timeout");

  // The sync engine still syncs (journal rows included) while Together hangs.
  const server = new FakeSyncServer(SYNC_TOKEN);
  await saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: SYNC_TOKEN });
  expect((await within(syncOnce({ db, fetch: server.fetch }), 5000)) as { kind: string }).toMatchObject({ kind: "ok" });
  expect(JSON.stringify(server.requests)).toContain("share:2026-11-06:checkin");

  // More sync runs finishing don't pile up more sends (no storm).
  for (let i = 0; i < 5; i++) sync.finish();
  await new Promise((r) => setTimeout(r, 50));
  expect(sw.state.hung).toBe(1);
  stop();
  void PROMPTS;
});

it("BUG: while a Together request hangs, \"Stop copying to Together\" (without removing) and signing in again still work", async () => {
  const c = clock(SIGN_IN);
  const { sw, env } = await setUp(c);
  c.set(TITLES_AT);
  sw.state.mode = "hang";
  void sendToTogether(env); // the run after a sync, stuck on Together
  await new Promise((r) => setTimeout(r, 50));
  // Stopping needs no request at all, yet it waits behind the hung run's Together lock.
  const stopped = await within(stopTogether(env, { markDeleted: false }), 2000);
  sw.state.mode = "up";
  const signIn = await within(signInToTogether(env, { url: "https://together.example.test", anonKey: "fake-anon-key-for-tests-only", email: EMAIL, password: PASSWORD }), 2000);
  expect({ stopped, signIn }).toEqual({ stopped: { kind: "ok" }, signIn: { kind: "ok" } });
}, 10_000);

it("BUG: a Together request that never answers is given up on, so copying carries on by itself once Together is back", async () => {
  const c = clock(SIGN_IN);
  const { fake, sw, env } = await setUp(c);
  c.set(TITLES_AT);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    sw.state.mode = "hang";
    const sync = fakeSync();
    const runner = new TogetherRunner((o) => sendToTogether({ ...env, retryRefused: o.retryRefused }));
    const stop = runner.start(sync);
    sync.finish();
    await vi.waitFor(() => expect(sw.state.hung).toBe(1)); // the request is out, and hangs
    await vi.advanceTimersByTimeAsync(10 * 60_000); // ten minutes: any sane timeout has fired
    sw.state.mode = "up";
    sync.finish(); // the next sync run finishes with Together back
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await within(new Promise((r) => runner.subscribe(() => !runner.getState().running && r(null))), 2000);
    stop();
    expect(liveDays(fake)).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
}, 10_000);
