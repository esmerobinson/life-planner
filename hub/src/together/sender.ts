// The Together sender: signs in, refreshes, and logs the Mental health exercise and Daily
// check-in days in her existing Together challenge ("BPD research", renamed once to "Mental
// Health Work"; challenge brief, Esme 2026-11-09): one `challenge_days` row per day, its note
// holding both parts (journalNotes.ts). Each row counts towards the challenge exactly like a
// "Log today" she made by hand. Nothing else goes: no to-dos, no habits. One way only: nothing is
// read back except her couple id and which challenge is hers.
// It runs after a sync run has finished (never during one: what it sends is read under the sync
// lock) and on "Send now", one tab at a time (a Web Lock).
//
// When a day goes, in two stages (review C1: a private tick made on another device must never
// lose the race):
// 1. After the day ends (the 3am day change): titles and questions only.
// 2. ANSWERS_DELAY_MS later, and only for a part that isn't ticked private (read again right
//    before sending): the note is overwritten with her answers and research notes.
// Past days (before the sign-in, or before this update first ran) wait ANSWERS_DELAY_MS after
// that moment before their answers go, so she can tick any old day private first (2026-11-08).
//
// - The note can be overwritten (challenge_days: only `note` and `deleted_at` change), so a
//   private tick or an edit after sending really replaces the text there.
// - Every row's id is fixed (ids.ts). created_at / updated_at / by are never sent.
// - One row per day (unique challenge and day). A day she already logged by hand in Together is
//   left exactly as she wrote it, and never tried again.
// - A record per day (store.ts) says what went, so a run sends only what changed. At most
//   MAX_WRITES_PER_RUN rows are written per run (a big backfill goes over several runs).
// - Offline or a server error: stop, try again next run. One row refused: set aside (counted on
//   the box), the rest goes on. A 401: one refresh is tried; if that fails too, or a refresh is
//   refused, stop, forget the tokens and ask her to sign in again. Nothing else is affected.
// - What an earlier build made (two habit to-dos and their tallies) is marked deleted once, then
//   forgotten. To-dos are never written otherwise.

import { db as appDb, type HubDB } from "../data/db";
import { readSharePrivate } from "../data/repo";
import { readSyncGate, withSyncLock } from "../data/syncGate";
import { formerDeviceIds } from "../data/deviceIds";
import { getDeviceId } from "../sync/engine";
import { todayISO } from "../domain/dates";
import type { ISODate } from "../domain/types";
import type { JournalKey } from "../journal/crypto";
import { loadJournalKey } from "../journal/keyStore";
import { coupleOf, normaliseTogetherUrl, refreshSession, rest, signInWithPassword, validTogetherUrl, type CallResult, type Fetch } from "./client";
import { togetherId } from "./ids";
import { dayNote, PART_HEADINGS, PART_SUMMARY, PARTS, readJournalDays, type DayNote, type DayNotes, type JournalDays, type Part } from "./journalNotes";
import {
  readAuth, readSent, saveSent, TOGETHER_META, TOGETHER_SENT_META, withTogetherLock,
  type SentDay, type TogetherAuth, type TogetherSent,
} from "./store";

/**
 * How long after a day ends (3am) her answers follow the titles: 24 hours (review C1; approved
 * by Esme 2026-11-05). Until then only the titles and questions are in Together.
 */
export const ANSWERS_DELAY_MS = 24 * 60 * 60 * 1000;

/** The challenge's name once renamed (Esme, 2026-11-09). */
export const CHALLENGE_NAME = "Mental Health Work";
/** Her challenge, found by name (trimmed, any case) or by its id. */
const CHALLENGE_NAMES = ["bpd research", "mental health work"];
const CHALLENGE_IDS = ["bpd-research"];

/** At most this many day rows written in one run (Together polls every 5 s; Supabase isn't flooded). */
export const MAX_WRITES_PER_RUN = 50;

/** Refresh this long before the access token runs out. */
const REFRESH_MARGIN_MS = 60_000;

export type SendOutcome =
  | { kind: "off" }
  | { kind: "needs-sign-in" }
  /** Another tab is sending right now. */
  | { kind: "busy" }
  | { kind: "offline" }
  | { kind: "ok"; sent: number; refused: number };

export interface SendEnv {
  fetch: Fetch;
  now?: () => number;
  /** "Send now": rows set aside are tried again. */
  retryRefused?: boolean;
}

class Stop extends Error {
  constructor(readonly why: "auth" | "transient") {
    super(why);
  }
}

// ---- the run in flight (bug #44) -----------------------------------------------------------------

/** The send in flight on this tab, so Stop and Sign in never wait behind a hung request. */
let running: AbortController | null = null;

/** Gives up the send in flight on this tab (its requests end at once, the run stops). */
function abortRunning(): void {
  running?.abort();
}

