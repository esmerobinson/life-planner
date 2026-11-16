# Esme's Rio 2b-2: v3 families, the tick card and the end-of-day summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** She sees what each real thing paid. A small game card appears by the + button after a tick, the end-of-day summary lists what came from which real thing, a Pantry shows what she has, and the 54 non-dish, non-note Rio launch stickers start arriving as v3 family stickers alongside the 175.

**Architecture:** `rio/families.ts` reads the pack's launch sticker manifest into `V3_STICKERS` (dishes and kind notes left out), each with a counter and a step. Its counters come from phase-1 `counters()` plus new ones from plan 1's `Ledger`. Earned v3 stickers join the same earned-moment queue and `seen` rows as phase 1. They never touch the 175, the crown, arrivals or hats. `TickCard` and `DaySummary` are kit-styled React pieces that read `FarmView.ledger` and `FarmView.economy`. The card only shows entries that appear just after a local write; the summary reads `entriesOn(ledger, date)`.

**Tech Stack:** React 18, TypeScript, Vite globs, Dexie, Vitest + Testing Library, Playwright.

**Spec:** `/Users/esme/Documents/coding/esmeworld-notes/rio-design.md` ("Several rewards per action", "Screens"); mockup `/Users/esme/Documents/coding/esmeworld-notes/mockups/rio-rewards.html` (tick card A, summary A); `farm-design-v3.md` (families, "first three at 1, 2, 3"); overview `docs/superpowers/plans/2026-11-17-rio-phase2b-overview.md` (decisions 5, 10, 11); plan 1 `2026-11-17-rio-2b1-ledger.md` (interfaces consumed).

## Global Constraints

- The 175, the crown, `collected`, friends' arrivals and hat thresholds are unchanged. v3 stickers have their own totals (decision 5).
- Nothing is taken away: an earned v3 sticker is kept by its `seen` (or `placed`) row, even if its counter later drops.
- Never choose colour, easing, type, composition or timing (repo CLAUDE.md). Use the esme-ui kit pieces and `BitmapText` (`rio/ui/`), and the UI pack's ingredient icons and pinned/summary templates. Anything missing is a placeholder: magenta `var(--placeholder)`, system font, linear easing. Every time value is either a `farm/motion.ts` constant or a named constant marked `// TIMING: Esme to confirm`. Reduced motion (`useReducedMotion`) means nothing moves.
- New wording is marked `// PLACEHOLDER WORDING`. The journal's words never appear: a check-in line says only that she checked in.
- Phone: no tick card, no summary (Esme, 2026-11-17: "no game on phone other than stickers collected UI"). The phone Collection shows v3 stickers.
- The tick card never shows on `/farm`, and never for entries that arrive only by sync.
- Tuning lives in `hub/src/rio/rewards/tuning.ts`, each line `// DEFAULT: Esme to confirm`.
- Esme's top rule ("never lose answers"): never skip the save and self-test checks. Before pushing: `npm test`, `npm run build`, `npx playwright test e2e/farm.spec.ts` with the pwa and phone specs, and `npm run e2e:sync`.
- Work in `.claude/worktrees/rio-2b2` on branch `rio-2b2` off `rio-2b1`. Push; never merge or deploy.
- Asset files only from `art/final/rio-pack/**` final folders, never `previews/`.

## Review Focus

1. **A to-do ticked on another device arrives by sync while Home is open:** no card pops, and the summary still lists it. (Task 5 test: a ledger entry appearing with no `onLocalWrite` in the window shows no card.)
2. **Tick then untick within a second:** the card for that entry goes (or never shows), and nothing is stored. (Task 5 test.)
3. **A night-tagged sticker reached in daylight** (boteco chope at 1 monthly review, Lagoa heliconia (rain) at 2 active days): the next untagged sticker of that family comes instead, and the tagged one arrives at night or in rain. Total earned is never fewer than the count. (Task 2 test.)
4. **Phone viewport, or a narrow 900 px window:** no card on phone. On a narrow desktop the card fits beside the + button without covering it. (Task 8 e2e at 390×844; Task 5 test that `phone` renders nothing.)
5. **Yesterday had no entries:** no summary opens, and the menu's "Today so far" shows an empty line, not an error. (Task 6 test.)

