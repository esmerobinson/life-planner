// ALL wording for the daily log and the weekly review is PROVISIONAL (Esme rewords; the Design
// session places and styles them). Kept in one place so it is easy to list and change.

import type { Choice } from "../../journal/routine";
import type { Weekday } from "../../domain/types";
import type { Sleep, YesNo } from "../../journal/weeklyReview";

export const ROUTINE_WORDS = {
  // ---- the daily log (Daily check-in tab, under the check-in) ----
  logSection: "Daily log",
  logHeading: "Daily log",
  schedule: "Stuck to my daily schedule?",
  todos: "Finished today's to-dos?",
  /** Under the schedule question: Today's routine on Home that day, as a hint (never an answer). */
  routineHint: (done: number, total: number) => `Your routine that day: ${done} of ${total} steps`,
  scheduleNote: "A short note about your schedule (optional)",
  todosNote: "A short note about your to-dos (optional)",
  choice: { yes: "Yes", partly: "Partly", no: "No" } satisfies Record<Choice, string>,
  logDone: "Logged for today",
  logDoneYesterday: "Logged for yesterday",
  logSectionYesterday: "Yesterday's daily log",
  logHeadingYesterday: "Yesterday's daily log",
  logYesterdayLine: "You can still change yesterday's log today.",
  // ---- the weekly review (Mental health exercise tab, under "what I learned") ----
  reviewSection: "Weekly review",
  reviewHeadingSunday: "It's Sunday: your weekly review",
  reviewHeadingWeek: "Weekly review (any day this week)",
  well: "What went well?",
  inWay: "What got in the way?",
  values: "Am I living my values? (1–10)",
  ifThen: "One if-then plan for next week",
  ifThenHint: "If …, then …",
  minDays: "Which minimum days do I expect?",
  reviewDone: "Weekly review done for this week",
  // ---- both ----
  done: "Done",
  edit: "Edit",
  save: "Save",
  notAnswered: "Not answered",
  notSubmitted: "Not done yet",
  otherDevice: "Also saved, from another device:",
  earlierHere: "Also saved, earlier on this device:",
  /** A version she chose not to use: kept, read-only (fix round 2). */
  earlierVersion: "Earlier version (you chose the answers above):",
  /** Read back (it doesn't say which device). */
  alsoSaved: "Also saved, another version:",
  useThese: "Use these answers",
  remove: "Remove",
  removeAsk: "Remove these answers? They'll be gone from every device.",
  removeYes: "Remove them",
  removeNo: "Keep them",
  saveProblem: "That didn't save. Try again.",
  // ---- Read back ----
  readBackLog: "Daily log",
  readBackReview: "Weekly review",
} as const;

/**
 * Weekly review v2 (its own Journal tab; Esme, 17 and 23 Nov 2026). The questions and their
 * choices are HER words; everything marked PROVISIONAL is ours, for her to reword. The current
 * review's five questions are ROUTINE_WORDS' (well, inWay, values, ifThen, minDays), unchanged.
 */
export const WEEKLY_WORDS = {
  tab: "Weekly review",
  // ---- her words ----
  selfHarm: "Did you self harm this week?",
  selfHarmWhat: "What happened?",
  urges: "Did you have urges to self-harm, even if you didn't act on them?",
  fight: "Did you fight with Oliver?",
  fightAbout: "What about?",
  fightTrigger: "What was the trigger?",
  fightResolved: "How did you resolve it?",
  productive: "Were you productive?",
  achieved: "What did you achieve?",
  struggled: "What did you struggle to achieve this week?",
  dbt: "Which DBT skills did you use?",
  sleep: "How was your sleep overall?",
  proud: "One thing I'm proud of",
  more: "More reflections",
  yesNo: { yes: "Yes", no: "No" } satisfies Record<YesNo, string>,
  sleepChoice: { good: "Good", ok: "OK", poor: "Poor" } satisfies Record<Sleep, string>,
  // ---- PROVISIONAL (ours) ----
  urgesNote: "A note (optional)",
  sleepNote: "A note about your sleep (optional)",
  switchToLast: "Switch to last week",
  switchToThis: "Switch to this week",
  done: "Weekly review done",
  past: "Past weekly reviews",
  pastEmpty: "No past weekly reviews yet.",
  /** After an earlier review's title (made before v2, with the first five questions). */
  earlierQuestions: "(earlier questions)",
} as const;

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};
