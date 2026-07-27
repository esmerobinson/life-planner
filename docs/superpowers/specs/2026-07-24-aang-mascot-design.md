# Aang mascot animation + Avatar cozy-game theming — design

## Context

`native/main.swift` is a single-file SwiftUI menu bar app (no Xcode project, built via
`swiftc -swift-version 5 -O main.swift -o EsmeDay`) that shows a floating dashboard popup
styled as a monospace terminal (dark background, `//` comments, custom colors). It already
has a deliberately chunky, discrete-frame "Undertale feel" animation style: `TypewriterText`
(types itself in character by character) and `StarBurst` (a few-frame scale punch on tick,
explicitly *not* smoothly eased — see comment at `main.swift:286-287`).

This adds an Aang (Avatar: The Last Airbender) sprite mascot to that popup, sourced from a
267-sprite sheet (`~/Downloads/Avatar Aang Playable Characters.png`, ripped from the GBA
game and posted to Spriters Resource). **This asset is for personal use only** — it is not
to be committed to a public repo or included in anything shared/published, since the credit
note on the sheet is from the person who extracted it, not a license from the rights holder
(Nickelodeon/Viacom). This matters concretely here: `origin` for this repo is
`esmerobinson/life-planner` on GitHub, and it is **public** (it also serves GitHub Pages).
So `native/Sprites/` — the folder the extracted frame PNGs land in — gets added to
`.gitignore`: the frames exist on disk for the compiled binary to load, but are never
committed or pushed. All the Swift code (`SpriteAnimator`, the state hooks) ships normally;
only the image assets themselves stay local-only.

The same treatment applies to every other ripped asset sheet used below (the name-entry
font/textbox sheet, the intro backgrounds sheet, the Aang expression-portrait sheet, and
the Lotus/element line-art references) — one of them prints an explicit
`© 2006 Viacom International Inc. ... Licensed by Nintendo` notice, which only reinforces
that none of this goes anywhere public. All extracted PNGs from any of these sheets live
under gitignored asset folders alongside `native/Sprites/`.

## Goal

Three mascot moments, all driven by the same sprite sheet, each using a different
animation sequence cropped from it:

1. **Splash** — plays once when the dashboard window transitions from hidden to visible.
2. **Reaction** — *(superseded below by a face-portrait reaction, see "Reaction portraits")*
3. **Idle** — loops continuously while the window is open, whenever neither of the above is
   playing (i.e. the resting/default state).

Which specific sequence (walk cycle / airbend twirl / jump-lift / etc.) maps to which of the
three moments is not fixed up front — the extraction pipeline should make it cheap to try
different rows from the sheet in each slot and see what reads best live.

## Non-goals

- No "loading/spinner" state — the app has no async wait to represent; dropped per discussion.
- No attempt to preserve the ASCII/terminal-text illusion from the Ghostty blog post that
  originally inspired this — Aang renders as real sprite bitmap images (crisp, full color),
  not monospace character art, since this is a native SwiftUI view, not a terminal.
- No Xcode project / asset catalog migration — frames are loaded as plain files on disk,
  consistent with how this app is currently built and run.

## Design

### 1. Offline extraction (one-time script, not part of the app)

A Python script (using Pillow) processes the source sheet into ready-to-use frame sequences:

- **Chroma-key transparency**: pixels near-white (within a tolerance) become fully
  transparent, so only the character silhouette shows against the popup's dark background.
- **Crop per sequence**: each of the 3 chosen animations is cropped from the sheet by a
  manually-identified pixel rect (frame width/height × frame count), since the sheet's rows
  are not a uniform grid (frame counts and spacing vary by row).
- **Upscale**: nearest-neighbor scale each frame up (e.g. 4x) so the pixel art reads clearly
  at the size it'll display in the popup, instead of rendering as a tiny, hard-to-see sprite.
- **Output**: numbered PNGs under `native/Sprites/{splash,reaction,idle}/frame_00.png`,
  `frame_01.png`, ... one subfolder per moment. Re-running the script with different crop
  rects is how sequence-to-moment assignment gets tried and changed.

### 2. Runtime playback (Swift)

A new `SpriteAnimator` SwiftUI view:

