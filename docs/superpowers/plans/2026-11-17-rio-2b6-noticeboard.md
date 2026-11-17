# Esme's Rio 2b-6: bundles, the stuck task, themed nights and holiday stickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

*Written by the Game Design session (2026-11-17) at the Rio session's request.*

**Goal:** The Noticeboard does what Esme ruled. It shows bundles (small real-life challenges whose prize is a whole set at once) and the stuck task (a task left on Today about 5 days holds the next opening until she does it). Finishing a bundle sometimes throws a boteco themed night, announced by a poster, and each night brings one Brazilian record. Holidays earn their sticker set when she does anything real that week.

**Architecture:**
- Everything is derived from the plan-1 ledger and her items, plus a few written-once rows for facts that must not move: a bundle shown complete, an opening held, a night that happened.
- The rows are new kinds in the synced `farm` table, validated like plan 1's.
- The code is pure modules in `hub/src/rio/notice/`. `NoticeboardTab` and the map read them.

**Tech Stack:** React 18, TypeScript, Dexie, Vitest (+ fake-indexeddb, `sync/fakeServer.ts`), Playwright.

**Needs:** plan 1 (ledger, `thingsSince`, event kinds) and plan 2 (v3 families, `seen` for v3 stickers, the Collection, the Pantry on the Noticeboard). It can be built alongside plans 3–5.

**Spec:** `decisions-record.md`:
- 2026-11-09: the stuck task, bundles (A + B earning), the Noticeboard.
- 2026-11-14: "real tasks are the whole point", the Noticeboard simplified, saloon themed nights.
- 2026-11-15: friends' names, boteco themed nights.
- 2026-11-16: vinyl.
- 2026-11-17: holiday stickers, seasons (weather and holidays only), no sparkles.

**Art:** `art/final/rio-pack/later/boteco/themed-nights/` (four nights: samba, karaoke, baile funk, football, plus `posters/`); `art/final/rio-pack/vinyl/` (22 records in `earnOrder`, a player with a 4-frame spin, a crate, a 6-slot wall shelf, a frame); holiday sets in `art/final/esme-pack/week1/` (christmas, hanukkah, …) and any later holiday folders.

## Global Constraints

- **Only real things move anything** (2026-11-14). A bundle fills only from ledger events (real to-dos, habits, check-ins, exercises, morning pages, Inbox sorting, books). Nothing needs doing in the game: a themed night's record arrives whether or not she visits the boteco, and a finished bundle's set goes straight into the Collection.
- **Nothing is ever taken away:**
  - An area that has opened never closes again.
  - A bundle shown complete stays complete, even if a same-day untick drops its events below the target.
  - A record, once given, stays.
  - A holiday set, once earned, stays.
- **The stuck task never punishes.** It only delays the *next* opening, never something she has. Friends' arrivals, stickers, recipes and clothes are never held. Its wording is warm, never "overdue".
- **One stuck task at a time,** and one held opening at a time.
- **No seasons gating** (2026-11-17): no sticker waits for a season; only holidays are dated.
- **Phone:** the Noticeboard is part of the game menu, which is desktop and Mac only ("no game on phone other than stickers collected"). The Collection on the phone shows the earned holiday and vinyl stickers like any other.
- **Wording:** every new string is marked `// PLACEHOLDER WORDING` (Esme words them).
- **Tuning:** every number is in `hub/src/rio/notice/tuning.ts`, marked `// DEFAULT: Esme to confirm` unless this plan says she ruled it.
- **Self-tests** (Esme's top rule: never lose answers): a two-device sync test and a backup round trip for every new row kind. Run `npm test`, `npm run build`, the farm, pwa and phone e2e specs, and `npm run e2e:sync` before pushing.
- Work in `.claude/worktrees/rio-2b6` on branch `rio-2b6` (off `rio-2b2`). Push; never merge or deploy.

## New farm row kinds

| Kind | Id | Fields | Written when | Conflicts |
|---|---|---|---|---|
| `bundle` | `bundle:<bundleKey>` | `bundle`, `opened` (date), `done` (date or null) | `opened` when it first shows on the board; `done` when its completion card plays | same id: the earliest `opened` and the earliest non-null `done` win (merge, never clear) |
| `hold` | `hold:<areaKey>` | `area`, `item` (itemId), `date` | the first time the area's opening day arrives while a stuck task exists | same id: the earliest `date` wins |
| `opened` | `opened:<areaKey>` | `area`, `date` | the first time the area is shown open (held or not) | written once; an `opened` row always beats a `hold` |
| `night` | `night:<bundleKey>` | `bundle`, `date`, `theme` (`samba` / `karaoke` / `funk` / `football`), `record` (vinyl key) | when a finished bundle throws a night | same id: the earliest `date` wins; the record is the one in that row |

All rows have exact keys and are validated in `farm/state.ts`'s `validFarm` (via plan 1's extension point). Old builds quarantine them, as with plan 1.

