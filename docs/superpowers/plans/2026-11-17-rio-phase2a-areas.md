# Esme's Rio, phase 2a: the new areas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every area whose art is finished since phase 1 (Zona Sul, Jardim Botânico, Quilo, Sult, Os Esquilos, Santa Teresa) opens on its day with outside and inside scenes in day, rain and night; orchard and glasshouse stickers get their home at the Jardim Botânico; each area grows from her real counters; the map dresses up for Carnaval and Réveillon; the boteco's themed nights are bundled (dev preview only).

**Architecture:** The import script copies the six area folders (scenes only) and the map's `events/`. `assets.ts` reads each new slots file into the existing `SceneData` shape, plus the extras some areas have (Os Esquilos' celebration layers, Santa Teresa's milestones, spines and covers). A new pure module `rio/progress.ts` turns her counters into what each scene shows (state, celebration count, milestones, books), with every unruled threshold in `rio/thresholds.ts`. `AreaView` draws those layers; `RioMap` draws the active event from a pure `activeEvent(now)`.

**Tech Stack:** React 18, TypeScript, Vite (`import.meta.glob`), Vitest + Testing Library, Playwright.

**Spec:** `/Users/esme/Documents/coding/esmeworld-notes/rio-design.md` (areas table, opening order, rulings); `esmeworld-notes/decisions-record.md` 2026-11-14 to 2026-11-17; each area's README in `esmeworld-notes/art/final/rio-pack/{week2,later}/<area>/`, `later/boteco/themed-nights/README.md`, `day1/map/README.md` (holiday takeovers) and `rio-pack/NEXT.md` "Phase 2 must re-import". Phase 1 and the menu: `2026-11-14-rio-phase1.md`, `2026-11-17-rio-game-menu.md`.

## Global Constraints

- Nothing taken away: no existing farm row is rewritten or deleted; every earned, seen or placed sticker stays; phase-1 scenes lay out exactly as before.
- Only real tasks and habits move the game; thresholds read the earning engine's counters (`farm/earning.ts` `counters`), never anything done in the game.
- Never choose colour, easing, type, composition or timing; use the pack's art as delivered. New wording is marked `// PLACEHOLDER WORDING`.
- Every threshold Esme hasn't ruled lives in `rio/thresholds.ts`, each marked `// DEFAULT: Esme to confirm`.
- Art only from final folders: never `previews/`, `_scratch/`, `no-esme/` or `REVIEW-ONLY`. The new dish, ingredient and area sticker files are not imported (recipes, Zona Sul stock and the v3 families are phase 2b), and no sticker is added to the 175 + 8.
- The museum has no Rio night or rain art: it stays without a home and closed.
- No scrolling; the phone shows only the Collection (follow `rio-menu`).
- Reduced motion: no rain, TV, themed-night or fireworks animation.
- Rio time is `America/Sao_Paulo`.
- Never lose answers: before pushing, from `hub/`: `npm test`, `npm run build`, `npx playwright test e2e/farm.spec.ts e2e/pwa.spec.ts e2e/phone.spec.ts e2e/projects.spec.ts`, `npm run e2e:sync`.
- Work in `.claude/worktrees/rio-areas` on `rio-areas` (off `origin/rio-menu`); rebase on the latest `origin/rio-menu` before pushing; push the branch, never merge or deploy.

## Review Focus

1. **An orchard or glasshouse sticker placed before day 14** (placed rows from phase 1, spot `rio` or an old spot): it stays placed and earned; from day 14 it stands at the Jardim Botânico, never lost. (Task 3 test: an old placed orchard row lays out at `jardim-botanico/outside`.)
2. **More orchard stickers than tree slots** (9 orchard, 7 `trees:tree` slots): the extras show as "N more in your collection", never on a branch or pond slot. (Task 3 test.)
3. **Counters missing** (the game not started, or the journal locked): every new area draws its start state with no layers and nothing throws. (Task 3 test: `areaProgress(area, null)`.)
4. **Event boundaries in Rio time, read on a device in another time zone:** 15 Feb 23:59 Rio is Carnaval and 16 Feb 00:00 Rio is not; 1 Jan 05:59 Rio is Réveillon and 06:00 is not. (Task 5 tests use UTC instants.)
5. **Santa Teresa with more books than slots, or spines that need the second bookcase:** a spine is drawn only once its `requires` milestone is earned; past the last slot nothing errors. (Task 3 test.)

