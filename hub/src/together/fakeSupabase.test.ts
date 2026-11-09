import { FakeSupabase } from "./fakeSupabase";

// The fake Together server holds the sender to the rules of Together's challenges (as the
// challenge brief lists them), so the sender's tests can trust it. Made-up users and ids only.

const ME = "00000000-0000-4000-8000-0000000000e5";
const PARTNER = "00000000-0000-4000-8000-0000000000b0";
const COUPLE = "00000000-0000-4000-8000-00000000c0c0";
const OTHER_COUPLE = "00000000-0000-4000-8000-00000000c0c1";
const H1 = "11111111-1111-4111-8111-111111111111";
const E1 = "22222222-2222-4222-8222-222222222222";
const D1 = "pretend-day-id-1";

async function setup() {
  const f = new FakeSupabase();
  f.addUser("me@example.test", "pretend-pass-1", ME, COUPLE);
  f.addUser("partner@example.test", "pretend-pass-2", PARTNER, COUPLE);
  f.addChallenge({ id: "ch-1", couple_id: COUPLE, name: "BPD research", for_user: ME });
  f.addChallenge({ id: "ch-other", couple_id: OTHER_COUPLE, name: "BPD research" });
  const sign = async (email: string, password: string) => {
    const r = await f.fetch(`${f.url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: f.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    return (await r.json()) as { access_token: string; refresh_token: string };
  };
  const me = await sign("me@example.test", "pretend-pass-1");
  const partner = await sign("partner@example.test", "pretend-pass-2");
  const rest = (token: string, method: string, path: string, body?: unknown) =>
    f.fetch(`${f.url}/rest/v1/${path}`, {
      method, headers: { apikey: f.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { f, me, partner, rest };
}

const day = (extra: Record<string, unknown> = {}) => ({ id: D1, couple_id: COUPLE, challenge_id: "ch-1", day: "2026-11-04", note: "Pretend note", ...extra });

it("needs the anon key and a live access token", async () => {
  const { f, me } = await setup();
  expect((await f.fetch(`${f.url}/rest/v1/challenge_days`, { method: "POST", headers: { Authorization: `Bearer ${me.access_token}` }, body: "{}" })).status).toBe(401);
  f.expireAccessTokens();
  expect((await f.fetch(`${f.url}/rest/v1/challenge_days`, { method: "POST", headers: { apikey: f.anonKey, Authorization: `Bearer ${me.access_token}` }, body: JSON.stringify(day()) })).status).toBe(401);
});

it("challenges: only her couple's are seen; renamed by id; id, start and couple never change", async () => {
  const { rest, me, f } = await setup();
  const seen = (await (await rest(me.access_token, "GET", `challenges?couple_id=eq.${COUPLE}&select=id,name,for_user`)).json()) as unknown[];
  expect(seen).toEqual([{ id: "ch-1", name: "BPD research", for_user: ME }]);
  expect((await rest(me.access_token, "PATCH", "challenges?id=eq.ch-other", { name: "Mine now" })).status).toBe(200);
  expect(f.challenges.get("ch-other")!.name).toBe("BPD research"); // another couple's: untouched
  for (const k of ["id", "start", "couple_id"]) expect((await rest(me.access_token, "PATCH", "challenges?id=eq.ch-1", { [k]: "x" })).status).toBe(400);
  expect((await rest(me.access_token, "PATCH", "challenges?id=eq.ch-1", { name: "Mental Health Work" })).status).toBe(200);
  expect(f.challenges.get("ch-1")!.name).toBe("Mental Health Work");
});

it("a day: her couple, a challenge of it, a non-blank note; `by` is hers; one row per challenge and day; an id once", async () => {
  const { rest, me, f } = await setup();
  expect((await rest(me.access_token, "POST", "challenge_days", day({ couple_id: OTHER_COUPLE }))).status).toBe(403);
  expect((await rest(me.access_token, "POST", "challenge_days", day({ challenge_id: "ch-other" }))).status).toBe(409); // not her couple's
  expect((await rest(me.access_token, "POST", "challenge_days", day({ note: "  \n " }))).status).toBe(400);
  expect((await rest(me.access_token, "POST", "challenge_days", day({ by: PARTNER }))).status).toBe(400); // never sent
  expect((await rest(me.access_token, "POST", "challenge_days", day({ created_at: "2026-11-04T00:00:00Z" }))).status).toBe(400);
  expect((await rest(me.access_token, "POST", "challenge_days", day())).status).toBe(201);
  expect(f.days.get(D1)).toMatchObject({ by: ME, deleted_at: null });
  const twice = await rest(me.access_token, "POST", "challenge_days", day());
  expect([twice.status, ((await twice.json()) as { code: string }).code]).toEqual([409, "23505"]);
  const sameDay = await rest(me.access_token, "POST", "challenge_days", day({ id: "pretend-day-id-2" }));
  expect([sameDay.status, ((await sameDay.json()) as { code: string }).code]).toEqual([409, "23505"]);
});

it("afterwards only note (never blank) and deleted_at change, by either member, one row by id", async () => {
  const { rest, me, partner, f } = await setup();
  await rest(me.access_token, "POST", "challenge_days", day());
  for (const k of ["day", "challenge_id", "couple_id", "id", "by"]) {
    expect((await rest(me.access_token, "PATCH", `challenge_days?couple_id=eq.${COUPLE}&id=eq.${D1}`, { [k]: "x" })).status).toBe(403);
  }
  expect((await rest(me.access_token, "PATCH", `challenge_days?couple_id=eq.${COUPLE}&id=eq.${D1}`, { note: " " })).status).toBe(400);
  expect((await rest(me.access_token, "PATCH", `challenge_days?couple_id=eq.${COUPLE}`, { note: "x" })).status).toBe(400); // no id
  expect((await rest(me.access_token, "PATCH", `challenge_days?couple_id=eq.${COUPLE}&id=eq.${D1}`, { note: "Pretend new note" })).status).toBe(200);
  expect(f.days.get(D1)!.note).toBe("Pretend new note");
  await rest(partner.access_token, "PATCH", `challenge_days?couple_id=eq.${COUPLE}&id=eq.${D1}`, { deleted_at: "2026-11-05T00:00:00Z" });
  expect(f.days.get(D1)!.deleted_at).toBe("2026-11-05T00:00:00Z");
  expect((await rest(me.access_token, "PATCH", `challenge_days?couple_id=eq.${COUPLE}&id=eq.${D1}`, { deleted_at: null })).status).toBe(200);
  expect(f.days.get(D1)!.deleted_at).toBeNull();
});

it("to-dos: never inserted; an earlier build's are only marked deleted, an event once", async () => {
  const { rest, me, f } = await setup();
  expect((await rest(me.access_token, "POST", "todos", { id: H1, couple_id: COUPLE, owner_id: ME, created_by: ME, title: "x", type: "habit" })).status).toBe(403);
  expect((await rest(me.access_token, "POST", "todo_events", { id: E1, couple_id: COUPLE, todo_id: H1, user_id: ME, kind: "tally" })).status).toBe(403);
  f.seedLegacy({ id: H1, couple_id: COUPLE, owner_id: ME, created_by: ME, title: "Pretend habit" }, [{ id: E1, couple_id: COUPLE, user_id: ME }]);
  expect((await rest(me.access_token, "PATCH", `todos?id=eq.${H1}`, { tally: 2 })).status).toBe(403);
  expect((await rest(me.access_token, "PATCH", `todos?id=eq.${H1}`, { deleted_at: null })).status).toBe(403);
  expect((await rest(me.access_token, "PATCH", `todos?id=eq.${H1}`, { deleted_at: "2026-11-09T00:00:00Z" })).status).toBe(200);
  expect((await rest(me.access_token, "PATCH", `todos?id=eq.${H1}`, { deleted_at: "2026-11-09T01:00:00Z" })).status).toBe(200); // again: fine
  expect((await rest(me.access_token, "PATCH", `todo_events?id=eq.${E1}`, { deleted_at: "2026-11-09T00:00:00Z" })).status).toBe(200);
  const again = await rest(me.access_token, "PATCH", `todo_events?id=eq.${E1}`, { deleted_at: "2026-11-09T01:00:00Z" });
  expect([again.status, ((await again.json()) as { code: string }).code]).toEqual([400, "P0001"]);
});

it("refresh tokens work once", async () => {
  const { f, me } = await setup();
  const ask = () => f.fetch(`${f.url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: f.anonKey }, body: JSON.stringify({ refresh_token: me.refresh_token }) });
  expect((await ask()).status).toBe(200);
  expect((await ask()).status).toBe(400);
});
