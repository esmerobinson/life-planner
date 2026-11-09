// TESTING (Life Planner - Together Link Testing, round-2 recheck, 2026-11-05): new holes in the
// round-2 fixes for #42 (tick re-read before every write) and #44 (requests time out; Stop and
// Sign in abort the send in flight). A request that is cut off (timed out, or aborted by Stop)
// may already have been carried out by Together: the reply is what's lost, not the write.
// Converted to the challenge model (2026-11-09): one `challenge_days` row per day, its note
// overwritten at the 24 h stage. Fakes only, every value made up. The test named "BUG:" failed
// on together-challenge @6ecc463 (a lost overwrite reply).

import { saveSharePrivate } from "../data/repo";
import { REQUEST_TIMEOUT_MS } from "./client";
import { togetherId } from "./ids";
import { sendToTogether, signInToTogether, stopTogether } from "./sender";
import { CHALLENGE, clock, COUPLE, dayRow, EMAIL, emptyDb, journalDay, liveDays, liveNote, ME, PASSWORD, send, signedIn, type Clock } from "./testKit";
import type { FakeSupabase } from "./fakeSupabase";

const DAY = "2026-11-04";
const EARLIER = "2026-11-03";
const SIGN_IN = `${DAY}T10:00:00`;
const TITLES_AT = "2026-11-05T03:30:00";
const ANSWERS_AT = "2026-11-06T03:30:00";
const ANSWER = "Pretend check-in answer"; // journalDay's made-up check-in words

beforeEach(emptyDb);
afterEach(() => void vi.useRealTimers());

const isDayWrite = (init?: RequestInit, url?: string) => (init?.method === "POST" || init?.method === "PATCH") && String(url).includes("/rest/v1/challenge_days");

/** Her answers are in a live row in Together (any day). */
function liveAnswers(fake: FakeSupabase) {
  return liveDays(fake).filter((d) => String(d.note ?? "").includes(ANSWER));
}

/** Her answers anywhere in Together, deleted rows included. */
const answersAnywhere = (fake: FakeSupabase) => JSON.stringify([...fake.days.values()]).includes(ANSWER);

/** Signed in, DAY's check-in done, and its titles-only row in Together. */
async function titlesSent() {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  c.set(TITLES_AT);
  expect((await send(fake, c)).kind).toBe("ok");
  expect(liveDays(fake)).toHaveLength(1);
  expect(liveAnswers(fake)).toHaveLength(0);
  c.set(ANSWERS_AT);
  return { c, fake, jk };
}

/**
 * Together carries out the answers write, but its reply never comes back: the request hangs
 * until it is aborted (Stop, Sign in, or the 30 s time limit). `out()` resolves once it hangs.
 */
function writeAppliedThenHangs(fake: FakeSupabase) {
  let hung!: () => void;
  const out = new Promise<void>((r) => (hung = r));
  let armed = true;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (armed && isDayWrite(init, String(input))) {
      armed = false;
      await fake.fetch(input, init); // done in Together
      hung();
      return new Promise<Response>((_, reject) => {
        const s = init?.signal;
        if (s?.aborted) reject(new DOMException("aborted", "AbortError"));
        s?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return fake.fetch(input, init);
  }) as typeof fetch;
  return { fetch: fetchFn, out };
}

// ---- (c) a request cut off part-way through a send ----------------------------------------------

describe("a send cut off with the answers written in Together but the reply lost", () => {
  async function cutOff() {
    const t = await titlesSent();
    t.fake.inject({ lostReply: true, when: (r) => r.method === "PATCH" && r.url.includes("/rest/v1/challenge_days") });
    expect((await send(t.fake, t.c)).kind).toBe("offline");
    expect(liveAnswers(t.fake), "set-up: the answers are in Together").toHaveLength(1);
    return t;
  }

  it("next run: exactly one row for the day, no duplicate", async () => {
    const { c, fake } = await cutOff();
    expect((await send(fake, c)).kind).toBe("ok");
    expect(fake.days.size).toBe(1);
    expect(liveAnswers(fake)).toHaveLength(1);
  });

  it("BUG: ticked private before the next run: the next run overwrites the answers; the titles-only row left", async () => {
    const { c, fake, jk } = await cutOff();
    await saveSharePrivate(jk, DAY, "checkin", true);
    expect((await send(fake, c)).kind).toBe("ok");
    expect(liveDays(fake)).toHaveLength(1);
    expect(answersAnywhere(fake)).toBe(false);
  });

  it("\"Stop copying to Together\" with removing, before the next run: nothing of hers is left live in Together", async () => {
    const { c, fake } = await cutOff();
    expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).toEqual({ kind: "ok" });
    expect(dayRow(fake, DAY)!.deleted_at, "the day is removed").toBeTruthy();
    expect(liveAnswers(fake), "her answers are still live in Together").toHaveLength(0);
    expect(fake.challenges.get(CHALLENGE)!.deleted_at, "her challenge itself stays").toBeNull();
  });
});

