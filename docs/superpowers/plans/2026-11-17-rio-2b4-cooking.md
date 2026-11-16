# Esme's Rio 2b-4: recipes, tools, techniques and cooking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real things done teach her recipes ("Inspired at <restaurant>"), finished days unlock kitchen tools, habits unlock techniques, and she cooks in the Lagoa house kitchen with the ingredients her tasks grew. Experiments give variations, and nonsense gives a gororoba. A pinned dish shows on Today how many to-dos away it is.

**Architecture:** Pure modules in `hub/src/rio/kitchen/` hold the recipe catalogue (one recipe per drawn dish sticker), the derived tools and techniques, the recipe pace and choice, `cookResult` and `waysToGet`. Stored state is plan 1's rows only: `recipe:<dish>`, written when the inspired card plays; `cook:<uuid>`, append-only; and `pin:dish`, last write wins. What she has always comes from `FarmView.economy`. Screens are kit-style React components over the game (`rio/menu/`, `rio/kitchen/`). The pinned line on Home reads the same `FarmView`.

**Tech Stack:** React 18, TypeScript, Vite (`import.meta.glob`), Dexie, Vitest + Testing Library, Playwright.

**Spec:** `/Users/esme/Documents/coding/esmeworld-notes/rio-design.md` ("Cooking", "Cooking runs on real tasks", "300+ recipes", "Screens"); overview `docs/superpowers/plans/2026-11-17-rio-phase2b-overview.md` (decisions 4, 6 and 9); plan 1 `2026-11-17-rio-2b1-ledger.md` (rows, `Ledger`, `Economy`); art `art/final/rio-pack/cooking/README.md` and `manifest.json`, `day1/ui/README.md` (inspired card, pinned-dish line).

## Global Constraints

- Cooking earns nothing and opens nothing. It only uses up ingredients (never stickers, tools or recipes). Recipes come only from real things done (ruling 2026-11-14).
- Nothing is lost:
  - a `recipe` row, once written, is hers for good;
  - a recipe owed but not yet shown waits; it is never dropped or replaced by a placeholder;
  - only dishes with drawn art are ever taught.
- Rows: only plan 1's `recipe`, `cook` and `pin` kinds through plan 1's builders. `cook` ids come from `newId()`. No other row kind or table.
- "Have" is always `FarmView.economy.have`. The repo re-checks amounts inside its write transaction, never trusting the screen.
- Never choose colour, easing, type, composition or timing (repo CLAUDE.md):
  - animation timing comes from each `cook-*.json` (`fps_hint`, `hold_last_ms`);
  - anything the art lacks is a magenta placeholder in the system font, with linear easing;
  - new wording is marked `// PLACEHOLDER WORDING`;
  - game text goes through `BitmapText`.
- Reduced motion (`useReducedMotion`): no cooking animation; straight to the reveal card.
- Phone (Esme, 2026-11-17: "no game on phone other than stickers collected UI"): the cooking screen, the Recipes tab and the inspired card are game-only. The pinned dish line is desktop only. On a phone, learned dishes show only in the Collection.
- Every tuning value is in `hub/src/rio/kitchen/tuning.ts`, marked `// DEFAULT: Esme to confirm`.
- Esme's top rule ("never lose answers"): never skip the save and self-test checks. Before pushing, run `npm test`, `npm run build`, the farm, pwa and phone e2e specs, and `npm run e2e:sync`.
- Work in `.claude/worktrees/rio-2b4` on branch `rio-2b4` (off `rio-2b3`). Push; never merge or deploy.
- Art only from final pack folders (`art/final/rio-pack/**`), never `previews/`, `options/` (the kitchen concept is reference only) or `_scratch/`.

## Review Focus

