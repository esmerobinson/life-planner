import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { DEFAULT_DUE_PREFS, duePrefsRow, type DuePrefsRow } from "../reminders/duePrefs";
import { DUE_WORDS } from "./DueSection";
import { RemindersPage } from "./RemindersPage";

// The Reminders page's Due section: her settings, saved to the synced prefs row the Worker reads.

afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
  await db.prefs.clear();
  await db.pending.clear();
  await db.syncMeta.clear();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <RemindersPage />
    </MemoryRouter>,
  );
const section = async () => within(await screen.findByRole("region", { name: DUE_WORDS.heading }));
const stored = () => db.prefs.get("due") as Promise<DuePrefsRow | undefined>;

describe("Reminders in Due", () => {
  it("says plainly what is stored on Due's server; off until she turns it on", async () => {
    renderPage();
    const s = await section();
    expect(s.getByRole("note")).toHaveTextContent("Stored on Due's server");
    expect(s.getByRole("note")).toHaveTextContent("motivation lines");
    expect(s.getByRole("note")).toHaveTextContent("Nothing from your journal");
    expect(s.getByRole("button", { name: `${DUE_WORDS.toggle}: Off` })).toHaveAttribute("aria-pressed", "false");
    expect(await stored()).toBeUndefined();
  });

  it("turning it on saves the synced row (marked to sync)", async () => {
    renderPage();
    const s = await section();
    await userEvent.click(s.getByRole("button", { name: `${DUE_WORDS.toggle}: Off` }));
    await vi.waitFor(async () => expect(await stored()).toMatchObject({ id: "due", on: true, timeZone: "America/New_York", plan: "09:00" }));
    expect(await db.pending.get(["prefs", "due"])).toBeTruthy();
    expect(s.getByRole("button", { name: `${DUE_WORDS.toggle}: On` })).toBeInTheDocument();
  });

  it("the times, the lead and the time zone are saved", async () => {
    renderPage();
    const s = await section();
    fireEvent.change(s.getByLabelText(DUE_WORDS.plan), { target: { value: "08:15" } });
    await vi.waitFor(async () => expect((await stored())?.plan).toBe("08:15"));
    fireEvent.change(s.getByLabelText(DUE_WORDS.nudge), { target: { value: "13:30" } });
    fireEvent.change(s.getByLabelText(DUE_WORDS.lead), { target: { value: "30" } });
    await userEvent.selectOptions(s.getByLabelText(DUE_WORDS.timeZone), "America/Sao_Paulo");
    await vi.waitFor(async () =>
      expect(await stored()).toMatchObject({ plan: "08:15", nudge: "13:30", leadMinutes: 30, timeZone: "America/Sao_Paulo" }),
    );
  });

  it("one count time (default 14:00) replaces the two per-item times (20 Nov)", async () => {
    renderPage();
    const s = await section();
    expect(s.getByLabelText(DUE_WORDS.countNudge)).toHaveValue("14:00");
    expect(s.queryByLabelText("Due today and not done")).toBeNull();
    expect(s.queryByLabelText("Still not done")).toBeNull();
    fireEvent.change(s.getByLabelText(DUE_WORDS.countNudge), { target: { value: "15:30" } });
    await vi.waitFor(async () => expect((await stored())?.countNudge).toBe("15:30"));
  });

  it("where she is, for sunset: her time zone's city until she chooses; a city saves its place", async () => {
    renderPage();
    const s = await section();
    const where = s.getByLabelText(DUE_WORDS.where);
    expect(where).toHaveValue("nyc");
    await userEvent.selectOptions(where, "rio");
    await vi.waitFor(async () => expect(await stored()).toMatchObject({ place: "rio", lat: -22.9068, lon: -43.1729 }));
  });

  it("Use my location: the browser's position, rounded, kept with the settings; refused: nothing changes", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) =>
      ok({ coords: { latitude: 40.71283, longitude: -73.98765 } } as GeolocationPosition),
    );
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    renderPage();
    const s = await section();
    await userEvent.selectOptions(s.getByLabelText(DUE_WORDS.where), "here");
    await vi.waitFor(async () => expect(await stored()).toMatchObject({ place: "here", lat: 40.7, lon: -74 }));
    expect(s.getByLabelText(DUE_WORDS.where)).toHaveValue("here");

    getCurrentPosition.mockImplementation(((_ok: PositionCallback, fail: PositionErrorCallback) =>
      fail({ code: 1, message: "denied" } as GeolocationPositionError)) as never);
    await userEvent.selectOptions(s.getByLabelText(DUE_WORDS.where), "london");
    await vi.waitFor(async () => expect((await stored())?.place).toBe("london"));
    await userEvent.selectOptions(s.getByLabelText(DUE_WORDS.where), "here");
    expect(await s.findByText(DUE_WORDS.locationFailed)).toBeInTheDocument();
    expect(await stored()).toMatchObject({ place: "london", lat: 51.5074 });
    // @ts-expect-error tidy up the test's stand-in
    delete navigator.geolocation;
  });

  it("a time zone without a city and no place chosen: it says Before sunset reminders need one", async () => {
    await db.prefs.put(duePrefsRow({ ...DEFAULT_DUE_PREFS, timeZone: "Asia/Tokyo" }));
    renderPage();
    const s = await section();
    expect(s.getByLabelText(DUE_WORDS.where)).toHaveValue("");
    expect(s.getByText(DUE_WORDS.noPlace)).toBeInTheDocument();
  });

  it("a lead outside 0 to 240 minutes isn't saved", async () => {
    renderPage();
    const s = await section();
    fireEvent.change(s.getByLabelText(DUE_WORDS.lead), { target: { value: "999" } });
    fireEvent.change(s.getByLabelText(DUE_WORDS.plan), { target: { value: "08:00" } });
    await vi.waitFor(async () => expect((await stored())?.plan).toBe("08:00"));
    expect((await stored())?.leadMinutes).toBe(15);
  });

  it("she adds and removes her own motivation lines", async () => {
    renderPage();
    const s = await section();
    await userEvent.type(s.getByLabelText(DUE_WORDS.newLine), "  Pretend you can  ");
    await userEvent.click(s.getByRole("button", { name: DUE_WORDS.addLine }));
    await userEvent.type(s.getByLabelText(DUE_WORDS.newLine), "Second pretend line{Enter}");
    await vi.waitFor(async () => expect((await stored())?.lines).toEqual(["Pretend you can", "Second pretend line"]));
    expect(within(s.getByRole("list", { name: DUE_WORDS.linesHeading })).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(s.getByRole("button", { name: "Remove line: Pretend you can" }));
    await vi.waitFor(async () => expect((await stored())?.lines).toEqual(["Second pretend line"]));
  });

  it("a blank line can't be added; a line is at most 120 characters", async () => {
    renderPage();
    const s = await section();
    await userEvent.type(s.getByLabelText(DUE_WORDS.newLine), "   ");
    expect(s.getByRole("button", { name: DUE_WORDS.addLine })).toBeDisabled();
    expect(s.getByLabelText(DUE_WORDS.newLine)).toHaveAttribute("maxLength", "120");
  });

  it("a zone saved elsewhere that isn't in the short list is still shown", async () => {
    await db.prefs.put(duePrefsRow({ ...DEFAULT_DUE_PREFS, timeZone: "Asia/Kolkata" }));
    renderPage();
    const s = await section();
    expect(s.getByLabelText(DUE_WORDS.timeZone)).toHaveValue("Asia/Kolkata");
  });

  it("a change from another device shows at once, and a change here keeps it (review I5)", async () => {
    await db.prefs.put(duePrefsRow({ ...DEFAULT_DUE_PREFS, on: true }));
    renderPage();
    const s = await section();
    // The Mac adds lines while this page is open (a sync writes the row).
    await db.prefs.put(duePrefsRow({ ...DEFAULT_DUE_PREFS, on: true, lines: ["From the Mac"] }));
    expect(await s.findByText("From the Mac")).toBeInTheDocument();
    // Then she changes a time here: only that field changes; the Mac's lines stay.
    await db.prefs.put(duePrefsRow({ ...DEFAULT_DUE_PREFS, on: true, lines: ["From the Mac", "Second from the Mac"] }));
    fireEvent.change(s.getByLabelText(DUE_WORDS.review), { target: { value: "22:30" } });
    await vi.waitFor(async () => expect(await stored()).toMatchObject({ review: "22:30", lines: ["From the Mac", "Second from the Mac"] }));
  });

  it("a field a later version added is kept when she saves here", async () => {
    await db.prefs.put({ ...duePrefsRow({ ...DEFAULT_DUE_PREFS, on: true }), laterField: 7 } as never);
    renderPage();
    const s = await section();
    fireEvent.change(s.getByLabelText(DUE_WORDS.plan), { target: { value: "07:30" } });
    await vi.waitFor(async () => expect(await stored()).toMatchObject({ plan: "07:30", laterField: 7 }));
  });

  it("if the settings can't be read, nothing can be changed (no defaults saved over them)", async () => {
    vi.spyOn(db.prefs, "get").mockRejectedValue(new Error("pretend read failure"));
    renderPage();
    const s = await section();
    expect(await s.findByRole("alert")).toHaveTextContent(DUE_WORDS.readFailed);
    expect(s.getByRole("button", { name: `${DUE_WORDS.toggle}: Off` })).toBeDisabled();
    expect(s.getByLabelText(DUE_WORDS.plan)).toBeDisabled();
  });

  it("before this device's first sync has finished, it waits for her settings from other devices", async () => {
    await db.syncMeta.put({ key: "token", value: "f".repeat(64) });
    renderPage();
    const s = await section();
    expect(s.getByText(DUE_WORDS.waiting)).toBeInTheDocument();
    expect(s.getByRole("button", { name: `${DUE_WORDS.toggle}: Off` })).toBeDisabled();
    // The settings arrive with the first sync.
    await db.prefs.put(duePrefsRow({ ...DEFAULT_DUE_PREFS, on: true }));
    expect(await s.findByRole("button", { name: `${DUE_WORDS.toggle}: On` })).toBeEnabled();
  });

  it("says plainly that Due also sees when reminders go off and when they're cancelled; shows this device's zone", async () => {
    renderPage();
    const s = await section();
    expect(s.getByRole("note")).toHaveTextContent("when each one goes off");
    expect(s.getByRole("note")).toHaveTextContent("cancelled");
    expect(s.getByText(new RegExp(`This device is on ${Intl.DateTimeFormat().resolvedOptions().timeZone.replace("/", "\\/")}`))).toBeInTheDocument();
  });

  it("shows what was saved before (from another device too)", async () => {
    await db.prefs.put(duePrefsRow({ ...DEFAULT_DUE_PREFS, on: true, review: "22:00", lines: ["Already here"] }));
    renderPage();
    const s = await section();
    expect(s.getByRole("button", { name: `${DUE_WORDS.toggle}: On` })).toBeInTheDocument();
    expect(s.getByLabelText(DUE_WORDS.review)).toHaveValue("22:00");
    expect(s.getByText("Already here")).toBeInTheDocument();
  });
});