/** `fetchFn` with this run's abort signal joined to every request's own (its time limit). */
function withSignal(fetchFn: Fetch, signal: AbortSignal): Fetch {
  return (input, init = {}) => {
    const own = init.signal;
    if (!own) return fetchFn(input, { ...init, signal });
    const both = new AbortController();
    for (const s of [own, signal]) {
      if (s.aborted) both.abort();
      else s.addEventListener("abort", () => both.abort(), { once: true });
    }
    return fetchFn(input, { ...init, signal: both.signal });
  };
}

// ---- sign in / out ----------------------------------------------------------------------------

export type SignInResult = { kind: "ok" } | { kind: "error"; message: string };

/** Provisional wording (Esme may reword). */
export const SIGN_IN_MESSAGES = {
  badAddress: "That Together address doesn't look right. It starts with https://.",
  refused: "Together didn't accept that email and password.",
  offline: "Couldn't reach Together. Check the connection and try again.",
  noCouple: "That Together login isn't part of a couple yet.",
  busy: "Together is busy in another tab. Try again in a moment.",
};

/** Provisional wording (Esme may reword). */
export const NEEDS_SIGN_IN = "Sign in to Together again";
export const notRemoved = (n: number) =>
  `${n === 1 ? "1 thing" : `${n} things`} couldn't be removed from Together. Try again, or stop without removing them.`;

/**
 * Signs in with her Together email and password. The password is used for this one request and
 * never kept. Stores only the address, anon key, her user and couple ids and the tokens.
 */
export async function signInToTogether(
  env: SendEnv, form: { url: string; anonKey: string; email: string; password: string },
): Promise<SignInResult> {
  if (!validTogetherUrl(form.url)) return { kind: "error", message: SIGN_IN_MESSAGES.badAddress };
  const url = normaliseTogetherUrl(form.url);
  const anonKey = form.anonKey.trim();
  const now = env.now ?? Date.now;
  const db = appDb;
  abortRunning(); // a send stuck on Together never keeps her from signing in
  const out = await withTogetherLock(db, async (): Promise<SignInResult> => {
    const s = await signInWithPassword(env.fetch, url, anonKey, form.email.trim(), form.password, now());
    if (s.kind === "transient") return { kind: "error", message: SIGN_IN_MESSAGES.offline };
    if (s.kind === "refused") return { kind: "error", message: SIGN_IN_MESSAGES.refused };
    const c = await coupleOf(env.fetch, { url, anonKey, accessToken: s.session.accessToken }, s.session.userId);
    if (c.kind === "transient") return { kind: "error", message: SIGN_IN_MESSAGES.offline };
    if (!c.coupleId) return { kind: "error", message: c.kind === "refused" && c.code === "no-couple" ? SIGN_IN_MESSAGES.noCouple : SIGN_IN_MESSAGES.refused };
    const auth: TogetherAuth = {
      url, anonKey, userId: s.session.userId, coupleId: c.coupleId,
      accessToken: s.session.accessToken, refreshToken: s.session.refreshToken, expiresAt: s.session.expiresAt,
    };
    // This install's device id exists from now on, so a later Replace always leaves a former id
    // behind: the sign of a restored journal that sync hasn't caught up with (bug #58).
    await getDeviceId(db);
    await db.transaction("rw", db.syncMeta, async () => {
      await db.syncMeta.put({ key: TOGETHER_META, value: auth });
      const sent = await readSent(db);
      if (!sent || sent.userId !== auth.userId) {
        await saveSent(db, { ...freshSent(auth.userId, now()), formerSeen: (await formerDeviceIds(db.syncMeta)).length });
      } else {
        // Signing in again (after Stop, or a lapsed sign-in): the 24 h to tick any day private
        // starts again for every day so far, sent or not (review I1). A day already sent with
        // answers stays as it is meanwhile.
        await saveSent(db, { ...sent, pastBefore: todayISO(new Date(now())), pastUntil: now() + ANSWERS_DELAY_MS });
      }
    });
    return { kind: "ok" };
  });
  return out ?? { kind: "error", message: SIGN_IN_MESSAGES.busy };
}

function freshSent(userId: string, now: number): TogetherSent {
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const today = todayISO(new Date(now));
  return { userId, since: today, salt, days: {}, refused: {}, pastBefore: today, pastUntil: now + ANSWERS_DELAY_MS };
}

export type StopResult = { kind: "ok" } | { kind: "error"; message: string };

/**
 * "Stop copying to Together": forgets the sign-in on this device. With `markDeleted`, first marks
 * every day logged in her challenge deleted in Together (never the challenge itself, which is
 * hers). The record is kept, its days marked deleted, so signing in again later brings those
 * same rows back (24 h after that sign-in), never taking them for entries she deleted herself in
 * Together. If anything can't be removed, the sign-in is kept and she is told how many (review
 * M2), so she can try again or stop without removing.
 */
