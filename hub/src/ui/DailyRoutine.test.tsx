import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { db } from "../data/db";
import { tickItem } from "../data/repo";
import { stepRowId, tickRowId } from "../domain/dailyRoutine";
import type { Item } from "../domain/types";
import { DailyRoutine, ROUTINE_HOME_WORDS as W } from "./DailyRoutine";
import { HomePage } from "./HomePage";
import { AUTOSAVE_MS } from "./useDraft";

// "Today's routine" on Home, under the goals (Esme approved, 17 Nov 2026). All data is fictional.

const TODAY = "2026-11-17";
const habit = (id: string, title: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title, links: [], areaId: "mind", priority: 2, status: "open",
  createdAt: "2026-11-01", touchedAt: "2026-11-01", recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], ...extra,
});

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear(), db.prefs.clear()]);
});

function renderRoutine(today = TODAY) {
  return render(
    <MemoryRouter>
      <DailyRoutine today={today} />
    </MemoryRouter>,
  );
}

const region = () => screen.getByRole("region", { name: W.heading });

describe("Today's routine", () => {
  it("shows the count and only the next step in full (highlighted, with its minimum); the rest folded as titles", async () => {
    renderRoutine();
    expect(await screen.findByText("0 of 10 today")).toBeInTheDocument();
    const list = within(region()).getByRole("list", { name: W.listLabel });
    const shown = within(list).getAllByRole("listitem");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveAttribute("aria-current", "step");
    expect(shown[0]).toHaveTextContent("Up between 8 and 9am");
    expect(shown[0]).toHaveTextContent(W.minimum("out of bed in that window, even after a bad night"));
    expect(within(region()).getByText(W.more(9))).toBeInTheDocument();
    // A folded step is its title only (no minimum line).
    const meditation = screen.getByRole("checkbox", { name: "Mark done: 5-minute meditation" }).closest("li")!;
    expect(meditation).not.toHaveAttribute("aria-current");
    expect(meditation).toHaveTextContent(/^5-minute meditation$/);
    // Nothing red, nothing "missed".
    expect(region()).not.toHaveTextContent(/missed|late|overdue/i);
  });

  it("ticking a step saves its tick, moves the highlight on, and folds it into Done today", async () => {
    const user = userEvent.setup();
    renderRoutine();
    await user.click(await screen.findByRole("checkbox", { name: "Mark done: Up between 8 and 9am" }));
    expect(await screen.findByText("1 of 10 today")).toBeInTheDocument();
    expect(await db.prefs.get(tickRowId(TODAY, "d1"))).toMatchObject({ done: true });
    const list = within(region()).getByRole("list", { name: W.listLabel });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("5-minute meditation");
    expect(within(list).getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "step");
    expect(within(region()).getByText(W.doneFold(1))).toBeInTheDocument();
    // Unticking from the fold brings it back.
    await user.click(screen.getByRole("checkbox", { name: "Done: Up between 8 and 9am" }));
    expect(await screen.findByText("0 of 10 today")).toBeInTheDocument();
  });

  it("links obvious steps to her habits on first view and says so; ticking the step ticks the habit", async () => {
    await db.items.bulkPut([habit("h-vit", "Vitamins"), habit("h-plan", "Plan my day")]);
    const user = userEvent.setup();
    renderRoutine();
    await waitFor(async () => expect((await db.prefs.get(stepRowId("d4")))?.id).toBeTruthy());
    expect(await db.items.count()).toBe(2); // no habit made
    await user.click(await screen.findByText(W.more(9)));
    await user.click(screen.getByRole("checkbox", { name: "Mark done: Vitamins with morning tea" }));
    await waitFor(async () => expect((await db.items.get("h-vit"))!.doneDates).toEqual([TODAY]));
    expect(await db.prefs.get(tickRowId(TODAY, "d4"))).toBeUndefined();
  });

  it("ticking the habit elsewhere shows the linked step ticked", async () => {
    await db.items.put(habit("h-vit", "Vitamins"));
    await db.prefs.put({ id: stepRowId("d4"), habitId: "h-vit" });
    await tickItem("h-vit", TODAY);
    renderRoutine();
    expect(await screen.findByText("1 of 10 today")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Done: Vitamins with morning tea" })).toBeChecked();
  });

  it("the next day starts fresh", async () => {
    await db.prefs.put({ id: tickRowId(TODAY, "d1"), date: TODAY, step: "d1", done: true });
    renderRoutine("2026-11-18");
    expect(await screen.findByText("0 of 10 today")).toBeInTheDocument();
  });

  it("Edit routine: rename, edit the minimum, unlink, move, remove and add, saved as she goes", async () => {
    await db.items.put(habit("h-vit", "Vitamins"));
    const user = userEvent.setup();
    renderRoutine();
    await screen.findByText("0 of 10 today");
    await user.click(screen.getByRole("button", { name: W.edit }));
    const sheet = await screen.findByRole("dialog", { name: W.editHeading });
    const steps = () => within(sheet).getAllByRole("listitem");
    expect(steps()).toHaveLength(10);

    const second = steps()[1]!;
    const title = within(second).getByRole("textbox", { name: W.stepLabel });
    await user.clear(title);
    await user.type(title, "Sit quietly (pretend){Enter}");
    const min = within(second).getByRole("textbox", { name: W.minLabel });
    await user.clear(min);
    await user.type(min, "one breath");
    await user.tab();
    await waitFor(async () => expect(await db.prefs.get(stepRowId("d2"))).toMatchObject({ title: "Sit quietly (pretend)", min: "one breath" }));

    const vit = steps()[3]!;
    await waitFor(() => expect(within(vit).getByRole("combobox", { name: W.linkLabel })).toHaveValue("h-vit"));
    await user.selectOptions(within(vit).getByRole("combobox", { name: W.linkLabel }), W.notLinked);
    await waitFor(async () => expect(await db.prefs.get(stepRowId("d4"))).toMatchObject({ habitId: null }));

    await user.click(within(steps()[2]!).getByRole("button", { name: W.up("Daylight: outside or by the brightest window") }));
    await waitFor(() => expect(steps()[1]).toHaveTextContent(/./));
    await waitFor(() => expect((within(steps()[1]!).getByRole("textbox", { name: W.stepLabel }) as HTMLInputElement).value).toBe("Daylight: outside or by the brightest window"));

    await user.click(within(steps()[9]!).getByRole("button", { name: W.remove("Bed") }));
    await waitFor(() => expect(steps()).toHaveLength(9));

    await user.type(within(sheet).getByRole("textbox", { name: W.newStep }), "Stretch (pretend){Enter}");
    await waitFor(() => expect(steps()).toHaveLength(10));
    expect((within(steps()[9]!).getByRole("textbox", { name: W.stepLabel }) as HTMLInputElement).value).toBe("Stretch (pretend)");

    await user.click(within(sheet).getByRole("button", { name: W.close }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("0 of 10 today")).toBeInTheDocument();
  });
});

describe("Edit routine saves however it closes (review I2)", () => {
  for (const close of ["Escape", "the dimmed page", "Done"] as const) {
    it(`a title and a minimum typed, then closed with ${close}: both saved`, async () => {
      const user = userEvent.setup();
      renderRoutine();
      await user.click(await screen.findByRole("button", { name: W.edit }));
      const sheet = await screen.findByRole("dialog", { name: W.editHeading });
      const second = within(sheet).getAllByRole("listitem")[1]!;
      await user.type(within(second).getByRole("textbox", { name: W.minLabel }), " (pretend)");
      const title = within(second).getByRole("textbox", { name: W.stepLabel });
      await user.clear(title);
      await user.type(title, "Typed then closed");
      if (close === "Escape") await user.keyboard("{Escape}");
      else if (close === "Done") await user.click(within(sheet).getByRole("button", { name: W.close }));
      else await user.pointer({ keys: "[MouseLeft]", target: sheet.parentElement! });
      expect(screen.queryByRole("dialog")).toBeNull();
      // Saved by the close itself, well before a typing pause would have saved it.
      await waitFor(
        async () => expect(await db.prefs.get(stepRowId("d2"))).toMatchObject({ title: "Typed then closed", min: "three slow breaths on the edge of the bed (pretend)" }),
        { timeout: AUTOSAVE_MS / 2 },
      );
    });
  }

  it("typing saves after a pause, with the sheet still open", async () => {
    const user = userEvent.setup();
    renderRoutine();
    await user.click(await screen.findByRole("button", { name: W.edit }));
    const sheet = await screen.findByRole("dialog", { name: W.editHeading });
    await user.type(within(within(sheet).getAllByRole("listitem")[0]!).getByRole("textbox", { name: W.minLabel }), "!");
    await waitFor(async () => expect(((await db.prefs.get(stepRowId("d1"))) as { min?: string } | undefined)?.min).toBe("out of bed in that window, even after a bad night!"), { timeout: 3000 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a link to a habit that's gone shows as such, and Not linked really unlinks it (review M3)", async () => {
    await db.items.put(habit("h-old", "Old pretend habit", { status: "archived" }));
    await db.prefs.put({ id: stepRowId("d3"), habitId: "h-old" });
    const user = userEvent.setup();
    renderRoutine();
    await user.click(await screen.findByRole("button", { name: W.edit }));
    const sheet = await screen.findByRole("dialog", { name: W.editHeading });
    const select = within(within(sheet).getAllByRole("listitem")[2]!).getByRole("combobox", { name: W.linkLabel });
    expect(select).toHaveValue("h-old");
    expect(within(select).getByRole("option", { name: W.goneHabit })).toBeInTheDocument();
    await user.selectOptions(select, W.notLinked);
    await waitFor(async () => expect(await db.prefs.get(stepRowId("d3"))).toMatchObject({ habitId: null }));
  });
});

describe("on Home", () => {
  it("sits directly under the goals, inside the goals column", async () => {
    render(
      <MemoryRouter>
        <HomePage today={TODAY} />
      </MemoryRouter>,
    );
    const routine = await screen.findByRole("region", { name: W.heading });
    const goals = screen.getByRole("complementary", { name: "Goals this month" });
    expect(goals).toContainElement(routine);
    expect(within(routine).getByRole("heading", { name: W.heading })).toBeInTheDocument();
  });
});
