# Life Hub Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, offline-capable web app (new `hub/` folder) where Esme's tasks, goals and areas live in the browser, imported from her existing `Backlog.md`, with a Today view that triages for her, goal progress bars, a move-to menu, and a quick-add form.

**Architecture:** React + TypeScript single-page app. All data is stored in IndexedDB through Dexie, behind a small repository module (`repo.ts`) so sync can be added later without touching the UI. Triage and goal-progress logic are pure functions in `domain/` that take data and a date string and return results, so they are tested without a browser.

**Tech Stack:** Vite, React 18, TypeScript, react-router-dom, Dexie, Vitest, @testing-library/react, fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-10-27-life-hub-design.md` (read it first). Visual rules: `VISUAL-LANGUAGE.md`. Existing logic being ported: `src/backlog.py`.

**This is plan 1 of 5.** Later plans (not here): 2 sync + Cloudflare + backup, 3 notifications/reminders + overdue popups, 4 journal (morning pages upload, E2E-encrypted check-in) + weekly/monthly reviews, 5 vision board + Google Calendar. The Journal card on Home is a disabled stub in this plan.

## Global Constraints

- Free tools only; no paid services. Works offline (everything in this plan is local).
- Dates are local calendar dates stored as `"YYYY-MM-DD"` strings. Never use `Date` objects across module boundaries; never convert through UTC.
- Today shows at most 4 picks (`CAPACITY = 4`); due window is `DUE_HORIZON = 3` days (from `src/backlog.py`); overflow goes to an "Also due" list, never dropped.
- Kill = archive (`status: "archived"`), recoverable; never delete rows.
- Styling uses only values from `VISUAL-LANGUAGE.md`: sampled palette, `font-family: system-ui`, `transition-timing-function: linear`. Anything undecided (confetti, stars, mole, mascot art) is a magenta `#ff00ff` placeholder. Do not choose colour, type, easing or timing yourself; if a value is not in that file, use the placeholder and note it.
- Sidebar icons are the SVGs in `docs/design/icons/` (copy, do not redraw). Sidebar order: Home, Today, Goals | Writing, Art, Content, Mind, Body | Journal, Vision board.
- No emoji in UI copy or files. Never guilt-trip copy: overdue shows a sticker reading "OVERDUE", nothing scolding.

## Review Focus

1. Importing the same `Backlog.md` twice must not duplicate items, and re-importing after Esme ticked something in the app must not bring it back open (Task 5).
2. A task completed at the end of a month/year must count toward that month/year, not the next; dates never shift by timezone (Task 3).
3. Seven overdue items at once: Today shows 4, the other 3 appear under "Also due", none vanish (Tasks 2, 7).
4. Empty states and zero targets: no items, no goals, a goal with no target or zero milestones renders a calm prompt, never `NaN%` or a crash (Tasks 3, 7, 9).
5. Malformed backlog lines (bad date such as `[due 2026-13-45]`, empty text, unknown `!p9`) are skipped or defaulted with a report, never crash the import (Task 5).

---

### Task 1: Scaffold, domain types, date helpers, database

**Files:**
- Create: `hub/package.json`, `hub/vite.config.ts` (with Vitest `environment: "jsdom"`, setup file), `hub/tsconfig.json`, `hub/index.html`, `hub/src/main.tsx`, `hub/src/App.tsx` (renders "Life Hub"), `hub/src/test/setup.ts` (imports `fake-indexeddb/auto`, `@testing-library/jest-dom`)
- Create: `hub/src/domain/types.ts`, `hub/src/domain/dates.ts`, `hub/src/data/db.ts`
- Test: `hub/src/domain/dates.test.ts`, `hub/src/data/db.test.ts`
- Modify: `.gitignore` (add `hub/node_modules/`, `hub/dist/`)

