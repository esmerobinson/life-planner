import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createBook, createItem, updateBook } from "../data/repo";
import { currentUrl, renderApp } from "../test/renderApp";

// The reading list: books are ideas under Mind (Esme, 2026-11-04). Fictional data only.
const TODAY = "2026-11-04";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.useRealTimers());

async function pretendBooks() {
  const reading = await createBook({ title: "Pretend Lantern Year", author: "Pretend Author A", bookStatus: "reading" }, "2026-10-01");
  await updateBook(reading.id, { pages: 300, pageAt: 120 }, "2026-10-02");
  const want = await createBook({ title: "Pretend Quiet Hours", author: "Pretend Author B", bookStatus: "want" }, "2026-10-01");
  const read = await createBook({ title: "Pretend Field Guide", bookStatus: "read" }, "2026-10-18");
  await createItem({ kind: "idea", title: "Pretend weekend without a phone", areaId: "mind", priority: 2 }, "2026-10-01");
  return { reading, want, read };
}

const readingList = () => screen.findByRole("region", { name: /Reading list/ });

describe("Mind page: books group under Reading list inside Ideas", () => {
  it("a heading with the pixel book icon and the count; each book a strip with its author and status pill", async () => {
    await pretendBooks();
    renderApp("/area/mind", TODAY);
    const list = await readingList();
    const heading = within(list).getByRole("heading", { name: "Reading list (3)" });
    const icon = heading.querySelector("img.pixel-icon") as HTMLImageElement;
    expect(icon).not.toBeNull();
    expect(icon.getAttribute("width")).toBe("16");
    // Reading first, then Want to read, then Read.
    const strips = within(list).getAllByRole("listitem");
    expect(strips.map((s) => within(s).getAllByRole("button")[0].textContent)).toEqual([
      "Pretend Lantern Year", "Pretend Quiet Hours", "Pretend Field Guide",
    ]);
    expect(within(strips[0]).getByText(/Pretend Author A/)).toBeInTheDocument();
    expect(within(strips[0]).getByText("page 120 of 300", { exact: false })).toBeInTheDocument();
    expect(within(strips[0]).getByRole("progressbar")).toBeInTheDocument();
    expect(within(strips[0]).getByText("Reading", { selector: ".book-pill" })).toBeInTheDocument();
    expect(within(strips[1]).getByText("Want to read", { selector: ".book-pill" })).toBeInTheDocument();
    expect(within(strips[2]).getByText("Read", { selector: ".book-pill" })).toBeInTheDocument();
    // The plain idea stays in Ideas, not on the reading list.
    expect(within(screen.getByRole("list", { name: "Ideas" })).getByText("Pretend weekend without a phone")).toBeInTheDocument();
    expect(within(list).queryByText("Pretend weekend without a phone")).toBeNull();
  });

  it("the Show pills gain Books on Mind: only the reading list shows", async () => {
    await pretendBooks();
    await createItem({ kind: "task", title: "Pretend call about a group", areaId: "mind", priority: 2 }, "2026-10-01");
    renderApp("/area/mind", TODAY);
    await readingList();
    await userEvent.click(screen.getByRole("button", { name: "Books" }));
    expect(screen.queryByText("Pretend call about a group")).toBeNull();
    expect(screen.queryByText("Pretend weekend without a phone")).toBeNull();
    expect(within(await readingList()).getByText("Pretend Quiet Hours")).toBeInTheDocument();
  });

  it("other areas have no Books pill", async () => {
    renderApp("/area/art", TODAY);
    await screen.findByRole("button", { name: "Ideas" });
    expect(screen.queryByRole("button", { name: "Books" })).toBeNull();
  });
});

