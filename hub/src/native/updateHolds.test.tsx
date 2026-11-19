import { render } from "@testing-library/react";
import {
  addUpdateHold, clearPageEdits, currentUpdateHold, installEditTracker, pageEdited, useUpdateHold, userActivity,
} from "./updateHolds";

function Holder({ active, reason }: { active: boolean; reason: string }) {
  useUpdateHold(active, reason);
  return null;
}

let stop: (() => void) | null = null;
beforeEach(() => {
  stop = installEditTracker(document);
  clearPageEdits();
});
afterEach(() => {
  stop?.();
  document.body.innerHTML = "";
  clearPageEdits();
});

/** A field on the page, as the app draws one. */
function field(html: string): HTMLElement {
  document.body.innerHTML = `<main>${html}</main>`;
  return document.querySelector("main")!.firstElementChild as HTMLElement;
}

describe("the rule: no automatic update once anything has been edited on this page", () => {
  it("a page nobody has touched: no hold", () => {
    field(`<input value="a saved title">`);
    expect(currentUpdateHold()).toBeNull();
  });

  it("typing in any field holds, even after it loses the focus (the Inbox box, a to-do's Edit fields)", () => {
    const input = field(`<input>`) as HTMLInputElement;
    input.focus();
    input.value = "Pretend half typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
    expect(pageEdited()).toBe(true);
    expect(currentUpdateHold()).toBe("edited");
  });

  it("a key pressed in a field holds (before any input event)", () => {
    const t = field(`<textarea></textarea>`);
    t.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(currentUpdateHold()).toBe("edited");
  });

  it("a select change holds (a to-do's priority, a goal's area)", () => {
    const s = field(`<select><option>1</option><option>2</option></select>`);
    s.dispatchEvent(new Event("change", { bubbles: true }));
    expect(currentUpdateHold()).toBe("edited");
  });

  it("a date or time picked on the wheel holds", () => {
    const d = field(`<input type="date">`);
    d.dispatchEvent(new Event("change", { bubbles: true }));
    expect(currentUpdateHold()).toBe("edited");
  });

  it("a paste holds", () => {
    const t = field(`<textarea></textarea>`);
    t.dispatchEvent(new Event("paste", { bubbles: true }));
    expect(currentUpdateHold()).toBe("edited");
  });

  it("typing in an editable area holds", () => {
    const e = field(`<div contenteditable="true"></div>`);
    e.dispatchEvent(new Event("input", { bubbles: true }));
    expect(currentUpdateHold()).toBe("edited");
  });

  it("only a route change forgets it (that already drops unsaved form state)", () => {
    const input = field(`<input>`);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(currentUpdateHold()).toBe("edited");
    clearPageEdits();
    expect(currentUpdateHold()).toBeNull();
  });

  it("Tab or Escape in a field is not an edit", () => {
    const input = field(`<input>`);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(currentUpdateHold()).toBeNull();
  });

  it("a click or a key outside any field is not an edit", () => {
    field(`<button>Today</button>`);
    document.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    expect(currentUpdateHold()).toBeNull();
  });

  it("controls marked data-reload-safe (saved the moment they change: a tick box, the quick box) are not edits", () => {
    document.body.innerHTML = `<main><input type="checkbox" data-reload-safe><form data-reload-safe><input id="q"></form></main>`;
    document.querySelector("input[type=checkbox]")!.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#q")!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(currentUpdateHold()).toBeNull();
  });

  it("an unmarked tick box still counts (unknown controls are kept, never guessed safe)", () => {
    const c = field(`<input type="checkbox">`);
    c.dispatchEvent(new Event("change", { bubbles: true }));
    expect(currentUpdateHold()).toBe("edited");
  });
});

describe("also held, edited or not", () => {
  it("any open sheet or dialog, even empty (it would close on a reload)", () => {
    document.body.innerHTML = `<div role="dialog"><input value=""></div>`;
    expect(currentUpdateHold()).toBe("sheet");
    document.body.innerHTML = `<div aria-modal="true"></div>`;
    expect(currentUpdateHold()).toBe("sheet");
  });

  it("a registered hold, until it is released (a sync, pairing, the camera)", () => {
    const release = addUpdateHold(() => "syncing");
    expect(currentUpdateHold()).toBe("syncing");
    release();
    expect(currentUpdateHold()).toBeNull();
  });

  it("a hold that throws holds (never reload on a guess)", () => {
    const release = addUpdateHold(() => {
      throw new Error("x");
    });
    expect(currentUpdateHold()).toBe("unknown");
    release();
  });

  it("a component holds while mounted and active (a panel in Edit mode)", () => {
    const { rerender, unmount } = render(<Holder active reason="editing" />);
    expect(currentUpdateHold()).toBe("editing");
    rerender(<Holder active={false} reason="editing" />);
    expect(currentUpdateHold()).toBeNull();
    rerender(<Holder active reason="editing" />);
    unmount();
    expect(currentUpdateHold()).toBeNull();
  });
});

describe("activity (the last check right before the reload)", () => {
  it("counts every key, tap and input anywhere", () => {
    const before = userActivity();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(userActivity()).toBe(before + 2);
  });
});
