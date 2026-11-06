// The Together sender (Together link brief, fix round 1): signs in, refreshes, and copies the
// Mental health exercise and Daily check-in days to Together as two habits with one tally per
// day. Nothing else goes (no to-dos, Esme 2026-11-05). One way only: nothing is read back.
// It runs after a sync run has finished (never during one: what it sends is read under the sync
// lock) and on "Send now", one tab at a time (a Web Lock).
//
// When a day goes, in two stages (review C1: a private tick made on another device must never
// lose the race):
// 1. After the day ends (the 3am day change): titles only (the cards' titles, the questions she
//    answered). Leaving these behind in Together is harmless.
// 2. ANSWERS_DELAY_MS later, and only if that part isn't ticked private (read again right before
//    sending): the titles-only tally is deleted and one with her answers takes its place.
//
// - Every id is fixed (ids.ts). created_at / updated_at are never sent.
// - A tally is never edited: a change deletes the old one (`deleted_at`, once; its text stays in
//   Together's database, hidden) and inserts a new version. An id already taken (its content
//   unknown, say a reply lost on the way) is deleted too, and a new version goes (review I2).
// - A record per day (store.ts) says what went, so a run sends only what changed.
// - Offline or a server error: stop, try again next run. One row refused: set aside (counted on
//   the box), the rest goes on. A 401: one refresh is tried; if that fails too, or a refresh is
//   refused, stop, forget the tokens and ask her to sign in again. Nothing else is affected.

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
import { readJournalDays, type DayNotes, type JournalDays } from "./journalNotes";
import {
  readAuth, readSent, saveSent, TOGETHER_META, TOGETHER_SENT_META, withTogetherLock,
  type HabitKind, type TogetherAuth, type TogetherSent,
} from "./store";

/**
 * How long after a day ends (3am) her answers follow the titles: 24 hours (review C1; a named
 * setting for Esme to rule on). Until then only the titles and questions are in Together.
 */
export const ANSWERS_DELAY_MS = 24 * 60 * 60 * 1000;

/** Provisional wording (Esme may reword): the two habits on her side in Together. */
export const HABIT_TITLES: Record<HabitKind, string> = {
  exercise: "Mental health exercise",
  checkin: "Daily check-in",
};
const HABITS: HabitKind[] = ["exercise", "checkin"];

/** A tally's `at`: the day at noon UTC (the same date in any time zone from UTC-11 to UTC+11). */
export const dayStamp = (d: ISODate): string => `${d}T12:00:00.000Z`;

/** Refresh this long before the access token runs out. */
const REFRESH_MARGIN_MS = 60_000;
/** At most this many new versions for one day in one run (each is a taken id deleted first). */
const MAX_VERSION_TRIES = 5;

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
        await saveSent(db, { ...freshSent(auth.userId, todayISO(new Date(now()))), formerSeen: (await formerDeviceIds(db.syncMeta)).length });
      }
    });
    return { kind: "ok" };
  });
  return out ?? { kind: "error", message: SIGN_IN_MESSAGES.busy };
}

function freshSent(userId: string, since: ISODate): TogetherSent {
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { userId, since, salt, habits: {}, tallies: {}, refused: {} };
}

export type StopResult = { kind: "ok" } | { kind: "error"; message: string };

