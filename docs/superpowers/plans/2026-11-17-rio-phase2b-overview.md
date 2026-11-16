# Esme's Rio phase 2b: rewards, ingredients, Zona Sul, cooking and the wardrobe (overview)

**Spec:** `/Users/esme/Documents/coding/esmeworld-notes/rio-design.md` ("Cooking", "Cooking runs on real tasks", "Several rewards per action", "300+ recipes", "Clothes", "Screens", "Nothing is lost"); rulings in `decisions-record.md` 2026-11-09 to 2026-11-17; `farm-design-v3.md` (families, pace, "ready for phase 2"); `farm-design.md` (phase-1 promises); mockup `mockups/rio-rewards.html` (tick card A, summary A).

**Builds on:** `origin/rio-menu` (phase 1 plus the game menu) with phase 2a (`rio-areas`: Zona Sul, Jardim Botânico, Quilo, Sult, Os Esquilos, Santa Teresa, map events) merged in first. Plans 3 and 4 read the Zona Sul and Quilo scenes from 2a's `AREA_SCENES`.

## The plans, in build order

| # | File | What it builds | Needs | Size |
|---|---|---|---|---|
| 1 | `2026-11-17-rio-2b1-ledger.md` | The reward ledger: the ingredient catalogue, reward events derived from real data, gifts per event, banking, the new farm row kinds, balances, sync/backup self-tests. No screens. | rio-menu + rio-areas | L (8 tasks) |
| 2 | `2026-11-17-rio-2b2-reward-screens.md` | The v3 sticker families (87 launch stickers, outside the 175); the tick card by the + button; the end-of-day summary; a Pantry view in the menu. | 1 | L (8 tasks) |
| 3 | `2026-11-17-rio-2b3-zona-sul.md` | Zona Sul: shelves stocked by errands, coins, selling (drop boxes and the COMPRAMOS counter), buying. | 1, 2 | M (6 tasks) |
| 4 | `2026-11-17-rio-2b4-cooking.md` | Recipes ("inspired at"), kitchen tools, techniques, the recipe book tab, the cooking screen (experimenting, variations, gororoba), the pinned dish line on Today. | 1, 2, 3 | XL (10 tasks) |
| 5 | `2026-11-17-rio-2b5-wardrobe.md` | The clothing store: a piece per 6 things, rails, try-on, keep, wear, friends' hats, buying ahead, the Wardrobe tab. | 1, 2 (3 for buying ahead) | M (7 tasks) |

Plans 3 and 5 can be built at the same time once 2 is in; 4 waits for 3 (the pinned dish's "buy it at Zona Sul" path and the shared coin balance). Each plan works in its own worktree on a branch off the previous plan's branch (`rio-2b1` off `rio-menu` with `rio-areas` merged, `rio-2b2` off `rio-2b1`, ...), pushes, and never merges or deploys (Core does).

The brief suggested putting the v3 families and the tick card first. The ledger goes first instead, because the tick card, the summary, Zona Sul, cooking and the wardrobe all read it. Building it alone, with no screens, keeps the review focused on the one thing that can lose answers: stored state.

## The key decision: derive, bank and append; never count stored increments

Phase 1 stores only facts the data can't give, and works everything else out from her real tasks, habits and journal. 2b keeps that rule:

1. **Rewards are derived.** One pure function turns her real data into **reward events**, each with a stable id (`todo:<itemId>`, `habit:<itemId>:<date>`, `checkin:<date>`, ...). Each event's **gift** (which ingredients, how many) is a deterministic function of the event id (an FNV-1a hash picks from the bed's list), so every device works out the same gift with no stored dice rolls.
2. **Rewards are banked so they can't be lost.** After a day ends (the app's 3am day change), each device writes one **bank row** for that day, `bank:<date>:<deviceId>`, holding a snapshot of that day's events and gifts. The ledger is the union of the banked events and the live events, by event id:
   - a banked event stays even if its to-do is later unticked, archived or deleted ("nothing is ever taken away");
   - a live event that isn't banked yet still counts, so today works before any bank exists;
   - the same event banked by two devices counts once. If their gifts differ (different app versions or tuning), the bank row with the earliest `(date, deviceId)` wins, which is the same answer on every device;
   - changing a tuning default later never changes a banked day: the past is frozen.
   A device only ever rewrites its **own** bank row, and only to add events (a strict superset). It never removes one.