**Interfaces:**
- Produces, in `types.ts`:
  - `type AreaId = "writing" | "art" | "content" | "mind" | "body" | "inbox"`; `type Priority = 1 | 2 | 3`; `type Weekday = "mon"|"tue"|"wed"|"thu"|"fri"|"sat"|"sun"`; `type ISODate = string`
  - `interface Item { id: string; kind: "task" | "idea"; title: string; notes?: string; links: string[]; areaId: AreaId; goalId?: string; priority: Priority; due?: ISODate; recur?: Weekday[]; status: "open" | "done" | "archived"; pinnedDate?: ISODate; weekOf?: ISODate; hiddenOn?: ISODate; completedAt?: ISODate; createdAt: ISODate; touchedAt: ISODate; source?: { kind: "backlog" | "manual"; key: string } }`
  - `interface Milestone { id: string; title: string; done: boolean }`
  - `interface Goal { id: string; title: string; areaId: AreaId; kind: "finite" | "practice"; deadline?: ISODate; monthlyTarget?: number; milestones: Milestone[]; createdAt: ISODate }`
- Produces, in `dates.ts`: `addDays(d: ISODate, n: number): ISODate`, `daysBetween(a: ISODate, b: ISODate): number` (b minus a), `mondayOf(d: ISODate): ISODate`, `monthOf(d: ISODate): string` (`"YYYY-MM"`), `weekdayOf(d: ISODate): Weekday`, `todayISO(): ISODate` (local date), `isValidISODate(s: string): boolean`.
- Produces, in `db.ts`: `class HubDB extends Dexie` with `items: Table<Item, string>` indexed on `status, areaId, goalId, due` and `goals: Table<Goal, string>`; `export const db = new HubDB()`.

- [ ] **Step 1: Write failing tests.** `dates.test.ts`: `addDays("2026-02-28", 1) === "2026-03-01"`, `addDays("2026-12-31", 1) === "2027-01-01"`, `mondayOf("2026-10-25") === "2026-10-19"` (a Sunday goes back to Monday), `weekdayOf("2026-10-27") === "tue"`, `monthOf("2026-12-31") === "2026-12"`, `isValidISODate("2026-13-45") === false`. `db.test.ts`: put an `Item` and a `Goal`, read both back by id.
- [ ] **Step 2: Run** `cd hub && npx vitest run` — Expected: FAIL (modules missing).
- [ ] **Step 3: Scaffold the project** (`npm create vite@latest hub -- --template react-ts`, add dependencies listed above) and implement `types.ts`, `dates.ts` (build from `Date.UTC` components so no timezone shift), `db.ts`.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS. Also `npm run build` succeeds.
- [ ] **Step 5: Commit** `feat(hub): scaffold app, domain types, date helpers, Dexie db`.

### Task 2: Triage engine (port of `plan_for`)

**Files:** Create `hub/src/domain/triage.ts`; Test `hub/src/domain/triage.test.ts`.

**Interfaces:**
- Consumes: `Item`, `Goal`, `ISODate`, `addDays`, `daysBetween`, `weekdayOf`.
- Produces: `export const CAPACITY = 4`, `export const DUE_HORIZON = 3`; `export function pickToday(items: Item[], goals: Goal[], today: ISODate, thisMonthDone: Record<string, number>): { rhythm: Item[]; picks: Item[]; alsoDue: Item[] }` (`thisMonthDone` maps goalId to tasks completed this month, used only as a tie-breaker).

Rules (port `src/backlog.py:60-87`, adapted to the spec): only `kind: "task"`, `status: "open"`; `areaId: "inbox"` excluded; items with `hiddenOn === today` excluded. `rhythm` = items with `recur` containing today's weekday. Items with `pinnedDate === today` come first and are always in `picks`. Then due/overdue items (`daysBetween(today, due) <= DUE_HORIZON`) sorted by `(due, priority)`, then p1s, then a rotating p2 selection starting at `toOrdinal(today) % p2.length` (use `daysBetween("1970-01-01", today)` as the ordinal). Fill `picks` to `CAPACITY`; due items beyond capacity go to `alsoDue` (never dropped). On Sundays `picks` = pinned + at most 2 due items, rest of due in `alsoDue`, no p1/p2 filler. Tie-breaker among equal priority: a goal with a monthly target and fewer completions than elapsed-month pace sorts first.

