// TESTING (Life Planner - Together Link Testing, round-2 recheck, 2026-11-05): new holes in the
// round-2 fixes for #42 (tick re-read before every insert) and #44 (requests time out; Stop and
// Sign in abort the send in flight). A request that is cut off (timed out, or aborted by Stop)
// may already have been carried out by Together: the reply is what's lost, not the insert.
// Fakes only, every value made up. Tests named "BUG:" fail on together-link @855c21d.

import { saveSharePrivate } from "../data/repo";
import { REQUEST_TIMEOUT_MS } from "./client";
import { togetherId } from "./ids";
import { sendToTogether, signInToTogether, stopTogether } from "./sender";
import { clock, EMAIL, emptyDb, journalDay, PASSWORD, send, signedIn, type Clock } from "./testKit";
import type { FakeSupabase } from "./fakeSupabase";

const DAY = "2026-11-04";
const SIGN_IN = `${DAY}T10:00:00`;
const TITLES_AT = "2026-11-05T03:30:00";
const ANSWERS_AT = "2026-11-06T03:30:00";
const ANSWER = "Pretend check-in answer"; // journalDay's made-up check-in words

beforeEach(emptyDb);
afterEach(() => void vi.useRealTimers());

const habit = (kind: "exercise" | "checkin") => togetherId("habit", kind, 1);
const tallyId = (v: number) => togetherId("tally", `checkin:${DAY}`, v);
const isEventInsert = (init?: RequestInit, url?: string) => init?.method === "POST" && String(url).includes("/rest/v1/todo_events");

/** Every tally in Together that isn't deleted and holds her check-in answers. */
async function liveAnswers(fake: FakeSupabase) {
  return fake.liveTallies(await habit("checkin")).filter((e) => String(e.note ?? "").includes(ANSWER));
}

/** Signed in, DAY's check-in done, and its titles-only tally (v1) in Together. */
async function titlesSent() {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  c.set(TITLES_AT);
  expect((await send(fake, c)).kind).toBe("ok");
  expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);
  expect(await liveAnswers(fake)).toHaveLength(0);
  c.set(ANSWERS_AT);
  return { c, fake, jk };
}

/**
 * Together carries out the answers insert, but its reply never comes back: the request hangs
 * until it is aborted (Stop, Sign in, or the 30 s time limit). `out()` resolves once it hangs.
 */
function insertAppliedThenHangs(fake: FakeSupabase) {
  let hung!: () => void;
  const out = new Promise<void>((r) => (hung = r));
  let armed = true;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (armed && isEventInsert(init, String(input))) {
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

describe("a send cut off after the delete, with the insert done in Together but its reply lost", () => {
  async function cutOff() {
    const t = await titlesSent();
    // The titles tally is deleted; the answers insert reaches Together; the reply is lost.
    t.fake.inject({ lostReply: true, when: (r) => r.method === "POST" && r.url.includes("/rest/v1/todo_events") });
    expect((await send(t.fake, t.c)).kind).toBe("offline");
    expect(await liveAnswers(t.fake), "set-up: the answers are in Together").toHaveLength(1);
    return t;
  }

  it("next run: exactly one tally for the day, no duplicate", async () => {
    const { c, fake } = await cutOff();
    expect((await send(fake, c)).kind).toBe("ok");
    expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);
    expect(await liveAnswers(fake)).toHaveLength(1);
    expect(fake.todos.get(await habit("checkin"))!.tally).toBe(1);
  });

  it("ticked private before the next run: the next run hides the answers; one titles-only tally left", async () => {
    const { c, fake, jk } = await cutOff();
    await saveSharePrivate(jk, DAY, "checkin", true);
    expect((await send(fake, c)).kind).toBe("ok");
    expect(await liveAnswers(fake)).toHaveLength(0);
    expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);
  });

  it("BUG: \"Stop copying to Together\" with removing, before the next run: nothing of hers is left live in Together", async () => {
    const { c, fake } = await cutOff();
    expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).toEqual({ kind: "ok" });
    expect(fake.todos.get(await habit("checkin"))!.deleted_at, "the habit is removed").toBeTruthy();
    expect(await liveAnswers(fake), "her answers are still a live tally in Together").toHaveLength(0);
  });
});