export async function stopTogether(env: SendEnv, opts: { markDeleted: boolean }): Promise<StopResult> {
  const db = appDb;
  const now = env.now ?? Date.now;
  abortRunning(); // a send in flight stops now, and never sends again after this
  if (!opts.markDeleted) {
    // Needs no request, so it never waits behind one (bug #44).
    await db.syncMeta.delete(TOGETHER_META);
    return { kind: "ok" };
  }
  const out = await withTogetherLock(db, async (): Promise<StopResult> => {
    // Paused first, durably (bug #53): if this is cut off, no run puts anything back.
    const rec = await readSent(db);
    if (rec && !rec.removing) await saveSent(db, { ...rec, removing: true });
    try {
      const auth = await freshAuth(db, env.fetch, now());
      const sent = await readSent(db);
      if (auth && sent && sent.userId === auth.userId) {
        const failed = await markAllDeleted(new Ctx(db, env, auth, upgraded(sent, now()), null));
        if (failed > 0) return { kind: "error", message: notRemoved(failed) };
      }
    } catch (e) {
      if (!(e instanceof Stop)) throw e;
      return { kind: "error", message: e.why === "auth" ? NEEDS_SIGN_IN : SIGN_IN_MESSAGES.offline };
    }
    const done = await readSent(db);
    if (done) {
      const { removing: _r, ...rest } = done;
      await saveSent(db, rest);
    }
    await db.syncMeta.delete(TOGETHER_META);
    return { kind: "ok" };
  });
  return out ?? { kind: "error", message: SIGN_IN_MESSAGES.busy };
}

/** Cancels a paused "Stop copying" with removing: copying carries on from the next run. */
export async function cancelStopRemoving(): Promise<void> {
  const db = appDb;
  await withTogetherLock(db, async () => {
    const rec = await readSent(db);
    if (rec?.removing) {
      const { removing: _r, ...rest } = rec;
      await saveSent(db, rest);
    }
  });
}

/**
 * A record from an earlier build, brought up to date: a day record, and past days held for
 * ANSWERS_DELAY_MS from the first run of this update (the backfill, 2026-11-08). Its habits and
 * tallies stay until they have been cleaned up.
 */
function upgraded(sent: TogetherSent, now: number): TogetherSent {
  sent.days ??= {};
  if (sent.pastBefore === undefined) {
    sent.pastBefore = todayISO(new Date(now));
    sent.pastUntil = now + ANSWERS_DELAY_MS;
  }
  return sent;
}

// ---- after a Replace (bugs #58, #64, #65) ------------------------------------------------------

/**
 * Whether answers are held because a backup was restored (Replace) here and the journal may be
 * missing what was written or ticked after the backup. Held until sync has pulled everything
 * again; with sync off on this device, for ANSWERS_DELAY_MS after the Replace was first noticed
 * (nothing can arrive to wait for, so answers then go as usual). Saved in the record, for the box.
 */
async function restoreHold(db: HubDB, sent: TogetherSent, now: number): Promise<boolean> {
  const former = (await formerDeviceIds(db.syncMeta)).length;
  if (sent.formerSeen === undefined) sent.formerSeen = former;
  else if (former > sent.formerSeen) {
    sent.formerSeen = former;
    sent.restoredAt = now;
  }
  let held = false;
  if (sent.restoredAt !== undefined) {
    const gate = await readSyncGate(db.syncMeta);
    held = gate.syncOn ? !gate.firstPullDone : now < sent.restoredAt + ANSWERS_DELAY_MS;
    if (!held) delete sent.restoredAt;
  }
  sent.waitingRestore = held;
  return held;
}

// ---- tokens -----------------------------------------------------------------------------------

/**
 * Signed in with tokens that still work (refreshed when near expiry, or when `force`d after a
 * 401), or null when there's no sign-in at all.
 */
async function freshAuth(db: HubDB, fetchFn: Fetch, now: number, force = false): Promise<Required<TogetherAuth> | null> {
  const auth = await readAuth(db);
  if (!auth) return null;
  if (!auth.accessToken || !auth.refreshToken || auth.expiresAt === undefined) throw new Stop("auth");
  if (!force && auth.expiresAt - REFRESH_MARGIN_MS > now) return auth as Required<TogetherAuth>;
  const used = auth.refreshToken;
  const r = await refreshSession(fetchFn, auth.url, auth.anonKey, used, now);
  if (r.kind === "transient") throw new Stop("transient");
  if (r.kind === "refused" || r.session.userId !== auth.userId) {
    await forgetTokens(db);
    throw new Stop("auth");
  }
  // The refresh token is single use: the new pair is saved before it is used.
  const saved = await db.transaction("rw", db.syncMeta, async () => {
    const cur = await readAuth(db);
    if (!cur || cur.refreshToken !== used) return null;
    const next: TogetherAuth = { ...cur, accessToken: r.session.accessToken, refreshToken: r.session.refreshToken, expiresAt: r.session.expiresAt };
    await db.syncMeta.put({ key: TOGETHER_META, value: next });
    return next as Required<TogetherAuth>;
  });
  if (!saved) throw new Stop("transient"); // signed out or in again meanwhile: next run uses that
  return saved;
}

