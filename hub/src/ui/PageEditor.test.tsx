import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import { db } from "../data/db";
import { pictureLine } from "../domain/page";
import { PAGE_WORDS, PageEditor } from "./PageEditor";

const shrink = vi.hoisted(() => ({ fail: false }));
vi.mock("./picture", async (importOriginal) => {
  const real = await importOriginal<typeof import("./picture")>();
  return {
    ...real,
    downscalePicture: async () => {
      if (shrink.fail) throw new Error("no");
      return { mime: "image/jpeg" as const, data: "/9j/4AAQ", width: 1600, height: 1200 };
    },
  };
});

const TODAY = "2026-10-28";

/** The editor with its text held the way the panels hold it (useDraft's value). */
function Harness({ initial, onChange, max }: { initial: string; onChange: (t: string) => void; max?: number }) {
  const [text, setText] = useState(initial);
  return (
    <>
      <PageEditor
        value={text}
        onChange={(t) => {
          setText(t);
          onChange(t);
        }}
        onBlur={() => {}}
        today={TODAY}
        maxLength={max}
      />
      <button type="button" onClick={() => setText("Replaced from elsewhere")}>
        outside
      </button>
    </>
  );
}

function setup(initial: string, max?: number) {
  const changes: string[] = [];
  render(<Harness initial={initial} onChange={(t) => changes.push(t)} max={max} />);
  const page = within(screen.getByRole("group", { name: "Notes" }));
  return { changes, page, last: () => changes[changes.length - 1] };
}

beforeEach(async () => {
  shrink.fail = false;
  await db.files.clear();
});

describe("the page shows its blocks", () => {
  it("headings, checklist ticks, bullets, links and plain lines", () => {
    const { page } = setup(
      "# Big\n## Small\n- [x] done step\n- [ ] open step\n- a bullet\nSee https://example.com/a and [the plan](https://example.com/p)\nobsidian://open?vault=V",
    );
    expect(page.getByRole("heading", { name: "Big" })).toBeInTheDocument();
    expect(page.getByRole("heading", { name: "Small" })).toBeInTheDocument();
    expect(page.getByRole("checkbox", { name: "Done: done step" })).toBeChecked();
    expect(page.getByRole("checkbox", { name: "Done: open step" })).not.toBeChecked();
    expect(page.getByText("a bullet")).toBeInTheDocument();
    expect(page.getByRole("link", { name: "https://example.com/a" })).toHaveAttribute("target", "_blank");
    expect(page.getByRole("link", { name: "the plan" })).toHaveAttribute("href", "https://example.com/p");
    const obsidian = page.getByRole("link", { name: "obsidian://open?vault=V" });
    expect(obsidian).not.toHaveAttribute("target"); // opens the Obsidian app, not a blank tab
  });

  it("an empty page shows the placeholder line", () => {
    const { page } = setup("");
    expect(page.getByText(PAGE_WORDS.placeholder)).toBeInTheDocument();
  });

  it("clicking around older notes never changes them (lossless)", async () => {
    const notes = "Check: not sure if this is still open\nDone when: It runs on my own machine\n\n  odd   spacing  ";
    const { changes, page } = setup(notes);
    await userEvent.click(page.getByText("Check: not sure if this is still open"));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    await userEvent.click(page.getByText(/Done when/));
    await userEvent.tab();
    expect(changes).toEqual([]);
  });
});