1. **Two devices both play the inspired card for the same owed recipe:** both write `recipe:<same dish>` (one row). She gets one recipe, not two, and the next one owed is still the next in order. (Task 4 test; Task 10 two-device test.)
2. **Cooking with ingredients another device already used** (the screen is stale): `cook` refuses inside its transaction, writes nothing, and the screen says what's short. A double press writes one row. (Task 7 tests.)
3. **A learned recipe whose tool or technique isn't unlocked yet:** Cook is disabled with the reason ("Needs the blender: 2 more finished days"). Her ingredients are never spent on a guaranteed gororoba. (Task 6 and Task 7 tests.)
4. **Recipes owed but none eligible** (every drawn dish for the open restaurants already learned): the owed count waits and the bar shows "a new recipe is on its way". When art or a restaurant arrives, the next one plays, and nothing is skipped. (Task 4 test.)
5. **The pinned dish is unknown or no longer learned** (a later pack's dish, or a replace-restore removed its `recipe` row): the line on Today hides, and Recipes shows nothing pinned. Nothing throws. (Task 9 test.)

---

### Task 1: Bring in the dishes and the cooking art

**Files:**
- Create: `hub/scripts/import-rio-kitchen.mjs`, `hub/src/assets/rio/dishes/**`, `hub/src/assets/rio/cooking/**` (copied), `hub/src/rio/kitchen/dishes.ts`, `hub/src/rio/kitchen/cookingArt.ts`
- Test: `hub/src/rio/kitchen/dishes.test.ts`

**Interfaces:**
- Produces:
  - `interface Dish { key: string; name: string; set: string; place: string; url: string; diecut: string; ghost: string }`; `DISHES: readonly Dish[]`; `DISH_BY_KEY: ReadonlyMap<string, Dish>`; `hasDishArt(key: string): boolean`.
  - `type Technique = "frying" | "baking" | "blending" | "dough" | "grilling" | "mixing-drinks" | "slow-cooking"`.
  - `COOKING: Record<Technique | "gororoba", { strip: string /* "" until drawn */; station: string; frame: [number, number]; frames: number; fpsHint: number; holdLastMs: number }>`; `STAGE_BACKDROP: string`; `REVEAL_CARD: { url: string; regions: Record<string, unknown> }`; `GOROROBA_STICKER: { url: string; diecut: string }`.
- [ ] **Step 1:** Write `import-rio-kitchen.mjs <rio-pack dir>`. It merges dish manifests from:
  - `day1/stickers/manifest.json` (family `dishes`, 30);
  - `day1/ui` (cacio e pepe, set `sult`);
  - `later/quilo/dishes/dishes.json` (12);
  - `later/sult/dishes/dishes.json` (13);
  - `later/os-esquilos/dishes/dishes-countryside.json` (12);
  - `dishes-batch2/manifest.json` (44).

  It copies each dish's file, diecut and ghost to `src/assets/rio/dishes/`, and writes `src/assets/rio/dishes/dishes.json` (`key, name, set, place`). It copies `cooking/*.png`, `cooking/*.json` and the manifest (not `previews/`) to `src/assets/rio/cooking/`, then prints the counts. Run it on `/Users/esme/Documents/coding/esmeworld-notes/art/final/rio-pack`.
- [ ] **Step 2: Failing tests:**
  - `DISHES.length === 112`, with every key unique and starting `dishes-`.
  - Every dish has non-empty `url`, `diecut` and `ghost`.
  - `COOKING.frying.frames === 12` and `COOKING.frying.fpsHint === 8` (read from `cook-frying.json`, never typed in).
  - `COOKING["slow-cooking"].strip === ""` (not drawn: the placeholder).
  - `GOROROBA_STICKER.url` is non-empty.
  - Nothing from `previews/` was copied.
- [ ] **Step 3:** Run `npx vitest run src/rio/kitchen/dishes.test.ts` → FAIL. **Step 4:** Implement (glob as `rio/assets.ts`). **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** "Rio 2b: bring in the dishes and the cooking art".

### Task 2: The recipe catalogue

**Files:**
- Create: `hub/src/rio/kitchen/tuning.ts`, `hub/src/rio/kitchen/recipeData.ts`, `hub/src/rio/kitchen/recipes.ts`
- Test: `hub/src/rio/kitchen/recipes.test.ts`

**Interfaces:**
- Consumes: `INGREDIENT_BY_KEY` (plan 1); `DISH_BY_KEY`, `Technique` (Task 1).
- Produces:
  - `type Restaurant = "home" | "fazenda" | "quilo" | "boteco" | "barraca" | "sult" | "os-esquilos" | "copacabana-palace" | "holiday"`.
  - `interface Recipe { dish: string; name: string; from: Restaurant; order: number; ingredients: Readonly<Record<string, number>>; technique: Technique; tool: string | null; holiday?: string }`.
  - `RECIPES: readonly Recipe[]` (by `order`); `RECIPE_BY_DISH: ReadonlyMap<string, Recipe>`; `recipeIngredients(dish: string): Readonly<Record<string, number>> | null` (a variation `<dish>~<ing>` → its base dish's; `gororoba` or unknown → null; plan 3's `dishPrice` takes it); `RESTAURANT_PLACE: Record<Restaurant, string | null>` (map place key, or null for `home`, `fazenda` and `holiday`); `RESTAURANT_NAME: Record<Restaurant, string>` (`// PLACEHOLDER WORDING`).
  - From `tuning.ts`:
    - `TOOLS: readonly { key: string; name: string; at: number }[]`: pan 0, pot 0, knife 0, blender 3, pressure-cooker 6, oven 10, grill 15, cocktail-shaker 21, wood-oven 30, ice-cream-maker 45, counted in finished days;
    - `TECHNIQUES: readonly { key: Technique; name: string; at: number }[]`: frying 0, blending 0, baking 10, slow-cooking 25, grilling 45, dough 70, mixing-drinks 100, counted in habit sessions;
    - `STARTER_RECIPES = 3`; `STARTER_FROM: Restaurant = "home"`.

    All `// DEFAULT: Esme to confirm`. The techniques follow the drawn animations (`cooking/`), plus slow cooking for stews (not drawn yet: ART NEEDED).
- [ ] **Step 1: Failing tests:**
  - One recipe per drawn dish: the set of `dish` keys equals the set of `DISHES` keys, so all 112 are taught and none lacks art.
  - Every recipe has 1–5 distinct ingredient keys that exist in `INGREDIENT_BY_KEY`, with whole counts from 1 to 9.
  - Every `technique` is in `TECHNIQUES` and every non-null `tool` in `TOOLS`.
  - `order` values are unique; `from` is valid; `holiday` is set only when `from === "holiday"`.
  - At least `STARTER_RECIPES` recipes have `from: "home"` and use only `technique` and `tool` unlocked at 0.
  - No two recipes have the same ingredient-key set and technique (so `cookResult` is unambiguous).
  - Signature dishes come after the everyday ones: `dishes-feijoada` and `dishes-moqueca` order above every `morning table` dish.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Author `recipeData.ts`, one line per dish. `from` follows each pack's `place` and `set`:
  - day1 `morning table` → home; `the plate` → quilo; boteco bites and drinks → boteco; beach snacks → barraca; festa → home; signature plates → quilo;
  - batch2 `Home` / `Barraca` / `Boteco` / `Copacabana Palace` → that restaurant;
  - Quilo, Sult and Os Esquilos → their own.

  Ingredients are drawn from the 50-ingredient catalogue with real cooking sense (feijoada: beans, linguica, carne-seca, farinha, couve, slow-cooking, pressure-cooker; caipirinha: lime, cachaca, acucar, mixing-drinks, cocktail-shaker). The file header says `// PLACEHOLDER WORDING AND PAIRINGS: Esme to confirm`. `order` goes simple first and signature last, 10 apart so later batches slot in.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio 2b: a recipe for every drawn dish".

### Task 3: Kitchen tools and techniques (derived)

**Files:**
- Create: `hub/src/rio/kitchen/unlocks.ts`
- Test: `hub/src/rio/kitchen/unlocks.test.ts`

**Interfaces:**
- Consumes: `Counters` (`farm/earning.ts`: `"today-finished"`, `"habit-sessions"`); `TOOLS`, `TECHNIQUES` (Task 2).
- Produces: `toolsUnlocked(c: Counters | null): ReadonlySet<string>`; `techniquesUnlocked(c: Counters | null): ReadonlySet<Technique>`; `untilTool(key: string, c: Counters | null): number` (finished days still to go, 0 if unlocked); `untilTechnique(key: Technique, c: Counters | null): number` (habit sessions to go).
- [ ] **Step 1: Failing tests:**
  - `null` counters → only the `at: 0` entries.
  - `today-finished` 3 → blender in, pressure-cooker not, `untilTool("pressure-cooker") === 3`.
  - `habit-sessions` 25 → slow-cooking in.
  - `today-finished` comes from `today:` rows, which are never removed, so a tool once unlocked stays (pinned by a test that removes nothing and re-derives).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio 2b: kitchen tools from finished days, techniques from habits".

### Task 4: How many recipes she's owed, and which comes next

**Files:**
- Create: `hub/src/rio/kitchen/pace.ts`
- Modify: `hub/src/farm/farmRepo.ts`, `hub/src/farm/FarmContext.tsx`
- Test: `hub/src/rio/kitchen/pace.test.ts`, `hub/src/farm/recipeRepo.test.ts`

**Interfaces:**
- Consumes: `Ledger`, `thingsSince` (plan 1); `paceStart(start: ISODate, place: string): ISODate | null` and `RECIPE_EVERY` (plan 2); `opensOn`, `farmDay` (phase 1); `recipeRow`, `FarmState.recipes`; `hasDishArt`.
- Produces:
  - `cookingOpens(start: ISODate | null): ISODate | null` (= `paceStart(start, "quilo")`).
  - `recipesOwed(l: Ledger, start: ISODate | null, learned: number, today: ISODate): number`: before cooking opens, 0. After, `STARTER_RECIPES + floor(thingsSince(l, opens) / RECIPE_EVERY) − learned`, floored at 0.
  - `nextRecipeProgress(l: Ledger, start: ISODate | null, today: ISODate): { done: number; of: number } | null` (null before cooking opens; e.g. `{ done: 6, of: 8 }`).
  - `interface PaceCtx { day: number; gainedEver: ReadonlySet<string>; holidayToday: string | null }`.
  - `eligible(r: Recipe, learned: ReadonlySet<string>, ctx: PaceCtx): boolean`. True when all of these hold:
    - the dish has art and isn't learned;
    - its place is open (`opensOn(RESTAURANT_PLACE[from]) <= day`), or `from` is `home` or `fazenda`;
    - for `fazenda`, every ingredient is in `gainedEver`;
    - for `holiday`, `ctx.holidayToday === r.holiday`.
  - `nextRecipes(n: number, learned: ReadonlySet<string>, ctx: PaceCtx): Recipe[]` (the lowest `order` first; the first `STARTER_RECIPES` are taken from `STARTER_FROM` only).
  - `farmRepo.markLearned(dish: string, from: Restaurant, today: ISODate): Promise<void>` (no-op if the row exists or the dish is unknown).
  - `FarmView` gains `recipeQueue: readonly Recipe[]` (`nextRecipes(recipesOwed(...), ...)`, empty on the Journal pages, as `momentQueue`) and `markLearned: (r: Recipe) => Promise<void>`.
- [ ] **Step 1: Failing tests:**
  - Day 29 → owed 0. On the opening day → owed 3, all `home`.
  - 16 things since the opening with 3 learned → owed 2.
  - Things before the opening don't count.
  - An Os Esquilos recipe isn't eligible on day 100 (opens 165).
  - A fazenda recipe waits until its ingredients were ever gained.
  - A holiday recipe waits with `holidayToday: null`.
  - With owed 2 but one eligible recipe, `nextRecipes` returns 1. Learning it leaves owed 1, so the next eligible one plays later.
  - The same inputs give the same list on every call (both devices choose alike).
  - `markLearned` twice writes one row and keeps the first date.
  - `nextRecipeProgress` at 14 things is `{ done: 6, of: 8 }`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. `holidayToday` comes from rio-areas' holiday calendar if it exports one (`rio/events.ts` `holidayOn(date)`), else always null; say which in the commit. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio 2b: recipes owed by real things done, chosen in a designed order".

### Task 5: The inspired card, and dishes in the Collection

**Files:**
- Create: `hub/src/rio/kitchen/InspiredCard.tsx`
- Modify: `hub/src/rio/GameScreen.tsx` (or where plan 2 plays earned moments), `hub/src/rio/collection.ts`
- Test: `hub/src/rio/kitchen/InspiredCard.test.tsx`, `hub/src/rio/collection.test.ts`

**Interfaces:**
- Consumes: `FarmView.recipeQueue`, `markLearned` (Task 4); `REVEAL_CARD`/inspired-card template regions (`day1/ui/manifest.json`: `title_scroll`, `box_inner`, `name_text`, `sub_text`, `ok_button`); `BitmapText`, `kitUrl`; plan 2's Collection area list.
- Produces:
  - `<InspiredCard recipe onDone />`: the title "Inspired at <restaurant>", the die-cut dish at 3× in `box_inner`, the name, "Added to your recipe book" (`// PLACEHOLDER WORDING`), and OK. OK calls `markLearned`, then `onDone`. The card plays one at a time, only on the game page, after any sticker moment that is showing.
  - `COLLECTION_AREAS` gains `{ key: "dishes", name: "Dishes", ... }` with one page per restaurant. A dish cell is `ready` when `state.recipes.has(key)`, else `ghost`. Dishes are never "placed" in 2b. The phone Collection shows them.
- [ ] **Step 1: Failing tests:**
  - With one recipe queued, the card shows its name and restaurant; OK writes `recipe:<dish>` and the queue empties.
  - With two queued, the second shows after the first's OK.
  - On `/journal` the queue is empty.
  - The Collection's Dishes area lists all 112 dishes; a learned one is `ready` and the rest `ghost`.
  - Dish stickers don't change `collected` (the 175) or friend arrivals.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio 2b: the inspired card, and learned dishes in the Collection".

### Task 6: What cooking makes (pure)

**Files:**
- Create: `hub/src/rio/kitchen/cook.ts`
- Test: `hub/src/rio/kitchen/cook.test.ts`

**Interfaces:**
- Consumes: `RECIPES`, `INGREDIENT_BY_KEY`.
- Produces:
  - `type CookOutcome = { result: string; kind: "dish" | "variation" | "gororoba"; hint?: "needs-tool" | "needs-technique" | "not-learned" }`.
  - `cookResult(selection: Readonly<Record<string, number>>, technique: Technique, learned: ReadonlySet<string>, tools: ReadonlySet<string>): CookOutcome`. Rules:
    - The ingredient-key set and technique exactly match a learned recipe whose tool is unlocked (counts ignored) → `{ result: dish, kind: "dish" }`.
    - Otherwise, the same number of keys as a learned recipe with the same technique and exactly one key swapped for another of the same `category` → `{ result: "<dish>~<newKey>", kind: "variation" }`. The lowest `order` wins if several match.
    - Otherwise `"gororoba"`, with a hint: `"not-learned"` when it exactly matches an unlearned recipe, `"needs-tool"` when it matches a learned one whose tool is locked.
  - `matchLearned(selection, learned): Recipe | null` (the screen uses it to disable Cook for a locked-tool learned match).
  - `variationName(result: string): string` ("<dish name> with <ingredient name>", `// PLACEHOLDER WORDING`).
- [ ] **Step 1: Failing tests:**
  - Caipirinha's exact keys + `mixing-drinks` + shaker → dish.
  - Lime swapped for maracuja (both fruit) → `dishes-caipirinha~maracuja`, variation.
  - Lime swapped for beans → gororoba.
  - Caipirinha's keys with `frying` → gororoba.
  - An unlearned exact match → gororoba with `not-learned`.
  - A learned match without the shaker → gororoba with `needs-tool`, and `matchLearned` finds it.
  - Counts don't change the result.
  - An empty selection → gororoba.
  - A selection of six keys → throws (the screen allows at most five).
  - Every `result` matches plan 1's `RESULT` pattern.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio 2b: cooking results: dishes, variations and gororoba".

### Task 7: Cooking: the write and the screen

**Files:**
- Create: `hub/src/rio/kitchen/CookingScreen.tsx`, `hub/src/rio/kitchen/CookAnimation.tsx`, `hub/src/rio/kitchen/kitchen.css`
- Modify: `hub/src/farm/farmRepo.ts`, `hub/src/farm/FarmContext.tsx`, `hub/src/rio/AreaView.tsx`
- Test: `hub/src/farm/cookRepo.test.ts`, `hub/src/rio/kitchen/CookingScreen.test.tsx`

**Interfaces:**
- Consumes: `cookRow`, `FarmState.cooks`, `economy` (plan 1); `cookResult`, `matchLearned` (Task 6); `toolsUnlocked`, `techniquesUnlocked`, `untilTool` (Task 3); `COOKING`, `STAGE_BACKDROP`, `REVEAL_CARD`, `GOROROBA_STICKER` (Task 1); `useReducedMotion`.
- Produces:
  - `farmRepo.cook(used: Record<string, number>, technique: Technique, tool: string | null, result: string, today: ISODate): Promise<{ ok: true; id: string } | { ok: false; short: Record<string, number> }>`. In one `rw` transaction on `db.farm` it re-reads every farm row, recomputes `economy` (using the same ledger, passed in by `FarmView.cook`), refuses with the shortfall if any amount exceeds what she has, and otherwise puts `cook:<newId()>`.
  - `FarmView.cook(selection, technique): Promise<CookOutcome & { ok: boolean; short?: Record<string, number> }>`.
  - `<CookingScreen onClose />`: a kit dialog (focus moves in; Esc closes; focus returns). It has:
    - her ingredients (`economy.have`, icons via plan 1, magenta when `hasIcon` is false), to pick up to 5 keys with counts;
    - one station per unlocked technique (`station-*.png`; locked ones as ghosts saying "after N habit sessions");
    - "Use a recipe" quick-fill from learned recipes;
    - Cook. Disabled when nothing is picked, or when `matchLearned` finds a learned recipe whose tool or technique is locked (the reason is shown). An experiment (no learned exact match) first asks "Try it? This uses up what you picked." (`// PLACEHOLDER WORDING`).
    - After a successful cook, `<CookAnimation technique>` plays the strip over `STAGE_BACKDROP` at `fpsHint`, holds `holdLastMs`, then shows the reveal card: dish, variation, or the gororoba joke page with `GOROROBA_STICKER`. The joke page picture is ART NEEDED, a magenta box until then. Reduced motion skips the strip. `slow-cooking` (no strip yet) shows a magenta 96×64 box for one hold, with linear easing.
  - The kitchen scene gets a "Cook" hotspot. `kitchen-slots.json` has no stove hotspot (only `lamps.hood` at 248,58), so a placeholder rect `{ x: 224, y: 40, w: 48, h: 48 }` round the hood, outlined in magenta, until Art adds a `stove` hotspot (ART NEEDED). It shows only once cooking has opened.
- [ ] **Step 1: Failing tests:**
  - (repo) With 3 beans, cooking 2 writes one row and leaves 1.
  - Another device's row (inserted first) leaves 1, so cooking 2 more → `{ ok: false, short: { beans: 1 } }` and no row.
  - Two `cook` calls in parallel with enough for one → exactly one row.
  - A gororoba writes `result: "gororoba"`.
  - (screen)
    - A sixth ingredient can't be picked.
    - A locked station can't be chosen.
    - Quick-fill of a learned recipe with a locked tool disables Cook and shows the reason.
    - An experiment asks to confirm, and Cancel writes nothing.
    - After Cook the reveal card shows the dish name.
    - With reduced motion no `<canvas>` animation mounts.
    - Esc closes and focus returns to the hotspot.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, plus `npx vitest run src/rio`.
- [ ] **Step 5: Commit** "Rio 2b: the cooking screen (pick, cook, reveal; never more than she has)".

### Task 8: The Recipes tab

**Files:**
- Create: `hub/src/rio/menu/RecipesTab.tsx`
- Modify: `hub/src/rio/menu/GameMenu.tsx` (the `recipes` tab no longer uses `LaterTab`; icon `icon-recipes`, the recipe book the Game Assets session drew, else the placeholder), `hub/src/farm/farmRepo.ts`
- Test: `hub/src/rio/menu/RecipesTab.test.tsx`

**Interfaces:**
- Consumes: `FarmState.recipes`, `FarmState.cooks`, `FarmState.pin`, `pinRow` (plan 1); `RECIPE_BY_DISH`, `RESTAURANT_NAME`; `untilTool`, `untilTechnique`; `waysToGet` (Task 9); `nextRecipeProgress` (Task 4).
- Produces:
  - `farmRepo.pinDish(dish: string | null): Promise<void>` (one `pin:dish` row; last write wins).
  - `cookedCount(cooks: readonly CookRow[], dish: string): number` (exact dish or its variations).
  - `<RecipesTab />`: a Collections-style grid of learned dishes in `order`, with the "Next recipe 6 / 8" bar on top (or "a new recipe is on its way" when owed but none eligible). A dish page shows:
    - each ingredient with have/need;
    - the tool and technique, with "after N finished days" / "after N habit sessions" when locked;
    - "Inspired at X";
    - "Cooked ×N";
    - the ways to get what's missing (Task 9);
    - Pin / Unpin.
- [ ] **Step 1: Failing tests:**
  - With 2 learned recipes, the grid shows 2 cells in order.
  - The page shows "beans 1 / 2" when she has 1.
  - A locked tool shows "after 2 finished days".
  - Pin writes `pin:dish` with the dish; Unpin writes `dish: null`.
  - Two cooks of feijoada plus one variation → "Cooked ×3".
  - Arrow keys move through the grid.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (layout as the Collection tab; kit pieces only). **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio 2b: the recipe book in the game menu".

### Task 9: What's missing, the pinned dish line, and dish prices

**Files:**
- Create: `hub/src/rio/kitchen/ways.ts`, `hub/src/ui/PinnedDish.tsx`
- Modify: `hub/src/ui/TodayPanel.tsx` (the line goes under Today's heading), `hub/src/rio/zonasul/SellDialog.tsx` (pass `recipeIngredients` to plan 3's `dishPrice`)
- Test: `hub/src/rio/kitchen/ways.test.ts`, `hub/src/ui/PinnedDish.test.tsx`

**Interfaces:**
- Consumes: `Economy`, `Ledger`, `shelfUnlocked`, `BED_INGREDIENTS`, `ANIMAL_PRODUCTS`, `YIELD`, `INGREDIENT_BY_KEY`, `DISH_SELL_MULTIPLIER` (plan 1); plan 3's `dishPrice(dish, ingredientsOf)` (`rio/zonasul/prices.ts`), given `recipeIngredients`.
- Produces:
  - `type Way = { kind: "bed"; area: BedArea; todos: number } | { kind: "habits"; sessions: number } | { kind: "shop"; coins: number } | { kind: "rare" }`.
  - `waysToGet(r: Recipe, e: Economy, shelf: readonly string[]): { ingredient: string; missing: number; via: Way[] }[]` (only missing ingredients). Each way:
    - bed: `todos = ceil(missing × bedSize / ((todoMin + todoMax) / 2))`;
    - habits: `sessions = ceil(missing × ANIMAL_PRODUCTS.length)`;
    - shop: if on the unlocked shelf, `coins = missing × buy`;
    - rare: when only big to-dos give it.
  - `todosAway(ways): number | null` (the most bed to-dos any missing ingredient needs; null if any missing ingredient has no bed way; 0 when nothing is missing).
  - No price function here: the Sell dialog now calls plan 3's `dishPrice(key, recipeIngredients)`, so cooked dishes appear for sale.
  - `<PinnedDish />` (desktop only; nothing at phone width or when no pin, an unknown dish, or a recipe not learned): the `pinned-dish-line*-template.png` strip with the dish sticker, the name, then "N to-dos away", "ready to cook!" or "needs Zona Sul" (`// PLACEHOLDER WORDING`), in `BitmapText`. A click opens the game at the recipe page.
- [ ] **Step 1: Failing tests:**
  - Feijoada missing 2 beans (Admin bed of 3) → bed way with `todos: 3`, and a shop way if beans are on the shelf.
  - Nothing missing → `[]` and `todosAway` 0.
  - A rare-only ingredient → `{ kind: "rare" }`, and `todosAway` null ("needs a big to-do").
  - Ticking an Admin to-do (the ledger grows by its gift) lowers the count.
  - `dishPrice("dishes-caipirinha", recipeIngredients)` equals `DISH_SELL_MULTIPLIER × Σ n × sell` of its recipe; a variation prices as its base dish; `dishPrice("gororoba", recipeIngredients) === null`; the Sell dialog lists a cooked dish.
  - (line) Pinned feijoada shows "Feijoada: … to-dos away".
  - At 390 px wide it renders nothing.
  - Pin of `dishes-from-later-pack` → nothing, no throw.
  - Pin of a dish whose `recipe` row is gone → nothing.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, plus `npx vitest run src/ui/HomePage.test.tsx src/ui/HabitsAndToday.test.tsx`.
- [ ] **Step 5: Commit** "Rio 2b: the pinned dish line on Today, what's missing, and dishes for sale".

### Task 10: Self-tests: two devices, restore, end to end

**Files:**
- Test: `hub/src/sync/cooking.test.ts`, `hub/src/farm/backupCooking.test.ts`, `hub/e2e/cooking.spec.ts`, `hub/e2e/cooking-sync.spec.ts` (in the `e2e:sync` config)

**Interfaces:**
- Consumes: everything above; `FakeSyncServer`, `syncOnce`, `saveSyncSettings`; `exportBackup`, `restoreBackup`.
- [ ] **Step 1: Failing tests:**
  - **Two devices:**
    - A and B both `markLearned("dishes-tapioca")` offline. After sync there is one `recipe:dishes-tapioca` row, and `recipesOwed` is the same on both.
    - A and B each cook with the same 3 beans offline. After sync there are two `cook` rows and beans are absent (0) on both, never negative.
    - A pins feijoada and B later pins moqueca → both show moqueca.
  - **Restore:**
    - A replace-restore of a backup taken before `recipe:dishes-tapioca` → the recipe is owed again, and `nextRecipes` re-chooses `dishes-tapioca` first.
    - A merge-restore keeps a `cook` row made after the backup.
  - **e2e** (the farm's `start` row seeded 31 days back as `e2e/farm.spec.ts` `startedFarm` does, with ticked to-dos that bank enough ingredients):
    - the inspired card plays for a home recipe, and OK puts it in Recipes;
    - cooking it from the kitchen hotspot (with reduced motion) shows the reveal card;
    - the pantry count drops by the recipe's amounts, and the dish page says "Cooked ×1";
    - pinning it shows the line on Home at 1280 px and not at 390 px.
  - **e2e:sync:** cook on context A → context B's pantry count drops after sync.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Fix what they find (no new features). **Step 4:** Run `npm test`, `npm run build`, `npx playwright test e2e/farm.spec.ts e2e/cooking.spec.ts`, the pwa and phone specs, and `npm run e2e:sync` → all PASS.
- [ ] **Step 5: Commit** "Rio 2b: self-tests for recipes and cooking across devices and restores", then push `rio-2b4`.

**Not in this plan:** the whole-goal feast at the Lagoa house (cooking several dishes for the friends). It needs the feast scene and the whole-goal event, which come after 2b.

**Art still needed for this plan:** a slow-cooking animation and station; kitchen tool icons (10); a `stove` hotspot in `kitchen-slots.json`; the gororoba joke-page picture; a "variation" mark; dish art for the remaining ~210 recipes toward 320 (each batch only needs a new `recipeData.ts` line per dish and a re-run of the importer).