---

### Task 1: Import the launch stickers; the family catalogue

**Files:**
- Modify: `hub/scripts/import-rio-pack.mjs` (add `day1/stickers` to `AREAS`)
- Create: `hub/src/rio/families.ts`
- Modify: `hub/src/rio/rewards/tuning.ts`
- Test: `hub/src/rio/families.test.ts`

**Interfaces:**
- Consumes: `opensOn` (`rio/areas.ts`); `addDays` (`domain/dates.ts`).
- Produces:
  - `type V3Source = "habit-weeks" | "checkins" | "exercise-days" | "chapters" | "morning-pages" | "big-todos" | "today-finished" | "inbox-sorted" | "weekly-reviews" | "monthly-reviews" | "monthly-goals" | "whole-goals" | "projects" | "reading-books" | "habit-sessions" | "best-streak" | "store-things" | "active-days"`.
  - `interface V3Sticker { key: string; name: string; family: string; familyName: string; set: string; place: string; area: string /* Rio area key */; tag: "any" | "rain" | "night"; source: V3Source; at: number; later: boolean; file: string; diecut: string; ghost: string /* bundled URLs */ }`.
  - `V3_STICKERS: readonly V3Sticker[]` (manifest order, without the `dishes` and `notes` families), `V3_BY_KEY`, `V3_FAMILIES: readonly string[]`.
  - In `tuning.ts`: `RECIPE_EVERY = 8`, `PIECE_EVERY = 6`, `paceStart(start: ISODate, place: string): ISODate | null` (= `addDays(start, opensOn(place)! - 1)`, null when `opensOn` is null), `FAMILY_SOURCE`, `STEP_OVERRIDES`, all `// DEFAULT: Esme to confirm`.
- [ ] **Step 1:** Extend the importer and run it on `/Users/esme/Documents/coding/esmeworld-notes/art/final/rio-pack`.
- [ ] **Step 2: Failing tests:**
  - `V3_STICKERS.length === 54` (87 − 30 dishes − 3 notes).
  - No key collides with a phase-1 `STICKER_BY_KEY` key.
  - Each sticker's `file`, `diecut` and `ghost` URLs are non-empty.
  - Family sources:
    - `trees`→`habit-weeks`, `pond`→`checkins`, `fish`→`exercise-days`, `aquarium`→`chapters`, `greenhouse`→`morning-pages`, `museum`→`big-todos`, `tools`→`today-finished`, `outdoor`→`inbox-sorted`;
    - `theatre`→`weekly-reviews` and `saloon`→`monthly-reviews`, both with `later: true`;
    - `finds`→`projects`, `reading`→`reading-books`, `hedgerow`→`habit-sessions`, `streaks`→`best-streak`, `outfits`→`store-things`, `garden`→`active-days`.
  - Steps:
    - the k-th sticker of a family (k from 1) has `at === k`, e.g. `outdoor-lounger` at 4;
    - overrides: `goals-sult-table` monthly-goals 1, `goals-esquilos-squirrel` whole-goals 1, `goals-palace` monthly-goals 3; streaks 7, 14, 30, 100 in order; outfits 6, 12, 18.
  - Areas: `trees-ipe.area === "jardim-botanico"`, `fish-sardine.area === "ipanema-beach"`, `streaks-trail-sign.area === "dois-irmaos"`, `garden-banana.area === "lagoa-house"` (from `place` through a `PLACE_AREA` table).
  - `paceStart("2026-11-05", "quilo") === "2026-12-04"` (opens day 30).
- [ ] **Step 3:** Run `npx vitest run src/rio/families.test.ts` → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** "Rio 2b: the launch stickers as v3 families".