- Loads all PNGs in a given subfolder (sorted by filename) via `NSImage(contentsOfFile:)`,
  resolved relative to the running executable's directory (this app isn't an Xcode-managed
  `.app` bundle, so there's no asset catalog — plain files alongside `EsmeDay` work the same
  way the vault paths already do elsewhere in this file).
- Cycles frames on a `Timer` at a fixed interval (no cross-fade between frames — matches the
  existing "chunky, on purpose" feel already established by `StarBurst`).
- Two playback modes: **loop** (idle) and **play-once-then-callback** (splash, reaction) —
  the callback is how splash/reaction hand control back to idle when they finish.

A small state enum (`.idle`, `.splash`, `.reaction`) on the existing `Model` or a sibling
`ObservableObject` tracks which sequence is currently active; `SpriteAnimator` observes it
and swaps its frame folder when the state changes.

### 3. Integration points in `main.swift`

- `AppDelegate.toggle()` (~line 508): the branch where the window goes from hidden to
  visible (i.e. `window.makeKeyAndOrderFront` is about to be called) is where `.splash`
  gets triggered.
- `Tick`'s button action (~line 317-320), where `StarBurst`'s `burstTrigger` is already
  incremented on a fresh tick — `.reaction` gets triggered from the same spot.
- Both transitions fall back to `.idle` automatically once their one-shot sequence finishes.

### 4. Placement

Aang is pinned to a **fixed corner of the window** (bottom-right, clear of the traffic-light
buttons and the "quit"/"vault"/"web dashboard" row) as a sibling overlay on
`window.contentView`, not inside `Dashboard`'s `ScrollView` — so he stays visible and doesn't
scroll away with the task list.

### Testing

No automated tests (this is a tiny visual feature in a single-file personal app, consistent
with the rest of `main.swift`). Verification is manual: rebuild with the existing
`swiftc -swift-version 5 -O main.swift -o EsmeDay` command, run the binary, and confirm all
three states trigger at the right moments with no flicker or frame-loading errors.

---

## Part 2: Avatar cozy-game theming

Beyond the mascot itself, the whole popup gets restyled toward a warm, cozy-game aesthetic
using an official Aang color palette plus several other ripped ATLA asset sheets (name-entry
font/textbox screen, intro backgrounds, Aang expression portraits). Same personal-use-only /
gitignored-assets rule as Part 1 throughout — see the note above.

### Color palette

Replaces the current dark theme's color constants (`main.swift:216-220`) with a full light
cozy-game palette:

| Constant | Old | New | Hex |
|---|---|---|---|
| `bg` (background) | near-black | cream | `#F9EFE3` |
| `fg` (body text) | muted olive | brown | `#715447` |
| `bright` (headers/emphasis) | lighter olive | dark red-brown | `#6E1700` |
| `dim` (secondary/meta text) | dark olive | lighter tint of the brown, muted | derived |
| accent (buttons, bars, links — was `green`) | muted green | gold, orange for hover/pressed | `#F4C135` / `#EE7223` |
| reserved for Water element | — | light blue | `#B6D7F4` |

This is a full theme swap, not just new accents on the existing dark background — confirmed
because the palette itself is light/warm and would look muddy layered on a near-black base.

### Elemental token system (replaces stars)

Task categories simplify from the current 6 (`Writing, Content, Art, Production, Admin,
Health`) to 4, each owning one of the four bending elements:

- **Writing → Air**
- **Content** (absorbing what were `Art` and `Production`) **→ Water**
- **Health → Fire**
- **Admin → Earth**

`categorize()` and `CATEGORY_ORDER` in `main.swift` update to match. Ticking a task now:
- fires that category's element icon as the tick-burst animation, replacing the ★ `StarBurst`
  glyph (the burst mechanics/timing stay the chunky, discrete-frame style already established
  — only the glyph and per-element tint change)
- increments that category's token count, shown next to the category header as an element
  icon + count, replacing the current `"★ N"` text (`main.swift:418`)

**Data migration**: `Daily/category-stars.json` is keyed by the old 6 category names. On
first load under the new scheme, any existing `Art` / `Production` counts get summed into
`Content` once, so existing progress isn't lost by the rename/merge.