describe("Change to → Book", () => {
  it("an idea in Art moves to Mind's reading list, with Undo (the area changed)", async () => {
    const idea = await createItem({ kind: "idea", title: "Pretend Gentle Year by R. Kim", areaId: "art", priority: 2 }, "2026-10-01");
    renderApp("/area/art", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Move to: Pretend Gentle Year by R. Kim" }));
    const change = screen.getByRole("group", { name: "Change to" });
    await userEvent.click(within(change).getByRole("button", { name: "Book" }));
    await vi.waitFor(async () => expect((await db.items.get(idea.id))!).toMatchObject({ kind: "idea", areaId: "mind", bookStatus: "want" }));
    const undo = await screen.findByRole("button", { name: "Undo" });
    expect(screen.getByText(/^Moved to Mind's reading list/)).toBeInTheDocument();
    await userEvent.click(undo);
    await vi.waitFor(async () => {
      const back = (await db.items.get(idea.id))!;
      expect(back.areaId).toBe("art");
      expect(back.bookStatus).toBeUndefined();
    });
  });

  it("a to-do already in Mind becomes a book with no Undo line (nothing moved)", async () => {
    const t = await createItem({ kind: "task", title: "Pretend borrow a novel", areaId: "mind", priority: 2, due: "2026-11-10" }, "2026-10-01");
    renderApp("/area/mind", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Move to: Pretend borrow a novel" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Change to" })).getByRole("button", { name: "Book" }));
    await vi.waitFor(async () => expect((await db.items.get(t.id))!).toMatchObject({ kind: "idea", bookStatus: "want" }));
    expect((await db.items.get(t.id))!.due).toBeUndefined();
    expect(within(await readingList()).getByText("Pretend borrow a novel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("a book's menu has no areas (books live under Mind); Change to → Idea makes it a plain idea, with Undo", async () => {
    const { want } = await pretendBooks();
    renderApp("/area/mind", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Move to: Pretend Quiet Hours" }));
    const change = screen.getByRole("group", { name: "Change to" });
    expect(within(change).queryByRole("button", { name: "Book" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Writing" })).toBeNull();
    await userEvent.click(within(change).getByRole("button", { name: "Idea" }));
    await vi.waitFor(async () => expect((await db.items.get(want.id))!.bookStatus).toBeUndefined());
    expect((await db.items.get(want.id))!.author).toBeUndefined();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await vi.waitFor(async () => expect((await db.items.get(want.id))!).toMatchObject({ bookStatus: "want", author: "Pretend Author B" }));
  });
});

describe("Adding a book", () => {
  it("the Add form's Book type shows Author and Status and makes a book under Mind", async () => {
    renderApp("/area/art", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    const form = within(screen.getByRole("dialog", { name: "Add" }));
    await userEvent.selectOptions(form.getByLabelText("Type"), "book");
    expect(form.getByLabelText("Area")).toBeDisabled();
    expect(form.getByLabelText("Area")).toHaveValue("mind");
    expect(form.queryByLabelText("Goal")).toBeNull();
    await userEvent.type(form.getByLabelText("Title"), "Pretend Salt and Weather");
    await userEvent.type(form.getByLabelText("Author"), "Pretend Author C");
    await userEvent.selectOptions(form.getByLabelText("Status"), "reading");
    await userEvent.click(form.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => {
      const [b] = await db.items.toArray();
      expect(b).toMatchObject({ kind: "idea", areaId: "mind", title: "Pretend Salt and Weather", author: "Pretend Author C", bookStatus: "reading" });
    });
  });

  it("+ Add a book opens the Add form set to Book", async () => {
    await pretendBooks();
    renderApp("/area/mind", TODAY);
    await userEvent.click(within(await readingList()).getByRole("button", { name: "+ Add a book" }));
    const form = within(screen.getByRole("dialog", { name: "Add" }));
    expect(form.getByLabelText("Type")).toHaveValue("book");
    expect(form.getByLabelText("Status")).toHaveValue("want");
  });
});

describe("A book's side panel", () => {
  it("status pills switch the status; Read sets the finished date; Edit changes author, pages and link", async () => {
    const { reading } = await pretendBooks();
    renderApp(`/area/mind?open=${reading.id}`, TODAY);
    const panel = within(await screen.findByRole("complementary", { name: "Pretend Lantern Year" }));
    expect(panel.getByText("Book", { selector: ".peek-kicker" })).toBeInTheDocument();
    const status = panel.getByRole("group", { name: "Status" });
    expect(within(status).getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
    expect(panel.getByText("Pretend Author A")).toBeInTheDocument();
    expect(panel.getByText("page 120 of 300")).toBeInTheDocument();

    await userEvent.click(within(status).getByRole("button", { name: "Read" }));
    await vi.waitFor(async () => expect((await db.items.get(reading.id))!).toMatchObject({ bookStatus: "read", finishedOn: TODAY }));
    expect(await panel.findByText("Finished")).toBeInTheDocument();

    await userEvent.click(panel.getByRole("button", { name: "Edit" }));
    const author = panel.getByLabelText("Author");
    await userEvent.clear(author);
    await userEvent.type(author, "Pretend Author Z");
    await userEvent.clear(panel.getByLabelText("Pages"));
    await userEvent.type(panel.getByLabelText("Pages"), "320");
    await userEvent.type(panel.getByLabelText("Link"), "https://library.example.test/lantern");
    await userEvent.click(panel.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () =>
      expect((await db.items.get(reading.id))!).toMatchObject({ author: "Pretend Author Z", pages: 320, link: "https://library.example.test/lantern" }),
    );
    const link = await panel.findByRole("link", { name: /library\.example\.test/ });
    expect(link).toHaveAttribute("href", "https://library.example.test/lantern");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("a link that isn't a web address says so and stays in Edit (nothing saved)", async () => {
    const { want } = await pretendBooks();
    renderApp(`/area/mind?open=${want.id}`, TODAY);
    const panel = within(await screen.findByRole("complementary", { name: "Pretend Quiet Hours" }));
    await userEvent.click(panel.getByRole("button", { name: "Edit" }));
    await userEvent.type(panel.getByLabelText("Link"), "not a link");
    await userEvent.click(panel.getByRole("button", { name: "Done" }));
    expect(await panel.findByText("A link starts with https:// (or http://).")).toBeInTheDocument();
    expect(panel.getByLabelText("Link")).toBeInTheDocument();
    expect((await db.items.get(want.id))!.link).toBeUndefined();
  });

  it("Edit → Type → Book on an idea in Art moves it to Mind, with Undo", async () => {
    const idea = await createItem({ kind: "idea", title: "Pretend comic to read", areaId: "art", priority: 2 }, "2026-10-01");
    renderApp(`/area/art?open=${idea.id}`, TODAY);
    const panel = within(await screen.findByRole("complementary", { name: "Pretend comic to read" }));
    await userEvent.click(panel.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(panel.getByLabelText("Type"), "book");
    expect(panel.getByLabelText("Area")).toBeDisabled();
    await userEvent.click(panel.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await db.items.get(idea.id))!).toMatchObject({ areaId: "mind", bookStatus: "want" }));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(currentUrl).toContain(`open=${idea.id}`);
  });
});