/** Keeps the address, anon key and ids (for signing in again) but no token. */
async function forgetTokens(db: HubDB): Promise<void> {
  await db.transaction("rw", db.syncMeta, async () => {
    const cur = await readAuth(db);
    if (!cur) return;
    const { accessToken: _a, refreshToken: _r, expiresAt: _e, ...rest } = cur;
    await db.syncMeta.put({ key: TOGETHER_META, value: rest });
  });
}

// ---- one run ----------------------------------------------------------------------------------

/** Sends whatever changed. At most one run at a time on this device (any tab). */
export async function sendToTogether(env: SendEnv): Promise<SendOutcome> {
  const db = appDb;
  const out = await withTogetherLock(
    db,
    async () => {
      const ctrl = new AbortController();
      running = ctrl;
      try {
        return await run(db, { ...env, fetch: withSignal(env.fetch, ctrl.signal) });
      } finally {
        if (running === ctrl) running = null;
      }
    },
    { ifAvailable: true },
  );
  return out ?? { kind: "busy" };
}

async function run(db: HubDB, env: SendEnv): Promise<SendOutcome> {
  const now = env.now ?? Date.now;
  if (!(await readAuth(db))) return { kind: "off" };
  try {
    const auth = (await freshAuth(db, env.fetch, now()))!;
    let sent = await readSent(db);
    if (!sent || sent.userId !== auth.userId) {
      sent = freshSent(auth.userId, now());
      await saveSent(db, sent);
    }
    upgraded(sent, now());
    if (env.retryRefused) sent.refused = {};
    const ctx = new Ctx(db, env, auth, sent, null);
    const done = async (copied: boolean) => {
      sent.lastSentAt = now();
      if (copied) sent.lastCopiedAt = sent.lastSentAt;
      delete sent.held; // nothing holds new days back any more (a note can be overwritten)
      await ctx.save();
      return { kind: "ok" as const, sent: ctx.sentCount, refused: Object.keys(sent.refused).length };
    };
    // A "Stop copying" with removing that didn't finish: only carry on removing (bug #53).
    if (sent.removing) {
      await markAllDeleted(ctx);
      return done(false);
    }
    // What an earlier build made (habits, tallies) is marked deleted, once; needs no journal key.
    await cleanUpHabits(ctx);
    const challengeId = await findChallenge(ctx);
    if (!challengeId) return done(false);
    const today = todayISO(new Date(now()));
    // Read under the sync lock, so nothing is read halfway through a sync run.
    const snap = await withSyncLock(db, async () => {
      const jk = await loadJournalKey(db).catch(() => undefined);
      const journal = jk ? await readJournalDays(jk, today).catch(() => null) : null;
      return { jk, journal };
    });
    ctx.challengeId = challengeId;
    if (!snap.jk) {
      // No journal key here: no tick can be read, so a day that may hold answers we can't vouch
      // for (a write cut off) is marked deleted; it comes back once the journal is unlocked.
      await hideUnknownDays(ctx);
    } else {
      ctx.jk = snap.jk;
      if (snap.journal?.earliest && snap.journal.earliest < sent.since) sent.since = snap.journal.earliest;
      ctx.restoredUnpulled = await restoreHold(db, sent, now());
      await sendDays(ctx, snap.journal);
    }
    return done(true);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    if (e.why === "auth") {
      await forgetTokens(db);
      return { kind: "needs-sign-in" };
    }
    return { kind: "offline" };
  }
}

class Ctx {
  sentCount = 0;
  /** Day rows written this run (MAX_WRITES_PER_RUN). */
  writes = 0;
  /** A Replace happened and sync hasn't pulled everything since (bug #58). */
  restoredUnpulled = false;
  challengeId = "";
  private refreshedAfter401 = false;
  constructor(
    readonly db: HubDB,
    readonly env: SendEnv,
    public auth: Required<TogetherAuth>,
    readonly sent: TogetherSent,
    public jk: JournalKey | null,
  ) {}

  get days(): Record<ISODate, SentDay> {
    return (this.sent.days ??= {});
  }

  now(): number {
    return (this.env.now ?? Date.now)();
  }

  nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  save(): Promise<void> {
    return saveSent(this.db, this.sent);
  }

  async hash(text: string): Promise<string> {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${this.sent.salt}|${text}`)));
    return [...bytes.subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** One request. On a 401, one refresh and one retry (review M4); then stop. Offline stops. */
  async call(method: "GET" | "POST" | "PATCH", path: string, body: unknown, prefer = "return=minimal"): Promise<CallResult & { kind: "ok" | "refused" }> {
    let r = await rest(this.env.fetch, this.auth, method, path, body, prefer);
    if (r.kind === "auth" && !this.refreshedAfter401) {
      this.refreshedAfter401 = true;
      this.auth = (await freshAuth(this.db, this.env.fetch, this.now(), true))!;
      r = await rest(this.env.fetch, this.auth, method, path, body, prefer);
    }
    if (r.kind === "auth") throw new Stop("auth");
    if (r.kind === "transient") throw new Stop("transient");
    if (r.kind === "ok" && method !== "GET") this.sentCount++;
    return r;
  }

  /** PATCH rows matched by `filter`; refused ("no-row") when Together has no such row for her. */
  async patch(table: string, filter: string, body: Record<string, unknown>) {
    const r = await this.call("PATCH", `${table}?${filter}&select=id`, body, "return=representation");
    if (r.kind === "ok" && !(Array.isArray(r.body) && r.body.length === 1)) return { kind: "refused" as const, status: 200, code: "no-row" };
    return r;
  }

  /** PATCH our row for a day, by its fixed id, in her couple (with `liveOnly`, only if not deleted). */
  patchDay(id: string, body: Record<string, unknown>, opts: { liveOnly?: boolean } = {}) {
    this.writes++;
    return this.patch("challenge_days", `couple_id=eq.${enc(this.auth.coupleId)}&id=eq.${enc(id)}${opts.liveOnly ? "&deleted_at=is.null" : ""}`, body);
  }
}

const enc = encodeURIComponent;

/** Already there: the same id, or (challenge_days) a row for that day already (not "no such challenge", also a 409). */
const isDuplicate = (r: CallResult) => r.kind === "refused" && (r.code === "23505" || (r.status === 409 && r.code !== "23503"));

/** Our fixed id for a day of her challenge. */
const dayId = (challengeId: string, date: ISODate) => togetherId("day", `${challengeId}:${date}`, 1);

// ---- her challenge ----------------------------------------------------------------------------

/**
 * Her challenge's id: found once (by name, or its known id), never one that is Oliver's, and
 * renamed once to CHALLENGE_NAME. null when there is none: nothing goes, and the box says so.
 */
async function findChallenge(ctx: Ctx): Promise<string | null> {
  const { sent } = ctx;
  if (!sent.challenge) {
    const r = await ctx.call("GET", `challenges?couple_id=eq.${enc(ctx.auth.coupleId)}&select=id,name,for_user`, undefined, "");
    const rows = r.kind === "ok" && Array.isArray(r.body) ? (r.body as { id?: unknown; name?: unknown; for_user?: unknown }[]) : [];
    // Its known id or its name, on one that is hers or no one's (never someone else's: review M1).
    const mine = rows.filter(
      (c) =>
        typeof c.id === "string" &&
        (CHALLENGE_IDS.includes(c.id) || (typeof c.name === "string" && CHALLENGE_NAMES.includes(c.name.trim().toLowerCase()))) &&
        (c.for_user === undefined || c.for_user === null || c.for_user === ctx.auth.userId),
    );
    // Its known id first, then one already renamed, then her own, then by id (always the same pick).
    const rank = (c: (typeof mine)[number]) =>
      (CHALLENGE_IDS.includes(c.id as string) ? 0 : 4) + (typeof c.name === "string" && c.name.trim() === CHALLENGE_NAME ? 0 : 2) + (c.for_user === ctx.auth.userId ? 0 : 1);
    mine.sort((a, b) => rank(a) - rank(b) || String(a.id).localeCompare(String(b.id)));
    const pick = mine[0];
    if (!pick) {
      sent.challengeMissing = true;
      await ctx.save();
      return null;
    }
    sent.challenge = { id: pick.id as string, ...(pick.name === CHALLENGE_NAME ? { renamed: true } : {}) };
    delete sent.challengeMissing;
    await ctx.save();
  }
  const ch = sent.challenge;
  if (!ch.renamed) {
    // Once: tried again only if Together couldn't be reached.
    await ctx.patch("challenges", `couple_id=eq.${enc(ctx.auth.coupleId)}&id=eq.${enc(ch.id)}`, { name: CHALLENGE_NAME });
    ch.renamed = true;
    await ctx.save();
  }
  return ch.id;
}

// ---- the days ---------------------------------------------------------------------------------

/** One part of a day as read here: its note, or "unknown" (it wouldn't open), or absent. */
type PartView = { note: DayNote; partial: boolean } | "unknown" | null;

function view(kind: DayNotes | null, date: ISODate, recorded: boolean): PartView {
  // A whole kind that couldn't be read: a recorded day of it is unknown (nothing new goes).
  if (!kind) return recorded ? "unknown" : null;
  if (kind.unknown.has(date)) return "unknown";
  const note = kind.notes.get(date);
  if (!note) return null;
  return { note, partial: kind.partial.has(date) };
}

const hasAnswers = (rec: SentDay | undefined) => !!rec && PARTS.some((p) => rec.parts[p] === "answers");

async function sendDays(ctx: Ctx, journal: JournalDays | null): Promise<void> {
  const { sent } = ctx;
  const ex = journal?.exercise ?? null;
  const ci = journal?.checkin ?? null;
  const dates = new Set<ISODate>(Object.keys(ctx.days));
  for (const k of [ex, ci]) if (k) for (const d of [...k.notes.keys(), ...k.unknown, ...k.partial]) dates.add(d);
  // A day that holds her answers first (a private tick or an edit never waits behind a backfill).
  const order = [...dates].sort((a, b) => Number(hasAnswers(ctx.days[b])) - Number(hasAnswers(ctx.days[a])) || a.localeCompare(b));
  sent.backlog = false;
  for (const date of order) {
    if (ctx.writes >= MAX_WRITES_PER_RUN) {
      sent.backlog = true;
      break;
    }
    if (sent.byHand?.[date]) continue;
    const rec = ctx.days[date];
    const recorded = (p: Part) => !!rec?.live && !!rec.parts[p];
    await sendDay(ctx, date, { exercise: view(ex, date, recorded("exercise")), checkin: view(ci, date, recorded("checkin")) });
  }
}

type Want = { note: string; parts: SentDay["parts"] } | null | "skip";

/** The day ended ANSWERS_DELAY_MS ago: its answers' own time. */
const dayDue = (ctx: Ctx, date: ISODate) => date < todayISO(new Date(ctx.now() - ANSWERS_DELAY_MS));

/** A past day (before the last sign-in, or this update) within the 24 h after it (review I1). */
function pastHeld(ctx: Ctx, date: ISODate): boolean {
  const { pastBefore, pastUntil } = ctx.sent;
  return pastBefore !== undefined && date < pastBefore && ctx.now() < (pastUntil ?? 0);
}

/** Its research notes changed less than ANSWERS_DELAY_MS ago (review I2). */
const researchHeld = (ctx: Ctx, note: DayNote) => (note.researchAt ?? 0) > 0 && ctx.now() < note.researchAt! + ANSWERS_DELAY_MS;

async function sendDay(ctx: Ctx, date: ISODate, parts: Record<Part, PartView>): Promise<void> {
  const { sent } = ctx;
  const rec = ctx.days[date];
  const partial = (p: Part) => (parts[p] as { partial?: boolean } | null)?.partial === true;
  // Only ever hidden, never built up: a part that wouldn't open here, or one that only partly
  // opens and already went with answers (bug #59: left as it is unless ticked private); after a
  // Replace until sync has caught up, a day already sent with answers (bug #64) or missing from
  // the restored journal (bug #67). A part that only partly opens otherwise goes titles-only.
  const constrained =
    PARTS.some((p) => parts[p] === "unknown" || (partial(p) && rec?.live && rec.parts[p] === "answers")) ||
    (ctx.restoredUnpulled && !!rec?.live && (hasAnswers(rec) || PARTS.every((p) => parts[p] === null)));

  /** Every part with titles and questions only (a part that wouldn't open: its heading). */
  const titlesOnly = (): Want => {
    const out: { summary: string; text: string }[] = [];
    const held: SentDay["parts"] = {};
    for (const p of PARTS) {
      const v = parts[p];
      const known = v && v !== "unknown" ? v.note : null;
      const text = known ? known.titles : rec?.parts[p] ? PART_HEADINGS[p] : "";
      if (text) {
        out.push({ summary: known?.summary || PART_SUMMARY[p], text });
        held[p] = "titles";
      }
    }
    return out.length ? { note: dayNote(out), parts: held } : null;
  };

  /** The note that may go right now (the ticks are read again each time: bug #42). */
  const want = async (): Promise<Want> => {
    const ticks = await readSharePrivate(ctx.jk!, date);
    const hide = !!rec?.live && PARTS.some((p) => rec.parts[p] === "answers" && ticks[p]);
    if (constrained) return hide ? titlesOnly() : "skip";
    const due = dayDue(ctx, date) && !ctx.restoredUnpulled;
    const held = (p: Part, v: { note: DayNote }) => (due && pastHeld(ctx, date)) || (p === "exercise" && researchHeld(ctx, v.note));
    // A part already sent with answers that may not go again yet (a new sign-in's 24 h, research
    // notes changed late): what went stays, so the day is left as it is unless something is hidden.
    const keep = !hide && !!rec?.live && rec.hash !== "" &&
      PARTS.some((p) => {
        const v = parts[p];
        return rec.parts[p] === "answers" && !ticks[p] && v && v !== "unknown" && held(p, v);
      });
    if (keep) return "skip";
    const out: { summary: string; text: string }[] = [];
    const sentParts: SentDay["parts"] = {};
    for (const p of PARTS) {
      const v = parts[p];
      if (!v || v === "unknown") continue;
      // Never answers from a part that only partly opens.
      const full = due && !ticks[p] && !v.partial && !held(p, v);
      const text = full ? v.note.full : v.note.titles;
      if (!text) continue;
      out.push({ summary: v.note.summary, text });
      sentParts[p] = full && v.note.full !== v.note.titles ? "answers" : "titles";
    }
    // One summary line first (titles only, kept on a private day), then the parts.
    return out.length ? { note: dayNote(out), parts: sentParts } : null;
  };

  const first = await want();
  if (first === "skip") return;
  if (first === null) {
    // Nothing of the day is left (a card un-ticked, say): our row is marked deleted.
    if (!rec?.live) return;
    const r = await ctx.patchDay(await dayId(ctx.challengeId, date), { deleted_at: ctx.nowIso() });
    if (r.kind === "ok" || r.code === "no-row") {
      rec.live = false;
      delete sent.refused[date];
    } else sent.refused[date] = { hash: "gone", what: "hide" };
    await ctx.save();
    return;
  }
  const h = await ctx.hash(first.note);
  if (rec?.live && rec.hash === h) return;
  // Set aside until it changes or Send now; but hiding answers is tried again every run.
  if (sent.refused[date]?.hash === h && sent.refused[date].what !== "hide") return;
  const id = await dayId(ctx.challengeId, date);
  const record = async (w: { note: string; parts: SentDay["parts"] }) => {
    ctx.days[date] = { hash: await ctx.hash(w.note), live: true, parts: w.parts };
    delete sent.refused[date];
    await ctx.save();
  };
  const setAside = async (what: "copy" | "hide") => {
    sent.refused[date] = { hash: h, what };
    await ctx.save();
  };
  /**
   * Deleted in Together (by her, most likely): left alone from now on and counted in the box, like
   * a day she logged by hand (review I3). Answers that may be in it are taken out first: that
   * only removes text.
   */
  const leaveAlone = async (scrub: boolean) => {
    const t = scrub ? titlesOnly() : null;
    if (t && t !== "skip") await ctx.patchDay(id, { note: t.note });
    delete ctx.days[date];
    (sent.byHand ??= {})[date] = true;
    delete sent.refused[date];
    await ctx.save();
  };

  if (rec) {
    // Our row is (or may be) there: its note is overwritten.
    const w = await want();
    if (w === "skip" || w === null) return; // changed meanwhile: next run
    // Its content is unknown while the overwrite is on its way (a reply lost: it may have gone in).
    const before: SentDay = { ...rec, parts: { ...rec.parts } };
    ctx.days[date] = { hash: "", live: true, parts: { exercise: "answers", checkin: "answers" } };
    await ctx.save();
    // Shown again: a row we marked deleted ourselves (a card un-ticked, Stop with removing).
    // Taken back to titles: may go to a deleted row (it only removes text). Anything else adds or
    // changes words, so only ever into a row that isn't deleted (review I3).
    const reviving = !before.live;
    const removal = !reviving && before.hash !== "" && PARTS.some((p) => before.parts[p] === "answers" && w.parts[p] !== "answers") && !PARTS.some((p) => w.parts[p] === "answers");
    const r = reviving
      ? await ctx.patchDay(id, { note: w.note, deleted_at: null })
      : await ctx.patchDay(id, { note: w.note }, { liveOnly: !removal });
    if (r.kind === "ok") return record(w);
    if (r.code !== "no-row") {
      ctx.days[date] = before; // refused: unchanged in Together
      return setAside(before.live && hasAnswers(before) ? "hide" : "copy");
    }
    if (!reviving && !removal && before.hash !== "") return leaveAlone(hasAnswers(before));
    // Never reached Together (a cut-off insert), or not there at all: inserted below.
    delete ctx.days[date];
  }
  if (constrained) return; // only ever hidden: nothing new goes
  const w = await want();
  if (w === "skip" || w === null) return;
  // Written down before it goes (bug #49): if this request is cut off, it may still be in Together.
  ctx.days[date] = { hash: "", live: true, parts: { exercise: "answers", checkin: "answers" } };
  await ctx.save();
  ctx.writes++;
  const r = await ctx.call("POST", "challenge_days", { id, couple_id: ctx.auth.coupleId, challenge_id: ctx.challengeId, day: date, note: w.note });
  if (r.kind === "ok") return record(w);
  if (isDuplicate(r)) {
    // Ours from an earlier run (its content unknown), a day she logged by hand, or ours that she
    // deleted in Together: only a row of ours that isn't deleted is overwritten.
    const again = await want();
    if (again !== "skip" && again !== null) {
      const p = await ctx.patchDay(id, { note: again.note }, { liveOnly: true });
      if (p.kind === "ok") return record(again);
      if (p.code === "no-row") return leaveAlone(true); // hers, or deleted by her: left exactly as it is
    }
    return; // still recorded as maybe there: the next run overwrites it
  }
  delete ctx.days[date]; // refused: it never went in
  await setAside("copy");
}

/** Marks deleted every day whose note is unknown (a write cut off: it may hold answers). */
async function hideUnknownDays(ctx: Ctx): Promise<void> {
  for (const [date, d] of Object.entries(ctx.days)) {
    if (!d.live || d.hash !== "") continue;
    if (ctx.writes >= MAX_WRITES_PER_RUN) {
      ctx.sent.backlog = true;
      return;
    }
    const r = await ctx.patchDay(await dayId(ctx.challengeId, date), { deleted_at: ctx.nowIso() });
    if (r.kind === "ok" || r.code === "no-row") {
      d.live = false;
      delete ctx.sent.refused[date];
    } else ctx.sent.refused[date] = { hash: "gone", what: "hide" };
    await ctx.save();
  }
}

// ---- an earlier build's habits ---------------------------------------------------------------

const LEGACY_KINDS: Part[] = ["exercise", "checkin"];

/**
 * Marks what an earlier build made in Together deleted (its two habit to-dos, their tallies and
 * any tally that may have gone in), then forgets them. Safe to repeat: one already deleted counts
 * as done. Returns how many couldn't be (kept, and tried again next run or on Send now).
 */
async function cleanUpHabits(ctx: Ctx, force = false): Promise<number> {
  const { sent } = ctx;
  if (!sent.habits && !sent.tallies && !sent.maybe) return 0;
  if (sent.refused["habits"] && !ctx.env.retryRefused && !force) return 1;
  let failed = 0;
  // A tally already deleted (P0001 "stays undone") or not there counts as done.
  const tallyGone = async (id: string) => {
    const r = await ctx.patch("todo_events", `id=eq.${enc(id)}`, { deleted_at: ctx.nowIso() });
    return r.kind === "ok" || r.code === "P0001" || r.code === "no-row";
  };
  for (const [id] of Object.entries(sent.maybe ?? {})) {
    if (await tallyGone(id)) delete sent.maybe![id];
    else failed++;
    await ctx.save();
  }
  for (const [key, t] of Object.entries(sent.tallies ?? {})) {
    if (t.live && !(await tallyGone(await togetherId("tally", key, t.v)))) {
      failed++;
      continue;
    }
    delete sent.tallies![key];
    await ctx.save();
  }
  for (const kind of LEGACY_KINDS) {
    const h = sent.habits?.[kind];
    if (!h) continue;
    if (!h.deleted) {
      // By its fixed id. Deleting one already deleted is fine.
      const r = await ctx.patch("todos", `id=eq.${enc(await togetherId("habit", kind, 1))}`, { deleted_at: ctx.nowIso() });
      if (!(r.kind === "ok" || r.code === "no-row" || r.code === "P0001")) {
        failed++;
        continue;
      }
    }
    delete sent.habits![kind];
    await ctx.save();
  }
  if (failed === 0) {
    delete sent.habits;
    delete sent.tallies;
    delete sent.maybe;
    delete sent.refused["habits"];
  } else sent.refused["habits"] = { hash: "habits", what: "hide" };
  await ctx.save();
  return failed;
}

// ---- stop: mark everything deleted -------------------------------------------------------------

/**
 * Marks every day of ours in her challenge deleted (and anything an earlier build left). Never
 * the challenge, and never a day she logged by hand. Returns how many couldn't be.
 */
async function markAllDeleted(ctx: Ctx): Promise<number> {
  const { sent } = ctx;
  let failed = await cleanUpHabits(ctx, true);
  const challengeId = sent.challenge?.id;
  for (const [date, d] of Object.entries(ctx.days)) {
    if (!d.live || !challengeId) continue;
    const r = await ctx.patchDay(await dayId(challengeId, date), { deleted_at: ctx.nowIso() });
    if (r.kind === "ok" || r.code === "no-row") d.live = false;
    else failed++;
    await ctx.save();
  }
  return failed;
}