### Lotus tile

Two roles, both replacing prior star/icon usage:

1. **App icon** — replaces the `✿` glyph in the menu-bar status item title (`main.swift:504`).
2. **Wellbeing tick glyph** — all three affirm-row habits (Morning manifestations, Read
   reminders, Journal feelings) swap their `○ / ◉ / ●` tick glyph (`Tick` view,
   `main.swift:310-334`) for the Lotus tile image, and their tick-burst becomes a Lotus
   "unfurl/glow" animation instead of the star punch — framed as "tap to confirm you've
   absorbed it," distinct from the elemental task-token system above.

### Background

The soft blue/white radial sun-glow image (from the intro-backgrounds sheet) is cropped and
used as a full-window background layer behind `Dashboard`'s content, at reduced opacity so
text stays legible against the cream base — it sits between the flat `bg` fill and the
actual UI content.

### Textbox/border art

The rounded, bracket-cornered box art from the name-entry screen is cropped and used as a
9-slice resizable background (SwiftUI `.resizable(capInsets:)`) behind specific panels —
the "make a journal entry" CTA button and/or the affirm-row wrapper — in place of the current
plain `RoundedRectangle` fills, so those read as game dialog boxes rather than flat shapes.

### Pixel font (contained scope)

Building a renderer that can type arbitrary text with a bitmap font (one image per letter,
no scalable glyph outlines) is a real engineering lift with no SwiftUI shortcut, so its use
is deliberately contained: each letter (A–Z, a–z) is cropped from the name-entry sheet into
its own transparent PNG, and a small `PixelText` view lays out matching letter-images side by
side for a given string. This is used **only** for the date header ("Friday 24 July",
`main.swift:372`) — every other text in the app keeps the existing system monospace font.

### Reaction portraits (supersedes the Part 1 "Reaction" body-sprite moment)

Rather than a full-body sprite animation on task tick, a small expressive Aang face portrait
(cropped from the expressions sheet — e.g. a proud/happy face) pops up briefly instead. This
replaces the originally-planned body-sprite reaction; splash and idle remain body-sprite
based and unchanged.

### Asset prep (all sheets)

One extraction pass covers everything above: crop each needed piece (Lotus tile, 4 element
glyphs, sun-glow background, box/border art, A–Z/a–z letters, a handful of Aang expression
portraits) from its source sheet, chroma-key/transparent the background where needed, and
recolor the black line-art icons (Lotus, elements) to tint each with its matching palette
color rather than leaving them flat black. Output as individual transparent PNGs sized for
their use (small inline badges, one larger Lotus for the menu-bar icon, full-window-sized
background). Same `.gitignore`'d, personal-use-only handling as the sprite frames.

### Parked for later: visual-novel-style opening dialogue

**Not in scope for this pass** — captured here so we come back to it once the above ships.

Idea: on opening the app (first open of a session, or every open — TBD), instead of going
straight to the dashboard, show a brief visual-novel-style exchange with Aang: his face
portrait, a line of dialogue in "Aang-speak" (e.g. "hey, wanna see what tasks you got for
today?") rendered in the pixel font from the name-entry sheet, then two response options
("yes sure!" / "eh, not feeling well"). Either choice leads to a motivational quote + a
reminder (mood-adjusted based on which option was picked), after which the normal dashboard
appears as usual. Needs a skip option for anyone who doesn't want the exchange every time.
Wants its own design pass (dialogue state machine, branching content source, skip
persistence, how the pixel font renders multi-line dialogue vs. just the date header) once
the first-pass mascot + theming work above is done and working.

### Updated testing

Still manual verification only, same rationale as Part 1: rebuild with
`swiftc -swift-version 5 -O main.swift -o EsmeDay`, run, and check each surface — palette
applied throughout, element tokens counting and bursting correctly per category (including
the migrated `Content` counts), Lotus tile as menu-bar icon and on all three wellbeing ticks,
background visible without hurting text legibility, textbox art rendering behind its panels
without distortion at the popup's fixed 340×640 size, date header rendering via `PixelText`,
and a reaction portrait appearing on task tick.