describe("editing", () => {
  it("ticks a checklist line in place", async () => {
    const { page, last } = setup("# Plan\n- [ ] one\n- [ ] two");
    await userEvent.click(page.getByRole("checkbox", { name: "Done: two" }));
    expect(last()).toBe("# Plan\n- [ ] one\n- [x] two");
    await userEvent.click(page.getByRole("checkbox", { name: "Done: two" }));
    expect(last()).toBe("# Plan\n- [ ] one\n- [ ] two");
  });

  it("typing a marker turns a line into that block; Enter continues a list; Enter on an empty item ends it", async () => {
    const { page, last } = setup("");
    await userEvent.click(page.getByText(PAGE_WORDS.placeholder));
    await userEvent.keyboard("# Title{Enter}- [[ ] first{Enter}second{Enter}{Enter}after");
    expect(last()).toBe("# Title\n- [ ] first\n- [ ] second\nafter");
    expect(page.getByRole("heading", { name: "Title" })).toBeInTheDocument();
  });

  it("Backspace at the start drops the marker, then joins the line to the one above", async () => {
    const { page, last } = setup("above\n- [ ] below");
    await userEvent.click(page.getByText("below"));
    await userEvent.keyboard("{Home}");
    const box = page.getByRole("textbox", { name: /checklist item 2/ }) as HTMLTextAreaElement;
    box.setSelectionRange(0, 0);
    await userEvent.keyboard("{Backspace}");
    expect(last()).toBe("above\nbelow");
    const plain = page.getByRole("textbox", { name: /text 2/ }) as HTMLTextAreaElement;
    plain.setSelectionRange(0, 0);
    await userEvent.keyboard("{Backspace}");
    expect(last()).toBe("abovebelow");
  });

  it("pasting several lines makes several lines", async () => {
    const { page, last } = setup("start");
    await userEvent.click(page.getByText("start"));
    await userEvent.paste("\n- [ ] pasted\n## head");
    expect(last()).toBe("start\n- [ ] pasted\n## head");
  });

  it("a stored change from elsewhere replaces the lines", async () => {
    const { page } = setup("old words");
    await userEvent.click(screen.getByRole("button", { name: "outside" }));
    expect(page.getByText("Replaced from elsewhere")).toBeInTheDocument();
  });

  it("refuses typing past the cap, with a quiet line saying so", async () => {
    const { page, changes } = setup("1234567890", 12);
    await userEvent.click(page.getByText("1234567890"));
    await userEvent.keyboard("ab");
    expect(changes[changes.length - 1]).toBe("1234567890ab");
    await userEvent.keyboard("c");
    expect(changes[changes.length - 1]).toBe("1234567890ab");
    expect(page.getByRole("status")).toHaveTextContent(/This page is full/);
  });
});

describe("add-buttons", () => {
  it("Heading and Checklist add a line after the one last typed in", async () => {
    const { page, last } = setup("first\nsecond");
    await userEvent.click(page.getByText("first"));
    await userEvent.click(page.getByRole("button", { name: "Checklist" }));
    await userEvent.keyboard("a step");
    expect(last()).toBe("first\n- [ ] a step\nsecond");
    await userEvent.click(page.getByRole("button", { name: "Heading" }));
    await userEvent.keyboard("Later");
    expect(last()).toBe("first\n- [ ] a step\n# Later\nsecond");
  });

  it("Link adds a web or Obsidian link on its own line; anything else is refused", async () => {
    const { page, last } = setup("");
    await userEvent.click(page.getByRole("button", { name: "Link" }));
    await userEvent.type(page.getByRole("textbox", { name: "Link" }), "not a link{Enter}");
    expect(page.getByRole("status")).toHaveTextContent(PAGE_WORDS.notALink);
    await userEvent.clear(page.getByRole("textbox", { name: "Link" }));
    await userEvent.type(page.getByRole("textbox", { name: "Link" }), "obsidian://open?vault=Pretend{Enter}");
    expect(last()).toBe("obsidian://open?vault=Pretend");
    expect(page.queryByRole("textbox", { name: "Link" })).toBeNull();
  });

  it("Picture stores the downscaled photo in files and puts its line on the page", async () => {
    const { page, last } = setup("Look:");
    await userEvent.click(page.getByText("Look:"));
    await userEvent.click(page.getByRole("button", { name: "Picture" }));
    const input = page.getByLabelText("Choose a picture") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "photo.jpg", { type: "image/jpeg" }));
    await vi.waitFor(() => expect(last()).toMatch(/^Look:\n!\[\]\(file:[0-9a-f-]{36}\)$/));
    const id = /file:([0-9a-f-]+)/.exec(last()!)![1]!;
    expect(await db.files.get(id)).toMatchObject({ mime: "image/jpeg", data: "/9j/4AAQ", width: 1600, height: 1200, createdAt: TODAY });
    const img = await page.findByRole("img", { name: "Picture" });
    expect(img).toHaveAttribute("src", "data:image/jpeg;base64,/9j/4AAQ");
  });

  it("a picture that cannot be read says so and changes nothing", async () => {
    shrink.fail = true;
    const { page, changes } = setup("x");
    await userEvent.upload(page.getByLabelText("Choose a picture") as HTMLInputElement, new File(["x"], "a.heic", { type: "image/heic" }));
    expect(await page.findByRole("status")).toHaveTextContent(/could not be added/);
    expect(changes).toEqual([]);
    expect(await db.files.count()).toBe(0);
  });
});

