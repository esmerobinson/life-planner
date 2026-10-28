# Visual language (Esmeworld)

The source for art direction, per `CLAUDE.md`. Status of each line: **said** = Esme's words; **extracted** = sampled from her reference images, not invented, awaiting her confirmation; **placeholder** = not decided, deliberately ugly.

## Said (2026-10-27)
- Animal Crossing feel, cute, cosy. Notion's clean layout underneath.
- Loves the NookPhone app grid (rounded-square tiles, one flat colour each, chunky icon).
- Likes the colours, the rounded panels and the icons in the references.
- Likes the Animal Crossing-styled Notion dashboards on Pinterest (village header, calendar and checklist panels, character tiles).
- Progress is shown as bars. Completion gets confetti and stars. Dark mode wanted, simple.

## Said (2026-10-28, design round 2)
- Tasks are hard to pick out everywhere they're listed; she wants a clean, clear list with a box around each task.
- **Chosen: task "Strips" (option A).** Every task is its own rounded strip (`--row` on the page, radius `--radius-tile`), tick box on the left = Done, actions on the right. Applies everywhere tasks appear (area pages, Today, Inbox, Goals). Mockup: round-1 option A.
- Done / Move to / Schedule for should not be three loose buttons. **Chosen: round-2 option 1B, two small icons** always visible at the right of each strip: a line-drawn calendar (Schedule for) and a line-drawn right arrow (Move to), each in a 30px `--panel` square with 8px radius, 16px glyph, 1.6 stroke in `--text`. Ticking the box is Done.
- The OVERDUE label "looks horrible". **Chosen: round-2 option 2D, just words**: no sticker; a small line under the title "Due Mon 26 Oct", which turns Happy Home red `#bf6564` and adds "· 2 days late" when overdue. The magenta `.overdue-sticker` placeholder is retired.
- Hates how goals are displayed everywhere. **Chosen: goals are cards (round-2 option 3A)** to set them apart from tasks: one `--panel` card per goal, area tile, chips for area and "By <date>" / "Practice", overall bar and this-month bar, next step in a `--row` box.
- **The Goals page is grouped by area** ("categories"), one heading per area.
- Wants a way to see done tasks (a dropdown/fold-out) and a small "ticked off this month" progress at the top of each area, "just as a little nice thing". **Chosen: round-2 option 4A**: a `--panel` box at the top of each area, bold "14 ticked off in October", right side "last month 11", a progress bar (this month vs last month's total). At the bottom of the to-dos a fold-out "Done (N)" (closed by default) listing done tasks as strips with a ticked box, struck-through title and the done date; unticking brings one back.
- Hates the current Inbox sorting flow. Wants: choose idea / to-do / goal first, then the area; plus Delete as well as Archive. **Chosen: "One at a time" sort mode**: a "Sort one by one" button on the Inbox opens one item big in the middle (a `--panel` card): title, source line, "What is it?" with three soft pills (To-do, Idea, Goal), then "Which area?" with the area tiles (sidebar tile colours and icons), a footer with Archive, Delete and "Skip →", and "1 of 95" under the card. Filing moves straight to the next item. The normal Inbox list stays.
- **Chosen layout for the sort card: "B · Two screens"** ("B is really nice!"). Step 1, "What is it?": three big tiles in a row (`--row` background, radius `--radius-panel`, padding 18px 8px, bold label under a 44px rounded tile with a 30px icon): To-do = Today tile `#e8dd6e` + today icon, Idea = Vision board tile `#ecca7d` + vision-board icon, Goal = Goals tile `#98c293` + goals icon. Step 2 replaces it: a "← To-do · change" text link, then "Which area?" as a NookPhone-style app grid: 4 columns (3 on phone), each a 56px tile in the area's sidebar colour, radius 16px, 36px icon, 13px label underneath, no box around the app. Footer (both steps): Archive, Delete pills left, "Skip →" pill right. "1 of N" under the card; after an action, a line "Filed as To-do in Writing · Undo". Nothing is preselected: Inbox items have no type until she picks one.
- **No multi-select in the Inbox**: "I hate the multi select thing, I will go one at a time."
- **Delete goes to a Bin you can empty** (like the Mac's Trash): restore or empty from a Bin page.
- Round-2 mockup file (for reference, not in repo): option IDs 1A–1C, 2A–2D, 3A–3C, 4A–4B.

## Extracted palette (from reference screenshots, 2026-10-27)
**NookPhone tile colours** (sampled from the Nookipedia NookPhone page):
Camera purple `#b693ec`, Nook Miles blue `#9eb4e6`, Critterpedia gold `#ecca7d`, DIY terracotta `#d59770`, Nook Shopping yellow `#e8dd6e`, Island Designer brown `#90825b`, Custom Designs pink `#e6aeaf`, Map mint `#a3d5c2`, Happy Home red `#bf6564`, Room Sketch yellow `#e2cd5b`, Chat Log lime `#cedb6e`, Passport green `#98c293`, Best Friends orange `#e39876`, Call Resident sky `#a6ced6`, Rescue coral `#df7e6f`, Island Life 101 violet `#9285c5`.
**Wiki page background:** periwinkle `#e2e8ff`.
**Village-dashboard pins (Pinterest):** forest green `#3a412f` (header), deep olive `#51553d`, sage `#a09f88`, cream `#e9e3d6`, warm paper `#e3ddcd`, pale stone `#d4d1c3`.

## Role assignments made without Esme's approval (2026-10-28)
Unused values from the sampled palette above, given jobs by the implementers. Esme may veto any of them.
- **Sidebar tile colours** for the three added areas: Tech projects Chat Log lime `#cedb6e`, Production DIY terracotta `#d59770`, Admin Island Designer brown `#90825b`.
- **App icon** (`hub/public/icons/`: 192, 512, maskable 512, 180 apple-touch): Esme's chosen artwork (house outline with her photo, Home-tile blue background, cream behind her), chosen 2026-10-28. Background blue is the existing Home tile colour Nook Miles blue `#9eb4e6`.
- **Icon accents** in `docs/design/icons/tech.svg` (Passport green `#98c293` leaf), `production.svg` (Critterpedia gold `#ecca7d` bar, forest green `#3a412f` stripes) and `admin.svg` (Rescue coral `#df7e6f` paperclip). The drawings themselves are unreviewed first attempts in the style of the approved set.

## Not decided (placeholders, must look obviously wrong)
- **Type:** system font until Esme chooses.
- **Easing and timing:** linear, with default durations, until Esme chooses.
- **Mascot / mole popup art, icon artwork, confetti and star shapes:** magenta boxes. Animal Crossing artwork is not bundled; Esme supplies or approves any assets.
- **Web manifest and page `theme_color` / `background_color`:** deliberately omitted until Esme chooses.
- **Light vs dark values** beyond the above: not defined.

## Rule
Do not choose colour, easing, type, composition or timing outside this file. If it is not here, ask.
