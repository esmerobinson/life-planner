// ALL wording for the daily log and the weekly review is PROVISIONAL (Esme rewords; the Design
// session places and styles them). Kept in one place so it is easy to list and change.

import type { Choice } from "../../journal/routine";
import type { Weekday } from "../../domain/types";

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

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};
