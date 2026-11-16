# Esme's Rio: the game menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Stardew-style game menu on the Rio page: a menu button (the kit's hotbar) and Esc open one wooden kit panel with tabs Map, Collection (replaces the sticker book), Noticeboard, Wardrobe, Recipes, Friends (the last three "Opens later") and Settings (reduced motion, Help).

**Architecture:** The approved UI kit and its body pixel font are copied into `hub/src/assets/rio-ui/` and read through typed loaders (`rio/ui/`). The menu is a fixed full-window dialog drawn in "UI pixels" (`font-size: <u>px`, every size in `em`, as the kit mockups do) at a whole-number scale `u` chosen to fit the window, in a wide or narrow layout. Pure modules decide the collection's grouping by Rio area and the Noticeboard's facts; React components draw them. The old `StickerBook` is removed; its earning, placing, totals and badges move into the Collection tab.

**Tech Stack:** React 18, TypeScript, Vite (`import.meta.glob`), Dexie, Vitest + Testing Library, Playwright.

**Spec:** Esme's request of 2026-11-17 (decisions-record.md, "A Stardew-style game menu replaces the sticker book"); the brief for this branch; the kit mockups `/Users/esme/Documents/coding/esmeworld-notes/art/options/esme-ui/esme-ui.html` with `src/screens_a_book.js` (Collections), `src/screens_c_more.js` (Noticeboard, menu tabs), `src/screens_b_mine.js` (Help), `src/core.js` + `src/page.css` (text, pieces); `kit/kit.json`; UI rules in decisions-record.md 2026-11-09 "UI feedback".

## Global Constraints

- Never choose colour, easing, type, composition or timing beyond the kit (repo CLAUDE.md). Colours only from `kit.json` `ui_ramp_proposed` and the mockups' text colours (`#56160c` ink, `#7a3a1a` brown, `#2a1208` dark, `#4c9c2c` green, `#8c5bd2` purple, `#fff3d6` cream, `#853605` button shadow); pieces drawn as `page.css` draws them. Anything the kit lacks is an obvious placeholder (magenta `var(--placeholder)`, system font).
- Text only in the kit's body pixel font (`font/font-small.png`, `fonts.json` "small"), drawn by `BitmapText`; real text kept for screen readers (visually hidden). Body text at 2 CSS px per font pixel when `u = 3`, at `u` otherwise; headings at `u` (mockups: `SK`, `isHead`).
- Even padding round all text; icons dead centre with space around them; faces never cropped (2026-11-09).
- No book anywhere on the game page: no cover, spreads, page turns or book-shaped container (Esme, 2026-11-17: "idk if i want the book at all; i was happy with the UI that was designed before"). Follow the esme-ui kit screens exactly; where the kit has no layout, or two kit layouts conflict, say so in the report.
- Every new piece of wording is marked `// PLACEHOLDER WORDING` (or `{/* PLACEHOLDER WORDING */}`).
- The menu never scrolls: the whole panel fits the window at a whole-number scale (3 or 2; 1 only as a last resort). Phone width 390 works (narrow layout).
- Every tab and control works by keyboard and screen reader: tabs follow the ARIA tabs pattern (arrow keys, Home, End), the menu is a modal dialog (focus moves in, Esc closes, focus returns).
- Nothing is taken away: the 175-sticker total, every earned/seen/placed sticker, the ×N repeat badges, bonus stickers, the earned-moment queue and the nook's book glint keep working. No stored row is rewritten.
- Reduced motion follows the OS by default; a per-device override lives in `localStorage` key `rio-reduced-motion` (`"on"` | `"off"`; absent = follow the OS), every access in try/catch.
- Esme's top rule ("never lose answers"): never skip the save and self-test checks. Before pushing: `npm test`, `npm run build`, the farm, pwa and phone e2e specs, `npm run e2e:sync`.
- Work in `.claude/worktrees/rio-menu` on branch `rio-menu`; push the branch, never merge or deploy.
- Kit and font files only from `esme-ui/kit/*.png` (not `extra-*`), `kit/kit.json`, `font/font-small.png`, `font/fonts.json`; never `review/`, previews or `sample@*`.