### Task 2: v3 counters and earning (never fewer, night and rain wait their turn)

**Files:**
- Create: `hub/src/rio/streaks.ts`, `hub/src/rio/v3Earning.ts`
- Test: `hub/src/rio/streaks.test.ts`, `hub/src/rio/v3Earning.test.ts`

**Interfaces:**
- Consumes: `Counters` (`farm/earning.ts`); `Ledger`, `thingsSince` (plan 1); `paceStart` (Task 1); `Look` (`rio/assets.ts`).
- Produces:
  - `bestHabitStreak(items: readonly Item[], start: ISODate, today: ISODate): number`. It returns the longest run, over all habits, of consecutive planned days (by `recur` weekdays) with a tick, counting from `start`. One missed planned day per Mon–Sun week is free (it neither breaks nor adds). Unplanned ticked days add nothing and break nothing.
  - `v3Counters(c: Counters, l: Ledger, items: readonly Item[], start: ISODate, today: ISODate): ReadonlyMap<V3Source, number>`:
    - `big-todos` = ledger entries with `big`;
    - `inbox-sorted` = ledger `sorted` entries;
    - `active-days` = distinct dates of ledger entries;
    - `store-things` = `thingsSince(l, paceStart(start, "clothing-store"))`;
    - `best-streak` = `bestHabitStreak`;
    - the rest copied from `c`.
  - `v3Earned(counts: ReadonlyMap<V3Source, number>, seen: ReadonlySet<string>, look: Look): string[]`. Per family, take the `seen` keys, then walk the family's other stickers in order. A sticker is taken while the family's earned count is below its reached count (stickers whose `at <=` its source's count), and its tag is `any` or matches `look` (`night` matches `"night"`, `rain` matches `"rain"`). A mismatched sticker is skipped (it waits), and `later` stickers are never taken.
- [ ] **Step 1: Failing tests:**
  - **Streak:**
    - Mon/Wed/Fri habit ticked on 4 planned days in a row → 4.
    - One planned miss in a week → the run continues.
    - Two planned misses in one week → it restarts.
    - A tick on a Tuesday (unplanned) changes nothing.
    - Before the start → ignored.
  - **Earning:**
    - `habit-weeks` 2 → `trees-imperial-palm`, `trees-ipe`.
    - Monthly-reviews is `later`, so nothing.
    - Garden with `active-days` 2 at day look → banana and mango (heliconia, tagged rain, is skipped).
    - The same in `rain` → banana and heliconia.
    - Day again with `seen` {banana, heliconia} and count 2 → both stay (never fewer).
    - A seen key whose count dropped to 0 → still earned.
    - A phase-1 `counters()` total is unchanged by v3 (the collection count over `STICKERS` is the same before and after).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio 2b: v3 counters, streaks and earning".

### Task 3: v3 stickers in the farm view, the Collection and the areas

**Files:**
- Modify: `hub/src/farm/FarmContext.tsx`, `hub/src/farm/farmRepo.ts`, `hub/src/farm/world.ts` (`momentQueue` input only), `hub/src/rio/collection.ts`, `hub/src/rio/placement.ts`, `hub/src/rio/menu/CollectionTab.tsx`
- Test: `hub/src/rio/v3View.test.tsx`, additions to `hub/src/rio/collection.test.ts` and `hub/src/rio/placement.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `useRioLook` (`rio/look.ts`); `FarmView.ledger` (plan 1).
- Produces:
  - `FarmView.v3: readonly string[]` (earned v3 keys) and `FarmView.v3Totals: ReadonlyMap<string, { earned: number; of: number }>` per family.
  - `markSeen` and `placeSticker` accept `V3_BY_KEY` keys as well as phase-1 keys.
  - The moment queue = phase-1 derived ++ v3 earned not seen or placed (the Journal rule unchanged).
  - `collected` and `stickerTotals` stay phase-1 only.
  - `COLLECTION_AREAS` gains, in opening order, one page per v3 family under its area. It adds the areas not yet listed (barraca, clothing-store, dois-irmaos, rocinha, santa-teresa, flamengo, sult, os-esquilos, copacabana-palace; `placeName` fallback names, `// PLACEHOLDER WORDING`). `areaOfSticker` covers v3 keys.
  - `homeOf(key)` returns a v3 sticker's area and scene when `AREA_SCENES[area]` exists (rio-areas), else null. `stickerTags(key)` = `["<family>:<set>", "<family>:*"]` (the pack's slot tags; adjust to match rio-areas' slot `accepts` and say so in the report).
- [ ] **Step 1: Failing tests:**
  - (RTL, `FarmProvider` with fake data) Two habit weeks → `v3` holds palm and ipe, `collected` equals the value without v3, and arrivals and `unlocked` are unchanged.
  - `markSeen("trees-ipe")` writes `seen:trees-ipe`.
  - After the habit's ticks are removed, `v3` still has palm and ipe (from `seen`).
  - The Collection shows a Jardim Botânico page with palm and ipe "ready" and jabuticaba as a ghost.
  - `homeOf("fish-sardine")` is `ipanema-beach/sea`.
  - `homeOf` of a sticker whose area has no scene is null, and the Collection still lists it.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. FarmEngine reads `useRioLook()`; this means the weather request now runs whenever the app is open, which the report must mention. **Step 4:** Run → PASS, plus `npx vitest run src/farm src/rio`.
- [ ] **Step 5: Commit** "Rio 2b: v3 stickers join the moments, the Collection and the areas".

### Task 4: Reward pieces: ingredient icons, source labels, next-recipe line

**Files:**
- Create: `hub/src/rio/rewards/pieces.tsx`, `hub/src/rio/rewards/labels.ts`
- Test: `hub/src/rio/rewards/labels.test.ts`, `hub/src/rio/rewards/pieces.test.tsx`

**Interfaces:**
- Consumes: `INGREDIENT_BY_KEY`, `hasIcon`, `LedgerEntry`, `thingsSince`, `shelfUnlocked` (plan 1); `RECIPE_EVERY`, `paceStart` (Task 1); `AREA_NAMES` (as in `farm/catalogue.ts`).
- Produces:
  - `sourceLabel(e: LedgerEntry, items: ReadonlyMap<string, Item>): string`: `todo`/`session` → `"<Area> bed"`; `habit` → `"Hens"`; `checkin` → `"Ipanema"`; `list` → `"Fazenda basket"`; `exercise`/`morning`/`sorted`/`book` → a short name (`// PLACEHOLDER WORDING`).
  - `lineTitle(e, items): string`: the item's title for `todo`/`session`/`book`/`sorted`, else the source label. It never reads the journal.
  - `errandUnlock(e: LedgerEntry): string | null`: `SHELF_ORDER[e.errandIndex]` (plan 1's `errandIndex`), null for a non-errand or an index past the shelf.
  - `nextRecipe(l: Ledger, start: ISODate, today: ISODate): { n: number; of: number } | null` (null before `paceStart(start, "quilo")`).
  - `<IngredientIcon k n? />`: the icon at 1 UI px per art px, or a magenta 16×16 placeholder when `!hasIcon(k)`, with `×n` in `BitmapText`.
  - `<GiftRow gift />`: icons in `INGREDIENTS` order.
  - `<NextRecipeLine l start today />`: hidden when `nextRecipe` is null.
- [ ] **Step 1: Failing tests:**
  - Labels for each kind.
  - A check-in line has no journal text (input facts carry none; assert the label is exactly `"Ipanema"`).
  - `nextRecipe` with 14 things since the Quilo opened → `{ n: 6, of: 8 }`, and the day before it opens → null.
  - `errandUnlock` of the 2nd errand = `SHELF_ORDER[1]`.
  - `IngredientIcon` of `milk` renders the placeholder with an accessible name "Milk".
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** "Rio 2b: reward pieces: icons, labels, next recipe".

### Task 5: The tick card

**Files:**
- Create: `hub/src/rio/rewards/TickCard.tsx`, `hub/src/rio/rewards/tickFeed.ts`, `hub/src/rio/rewards/tick-card.css`
- Modify: `hub/src/ui/AppShell.tsx` (mount beside `AddButton`, only when `!phone && !game`)
- Test: `hub/src/rio/rewards/tickFeed.test.ts`, `hub/src/rio/rewards/TickCard.test.tsx`

**Interfaces:**
- Consumes: `onLocalWrite` (`data/changeTracking.ts`); `FarmView.ledger`; Task 4 pieces.
- Produces:
  - `tickFeed(prev: ReadonlySet<string>, next: Ledger, lastLocalWriteAt: number | null, now: number): string[]`: entry ids in `next` and not in `prev`, but only when `lastLocalWriteAt !== null && now - lastLocalWriteAt <= LOCAL_WINDOW_MS`.
  - `LOCAL_WINDOW_MS` (a technical window, `// TIMING: Esme to confirm`), `CARD_SHOW_MS` (`// TIMING: Esme to confirm`), `MAX_CARDS = 3` (`// DEFAULT: Esme to confirm`).
  - `<TickCard phone />`. It renders nothing when `phone`, when no farm view is available, or before the ledger first loads (the first ledger seen is the baseline, so a reload never pops old entries). Each new entry is one kit card: source label, `GiftRow`, "new at Zona Sul" with the unlocked icon for errands, and `NextRecipeLine`. Cards stack newest on top up to `MAX_CARDS`. An entry gone from the ledger (unticked) removes its card. The container is `role="status"` `aria-live="polite"` and has the same text. Linear appear/leave only without reduced motion.
- [ ] **Step 1: Failing tests:**
  - `tickFeed`:
    - a new id with a local write 200 ms ago → `[id]`;
    - a new id with no local write → `[]` (sync arrival);
    - a write older than the window → `[]`;
    - no new ids → `[]`.
  - RTL:
    - A to-do ticked (fake `onLocalWrite` fired, the ledger gains `todo:x` with `{beans:2, rice:1}`) → a card with "Admin bed", beans ×2, rice ×1.
    - Three quick ticks → 3 cards; a 4th → still 3, the oldest gone.
    - Untick → its card goes.
    - `phone` → nothing rendered.
    - The first render with existing entries → no card.
    - Reduced motion → no animation class.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (layout per mockup A beside the + button; pieces from the kit; magenta where the kit lacks one). **Step 4:** Run → PASS, plus `npx vitest run src/ui/AppShell.test.tsx src/ui/HomePage.test.tsx`.
- [ ] **Step 5: Commit** "Rio 2b: the tick card by the + button".

### Task 6: The end-of-day summary

**Files:**
- Create: `hub/src/rio/rewards/DaySummary.tsx`, `hub/src/rio/rewards/summaryLines.ts`, `hub/src/rio/rewards/summaryWhen.ts`
- Modify: `hub/src/farm/farmRepo.ts` (`markSummary`), `hub/src/ui/AppShell.tsx` (mount when `!phone`), `hub/src/rio/menu/NoticeboardTab.tsx` ("Today so far")
- Test: `hub/src/rio/rewards/summaryLines.test.ts`, `hub/src/rio/rewards/summaryWhen.test.ts`, `hub/src/rio/rewards/DaySummary.test.tsx`

**Interfaces:**
- Consumes: `entriesOn`, `summaryRow`, `FarmState.summaries` (plan 1); Task 4.
- Produces:
  - `interface SummaryLine { key: string; title: string; gift: Gift; note?: "zona-sul"; unlock?: string }`.
  - `summaryLines(entries: readonly LedgerEntry[], items: ReadonlyMap<string, Item>, l: Ledger): SummaryLine[]`. It gives one line per to-do, session, sorted item and book, in `(date, id)` order. Habit sessions become one line, "N habit sessions", with gifts summed. Check-in, exercise and morning pages get one line each, and the list one line "Fazenda basket". Errands carry `note: "zona-sul"` and `unlock`.
  - `farmRepo.markSummary(date: ISODate): Promise<void>` (writes `summary:<date>` once).
  - `summaryDue(now: Date, today: ISODate, seen: ReadonlySet<ISODate>, hasEntries: (d: ISODate) => boolean): ISODate | null`. Today is due once local time is ≥ `SUMMARY_FROM_HOUR = 21` (`// DEFAULT: Esme to confirm`) and today is unseen with entries. Otherwise yesterday is due if it is unseen with entries. Otherwise null.
  - `<DaySummary date onClose />`: the kit panel, the day's name as its title (`Intl` weekday), the lines with `GiftRow`, `NextRecipeLine` with its bar, and a "Good night" button (`// PLACEHOLDER WORDING`) that calls `markSummary(date)` then closes. Esc closes it without marking, so it comes back next open. It is a modal dialog with focus in, focus returned on close.
- [ ] **Step 1: Failing tests:**
  - **Lines:**
    - 4 to-dos, 2 habit sessions and a check-in → 6 lines; the habit line says "2 habit sessions" with summed gifts.
    - An errand line has `note` and `unlock`.
    - A check-in line's title is the label, not journal text.
  - **When:**
    - 20:59 → null; 21:00 with entries → today.
    - Today seen → null.
    - The next morning with yesterday unseen and with entries → yesterday.
    - Yesterday with no entries → null.
  - **RTL:**
    - "Good night" writes `summary:<date>` and closes.
    - Esc closes and writes nothing.
    - The Noticeboard's "Today so far" opens the summary for today; with no entries it shows the empty line.
  - **Two devices** (fake server): the summary seen on A (`summary:D` synced) is not due on B.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio 2b: the end-of-day summary".

### Task 7: The Pantry on the Noticeboard

**Files:**
- Modify: `hub/src/rio/menu/NoticeboardTab.tsx`; remove plan 1's visually hidden pantry probe (keep its test ids)
- Test: additions to `hub/src/rio/menu/GameMenu.test.tsx`

**Interfaces:**
- Consumes: `FarmView.economy` (plan 1); `IngredientIcon` (Task 4).
- Produces: a Pantry section listing `economy.have` in `INGREDIENTS` order, each cell `data-testid="pantry-count-<key>"` with its count. With nothing yet, one placeholder line. It fits the panel without scrolling and pages with the kit's arrows if it overflows, as the Collection does.
- [ ] **Step 1: Failing tests:**
  - With `have` {beans:3, egg:1}, the tab shows two cells with 3 and 1, in catalogue order.
  - An empty pantry shows the empty line.
  - 50 ingredients fit across pages with no scrollbar (layout test at `menuFit(1280, 600)`).
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** "Rio 2b: the Pantry on the Noticeboard".

### Task 8: Self-tests and e2e

**Files:**
- Modify: `hub/e2e/farm.spec.ts`, `hub/e2e/rewards-sync.spec.ts` (plan 1's)
- Test: the files above

- [ ] **Step 1: Failing e2e:**
  - Desktop 1440×900: on Home, tick a fictional Admin to-do → a tick card with "Admin bed" appears by the + button. Reload → no card.
  - Phone 390×844: tick a to-do → no card, and the Rio tab shows only the Collection with a v3 page.
  - `rewards-sync.spec.ts`: B sees A's tick in "Today so far" and gets no card.
  - Unit: v3 earned keys never shrink across a simulated untick (seen rows); `collected` is identical with and without v3 rows.
- [ ] **Step 2:** Run → FAIL where new. **Step 3:** Fix what they find. **Step 4:** Run `npm test`, `npm run build`, `npx playwright test e2e/farm.spec.ts` with the pwa and phone specs, and `npm run e2e:sync` → PASS.
- [ ] **Step 5: Commit** "Rio 2b: self-tests for the reward screens and v3 stickers", then push `rio-2b2`.
