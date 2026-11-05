import { render, screen } from "@testing-library/react";
import { db } from "../../data/db";
import { makeRunner } from "../../together/runner";
import { readSent } from "../../together/store";
import { clock, emptyDb, journalDay, send, signedIn } from "../../together/testKit";
import { TogetherBox } from "./TogetherBox";
import { TOGETHER_WORDS as W } from "./wording";

// Testing session (Life Planner - Together Round 3 Testing), 2026-11-05: what Esme sees while a
// maybe-sent tally's clean-up is refused and nothing new is copied (bug #49 fix). Fake only.

beforeEach(emptyDb);

it("a refused clean-up: the box says a day's answers couldn't be hidden yet (and Send now tries again)", async () => {
  const c = clock("2026-11-04T10:00:00");
  const fake = await signedIn(c);
  await journalDay("2026-11-04", { checkin: true });
  c.set("2026-11-05T03:30:00");
  expect((await send(fake, c)).kind).toBe("ok");
  c.set("2026-11-06T03:30:00");
  fake.inject({ lostReply: true, when: (r) => r.method === "POST" && r.url.includes("/rest/v1/todo_events") });
  expect((await send(fake, c)).kind).toBe("offline");
  const maybeId = Object.keys((await readSent(db))!.maybe!)[0]!;
  fake.inject({ status: 400, body: { code: "23514", message: "fake: refused" }, when: (r) => r.method === "PATCH" && r.url.includes(maybeId) });
  expect((await send(fake, c)).kind).toBe("ok");
  render(<TogetherBox runner={makeRunner(fake.fetch)} fetchFn={fake.fetch} />);
  expect(await screen.findByText(W.notHidden(1))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: W.sendNow })).toBeEnabled();
  // Observed: "Last copied …" still moves on with each blocked run, and nothing says new days wait.
  expect((await readSent(db))!.lastSentAt).toBe(c.now());
});
