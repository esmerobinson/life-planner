// Esme's Rio, phase 2a: what each area shows for her real counters. Phase-1 scenes fill in with
// the stickers placed there (placement.ts sceneState); the new areas follow the counters their
// READMEs name, with the thresholds in thresholds.ts. Nothing here is stored: it is all derived,
// so a counter can only ever add to what she sees.

import type { Counters } from "../farm/earning";
import { SCENES, type SceneId } from "./assets";
import { layout, sceneState } from "./placement";
import {
  FLAMENGO_FULL_WEEKLY_REVIEWS, JARDIM_FULL_SHARE, OS_ESQUILOS_MAX_CELEBRATIONS, QUILO_FULL_RECIPES, SANTA_TERESA_COVER_EVERY, SANTA_TERESA_FULL_BOOKS,
  SANTA_TERESA_MILESTONES, SULT_FULL_MONTHLY_GOALS, ZONA_SUL_STATE,
} from "./thresholds";

export interface RioCounts { monthlyGoals: number; wholeGoals: number; readingBooks: number; recipes: number; weeklyReviews: number }

export const NO_COUNTS: RioCounts = { monthlyGoals: 0, wholeGoals: 0, readingBooks: 0, recipes: 0, weeklyReviews: 0 };

/** The counters the areas read (zeros before the game starts). Recipes don't exist until phase 2b. */
export function rioCounts(c: Counters | null): RioCounts {
  if (!c) return NO_COUNTS;
  return {
    monthlyGoals: c.get("monthly-goals") ?? 0, wholeGoals: c.get("whole-goals") ?? 0, readingBooks: c.get("reading-books") ?? 0, recipes: 0,
    weeklyReviews: c.get("weekly-reviews") ?? 0,
  };
}

export interface ScenePlan {
  /** The base's state (start/mid/full, or Ipanema's stages). */
  state: string;
  /** Os Esquilos: celebration layers 1..n over the start base. */
  celebrations: number;
  /** Santa Teresa (inside): the milestones earned, in order. */
  milestones: string[];
  /** Santa Teresa (inside): spines drawn (book n at shelf slot n). */
  books: number;
  /** Santa Teresa (inside): framed covers hung. */
  covers: number;
}

const placedIn = (scene: SceneId, placed: readonly string[]) => {
  const { bySlot, overflow } = layout(scene, placed);
  return bySlot.size + overflow;
};

const areaOf = (scene: SceneId) => scene.slice(0, scene.indexOf("/"));

/** What a scene shows: its state and the layers drawn over it. */
export function scenePlan(scene: SceneId, placed: readonly string[], counts: RioCounts): ScenePlan {
  const plan: ScenePlan = { state: "start", celebrations: 0, milestones: [], books: 0, covers: 0 };
  switch (areaOf(scene)) {
    case "jardim-botanico": {
      const both: SceneId[] = ["jardim-botanico/outside", "jardim-botanico/inside"];
      const slots = both.reduce((n, s) => n + SCENES[s].slots.length, 0);
      const filled = both.reduce((n, s) => n + placedIn(s, placed), 0);
      plan.state = filled > 0 && filled >= slots * JARDIM_FULL_SHARE ? "full" : "start";
      return plan;
    }
    case "quilo":
      plan.state = counts.recipes >= QUILO_FULL_RECIPES ? "full" : "start";
      return plan;
    case "sult":
      plan.state = counts.monthlyGoals >= SULT_FULL_MONTHLY_GOALS ? "full" : "start";
      return plan;
    case "os-esquilos":
      plan.celebrations = Math.max(0, Math.min(counts.wholeGoals, OS_ESQUILOS_MAX_CELEBRATIONS, SCENES[scene].celebrations?.length ?? 0));
      return plan;
    case "santa-teresa": {
      const books = counts.readingBooks;
      if (books >= SANTA_TERESA_FULL_BOOKS) {
        plan.state = "full"; // shelves, covers and milestones are baked into the full base
        return plan;
      }
      const ms = SCENES[scene].milestones;
      if (!ms) return plan; // outside: no milestones or books of its own
      plan.milestones = ms.filter((_, i) => books >= (SANTA_TERESA_MILESTONES[i] ?? Infinity)).map((m) => m.id);
      plan.books = Math.max(0, books);
      plan.covers = Math.floor(plan.books / SANTA_TERESA_COVER_EVERY);
      return plan;
    }
    case "flamengo-match":
      plan.state = counts.weeklyReviews >= FLAMENGO_FULL_WEEKLY_REVIEWS ? "full" : "start";
      return plan;
    case "museum": // one drawn state per scene (the plaza open, the hall)
      plan.state = Object.keys(SCENES[scene].base)[0]!;
      return plan;
    case "zona-sul":
      plan.state = ZONA_SUL_STATE;
      return plan;
    default:
      plan.state = sceneState(scene, placedIn(scene, placed));
      return plan;
  }
}