describe("Stop during a hang", () => {
  it("Stop without removing, while the answers write hangs: returns at once, and nothing more is sent", async () => {
    const { c, fake } = await titlesSent();
    const h = writeAppliedThenHangs(fake);
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out;
    const before = fake.requests.length;
    expect(await stopTogether({ fetch: h.fetch, now: c.now }, { markDeleted: false })).toEqual({ kind: "ok" });
    expect((await run).kind).toBe("offline");
    expect(fake.requests.length, "a request went after Stop").toBe(before);
  });

  it("ticked private, then \"Stop copying\" with removing while the answers write hangs: her answers aren't left in Together, not even after signing in again later", async () => {
    const { c, fake, jk } = await titlesSent();
    const h = writeAppliedThenHangs(fake);
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out; // Together has the answers; the app is still waiting for its reply
    await saveSharePrivate(jk, DAY, "checkin", true); // she changes her mind
    const stopped = await stopTogether({ fetch: h.fetch, now: c.now }, { markDeleted: true });
    await run;
    expect(stopped).toEqual({ kind: "ok" });
    const afterStop = liveAnswers(fake).length;

    // Weeks later she signs in again (same Together account).
    c.set("2026-11-20T10:00:00");
    expect(await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
    expect((await send(fake, c)).kind).toBe("ok");
    expect({
      liveAfterStop: afterStop,
      liveAfterSignInAgain: liveAnswers(fake).length,
      dayShownAgain: !dayRow(fake, DAY)!.deleted_at,
      rows: fake.days.size,
    }).toEqual({ liveAfterStop: 0, liveAfterSignInAgain: 0, dayShownAgain: true, rows: 1 });
    // The private day's row went back to titles only (overwritten, not just hidden).
    expect(liveNote(fake, DAY)).not.toContain(ANSWER);
  });
});

// ---- (b) #42: the tick during a retry, and un-tick / re-tick ------------------------------------

it("#42: ticked private during the retry after a clash (our row already there): the answers never go", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  // Our row for the day is already in Together (from before this record: a Stop, then signing in
  // again), so the insert clashes and the row is overwritten by id instead. She ticks during that
  // round trip.
  const id = await togetherId("day", `${CHALLENGE}:${DAY}`, 1);
  fake.days.set(id, { id, couple_id: COUPLE, challenge_id: CHALLENGE, day: DAY, note: "Pretend old note", by: ME, deleted_at: "2026-11-05T00:00:00.000Z" });
  c.set(ANSWERS_AT);
  let tickedAt = -1;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (tickedAt < 0 && init?.method === "POST" && String(input).includes("challenge_days")) {
      const res = await fake.fetch(input, init); // the clash
      await saveSharePrivate(jk, DAY, "checkin", true);
      tickedAt = fake.requests.length;
      return res;
    }
    return fake.fetch(input, init);
  }) as typeof fetch;
  expect((await sendToTogether({ fetch: f, now: c.now })).kind).toBe("ok");
  expect(tickedAt, "set-up: the clash happened").toBeGreaterThan(0);
  expect(fake.requests.slice(tickedAt).map((r) => r.body).join("\n")).not.toContain(ANSWER);
  expect(answersAnywhere(fake)).toBe(false);
  expect(fake.days.size).toBe(1);
  expect(liveDays(fake)).toHaveLength(1);
});

