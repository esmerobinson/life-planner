import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { db } from "../data/db";
import { tickItem } from "../data/repo";
import { stepRowId, tickRowId } from "../domain/dailyRoutine";
import type { Item } from "../domain/types";
import { DailyRoutine, ROUTINE_HOME_WORDS as W } from "./DailyRoutine";
import { HomePage } from "./HomePage";

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
  it("shows the count, the next step highlighted with its minimum, two more, and the rest folded", async () => {
    renderRoutine();
    expect(await screen.findByText("0 of 10 today")).toBeInTheDocument();
    const list = within(region()).getByRole("list", { name: W.listLabel });
    const shown = within(list).getAllByRole("listitem");
    expect(shown).toHaveLength(3);
    expect(shown[0]).toHaveAttribute("aria-current", "step");
    expect(shown[0]).toHaveTextContent("Up between 8 and 9am");
    expect(shown[0]).toHaveTextContent(W.minimum("out of bed in that window, even after a bad night"));
    expect(shown[1]).not.toHaveAttribute("aria-current");
    expect(within(region()).getByText(W.more(7))).toBeInTheDocument();
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
    await user.click(await screen.findByText(W.more(7)));
    const vit = (await screen.findByText(W.linked("Vitamins"))).closest("li")!;
    await user.click(within(vit).getByRole("checkbox"));
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