- [ ] **Step 1: Write failing tests** (named for the rule): `"recurring item appears only on its weekdays"`; `"overdue and due within 3 days come first, ordered by due then priority"`; `"fills to 4 with p1 then rotates p2 by date"` (same input on two consecutive days yields different p2 picks); `"seven overdue items: 4 picks, 3 alsoDue, none lost"`; `"pinned item is always included and counts toward the cap"`; `"hiddenOn today removes an item, hiddenOn yesterday does not"`; `"inbox, ideas, done and archived items never picked"`; `"sunday is light"`; `"empty input returns empty lists"`.
- [ ] **Step 2: Run** `npx vitest run src/domain/triage.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `pickToday`** as pure code, no I/O.
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): triage engine ported from backlog.py`.

### Task 3: Goal progress (monthly bar + overall arc)

**Files:** Create `hub/src/domain/progress.ts`; Test `hub/src/domain/progress.test.ts`.

**Interfaces:**
- Consumes: `Item`, `Goal`, `ISODate`, `monthOf`, `addDays`.
- Produces:
  - `monthlyProgress(goal: Goal, items: Item[], today: ISODate): { done: number; target: number; ratio: number } | null` — `null` when `goal.monthlyTarget` is undefined or `<= 0`. `done` counts items with `goalId === goal.id`, `status === "done"` and `monthOf(completedAt) === monthOf(today)`; `ratio = min(1, done/target)`.
  - `overallProgress(goal: Goal, items: Item[], today: ISODate): { kind: "milestones"; done: number; total: number; ratio: number } | { kind: "evidence"; thisYear: number; monthsInARow: number; streakDays: number }` — `finite` goals use milestones (`ratio` is `0` when `total === 0`); `practice` goals use evidence (`thisYear` = completions in `today`'s year; `monthsInARow` = consecutive months ending at `today`'s month with at least one completion; `streakDays` = consecutive days ending today or yesterday with a completion).

- [ ] **Step 1: Write failing tests:** `"monthly done counts only this month"`; `"task completed 2026-10-31 counts in October, not November"`; `"completion on 2026-12-31 counts in 2026 year total, not 2027"`; `"no target returns null"`; `"target 0 returns null (no NaN)"`; `"ratio caps at 1"`; `"archived items do not count"`; `"finite goal with zero milestones has ratio 0"`; `"practice goal reports thisYear, monthsInARow across a year boundary, streakDays"`.
- [ ] **Step 2: Run** `npx vitest run src/domain/progress.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement both functions** as pure code.
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): goal progress (monthly bar, overall arc)`.

### Task 4: Repository (create, tick, move-to, archive)

**Files:** Create `hub/src/data/repo.ts`; Test `hub/src/data/repo.test.ts`.

**Interfaces:**
- Consumes: `db`, `Item`, `Goal`, `addDays`, `mondayOf`, `isValidISODate`.
- Produces (all `async`, `today: ISODate` always passed in, never read from the clock):
  - `createItem(input: Omit<Item, "id" | "status" | "links" | "createdAt" | "touchedAt"> & { links?: string[] }, today: ISODate): Promise<Item>`
  - `createGoal(input: Omit<Goal, "id" | "createdAt" | "milestones"> & { milestones?: Milestone[] }, today: ISODate): Promise<Goal>` — throws `Error("finite goals need a deadline")` when `kind === "finite"` and `deadline` is missing.
  - `updateItem(id: string, patch: Partial<Item>, today: ISODate): Promise<void>` (sets `touchedAt`)
  - `tickItem(id: string, today: ISODate): Promise<void>` / `untickItem(id: string, today: ISODate): Promise<void>` — idempotent: ticking a done item leaves `completedAt` unchanged.
  - `moveTo(id: string, list: "today" | "tomorrow" | "week", today: ISODate): Promise<void>` — `today` sets `pinnedDate = today`; `tomorrow` sets `pinnedDate = addDays(today, 1)`; `week` clears `pinnedDate` and sets `weekOf = mondayOf(today)`.
  - `removeFromToday(id: string, today: ISODate): Promise<void>` (sets `hiddenOn = today`, clears `pinnedDate`)
  - `archiveItem(id, today)` / `restoreItem(id, today)` (status `archived` ↔ `open`)
  - `listItems(filter?: { areaId?: AreaId; goalId?: string; status?: Item["status"]; kind?: Item["kind"] }): Promise<Item[]>`, `listGoals(): Promise<Goal[]>`, `toggleMilestone(goalId: string, milestoneId: string): Promise<void>`