it("#42: un-ticked, then re-ticked during that very send (before the day's write): the answers never go; toggled again and again, Together always ends as the last tick says, one row", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  await journalDay(EARLIER, { checkin: true });
  for (const d of [EARLIER, DAY]) await saveSharePrivate(jk, d, "checkin", true);
  c.set(TITLES_AT);
  await send(fake, c);
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(liveAnswers(fake)).toHaveLength(0);

  // Both un-ticked; the run writes EARLIER first; during that round trip she ticks DAY again.
  for (const d of [EARLIER, DAY]) await saveSharePrivate(jk, d, "checkin", false);
  let tickedAt = -1;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (tickedAt < 0 && init?.method === "PATCH" && String(input).includes("challenge_days")) {
      await saveSharePrivate(jk, DAY, "checkin", true);
      tickedAt = fake.requests.length;
    }
    return fake.fetch(input, init);
  }) as typeof fetch;
  await sendToTogether({ fetch: f, now: c.now });
  expect(tickedAt).toBeGreaterThan(0);
  expect(liveNote(fake, EARLIER), "set-up: the first write was EARLIER's").toContain(ANSWER);
  expect(liveNote(fake, DAY)).not.toContain(ANSWER);
  expect(fake.requests.slice(tickedAt).filter((r) => r.body.includes(DAY) || r.url.includes(String(dayRow(fake, DAY)!.id))).map((r) => r.body).join("\n")).not.toContain(ANSWER);

  for (const on of [false, true, false, true, true, false, true]) {
    await saveSharePrivate(jk, DAY, "checkin", on);
    expect((await send(fake, c)).kind).toBe("ok");
    expect(fake.days.size, `one row a day after tick=${on}`).toBe(2);
    expect(String(liveNote(fake, DAY)).includes(ANSWER), `answers live after tick=${on}`).toBe(!on);
  }
  expect(String(dayRow(fake, DAY)!.note)).not.toContain(ANSWER); // overwritten, not kept underneath
});

// ---- #44: the time limit itself ------------------------------------------------------------------

describe("#44: the 30 s time limit", () => {
  async function slowWrite(c: Clock, fake: FakeSupabase, answerAfterMs: number | null) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let out!: () => void;
    const started = new Promise<void>((r) => (out = r));
    let armed = true;
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (armed && isDayWrite(init, String(input))) {
        armed = false;
        out();
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          if (answerAfterMs !== null) setTimeout(() => void fake.fetch(input, init).then(resolve, reject), answerAfterMs);
        });
      }
      return fake.fetch(input, init);
    }) as typeof fetch;
    let done = false;
    const run = sendToTogether({ fetch: f, now: c.now }).then((r) => ((done = true), r));
    await started;
    return { run, isDone: () => done };
  }

  it("a request that never answers is given up on at 30 s, not before", async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    const { c, fake } = await titlesSent();
    const s = await slowWrite(c, fake, null);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 100);
    expect(s.isDone(), "gave up before 30 s").toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    expect(await s.run).toEqual({ kind: "offline" });
  });

  it("a slow answer inside 30 s (20 s) is taken, not cut off", async () => {
    const { c, fake } = await titlesSent();
    const s = await slowWrite(c, fake, 20_000);
    await vi.advanceTimersByTimeAsync(20_100);
    vi.useRealTimers();
    expect((await s.run).kind).toBe("ok");
    expect(liveAnswers(fake)).toHaveLength(1);
    expect(fake.days.size).toBe(1);
  });
});