describe("pictures", () => {
  it("a picture whose file has not arrived shows a quiet placeholder, then the photo", async () => {
    const { page } = setup(`before\n${pictureLine("later-1")}`);
    expect(await page.findByRole("img", { name: PAGE_WORDS.pictureWaiting })).toBeInTheDocument();
    await act(async () => {
      await db.files.add({ id: "later-1", mime: "image/jpeg", data: "/9j/4AAQ", width: 40, height: 30, createdAt: TODAY });
    });
    expect(await page.findByRole("img", { name: "Picture" })).toHaveAttribute("width", "40");
  });

  it("Remove picture takes its line off the page", async () => {
    const { page, last } = setup(`a\n${pictureLine("p1")}\nb`);
    await userEvent.click(page.getByRole("button", { name: PAGE_WORDS.removePicture }));
    expect(last()).toBe("a\nb");
  });
});

describe("the / menu", () => {
  it("offers the four, filters as you type, and Enter turns the line into the choice", async () => {
    const { page, last } = setup("");
    await userEvent.click(page.getByText(PAGE_WORDS.placeholder));
    await userEvent.keyboard("/");
    const menu = within(page.getByLabelText(PAGE_WORDS.menu));
    expect(menu.getAllByRole("button").map((b) => b.textContent)).toEqual(["Heading", "Checklist", "Link", "Picture"]);
    await userEvent.keyboard("ch");
    expect(menu.getAllByRole("button").map((b) => b.textContent)).toEqual(["Checklist"]);
    await userEvent.keyboard("{Enter}buy paint");
    expect(last()).toBe("- [ ] buy paint");
    expect(page.queryByLabelText(PAGE_WORDS.menu)).toBeNull();
  });

  it("Escape closes the menu without closing the panel; a / inside a word is just a slash", async () => {
    const { page, last } = setup("");
    await userEvent.click(page.getByText(PAGE_WORDS.placeholder));
    await userEvent.keyboard("/");
    const box = page.getByRole("textbox", { name: /Notes: text 1/ });
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      box.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(page.queryByLabelText(PAGE_WORDS.menu)).toBeNull();
    await userEvent.keyboard("{Backspace}and/or");
    expect(last()).toBe("and/or");
    expect(page.queryByLabelText(PAGE_WORDS.menu)).toBeNull();
  });

  it("/link puts the link where the slash was", async () => {
    const { page, last } = setup("");
    await userEvent.click(page.getByText(PAGE_WORDS.placeholder));
    await userEvent.keyboard("Read /li{Enter}");
    fireEvent.change(page.getByRole("textbox", { name: "Link" }), { target: { value: "https://example.com/x" } });
    await userEvent.click(page.getByRole("button", { name: PAGE_WORDS.linkAdd }));
    expect(last()).toBe("Read https://example.com/x");
  });
});
