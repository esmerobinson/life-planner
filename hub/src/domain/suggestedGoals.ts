// The Goals page's "Suggested goals" card (goals-redesign-brief.md): her three goals, set up
// to count themselves. Nothing is created until she taps one. Each has a fixed id, so tapping
// it on two devices makes the same row (sync merges them) and the card knows it is added.

import { daysInMonth } from "./goalCounts";
import { monthOf } from "./dates";
import type { CountSource, Goal, ISODate } from "./types";

export interface SuggestedGoal {
  id: string;
  title: string;
  areaId: Goal["areaId"];
  daily: boolean;
  countsFrom: CountSource[];
  /** This month's count: its title, and its target ("days" = every day of the month). */
  count: { title: string; target: number | "days" };
  onHome: boolean;
}

export const SUGGESTED_GOALS: readonly SuggestedGoal[] = [
  {
    id: "suggested-bpd-practice",
    title: "BPD practice every day",
    areaId: "mind",
    daily: true,
    countsFrom: ["exercise", "linked"],
    count: { title: "Days practised", target: "days" },
    onHome: true,
  },
  {
    id: "suggested-journal-daily",
    title: "Journal daily",
    areaId: "mind", // Journal isn't an area (brief: use Mind)
    daily: true,
    countsFrom: ["journal"],
    count: { title: "Days journalled", target: "days" },
    onHome: true,
  },
  {
    id: "suggested-mental-health",
    title: "Improve my mental health",
    areaId: "mind",
    daily: false,
    countsFrom: ["exercise", { area: "mind" }],
    count: { title: "Mind things done", target: 30 },
    onHome: false,
  },
];

/** The goal row a suggestion becomes when she taps it (as of `today`). */
export function suggestedGoalRow(s: SuggestedGoal, today: ISODate): Goal {
  const month = monthOf(today);
  const goal: Goal = {
    id: s.id,
    title: s.title,
    areaId: s.areaId,
    kind: "practice",
    milestones: [],
    countsFrom: s.countsFrom,
    monthGoals: [
      {
        id: `${s.id}-${month}`,
        month,
        kind: "count",
        title: s.count.title,
        target: s.count.target === "days" ? daysInMonth(month) : s.count.target,
      },
    ],
    createdAt: today,
  };
  if (s.daily) goal.rhythm = "daily";
  if (s.onHome) goal.onHome = true;
  return goal;
}
