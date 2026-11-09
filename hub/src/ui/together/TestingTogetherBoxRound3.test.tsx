import { render, screen } from "@testing-library/react";
import { db } from "../../data/db";
import { makeRunner } from "../../together/runner";
import { readSent } from "../../together/store";
import { clock, emptyDb, journalDay, liveNote, send, signedIn } from "../../together/testKit";
import { TogetherBox } from "./TogetherBox";
import { TOGETHER_WORDS as W } from "./wording";

// Testing session (Life Planner - Together Round 3 Testing), 2026-11-05: what Esme sees while a
// maybe-sent day (its reply lost) can't be overwritten (bug #49). Converted to the challenge
// model (2026-11-09): the day's note is overwritten in place, so nothing new is held back. Fake only.

beforeEach(emptyDb);

it("a maybe-sent day Together refuses to overwrite: the box says a day's answers couldn't be hidden yet (and Send now tries again)", async () => {
  const c = clock("2026-11-04T10:00:00");
  const fake = await signedIn(c);
  await journalDay("2026-11-04", { checkin: true });
  c.set("2026-11-06T03:30:00");
  fake.inject({ lostReply: true, when: (r) => r.method === "POST" && r.url.includes("/rest/v1/challenge_days") });
  expect((await send(fake, c)).kind).toBe("offline");
  expect(liveNote(fake, "2026-11-04")).toContain("Pretend check-in answer"); // it went in
  fake.inject({ status: 400, body: { code: "23514", message: "fake: refused" }, when: (r) => r.method === "PATCH" && r.url.includes("challenge_days") });
  expect((await send(fake, c)).kind).toBe("ok");
  render(<TogetherBox runner={makeRunner(fake.fetch)} fetchFn={fake.fetch} />);
  expect(await screen.findByText(W.notHidden(1))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: W.sendNow })).toBeEnabled();
  expect((await readSent(db))!.lastSentAt).toBe(c.now());
});
