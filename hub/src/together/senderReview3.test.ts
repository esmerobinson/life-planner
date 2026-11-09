import { db } from "../data/db";
import { listHighlights, openNoteSession, saveAnswer, saveHighlightNote, saveLearned, saveSharePrivate } from "../data/repo";
import { journalAad, sealJson } from "../journal/crypto";
import { keyFor } from "../test/journalKey";
import { signInToTogether, stopTogether } from "./sender";
import { readSent } from "./store";
import {
  CHALLENGE, clock, COUPLE, dayRow, dayWrites, DEVICE, EMAIL, emptyDb, highlightOn, journalDay, liveDays, liveNote, ME, PARTNER, PASSWORD, send, signedIn,
} from "./testKit";

// Fix round 3 (review of together-challenge @f8997a2, 2026-11-09): I1 the 24 h hold restarts at
// every sign-in; I2 research notes changed late wait 24 h after their newest change; I3 nothing
// new is written into an entry she deleted in Together; M1 the known id only if it's hers; M9 one
// unreadable exercise row holds back only its own day. Fake Together only, every word made up.

beforeEach(emptyDb);

const ANSWER = /Pretend exercise answer|Pretend check-in answer/;

describe("I1: signing in again restarts the 24 h hold", () => {
  it("after Stop (keep), days journalled meanwhile go titles-only until 24 h after the new sign-in; a day sent with answers before stays as it was", async () => {
    const c = clock("2026-11-01T10:00:00");
    const fake = await signedIn(c);
    await journalDay("2026-11-01", { checkin: true });
    c.set("2026-11-03T03:30:00");
    await send(fake, c); // 1 Nov with answers
    expect(liveNote(fake, "2026-11-01")).toContain("Pretend check-in answer");
    const sentBefore = liveNote(fake, "2026-11-01");
    expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: false })).toEqual({ kind: "ok" });
    await journalDay("2026-11-04", { exercise: true, checkin: true });
    c.set("2026-11-08T10:00:00");
    expect((await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).kind).toBe("ok");
    const n = dayWrites(fake).length;
    c.set("2026-11-08T10:01:00");
    await send(fake, c);
    expect(liveNote(fake, "2026-11-04")).toBeDefined();
    expect(liveNote(fake, "2026-11-04")).not.toMatch(ANSWER);
    expect(liveNote(fake, "2026-11-01")).toBe(sentBefore); // left as it was, not taken back to titles
    expect(dayWrites(fake).slice(n).filter((r) => r.url.includes(String(dayRow(fake, "2026-11-01")!.id)))).toEqual([]);
    c.set("2026-11-09T09:59:00");
    await send(fake, c);
    expect(liveNote(fake, "2026-11-04")).not.toMatch(ANSWER);
    c.set("2026-11-09T10:00:00");
    await send(fake, c);
    expect(liveNote(fake, "2026-11-04")).toMatch(ANSWER);
  });

  it("after Stop with removing, then signing in again: the days come back (the same rows), answers only 24 h after the sign-in", async () => {
    const c = clock("2026-11-01T10:00:00");
    const fake = await signedIn(c);
    await journalDay("2026-11-01", { checkin: true });
    c.set("2026-11-03T03:30:00");
    await send(fake, c);
    expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).toEqual({ kind: "ok" });
    expect(liveDays(fake)).toEqual([]);
    c.set("2026-11-08T10:00:00");
    await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD });
    await send(fake, c);
    expect(fake.days.size).toBe(1);
    expect(liveNote(fake, "2026-11-01")).toBeDefined();
    expect(liveNote(fake, "2026-11-01")).not.toMatch(ANSWER);
    c.set("2026-11-09T10:00:00");
    await send(fake, c);
    expect(liveNote(fake, "2026-11-01")).toMatch(ANSWER);
  });
});

describe("I2: research notes changed late wait 24 h after their newest change", () => {
  it("a note added today to an old highlight, and learned words added today: the day keeps what went, until 24 h later", async () => {
    const D = "2026-11-01";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true });
    const hid = await highlightOn(D, "pretend Mossbury lane");
    c.set("2026-11-03T03:30:00");
    await send(fake, c);
    const before = liveNote(fake, D)!;
    expect(before).toContain("• pretend Mossbury lane\n");
    c.set("2026-11-09T21:00:00");
    const h = (await listHighlights(jk)).highlights.find((x) => x.hids.includes(hid))!;
    await saveHighlightNote(jk, DEVICE, openNoteSession(h), "Pretend Mossbury late note");
    await saveLearned(jk, D, DEVICE, "Pretend Mossbury late learning");
    c.set("2026-11-09T21:01:00");
    await send(fake, c);
    expect(liveNote(fake, D)).toBe(before);
    expect(JSON.stringify(fake.requests)).not.toMatch(/Mossbury late/);
    c.set("2026-11-10T20:59:00");
    await send(fake, c);
    expect(JSON.stringify(fake.requests)).not.toMatch(/Mossbury late/);
    c.set("2026-11-10T21:01:00");
    await send(fake, c);
    expect(liveNote(fake, D)).toContain("• pretend Mossbury lane — Pretend Mossbury late note");
    expect(liveNote(fake, D)).toContain("• Pretend Mossbury late learning");
  });

  it("a late change on a day not yet sent with answers: titles only for the exercise until 24 h after it; a private tick still hides at once", async () => {
    const D = "2026-11-01";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true, checkin: true });
    c.set("2026-11-02T03:30:00");
    await send(fake, c); // titles
    c.set("2026-11-02T20:00:00");
    await saveLearned(jk, D, DEVICE, "Pretend Fallowmere late learning");
    c.set("2026-11-03T03:30:00"); // the day's answers are due, but the learned words are 7.5 h old
    await send(fake, c);
    expect(liveNote(fake, D)).not.toMatch(/Pretend exercise answer|Fallowmere/);
    expect(liveNote(fake, D)).toContain("Pretend check-in answer");
    c.set("2026-11-03T20:01:00");
    await send(fake, c);
    expect(liveNote(fake, D)).toContain("Pretend exercise answer");
    expect(liveNote(fake, D)).toContain("• Pretend Fallowmere late learning");
    c.set("2026-11-04T09:00:00");
    await saveLearned(jk, D, DEVICE, "Pretend Fallowmere later still");
    await saveSharePrivate(jk, D, "exercise", true);
    await send(fake, c);
    expect(liveNote(fake, D)).not.toMatch(/Pretend exercise answer|Fallowmere/);
  });
});

