// Esme's Rio, phase 2a: when the new areas grow. Esme hasn't ruled on these yet; each is the
// pack's or the builder's suggestion, in one place so her answers are one-line changes. Every
// count is one of the earning engine's counters (farm/earning.ts), so only real things move them.

/** The Quilo turns full once she has learned this many recipes (none yet: recipes are phase 2b). */
export const QUILO_FULL_RECIPES = 30; // DEFAULT: Esme to confirm

/** Sult turns full at this many monthly goals hit (the "monthly-goals" counter). */
export const SULT_FULL_MONTHLY_GOALS = 7; // DEFAULT: Esme to confirm

/**
 * Os Esquilos lays one celebration piece per whole goal finished, up to the five drawn. Its
 * `full` base (the Sunday feast) isn't shown yet: when it shows is her open question.
 */
export const OS_ESQUILOS_MAX_CELEBRATIONS = 5; // DEFAULT: Esme to confirm

/** Santa Teresa's milestones (lamp, second bookcase, rug, cat bed, window seat), in reading-list books. */
export const SANTA_TERESA_MILESTONES: readonly number[] = [3, 6, 10, 15, 20]; // DEFAULT: Esme to confirm

/** Every this-many books hangs a framed cover. */
export const SANTA_TERESA_COVER_EVERY = 5; // DEFAULT: Esme to confirm

/** Santa Teresa turns full (both bookcases packed, every milestone baked in) at this many books. */
export const SANTA_TERESA_FULL_BOOKS = 142; // DEFAULT: Esme to confirm

/** Zona Sul stays at opening day: its shelves fill from errands and its stages from Admin to-dos in phase 2b. */
export const ZONA_SUL_STATE = "start"; // DEFAULT: Esme to confirm

/** The Flamengo match turns full at this many weekly reviews (its README's "about a month"; reviews aren't built yet). */
export const FLAMENGO_FULL_WEEKLY_REVIEWS = 4; // DEFAULT: Esme to confirm

/** The Jardim Botânico turns full once this share of both scenes' slots holds a sticker. */
export const JARDIM_FULL_SHARE = 0.5; // DEFAULT: Esme to confirm
