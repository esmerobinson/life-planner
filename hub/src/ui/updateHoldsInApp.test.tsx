import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { currentUpdateHold } from "../native/updateHolds";
import { renderApp } from "../test/renderApp";

// What the phone's automatic update (native/pwaUpdate.ts) waits for, in the real app.

const TODAY = "2026-11-19";
const sheet = () => screen.getByRole("dialog", { name: "Add" });

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("automatic updates wait for", () => {
  it("nothing on a plain page", async () => {
    renderApp("/", TODAY);
    await screen.findByRole("button", { name: "Add" });
    expect(currentUpdateHold()).toBeNull();
  });

  it("the journal, while it is open", async () => {
    const { unmount } = renderApp("/journal/morning", TODAY);
    await screen.findByRole("navigation", { name: "Journal parts" });
    expect(currentUpdateHold()).toBe("journal");
    unmount();
    expect(currentUpdateHold()).toBeNull();
  });

  it("the quick box with text in it; not once it is closed (its text is kept on the device)", async () => {
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    await userEvent.type(within(sheet()).getByRole("textbox", { name: "What's on your mind?" }), "Pretend half a thought");
    expect(currentUpdateHold()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull());
    expect(currentUpdateHold()).toBeNull();
  });

  it("the full Add form's kept draft, even closed (it lives only in the page)", async () => {
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    await userEvent.click(within(sheet()).getByRole("button", { name: "More options" }));
    await userEvent.type(within(sheet()).getByRole("textbox", { name: "Title" }), "Pretend big plan");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull());
    expect(currentUpdateHold()).toBe("draft");
    // Cancel forgets it: nothing to wait for.
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.click(within(sheet()).getByRole("button", { name: "More options" }));
    await userEvent.click(within(sheet()).getByRole("button", { name: "Cancel" }));
    expect(currentUpdateHold()).toBeNull();
  });
});
