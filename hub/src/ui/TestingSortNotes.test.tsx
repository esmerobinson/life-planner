/*
 * Testing session (everyday walkthrough), Sort one by one. FICTIONAL data only.
 *
 * What Esme sees: on a sort card she types a note ("Add a note…"), then switches to another
 * app on her phone, or reloads / closes the tab, before tapping anything else. When she comes
 * back the note is gone. The card only saves its note when the box loses focus, when she
 * acts on the card, or when the card is removed by React; a page that is hidden or unloaded
 * does none of those. (The side panel's notes do save here: useDraft's useHiddenFlush.)
 * Seen in a real browser at 1280 and 390: typed, paused 1.5s, page hidden, reload: notes null.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { renderApp } from "../test/renderApp";

const TODAY = "2026-11-04";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("Testing: a note typed on a sort card", () => {
  it("is saved when the page is hidden (phone app switched away) or unloaded", async () => {
    const item = await createItem({ kind: "task", title: "Pretend thing to sort", areaId: "inbox", priority: 2 }, TODAY);
    renderApp("/inbox/sort", TODAY);
    const user = userEvent.setup();
    const notes = await screen.findByLabelText("Notes");
    await user.type(notes, "pretend note typed on the card");

    // She switches away: the page is hidden, then unloaded. No blur, no click, no unmount.
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      fireEvent(window, new Event("pagehide"));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect((await db.items.get(item.id))?.notes).toBe("pretend note typed on the card");
  });
});
