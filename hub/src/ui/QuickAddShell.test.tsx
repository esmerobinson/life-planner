import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { currentUrl, renderApp } from "../test/renderApp";
import { QUICK_DRAFT_KEY } from "./QuickCapture";

// The phone's round + opens the one-box quick add; "More options" is the full Add form; /add
// opens straight into the quick add (her home-screen bookmark).

const TODAY = "2026-11-17";

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? matches : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const sheet = () => screen.getByRole("dialog", { name: "Add" });
const quickBox = () => within(sheet()).getByRole("textbox", { name: "What's on your mind?" });

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("quick add on the phone", () => {
  beforeEach(() => setPhone(true));

  it("the + opens the quick box, focused (the real-browser test checks it happens inside the tap)", async () => {
    renderApp("/", TODAY);
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    expect(document.activeElement).toBe(quickBox());
    expect(within(sheet()).queryByRole("button", { name: "Add item" })).toBeNull();
  });

  it("Return saves to the Inbox and the sheet stays open for the next one", async () => {
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    await userEvent.type(quickBox(), "Pretend buy stamps{Enter}");
    expect(await within(sheet()).findByRole("status")).toHaveTextContent("Added");
    expect(quickBox()).toHaveValue("");
    expect(quickBox()).toHaveFocus();
    const items = await db.items.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Pretend buy stamps", areaId: "inbox", kind: "task" });
  });

  it("closing keeps the half-typed entry for the next open", async () => {
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    await userEvent.type(quickBox(), "Pretend half typed");
    await userEvent.click(within(sheet()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(quickBox()).toHaveValue("Pretend half typed");
  });

  it("More options opens the full Add form with what was typed; adding there clears the quick draft", async () => {
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    await userEvent.type(quickBox(), "Pretend bigger plan");
    await userEvent.click(within(sheet()).getByRole("button", { name: "More options" }));
    const title = within(sheet()).getByRole("textbox", { name: "Title" });
    expect(title).toHaveValue("Pretend bigger plan");
    expect(title).toHaveFocus();
    await userEvent.click(within(sheet()).getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    expect(localStorage.getItem(QUICK_DRAFT_KEY)).toBeNull();
    // The next + is the quick box again, empty.
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(quickBox()).toHaveValue("");
  });

  it("/add opens straight into the quick box over Home; closing goes Home", async () => {
    renderApp("/add", TODAY);
    expect(await screen.findByRole("textbox", { name: "What's on your mind?" })).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1, name: "Esmeworld" })).toBeInTheDocument();
    await userEvent.click(within(sheet()).getByRole("button", { name: "Close" }));
    expect(currentUrl).toBe("/");
    expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull();
  });
});

describe("on a computer", () => {
  beforeEach(() => setPhone(false));

  it("the + still opens the full Add form", async () => {
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    expect(screen.getByRole("dialog", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add item" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "What's on your mind?" })).toBeNull();
  });

  it("/add opens the quick box there too", async () => {
    renderApp("/add", TODAY);
    expect(await screen.findByRole("textbox", { name: "What's on your mind?" })).toBeInTheDocument();
  });
});