describe("I3: an entry she deleted in Together", () => {
  it("deleted after the titles went: her answers never go into it; left alone and counted, never sent again", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T10:00:00`);
    const fake = await signedIn(c);
    await journalDay(D, { exercise: true, checkin: true });
    c.set("2026-11-05T03:30:00");
    await send(fake, c);
    const row = dayRow(fake, D)!;
    fake.days.set(String(row.id), { ...row, deleted_at: "2026-11-05T08:00:00.000Z" }); // she deletes it in Together
    for (const at of ["2026-11-06T03:30:00", "2026-11-07T03:30:00"]) {
      c.set(at);
      await send(fake, c);
    }
    expect(String(dayRow(fake, D)!.note)).not.toMatch(ANSWER);
    expect(dayRow(fake, D)!.deleted_at).toBe("2026-11-05T08:00:00.000Z");
    // Answers only ever went with "deleted_at=is.null": never into the deleted row.
    for (const r of dayWrites(fake).filter((x) => ANSWER.test(x.body))) expect(r.url).toContain("deleted_at=is.null");
    expect((await readSent(db))!.byHand).toEqual({ [D]: true });
    const n = dayWrites(fake).length;
    c.set("2026-11-08T09:00:00");
    await send(fake, c, true);
    expect(dayWrites(fake).length).toBe(n); // left alone
  });

  it("deleted after her answers went: an edit never goes in; the answers already there are taken out", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T10:00:00`);
    const fake = await signedIn(c);
    const { jk, q1 } = await journalDay(D, { checkin: true });
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    const row = dayRow(fake, D)!;
    fake.days.set(String(row.id), { ...row, deleted_at: "2026-11-06T08:00:00.000Z" });
    await saveAnswer(jk, D, q1.id, DEVICE, "Pretend Wendle edited answer", true, { session: "1" });
    await send(fake, c);
    for (const r of dayWrites(fake).filter((x) => x.body.includes("Pretend Wendle"))) expect(r.url).toContain("deleted_at=is.null");
    expect(JSON.stringify([...fake.days.values()])).not.toContain("Pretend Wendle edited answer");
    expect(String(dayRow(fake, D)!.note)).not.toMatch(ANSWER);
    expect(dayRow(fake, D)!.deleted_at).toBe("2026-11-06T08:00:00.000Z");
  });

  it("a day we removed ourselves (a card un-ticked) still comes back when ticked again", async () => {
    const { saveExerciseMark } = await import("../data/repo");
    const D = "2026-11-04";
    const c = clock(`${D}T10:00:00`);
    const fake = await signedIn(c);
    const { jk, card } = await journalDay(D, { exercise: true });
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    await saveExerciseMark(jk, D, DEVICE, card.id, false);
    await send(fake, c);
    expect(liveDays(fake)).toEqual([]);
    await saveExerciseMark(jk, D, DEVICE, card.id, true);
    await send(fake, c);
    expect(liveNote(fake, D)).toContain("Pretend exercise answer");
  });
});

it("M1: the known id is hers only if it's for her (or no one)", async () => {
  const c = clock("2026-11-04T10:00:00");
  const fake = await signedIn(c);
  fake.challenges.set(CHALLENGE, { ...fake.challenges.get(CHALLENGE)!, for_user: PARTNER, name: "Pretend Oliver thing" });
  await journalDay("2026-11-04", { checkin: true });
  c.set("2026-11-05T03:30:00");
  await send(fake, c);
  expect(fake.days.size).toBe(0);
  expect(fake.challenges.get(CHALLENGE)!.name).toBe("Pretend Oliver thing");
  expect((await readSent(db))!.challengeMissing).toBe(true);
  void ME;
  void COUPLE;
});

it("M9: one exercise row that won't open holds back only its own day", async () => {
  const c = clock("2026-11-03T10:00:00");
  const fake = await signedIn(c);
  await journalDay("2026-11-03", { exercise: true });
  const { jk } = await journalDay("2026-11-04", { exercise: true });
  void jk;
  const other = await keyFor("fake-journal-some-other-key");
  for (const id of ["exercise-entry:2026-11-03:0a1b2c3d4e5f:device-pretend-phone-9", "exercise:2026-11-03:device-pretend-phone-9"]) {
    const kind = id.split(":")[0]!;
    await db.journal.put({ id, kind, date: "2026-11-03", fp: other.fp, ...(await sealJson(other.key, { v: 1, pretend: kind }, journalAad(id))) } as never);
  }
  c.set("2026-11-06T03:30:00");
  await send(fake, c);
  expect(liveNote(fake, "2026-11-04")).toContain("Pretend exercise answer");
  expect(JSON.stringify(fake.requests.filter((r) => r.body.includes('"day":"2026-11-03"')))).not.toContain("Pretend exercise answer");
});
