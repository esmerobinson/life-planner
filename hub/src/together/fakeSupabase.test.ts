import { FakeSupabase } from "./fakeSupabase";

// The fake Together server holds the sender to the rules the brief lists, so the sender's tests
// can trust it. Made-up users and ids only.

const ME = "00000000-0000-4000-8000-0000000000e5";
const PARTNER = "00000000-0000-4000-8000-0000000000b0";
const COUPLE = "00000000-0000-4000-8000-00000000c0c0";
const H1 = "11111111-1111-4111-8111-111111111111";
const E1 = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const f = new FakeSupabase();
  f.addUser("me@example.test", "pretend-pass-1", ME, COUPLE);
  f.addUser("partner@example.test", "pretend-pass-2", PARTNER, COUPLE);
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
      method, headers: { apikey: f.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { f, me, partner, rest };
}

const habit = (extra: Record<string, unknown> = {}) => ({ id: H1, couple_id: COUPLE, owner_id: ME, created_by: ME, title: "Pretend habit", type: "habit", ...extra });
const tally = (extra: Record<string, unknown> = {}) => ({ id: E1, couple_id: COUPLE, todo_id: H1, user_id: ME, kind: "tally", note: "Pretend note", ...extra });

it("needs the anon key and a live access token", async () => {
  const { f, me } = await setup();
  expect((await f.fetch(`${f.url}/rest/v1/todos`, { method: "POST", headers: { Authorization: `Bearer ${me.access_token}` }, body: "{}" })).status).toBe(401);
  f.expireAccessTokens();
  expect((await f.fetch(`${f.url}/rest/v1/todos`, { method: "POST", headers: { apikey: f.anonKey, Authorization: `Bearer ${me.access_token}` }, body: JSON.stringify(habit()) })).status).toBe(401);
});

it("owner and creator must be the caller; points never negative; an id once", async () => {
  const { rest, me } = await setup();
  expect((await rest(me.access_token, "POST", "todos", habit({ owner_id: PARTNER }))).status).toBe(403);
  expect((await rest(me.access_token, "POST", "todos", habit({ created_by: PARTNER }))).status).toBe(403);
  expect((await rest(me.access_token, "POST", "todos", habit({ points_earn: -1 }))).status).toBe(400);
  expect((await rest(me.access_token, "POST", "todos", habit())).status).toBe(201);
  expect((await rest(me.access_token, "POST", "todos", habit())).status).toBe(409);
});

it("fixed columns can't change; stamps and unused columns are never accepted", async () => {
  const { rest, me, f } = await setup();
  await rest(me.access_token, "POST", "todos", habit());
  expect((await rest(me.access_token, "PATCH", `todos?id=eq.${H1}`, { owner_id: PARTNER })).status).toBe(400);
  expect((await rest(me.access_token, "PATCH", `todos?id=eq.${H1}`, { updated_at: "2026-11-04T00:00:00Z" })).status).toBe(400);
  expect((await rest(me.access_token, "PATCH", `todos?id=eq.${H1}`, { pretend_unused_column: "x" })).status).toBe(400);
  expect((await rest(me.access_token, "PATCH", `todos?id=eq.${H1}`, { tally: 2 })).status).toBe(204);
  expect(f.todos.get(H1)!.tally).toBe(2);
});

it("an event: its to-do first; an id once; only deleted_at, once, by her", async () => {
  const { rest, me, partner, f } = await setup();
  expect((await rest(me.access_token, "POST", "todo_events", tally())).status).toBe(409); // no to-do yet
  await rest(me.access_token, "POST", "todos", habit());
  expect((await rest(me.access_token, "POST", "todo_events", tally())).status).toBe(201);
  expect((await rest(me.access_token, "POST", "todo_events", tally({ note: "Changed" }))).status).toBe(409);
  expect((await rest(me.access_token, "PATCH", `todo_events?id=eq.${E1}`, { note: "Changed" })).status).toBe(403);
  await rest(partner.access_token, "PATCH", `todo_events?id=eq.${E1}`, { deleted_at: "2026-11-04T00:00:00Z" });
  expect(f.events.get(E1)!.deleted_at).toBeNull(); // the partner's delete touched nothing
  expect((await rest(me.access_token, "PATCH", `todo_events?id=eq.${E1}`, { deleted_at: "2026-11-04T00:00:00Z" })).status).toBe(204);
  expect((await rest(me.access_token, "PATCH", `todo_events?id=eq.${E1}`, { deleted_at: null })).status).toBe(400);
  expect((await rest(me.access_token, "PATCH", `todo_events?id=eq.${E1}`, { deleted_at: "2026-11-05T00:00:00Z" })).status).toBe(400);
  expect(f.events.get(E1)!.note).toBe("Pretend note"); // a deleted tally keeps its text
});

it("refresh tokens work once", async () => {
  const { f, me } = await setup();
  const ask = () => f.fetch(`${f.url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: f.anonKey }, body: JSON.stringify({ refresh_token: me.refresh_token }) });
  expect((await ask()).status).toBe(200);
  expect((await ask()).status).toBe(400);
});
