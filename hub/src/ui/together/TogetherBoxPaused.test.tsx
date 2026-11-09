import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { makeRunner } from "../../together/runner";
import { stopTogether } from "../../together/sender";
import { readAuth, readSent } from "../../together/store";
import { clock, emptyDb, journalDay, liveDays, send, signedIn } from "../../together/testKit";
import { TogetherBox } from "./TogetherBox";
import { TOGETHER_WORDS as W } from "./wording";

// What the box says while copying is paused (a Stop with removing cut off, bug #53), or when an
// earlier build's habits can't be removed. Fake Together only, made-up values.

beforeEach(emptyDb);

async function copied() {
  const c = clock("2026-11-04T10:00:00");
  const fake = await signedIn(c);
  fake.now = () => Date.now(); // the box runs on the real clock
  await journalDay("2026-11-04", { checkin: true });
  c.set("2026-11-05T03:30:00");
  expect((await send(fake, c)).kind).toBe("ok");
  return { c, fake };
}

it("a Stop with removing that was cut off: paused, said plainly; \"Keep copying\" un-pauses, \"Finish removing\" ends it", async () => {
  const { c, fake } = await copied();
  fake.inject({ networkError: true, when: (r) => r.method === "PATCH" });
  expect((await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).kind).toBe("error");
  render(<TogetherBox runner={makeRunner(fake.fetch)} fetchFn={fake.fetch} />);
  expect(await screen.findByText(W.paused)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: W.cancelRemoving }));
  await waitFor(async () => expect((await readSent(db))!.removing).toBeUndefined());
  expect(await screen.findByText(W.copying)).toBeInTheDocument();
});

it("Finish removing from the paused box removes the rest and forgets the sign-in", async () => {
  const { c, fake } = await copied();
  fake.inject({ networkError: true, when: (r) => r.method === "PATCH" });
  await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true });
  render(<TogetherBox runner={makeRunner(fake.fetch)} fetchFn={fake.fetch} />);
  await userEvent.click(await screen.findByRole("button", { name: W.finishRemoving }));
  expect(await screen.findByText(W.stopped)).toBeInTheDocument();
  expect(await readAuth(db)).toBeUndefined();
  expect(liveDays(fake)).toEqual([]);
});

it("an earlier build's habits that Together won't let be removed: said plainly; days are still copied and Last copied moves", async () => {
  const { c, fake } = await copied();
  const { togetherId } = await import("../../together/ids");
  const { saveSent } = await import("../../together/store");
  const tally = await togetherId("tally", "checkin:2026-11-01", 1);
  await saveSent(db, { ...(await readSent(db))!, tallies: { "checkin:2026-11-01": { v: 1, hash: "x", live: true } } });
  fake.inject({ status: 400, body: { code: "23514" }, when: (r) => r.method === "PATCH" && r.url.includes(tally) });
  await journalDay("2026-11-05", { checkin: true });
  c.set("2026-11-06T09:00:00");
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 1 });
  expect((await readSent(db))!.lastCopiedAt).toBe(c.now());
  expect(liveDays(fake).map((d) => d.day)).toEqual(["2026-11-04", "2026-11-05"]);
  render(<TogetherBox runner={makeRunner(fake.fetch)} fetchFn={fake.fetch} />);
  expect(await screen.findByText(W.notHidden(1))).toBeInTheDocument();
});