/**
 * "Stop copying to Together": forgets the sign-in on this device. With `markDeleted`, first marks
 * everything sent as deleted in Together, and forgets the record too, so signing in again later
 * starts from that day (review M9). If anything can't be removed, nothing is forgotten and she is
 * told how many (review M2), so she can try again or stop without removing.
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
    if (opts.markDeleted) {
      // Paused first, durably (bug #53): if this is cut off, no run puts anything back.
      const rec = await readSent(db);
      if (rec && !rec.removing) await saveSent(db, { ...rec, removing: true });
      try {
        const auth = await freshAuth(db, env.fetch, now());
        const sent = await readSent(db);
        if (auth && sent && sent.userId === auth.userId) {
          const failed = await markAllDeleted(new Ctx(db, env, auth, sent, null));
          if (failed > 0) return { kind: "error", message: notRemoved(failed) };
        }
      } catch (e) {
        if (!(e instanceof Stop)) throw e;
        return { kind: "error", message: e.why === "auth" ? NEEDS_SIGN_IN : SIGN_IN_MESSAGES.offline };
      }
      await db.syncMeta.delete(TOGETHER_SENT_META);
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
      sent = freshSent(auth.userId, todayISO(new Date(now())));
      await saveSent(db, sent);
    }
    if (env.retryRefused) sent.refused = {};
    const ctx = new Ctx(db, env, auth, sent, null);
    const done = async (copied: boolean) => {
      sent.lastSentAt = now();
      if (copied) sent.lastCopiedAt = sent.lastSentAt;
      sent.held = !copied && !sent.removing;
      await ctx.save();
      return { kind: "ok" as const, sent: ctx.sentCount, refused: Object.keys(sent.refused).length };
    };
    // A "Stop copying" with removing that didn't finish: only carry on removing (bug #53).
    if (sent.removing) {
      await markAllDeleted(ctx);
      return done(false);
    }
    // Anything a cut-off request may have left in Together goes first, needing no journal key
    // (bugs #49, #54); until it has, nothing new is sent.
    if ((await clearMaybes(ctx)) > 0) {
      sent.refused["maybe"] = { hash: "maybe", what: "hide" };
      return done(false);
    }
    delete sent.refused["maybe"];
    const today = todayISO(new Date(now()));
    const since = sent.since;
    // Read under the sync lock, so nothing is read halfway through a sync run.
    const snap = await withSyncLock(db, async () => {
      const jk = await loadJournalKey(db).catch(() => undefined);
      const journal = jk ? await readJournalDays(jk, since, today).catch(() => null) : null;
      return { jk, journal };
    });
    if (snap.jk) {
      ctx.jk = snap.jk;
      ctx.restoredUnpulled = await restoreHold(db, sent, now());
      await sendJournal(ctx, snap.journal);
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
  /** A Replace happened and sync hasn't pulled everything since (bug #58). */
  restoredUnpulled = false;
  private refreshedAfter401 = false;
  constructor(
    readonly db: HubDB,
    readonly env: SendEnv,
    public auth: Required<TogetherAuth>,
    readonly sent: TogetherSent,
    public jk: JournalKey | null,
  ) {}

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
  async call(method: "POST" | "PATCH", path: string, body: unknown, prefer = "return=minimal"): Promise<CallResult & { kind: "ok" | "refused" }> {
    let r = await rest(this.env.fetch, this.auth, method, path, body, prefer);
    if (r.kind === "auth" && !this.refreshedAfter401) {
      this.refreshedAfter401 = true;
      this.auth = (await freshAuth(this.db, this.env.fetch, this.now(), true))!;
      r = await rest(this.env.fetch, this.auth, method, path, body, prefer);
    }
    if (r.kind === "auth") throw new Stop("auth");
    if (r.kind === "transient") throw new Stop("transient");
    if (r.kind === "ok") this.sentCount++;
    return r;
  }

  /** PATCH one row by id; refused when Together has no such row for her. */
  async patch(table: "todos" | "todo_events", id: string, body: Record<string, unknown>) {
    const r = await this.call("PATCH", `${table}?id=eq.${id}&select=id`, body, "return=representation");
    if (r.kind === "ok" && !(Array.isArray(r.body) && r.body.length === 1)) return { kind: "refused" as const, status: 200, code: "no-row" };
    return r;
  }

  /** A tally is gone: deleted now, already deleted, or never there (no such row for her). */
  async gone(id: string): Promise<boolean> {
    const r = await this.patch("todo_events", id, { deleted_at: this.nowIso() });
    return r.kind === "ok" || r.code === "P0001" || r.code === "no-row";
  }

  /** Delete a tally (once). One already deleted (say, by her Undo in Together) counts as done. */
  async deleteEvent(id: string): Promise<boolean> {
    const r = await this.patch("todo_events", id, { deleted_at: this.nowIso() });
    return r.kind === "ok" || r.code === "P0001";
  }
}

/** The id is already taken (not "its to-do doesn't exist", which is also a 409). */
const isDuplicate = (r: CallResult) => r.kind === "refused" && (r.code === "23505" || (r.status === 409 && r.code !== "23503"));

// ---- the two habits and their tallies -----------------------------------------------------------

async function sendJournal(ctx: Ctx, journal: JournalDays | null): Promise<void> {
  for (const kind of HABITS) {
    let days = journal?.[kind] ?? null;
    if (!days) {
      // This kind couldn't be read this time: nothing new goes, but a day sent with answers and
      // since ticked private is still hidden (bug #59).
      if (!ctx.sent.habits[kind]) continue;
      const prefix = `${kind}:`;
      days = { notes: new Map(), partial: new Set(), unknown: new Set(Object.keys(ctx.sent.tallies).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))) };
    }
    const habitId = await ensureHabit(ctx, kind);
    if (!habitId) continue;
    await sendTallies(ctx, kind, habitId, days);
  }
}