3. **Spending is append-only.** Each cook, sale and purchase is its own row with a fresh UUIDv7 id (`cook:<id>`, `sell:<id>`, `buy:<id>`). Rows are never edited or deleted, so two devices can never overwrite each other, and a balance is always "everything gained − everything spent", summed over rows.
4. **Balances never show below zero.** For each ingredient, what she has = gained + bought − used − sold, floored at 0, and coins likewise. Only two things can push the sum below zero: two offline devices spending the same thing, or a same-day untick after cooking. Then the debt quietly absorbs later gains of that ingredient. Nothing she earned and still holds is ever removed.
5. **Choices that must stay fixed are stored when shown**, like phase 1's `seen`: a recipe becomes hers (`recipe:<dish>`) when its "inspired" card plays, and a wardrobe piece she keeps (`kept:<piece>`) when she chooses it. How many recipes or pieces she is owed is derived (things done ÷ 8, ÷ 6); which ones she gets is stored.
6. **Last-write-wins only where it's honest:** the pinned dish (`pin:dish`) and what each character is wearing (`wear:<who>`) are single preferences, and the latest choice is meant to win.

Everything lives in the existing synced `farm` table as new row kinds. This needs no server change (the Worker only checks the table name and the row size) and no Dexie version bump (`farm` is indexed by `id, kind`). Older app builds still in use (an un-updated Mac app or phone) hold the new kinds in quarantine and apply them once they update (`engine.ts` quarantine; `backup.ts` `farmLater`), so nothing is lost on a mixed fleet.

### New farm row kinds (all defined and validated in plan 1)

| Kind | Id | Fields | Written by | Conflicts |
|---|---|---|---|---|
| `bank` | `bank:<date>:<deviceId>` | `date`, `device`, `events: BankEvent[]` (≤ 500) | plan 1, on open, for each ended day not yet banked (or with new events) | own row only, superset only |
| `sorted` | `sorted:<itemId>` | `item`, `date` | plan 1, when an Inbox item is filed into an area (not derivable: items don't record that they were in the Inbox) | one per item, written once |
| `recipe` | `recipe:<dishKey>` | `dish`, `date`, `from` (restaurant key) | plan 4, when the inspired card plays | same id on both devices = same fact |
| `cook` | `cook:<uuid>` | `date`, `used` (ingredient → n), `technique`, `tool` (or null), `result` (dish key, `<dish>~<ingredient>` variation, or `gororoba`) | plan 4 | append-only |
| `sell` | `sell:<uuid>` | `date`, `via` (`dropbox` / `counter`), `items` (ingredient or dish key → n), `coins` (price frozen at sale) | plan 3 | append-only |
| `buy` | `buy:<uuid>` | `date`, `coins`, and either `ingredient` + `n` or `piece` | plans 3, 5 | append-only |
| `pin` | `pin:dish` | `dish` (or null) | plan 4 | last write wins (a preference) |
| `kept` | `kept:<pieceKey>` | `piece`, `date` | plan 5, when she keeps a piece after trying it on | written once |
| `wear` | `wear:<who>` (`esme` or a character id) | `pieces` (slot → piece key) | plan 5 | last write wins (a preference) |
| `summary` | `summary:<date>` | `date` | plan 2, when she presses "Good night" | written once |

`BankEvent` = `{ e: eventId, k: EventKind, d: date, a?: area, f?: ("big" | "errand")[], i?: itemId, g: ingredient → n }`. Counts are whole numbers from 1 to 999, and a record holds at most 20 keys. Keys follow the farm `KEY` pattern. A row that names a key this build's catalogue doesn't know (a dish from a later pack) is still valid: it is kept and synced, and the balances leave it out of what they show.

### What stays derived (no rows)
Ingredients gained; Zona Sul's unlocked shelf (the first N of the shelf order, where N is the number of errands); things done (for the recipe and wardrobe pace); recipes owed; kitchen tools (days the day's list was done); techniques (habit sessions); v3 stickers (counters, kept by `seen` rows as in phase 1); wardrobe pieces arrived; the pinned dish's "N to-dos away".