## Review Focus

1. **A sticker earned while the menu is open on its area** (the nook's moment plays behind the dialog): the cell turns from ghost to ready live, and the queue still drains. (Task 6 test: a seen row written while Collection is open flips the cell's `data-state`.)
2. **Placing fails (a write error)**: the sticker stays ready and the card stays open with its button, as the book did (review M6). (Task 6 test: `place` rejects → card still shown.)
3. **A very short or narrow window** (1280×600 desktop, 360×640 phone): the menu still fits whole, at a smaller whole scale or the narrow layout, with no scrolling. (Task 2 test on `menuLayout`; Task 8 e2e at 390×844 checks no overflow.)
4. **Esc while typing elsewhere on the page, or with the arrival banner showing**: Esc never opens the menu from a text field; Esc closes the menu from anywhere inside it. (Task 7 test.)
5. **localStorage blocked** (private mode, throws on access): Settings still shows "Follow this device" selected and changing it works for the session without throwing. (Task 3 test.)

---

### Task 1: Bring in the kit and its body font

**Files:**
- Create: `hub/scripts/import-rio-ui.mjs`, `hub/src/assets/rio-ui/**` (copied), `hub/src/rio/ui/kit.ts`, `hub/src/rio/ui/font.ts`
- Test: `hub/src/rio/ui/kit.test.ts`

