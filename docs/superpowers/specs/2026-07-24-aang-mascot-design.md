# Aang mascot animation — design

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

## Goal

Three mascot moments, all driven by the same sprite sheet, each using a different
animation sequence cropped from it:

1. **Splash** — plays once when the dashboard window transitions from hidden to visible.
2. **Reaction** — plays once when the user ticks a task (alongside the existing `StarBurst`).
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