## Reward events and gifts (plan 1). Every number here is `DEFAULT: Esme to confirm`
| Real action | Event id | Gift | Also |
|---|---|---|---|
| A to-do ticked (not a habit, not Inbox) | `todo:<itemId>` | 2–3 from its area's bed | a "thing" |
| …a big one (priority 1) | same event, flag `big` | +1 rare ingredient | museum family step |
| …an errand (Admin area, or tagged `errand`) | same event, flag `errand` | unlocks the next Zona Sul shelf ingredient for good, +2 of it to take home | |
| A project session ticked | `session:<itemId>:<sessionId>` | 1 from its area's bed | a thing |
| A habit session | `habit:<itemId>:<date>` | 1 animal product (egg, milk, butter or cheese) | a thing; Tijuca wildlife step |
| A check-in day | `checkin:<date>` | 1 fish on about 1 day in 3 (hash). Never sellable | a thing; beach-life step |
| A mental health exercise day | `exercise:<date>` | — | a thing; sea-fish step |
| Morning pages | `morning:<date>` | — | a thing; orchid-house step |
| An Inbox item sorted | `sorted:<itemId>` | — | a thing; Barraca step |
| A reading-list book finished | `book:<itemId>` | — | a thing; reading-nook step |
| The day's list finished | `list:<date>` | a fazenda basket: 3 from the beds of that day's to-dos | kitchen-tool step (not a thing) |

Steady day (5 to-dos, 3 habits, a check-in, an exercise, morning pages, a finished list): about 19 ingredients, 11 things, 1.4 recipes and 1.8 wardrobe pieces. That matches the spec's 15–20 ingredients and "slightly over one recipe a day". Journal events only come from a device where the journal opens. Once banked there, they count everywhere, and a bank row carries only dates and kinds, never journal words (the server already sees journal row dates). Weekly and monthly reviews, goal-step decor and the whole-goal feast are not in 2b: their parts of the app aren't built.

