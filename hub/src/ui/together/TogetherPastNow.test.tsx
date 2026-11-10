import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { TogetherRunner } from "../../together/runner";
import { readSent, saveSent } from "../../together/store";
import { clock, emptyDb, signedIn } from "../../together/testKit";
import { TogetherBox } from "./TogetherBox";
import { TOGETHER_WORDS as W } from "./wording";

// "Send past days' answers now" in the Together box (Esme, 2026-11-09): shown only while a past
// day's answers wait on the past-days hold; pressing it ends that hold and sends. Placeholder
// look (magenta, system font). Fake Together only, made-up values.

beforeEach(emptyDb);

async function box(rec: { pastWaiting?: boolean; pastUntilFromNow?: number }) {
  const c = clock("2026-11-04T10:00:00");
  const fake = await signedIn(c);
  const s = (await readSent(db))!;
  await saveSent(db, { ...s, pastWaiting: rec.pastWaiting, pastUntil: Date.now() + (rec.pastUntilFromNow ?? 3_600_000) });
  const send = vi.fn(async () => ({ kind: "ok" as const, sent: 0, refused: 0 }));
  render(<TogetherBox runner={new TogetherRunner(send, async () => false)} fetchFn={fake.fetch} />);
  await screen.findByText(W.copying);
  return { send };
}

it("shown while a past day waits on the hold, with its plain line under it (placeholder look)", async () => {
  await box({ pastWaiting: true });
  const button = await screen.findByRole("button", { name: W.sendPastNow });
  expect(button).toHaveClass("together-placeholder-button");
  const line = screen.getByText(W.sendPastNowNote);
  expect(line).toHaveClass("together-warning");
  expect(W.sendPastNow).toBe("Send past days' answers now");
  expect(W.sendPastNowNote).toBe("Your answers for past days go now. Days you ticked private stay private.");
});

it("hidden when no past day is waiting, or once the hold is over", async () => {
  await box({ pastWaiting: false });
  expect(screen.queryByRole("button", { name: W.sendPastNow })).toBeNull();
  await emptyDb();
  document.body.innerHTML = "";
  await box({ pastWaiting: true, pastUntilFromNow: -1000 });
  expect(screen.queryByRole("button", { name: W.sendPastNow })).toBeNull();
  expect(screen.queryByText(W.sendPastNowNote)).toBeNull();
});

it("pressed (no confirm): the hold ends now, a send runs, and the button goes", async () => {
  const { send } = await box({ pastWaiting: true });
  await userEvent.click(await screen.findByRole("button", { name: W.sendPastNow }));
  await waitFor(() => expect(send).toHaveBeenCalledWith({ retryRefused: true }));
  expect((await readSent(db))!.pastUntil!).toBeLessThanOrEqual(Date.now());
  await waitFor(() => expect(screen.queryByRole("button", { name: W.sendPastNow })).toBeNull());
  expect(screen.queryByRole("dialog")).toBeNull();
});