/** The habit to-do on her side, made once with a fixed id (un-deleted if it was deleted). */
async function ensureHabit(ctx: Ctx, kind: HabitKind): Promise<string | null> {
  const { sent } = ctx;
  const id = await togetherId("habit", kind, 1);
  const key = `habit:${kind}`;
  const have = sent.habits[kind];
  if (have && !have.deleted) return id;
  if (sent.refused[key]) return null;
  let r: CallResult;
  if (!have) {
    r = await ctx.call("POST", "todos", {
      id, couple_id: ctx.auth.coupleId, owner_id: ctx.auth.userId, created_by: ctx.auth.userId,
      title: HABIT_TITLES[kind], type: "habit", period: "day", target: 1, points_earn: 0, points_miss: 0,
    });
    if (isDuplicate(r)) r = await ctx.patch("todos", id, { deleted_at: null });
  } else {
    r = await ctx.patch("todos", id, { deleted_at: null });
  }
  if (r.kind !== "ok") {
    sent.refused[key] = { hash: "habit", what: "copy" };
    await ctx.save();
    return null;
  }
  sent.habits[kind] = { tally: have?.tally ?? 0, deleted: false };
  await ctx.save();
  return id;
}

/**
 * The note that may go for a day right now: titles only until ANSWERS_DELAY_MS after the day
 * ends, and whenever that part is ticked private (the tick is read again right before sending).
 */
async function noteFor(ctx: Ctx, kind: HabitKind, date: ISODate, note: { titles: string; full: string }): Promise<string> {
  if (note.full === note.titles) return note.titles;
  const answersDue = date < todayISO(new Date(ctx.now() - ANSWERS_DELAY_MS));
  if (!answersDue) return note.titles;
  // After a Replace, until sync has caught up, the journal here may be missing a tick made or
  // words written after the backup (bugs #58, #64): titles only.
  if (ctx.restoredUnpulled) return note.titles;
  const ticks = await readSharePrivate(ctx.jk!, date);
  return ticks[kind] ? note.titles : note.full;
}

async function sendTallies(ctx: Ctx, kind: HabitKind, habitId: string, days: DayNotes): Promise<void> {
  const { sent } = ctx;
  const prefix = `${kind}:`;
  const dates = new Set<ISODate>([...days.notes.keys(), ...Object.keys(sent.tallies).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))]);
  for (const date of [...dates].sort()) {
    const key = `${kind}:${date}`;
    const rec = sent.tallies[key];
    const day = days.notes.get(date);
    // What may go: the day's note as usual, or, for a day that couldn't be read in full, only
    // its titles, and only to hide answers already sent once she has ticked it private (bug #59).
    let noteNow: (() => Promise<string>) | null = null;
    if (days.unknown.has(date) || days.partial.has(date)) {
      if (!rec?.live || rec.answers === false) continue;
      if (!(await readSharePrivate(ctx.jk!, date))[kind]) continue;
      const titles = day?.titles ?? "";
      noteNow = async () => titles;
    } else if (day) {
      // Whether Together held her answers for the day when this run began (bug #58).
      const hadAnswers = !!rec?.live && rec.answers === true;
      // After a Replace, a day already sent with answers is only ever hidden (when private),
      // never rebuilt or sent again from the restored journal (bug #64).
      if (ctx.restoredUnpulled && hadAnswers && !(await readSharePrivate(ctx.jk!, date))[kind]) continue;
      noteNow = () => noteFor(ctx, kind, date, day);
    }
    if (noteNow) {
      const note = await noteNow();
      const h = await ctx.hash(note);
      if (rec?.live && rec.hash === h) continue;
      if (sent.refused[key]?.hash === h) continue;
      // A sent tally can't be edited: the old one is deleted (its text stays in Together's
      // database, hidden) before a new version goes.
      if (rec?.live) {
        if (!(await ctx.deleteEvent(await togetherId("tally", key, rec.v)))) {
          sent.refused[key] = { hash: h, what: "hide" };
          await ctx.save();
          continue;
        }
        rec.live = false;
        await ctx.save();
      }
      // The tick is read again right before the insert itself (bug #42): the delete above was a
      // round trip, during which she (or a sync) may have ticked the day private.
      const ins = await insertTally(ctx, key, rec ? rec.v + 1 : 1, noteNow, (n) => ({
        couple_id: ctx.auth.coupleId, todo_id: habitId, user_id: ctx.auth.userId, kind: "tally", at: dayStamp(date), note: n === "" ? null : n,
      }));
      if (ins === null) {
        sent.refused[key] = { hash: h, what: "copy" };
        await ctx.save();
        continue;
      }
      sent.tallies[key] = { v: ins.v, hash: await ctx.hash(ins.note), live: true, answers: ins.note !== (day?.titles ?? "") };
      delete sent.refused[key];
      await ctx.save();
    } else if (rec?.live) {
      if (!(await ctx.deleteEvent(await togetherId("tally", key, rec.v)))) {
        sent.refused[key] = { hash: "gone", what: "hide" };
        await ctx.save();
        continue;
      }
      rec.live = false;
      delete sent.refused[key];
      await ctx.save();
    }
  }
  // Together counts live tallies itself; its stored count (for Undo and the plain count) matches.
  const live = Object.entries(sent.tallies).filter(([k, t]) => k.startsWith(prefix) && t.live).length;
  const habit = sent.habits[kind]!;
  if (habit.tally !== live) {
    const r = await ctx.patch("todos", habitId, { tally: live });
    if (r.kind === "ok") {
      habit.tally = live;
      await ctx.save();
    }
  }
}