---

### Task 1: Bring in the new areas' art and the map's events

**Files:**
- Modify: `hub/scripts/import-rio-pack.mjs`, `hub/src/rio/assets.ts`
- Create: `hub/src/assets/rio/{week2/zona-sul,week2/jardim-botanico,later/quilo,later/sult,later/os-esquilos,later/santa-teresa,day1/map/events}/**`
- Test: `hub/src/rio/assets.test.ts`

**Interfaces:**
- Produces:
  - `SceneId` gains `"zona-sul/outside" | "zona-sul/inside" | "jardim-botanico/outside" | "jardim-botanico/inside" | "quilo/outside" | "quilo/inside" | "sult/outside" | "sult/inside" | "os-esquilos/outside" | "os-esquilos/inside" | "santa-teresa/outside" | "santa-teresa/inside"`.
  - `Slot` gains `order?: number` and `requires?: string`. Slots are read from `slots` or, when absent, `sticker_slots` (never dish, special or ingredient slots: phase 2b); slots with `order` come first, sorted by it, then the rest in file order (no phase-1 slots file has `order`, so phase-1 layout is unchanged).
  - `SceneData` gains `celebrations?: { id: string; layers: Partial<Record<Look, string>> }[]` (Os Esquilos, in step order), `milestones?: { id: string; overlay: Partial<Record<Look, string>> }[]` (Santa Teresa, by `order`), `books?: { spines: Sheet; covers: Sheet }` where `Sheet = { sheets: Partial<Record<Look, string>>; slots: { n: number; x: number; y: number; w: number; h: number; sx: number; sy: number; requires?: string }[] }`.
  - `RioMapData.events: RioEvent[]`, `RioEvent { key: "carnaval" | "reveillon" | string; name: string; dates: { from: string; to: string; night_runs_until?: string }; layers: Record<"day" | "night", string>; animation?: { night: { frames: string[]; frame_ms: number } } }`.
  - `BOTECO_NIGHTS: Record<"samba" | "karaoke" | "funk" | "football", { inside: NightLayer; outside: NightLayer; poster: string }>` with `NightLayer { overlay: string; baseTv: boolean; anims: { strip: string; at: [number, number]; size: [number, number]; frames: number; ms: number; once: boolean }[] }`, pack-relative, read from `later/boteco/themed-nights/manifest.json`.

- [ ] **Step 1:** In the import script add `week2/zona-sul`, `week2/jardim-botanico`, `later/quilo`, `later/sult`, `later/os-esquilos`, `later/santa-teresa` to `AREAS`; drop the `events/` skip; skip `/dishes/`, `/ingredients/` and `/stickers/` under the new areas (comment: phase 2b). Run `node scripts/import-rio-pack.mjs /Users/esme/Documents/coding/esmeworld-notes/art/final/rio-pack`; confirm `git status` shows no change under the existing areas or map files (the boteco and map are already current) and note the size.
- [ ] **Step 2: Failing tests** in `assets.test.ts`: `SCENES` has 26 scenes; every new scene's every base, rain frame or strip, celebration layer, milestone overlay and book sheet resolves with `rioUrl`; `SCENES["os-esquilos/outside"].celebrations!.map(c => c.id)` is `["feast-table","lanterns","flowers","roast","cake"]`; `SCENES["santa-teresa/inside"].milestones!.map(m => m.id)` is `["reading-lamp","second-bookcase","rug","cat-bed","window-seat"]`, `books!.spines.slots.length === 204`, `books!.covers.slots.length === 9`, spine 143 `requires === "second-bookcase"`; `SCENES["sult/inside"].slots[0].id === "celebration-table"` (order first); `SCENES["zona-sul/inside"].base` has `start`, `mid`, `full`; `SCENES["jardim-botanico/outside"].slots.length === 23` and inside 17; each `RIO_MAP.events` layer and frame resolves; `BOTECO_NIGHTS.samba.inside.overlay` resolves and every strip resolves. Replace the phase-1 test "holiday events are not bundled" with "holiday events are bundled". No dish or ingredient file is bundled (`import.meta.glob("../assets/rio/**/dishes/**")` is empty).
- [ ] **Step 3:** Run `npx vitest run src/rio/assets.test.ts` → FAIL. **Step 4:** Implement (`SOURCES` entries, roots = the area folder). **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** "Rio phase 2a: bring in the new areas' art and the map's holiday takeovers".

