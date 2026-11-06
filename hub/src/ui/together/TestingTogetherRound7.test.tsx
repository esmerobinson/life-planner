import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exportBackup, restoreBackup } from "../../data/backup";
import { db } from "../../data/db";
import { saveLearned } from "../../data/repo";
import { journalAad, sealJson } from "../../journal/crypto";
import { TogetherRunner } from "../../together/runner";
import { sendToTogether } from "../../together/sender";
import { readSent } from "../../together/store";
import { clock, EMAIL, emptyDb, fakeTogether, journalDay, PASSWORD } from "../../together/testKit";
import { LearnedToday } from "./LearnedToday";
import { TogetherBox } from "./TogetherBox";
import { TOGETHER_WORDS as W } from "./wording";

// TESTING (Life Planner - Together Round 7 Testing, 2026-11-06): Together v1 sends only the
// exercise and check-in answers. Nothing on screen may say "what I learned" or highlights go to
// Together; the restore line (#65) shows when answers are held, and only then. Made-up words only.
// Tests named "BUG:" fail on together-link @c871add.

beforeEach(emptyDb);

const DAY = "2026-11-04";
const MAC = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";

describe("v1 wording: nothing says learned words or highlights go to Together", () => {
  it("BUG: the learned box's Remove question doesn't say the words are in Together", async () => {
    const { jk } = await journalDay(DAY, {});
    await saveLearned(jk, DAY, MAC, "Pretend Quorrel Mac lesson");
    const id = `learned:${DAY}:${PHONE}`;
    await db.journal.put({ id, kind: "learned", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "Pretend Vantry phone lesson", at: Date.now() + 1 }, journalAad(id))) });
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    await screen.findByDisplayValue("Pretend Vantry phone lesson");
    await userEvent.click(screen.getByRole("button", { name: W.learnedRemove }));
    const ask = screen.getByRole("group", { name: W.learnedRemoveAsk });
    expect(ask.textContent, "the Remove question says the words would otherwise be in Together").not.toMatch(/Together|Oliver/);
  });

  it("the learned box itself (with earlier days) says nothing about Together or Oliver", async () => {
    const { jk } = await journalDay(DAY, {});
    await saveLearned(jk, "2026-11-03", MAC, "Pretend Wennick lesson from yesterday");
    await saveLearned(jk, DAY, MAC, "Pretend Halvery lesson");
    const { container } = render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    await screen.findByDisplayValue("Pretend Halvery lesson");
    expect(container.textContent).not.toMatch(/Together|Oliver|partner/i);
  });

  it("no Together wording mentions highlights; only the Remove question among the learned lines mentions Together", () => {
    const words = Object.entries(W).filter(([, v]) => typeof v === "string") as [string, string][];
    expect(words.filter(([, v]) => /highlight/i.test(v)).map(([k]) => k)).toEqual([]);
    // (core-together, round 8: with #66 fixed, no learned line mentions Together any more.)
    expect(words.filter(([k, v]) => k.startsWith("learned") && /Together|Oliver/.test(v)).map(([k]) => k)).toEqual([]);
  });
});

describe("#65: the restore line in the Together box, after a real Replace", () => {
  it("shown while answers are held (sync off), gone after the 24 h, and never before a Replace", async () => {
    const c = clock("2026-11-06T09:00:00");
    const fake = fakeTogether(c);
    const runner = new TogetherRunner((o) => sendToTogether({ fetch: fake.fetch, now: c.now, retryRefused: o.retryRefused }));
    render(<TogetherBox runner={runner} fetchFn={fake.fetch} />);
    const form = screen.getByRole("form", { name: "Sign in to Together" });
    await userEvent.type(within(form).getByLabelText(W.address), fake.url);
    await userEvent.type(within(form).getByLabelText(W.anonKey), fake.anonKey);
    await userEvent.type(within(form).getByLabelText(W.email), EMAIL);
    await userEvent.type(within(form).getByLabelText(W.password), PASSWORD);
    await userEvent.click(within(form).getByRole("button", { name: W.signIn }));
    await screen.findByText(W.copying);
    await journalDay("2026-11-06", { exercise: true });
    await userEvent.click(screen.getByRole("button", { name: W.sendNow }));
    await waitFor(async () => expect((await readSent(db))?.lastSentAt).toBeDefined());
    expect(screen.queryByText(W.restoreWaiting)).toBeNull();
    await restoreBackup(JSON.parse(JSON.stringify(await exportBackup("2026-11-06"))), "replace");
    await userEvent.click(screen.getByRole("button", { name: W.sendNow }));
    expect(await screen.findByText(W.restoreWaiting)).toBeInTheDocument();
    c.advance(24 * 3_600_000);
    await userEvent.click(screen.getByRole("button", { name: W.sendNow }));
    await waitFor(() => expect(screen.queryByText(W.restoreWaiting)).toBeNull());
  });

  it("BUG: sync off after a Replace: 24 h later the answers go by themselves, as the box line says (no Send now pressed)", async () => {
    // The line says "Your answers go once it has (or after 24 hours, if sync stays off)". With
    // sync off nothing runs the sender except Send now (it runs after each sync), so the answers
    // wait for her to press it, however long after the 24 h.
    const c = clock("2026-11-04T10:00:00");
    const fake = fakeTogether(c);
    const { signInToTogether } = await import("../../together/sender");
    await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD });
    await journalDay("2026-11-04", { exercise: true });
    const runner = new TogetherRunner((o) => sendToTogether({ fetch: fake.fetch, now: c.now, retryRefused: o.retryRefused }));
    let listener = () => undefined as void;
    const stop = runner.start({ getState: () => ({ status: "off", lastSyncedAt: null }), subscribe: (fn) => ((listener = fn), () => undefined) });
    await restoreBackup(JSON.parse(JSON.stringify(await exportBackup("2026-11-04"))), "replace");
    c.set("2026-11-06T09:00:00");
    await runner.sendNow(); // she presses Send now once: the line appears
    expect((await readSent(db))!.waitingRestore).toBe(true);
    c.advance(25 * 3_600_000); // a day and more passes, app open, sync still off
    listener();
    await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(fake.requests.some((r) => r.body.includes("Pretend exercise answer")), "answers went after the 24 h without Send now").toBe(true);
  });
});
