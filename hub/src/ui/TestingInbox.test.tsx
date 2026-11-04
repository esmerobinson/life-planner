/*
 * Testing session (everyday walkthrough), Inbox. FICTIONAL data only.
 *
 * 1. What Esme sees: she jots "Ring the pretend dentist" in the Inbox, taps its calendar
 *    icon and picks "Do it on: Today". The strip now says "On Wed 4 Nov", but Home's Today
 *    list says "Nothing planned for today": the thing she just planned for today is not
 *    there (Inbox items are left out of Today entirely, pins and deadlines too).
 *
 * 2. What Esme sees: she types several thoughts into "Add to inbox", one after the other.
 *    They do not stay in the order she typed them: each new one lands at a random place
 *    among today's items (and the order differs from one device or reload of the data to
 *    the next), because items made on the same day are ordered by their random id.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cleanup } from "@testing-library/react";
import { vi } from "vitest";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { renderApp } from "../test/renderApp";

const TODAY = "2026-11-04"; // a Wednesday

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.useRealTimers());

describe("Testing: Inbox everyday use", () => {
  it("an Inbox item scheduled 'Do it on: Today' from its strip shows on Home's Today list", async () => {
    await createItem({ kind: "task", title: "Ring the pretend dentist", areaId: "inbox", priority: 2 }, TODAY);
    renderApp("/inbox", TODAY);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Schedule for: Ring the pretend dentist" }));
    await user.click(within(screen.getByRole("group", { name: "Do it on" })).getByRole("button", { name: "Today" }));
    // The strip says it is planned for today.
    await screen.findByText("On Wed 4 Nov");
    cleanup();

    renderApp("/", TODAY);
    await screen.findByText("Morning pages"); // Home has loaded
    // Expected: on Today. Actual: "Nothing planned for today."
    const todayList = await screen.findByRole("list", { name: "Today" });
    expect(within(todayList).getByText("Ring the pretend dentist")).toBeInTheDocument();
  });

  it("Inbox items typed one after another stay in the order they were typed", async () => {
    renderApp("/inbox", TODAY);
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Add to inbox");
    const typed = ["Pretend one", "Pretend two", "Pretend three", "Pretend four", "Pretend five", "Pretend six", "Pretend seven", "Pretend eight"];
    for (const t of typed) {
      await user.type(box, `${t}{Enter}`);
      await screen.findByText(t);
    }
    await act(async () => {});
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Inbox items" })).getAllByRole("listitem")).toHaveLength(8));
    const shown = within(screen.getByRole("list", { name: "Inbox items" }))
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".strip-title")!.textContent);
    expect(shown).toEqual(typed);
  });
});
