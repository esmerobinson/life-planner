// TEST-ONLY helpers for the Together link's tests. Every value is made up.
import { db } from "../data/db";
import { FakeSupabase } from "./fakeSupabase";
import { signInToTogether, sendToTogether } from "./sender";

export const ME = "00000000-0000-4000-8000-0000000000e5";
export const PARTNER = "00000000-0000-4000-8000-0000000000b0";
export const COUPLE = "00000000-0000-4000-8000-00000000c0c0";
export const EMAIL = "esme-pretend@example.test";
export const PASSWORD = "pretend-together-password-7";

export async function emptyDb(): Promise<void> {
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.journal.clear(), db.syncMeta.clear(), db.pending.clear(), db.quarantine.clear()]);
}

/** A settable clock (local time strings, as the app's 3am day uses local time). */
export function clock(start: string) {
  let t = new Date(start).getTime();
  return {
    now: () => t,
    set: (s: string) => void (t = new Date(s).getTime()),
    advance: (ms: number) => void (t += ms),
  };
}

export type Clock = ReturnType<typeof clock>;

export function fakeTogether(c: Clock): FakeSupabase {
  const fake = new FakeSupabase();
  fake.now = c.now;
  fake.addUser(EMAIL, PASSWORD, ME, COUPLE);
  fake.addUser("partner-pretend@example.test", "pretend-partner-password", PARTNER, COUPLE);
  return fake;
}

export async function signedIn(c: Clock): Promise<FakeSupabase> {
  const fake = fakeTogether(c);
  const r = await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD });
  if (r.kind !== "ok") throw new Error(`sign-in failed: ${JSON.stringify(r)}`);
  return fake;
}

export const send = (fake: FakeSupabase, c: Clock, retryRefused = false) => sendToTogether({ fetch: fake.fetch, now: c.now, retryRefused });

export const restCalls = (fake: FakeSupabase) => fake.requests.filter((r) => r.url.includes("/rest/v1/"));

/** Every string in a parsed JSON value (keys too), however deep. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.push(k), strings(x, out));
  return out;
}

/**
 * A fetch that fails the test the moment any request holds one of `forbidden`: in its address
 * (as sent and decoded), its headers, its raw body, or any string inside the body once parsed
 * (so text with line breaks, quotes or backslashes, which JSON escapes, is still caught). A body
 * that isn't a string fails at once (it couldn't be checked). Every request is kept in `seen`.
 */
export function guardedFetch(inner: typeof fetch, forbidden: () => string[]) {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (init.body !== undefined && init.body !== null && typeof init.body !== "string") throw new Error("FORBIDDEN: a body the recorder can't read");
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const body = typeof init.body === "string" ? init.body : "";
    seen.push({ url, headers, body });
    let parsed: string[] = [];
    try {
      parsed = body ? strings(JSON.parse(body)) : [];
    } catch {
      parsed = [];
    }
    let decoded = url;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      /* keep as sent */
    }
    const places = [url, decoded, JSON.stringify(headers), ...Object.values(headers), body, ...parsed];
    for (const bad of forbidden()) {
      if (bad && places.some((p) => p.includes(bad))) throw new Error(`FORBIDDEN content was about to be sent: ${JSON.stringify(bad.slice(0, 40))}`);
    }
    return inner(input, init);
  }) as typeof fetch;
  return { fetch: f, seen };
}

export const DEVICE = "device-pretend-mac-01";

/**
 * A journal day on this device: an exercise card submitted and/or a finished check-in (first
 * question answered, second skipped). Returns the key. Made-up cards and words.
 */
export async function journalDay(day: string, opts: { exercise?: boolean; checkin?: boolean; learned?: string } = { exercise: true, checkin: true }) {
  const { db } = await import("../data/db");
  const repo = await import("../data/repo");
  const { parseCardFile } = await import("../journal/exercise");
  const { PROMPTS } = await import("../journal/prompts");
  const { confirmedDevice, keyFor } = await import("../test/journalKey");
  const { FAKE_CARD_TEXT_BOOKS } = await import("../test/exerciseCards");
  const jk = await keyFor("fake-journal-together");
  await confirmedDevice(db, jk);
  const set = parseCardFile(FAKE_CARD_TEXT_BOOKS)!;
  if (!(await db.journal.get("cards"))) await repo.importExerciseCards(jk, set, day);
  const card = set.cards.find((c) => c.id === "b-001")!;
  if (opts.exercise) await repo.submitExerciseEntry(jk, day, DEVICE, repo.cardRef(card), "Pretend exercise answer");
  if (opts.learned) await repo.saveLearned(jk, day, DEVICE, opts.learned);
  if (opts.checkin) {
    await repo.ensureCheckinSet(jk, day, [PROMPTS[0]!.id, PROMPTS[1]!.id]);
    await repo.saveAnswer(jk, day, PROMPTS[0]!.id, DEVICE, "Pretend check-in answer", true);
    await repo.moveAnswerOn(jk, day, PROMPTS[1]!.id, DEVICE, { skip: true });
  }
  return { jk, set, card, q1: PROMPTS[0]!, q2: PROMPTS[1]! };
}