**Interfaces:**
- Produces:
  - `kitUrl(name: string): string` (bundled URL of `kit/<name>.png`, `""` if missing); `KIT: Record<string, { w: number; h: number; slice?: [number, number, number, number] }>` from `kit.json` `pieces`.
  - `FONT_URL: string`; `FONT: { lineHeight: 11; letterSpacing: 1; glyphs: Record<string, { x; y; w; h; advance }> }`.
  - `glyphOf(ch: string): Glyph` (exact glyph; else the mockups' `GLMAP` (`·`→`•`, `›`→`>`, `‹`→`<`, `✓`→`•`, `’`→`'`); else the letter without its accent (`NFD`); else `?`).
  - `measure(text: string): number` (font px: sum of advances minus letterSpacing, 0 for "").
  - `wrapText(text: string, maxW: number): string[]` (font px; word wrap; `\n` breaks).

- [ ] **Step 1:** Write `import-rio-ui.mjs <esme-ui dir>`: copies `kit/*.png` except `extra-*`, `kit/kit.json`, `font/font-small.png`, `font/fonts.json` into `src/assets/rio-ui/{kit,font}/`; prints count and size. Run it on `/Users/esme/Documents/coding/esmeworld-notes/art/options/esme-ui`.
- [ ] **Step 2: Failing tests** (`kit.test.ts`): every `KIT` piece used by the menu (`panel`, `inset`, `tab`, `tab-active`, `tab-side`, `tab-side-active`, `btn-close`, `btn-close-hover`, `btn-arrow-left`, `btn-arrow-right`, `btn-text`, `btn-text-hover`, `slot`, `slot-lg`, `slot-lg-hover`, `tooltip`, `tooltip-divider`, `emote-bang`, `board`, `letter-paper`, `pin`, `ribbon-bow`, `frame-thin`, `icon-map`, `icon-book`, `icon-noticeboard`, `icon-wardrobe`, `icon-friends`) has a non-empty `kitUrl` and its `w`,`h`; `measure("A") === 5`; `measure("") === 0`; `glyphOf("â")` is `glyphOf("a")`; `glyphOf("·")` is `glyphOf("•")`; `wrapText("one two three", measure("one two"))` is `["one two", "three"]`; no extra-* file was copied.
- [ ] **Step 3:** Run `npx vitest run src/rio/ui` → FAIL. **Step 4:** Implement (glob as `farm/sprites.ts`). **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** "Rio menu: bring in the approved UI kit and its body font".

### Task 2: Bitmap text and the menu's fit

**Files:**
- Create: `hub/src/rio/ui/BitmapText.tsx`, `hub/src/rio/ui/fit.ts`
- Test: `hub/src/rio/ui/fit.test.ts`, `hub/src/rio/ui/BitmapText.test.tsx`

**Interfaces:**
- Produces:
  - `bodyPx(u: number): number` (2 when `u === 3`, else `u`); `headPx(u) = u`.
  - `type MenuLayout = "wide" | "narrow"`; `MENU_STAGE: Record<MenuLayout, { w: number; h: number; panel: { x: number; y: number; w: number; h: number } }>` in UI px. The panel is the kit's one menu-with-tabs screen (`skillsHTML`: desktop panel 254×178, tabs at panel x+12, y−15, close at y−26; phone panel 191 wide, close at y−14). Wide: `{ w: 269, h: 204, panel: { x: 15, y: 26, w: 254, h: 178 } }` (15 px left for the Collections side tabs). Narrow: `{ w: 195, h: 304, panel: { x: 2, y: 16, w: 191, h: 214 } }` plus the Collections card dock under the panel (`tipdock`: panel bottom + 4, 70 tall).
  - `menuFit(vw: number, vh: number): { layout: MenuLayout; u: number }`: wide at the largest `u` in [3, 2] where `w*u <= vw` and `h*u <= vh`; otherwise narrow at the largest `u` in [3, 2, 1] that fits the same way (1 as the last resort).
  - `UiScale` React context `{ u: number; layout: MenuLayout }` and `useUi()`.
  - `<BitmapText text heading? colour? shadow? w? align? className? />`: a `<span class="bt">` holding a visually-hidden `<span>` with the real text and an `aria-hidden` canvas (drawn only when `canDraw()`), wrapped at `w` UI px, glyphs tinted by `source-in` (cached per colour), shadow drawn 1 font px down-right first; canvas CSS size = font px × `bodyPx(u)` (or `headPx`).
- [ ] **Step 1: Failing tests:** `menuFit(1440, 900)` → wide, 3; `menuFit(1280, 600)` → wide, 2; `menuFit(390, 844)` → narrow, 2; `menuFit(360, 640)` → narrow, 1; `menuFit(300, 400)` → narrow, 1. RTL: `<BitmapText text="Hello" />` renders "Hello" readable by `getByText` and an `aria-hidden` canvas.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** "Rio menu: pixel-font text and a whole-scale fit".

### Task 3: Reduced motion, per device

**Files:**
- Modify: `hub/src/farm/motion.ts`, `hub/src/farm/hooks.ts`
- Test: `hub/src/farm/motionPref.test.ts`

**Interfaces:**
- Produces: `type MotionPref = "system" | "on" | "off"`; `motionPref(): MotionPref`; `setMotionPref(p: MotionPref): void` (writes or removes `rio-reduced-motion`, keeps a module copy so it works with storage blocked, dispatches `window` event `rio-motion-pref`); `reducedMotion()` = `on` → true, `off` → false, `system` → the media query (as now). `useReducedMotion()` also re-reads on `rio-motion-pref`.
- [ ] **Step 1: Failing tests:** default is `system` and follows `matchMedia`; `setMotionPref("on")` makes `reducedMotion()` true with the OS saying no and stores `"on"`; `"off"` makes it false with the OS saying reduce; `"system"` removes the key; with `localStorage.getItem`/`setItem` throwing, `motionPref()` is `system`, `setMotionPref("on")` doesn't throw and `reducedMotion()` is true; a component using `useReducedMotion` re-renders on `setMotionPref`.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** "Rio menu: reduced motion can be set per device".

### Task 4: What the Collection shows, by Rio area

**Files:**
- Create: `hub/src/rio/collection.ts`
- Test: `hub/src/rio/collection.test.ts`

**Interfaces:**
- Consumes: `STICKERS`, `COLLECTION` (catalogue), `homeOf` (placement), `opensOn` (areas).
- Produces:
  - `CollectionPage { title: string; stickers: string[] }` (book order); `CollectionArea { key: string; name: string; icon: string; pages: CollectionPage[] }`.
  - `COLLECTION_AREAS: CollectionArea[]`, in this order with these kit icons: `lagoa-house` "Lagoa house" `icon-cottage` (lane/Kind notes); `fazenda` "Fazenda" `icon-veggarden` (beds "Vegetable beds", barnyard "Barnyard"); `ipanema-beach` "Ipanema beach" `icon-pond` (pond "Pond", aquarium "Aquarium"); `tijuca-park` "Tijuca park" `icon-meadow` (meadow "Meadow", lane/Hedgerow "Hedgerow"); `jardim-botanico` "Jardim Botânico" `icon-orchard` (orchard "Orchard", glasshouse "Glasshouse"); `museum` "Museum" `icon-museum` (museum "Museum"); `boteco` "Boteco" `icon-saloon` (farmhouse "Farmhouse"); `bonus` "Bonus" `icon-star` (bonus "Area cleared"). Names from `RIO_MAP` where the place exists.
  - `areaOfSticker(key: string): string` (the `COLLECTION_AREAS` key holding it).
  - `type CellState = "placed" | "ready" | "ghost"`; `cellState(key, { earnedSet, placed }): CellState` (moved from `StickerBook.slotState`).
- [ ] **Step 1: Failing tests:** every sticker in `STICKERS` is on exactly one page; the pages hold 175 + 8; no page holds more than 56 (the narrow grid holds 8×7); each area with a home in `placement.ts` matches `homeOf(k)?.area` for its stickers (orchard/glasshouse/museum/bonus have none); `cellState` for placed, earned-not-placed and not-earned.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** "Rio menu: the collection grouped by Rio area".

### Task 5: The Noticeboard's facts

**Files:**
- Create: `hub/src/rio/notices.ts`
- Modify: `hub/src/farm/state.ts` (`FarmState.seenOn: ReadonlyMap<string, ISODate>`, from seen rows; `EMPTY_FARM.seenOn` empty)
- Test: `hub/src/rio/notices.test.ts`, `hub/src/farm/state.test.ts`

**Interfaces:**
- Consumes: `areaStatuses`, `opensOn`, `RIO_MAP`; `ARRIVES_AT`, `NAMES`, `CHARACTERS`, `addDays` from `domain/dates` (or equivalent).
- Produces:
  - `nextOpening(statuses, start: ISODate | null, today: ISODate): { key: string; name: string; day: number; date: ISODate; inDays: number } | null` (the `next` place; date = start + day − 1).
  - `recentStickers(seenOn: ReadonlyMap<string, ISODate>, placed: ReadonlyMap<string, string>, n = 5): string[]` (latest seen date first, then book order; only seen stickers).
  - `nextFriend(friends: number, day: number, arrived: ReadonlySet<CharacterId>): { id: CharacterId; name: string; at: number; stickersToGo: number; daysToGo: number } | null`.
- [ ] **Step 1: Failing tests:** day 1 → Barraca, day 3, date = start + 2, inDays 2; after every area with art is open → null; `recentStickers` orders by date desc then book order and caps at 5; `nextFriend(3, 2, {domino})` → Bap at 5 (2 to go, 3 days to go); everyone arrived → null; `farmState` fills `seenOn` and keeps every other field identical.
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** "Rio menu: what the noticeboard can honestly say today".

### Task 6: The menu panel and its tabs

**Files:**
- Create: `hub/src/rio/menu/GameMenu.tsx`, `CollectionTab.tsx`, `NoticeboardTab.tsx`, `SettingsTab.tsx`, `LaterTab.tsx`, `pieces.tsx` (kit boxes: `Panel`, `Inset`, `Tooltip`, `Paper`, `Board`, `TextButton`, `KitIcon`), `menu.css`
- Test: `hub/src/rio/menu/GameMenu.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–5; `FarmView`; `canPlace(key)` from the page.
- Produces:
  - `type MenuTab = "map" | "collection" | "noticeboard" | "wardrobe" | "recipes" | "friends" | "settings"`; `MENU_TABS` (order as listed; icons `icon-map`, `icon-book`, `icon-noticeboard`, `icon-wardrobe`, placeholder, `icon-friends`, placeholder; labels "Map", "Collection", "Noticeboard", "Wardrobe", "Recipes", "Friends", "Settings").
  - `<GameMenu view tab onTab(tab) onClose canPlace day statuses startArea? />`: `role="dialog" aria-modal aria-label="Menu"`; `role="tablist"` of `role="tab"` buttons (`aria-selected`, `aria-controls`); one `role="tabpanel"`; the close button "Close"; picking Map calls `onClose`. No book anywhere (Esme, 2026-11-17: "idk if i want the book at all").
  - **Collection** copies `screens_a_book.js` `bookHTML`/`tipHTML`: the grid of `slot-lg` cells at (8, 8) in the panel, 20 px pitch, 10 columns (narrow: 17 px pitch with no slot box, as the phone mockup), each a button named `"<name>: placed in Rio" | "<name>: ready to place" | "<name>: not yet"` with `data-sticker`, `data-state`; the bobbing "!" (`emote-bang`) on ready cells (still under reduced motion); "×N" in cream with the ink shadow at (9, 10) from ×2; the caption (heading) "<area> • <page>" and "<n> of <m> stickers • <collected> of 175 in all" with the left/right arrows on the caption line for an area's pages ("Previous page"/"Next page"). The kit's top place tabs become the kit's side tabs (`tab-side`, at panel x−15, 20 px apart; narrow: a row of `tab` inside the panel, as the phone mockup's set row), because the menu's tabs own the top row (call out in the report). The card is the kit `tooltip`: name (dark), area (purple, wide only), `tooltip-divider`, `hintFor` (ink), then "Earned ×N" (green) or "Not yet" (brown), and for ready stickers the `btn-text` "Place in Rio" with "Ready!" (green), or "Its place in Rio opens later" (brown). Wide: beside the cell (`bindBook`'s maths); narrow: docked under the panel.
  - **Noticeboard** copies the phone `boardHTML` list (the desktop board is larger than the menu panel; call out): kit `row`s with an icon and a heading line, footer line, and a row opens the `noteDetailHTML` view (icon centred, heading, body, back arrow). Rows: "Opens next: <place>" (`icon-map`), "Just earned" (`badge-new`, stickers in `slot`s), "Next friend: <name>" (`icon-friends`), and an honest empty row for phase 2 (`icon-noticeboard`, no detail).
  - **Settings**: the kit has no settings screen; Help copies `helpWelcome` (three lines with icons in `icon-frame`s); "Motion" is three kit `row`s with `icon-tick` on the chosen one (`role="radio"`): "Follow this device", "Reduce motion", "Full motion".
  - **Wardrobe, Recipes** (and Friends below its list) copy the book's locked place: the name centred (heading) at y 30, "Opens later" (brown) at y 52, the `ribbon-bow`.
- [ ] **Step 1: Failing tests:** arrow keys move between tabs and Home/End jump; choosing Map calls `onClose`; Esc inside calls `onClose`; Collection with a fictional earned "seeds-mind" shows "Mind: seeds: ready to place", its card has "Place in Rio", pressing it calls `view.place("seeds-mind")`; a ghost's card shows `hintFor`; an orchard sticker's card says "Its place in Rio opens later"; when `place` rejects the card stays (Review Focus 2); a seen row arriving while open flips the cell to ready (Review Focus 1); the bonus page shows "×3" for a cleared area with count 3; Noticeboard on day 1 says "Barraca" and "day 3"; Settings radio changes `motionPref()`; Wardrobe says "Opens later".
- [ ] **Step 2–4:** Run, implement, run.
- [ ] **Step 5: Commit** "Rio menu: the wooden panel and its tabs".

### Task 7: Put the menu on the Rio page

**Files:**
- Modify: `hub/src/farm/FarmPage.tsx` (no `StickerBook`; a kit hotbar under the map/area: Collection, Wardrobe, Map, Noticeboard, Friends slots, the mockup's hotbar order without calendar and letters, named "Open the menu: <tab>"; Esc toggles the menu unless typing; `?menu=<tab>` opens it on that tab and is removed; opening Collection clears the glint; the Collection's shown area sets `farmZones` to its groups so the nook's host follows; the cast row and character panel stay on the page)
- Modify: `hub/src/farm/Nook.tsx` (the book icon becomes the kit's collection icon `icon-book`, centred in the old 16×16 spot; the glint is the kit's `fx-sparkle` frame beside it; the moment's book-bump moves it; a link over it to `/farm?menu=collection`, named "Your sticker collection")
- Delete: `hub/src/farm/StickerBook.tsx`; Modify `hub/src/farm/book.test.ts` (keep the ×N badge tests; the contents plate goes with the book)
- Modify: `hub/src/farm/farm.css` (hotbar)
- Test: `hub/src/farm/FarmPage.test.tsx`

- **The game screen** (Esme, 2026-11-17: "it should be like a fixed screen … with no scrolling; just needs better design"): create `hub/src/rio/GameScreen.tsx` + `game-screen.css`, the one place the layout lives. On `/farm` the shell marks itself `is-game` (AppShell reads the route); the content area loses its padding, `html`/`body` don't scroll, and `.game-screen` fills the content area beside the sidebar (phone: under the phone header), on the kit's screen backdrop `#2a2418` (`page.css` `.stage`). The map or area is centred in it at the crisp fit (`useFit` measures `.game-screen` when inside one, no reserve). On top of the game, in kit pieces: the hotbar (bottom centre; phone: above the nook and + row), the area's Back/inside buttons (`btn-text`, top left), the overflow line and the arrival banner (`frame-thin` with bitmap text and an OK `btn-text`). The page's h1 stays for screen readers only. The cast row and character panel move into the Friends tab (kit `row`s with the friend's picture, the wardrobe as rows with `icon-tick`), since nothing may sit below the game; the Friends tab keeps "Who lives here" and "Wardrobe" groups.
- [ ] **Step 1: Failing tests** (rewrite the book tests for the menu, keep their assertions): the page has the hotbar and no book; Esc opens the menu on Collection; Escape in a text field doesn't; placing "seeds-mind" from Collection writes `placed:seeds-mind` with spot `rio`; the pond, orchard, aquarium-day-30 and old-farm tests run through the menu; `/farm?menu=noticeboard` opens on Noticeboard; the nook's "Your sticker collection" link goes to `/farm?menu=collection`; opening Collection clears the glint.
- [ ] **Step 2–4:** Run `npx vitest run src/farm src/rio`, implement, run.
- [ ] **Step 5: Commit** "Rio menu: the menu replaces the sticker book on the Rio page".

### Task 8: Real browser, screenshots, the full checks

**Files:**
- Modify: `hub/e2e/farm.spec.ts`
- Create: `.superpowers/rio-menu-screens/*.png` (via a throwaway script, not committed as a test)

- [ ] **Step 1:** Update `farm.spec.ts`: the book flows open the menu (hotbar and Esc), place "Mind: seeds" from Collection (`placed:seeds-mind` spot `rio`, then it stands at the fazenda), a ghost's hint, keyboard tab moves, reduced motion via Settings, the menu panel fits the viewport with no scrolling at 1280 and 390 (`scrollHeight <= clientHeight`, panel box inside the viewport), and the pixel-scale checks for the menu canvases.
- [ ] **Step 2:** Run `npx playwright test e2e/farm.spec.ts e2e/pwa.spec.ts e2e/phone.spec.ts` → PASS.
- [ ] **Step 3:** Screenshots at 1440×900 and 390×844: map with hotbar, Collection with some earned stickers and a card, Noticeboard, Settings, an "Opens later" tab.
- [ ] **Step 4:** Full checks: `npm test`, `npm run build`, the e2e specs above, `npm run e2e:sync` (re-run Highlights.test.tsx and TestingTogetherRound7 alone if they flake).
- [ ] **Step 5: Commit and push** `git push -u origin rio-menu`.

## Known limits to tell Esme (not bugs)
- The kit has no gear (Settings) or recipe icon: those tabs show a magenta placeholder until drawn.
- Collection area icons reuse the kit's farm icons (Fazenda: veg garden, Lagoa house: cottage, Ipanema: pond, Tijuca: meadow, Jardim Botânico: orchard, Boteco: saloon mug, Bonus: star). Her call.
- The pixel font has no accented letters: "Jardim Botânico" draws as "Jardim Botanico" (screen readers get the accent).
- The new "Esme's Rio" book cover isn't shown any more, as the book itself goes (Esme, 2026-11-17).
- Phones narrower than 390 px fall to 1x (the kit's phone panel is 195 UI px wide at 2x).