/**
 * Inserts a tally as version `v` (a plain insert: a skipped duplicate never counts as sent). The
 * note is worked out again right before every attempt, so a private tick that arrived meanwhile
 * is always honoured (bug #42). An id already taken holds content we can't know, so it is deleted
 * and the next version tried (review I2). Returns the version and the note that went in, or null
 * when refused.
 */
async function insertTally(
  ctx: Ctx, key: string, v: number, noteNow: () => Promise<string>, rowFor: (note: string) => Record<string, unknown>,
): Promise<{ v: number; note: string } | null> {
  for (let tries = 0; tries < MAX_VERSION_TRIES; tries++, v++) {
    const id = await togetherId("tally", key, v);
    const note = await noteNow();
    // Written down before it goes (bug #49): if this request is cut off, it may still be in Together.
    (ctx.sent.maybe ??= {})[id] = { key, v };
    await ctx.save();
    const r = await ctx.call("POST", "todo_events", { id, ...rowFor(note) });
    if (r.kind === "ok") {
      delete ctx.sent.maybe[id]; // the caller records it as sent, in the same save
      return { v, note };
    }
    if (!isDuplicate(r)) {
      delete ctx.sent.maybe[id]; // refused: it never went in
      await ctx.save();
      return null;
    }
    if (!(await ctx.deleteEvent(id))) return null; // still a maybe: cleaned up before the next send
    delete ctx.sent.maybe[id];
    await ctx.save();
  }
  return null;
}

/**
 * Deletes every tally that may be in Together without being recorded as sent (bug #49). Each is
 * forgotten only once Together confirms it's deleted, or that it was never there. Returns how
 * many couldn't be.
 */
async function clearMaybes(ctx: Ctx): Promise<number> {
  const maybe = ctx.sent.maybe ?? {};
  let failed = 0;
  for (const id of Object.keys(maybe)) {
    if (await ctx.gone(id)) {
      delete maybe[id];
      await ctx.save();
    } else failed++;
  }
  return failed;
}

// ---- stop: mark everything deleted -------------------------------------------------------------

/**
 * Marks every live tally, every tally that may be in Together (bug #49) and both habits deleted.
 * Returns how many couldn't be.
 */
async function markAllDeleted(ctx: Ctx): Promise<number> {
  const { sent } = ctx;
  let failed = await clearMaybes(ctx);
  for (const [key, t] of Object.entries(sent.tallies)) {
    if (!t.live) continue;
    if (await ctx.gone(await togetherId("tally", key, t.v))) t.live = false;
    else failed++;
    await ctx.save();
  }
  for (const kind of HABITS) {
    // By its fixed id, recorded or not: a habit insert can be cut off too.
    const h = sent.habits[kind];
    if (h?.deleted) continue;
    const id = await togetherId("habit", kind, 1);
    const live = Object.entries(sent.tallies).filter(([k, t]) => k.startsWith(`${kind}:`) && t.live).length;
    if (h && h.tally !== live && (await ctx.patch("todos", id, { tally: live })).kind === "ok") h.tally = live;
    const r = await ctx.patch("todos", id, { deleted_at: ctx.nowIso() });
    if (r.kind === "ok" || (!h && r.code === "no-row")) sent.habits[kind] = { tally: h?.tally ?? 0, deleted: true };
    else failed++;
    await ctx.save();
  }
  return failed;
}
