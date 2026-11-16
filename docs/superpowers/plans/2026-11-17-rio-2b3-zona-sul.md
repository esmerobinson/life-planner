# Esme's Rio 2b-3: Zona Sul, coins, selling and buying Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zona Sul's shelves stock themselves from her real errands. She sells the harvest at the COMPRAMOS counter (paid at once) or in a drop box (paid next morning), and buys unlocked ingredients with coins, at fixed prices with no timers.

**Architecture:** Pure maths in `hub/src/rio/zonasul/` turns plan 1's ledger into which ingredient stands in which shelf slot and which stage the shop's base shows. Two repo writers append `sell` and `buy` rows (plan 1's shapes). Each re-checks the balance inside its own transaction and refuses with a named error, so a stale dialog or a double press can never spend what isn't there. The dialogs are kit panels drawn with `BitmapText`, opened from scene hotspots and from keyboard-reachable buttons.

**Tech Stack:** React 18, TypeScript, Dexie, Vitest + Testing Library, Playwright.

**Spec:** `/Users/esme/Documents/coding/esmeworld-notes/rio-design.md` ("Errands stock Zona Sul", "Selling", rulings 3); `art/final/rio-pack/week2/zona-sul/README.md` ("How the shelves fill", "States") and `inside/inside-slots.json`, `outside/outside-slots.json` (`ingredient_slots[]` `{id, x, y, group, accepts, order}`, `hotspots.sell_counter`, `hotspots.drop_box`, `hotspots.tills[]`, `hotspots.door`, outside `novo` slot with `accepts: ["newest"]`); overview `2026-11-17-rio-phase2b-overview.md`; plan 1 `2026-11-17-rio-2b1-ledger.md`.

**Depends on:** plan 1 (`Ledger`, `shelfUnlocked`, `Economy`, `economy`, `canAfford`, `INGREDIENT_BY_KEY`, `SHELF_ORDER`, `DISH_SELL_MULTIPLIER`, `sellRow`, `buyRow`, `FarmView.ledger` / `.economy`); plan 2 (the Pantry section on the Noticeboard tab and `IngredientIcon` in `rio/rewards/pieces.tsx`); plan 4 later supplies `recipeIngredients` (see `dishPrice`); and **rio-areas (phase 2a)**, which adds the `zona-sul/outside` and `zona-sul/inside` scenes to `AREA_SCENES`, `SCENES` and the importer. If 2a already draws the shelves with a stand-in count, Task 2 replaces that input with `fillShelves(shelfUnlocked(ledger), …)` and changes nothing else in 2a's drawing.

## Global Constraints

- Coins come only from selling what real tasks grew or what she cooked. Fish and seafood never sell (`sellable: false`), and neither does anything from the journal, pond or aquarium (ruling 2026-11-04).
- Fixed prices: `Ingredient.sell` and `.buy` from plan 1's catalogue, and `dishPrice` below. No timers, no changing prices, no daily bonus. The drop box's "overnight" is the app's own day change (`todayISO`, `DAY_ENDS_AT_HOUR = 3`), never a countdown on screen.
- Once an ingredient is unlocked it stays on the shelf for good (it comes from banked errands; plan 1).
- Rows are append-only (`sell:<newId()>`, `buy:<newId()>`); no row is ever edited or deleted. Prices are frozen in the row at the moment of sale or purchase.
- Never choose colour, easing, type, composition or timing (repo CLAUDE.md): kit pieces and `INK` colours only; anything the kit lacks (the coin icon, drop-box art) is an obvious placeholder (magenta `var(--placeholder)`, system font). New wording is marked `// PLACEHOLDER WORDING`.
- Desktop only. On a phone the game shows only the Collection (ruling 2026-11-17), so nothing here renders there.
- Every control works by keyboard and screen reader: hotspots are real `<button>`s over the canvas with `aria-label`s; the dialogs are modal (focus in, Esc closes, focus returns); amounts are steppers with `aria-valuenow`.
- Tuning values go in `hub/src/rio/zonasul/tuning.ts`, each line `// DEFAULT: Esme to confirm`.
- Esme's top rule ("never lose answers"): never skip the save and self-test checks. Before pushing, run `npm test`, `npm run build`, `npx playwright test e2e/farm.spec.ts e2e/zona-sul.spec.ts` and `npm run e2e:sync`.
- Work in `.claude/worktrees/rio-2b3` on branch `rio-2b3` (off `rio-2b2`). Push; never merge or deploy.

## Review Focus

1. **Two devices sell the same 3 tomatoes while offline.** After sync both `sell` rows are kept, tomatoes show 0 (never −3), and coins count both sales. **Accepted and noted:** she is paid twice for one crate only in that offline race, and nothing she owns is lost. Overview decision list, item 7 note. (Task 6 two-device test.)
2. **A stale dialog or a double press:** the Sell or Buy dialog was opened with 3 beans and another device used 2 meanwhile, or the button is pressed twice. The repo re-check refuses with `SpendRefused("not-enough")`, nothing is written, the dialog says so and refreshes. (Task 3 tests.)
3. **A drop-box sale at 23:59, then 01:00, then 03:01:** the coins aren't spendable until the app's day changes at 3am. Until then they show as "+N tomorrow". (Task 3 and 5 tests.)
4. **More unlocked fruit and veg than fruit and veg crates** (24 against 8 crates and 7 `any` slots): the README rule first, then any free slot, so all 45 always show. An ingredient that still has no slot is buyable from the list. (Task 1 test.)
5. **Errands ticked before Zona Sul opens (day 10):** on opening day the shelves are already stocked with all of them at once. No burst of pop-ups; the NOVO table shows the newest. (Task 1 and Task 6 e2e tests.)

---

### Task 1: Shelf maths

**Files:**
- Create: `hub/src/rio/zonasul/shelves.ts`, `hub/src/rio/zonasul/tuning.ts`
- Test: `hub/src/rio/zonasul/shelves.test.ts`

**Interfaces:**
- Consumes: `INGREDIENT_BY_KEY`, `IngredientCategory` (plan 1); the slot JSON shapes above.
- Produces:
  - `type ShelfCategory = "fruit" | "veg" | "pantry" | "cold" | "bakery" | "drink"`.
  - `interface ShelfSlot { id: string; x: number; y: number; group: string; accepts: string[]; order: number }`.
  - `shelfCategory(key: string): ShelfCategory`. The plan-1 category, with `animal` → `cold`, `sea` → `cold` and `rare` → `pantry` (egg and cheese go in the fridges as the pack drew them).
  - `fillShelves(unlocked: readonly string[], slots: readonly ShelfSlot[], categoryOf: (k: string) => ShelfCategory = shelfCategory): Map<string, string>` (slot id → ingredient key). Ingredients go in `unlocked` order. Each takes the free slot with the lowest `order` whose `accepts` has its category; else the lowest free slot accepting `"any"`; else (DEFAULT, beyond the README) the lowest free slot of all. A `"newest"` slot holds the last unlocked key and takes nothing else. Fruit and veg slots outside are filled independently with the unlocked fruit and veg, in order.
  - `zonaSulStage(adminTodos: number, scene: "inside" | "outside"): "start" | "mid" | "full"`, with `STAGE_AT = { inside: { mid: 10, full: 25 }, outside: { full: 25 } }` (DEFAULT) and `adminTodos(l: Ledger): number` (ledger entries of kind `todo` with `area === "admin"`).
- [ ] **Step 1: Failing tests:**
  - `fillShelves(["beans"], slots)` puts beans in the pantry slot with the lowest order (`wall-1-7`, order 1).
  - `"egg"` lands in a `cold` slot.
  - All 45 of `SHELF_ORDER` against the real inside slots: 45 distinct slots and every key placed.
  - 24 fruit and veg keys: 8 in fruit/veg crates, then `any` slots, then others, all placed.
  - Outside: `novo` holds the last key, and the 6 stand crates hold the first 6 fruit/veg keys.
  - `fillShelves([], …)` is empty.
  - The same input gives the same map (pure).
  - `zonaSulStage(0,"inside") === "start"`, `(10,"inside") === "mid"`, `(25,"inside") === "full"`, `(24,"outside") === "start"`.
- [ ] **Step 2:** Run `npx vitest run src/rio/zonasul` → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio Zona Sul: which ingredient stands on which shelf".

### Task 2: The stocked shop

**Files:**
- Modify: `hub/src/rio/AreaView.tsx` (Zona Sul scenes only), `hub/src/rio/assets.ts` (read `ingredient_slots` and `hotspots` from the Zona Sul slots files, if 2a doesn't already)
- Test: `hub/src/rio/zonasul/ZonaSulScene.test.tsx`

**Interfaces:**
- Consumes: `fillShelves`, `zonaSulStage`, `adminTodos` (Task 1); `shelfUnlocked`, `useFarm().ledger` (plan 1); `INGREDIENT_BY_KEY[k].icon`.
- Produces: `SceneData` gains `ingredientSlots?: ShelfSlot[]` and `hotspots?: Record<string, { x: number; y: number; w: number; h: number } | { n: number; x: number; y: number; w: number; h: number }[]>`. For `zona-sul/*`, `AreaView` draws the base for `zonaSulStage(adminTodos(ledger), …)` instead of `sceneState`, and then each filled slot's icon at `(x - 8, y - 15)`, sorted by y then x (the pack's `fill_rule`). An icon with no art is drawn as the 16×16 magenta placeholder.
- [ ] **Step 1: Failing tests** (RTL, canvas mocked as in `AreaView.test.tsx`):
  - With a ledger of 3 errands, the inside scene asks to draw 3 icons, at the slots `fillShelves` chose.
  - With 0 Admin to-dos the base is the `start` file; with 25 it is `full`.
  - Other areas still use `sceneState` (the fazenda test unchanged).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS plus `npx vitest run src/rio`.
- [ ] **Step 5: Commit** "Rio Zona Sul: the shelves show what her errands unlocked".

### Task 3: Selling and buying, safely

**Files:**
- Create: `hub/src/rio/zonasul/prices.ts`
- Modify: `hub/src/farm/farmRepo.ts`
- Test: `hub/src/rio/zonasul/prices.test.ts`, `hub/src/farm/spendRepo.test.ts`

**Interfaces:**
- Consumes: `economy`, `canAfford`, `Ledger`, `sellRow`, `buyRow`, `farmState`, `shelfUnlocked`, `newId` (plan 1).
- Produces:
  - `dishPrice(dish: string, ingredientsOf: (dish: string) => Readonly<Record<string, number>> | null): number | null`. It returns `DISH_SELL_MULTIPLIER × Σ n × sell` over the recipe's ingredients. A variation `<dish>~<ing>` is priced as `<dish>`, and an unknown recipe returns `null`. This is the only dish price in 2b: plan 4 passes its `recipeIngredients(dish)` (`rio/kitchen/recipes.ts`) and adds no price function of its own. Until plan 4, callers pass `() => null`, so no dish is listed.
  - `saleCoins(items: Readonly<Record<string, number>>, ingredientsOf): number` (throws `SpendRefused("not-sellable")` for a key that isn't sellable or has no price).
  - `class SpendRefused extends Error { constructor(readonly reason: "not-enough" | "not-enough-coins" | "not-sellable" | "not-unlocked" | "not-open") }`.
  - `farmRepo.sell(items: Record<string, number>, via: "dropbox" | "counter", today: ISODate, ledger: Ledger, ingredientsOf): Promise<number>` (the coins). In one `rw` transaction on `db.farm` it re-reads all farm rows, computes `economy(ledger, farmState(rows), today)`, and refuses `not-enough` if any amount is more than `have` or `dishes` allow. Then it puts `sellRow(newId(), today, via, items, coins)`.
  - `farmRepo.buy(ingredient: string, n: number, today: ISODate, ledger: Ledger): Promise<void>`. `n` is from 1 to 9 (`BUY_MAX = 9`, DEFAULT). Same re-check; it refuses `not-unlocked` unless `shelfUnlocked(ledger)` includes it, and `not-enough-coins` unless `coins >= buy × n`. It puts `buyRow(newId(), today, buy × n, { ingredient, n })`.
  - **The pattern plan 5 copies:** `farmRepo.buyPiece(piece: string, coins: number, today: ISODate, ledger: Ledger): Promise<void>`. It has the same transaction and re-check and writes `buyRow(newId(), today, coins, { piece })`. Plan 5 adds it; its checks are plan 5's.
- [ ] **Step 1: Failing tests:**
  - `dishPrice("x", () => ({ beans: 2, rice: 1 }))` = 2 × (2 × beans.sell + rice.sell).
  - `dishPrice("x~garlic", same)` is equal; `dishPrice("y", () => null) === null`.
  - Selling 2 of 3 beans at the counter writes one `sell` row with `coins === 2 * beans.sell`, and `have.beans` is 1 after.
  - Selling 4 of 3 → `SpendRefused("not-enough")`, no row.
  - Selling fish → `not-sellable`.
  - Two `sell` calls in parallel for 3 of 3 beans → exactly one succeeds and the other refuses (the transaction re-check).
  - A dropbox sale dated D → `coins` unchanged on D and raised on D+1; `coinsTomorrow` shows it on D.
  - Buying 2 beans with enough coins → +2 beans, coins −2×buy.
  - With 1 coin short → `not-enough-coins`, no row.
  - Buying a key not yet unlocked → `not-unlocked`.
  - `n = 0` or `10` → throws.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio Zona Sul: sell and buy rows, re-checked so nothing is overspent".

### Task 4: The Sell dialog, the counter and the drop boxes

**Files:**
- Create: `hub/src/rio/zonasul/SellDialog.tsx`, `hub/src/rio/zonasul/hotspots.ts`
- Modify: `hub/src/rio/AreaView.tsx`
- Test: `hub/src/rio/zonasul/SellDialog.test.tsx`

**Interfaces:**
- Consumes: `farmRepo.sell`, `SpendRefused`, `saleCoins`, `dishPrice` (Task 3); `useFarm().economy` / `.ledger`; `IngredientIcon` (plan 2); kit `panel`, `slot`, `btn-text`, `btn-close` pieces and `BitmapText`.
- Produces:
  - `<SellDialog via: "dropbox" | "counter" onClose />`. It shows one row per sellable thing she has (a key in `economy.have` with `sellable`, and a key in `economy.dishes` with a non-null `dishPrice`): icon, name, a stepper from 0 to have, the fixed price each. Below that are the total and Sell. Sell is disabled at a total of 0 and while saving. The counter says "paid now" and the drop box "paid tomorrow morning" (PLACEHOLDER WORDING). A `SpendRefused` shows a line and the list re-reads.
  - `SELL_SPOTS: Record<SceneId, { via: "dropbox" | "counter"; rect: [number, number, number, number] }[]>`. `zona-sul/inside` has the counter from `hotspots.sell_counter` and the drop box from `hotspots.drop_box` (`dropbox`). `fazenda/outside` (the gate) and `lagoa-house/kitchen` (the kitchen door) get placeholder rects, marked `// ART NEEDED: drop-box slot` in the code. Each spot is a `<button aria-label>` over the canvas and appears only from Zona Sul's opening day (10).
- [ ] **Step 1: Failing tests:**
  - Opening the counter lists beans ×3 and tomato ×2 but not fish.
  - Stepping beans to 2 shows the total `2 × sell`; Sell calls `sell({beans: 2}, "counter", …)` once, even on a double click.
  - A refusal shows the message and leaves the dialog open.
  - Esc closes and focus returns to the hotspot button.
  - Before day 10 there's no drop-box button at the fazenda gate.
  - With nothing to sell, the dialog says so (PLACEHOLDER WORDING) and Sell is disabled.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio Zona Sul: sell at the counter or in a drop box".

### Task 5: Buying and the coin count

**Files:**
- Create: `hub/src/rio/zonasul/BuyDialog.tsx`, `hub/src/rio/CoinCount.tsx`
- Modify: `hub/src/rio/AreaView.tsx`, `hub/src/rio/GameScreen.tsx`, plan 2's Pantry section (`hub/src/rio/menu/NoticeboardTab.tsx`)
- Test: `hub/src/rio/zonasul/BuyDialog.test.tsx`, `hub/src/rio/CoinCount.test.tsx`

**Interfaces:**
- Consumes: `farmRepo.buy`, `SpendRefused` (Task 3); `fillShelves` slot map (Task 2); `economy.coins` / `coinsTomorrow`.
- Produces:
  - `<BuyDialog ingredient? onClose />`. With an ingredient: name, icon, a 1–9 stepper, the price `buy × n`, and Buy (disabled when coins are short or while saving). Without one, a list of every unlocked ingredient to choose from, which is the keyboard path to the till.
  - Each stocked shelf slot, inside only, is a `<button aria-label="<name>, <price> coins">` that opens `BuyDialog` for its ingredient; `hotspots.tills[]` open it with no ingredient.
  - `<CoinCount />`: kit inset, coin icon (`// ART NEEDED: coin icon`, placeholder magenta 8×8), `BitmapText` of `economy.coins`, and "+N tomorrow" when `coinsTomorrow > 0`. Shown on `GameScreen` from Zona Sul's opening day, and in the Noticeboard's Pantry section.
- [ ] **Step 1: Failing tests:**
  - Buy 3 rice with enough coins calls `buy("rice", 3, …)` once.
  - With coins short, Buy is disabled and the price line shows what's missing (PLACEHOLDER WORDING).
  - The till with no ingredient lists only unlocked keys.
  - `CoinCount` with `{coins: 12, coinsTomorrow: 4}` reads "12" and "+4 tomorrow" to a screen reader.
  - Before day 10 `CoinCount` isn't rendered.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS plus `npx vitest run src/rio`.
- [ ] **Step 5: Commit** "Rio Zona Sul: buy unlocked ingredients; the coin count".

### Task 6: Self-tests

**Files:**
- Test: `hub/src/sync/zonaSul.test.ts`, `hub/src/farm/backupZonaSul.test.ts`, `hub/e2e/zona-sul.spec.ts`

**Interfaces:**
- Consumes: `FakeSyncServer`, `syncOnce`, `saveSyncSettings` (as `sync/farm.test.ts`); `exportBackup`, `parseBackup`, `restoreBackup`; plan 2's Pantry test ids (`data-testid="pantry-count-<key>"`).
- [ ] **Step 1: Failing tests:**
  - **Two devices:**
    - With the same 3 tomatoes banked, A sells 3 at the counter and B sells 3 in the drop box, both offline. After both sync, each has both `sell` rows, tomatoes absent (0) and coins = A's sale now plus B's sale from the next day (accepted and noted).
    - A buys 2 rice; after sync B shows the same rice count and coins.
  - **Backup:**
    - Export carries `sell` and `buy` rows. A replace-restore of a backup taken before a sale brings the tomatoes back and removes those coins.
    - A merge onto a device with its own later `buy` keeps both.
    - A file with a `sell` whose `via` is `"post"` → `INVALID_BACKUP`.
  - **e2e** (clock on day 12 of a seeded farm, 4 errands ticked on days 2–9, a banked harvest of tomatoes):
    - Open Zona Sul; 4 stocked slots are drawn (`data-stocked="4"` on the scene) and the NOVO table shows the 4th.
    - Sell 2 tomatoes at the counter; the coin count rises by `2 × sell`.
    - Drop 1 in the box; "+N tomorrow" shows. Advance the clock past 3am; the coins are added.
    - The whole flow works by keyboard alone.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Fix what they find (no new features). **Step 4:** Run `npm test`, `npm run build`, `npx playwright test e2e/farm.spec.ts e2e/zona-sul.spec.ts`, `npm run e2e:sync` → all PASS.
- [ ] **Step 5: Commit** "Rio Zona Sul: self-tests across devices, backups and restores", then push `rio-2b3`.