- [ ] **Step 1: Write failing tests:** `"tick sets done and completedAt; second tick changes nothing"`; `"untick returns to open and clears completedAt"`; `"moveTo today/tomorrow/week set the right fields"` (use `today = "2026-10-27"`, expect `pinnedDate` `"2026-10-28"` for tomorrow and `weekOf` `"2026-10-26"` for week); `"archive hides from default listItems but restore brings it back"`; `"createGoal finite without deadline throws"`; `"listItems filters by area and goal"`; `"toggleMilestone flips done"`.
- [ ] **Step 2: Run** `npx vitest run src/data/repo.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement the module** (UUIDs via `crypto.randomUUID()`; `listItems` excludes `archived` unless `status: "archived"` is requested).
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): repository with tick, move-to, archive`.

### Task 5: Backlog import (idempotent, malformed-safe)

**Files:** Create `hub/src/import/backlog.ts`; Test `hub/src/import/backlog.test.ts`, fixture `hub/src/import/__fixtures__/Backlog.md`.

**Interfaces:**
- Consumes: `Item`, `db`, `isValidISODate`, `todayISO`-style `today` argument.
- Produces:
  - `parseBacklog(markdown: string): { items: ParsedItem[]; skipped: { line: string; reason: string }[] }` where `ParsedItem = { title: string; priority: Priority; due?: ISODate; recur?: Weekday[]; tags: string[]; inbox: boolean; key: string }` and `key = "backlog:" + title lowercased with whitespace collapsed`.
  - `importBacklog(markdown: string, today: ISODate): Promise<{ added: number; alreadyHad: number; skipped: number }>`

Rules (port `src/backlog.py:19-57`): line format `- [ ] text !p1 [due 2026-09-01] [recur: mon,wed] #tag`; only open `- [ ]` lines; sections whose heading contains "parked" or "moved elsewhere" are skipped; default priority 2; tags kept; every imported item gets `areaId: "inbox"` (Esme triages manually in Task 8) with `source: { kind: "backlog", key }`. An item whose `source.key` already exists in the db, in any status, is counted `alreadyHad` and not touched. Invalid due date, empty text or `!p9` → defaulted or reported in `skipped`, never thrown.

- [ ] **Step 1: Write failing tests** using the fixture: `"parses priority, due, recur and tags"`; `"skips parked and moved-elsewhere sections and done lines"`; `"importing twice adds nothing the second time"`; `"re-import does not reopen an item ticked in the app"`; `"re-import does not resurrect an archived item"`; `"[due 2026-13-45] is reported in skipped, item imported without due"`; `"empty text line and unknown !p9 do not throw"`.
- [ ] **Step 2: Run** `npx vitest run src/import` — Expected: FAIL.
- [ ] **Step 3: Implement** `parseBacklog` (regexes as in `backlog.py`) and `importBacklog`.
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): idempotent Backlog.md import`.

### Task 6: App shell, tokens, sidebar

**Files:** Create `hub/src/styles/tokens.css` (CSS variables from `VISUAL-LANGUAGE.md` only; option-3 assignment: page `#e2e8ff`, sidebar `#3a412f`, sidebar item `#51553d`, panel `#e9e3d6`, row `#e3ddcd`, track `#d4d1c3`), `hub/src/ui/AppShell.tsx`, `hub/src/ui/Sidebar.tsx`, `hub/src/ui/areas.ts`, `hub/src/assets/icons/*.svg` (copied from `docs/design/icons/`); Modify `hub/src/App.tsx` (router); Test `hub/src/ui/Sidebar.test.tsx`.

**Interfaces:**
- Produces: `export const NAV: { id: string; label: string; path: string; icon: string; tile: string; group: 1 | 2 | 3 }[]` in `areas.ts` with exactly: home `/`, today `/today`, goals `/goals`, writing `/area/writing`, art `/area/art`, content `/area/content`, mind `/area/mind`, body `/area/body`, journal `/journal`, vision `/vision`. Tile colours are the ones used in the approved round-2 mockup (`#9eb4e6, #e8dd6e, #98c293, #e6aeaf, #a6ced6, #b693ec, #a3d5c2, #e39876, #9285c5, #ecca7d`). `<AppShell>` renders `<Sidebar>` plus an `<Outlet />`.

