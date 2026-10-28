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
- Wants to add comments/notes before filing. The sort card's notes box (`--row`, tile radius) is editable with "Add a note…" when empty (placement and look: controller's call from the mockup's notes box, not yet seen by Esme).
- Wants to switch things between idea and to-do (either way) anywhere. Placement (controller's call, keeps the two icons): the arrow icon's menu opens with "Change to" (the other types: To-do / Idea / Goal), a divider, then the areas.
- **Opening a task / idea / goal (round 3): side panel (option A)**, like Notion's peek: slides in from the right over the page (`--panel`, radius `--radius-panel` on the left corners), list still visible behind. **She can drag its left edge to make it wider** (remembered on that device). Inside: editable title, properties (type, area, due, goal), then a Notion-like page she types straight into: plain lines, headings, checklists, links and a couple of pictures. Add-buttons "Heading / Checklist / Link / Picture" under the page (and "/" in the text). Picture look: magenta placeholder until she approves.
- **Habits (round 3): option B**. A box at the top of each area headed just **"Habits"** (repeat symbol). Each habit is a strip with the repeat symbol and, on the right, "October · session 20 of 28" over a small bar (wording provisional; she said "there's probably something better"). Ticking a habit does NOT send it to the Done fold-out: for the rest of the day it stays where it is, title struck through, ticked box, and a small line "Done for today" (she never does more than one a day, but wants it to feel like crossing something off). It comes back unticked the next day.
- **Today list**: things ticked off today stay on Today, crossed out, for the rest of the day ("so I can see things I've completed through the day"); they're gone tomorrow.
- **Phone layout (2026-10-28): "the phone layout looks great"** about the phone mockup; taken as **option A · NookPhone home grid** (the option on screen; she hasn't named a letter yet, confirm when she sees it built). Phone home: title "Esmeworld" + Inbox pill top right, a 4-column grid of area apps (62px tiles, radius 18px, area tile colours and icons, 12px labels), then Today's list. Tapping an app opens it full-screen with a round back arrow (34px, `--track`) top left; tapping a task opens it full-screen with a back arrow. No sidebar on phone. The magenta "you are here" ring is still undecided.
- **Vision board = her Pinterest board, always** (pinterest.com/esmelrobinson/visionboardfuture, public). Esmeworld shows its pins as a collage and refreshes when she adds pins (Pinterest's public board feed: no login, roughly the 25 most recent pins). **Collage layout chosen: "just the photos in a collage I can scroll, with no borders, just together"** (mockup option D): pins packed edge to edge in columns at their real shapes (CSS columns, ~4 at desktop width, min column 220px; fewer on phone), no gaps, no borders, no rounded corners, no shadows; the page scrolls through it. Tapping a photo opens the pin.
- **Morning pages (journal round): option C, the star calendar.** The month as a calendar with a star on each day she did her pages (stars are magenta placeholders until she picks star art), today outlined in the Journal violet `#9285c5`, streak line ("6 days in a row · 21 this month"). Buttons under the calendar renamed **"Write now"** and **"Add photo"** (soft pills; Add photo opens the camera on the phone). A short line at the top giving the Artist's Way morning-pages rules in our own words (three pages, longhand, first thing, no editing, no rereading). Typed pages are hidden after saving; photos are kept as proof (shown blurred).
- **Daily check-in (journal round): option A, one question at a time** (big calm question, answer box, dots for progress, Skip / Next, "Checked in for today" at the end). She wants more DBT in the questions: the rotating bank is drafted from her own DBT workbook and the "Mindful Mornings" DBT article, then chosen together with her.
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
