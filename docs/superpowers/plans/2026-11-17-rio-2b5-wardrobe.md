# Esme's Rio 2b-5: the clothing store and the wardrobe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new FARM-style piece arrives on the clothing store's rails for every 6 real things she does. She tries pieces on in the fitting room, keeps the ones she likes for her wardrobe at home, dresses her character, can buy a piece ahead with coins, and the friends wear the pieces that have friend-sized art.

**Architecture:** Which pieces have arrived is **derived**: things done since the store opened (plan 1's ledger) ÷ `PIECE_EVERY`, in a fixed arrival order, plus pieces bought ahead (`buy` rows with `piece`). Only choices are stored, all as rows plan 1 already defines: `kept:<piece>` (in her wardrobe), `wear:<who>` (what Esme or a friend has on: a preference, last write wins) and `buy:<id>` with `piece`. Pure modules in `hub/src/rio/wardrobe/` hold the catalogue, the arrivals and the layer composition. React draws the rails in the store's inside scene, the Try-on dialog and the menu's Wardrobe tab.

**Tech Stack:** React 18, TypeScript, Vite (`import.meta.glob`), Dexie, Vitest + Testing Library, Playwright.

**Spec:** `/Users/esme/Documents/coding/esmeworld-notes/rio-design.md` ("Clothes"; "Her character and wardrobe" stays); decisions-record.md 2026-11-09 (friends wear the same wardrobe; the store sells space and pieces before they arrive, never duplicates; outfits are offered, never put on for her), 2026-11-14 (FARM Rio style), 2026-11-17 (friends' names; phone is Collection only); overview `2026-11-17-rio-phase2b-overview.md`; plan 1 `2026-11-17-rio-2b1-ledger.md`; plan 2 `2026-11-17-rio-2b2-reward-screens.md`.

## Global Constraints

- Only real things bring pieces. Nothing in the game creates one. Coins (from selling the harvest) only bring a piece **earlier**, and a piece can never be bought twice or bought once it has arrived.
- Nothing is ever taken away. An arrived piece stays on the new-arrivals rail until she keeps it (no timer, no expiry), and a kept piece stays kept. Arrivals never shrink: they count banked things (plan 1), so an untick after the 3am bank changes nothing. No phase-1 row is rewritten: `outfit:<character>` rows and the phase-1 accessories stay exactly as they are.
- A piece is never put on for her: `wear:` rows are only written by her own Wear or Take off (2026-11-04).
- Only pieces with art are offered: a catalogue piece whose PNG didn't import is left out of the arrival order. Pieces from `options/`, `previews/` or `_scratch/` are never imported.
- Rows only via plan 1's builders `keptRow`, `wearRow`, `buyRow` and `newId`. No new row kinds, no Dexie version bump.
- Never choose colour, easing, type, composition or timing (repo CLAUDE.md). Kit pieces and `BitmapText` only. Anything the kit lacks is a magenta placeholder in the system font. Any motion is linear and uses `farm/motion.ts` constants.
- Every new piece of wording is marked `// PLACEHOLDER WORDING`. Every tuning value is in `hub/src/rio/wardrobe/tuning.ts`, each line `// DEFAULT: Esme to confirm`.
- Phone: nothing new (Esme, 2026-11-17: "no game on phone other than stickers collected UI").
- Esme's top rule ("never lose answers"): never skip the save and self-test checks. Before pushing, run `npm test`, `npm run build`, `npx playwright test e2e/farm.spec.ts`, the pwa and phone specs, and `npm run e2e:sync`.
- Work in `.claude/worktrees/rio-2b5` on branch `rio-2b5`, off `rio-2b3` (Zona Sul brings the coin balance and the buy pattern), or off `rio-2b2` with Task 4's buying held back until 2b3 lands. Push; never merge or deploy.

## Review Focus

1. **Things unticked after the day was banked:** the arrived count, and so the rail, never goes down. (Task 2 test.)
2. **Two devices keep the same piece offline:** after sync there is one `kept:` row and the piece shows once. Two devices dress Esme differently: the latest `wear:esme` wins and every kept piece is still in the wardrobe. (Task 7 two-device test.)
3. **Buying ahead with too few coins, twice for the same piece, or for a piece that arrived meanwhile on another device:** refused with nothing written; a second `buy` for one piece is never stored. (Task 4 tests, the re-check inside the transaction.)
4. **A dress put on over a top and trousers, then a top put on over the dress:** never two garments in one place. The dress clears the top and bottoms; the top clears the dress. Shoes draw under anything that `covers_legs`. (Task 3 tests on `wearWith` and `composeLayers`.)
5. **A friend who hasn't arrived yet, or a piece with no friend-sized art:** the friend isn't offered it, and clearing a friend's piece brings back the phase-1 accessory she chose. (Task 6 tests.)

---

### Task 1: Bring in the wardrobe art and its catalogue

**Files:**
- Create: `hub/scripts/import-rio-wardrobe.mjs`, `hub/src/assets/rio/wardrobe/**` (copied), `hub/src/rio/wardrobe/pieces.ts`, `hub/src/rio/wardrobe/tuning.ts`
- Test: `hub/src/rio/wardrobe/pieces.test.ts`

**Interfaces:**
- Consumes: `CHARACTERS`, `type CharacterId` (`farm/state.ts`).
- Produces:
  - `type WardrobeSlot = "hair" | "hat" | "top" | "dress" | "bottoms" | "shoes" | "swim" | "coat" | "bag" | "neck" | "ears" | "hands" | "glasses" | "face"`. The Rio manifest's `outer` maps to `coat`; week1's slots are kept as they are.
  - `interface Piece { key: string; name: string; slot: WardrobeSlot; layer: string; file: string; sleeves?: string; coversLegs?: boolean; replaces?: WardrobeSlot[]; starter: boolean; arrival: number | null /* 1-based place in the arrival order; null for starters */; icon: string /* 16×16 URL, "" if none */; friendArt: Partial<Record<CharacterId, string>> }`.
  - `PIECES: readonly Piece[]`, `PIECE_BY_KEY: ReadonlyMap<string, Piece>`, `ARRIVAL_ORDER: readonly string[]`, `STARTERS: readonly string[]`, `BODY: { file: string; arms: string; idleDownFrame: number; armsOverHat: readonly number[]; hairClipY: Partial<Record<string, number>> }`, `LAYER_ORDER: readonly string[]`.
  - `FRIEND_ART_KEY: Record<Exclude<CharacterId, "duvet">, string>` = `{ domino: "mr-cat", bap: "friend-frog", puddle: "friend-pup", clover: "friend-bunny", crumpet: "friend-bear" }`.
  - In `tuning.ts`: `ARRIVAL_SOURCES = ["rio-day1", "rio-batch2", "esme-week1"]` (in that order), `STARTER_WORN = { hair: "hair-long", top: <first starter top>, bottoms: <first starter bottoms>, shoes: <first starter shoes> }`, `BUY_AHEAD_COUNT = 3`, `BUY_AHEAD_PRICE = 30`. Each line `// DEFAULT: Esme to confirm`.
- [ ] **Step 1:** Write `import-rio-wardrobe.mjs <art dir>`. It copies these into `src/assets/rio/wardrobe/{body,rio-day1,rio-batch2,esme-week1,friends}/`, with only `.png` and `.json` and never `previews/`:
  - `final/esme-pack/day1/character/` (`esme-body`, `esme-arms`, the 24 starter items in its manifest);
  - `final/rio-pack/day1/wardrobe/`;
  - `final/rio-pack/wardrobe-batch2/` (its `icons/` and `friends/`);
  - `final/esme-pack/week1/wardrobe/` (the 30 winter parcel outfits);
  - `final/rio-pack/friends/wardrobe-friend/`, `friends/bebe/`, `friends/cereal/` (friend overlays).

  A missing folder is skipped with a line in the output, so batch2 arriving later is a re-run. It prints counts per folder. Run it on `/Users/esme/Documents/coding/esmeworld-notes/art`.
- [ ] **Step 2: Failing tests:**
  - `STARTERS` has the 24 items marked `starter` in the esme-pack manifest.
  - `ARRIVAL_ORDER` is the 30 Rio day-one pieces by manifest `order`, then the batch2 pieces by `parcel_order` (31–60), then the 30 week1 pieces by `parcel_order`. It has no duplicates and contains no starter.
  - Every key in it has a `file` URL.
  - `dress-macaw-tiered-maxi` has `slot "dress"`, a `sleeves` URL, `coversLegs: true` and `replaces: ["top","bottoms"]`.
  - `swim-bikini` replaces `["top","bottoms"]`; `swim-printed-swimsuit` replaces `["top"]`; `outer-kimono` is slot `coat`.
  - `hat-big-straw` has `friendArt` for all five of `domino`, `bap`, `puddle`, `clover`, `crumpet` and `BODY.hairClipY["hat-big-straw"]` set; `dress-pineapple-midi` has no `friendArt`.
  - `LAYER_ORDER` keeps each manifest's own `layer_order.all_directions` as a subsequence.
- [ ] **Step 3:** Run `npx vitest run src/rio/wardrobe/pieces.test.ts` → FAIL.
- [ ] **Step 4: Implement** with globs as `rio/assets.ts` does.
  - `replaces` comes from the manifests' notes: a dress replaces top and bottoms, the swimsuit the top, the bikini top and bottoms.
  - `friendArt[c]` is the overlay `<FRIEND_ART_KEY[c]>-<piece>.png` from any friend folder (the bebe and cereal folders name files `friend-bunny-<piece>` / `friend-bear-<piece>`).
  - `LAYER_ORDER` is the Rio order, with week1's extra layers (`scarf`, `hands`, `glasses`, `face`, `mittens`) inserted where week1 puts them. Write the merge as a pure function and test it.
  - A piece whose PNG is missing is left out.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** "Rio wardrobe: bring in Esme's body, the Rio and winter pieces and the friend overlays".

### Task 2: What has arrived

**Files:**
- Create: `hub/src/rio/wardrobe/arrivals.ts`
- Test: `hub/src/rio/wardrobe/arrivals.test.ts`

**Interfaces:**
- Consumes: `Ledger`, `thingsSince` (plan 1); `PIECE_EVERY`, `paceStart(start, place): ISODate | null` (plan 2); `FarmState.kept`, `FarmState.buys` (plan 1); `ARRIVAL_ORDER`, `STARTERS` (Task 1).
- Produces:
  - `interface Wardrobe { arrived: readonly string[] /* arrival order */; newArrivals: readonly string[] /* arrived, not kept */; owned: readonly string[] /* starters + kept */; buyable: readonly string[] /* next BUY_AHEAD_COUNT not arrived */; nextIn: number | null /* things to the next piece */ }`.
  - `wardrobe(l: Ledger, s: FarmState, start: ISODate): Wardrobe`. Earned = `min(ARRIVAL_ORDER.length, floor(thingsSince(l, paceStart(start, "clothing-store")) / PIECE_EVERY))`. `arrived` = the first *earned* pieces of `ARRIVAL_ORDER` that weren't bought, plus every bought piece, in arrival order; a bought piece doesn't use up an earned slot. `nextIn` = things to the next earned piece (null when the order is used up).
- [ ] **Step 1: Failing tests:**
  - 0 things → nothing arrived, `nextIn === 6`.
  - 13 things since the store opened → 2 arrived (the first two of the order), `nextIn === 5`.
  - Things before the store's opening day don't count.
  - A `kept:` row for piece 1 → piece 1 is in `owned`, not in `newArrivals`.
  - A `buy` for piece 5 with 6 things → arrived = pieces 1 and 5, and `buyable` starts at piece 2.
  - With 12 things the same buy gives pieces 1, 2 and 5 (buying never costs an arrival).
  - A ledger whose live to-do was unticked but whose event is banked arrives the same as before (build both ledgers with plan 1's `buildLedger`).
  - `kept:` naming a key no catalogue knows is ignored, with no error.
  - Starters are always in `owned`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio wardrobe: a piece arrives for every 6 things".

### Task 3: Dressing rules and the layered picture

**Files:**
- Create: `hub/src/rio/wardrobe/dress.ts`, `hub/src/rio/wardrobe/EsmePic.tsx`
- Test: `hub/src/rio/wardrobe/dress.test.ts`

**Interfaces:**
- Produces:
  - `type Worn = Readonly<Partial<Record<WardrobeSlot, string>>>`.
  - `wearWith(worn: Worn, piece: string): Worn`: puts the piece in its slot, clears the slots it `replaces`, and clears any worn piece whose `replaces` includes the new piece's slot (a top clears a dress).
  - `takeOff(worn: Worn, slot: WardrobeSlot): Worn`.
  - `wornOf(s: FarmState): Worn`: the `wear:esme` row's pieces that are in the catalogue, else `STARTER_WORN`.
  - `composeLayers(worn: Worn, frame: number): { layer: string; file: string }[]`. It is the body, then each worn piece's `layer` (and `<layer>_sleeves` from `sleeves`) and `arms`, in `LAYER_ORDER`, with these rules:
    - `shoes` before `bottoms`/`dress`/`swim` when any worn piece `coversLegs`;
    - arms and every `*_sleeves` after `hat` when `frame` is in `BODY.armsOverHat`.
  - `hairClip(worn: Worn): number | null`: `BODY.hairClipY[worn.hat]` or null.
  - `<EsmePic worn frame? size? />`: draws `composeLayers` at the idle-down frame on a 32×32 canvas, at a whole-number scale, skipping hair pixels above `hairClip` (as `farm/sprites.ts` draws characters).
- [ ] **Step 1: Failing tests:**
  - Top + trousers, then `wearWith` a dress → `{ dress }` only, with hair and shoes kept.
  - Then a top → the dress gone.
  - A bikini clears top and bottoms; the swimsuit clears only the top.
  - `takeOff(worn, "hat")` clears only the hat.
  - `composeLayers` with a covers-legs skirt puts `shoes` before `bottoms`; with jeans, `bottoms` before `shoes`.
  - Sleeves layers come after `arms`.
  - On an `armsOverHat` frame, `arms` comes after `hat`.
  - `wornOf` with a `wear:esme` naming an unknown piece leaves that slot out.
  - `wornOf` with no row is `STARTER_WORN`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio wardrobe: dressing rules and Esme's layered picture".

### Task 4: Keeping, wearing and buying ahead

**Files:**
- Modify: `hub/src/farm/farmRepo.ts`, `hub/src/farm/FarmContext.tsx`
- Test: `hub/src/farm/wardrobeRepo.test.ts`

**Interfaces:**
- Consumes: `keptRow`, `wearRow`, `buyRow`, `farmState` (plan 1, Task 2); `newId`; `buildLedger`, `economy` (plan 1); `wardrobe`, `wearWith` (Tasks 2–3).
- Produces:
  - `farmRepo.keepPiece(piece: string, today: ISODate): Promise<void>`: writes `kept:<piece>` only if the piece is in `PIECE_BY_KEY` and no `kept:` row exists. Keeping twice is a no-op.
  - `farmRepo.setWear(who: "esme" | CharacterId, pieces: Worn): Promise<void>`: writes `wear:<who>`. It refuses a piece that isn't a starter and isn't kept, and for a friend a piece without `friendArt[who]`. An empty `pieces` is a valid "nothing on".
  - `farmRepo.buyPiece(piece: string, coins: number, today: ISODate): Promise<"bought" | "short" | "not-for-sale">`. This is plan 3's buy pattern: one `rw` transaction on `db.farm` re-reads every farm row and recomputes the coin balance as `economy(buildLedger([], []), farmState(rows), today).coins` (coins don't depend on the ledger; use plan 3's helper if it adds one). It refuses unless `coins === BUY_AHEAD_PRICE`, the balance is at least `coins`, no `buy` row already names the piece, and the piece isn't already arrived by the stored rows' count. On success it writes `buyRow(newId(), today, coins, { piece })`.
  - `FarmView` gains `wardrobe: Wardrobe | null`, `keepPiece`, `setWear`, `buyPiece` (bound to `today`).
- [ ] **Step 1: Failing tests:**
  - `keepPiece` twice → one row, the first date kept.
  - `setWear("esme", { dress: <not kept> })` throws, with nothing written.
  - `setWear("bap", { hat: "hat-big-straw" })` once that hat is kept is fine; `setWear("bap", { hat: "hat-headscarf" })` without keeping it throws.
  - `buyPiece` with 29 coins → `"short"`, nothing written.
  - With 60 coins → `"bought"`, then the same piece again → `"not-for-sale"` (one `buy` row).
  - Two `buyPiece` calls for different pieces started together with 30 coins → exactly one `"bought"`.
  - A piece that has already arrived → `"not-for-sale"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** "Rio wardrobe: keep, wear and buy ahead (never twice, never short)".

### Task 5: The store's rails and the Try-on dialog

**Files:**
- Create: `hub/src/rio/wardrobe/rails.ts`, `hub/src/rio/wardrobe/TryOn.tsx`
- Modify: `hub/src/rio/AreaView.tsx` (an `overlay` for `clothing-store/inside` and the fitting-room hotspot), `hub/src/rio/assets.ts` (read the hook slots)
- Test: `hub/src/rio/wardrobe/rails.test.ts`, `hub/src/rio/wardrobe/TryOn.test.tsx`

**Interfaces:**
- Consumes: `inside-slots.json` from `clothing-store/inside`: the `rail-new-arrivals-1..3` hooks (full state), the `rail-*` hooks (start: `rail-warm-1`, `rail-mixed-1`), `fitting-hook`, `try-on`. Also `FarmView.wardrobe` and the repo functions (Task 4), `EsmePic` (Task 3), the kit pieces and `BitmapText`.
- Produces:
  - `hangOnRails(newArrivals: readonly string[], state: "start" | "full"): { slot: string; piece: string }[]`. In the full state the newest three go on the new-arrivals hooks, then the rest on the other `rail-*` hooks in slot order. In the start state they use the two start hooks. Any left over are counted as `more` (shown as "N more on the rails", as the area shows overflow).
  - `AreaView` prop `overlay?: (scene: SceneId) => ReactNode`, drawn in scene pixels over the base and under the rain. For `clothing-store/inside` it draws each hanging piece's 16×16 `icon` (anchor top at the hook; a magenta 16×16 if it has none) as a button labelled with the piece's name. The `fitting-hook`/`try-on` area is a button "Try on".
  - `<TryOn view onClose start?: string />`: a kit dialog (modal, focus in, Esc closes, focus returns). On the left is `EsmePic` wearing her current outfit with the tried piece over it (`wearWith`, never saved until Wear). On the right are the new arrivals, then owned pieces by slot, as kit slots with 16×16 icons. Buttons:
    - **Keep** (only for a new arrival): `keepPiece`.
    - **Wear** (owned only, so a new arrival needs Keep first): `setWear("esme", …)`.
    - **Take off** (per slot).
    - **Buy ahead** (the `buyable` pieces, price and coins shown): `buyPiece`, with "Not enough coins yet" when short.

    All wording is `// PLACEHOLDER WORDING`.
- [ ] **Step 1: Failing tests:**
  - `hangOnRails` with 5 new arrivals in full → the 3 newest on `rail-new-arrivals-1..3`, 2 on rail hooks, `more` 0.
  - With 40 → `more` > 0 and no hook used twice.
  - (RTL) Opening Try on with one new arrival shows it. Keep → its `kept:` row is written and it moves to the owned list. Wear → `wear:esme` holds it. Nothing is written before a button is pressed. Esc closes and focus returns to the "Try on" button.
  - Buy ahead with too few coins shows the short message and writes nothing.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, plus `npx vitest run src/rio`.
- [ ] **Step 5: Commit** "Rio wardrobe: new arrivals on the rails, and the fitting room".

### Task 6: The Wardrobe tab and friends wearing pieces

**Files:**
- Create: `hub/src/rio/menu/WardrobeTab.tsx`
- Modify: `hub/src/rio/menu/GameMenu.tsx` (wardrobe → `WardrobeTab`; `LaterTab` stays for anything else), `hub/src/farm/CharacterPic.tsx`, `hub/src/farm/Nook.tsx`, `hub/src/farm/sprites.ts` (`drawCharacter` takes an optional overlay sheet)
- Test: `hub/src/rio/menu/WardrobeTab.test.tsx`, `hub/src/farm/friendWear.test.ts`

**Interfaces:**
- Consumes: `TabProps` (`GameMenu.tsx`); `wornOf`, `wearWith`, `takeOff`, `EsmePic`; `FarmView.arrived`, `state.wear`, `state.outfits`; `FRIEND_ART_KEY`.
- Produces:
  - `friendWorn(s: FarmState, c: CharacterId): string | null`: the friend's `wear:` hat (and later ears, neck, bag; one per slot), only if it has `friendArt[c]`.
  - `CharacterPic`/`Nook` draw that overlay instead of the phase-1 accessory while it is set. With no `wear:` row, or an empty one, the phase-1 accessory shows as now. The `outfit:` row is never touched.
  - `WardrobeTab`: Esme's picture in the middle, with owned pieces by slot as kit slots (the panel never scrolls; it pages with the kit arrows as the Collection does). Choosing a piece is Wear and choosing it again is Take off. Under it, a Friends row: each arrived friend's portrait and the owned pieces that friend has art for. "None" writes an empty `wear:<c>`.
  - Before writing `friendWorn`'s drawing, check the overlays' frame grid matches the friend sheets the app draws (`char-<id>` in `farm/sprites.ts`). The rio-pack overlays are 1:1 with the rio-pack friend sheets. If the app still draws the old phase-1 friend sheets, this task also imports the rio-pack friend base sheets (NEXT.md: "Phase 2 app build must import the rio-pack friend sheets") and points `CharacterPic` and `Nook` at them, with a test that every pose frame index still exists.
- [ ] **Step 1: Failing tests:**
  - (pure) `friendWorn` returns the kept hat for `bap` when set, and null for a piece without frog art.
  - Clearing it returns null, and `state.outfits.get("bap")` is unchanged throughout.
  - (RTL) The tab lists starters and kept pieces, not new arrivals.
  - Choosing a dress writes `wear:esme` with no top.
  - A friend not yet arrived isn't listed.
  - A friend is offered only pieces that are kept and have its art.
  - `duvet` never appears.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, plus `npx vitest run src/rio/menu src/farm`.
- [ ] **Step 5: Commit** "Rio wardrobe: the Wardrobe tab, and friends wearing what they have art for".

### Task 7: Self-tests

**Files:**
- Test: `hub/src/sync/wardrobe.test.ts`, `hub/src/farm/backupWardrobe.test.ts`, `hub/e2e/rio-wardrobe.spec.ts`

**Interfaces:**
- Consumes: `FakeSyncServer`, `syncOnce`, `saveSyncSettings` (as `sync/farm.test.ts`); `exportBackup`, `parseBackup`, `restoreBackup`; everything above.
- [ ] **Step 1: Failing tests:**
  - **Two devices:**
    - Both keep piece 1 offline → after sync, one `kept:` row on each.
    - A wears a dress, B later wears trousers → both show B's outfit, and both pieces stay kept.
    - A buys piece 5 and B buys piece 5 offline → after sync, two `buy` rows with distinct ids. Arrived still lists piece 5 once, and the coins reflect both: the overview's offline-overspend case, floored at 0 by plan 1's `economy`.
  - **Backup:** `kept`, `wear` and `buy`-with-`piece` rows survive a replace round trip. A merge onto a device with its own `wear:esme` keeps the device's (as for `outfit:` today). A `wear:` row naming `who: "duvet2"` → `INVALID_BACKUP`.
  - **e2e (farm config):** with the farm's `start` row seeded 8 days back (as `e2e/farm.spec.ts` `startedFarm` does) and 12 done to-dos seeded after the store's opening day (day 5):
    1. open the clothing store's inside and see 2 pieces on the new-arrivals rail;
    2. Try on, Keep, Wear;
    3. back on the map, open the menu's Wardrobe tab: the kept piece is listed and selected;
    4. reload: still the same.

    At 390×844 the Rio page shows only the Collection (no store, no Try on).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Fix anything they find (no new features). **Step 4:** Run `npm test`, `npm run build`, `npx playwright test e2e/farm.spec.ts e2e/rio-wardrobe.spec.ts`, the pwa and phone specs, `npm run e2e:sync` → all PASS.
- [ ] **Step 5: Commit** "Rio wardrobe: self-tests across devices, backups and the store", then push `rio-2b5`.

## Decisions for Esme (defaults built)
- **The 30 winter outfits** already drawn: *default: they arrive last in the order, after the 60 FARM-style pieces.* The alternative is that they're hers from the start.
- **What she wears on day one:** long hair and the first starter top, bottoms and shoes; skin and hair colours stay the first colour set until a colour choice is designed.
- **Buying ahead:** the next 3 pieces, 30 coins each.

## Art still needed
- Friend-sized versions of more pieces. Today only hats, earrings, necklaces and bags have them, and Caetano has no earring art.
- Bebe and Cereal wearing them (their folders cover some).
- A try-on mirror or frame piece and a 16×16 icon for each day-one Rio piece (batch2 has `icons/`; day one doesn't; until then the rails show a magenta placeholder).
- A hanger sprite for pieces on the rails, if the icon on a hook reads wrong.