- [ ] **Step 1: Write failing test:** renders `<Sidebar>` in a `MemoryRouter`; asserts the ten labels in the exact order above, that "Today" links to `/today`, and the active route has `aria-current="page"`.
- [ ] **Step 2: Run** `npx vitest run src/ui/Sidebar.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement shell, tokens, sidebar, router** (routes for pages not built yet render a placeholder `<h1>` with the page name).
- [ ] **Step 4: Run tests and `npm run dev`;** confirm the sidebar matches the round-2 mockup layout (open it beside `docs/design/icons`).
- [ ] **Step 5: Commit** `feat(hub): app shell, tokens, sidebar with approved icons`.

### Task 7: Today view (tick, move-to menu, overdue sticker, celebration placeholder)

**Files:** Create `hub/src/ui/TodayPanel.tsx`, `hub/src/ui/MoveToMenu.tsx`, `hub/src/ui/CelebrationPlaceholder.tsx`, `hub/src/ui/useHubData.ts`; Test `hub/src/ui/TodayPanel.test.tsx`.

**Interfaces:**
- Consumes: `pickToday`, repo functions, `todayISO`, `monthlyProgress` (build `thisMonthDone` for `pickToday` as `{ [goal.id]: monthlyProgress(goal, items, today)?.done ?? 0 }`).
- Produces: `useHubData(today: ISODate): { items: Item[]; goals: Goal[]; refresh: () => Promise<void> }` (reads Dexie, refreshes after each repo call); `<TodayPanel today={ISODate} />`; `<MoveToMenu itemId today onMoved />` offering Today, Tomorrow, This week, Remove from today, Archive. `<CelebrationPlaceholder />` is a magenta box shown for one tick.

- [ ] **Step 1: Write failing tests** (fake data via the repo): `"shows up to 4 picks and an Also due section for the rest"` (seven overdue → 4 + 3); `"overdue item shows an OVERDUE sticker"`; `"ticking calls tickItem and shows the celebration placeholder"`; `"Move to Tomorrow removes it from Today"`; `"empty state shows a calm message, no error"`; `"Archive removes it from Today"`.
- [ ] **Step 2: Run** `npx vitest run src/ui/TodayPanel.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the panel, menu, hook and placeholder.
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): Today view with move-to menu and overdue sticker`.

### Task 8: Quick-add form and Inbox triage

**Files:** Create `hub/src/ui/QuickAdd.tsx`, `hub/src/ui/InboxPage.tsx`, `hub/src/ui/ImportPanel.tsx`; Test `hub/src/ui/QuickAdd.test.tsx`, `hub/src/ui/InboxPage.test.tsx`.

**Interfaces:**
- Consumes: `createItem`, `updateItem`, `importBacklog`, `listGoals`.
- Produces: `<QuickAdd today onAdded />` with fields: title (required), kind (task | idea), area (default `inbox`), goal (optional, filtered to the chosen area), priority (default 2), due, recurring weekdays; ideas hide due and recurring. `<InboxPage />` at `/inbox` (link shown under Home when inbox count > 0) lists inbox items, each with controls to set area, goal, priority, due and then "File it" (calls `updateItem`). `<ImportPanel />` has a file input and a paste box for `Backlog.md`, shows the `{ added, alreadyHad, skipped }` result.

- [ ] **Step 1: Write failing tests:** `"title is required; submit is blocked and a plain message shows"`; `"task with area, goal, priority and due is saved with those fields"`; `"idea hides due and recurring and saves kind idea"`; `"inbox lists imported items and filing one removes it from inbox"`; `"import panel shows added / already had / skipped counts"`.
- [ ] **Step 2: Run** `npx vitest run src/ui` — Expected: FAIL.
- [ ] **Step 3: Implement the form, inbox page and import panel;** QuickAdd opens from a persistent "Add" button in the shell.
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): quick-add form, inbox triage, backlog import UI`.

### Task 9: Goals page and area pages

