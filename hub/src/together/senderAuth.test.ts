import { db } from "../data/db";
import { signInToTogether, stopTogether, SIGN_IN_MESSAGES, notRemoved } from "./sender";
import { readAuth, readSent, TOGETHER_META, TOGETHER_SENT_META } from "./store";
import { togetherId } from "./ids";
import { clock, COUPLE, EMAIL, emptyDb, fakeTogether, journalDay, ME, PASSWORD, send, signedIn } from "./testKit";

// Signing in, refreshing and stopping, against the fake Together server. Made-up values only.

const DAY = "2026-11-04";
const TITLES_AT = "2026-11-05T03:30:00";

beforeEach(emptyDb);

it("signing in keeps only the address, anon key, her ids and the tokens: never the password or email", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  const auth = (await readAuth(db))!;
  expect(Object.keys(auth).sort()).toEqual(["accessToken", "anonKey", "coupleId", "expiresAt", "refreshToken", "url", "userId"]);
  expect(auth).toMatchObject({ url: fake.url, anonKey: fake.anonKey, userId: ME, coupleId: COUPLE });
  const everything = JSON.stringify(await db.syncMeta.toArray());
  expect(everything).not.toContain(PASSWORD);
  expect(everything).not.toContain(EMAIL);
  expect(fake.requests.filter((r) => r.url.includes("/rest/v1/members"))).toHaveLength(1);
  expect((await readSent(db))!.since).toBe(DAY);
});

it("a wrong password, a plain-http address or no couple: nothing is kept", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = fakeTogether(c);
  fake.addUser("single-pretend@example.test", "pretend-single", "00000000-0000-4000-8000-00000000051e", null);
  const env = { fetch: fake.fetch, now: c.now };
  expect(await signInToTogether(env, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: "wrong" })).toEqual({ kind: "error", message: SIGN_IN_MESSAGES.refused });
  expect(await signInToTogether(env, { url: "http://together.example.test", anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "error", message: SIGN_IN_MESSAGES.badAddress });
  expect(await signInToTogether(env, { url: fake.url, anonKey: fake.anonKey, email: "single-pretend@example.test", password: "pretend-single" })).toEqual({ kind: "error", message: SIGN_IN_MESSAGES.noCouple });
  expect(await db.syncMeta.get(TOGETHER_META)).toBeUndefined();
});

it("an expired token is refreshed first, and the new pair saved before it's used", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  const before = (await readAuth(db))!;
  await journalDay(DAY);
  c.set(TITLES_AT);
  expect(await send(fake, c)).toMatchObject({ kind: "ok" });
  const after = (await readAuth(db))!;
  expect(after.refreshToken).not.toBe(before.refreshToken);
  const i = fake.requests.findIndex((r) => r.url.includes("grant_type=refresh_token"));
  expect(i).toBeGreaterThan(0);
  expect(fake.requests.slice(i + 1).every((r) => r.headers.authorization === `Bearer ${after.accessToken}`)).toBe(true);
});

it("a refused refresh: stops, forgets the tokens, asks to sign in again; signing in again carries on", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  await journalDay(DAY);
  c.set(TITLES_AT);
  fake.revokeRefreshTokens();
  expect(await send(fake, c)).toEqual({ kind: "needs-sign-in" });
  const auth = (await readAuth(db))!;
  expect(auth.accessToken).toBeUndefined();
  expect(auth.refreshToken).toBeUndefined();
  expect(fake.events.size).toBe(0);
  expect(await send(fake, c)).toEqual({ kind: "needs-sign-in" }); // nothing is tried until she signs in
  await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD });
  expect(await send(fake, c)).toMatchObject({ kind: "ok" });
  expect(fake.events.size).toBe(2);
});

it("a 401 on a request: one refresh is tried first (a clock behind isn't a reason to sign in again)", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  await journalDay(DAY);
  c.set(`${DAY}T10:30:00`); // the token still looks fresh here
  fake.expireAccessTokens(); // but the server says no
  c.set(TITLES_AT);
  fake.now = () => new Date(`${DAY}T10:30:00`).getTime(); // the server's clock: the next token is good
  await db.syncMeta.put({ key: TOGETHER_META, value: { ...(await readAuth(db))!, expiresAt: Date.parse("2099-01-01") } });
  expect(await send(fake, c)).toMatchObject({ kind: "ok" });
  expect(fake.requests.filter((r) => r.url.includes("grant_type=refresh_token"))).toHaveLength(1);
});

it("a 401 that a refresh doesn't fix: stops and asks to sign in again", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  await journalDay(DAY);
  c.set(TITLES_AT);
  await db.syncMeta.put({ key: TOGETHER_META, value: { ...(await readAuth(db))!, expiresAt: Date.parse("2099-01-01") } });
  fake.expireAccessTokens();
  fake.revokeRefreshTokens();
  expect(await send(fake, c)).toEqual({ kind: "needs-sign-in" });
  expect((await readAuth(db))!.accessToken).toBeUndefined();
});

it("two runs at once on this device: one is busy, never two refreshes", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  c.advance(2 * 3_600_000);
  const [a, b] = await Promise.all([send(fake, c), send(fake, c)]);
  expect([a.kind, b.kind].sort()).toEqual(["busy", "ok"]);
  expect(fake.requests.filter((r) => r.url.includes("grant_type=refresh_token"))).toHaveLength(1);
});

it("Stop with \"mark deleted\": tallies and habits deleted, sign-in and record forgotten (signing in again starts afresh)", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  await journalDay(DAY);
  c.set(TITLES_AT);
  await send(fake, c);
  expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).toEqual({ kind: "ok" });
  expect(await db.syncMeta.get(TOGETHER_META)).toBeUndefined();
  expect(await db.syncMeta.get(TOGETHER_SENT_META)).toBeUndefined();
  expect([...fake.events.values()].every((e) => e.deleted_at)).toBe(true);
  expect([...fake.todos.values()].every((t) => t.deleted_at)).toBe(true);
  expect(await send(fake, c)).toEqual({ kind: "off" });
  // Signed in again on a later day: earlier days don't go again.
  c.set("2026-11-08T10:00:00");
  await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD });
  expect((await readSent(db))!.since).toBe("2026-11-08");
  await send(fake, c);
  expect(fake.liveTallies(await togetherId("habit", "exercise", 1))).toHaveLength(0);
});

it("Stop without marking deleted leaves Together as it is", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  const n = fake.requests.length;
  expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: false })).toEqual({ kind: "ok" });
  expect(fake.requests.length).toBe(n);
  expect(await db.syncMeta.get(TOGETHER_META)).toBeUndefined();
});

it("Stop with \"mark deleted\" that can't remove everything: says how many, forgets nothing", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  await journalDay(DAY);
  c.set(TITLES_AT);
  await send(fake, c);
  fake.inject({ status: 403, body: { code: "42501" }, when: (r) => r.method === "PATCH" && r.url.includes("todo_events") });
  expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).toEqual({ kind: "error", message: notRemoved(1) });
  expect(await readAuth(db)).toBeTruthy();
  expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).toEqual({ kind: "ok" });
});

it("Stop with \"mark deleted\" while offline: nothing is forgotten", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  await journalDay(DAY);
  c.set(TITLES_AT);
  await send(fake, c);
  fake.inject({ networkError: true });
  expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).toMatchObject({ kind: "error" });
  expect(await readAuth(db)).toBeTruthy();
});
