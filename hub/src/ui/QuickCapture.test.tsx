import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import * as repo from "../data/repo";
import { db } from "../data/db";
import { QUICK_DRAFT_KEY, QuickCapture, readQuickDraft } from "./QuickCapture";
import { SAVE_ERROR } from "./messages";

// One-tap quick add on the phone (Esme, 2026-11-17: "Adding a to do should be very easy on the
// phone app"; her yes to the proposal). Wording is provisional, for Esme / Design.

const TODAY = "2026-11-17";
const box = () => screen.getByRole("textbox", { name: "What's on your mind?" });
const open = async () => (await db.items.toArray()).filter((i) => i.status === "open");

beforeEach(async () => {
  await db.items.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the quick add box", () => {
  it("Return saves it as a to-do in the Inbox, clears the box, keeps it focused and says Added", async () => {
    const onAdded = vi.fn();
    render(<QuickCapture today={TODAY} onAdded={onAdded} onMore={() => {}} />);
    box().focus();
    await userEvent.type(box(), "Pretend call the plumber{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent("Added");
    const [it] = await open();
    expect(it).toMatchObject({ kind: "task", title: "Pretend call the plumber", areaId: "inbox", priority: 2 });
    expect(it.pinnedDate).toBeUndefined();
    expect(it.time).toBeUndefined();
    expect(box()).toHaveValue("");
    expect(box()).toHaveFocus();
    expect(onAdded).toHaveBeenCalledTimes(1);
    // The next one, straight away.
    await userEvent.type(box(), "Pretend second{Enter}");
    await vi.waitFor(async () => expect(await open()).toHaveLength(2));
  });

  it("the Add button does what Return does: saves with the chips, clears, keeps focus, says Added", async () => {
    const onAdded = vi.fn();
    render(<QuickCapture today={TODAY} onAdded={onAdded} onMore={() => {}} />);
    const add = screen.getByRole("button", { name: "Add to Inbox" });
    expect(add).toHaveTextContent("Add");
    // Esme, 2026-11-23: "the submit button needs to be there": never greyed out, and the
    // form's own submit button (so the browser's Return submits through it too).
    expect(add).toBeEnabled();
    expect(add).toHaveAttribute("type", "submit");
    await userEvent.type(box(), "Pretend tapped in");
    await userEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    box().focus();
    await userEvent.click(add);
    expect(await screen.findByRole("status")).toHaveTextContent("Added");
    expect((await open())[0]).toMatchObject({ title: "Pretend tapped in", areaId: "inbox", pinnedDate: "2026-11-18" });
    expect(box()).toHaveValue("");
    expect(box()).toHaveFocus(); // tapping Add never takes the focus: the phone's keyboard stays up
    expect(add).toBeEnabled();
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it("the Add button with an empty box: just puts the focus in the box, adds nothing", async () => {
    const onAdded = vi.fn();
    render(
      <>
        <button>Elsewhere</button>
        <QuickCapture today={TODAY} onAdded={onAdded} onMore={() => {}} />
      </>,
    );
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    await userEvent.type(box(), "   ");
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    await userEvent.click(screen.getByRole("button", { name: "Add to Inbox" }));
    expect(box()).toHaveFocus();
    expect(await open()).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(SAVE_ERROR)).toBeNull();
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("the keyboard's Return key is labelled as doing something (enterkeyhint done)", () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    expect(box()).toHaveAttribute("enterkeyhint", "done");
  });

  // Esme, 2026-11-23: "pressing enter on keyboard doesnt submit really". iOS's predictive text
  // and autocorrect can mark the Return as composing; only a real IME (Japanese, Chinese,
  // Korean) picking its characters holds Return back.
  it("Return marked as composing by a non-IME keyboard (iOS predictive text) still adds", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    fireEvent.change(box(), { target: { value: "Pretend predictive" } });
    fireEvent.keyDown(box(), { key: "Enter", code: "Enter", keyCode: 13, isComposing: true });
    expect(await screen.findByRole("status")).toHaveTextContent("Added");
    expect((await open())[0]).toMatchObject({ title: "Pretend predictive" });
  });

  it("Return as keyCode 229 while iOS holds a Latin word (inline prediction) still adds", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    fireEvent.compositionStart(box(), { data: "" });
    fireEvent.compositionUpdate(box(), { data: "plumber" });
    fireEvent.change(box(), { target: { value: "Pretend plumber" } });
    fireEvent.keyDown(box(), { key: "Enter", keyCode: 229, isComposing: true });
    expect(await screen.findByRole("status")).toHaveTextContent("Added");
    expect(await open()).toHaveLength(1);
  });

  it("Return that picks a Japanese IME's characters doesn't add (Chrome and Safari's order)", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    fireEvent.compositionStart(box(), { data: "" });
    fireEvent.compositionUpdate(box(), { data: "にほん" });
    fireEvent.change(box(), { target: { value: "にほん" } });
    // Chrome: the Return arrives while composing.
    fireEvent.keyDown(box(), { key: "Enter", keyCode: 229, isComposing: true });
    // Safari / the Mac's WebKit: the composition has already ended, but the keyCode is 229.
    fireEvent.compositionEnd(box(), { data: "日本" });
    fireEvent.change(box(), { target: { value: "日本" } });
    fireEvent.keyDown(box(), { key: "Enter", keyCode: 229, isComposing: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(await open()).toHaveLength(0);
    // The next Return, the composition over, adds it.
    fireEvent.keyDown(box(), { key: "Enter", keyCode: 13 });
    expect(await screen.findByRole("status")).toHaveTextContent("Added");
    expect((await open())[0]).toMatchObject({ title: "日本" });
  });

  it("Return in the Time field adds too (the form submits through its Add button)", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    await userEvent.type(box(), "Pretend timed");
    await userEvent.click(screen.getByRole("button", { name: "Time" }));
    const time = screen.getByLabelText("Time", { selector: "input" });
    fireEvent.change(time, { target: { value: "10:00" } });
    time.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent("Added");
    expect((await open())[0]).toMatchObject({ title: "Pretend timed", time: "10:00", pinnedDate: TODAY });
  });

  it("one Return adds it once", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    await userEvent.type(box(), "Pretend once{Enter}");
    await screen.findByRole("status");
    await new Promise((r) => setTimeout(r, 20));
    expect(await open()).toHaveLength(1);
  });

  it("pressing on the Add button doesn't move the focus out of the box", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    await userEvent.type(box(), "Pretend");
    const add = screen.getByRole("button", { name: "Add to Inbox" });
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    add.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("an empty box: Return does nothing", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    await userEvent.type(box(), "   {Enter}");
    expect(await open()).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("the Added line goes once she types the next one", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    await userEvent.type(box(), "Pretend one{Enter}");
    await screen.findByRole("status");
    await userEvent.type(box(), "P");
    expect(screen.queryByText("Added")).toBeNull();
  });

  it("Today pins it to today, Tomorrow to tomorrow; one or the other; chips start fresh after", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    const todayChip = screen.getByRole("button", { name: "Today" });
    const tomorrow = screen.getByRole("button", { name: "Tomorrow" });
    expect(todayChip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(todayChip);
    expect(todayChip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(tomorrow);
    expect(todayChip).toHaveAttribute("aria-pressed", "false");
    expect(tomorrow).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(box(), "Pretend tomorrow thing{Enter}");
    await screen.findByRole("status");
    expect((await open())[0].pinnedDate).toBe("2026-11-18");
    expect(tomorrow).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(todayChip);
    await userEvent.type(box(), "Pretend today thing{Enter}");
    await vi.waitFor(async () => expect((await open()).find((i) => i.title === "Pretend today thing")?.pinnedDate).toBe(TODAY));
    // Tapping a chosen chip again un-chooses it.
    await userEvent.click(todayChip);
    await userEvent.click(todayChip);
    expect(todayChip).toHaveAttribute("aria-pressed", "false");
  });

  it("Time shows a time field; a time with no day chosen pins it to today; saved in the to-do's time", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    expect(screen.queryByLabelText("Time")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Time" }));
    expect(screen.getByRole("button", { name: "Time" })).toHaveAttribute("aria-pressed", "true");
    const time = screen.getByLabelText("Time", { selector: "input" });
    fireEvent.change(time, { target: { value: "15:30" } });
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(box(), "Pretend dentist{Enter}");
    await screen.findByRole("status");
    expect((await open())[0]).toMatchObject({ pinnedDate: TODAY, time: "15:30" });
    // Time off again after saving.
    expect(screen.queryByLabelText("Time", { selector: "input" })).toBeNull();
  });

  it("Time with Tomorrow: tomorrow at that time; tapping Time again drops the time", async () => {
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    await userEvent.click(screen.getByRole("button", { name: "Time" }));
    fireEvent.change(screen.getByLabelText("Time", { selector: "input" }), { target: { value: "09:00" } });
    expect(screen.getByRole("button", { name: "Tomorrow" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Time" }));
    expect(screen.queryByLabelText("Time", { selector: "input" })).toBeNull();
    await userEvent.type(box(), "Pretend no time{Enter}");
    await screen.findByRole("status");
    const [it] = await open();
    expect(it.pinnedDate).toBe("2026-11-18");
    expect(it.time).toBeUndefined();
  });

  it("More options hands over what was typed", async () => {
    const onMore = vi.fn();
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={onMore} />);
    await userEvent.type(box(), "Pretend big plan");
    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(onMore).toHaveBeenCalledWith(expect.objectContaining({ text: "Pretend big plan" }));
  });

  it("a half-typed entry and its chips are kept on this device and come back (closed, reloaded)", async () => {
    const { unmount } = render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    await userEvent.type(box(), "Pretend half");
    await userEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    await userEvent.click(screen.getByRole("button", { name: "Time" }));
    fireEvent.change(screen.getByLabelText("Time", { selector: "input" }), { target: { value: "08:15" } });
    // Kept as she types (no wait for a blur or a hide: a reload or a killed app loses nothing).
    expect(JSON.parse(localStorage.getItem(QUICK_DRAFT_KEY)!)).toEqual({ text: "Pretend half", day: "tomorrow", time: "08:15", timeOn: true });
    unmount();
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    expect(box()).toHaveValue("Pretend half");
    expect(screen.getByRole("button", { name: "Tomorrow" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Time", { selector: "input" })).toHaveValue("08:15");
    await userEvent.type(box(), "{Enter}");
    await screen.findByRole("status");
    expect(localStorage.getItem(QUICK_DRAFT_KEY)).toBeNull();
    expect(readQuickDraft()).toEqual({ text: "", day: null, time: "", timeOn: false });
  });

  it("a broken or blocked draft store still works (starts empty)", async () => {
    localStorage.setItem(QUICK_DRAFT_KEY, "{not json");
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    expect(box()).toHaveValue("");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await userEvent.type(box(), "Pretend private window{Enter}");
    await screen.findByRole("status");
    expect(await open()).toHaveLength(1);
  });

  it("a save that fails keeps the text and says so", async () => {
    vi.spyOn(repo, "createItem").mockRejectedValueOnce(new Error("write failed"));
    render(<QuickCapture today={TODAY} onAdded={() => {}} onMore={() => {}} />);
    await userEvent.type(box(), "Pretend keep me{Enter}");
    expect(await screen.findByText(SAVE_ERROR)).toBeInTheDocument();
    expect(box()).toHaveValue("Pretend keep me");
    expect(screen.queryByText("Added")).toBeNull();
  });
});