### Task 2: The new areas open on their days

**Files:** Modify `hub/src/rio/areas.ts`, `hub/src/rio/AreaView.tsx` (`SCENE_NAMES`); Test `hub/src/rio/areas.test.ts`

**Interfaces:**
- Produces: `AREA_SCENES` gains `zona-sul`, `jardim-botanico`, `quilo`, `sult`, `os-esquilos`, `santa-teresa`, each `{ outside: "<key>/outside", inside: ["<key>/inside"] }`. `SCENE_NAMES` (PLACEHOLDER WORDING): "Zona Sul" / "The aisles", "Jardim Botânico" / "The orchid house", "Quilo" / "The buffet", "Sult" / "The dining room", "Os Esquilos" / "The dining room", "Santa Teresa" / "The studio".

- [ ] **Step 1: Failing tests:** `opensOn` is 10, 14, 30, 90, 105, 165 for zona-sul, jardim-botanico, quilo, sult, santa-teresa, os-esquilos; `opensOn("museum")` stays null; day 12 → `zona-sul` new and `jardim-botanico` next; day 14 → `jardim-botanico` new, `museum` locked, `quilo` next; day 165 → `os-esquilos` new and nothing next (the last area with art); the AREA_SCENES key list adds the six. Update the phase-1 "day 12" expectation (Zona Sul now has art).
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** "Rio phase 2a: Zona Sul, the Jardim Botânico, the Quilo, Sult, Santa Teresa and Os Esquilos open on their days".

### Task 3: What each area shows, and the Jardim Botânico as home

**Files:**
- Create: `hub/src/rio/thresholds.ts`, `hub/src/rio/progress.ts`
- Modify: `hub/src/rio/placement.ts`
- Test: `hub/src/rio/progress.test.ts`, `hub/src/rio/placement.test.ts`, `hub/src/rio/collection.test.ts`

