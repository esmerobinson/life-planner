import { render } from "@testing-library/react";
import { addUpdateHold, currentUpdateHold, pageHold, useUpdateHold } from "./updateHolds";

function Holder({ active, reason }: { active: boolean; reason: string }) {
  useUpdateHold(active, reason);
  return null;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("what an automatic update must not interrupt", () => {
  it("nothing: no hold", () => {
    expect(currentUpdateHold()).toBeNull();
  });

  it("a registered hold, until it is released", () => {
    const release = addUpdateHold(() => "syncing");
    expect(currentUpdateHold()).toBe("syncing");
    release();
    expect(currentUpdateHold()).toBeNull();
  });

  it("a hold that says nothing right now does not hold", () => {
    let busy = false;
    const release = addUpdateHold(() => (busy ? "syncing" : null));
    expect(currentUpdateHold()).toBeNull();
    busy = true;
    expect(currentUpdateHold()).toBe("syncing");
    release();
  });

  it("a hold that throws holds (never reload on a guess)", () => {
    const release = addUpdateHold(() => {
      throw new Error("x");
    });
    expect(currentUpdateHold()).toBe("unknown");
    release();
  });

  it("a component holds while it is mounted and active (the journal)", () => {
    const { rerender, unmount } = render(<Holder active reason="journal" />);
    expect(currentUpdateHold()).toBe("journal");
    rerender(<Holder active={false} reason="journal" />);
    expect(currentUpdateHold()).toBeNull();
    rerender(<Holder active reason="journal" />);
    unmount();
    expect(currentUpdateHold()).toBeNull();
  });
});

describe("the page itself", () => {
  it("an open sheet with text in it holds", () => {
    document.body.innerHTML = `<div role="dialog"><input value="half a thought"></div>`;
    expect(pageHold(document)).toBe("sheet");
    expect(currentUpdateHold()).toBe("sheet");
  });

  it("an open sheet with a textarea or typed-in editable holds", () => {
    document.body.innerHTML = `<div role="dialog"><textarea></textarea></div>`;
    document.querySelector("textarea")!.value = "dear diary";
    expect(pageHold(document)).toBe("sheet");
    document.body.innerHTML = `<div role="dialog"><div contenteditable="true">words</div></div>`;
    expect(pageHold(document)).toBe("sheet");
  });

  it("an open sheet with nothing typed does not hold (it comes back after the reload)", () => {
    document.body.innerHTML = `<div role="dialog"><input value=""><input type="checkbox" checked><button>Add</button></div>`;
    expect(pageHold(document)).toBeNull();
  });

  it("only spaces is nothing typed", () => {
    document.body.innerHTML = `<div role="dialog"><input value="   "></div>`;
    expect(pageHold(document)).toBeNull();
  });

  it("text outside a sheet does not hold by itself (pages are saved and come back)", () => {
    document.body.innerHTML = `<main><input value="a saved title"></main>`;
    expect(pageHold(document)).toBeNull();
  });

  it("a field with text in it that has the focus holds, sheet or not", () => {
    document.body.innerHTML = `<main><textarea>notes</textarea></main>`;
    document.querySelector("textarea")!.focus();
    expect(pageHold(document)).toBe("editing");
  });

  it("an empty field with the focus does not hold", () => {
    document.body.innerHTML = `<main><input value=""></main>`;
    document.querySelector("input")!.focus();
    expect(pageHold(document)).toBeNull();
  });
});