describe("Stop during a hang", () => {
  it("Stop without removing, while the answers insert hangs: returns at once, and nothing more is sent", async () => {
    const { c, fake } = await titlesSent();
    const h = insertAppliedThenHangs(fake);
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out;
    const before = fake.requests.length;
    expect(await stopTogether({ fetch: h.fetch, now: c.now }, { markDeleted: false })).toEqual({ kind: "ok" });
    expect((await run).kind).toBe("offline");
    expect(fake.requests.length, "a request went after Stop").toBe(before);
  });

  it("BUG: ticked private, then \"Stop copying\" with removing while the answers insert hangs: her answers aren't left in Together, not even after signing in again later", async () => {
    const { c, fake, jk } = await titlesSent();
    const h = insertAppliedThenHangs(fake);
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out; // Together has the answers; the app is still waiting for its reply
    await saveSharePrivate(jk, DAY, "checkin", true); // she changes her mind
    const stopped = await stopTogether({ fetch: h.fetch, now: c.now }, { markDeleted: true });
    await run;
    expect(stopped).toEqual({ kind: "ok" });
    const afterStop = (await liveAnswers(fake)).length;

    // Weeks later she signs in again (same Together account).
    c.set("2026-11-20T10:00:00");
    expect(await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
    expect((await send(fake, c)).kind).toBe("ok");
    const habitRow = fake.todos.get(await habit("checkin"))!;
    expect({
      liveAfterStop: afterStop,
      liveAfterSignInAgain: (await liveAnswers(fake)).length,
      habitShownAgain: !habitRow.deleted_at,
    }).toEqual({ liveAfterStop: 0, liveAfterSignInAgain: 0, habitShownAgain: true });
  });
});

// ---- (b) #42: the tick during a retry, and un-tick / re-tick ------------------------------------

it("#42: ticked private during the retry after an id clash (the taken id being deleted): the answers never go", async () => {
  const { c, fake, jk } = await titlesSent();
  // v2's id is already taken in Together (a reply lost long ago), so the insert clashes, the
  // taken row is deleted (a round trip) and v3 is tried. She ticks during that delete.
  fake.events.set(await tallyId(2), {
    id: await tallyId(2), couple_id: "00000000-0000-4000-8000-00000000c0c0", todo_id: await habit("checkin"),
    user_id: "00000000-0000-4000-8000-0000000000e5", kind: "tally", at: `${DAY}T12:00:00.000Z`, note: null, deleted_at: null,
  });
  const v2 = await tallyId(2);
  let tickedAt = -1;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (tickedAt < 0 && init?.method === "PATCH" && String(input).includes(v2)) {
      await saveSharePrivate(jk, DAY, "checkin", true);
      tickedAt = fake.requests.length;
    }
    return fake.fetch(input, init);
  }) as typeof fetch;
  expect((await sendToTogether({ fetch: f, now: c.now })).kind).toBe("ok");
  expect(tickedAt, "set-up: the retry happened").toBeGreaterThan(0);
  expect(fake.requests.slice(tickedAt).map((r) => r.body).join("\n")).not.toContain(ANSWER);
  expect(await liveAnswers(fake)).toHaveLength(0);
  expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);
});

it("#42: un-ticked, then re-ticked during that very send: the answers never go; toggled again and again, Together always ends as the last tick says, one tally", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  await saveSharePrivate(jk, DAY, "checkin", true);
  c.set(TITLES_AT);
  await send(fake, c);
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(await liveAnswers(fake)).toHaveLength(0);

  // Un-ticked; the run deletes the titles tally; during that round trip she ticks again.
  await saveSharePrivate(jk, DAY, "checkin", false);
  let tickedAt = -1;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (tickedAt < 0 && init?.method === "PATCH" && String(input).includes("todo_events")) {
      await saveSharePrivate(jk, DAY, "checkin", true);
      tickedAt = fake.requests.length;
    }
    return fake.fetch(input, init);
  }) as typeof fetch;
  await sendToTogether({ fetch: f, now: c.now });
  expect(tickedAt).toBeGreaterThan(0);
  expect(fake.requests.slice(tickedAt).map((r) => r.body).join("\n")).not.toContain(ANSWER);
  expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);

  for (const on of [false, true, false, true, true, false, true]) {
    await saveSharePrivate(jk, DAY, "checkin", on);
    expect((await send(fake, c)).kind).toBe("ok");
    expect(fake.liveTallies(await habit("checkin")), `one tally after tick=${on}`).toHaveLength(1);
    expect((await liveAnswers(fake)).length, `answers live after tick=${on}`).toBe(on ? 0 : 1);
  }
});

// ---- #44: the time limit itself ------------------------------------------------------------------

describe("#44: the 30 s time limit", () => {
  async function slowInsert(c: Clock, fake: FakeSupabase, answerAfterMs: number | null) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let out!: () => void;
    const started = new Promise<void>((r) => (out = r));
    let armed = true;
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (armed && isEventInsert(init, String(input))) {
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
    const s = await slowInsert(c, fake, null);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 100);
    expect(s.isDone(), "gave up before 30 s").toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    expect(await s.run).toEqual({ kind: "offline" });
  });

  it("a slow answer inside 30 s (20 s) is taken, not cut off", async () => {
    const { c, fake } = await titlesSent();
    const s = await slowInsert(c, fake, 20_000);
    await vi.advanceTimersByTimeAsync(20_100);
    vi.useRealTimers();
    expect((await s.run).kind).toBe("ok");
    expect(await liveAnswers(fake)).toHaveLength(1);
    expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);
  });
});

