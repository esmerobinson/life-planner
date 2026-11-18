# Rio play-test fixes 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix what Esme found in her first play-test of Esme's Rio (2026-11-17): scenes that don't fill the game screen, room buttons instead of doors, no hover info, an oversized menu, hard-to-read map, the nook box on the game screen, no way to arrange stickers, the noticeboard in the wrong place and old farm stickers cluttering Rio scenes.

**Architecture:** One door shape for every scene (`rio/doors.ts`: `{ id, rect, to, opens?, label }`, read from the pack's new `hotspots` entries, with app-side fallbacks where the pack has none yet) drawn as hover-able buttons over the scene canvas; the same shape is what a walking player will trigger later. Two new farm row kinds (`hidden:<sticker>`, `spot:<sticker>`) feed `placement.ts layout()`. The map and scenes keep one canvas each; hover outlines, labels and tooltips are HTML in kit pieces over it.

**Tech Stack:** React 18, TypeScript, Dexie, Vitest, Playwright (installed Chrome).

**Spec:** the coordinator's brief "Rio play-test fixes 1" (2026-11-17) with Esme's words, plus the follow-ups: no Back inside areas (the exit hotspot is the way to the map), rooms connect only through doors and stairs, any hotspot with `to: "map"` is an exit, the fazenda's barn/coop/greenhouse doors hidden until their interiors exist, the museum keeps app-side hotspots, the penthouse not imported.

## Global Constraints

- Desktop game screen only; the phone stays Collection-only (its nook unchanged).
- No new colours, easing or type beyond the kit (`rio/ui/kit.ts INK`, kit pieces); light is solid, no glow haze.
- New wording marked `// PLACEHOLDER WORDING`; placeholders magenta.
- Never delete data: hiding writes `hidden:<sticker>` (`hidden: true|false`), moving writes `spot:<sticker>`; both validated like every farm row, in backups, restores and sync.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Main JS must stay under 2 MB (lazy-load the game page if it goes over).

## Review Focus

- A spot row naming a slot that's gone, taken, or not accepting the sticker: the sticker falls back to book order, never vanishes (placement test).
- A door whose target scene isn't open yet (the sea before day 30, the barraca before day 3): no door shown (AreaView test).
- Hiding then un-hiding on two devices: the later row wins and the sticker is never lost from the Collection (state + sync tests).
- An older backup or device that doesn't know `hidden`/`spot`: held for later, never "damaged" (backup test).
- Esc while editing: cancels the pick, then leaves edit mode, before it opens the menu (AreaView test).

---

### Task 1: Scenes fill the game screen

**Files:** Modify `hub/src/rio/mapMath.ts` (coverFit/fractionalFit `place`, `sceneKeep`), `hub/src/rio/AreaView.tsx`. Test `hub/src/rio/mapMath.test.ts`.

- [ ] Failing test: `coverFit({w:1416,h:876},[384,240],[150,110,60,40],1,true)` gives `mode: "cover"`, `y <= 0`, `y + 240*scale >= 876`, keep inside. (Bug: `place()` had its keep bounds swapped, so a small keep pinned the art's top and left planks below/right: Zona Sul, the store.)
- [ ] Fix `place()` in both fits: `lo = max(view - art, -k0*s)`, `hi = min(0, view - k1*s)`.
- [ ] `sceneKeep(boxes: Rect[], scene)`: the union of the drawn stickers' 16x16 boxes and each door's centre box (at most 24x24), clipped; the centre point when empty. AreaView passes the drawn stickers and doors (free slots don't matter: nothing is drawn there).
- [ ] Probe every area's outside and inside at 1440x900; commit.

### Task 2: Doors, not buttons

**Files:** Create `hub/src/rio/doors.ts`, `hub/src/rio/doors.test.ts`. Modify `assets.ts` (read `hotspots` entries with `rect` and `to`/`opens` into `SceneData.doors`), `AreaView.tsx`, `FarmPage.tsx`, `game-screen.css`.

**Interfaces:** `export interface Door { id: string; rect: Rect; to: SceneId | "map" | null; opens?: "noticeboard" | "wardrobe"; label: string }`; `export function doorsFor(scene: SceneId): Door[]`; `export const SCENE_AREA: Record<SceneId, string>`.

- [ ] Tests: every open scene's outside has exactly one or more `to: "map"` door; every inside scene has a door back to its outside; Lagoa outside has doors to living, kitchen, bedroom and the gate to the map, and no noticeboard; Ipanema has the noticeboard (`opens: "noticeboard"`), the barraca and the (app-side) sea; the fazenda's barn/coop/greenhouse doors are hidden; the store's fitting room opens the wardrobe; the museum (app-side) has its door and stairs.
- [ ] `to` resolves: `map`; a full scene id; `outside`/`inside` (the scene's area); `<area>-inside`; an area key (its outside); `inside/<room>` and a bare room name; `fitting_room` → opens wardrobe; anything else → dropped.
- [ ] App-side fallbacks (used only where a scene has no new-shape doors): the Lagoa house outside and rooms (from its legacy `hotspots`/`exits`, the door notches 2 tiles wide), the museum plaza and hall; added where missing: the Ipanema sea door (legacy `sea` rect), living ↔ kitchen through the teal side doors, the bedroom's notch down to the living room.
- [ ] AreaView: no top-left buttons; a `button.rio-door` per door the player can use (`canEnter(scene)` from FarmPage), pointer cursor, a 1-art-pixel solid kit-cream outline and a tiny kit-tooltip label on hover/focus; click/Enter goes through (`map` → `onBack`, `opens` → `onOpenMenu(tab)`); entering another area's scene marks it visited. GameScreen Back only on the map. Update the farm e2e; commit.

### Task 3: Hover tooltips on placed stickers

**Files:** Modify `AreaView.tsx`, create `hub/src/rio/ui/Tip.tsx` (the kit tooltip: `.tip` with BitmapText lines), `game-screen.css`.

- [ ] Test: hovering a placed sticker's target shows a tooltip with its name and `hintFor` line; it sits beside the sticker box (no overlap).
- [ ] Implement; commit.

### Task 4: A smaller menu

**Files:** Modify `hub/src/rio/ui/fit.ts` (`menuFit`), its test.

- [ ] Test: `menuFit(1440, 900).menuU === 3`; the stage height is at most 70% of the screen height at 1280x800, 1440x900, 2560x1440; never above 3.
- [ ] `menuU = min(3, 0.7*vh/204, 0.9*vw/269)` on the desktop (the kit's 3x with the small font at 2 px). Clicking outside and Esc already close it (GameMenu test pins both). Commit.

### Task 5: The map shows where she can go

**Files:** Modify `RioMap.tsx`, create `hub/src/rio/outline.ts` (+ test), `game-screen.css`.

- [ ] Test: `outlineOf(alpha, w, h, bbox)` marks the transparent pixels 4-touching the place's opaque ones, inside the bbox grown by 1.
- [ ] Open places: a 1-art-pixel kit-cream outline of the open layer; a small cream label (ink shadow) under each; hover lifts the place 1 art px, pointer cursor, and a kit tooltip: name + "Visit" / "Opens on day N" / "Coming soon". Locked places: no outline, no label. Commit.

### Task 6: No nook on the game screen

**Files:** Modify `ui/AppShell.tsx` (`{phone && <Nook phone/>}`), create `hub/src/rio/GameMoments.tsx` (+ test), mount it in FarmPage (desktop).

- [ ] Test: with a queued sticker, GameMoments shows "New sticker: <name>" top centre and calls `markSeen` after the moment's length (`MOMENT_STEPS.length * MOMENT_FRAME_MS`).
- [ ] Implement; arrivals already pop up top centre. Commit.

### Task 7: Edit mode: hide and move

**Files:** Modify `farm/state.ts`, `farm/farmRepo.ts`, `farm/FarmContext.tsx`, `rio/placement.ts`, `rio/AreaView.tsx`, `rio/Hotbar.tsx`, `rio/menu/CollectionTab.tsx`, tests in `state.test.ts`, `farmRepo.test.ts`, `backup.test.ts`, `sync/farm.test.ts`, `placement.test.ts`.

**Interfaces:** `HiddenRow { id: "hidden:<s>"; kind: "hidden"; sticker; hidden: boolean; date }`, `SpotRow { id: "spot:<s>"; kind: "spot"; sticker; slot; date }`; `FarmState.hidden: ReadonlySet<string>`, `FarmState.spots: ReadonlyMap<string,string>`; `FarmView.setHidden(sticker, hidden)`, `FarmView.moveTo(sticker, slot)`; `layout(scene, placed, milestones, spots?)`; `freeSlotsFor(scene, sticker, placed, milestones, spots): Slot[]`.

- [ ] Row tests (valid/invalid shapes, farmState, backup replace/merge, a damaged row refused, sync between devices, last write wins).
- [ ] Layout tests: a valid spot is honoured first; an invalid spot falls back to book order; hidden stickers aren't laid out.
- [ ] Hotbar "Arrange" slot (kit `extra-s-hammer`) in an area toggles edit mode; in edit mode each placed sticker is a button: pick it (click or press), then a free accepting slot (kit `place-target`) to move it (drag works: release over a target), or "Hide". The Collection's card for a hidden sticker says so and offers "Show in Rio". Commit.

### Task 8: The noticeboard on the beach

- [ ] Covered by Task 2's door data: the Lagoa garden's noticeboard isn't a door; Ipanema's `noticeboard` hotspot opens the menu's Noticeboard tab. E2E: click it on the beach, the Noticeboard tab opens. Commit with Task 2 if no code is left.

### Task 9: Only Rio art in scenes

**Files:** Modify `rio/placement.ts`, `rio/collection.ts`, `rio/menu/CollectionTab.tsx`, tests.

- [ ] Test: the eight Kind notes (`hi`, `door`, `steps`, `always-welcome`, `ok`, `feather`, `candle`, `back-to-it`) are never laid out in a scene and can't be placed; every other placeable sticker still is. Their Collection cell is "kept" (no "!"), the card says "Kept in your Collection".
- [ ] Rule: a phase-1 sticker draws in a scene only if the Rio family that took its group over lives in that scene (the rio pack's manifest `place`). Kind notes' Rio family (`notes`) lives at the Lagoa letterbox, a UI hotspot, not a scene; everything else's family lives where it's laid out now. Commit.

### Finish

- [ ] Full unit suite, `npm run build` (main JS < 2 MB, else `React.lazy` the game page), farm/pwa/phone/projects e2e and `npm run e2e:sync` with `E2E_DEV_PORT=5197 E2E_PREVIEW_PORT=4197`.
- [ ] Screenshots at 1440x900 into `.superpowers/rio-play-screens/`.
- [ ] Fresh opus reviewer (superpowers:requesting-code-review); fix what's real; re-check; push `rio-play`. Never merge or deploy.