## Sync, backup and restore
- **Sync:** new kinds ride the `farm` table, with the same change tracking and the same last-write-wins by `updatedAt`. Append-only ids can't collide. A device's own bank row only grows.
- **Old builds:** a row kind an old build doesn't know is quarantined and kept, then applied once that build updates. Plan 1 tests that phase-1 `farmState` ignores the new kinds and still reads every old one.
- **Backup:** `exportBackup` already writes every farm row; `parseBackup` checks each with `validFarm`, so plan 1's validators guard backups too. A damaged row of a known kind refuses the whole file, as now.
- **Replace-restore** brings back exactly the file's rows: spending after the backup disappears, so those ingredients and coins come back, and recipes learned since are owed again and re-chosen in the same order. **Merge-restore** adds only missing rows, so spending is the union and nothing doubles. Plan 1 tests both.
- **Self-tests every plan adds** (Esme's top rule): a two-device sync test of its rows (`hub/src/sync/` fake server); a backup round trip of its rows; a "balances never negative" property test; the farm, pwa, phone and sync e2e specs before pushing.

## Decisions for Esme (each with the default the plans build)
1. **Untick on the same day takes the reward back**, until 3am banks the day. After that it's hers for good. *Default: yes.*
2. **What's an errand?** *Default: any Admin to-do, or any to-do tagged "errand".*
3. **What's a big to-do?** *Default: priority 1.*
4. **When do recipes and clothes start counting?** From the day their place opens: the Quilo (cooking) on day 30, the clothing store on day 5, as she approved. Counting from day 1 would hit her with about 35 recipes at once. *Default: count from opening, plus 3 starter "home basics" recipes on cooking's opening day.*
5. **Do v3 stickers count toward the 175, the crown, friends and hats?** *Default: no. Phase-1 counts stay exactly as they are; v3 families have their own totals.*
6. **An experiment uses up its ingredients, even a gororoba.** *Default: yes, with a confirm step.*
7. **Selling:** the drop box pays next morning; Zona Sul's counter pays at once, at the same fixed price. *Default: yes.*
8. **Fish and seafood never sell** (they come from check-ins, and the journal never earns coins). *Default: yes.*
9. **Cooked dishes can be sold** for 2× their ingredients' value (the "make" step of the loop). *Default: yes.*
10. **End-of-day summary:** opens once after 21:00 local time, or at the next open if missed, and is always reachable from the menu. *Default: Mac/desktop only.* Following "no game on phone", the tick card and the pinned dish line are desktop only too.
11. **The 3 drawn kind notes** (heart, sunshine, rainbow): *default: Rio pictures for three existing kind notes, not new stickers.*
12. **The 30 winter outfits:** *default: they arrive last, after the 60 FARM-style pieces* (or hers from day one).
13. **Buying clothes ahead:** *default: the next 3 pieces, 30 coins each.*
14. **Two offline devices selling the same harvest** both get paid. *Default: accepted* (rare, and nothing she owns is lost).
15. **Weather for night and rain stickers:** the night and rain v3 stickers need Rio's weather even when the game isn't open, so the app makes its one small weather request whenever it's open. *Default: yes* (only Rio's fixed coordinates are sent).
16. **Tuning tables:** bed → ingredients, yields, prices, the kitchen-tool ladder, the technique ladder, recipes per 8 things and pieces per 6 things. All in one `tuning.ts` per plan, each line marked `// DEFAULT: Esme to confirm`.

## Art still needed
Already delivered and used by the plans: `cooking/` (six technique animations: frying, baking, blending, dough, grilling, mixing drinks; a gororoba animation and sticker; stations; the stage; the reveal card), `dishes-batch2/` (44 dishes, so 112 drawn and taught), `wardrobe-batch2/` (30 pieces, with icons and friend overlays). Still needed:
- Ingredient icons: milk, butter, prawns (camarão), saffron (açafrão), cashew nuts (castanha); also the other beds' produce if Esme wants different fruit and vegetables than the reused `garden-*` set.
- Kitchen tool icons (about 10: pan, pot, knife, blender, pressure cooker, oven, grill, cocktail shaker, wood oven, ice-cream maker).
- A slow-cooking animation and station (stews; the other six are drawn), and a `stove` hotspot in the Lagoa kitchen's slots.
- Gororoba's joke page picture; a small "variation" mark.
- A coin icon and a coin counter piece for the HUD; drop-box hotspots at the fazenda gate and the kitchen door (scene slots).
- Recipe book page layout pieces (if the kit's Collections grid isn't enough) and a "missing ingredient" ghost style.
- 16×16 icons for the 30 day-one Rio wardrobe pieces (batch2 has them), shown on the store rails.
- Friend-sized versions of more pieces (hats, earrings, necklaces and bags exist; Caetano has no earrings).
- Zona Sul has 8 fruit and veg crates for 24 fruit and veg ingredients: the plan overflows into any free slot so all 45 show. More crates would look better.
- The remaining ~210 dish stickers toward 320 (only dishes with art are taught, so the pace waits for art and never shows a placeholder dish).
- Until art lands, placeholders follow the repo rule: magenta, system font, linear easing.

## Not in 2b
The whole-goal feast, goal-step house decor, weekly/monthly review rewards (the drinks ingredients, the match, the boteco), holiday takeovers (2a's events), vinyl records, the penthouse and other space purchases, craftables.
