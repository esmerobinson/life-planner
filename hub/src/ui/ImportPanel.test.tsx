import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { ImportPanel } from "./ImportPanel";
import fixture from "../import/__fixtures__/googleTasks.json";

const TODAY = "2026-10-28";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

function paste(label: string, text: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
}

describe("ImportPanel Google Tasks section", () => {
  it("has its own heading, file input and paste box", () => {
    render(<ImportPanel today={TODAY} />);
    expect(screen.getByRole("heading", { name: "Google Tasks (JSON file)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Google Tasks file")).toHaveAttribute("type", "file");
    expect(screen.getByLabelText("Google Tasks text").tagName).toBe("TEXTAREA");
  });

  it("shows the counts line and the notes list", async () => {
    const onImported = vi.fn();
    render(<ImportPanel today={TODAY} onImported={onImported} />);
    paste("Google Tasks text", JSON.stringify(fixture));
    await userEvent.click(screen.getByRole("button", { name: "Import Google Tasks" }));
    expect(
      await screen.findByText("Added 8, already had 0, same title as an existing task 1, notes 2"),
    ).toBeInTheDocument();
    expect(onImported).toHaveBeenCalled();
    await userEvent.click(screen.getByText("Notes (2)"));
    const list = screen.getByRole("list", { name: "Import notes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows notes as text, never HTML", async () => {
    render(<ImportPanel today={TODAY} />);
    const bad = { lists: [{ id: "l", title: "L", tasks: [{ id: "a", title: "<b>x</b>", status: "needsAction", due: "<i>no</i>" }] }] };
    paste("Google Tasks text", JSON.stringify(bad));
    await userEvent.click(screen.getByRole("button", { name: "Import Google Tasks" }));
    await userEvent.click(await screen.findByText("Notes (1)"));
    expect(document.querySelector("b, i")).toBeNull();
    expect(screen.getByRole("list", { name: "Import notes" }).textContent).toContain("<b>x</b>");
  });

  it("says so when the text is empty or is not JSON, and writes nothing", async () => {
    render(<ImportPanel today={TODAY} />);
    const btn = screen.getByRole("button", { name: "Import Google Tasks" });
    await userEvent.click(btn);
    expect(screen.getByText("Paste some text or choose a file first.")).toBeInTheDocument();
    paste("Google Tasks text", "not json {");
    await userEvent.click(btn);
    expect(await screen.findByText("That is not a Google Tasks export.")).toBeInTheDocument();
    expect(await db.items.count()).toBe(0);
  });

  it("double-clicking imports once and disables the button while running", async () => {
    render(<ImportPanel today={TODAY} />);
    paste("Google Tasks text", JSON.stringify(fixture));
    const btn = screen.getByRole("button", { name: "Import Google Tasks" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(await screen.findByText(/^Added 8, already had 0/)).toBeInTheDocument();
    await vi.waitFor(() => expect(btn).not.toBeDisabled());
    expect(await db.items.count()).toBe(8);
  });

  it("the Backlog Import button is unchanged", () => {
    render(<ImportPanel today={TODAY} />);
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
  });
});