**Files:** Create `hub/src/ui/GoalsPage.tsx`, `hub/src/ui/GoalDetail.tsx`, `hub/src/ui/AreaPage.tsx`, `hub/src/ui/ProgressBar.tsx`; Test `hub/src/ui/GoalsPage.test.tsx`, `hub/src/ui/AreaPage.test.tsx`.

**Interfaces:**
- Consumes: `monthlyProgress`, `overallProgress`, `listItems`, `listGoals`, `moveTo`, `tickItem`, `toggleMilestone`, `createGoal`.
- Produces: `<ProgressBar ratio={number} label={string} />` (clamps to 0-1); `<GoalsPage />` lists goals with this-month bar and overall arc; `<GoalDetail />` at `/goals/:id` lists attached tasks with the move-to menu and shows "what moves this today / this week / this month" (open attached tasks grouped by pinned/week/other); `<AreaPage />` at `/area/:areaId` with three toggles (To-dos, Ideas, Goals) and an "All" view, plus an Archive list with restore. Goal form requires a deadline for finite goals.

- [ ] **Step 1: Write failing tests:** `"goal without monthly target shows a set-a-target prompt, no NaN"`; `"goal with 6 of 10 shows 60% and label 6/10"`; `"practice goal shows evidence line, finite goal shows milestones bar"`; `"ticking a task on a goal page raises the monthly bar"`; `"area page toggles between to-dos, ideas and goals"`; `"archived item appears in Archive and restore returns it"`; `"finite goal form blocks save without a deadline"`.
- [ ] **Step 2: Run** `npx vitest run src/ui/GoalsPage.test.tsx src/ui/AreaPage.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement the components and routes.**
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(hub): goals page with two-level progress, area pages`.

### Task 10: Home dashboard (layout A, option 3) and first real run

**Files:** Create `hub/src/ui/HomePage.tsx`, `hub/src/ui/JournalCardStub.tsx`; Modify `hub/src/App.tsx`; Test `hub/src/ui/HomePage.test.tsx`; Create `hub/README.md` (how to run, how to import).

**Interfaces:**
- Consumes: `<TodayPanel>`, `monthlyProgress`, `<ProgressBar>`, `useHubData`.
- Produces: `<HomePage />`: centre column Today panel then Journal card; right column "Goals this month" bars with the overall line for each goal. `<JournalCardStub />` shows the two buttons "Morning pages" and "Daily check-in" disabled, with the text "Coming in a later update".

- [ ] **Step 1: Write failing tests:** `"home shows Today picks, the journal card with two disabled buttons, and a bar per goal with a target"`; `"home with no data renders three calm empty states and no console errors"`.
- [ ] **Step 2: Run** `npx vitest run src/ui/HomePage.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement the page.**
- [ ] **Step 4: Run the whole suite and a real pass:** `npx vitest run` (Expected: all PASS), `npm run build` (Expected: succeeds), then `npm run dev`, import the real `~/Desktop/Esme's Brain/Goals & Direction/Backlog.md` through the Import panel, and confirm the count matches the open `- [ ]` lines in that file (`grep -c '^- \[ \]'` on it, minus parked sections).
- [ ] **Step 5: Commit** `feat(hub): home dashboard, journal card stub, README`.

---

## Self-review notes

- **Spec coverage:** Home layout A + A2 card (Task 10), Today picks + cap + overflow + sticky overrides (Tasks 2, 4, 7), move-to everywhere (Tasks 7, 9), quick-add form (Task 8), goal two-level progress (Tasks 3, 9), areas with ideas inside (Task 9), kill = archive (Tasks 4, 9), import + manual triage (Tasks 5, 8), sidebar icons and tokens (Task 6). Deferred to later plans, per the spec's build order: sync/backup/encryption (plan 2), notifications, overdue popups, mole, stale prompts (plan 3), journal, reviews (plan 4), vision board, Google Calendar (plan 5), page-design cycle for goal/journal/quick-add pages (design work, in parallel).
- **Known gaps for Esme to confirm before Task 6:** the Home page is built to the option-3 mockup only; the other pages (goals, areas, quick-add) get a plain version of the same tokens until their design round happens, so they may be restyled later.