---

### Task 1: The stuck task and held openings

**Files:**
- Create: `hub/src/rio/notice/stuck.ts`, `hub/src/rio/notice/tuning.ts`
- Modify: `hub/src/rio/areas.ts` (`areaStatuses` takes the holds), `hub/src/farm/state.ts` (validate `hold` and `opened`)
- Test: `hub/src/rio/notice/stuck.test.ts`

**Interfaces:**
- Produces:
  - `STUCK_DAYS = 5`. Esme ruled "about 5 days" (2026-11-09).
  - `stuckTask(items: readonly Item[], today: ISODate): Item | null`.
    - The open plain to-do (not a habit, not a project, not in the Bin, not archived) whose `due` or `pinnedDate` is at least `STUCK_DAYS` days before `today`.
    - Why: anything due or overdue is always on Today (ruling 2026-11-16), so "on Today for about 5 days" is "5 or more days past its date".
    - The oldest date wins, then the earliest `createdAt`, then the id. Inbox items never count.
  - `holdState(area: string, rows: FarmState, items: readonly Item[]): "open" | "held" | "unknown"`.
    - `opened:<area>` present → open.
    - Else `hold:<area>` present → held while its item is open; once the item is done, archived, deleted or purged (missing), the hold is released → open.
    - Else unknown.
  - `areaStatuses(day, visited, holds)`, where `holds: (key: string) => "open" | "held" | "unknown"`:
    - An area whose day has come is open, unless it is `held`.
    - A held area keeps the padlock and status `"next"`, and the areas after it wait in line behind it, as the queue does now.
    - An area already open is never held, whatever happens later.
  - `settleOpenings(...)`, run on open (like plan 1's banking):
    - For the next area whose day has come with no `opened`/`hold` row: if `stuckTask` finds a task, write `hold:<area>` naming it; otherwise write `opened:<area>`.
    - For a held area whose item is now done, archived or gone: write `opened:<area>`.
- **The rule she gave** (2026-11-09 and 2026-11-14):
  - Doing the task opens the area at once.
  - Moving the task to another day keeps the opening tied to it: the hold names the item, not its date.
  - Deleting or archiving the task frees it ("her call, never a failure").
- [ ] **Step 1: Failing tests:**
  - A to-do due 4 days ago is not stuck; due 5 days ago it is. Two stuck: the older date wins.
  - Habits, projects, Inbox items, archived and binned items are never stuck.
  - The museum's day comes with a stuck task → `hold:museum` is written, the museum stays `"next"` (padlock), and the area after it stays locked.
  - The same task is ticked → `opened:museum`, and the museum is open.
  - The held task is moved to next week → still held. Then archived → open. Purged (row gone) → open.
  - An area opened yesterday, then a task becomes stuck today → the area stays open.
  - Two devices: one writes `hold:museum`, the other `opened:museum` → open (an `opened` row always beats a hold).
  - Friends' arrivals are unchanged by any hold (`nextFriend` is unaffected).
- [ ] **Step 2:** Run `npx vitest run src/rio/notice/stuck.test.ts` → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio 2b: a task left on Today holds the next opening (Esme, 2026-11-09)".

### Task 2: Bundles

**Files:**
- Create: `hub/src/rio/notice/bundles.ts`, `hub/src/rio/notice/bundles.json` (the catalogue)
- Modify: `hub/src/farm/state.ts` (validate `bundle`)
- Test: `hub/src/rio/notice/bundles.test.ts`

**Interfaces:**
- **The catalogue** (`bundles.json`, all `// DEFAULT: Esme to confirm`; Esme words the names). About 12 to start, in order, each with:
  - `key`, `name`;
  - `asks`: up to 6 boxes, each an event kind from plan 1 and a count, e.g. `{ kind: "morning", n: 3 }`, `{ kind: "checkin", n: 2 }`, `{ kind: "habit", n: 3 }`, `{ kind: "todo", n: 5, area?: "body" }`, `{ kind: "todo", n: 1, big: true }`, `{ kind: "sorted", n: 5 }`;
  - `anyOf`: how many boxes must be ticked, at most the number of boxes ("any 4 of these 6", her ruling that a bundle never waits on something she isn't doing);
  - `prize`: a list of v3 sticker keys from one decor family, a whole set at once;
  - `night`: whether finishing it throws a themed night.
  - Only prizes whose art exists can be listed.
- **Pace:**
  - `OPEN_AT_ONCE = 3`: up to 3 bundles show at a time.
  - When one finishes, the next in the catalogue opens the same day.
  - The first opens when the Noticeboard's place opens (the Lagoa house, day 1).
- `bundleProgress(b, l: Ledger, opened: ISODate): { boxes: { ask; have: number; done: boolean }[]; ticked: number; complete: boolean }`. Only ledger events dated on or after `opened` count, each event once, filling the first box it fits.
- `bundleBoard(catalogue, rows: FarmState, l: Ledger, today): { open: Bundle[]; finished: Bundle[] }`. Completion is final once the `bundle` row has `done`. A complete-but-not-yet-shown bundle shows its completion card (the existing moment queue), and writing `done` then gives its `prize` stickers (as `seen`, the same path as any v3 sticker).
- [ ] **Step 1: Failing tests:**
  - A bundle asking 3 morning pages and 2 check-ins with `anyOf: 2`: 3 mornings + 1 check-in → 1 box; then a 2nd check-in → complete.
  - Events dated before `opened` don't count.
  - The same event never fills two boxes.
  - Completion writes `done` once, and the prize stickers become earned.
  - A same-day untick after `done` keeps the bundle done and its prize.
  - Three open at once; finishing one opens the 4th that day.
  - Two devices finish the same bundle on different days → the earliest `done` wins on both.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** "Rio 2b: Noticeboard bundles: real-life challenges, a whole set as the prize".

### Task 3: Boteco themed nights and the records

**Files:**
- Create: `hub/src/rio/notice/nights.ts`, `hub/scripts/import-rio-nights.mjs` (copies `themed-nights/` and `vinyl/` from the final pack), `hub/src/assets/rio/nights/*`, `hub/src/assets/rio/vinyl/*`
- Modify: `hub/src/farm/state.ts` (validate `night`), the boteco's night scene (overlay the night's add-on), the Lagoa house living room (the record shelf)
- Test: `hub/src/rio/notice/nights.test.ts`

**Interfaces:**
- `THEMES = ["samba", "karaoke", "funk", "football"]`. Rotated in order; football nights prefer Saturdays when the bundle finishes on a Friday or Saturday (`// DEFAULT`).
- "Sometimes" = the bundle's `night` flag in the catalogue. The default is every other bundle (`// DEFAULT: Esme to confirm`).
- `nightFor(bundle, rows, today): { theme; date; record } | null`:
  - A finished bundle with `night: true` and no `night:` row gets one dated the finish day, or the next day if it finished after 22:00 in Rio (`// DEFAULT`).
  - The record is the next in the vinyl manifest's `earnOrder` not already in a `night` row, so her favourites (the `hero` records) come first.
- **The poster:** from the moment the night row exists until 06:00 the next morning (Rio time), the Noticeboard shows the theme's poster with "tonight's record" in its slot, and the map's boteco gets a small poster badge.
- **The night:** that evening the boteco's full-night scenes wear the theme's add-on, and the player spins tonight's record (4-frame spin, no sound: Esme 2026-11-16).
- **The record:**
  - It goes into the Collection (family `vinyl`, its own page) on the night's date, whether or not she opens the boteco ("nothing in the game is needed").
  - The Lagoa house shelf shows records in the order they came: 6 slots per shelf; the crate holds the rest.
  - The player at home spins the latest record.
- [ ] **Step 1: Failing tests:**
  - A `night: true` bundle finished at 15:00 → a night that evening, with theme 1 and the first `earnOrder` record.
  - The next one → theme 2, record 2.
  - Finished at 23:00 → the night is tomorrow.
  - `night: false` → no night.
  - After all 22 records, nights still happen with no record (`// DEFAULT`).
  - Two devices → one night per bundle, with the earliest row's theme and record.
  - The record is earned without opening the boteco.
- [ ] **Step 2–4:** FAIL → implement → PASS. Check visually at 1280 (samba and football nights, the poster on the board, the shelf with 7 records).
- [ ] **Step 5: Commit** "Rio 2b: boteco themed nights after a bundle, one Brazilian record each".

### Task 4: Holiday stickers

**Files:**
- Create: `hub/src/rio/notice/holidays.ts`, `hub/src/rio/notice/holidays.json` (dates 2026–2030)
- Modify: `hub/src/rio/v3Earning.ts` (plan 2: the `holiday` family's earning)
- Test: `hub/src/rio/notice/holidays.test.ts`

**Interfaces:**
- **The rule (Esme, 2026-11-17):** doing anything real during a holiday's week earns its whole set; a missed holiday comes back next year.
- `holidays.json`:
  - Each holiday has its set key (the art folder's set), its dates per year 2026–2030 (fixed dates, plus a table for moving ones: Easter, Carnaval, Hanukkah, Lunar New Year, Eid al-Fitr, Diwali, Holi, Passover, Rosh Hashanah, Thanksgiving, Mothering Sunday and the rest in `esmeworld-notes/farm-holidays.md`), and its size (Big, Small, Quiet).
  - Only holidays whose art exists are listed. Others are added as the art lands; until then they don't show at all (never a placeholder sticker).
- `holidayWindow(h, year): { from: ISODate; to: ISODate }`:
  - a one-day holiday → that day and the 6 days before it;
  - a longer holiday (Hanukkah, Carnaval 1–15 February) → its own dates;
  - all `// DEFAULT: Esme to confirm`.
- `holidaysEarned(l: Ledger, today, start): string[]`. For each holiday window that has started, on or after the game's start: if any ledger event falls inside it, the whole set is earned and shown as `seen` when its moment plays. A missed window simply passes, and next year's window can earn it.
- **Arrival is obvious** (Esme, 2026-11-14: "there should be some obvious way to tell it came"): the set's moment plays as a holiday card, and the HUD date panel shows the holiday's icon during the window. Map takeovers stay as in 2a's `events.ts`.
- [ ] **Step 1: Failing tests:**
  - Christmas 2026: a to-do ticked on 20 Dec → the Christmas set is earned; nothing ticked 19–25 Dec → not earned, and 2027's window can earn it.
  - Hanukkah 2026 (4–12 Dec): a check-in on 10 Dec earns it.
  - Journal events count only where the journal opens (plan 1's rule).
  - A holiday before the game's start never counts.
  - A set earned stays after its window and through any untick.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** "Rio 2b: holiday sets for doing anything real that week (Esme, 2026-11-17)".

### Task 5: The Noticeboard tab

**Files:**
- Modify: `hub/src/rio/menu/NoticeboardTab.tsx`, `hub/src/rio/notices.ts`
- Test: `hub/src/rio/menu/NoticeboardTab.test.tsx`

- **What the board shows** (Esme, 2026-11-14: bundles and the stuck task only, plus the poster):
  1. The stuck task, pinned at the top while it holds an opening: "The <place> door's stuck. Maybe finishing '<task title>' will free it." (`// PLACEHOLDER WORDING`). It has a link to the task in the app.
  2. Tonight's themed-night poster, while there is one.
  3. The open bundles, each with its boxes, how many are ticked, and the prize's stickers as ghosts until earned.
  4. Below them, what's already on the board today: the next opening and the next friend (`notices.ts`), and plan 2's Pantry.
- Friends' requests and "to try next" tips are not on the board (2026-11-14).
- [ ] **Step 1: Failing tests:** each piece appears only when it applies; the stuck task's title comes from the item; nothing on the board shows journal words; the board renders with no bundles open.
- [ ] **Step 2–4:** FAIL → implement → PASS. Check visually at 1280 with a stuck task, a poster and 3 bundles.
- [ ] **Step 5: Commit** "Rio 2b: the Noticeboard: the stuck task, tonight's poster and bundles".

### Task 6: Self-tests and e2e

- [ ] Two-device sync for `bundle`, `hold`, `opened` and `night` rows (`hub/src/sync/` fake server): the earliest wins as the table says, and `opened` beats `hold`.
- [ ] Old builds: phase-1 `farmState` ignores the new kinds and still reads every old one; an old build quarantines them and applies them after it updates.
- [ ] Backup round trip (replace and merge) of all four kinds.
- [ ] e2e (`e2e/farm.spec.ts`, 1280; fictional data only):
  - a task due 6 days ago holds the next opening, and ticking it opens the place;
  - a seeded bundle is finished by ticking real things, and its set arrives;
  - its night's poster shows on the Noticeboard.
- [ ] Run `npm test`, `npm run build`, the farm, pwa and phone specs and `npm run e2e:sync`. Push `rio-2b6`.

## Decisions for Esme (defaults this plan builds)
1. A task counts as stuck after 5 days past its date. *She ruled "about 5 days".*
2. The bundle catalogue: about 12 bundles, 3 open at a time, each "any N of these". *Default: a first set of 12 for her to rename and adjust.*
3. Themed nights after every other bundle, rotating samba → karaoke → funk → football. *Default.*
4. After the 22nd record, nights carry on without a record. *Default.*
5. A one-day holiday's window is that day and the 6 days before it. Longer holidays use their own dates. *Default.*