**Interfaces:**
- Produces:
  - `thresholds.ts` (each `// DEFAULT: Esme to confirm`): `QUILO_FULL_RECIPES = 30` (recipes not built: stays start), `SULT_FULL_MONTHLY_GOALS = 7`, `OS_ESQUILOS_MAX_CELEBRATIONS = 5` (full never shown in 2a: start + layers), `SANTA_TERESA_MILESTONES = [3, 6, 10, 15, 20]`, `SANTA_TERESA_COVER_EVERY = 5`, `SANTA_TERESA_FULL_BOOKS = 142`, `ZONA_SUL_STATE = "start"` (shelves and stages grow from errands and Admin to-dos in 2b), `JARDIM_FULL_SHARE = 0.5` (both scenes' slots together).
  - `RioCounts = { monthlyGoals: number; wholeGoals: number; readingBooks: number; recipes: number }`; `rioCounts(c: Counters | null): RioCounts` (from `monthly-goals`, `whole-goals`, `reading-books`; `recipes` 0; missing → 0).
  - `ScenePlan = { state: string; celebrations: number; milestones: string[]; books: number; covers: number }`.
  - `scenePlan(scene: SceneId, placed: readonly string[], counts: RioCounts): ScenePlan`: phase-1 scenes → `sceneState(scene, placedHere)` as today, zeros elsewhere; Jardim (both scenes) → `full` when the stickers laid out in both scenes plus their overflow ≥ `JARDIM_FULL_SHARE` × both scenes' slots; Quilo → `start` unless `counts.recipes >= QUILO_FULL_RECIPES`; Sult → `full` at `SULT_FULL_MONTHLY_GOALS`; Os Esquilos → `start`, `celebrations = min(wholeGoals, 5)`; Santa Teresa → `full` at `SANTA_TERESA_FULL_BOOKS` (then no milestones, books or covers: they are baked in), else inside `milestones` = ids whose threshold ≤ books, `books`, `covers = floor(books / 5)`; outside the same state; Zona Sul → `ZONA_SUL_STATE`.
  - `layout(scene, placed, milestones = [])`: a slot whose `requires` isn't in `milestones` is not free.
  - `placement.ts`: `HOME.orchard = { area: "jardim-botanico", scene: "jardim-botanico/outside" }`, `HOME.glasshouse = { area: "jardim-botanico", scene: "jardim-botanico/inside" }`; tags: orchard → `["trees:tree"]` (the pack's tree slots; the swing and blanket stand on the lawns); glasshouse `seedtray`, `seedling`, `wateringcan` → `["greenhouse:seeds"]`, the rest → `["greenhouse:plant"]`.
- [ ] **Step 1: Failing tests** (`progress.test.ts`, `placement.test.ts`):
  - `homeOf("sapling")` is the Jardim outside; `homeOf("orchid")` the inside; museum still null; the phase-1 "orchard has no home" test becomes "museum has no home".
  - every orchard sticker placed lays out on `trees:tree` slots only, 7 placed, overflow 2 (Review Focus 2); every glasshouse sticker lays out inside with `seedtray` on `potting-bench`, no glasshouse sticker on `pool-1`/`pool-2` unless it is a plant.
  - an old placed orchard row (`placedRow("sapling", "sapling", "2026-11-05")`) lays out at the Jardim outside (Review Focus 1).
  - `scenePlan`: Jardim start with nothing, full at `ceil(40 × 0.5)` placed across both scenes, outside and inside agree; Sult 6 → start, 7 → full; Os Esquilos whole 0/3/9 → 0/3/5 celebrations, state start; Santa Teresa books 2 → no milestones, 3 → `["reading-lamp"]`, 20 → all five, covers 4 at 20, 142 → full with no milestones; Quilo always start; Zona Sul start; `scenePlan(…, rioCounts(null))` gives start everywhere with no layers (Review Focus 3); phase-1 scenes equal `sceneState`.
  - `layout("santa-teresa/inside", [], [])` never frees `window-seat`; with `["window-seat"]` it does (Review Focus 5).
  - `collection.test.ts`: orchard and glasshouse now have a home matching their Collection area.
- [ ] **Step 2–4:** Run `npx vitest run src/rio` (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** "Rio phase 2a: the areas grow from her counters; orchard and glasshouse find the Jardim Botânico".

### Task 4: Draw them

**Files:** Modify `hub/src/rio/AreaView.tsx`, `hub/src/farm/FarmPage.tsx`, `hub/src/rio/look.ts` (dev overrides); Test `hub/src/rio/AreaView.test.tsx`, `hub/src/rio/look.test.ts`, `hub/src/farm/FarmPage.test.tsx`

**Interfaces:**
- Consumes: `scenePlan`, `rioCounts`, `BOTECO_NIGHTS`.
- Produces:
  - `<AreaView … counts?: RioCounts night?: BotecoNight | null />` (`counts` defaults to zeros). Draw order (pack READMEs): base for `plan.state`, Os Esquilos celebration layers 1..n, Santa Teresa milestone overlays then spines 1..books (skipping one whose `requires` isn't earned, stopping at the last slot) and covers, stickers, the boteco TV, the themed night (overlay at 0,0; base TV only when `baseTv`; strips frame 0 when reduced motion), the falling rain. A look a layer lacks falls back to day. `data-state`, `data-celebrations`, `data-milestones`, `data-books` on `.rio-area`.
  - `devDay(search, dev = import.meta.env.DEV): number | null` (`?day=N`, N ≥ 1) and `devNight(search, dev): BotecoNight | null` (`?night=samba|karaoke|funk|football`, applied only to the boteco at night). FarmPage uses `devDay ?? farmDay(...)`.
- [ ] **Step 1: Failing tests:** Os Esquilos with `wholeGoals: 3` → `data-celebrations="3"`, `data-state="start"`; Santa Teresa inside with 10 books → `data-milestones="reading-lamp second-bookcase rug"`, `data-books="10"`; Sult with 7 monthly goals → `data-state="full"`; the Jardim with no stickers → `start`; each new area's inside button names; `devDay("?day=14", true) === 14`, `devDay("?day=14", false) === null`, `devDay("?day=0", true) === null`; `devNight("?night=samba", true) === "samba"`, `devNight("?night=quiz", true) === null`, false when not dev; reduced motion on the boteco with a night starts no timer; FarmPage: on day 14 a placed orchard sticker shows in the Jardim's "Stickers here" list.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** "Rio phase 2a: draw the new areas, their celebrations, milestones and books".

### Task 5: Carnaval and Réveillon on the map

**Files:** Create `hub/src/rio/events.ts`; Modify `hub/src/rio/RioMap.tsx`; Test `hub/src/rio/events.test.ts`, `hub/src/rio/RioMap.test.tsx`

**Interfaces:**
- Produces: `rioDate(now: Date): { md: string; hour: number }` (Rio month-day "MM-DD" and hour); `activeEvent(now: Date): RioEvent | null`: Carnaval when `"02-01" <= md <= "02-15"`; Réveillon on `12-31` (all day, map.json: "the day look all of 31 December") and on `01-01` before 06:00. `RioMap` takes `now?: Date` (default `new Date()`, re-read each minute) and draws the event's layer for the map look (rain → day layer) after the places and before the rain and the markers, over open and locked places alike; Réveillon's fireworks play at night unless reduced motion. `data-event` on `.rio-map`.
- [ ] **Step 1: Failing tests** (UTC instants, Rio = UTC−3): `2027-02-01T03:00Z` → carnaval; `2027-02-16T02:59Z` → carnaval; `2027-02-16T03:00Z` → null; `2027-01-31T12:00Z` → null; `2026-12-31T21:00Z` (18:00 Rio) → reveillon; `2027-01-01T08:59Z` → reveillon; `2027-01-01T09:00Z` → null; `2026-12-30T12:00Z` → null; RTL: `<RioMap now={2027-02-10} …>` has `data-event="carnaval"`, and none in March.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** "Rio phase 2a: the whole city dresses for Carnaval and Réveillon".

### Task 6: Real browser, screenshots, the full checks

**Files:** Modify `hub/e2e/farm.spec.ts`; Create `.superpowers/rio-areas-screens/*.png` (throwaway script, not committed)

- [ ] **Step 1:** e2e: on `/farm?day=14` (dev server) the map's hidden list shows Jardim Botânico new and opening it shows "The orchid house"; existing assertions unchanged.
- [ ] **Step 2:** Screenshots at 1440×900 of each new area outside and inside (`?day=200`), the boteco on a samba night (`?night=samba&look=night`), and the map on 10 Feb (Playwright clock).
- [ ] **Step 3:** Rebase on `origin/rio-menu`, then the full checks (Global Constraints). Re-run Highlights, TestingTogetherRound7 and the sync controller test alone if they flake, and say so.
- [ ] **Step 4:** Push `rio-areas`; one fresh reviewer (opus) via superpowers:requesting-code-review; fix what's real; re-check; push.

---

## Added 2026-11-17 (coordinator: more finished art landed)

Run Tasks 7–9 after Task 5; Task 6 (browser, screenshots, full checks, push, review) runs last and covers them too (screenshots of the museum, the new sea and the Flamengo match).

### Task 7: The new sea off Arpoador

**Files:** Modify `hub/scripts/import-rio-pack.mjs` (add `later/arpoador-sea`), `hub/src/rio/assets.ts`, `hub/src/rio/placement.ts`, `hub/src/rio/AreaView.tsx`; Test `assets.test.ts`, `placement.test.ts`, `AreaView.test.tsx`

**Interfaces:**
- `SOURCES["ipanema-beach/sea"]` reads `later/arpoador-sea/scenes/arpoador-sea-slots.json` (root `later/arpoador-sea`); the rough `day1/ipanema/sea/` files stay bundled but unread. Still opens on day 30 (`SCENE_OPENS`).
- `SceneData.underlay?: { strips: Record<string, Partial<Record<Look, string>>>; count: number; size: [number, number]; ms: number }` (state → look → strip): the caustics, drawn over the base and under the stickers; frame 0 with reduced motion. The sea's rain is `overlays/arpoador-rain.png` (4 frames, 110 ms).
- Aquarium tags: stream fish → `["fish:fish"]`; the "Rare fish" set (moonfish, golden carp: a whole workbook finished) → `["fish:rare"]`, the showcase the README names for exactly those.
- [ ] Tests: the sea's base is the arpoador start/full in each look; 18 slots; every aquarium sticker placed stands on a slot that accepts it, the 8 stream fish on `swim-*`, the moonfish and golden carp on `rare-*`; caustics strips resolve; `sceneOpen("ipanema-beach/sea", 29)` still false. Run (FAIL), implement, run (PASS). Commit "Rio phase 2a: the new sea off Arpoador".

### Task 8: The museum opens on day 21

**Files:** Modify the import script (copy, from `<pack>/../esme-pack/week2-4/museum/`, only `location/plaza-summer.png`, `location/museum-doors-open.png`, `location/plaza-slots.json`, `inside/hall-summer.png`, `inside/room-hall.json`, `inside/pieces/case-glass.png`, to the same relative path under `src/assets/rio/`; and `week3/museum-looks/`), `assets.ts`, `areas.ts`, `placement.ts`, `AreaView.tsx`; Test the same files.

**Interfaces:**
- `"museum/outside"` (320×192): one state `open`: day = `plaza-summer.png` with the stamp `museum-doors-open.png` at (152, 72); night and rain = `plaza-summer-open-{night,rain}.png`; rain strip `rain/plaza-rain-streaks`. Slots: the plaza's 11 (`museum-outdoor:*`; nothing places there yet).
- `"museum/inside"` (352×224): one state `start`: `hall-summer.png`, `hall-summer-{night,rain}.png`; rain strip `rain/hall-rain-streaks`; slots = `room-hall.json` `display_slots` (foot → x, y; accepts `museum`, `finds`); `glass: { file, at[] }` drawn over the stickers.
- `SceneData.stamps?: Partial<Record<Look, { file: string; at: [number, number] }[]>>`, `SceneData.glass?`, `SceneData.tint?: Partial<Record<"rain" | "night", string>>` (the looks' palette JSON): placed stickers and the case glass are recoloured at runtime by exact colour to the look's twin (`tintImage(img, map)`, cached per sticker and look), as the museum README asks.
- `AREA_SCENES.museum = { outside: "museum/outside", inside: ["museum/inside"] }`; `HOME.museum = { area: "museum", scene: "museum/inside" }`, tags `["museum"]`.
- [ ] Tests: `opensOn("museum") === 21`; day 21 museum new; `homeOf("ammonite")` is the hall; all 12 museum stickers lay out on display slots (27); the outside day has the doors stamp and night/rain don't; `tintMap` parses the palette into day→look colour pairs and `recolour` maps an exact colour and leaves others. Run (FAIL), implement, run (PASS). Commit "Rio phase 2a: the museum opens on day 21, with its finds on display".

### Task 9: The Flamengo match opens on day 60

**Files:** import script (`later/flamengo`, skipping `stickers/`), `assets.ts`, `areas.ts`, `progress.ts`, `thresholds.ts`, `AreaView.tsx`; Test the same.

**Interfaces:**
- `"flamengo-match/outside" | "flamengo-match/inside"` (root `later/flamengo`); `SceneData.goal?: { frames: Partial<Record<Look, string[]>>; ms: 140 }` (inside: `goal/inside-goal-<look>-{0..3}.png`). Nothing triggers the goal in 2a (weekly reviews aren't built); a dev-only `?goal=1` plays it for screenshots, never with reduced motion.
- `AREA_SCENES["flamengo-match"]`, opens on day 60. `RioCounts.weeklyReviews` (the `weekly-reviews` counter; not built, so 0); `FLAMENGO_FULL_WEEKLY_REVIEWS = 4` (README's suggestion) `// DEFAULT: Esme to confirm`.
- Farmhouse stickers stay at the boteco: the README says the match takes over the theatre family (no phase-1 zone), and says nothing of the farmhouse.
- [ ] Tests: `opensOn("flamengo-match") === 60`; both scenes' bases and goal frames resolve; 4 weekly reviews → full, 3 → start; `homeOf("lantern")` still the boteco. Run (FAIL), implement, run (PASS). Commit "Rio phase 2a: the Flamengo match opens on day 60".

## Known limits to tell Esme (not bugs)
- Zona Sul's shelves stay bare and its stage stays at opening day until errands and Admin to-dos drive it (phase 2b).
- The Quilo stays quiet (start) until recipes exist; Sult and Os Esquilos fill only with their counters (no goal stickers stand there yet: the v3 goal family is phase 2b).
- The new dish (37), ingredient (21) and Jardim/Santa Teresa sticker art (20) is not in the app yet; it arrives with recipes and the v3 families.
- Themed nights are bundled but never triggered (they need bundles, phase 2b).
- 9 orchard stickers, 7 tree spots: 2 wait in the collection.
- Réveillon follows map.json (all of 31 Dec, night until 06:00 on 1 Jan), wider than "from 18:00".
