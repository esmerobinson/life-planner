import { pickPrompts } from "../journal/rotation";
import { PROMPT_BY_ID, STARTER_IDS } from "../journal/prompts";

// Testing session: the 3am day change (dates.ts DAY_ENDS_AT_HOUR) and the check-in questions.
//
// What Esme would see: she opens the Daily check-in late, at 1am. The app rightly treats that as
// the end of the day before (her day runs 3am to 3am), but the questions it picks are the
// *morning* ones, e.g. "Before you reach for your phone, find three things..." or "Describe how
// you're waking up today...", because the flavour is chosen from the clock hour (before 14:00 =
// morning). Those questions are stored for that day, so the whole day's check-in asks
// waking-up questions at the end of her day.
// Cause: journal/rotation.ts flavourAt (hour < 14 -> "morning"), called from
// ui/journal/DailyCheckIn.tsx with new Date().getHours().

const DAY = "2026-11-04";
const flavours = (ids: string[]) => ids.map((id) => `${id}:${PROMPT_BY_ID.get(id)!.when}`);

describe("check-in questions after midnight, before the 3am day change", () => {
  it("at 1am (still the day before) no waking-up question is picked", () => {
    const at1am = pickPrompts({ date: DAY, hour: 1, active: STARTER_IDS, history: [] });
    expect(flavours(at1am).filter((f) => f.endsWith(":morning"))).toEqual([]);
  });
});
