# Aang Mascot + Avatar Cozy-Game Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the EsmeDay native macOS popup (`native/main.swift`) into an Avatar: The Last Airbender-themed cozy-game look — light warm palette, elemental tick tokens replacing stars, a Lotus-tile wellbeing ritual, a real Airbender font, and an animated Aang mascot (splash/idle sprite + reaction face portraits) — while keeping every ripped game asset out of the public GitHub repo.

**Architecture:** A one-time Python/Pillow extraction script turns 5 source image sheets (already in `~/Downloads` except two noted below) into small transparent PNGs under gitignored asset folders next to the compiled binary. `main.swift` gains: new color constants, a merged 4-category/4-element task model, a `SpriteAnimator` view for the body-sprite mascot, an `ElementBurst`/`LotusBurst` replacing `StarBurst`, and a registered custom `.ttf` font. No Xcode project, no automated tests — this app is a single `swiftc`-built file with manual visual verification, consistent with its current state.

**Tech Stack:** Swift 5 / SwiftUI / AppKit (no external Swift packages), Python 3 + Pillow for offline asset extraction.

## Global Constraints

- Build command stays exactly: `swiftc -swift-version 5 -O main.swift -o EsmeDay` (run from `native/`).
- `origin` for this repo (`esmerobinson/life-planner`) is **public** on GitHub. Every extracted PNG sourced from a ripped game asset (Aang sprite sheet, Lotus tile, element symbols, name-entry font/textbox sheet, intro backgrounds, Aang expression portraits) must live under a path covered by `.gitignore` and must never be `git add`ed. The one exception is `Avatar Airbender.ttf`, which is a separately, properly licensed font (free for personal/commercial use, credit FontGet.com) and is fine to commit.
- No automated tests exist in this codebase and none are added — verification throughout is: rebuild, run `./EsmeDay`, look at it.
- Categories change from 6 (`Writing, Content, Art, Production, Admin, Health`) to 4 (`Writing, Content, Admin, Health`, with `Art`/`Production` folded into `Content`), each mapped to an element: Writing→Air, Content→Water, Health→Fire, Admin→Earth.
- Two source images are **not yet available on disk** and block two tasks (marked BLOCKED below): the intro-backgrounds sheet (sun/sky glow + mountain-river art) and the Aang expression-portrait sheet. Every other task is unblocked.

---

## Phase 1 — Repo hygiene and shared extraction tooling

### Task 1: Gitignore the asset output folders

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- Produces: `native/Assets/` as the root gitignored folder every later extraction task writes into (subfolders: `Sprites/`, `Icons/`, `Backgrounds/`, `Portraits/`, `Textboxes/`).

- [ ] **Step 1: Add the ignore rule**

Append to `.gitignore`:

```
native/Assets/
```

- [ ] **Step 2: Verify with git**

Run: `mkdir -p native/Assets/test && touch native/Assets/test/f.png && git status --short`
Expected: `native/Assets/test/f.png` does NOT appear in the output (ignored).

- [ ] **Step 3: Clean up the test file and commit**

```bash
rm -rf native/Assets/test
git add .gitignore
git commit -m "Ignore native/Assets/ -- extracted game-sprite assets stay local-only"
```

---

### Task 2: Shared image extraction utilities

**Files:**
- Create: `native/tools/extract_common.py`
- Test: manual (run the script's `__main__` self-check, see Step 3)

**Interfaces:**
- Produces: `chroma_key_transparent(im, bg_rgb=(255,255,255), tol=20) -> Image`, `upscale_nearest(im, factor) -> Image`, `recolor_lineart(im, target_rgb) -> Image`, `crop(im, box) -> Image` — imported by every extraction script in later tasks.

- [ ] **Step 1: Write the utility module**

```python
# native/tools/extract_common.py
"""Shared helpers for turning ripped ATLA asset sheets into transparent PNGs.
Output always goes under native/Assets/ (gitignored) -- see Task 1."""

from PIL import Image
import numpy as np

def crop(im: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    return im.crop(box)

def chroma_key_transparent(im: Image.Image, bg_rgb=(255, 255, 255), tol=20) -> Image.Image:
    """Turn near-bg_rgb pixels fully transparent. tol is per-channel Manhattan tolerance."""
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    diff = np.abs(arr[:, :, :3].astype(int) - np.array(bg_rgb)).sum(axis=2)
    arr[:, :, 3] = np.where(diff <= tol, 0, arr[:, :, 3])
    return Image.fromarray(arr, "RGBA")

def upscale_nearest(im: Image.Image, factor: int) -> Image.Image:
    w, h = im.size
    return im.resize((w * factor, h * factor), Image.NEAREST)

def recolor_lineart(im: Image.Image, target_rgb: tuple[int, int, int], dark_thresh=100) -> Image.Image:
    """Replace dark line-art pixels with target_rgb, keeping existing alpha untouched."""
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    is_dark = arr[:, :, :3].astype(int).sum(axis=2) < dark_thresh * 3
    arr[:, :, 0] = np.where(is_dark, target_rgb[0], arr[:, :, 0])
    arr[:, :, 1] = np.where(is_dark, target_rgb[1], arr[:, :, 1])
    arr[:, :, 2] = np.where(is_dark, target_rgb[2], arr[:, :, 2])
    return Image.fromarray(arr, "RGBA")
```

- [ ] **Step 2: Verify Pillow/numpy are available**

Run: `python3 -c "import PIL, numpy; print(PIL.__version__, numpy.__version__)"`
Expected: prints two version numbers, no `ModuleNotFoundError`.

- [ ] **Step 3: Self-check the module**

```bash
python3 -c "
import sys; sys.path.insert(0, 'native/tools')
from extract_common import chroma_key_transparent, upscale_nearest, recolor_lineart, crop
from PIL import Image
im = Image.new('RGB', (10,10), (255,255,255))
im.putpixel((5,5), (0,0,0))
out = chroma_key_transparent(im)
assert out.getpixel((0,0))[3] == 0, 'bg should be transparent'
assert out.getpixel((5,5))[3] == 255, 'fg should stay opaque'
up = upscale_nearest(im, 4)
assert up.size == (40,40)
print('OK')
"
```
Expected: prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add native/tools/extract_common.py
git commit -m "Add shared chroma-key/upscale/recolor utilities for asset extraction"
```

---

## Phase 2 — Lotus tile and elemental icons (unblocked, source images present)

### Task 3: Extract the Lotus tile and 4 element icons

**Files:**
- Create: `native/tools/extract_icons.py`
- Produces (gitignored): `native/Assets/Icons/lotus.png`, `native/Assets/Icons/air.png`, `native/Assets/Icons/water.png`, `native/Assets/Icons/fire.png`, `native/Assets/Icons/earth.png`

**Interfaces:**
- Consumes: `native/tools/extract_common.py` (Task 2)
- Produces: the 5 PNG files above, transparent background, line-art recolored per element to a palette tint, at a fixed 128×128 canvas (upscaled from source) so `NSImage` loading code in later tasks can assume a consistent size.

- [ ] **Step 1: Write the extraction script**

Real pixel rects below were measured directly from the source images (`PIL`+`numpy` content-bounding-box detection), not guessed:

```python
# native/tools/extract_icons.py
import sys
sys.path.insert(0, "native/tools")
from extract_common import crop, chroma_key_transparent, recolor_lineart
from PIL import Image
import os

SYMBOLS = os.path.expanduser("~/Downloads/symbols_avatar.jpg")
LOTUS = os.path.expanduser("~/Downloads/lotustileavatar.jpg")
OUT = "native/Assets/Icons"

# (name, rect, recolor target RGB matching the theming palette)
ELEMENTS = [
    ("air",   (336, 1245, 484, 1398), (185, 210, 225)),   # pale blue-white, air/sky
    ("water", (327,  658, 484,  811), (0xB6, 0xD7, 0xF4)),  # light blue #B6D7F4
    ("fire",  (320, 1023, 494, 1218), (0xEE, 0x72, 0x23)),  # orange #EE7223
    ("earth", (321,  837, 490, 1003), (0x71, 0x54, 0x47)),  # brown #715447
]
LOTUS_RECT = (215, 37, 535, 357)
LOTUS_COLOR = (0x6E, 0x17, 0x00)  # dark red-brown #6E1700

def process(src_path, rect, color, out_name, canvas=128):
    im = Image.open(src_path).convert("RGB")
    piece = crop(im, rect)
    piece = recolor_lineart(piece, color, dark_thresh=140)
    piece = chroma_key_transparent(piece, bg_rgb=(255, 255, 255), tol=40)
    # letterbox onto a fixed square canvas, preserving aspect ratio
    piece.thumbnail((canvas, canvas), Image.LANCZOS)
    square = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    ox = (canvas - piece.width) // 2
    oy = (canvas - piece.height) // 2
    square.paste(piece, (ox, oy), piece)
    square.save(os.path.join(OUT, f"{out_name}.png"))
    print(f"wrote {out_name}.png from {rect}")

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, rect, color in ELEMENTS:
        process(SYMBOLS, rect, color, name)
    process(LOTUS, LOTUS_RECT, LOTUS_COLOR, "lotus")
```

- [ ] **Step 2: Run it**

Run: `python3 native/tools/extract_icons.py`
Expected output: 5 lines like `wrote air.png from (336, 1245, 484, 1398)`, and `ls native/Assets/Icons` shows `air.png fire.png earth.png water.png lotus.png`.

- [ ] **Step 3: Visually spot-check**

Run: `open native/Assets/Icons/lotus.png native/Assets/Icons/fire.png` (or any image viewer) — confirm the Lotus tile is legible and tinted dark red-brown, and the fire icon is legible and tinted orange, both on transparent background (checkerboard in Preview).

- [ ] **Step 4: Commit the script only (assets are gitignored)**

```bash
git add native/tools/extract_icons.py
git status --short   # confirm native/Assets/Icons/*.png does NOT appear
git commit -m "Add extraction script for Lotus tile + 4 element icons"
```

---

## Phase 3 — Palette

### Task 4: Replace the color palette in `main.swift`

**Files:**
- Modify: `native/main.swift:216-220`

**Interfaces:**
- Consumes: nothing new
- Produces: same constant names (`bg`, `fg`, `bright`, `dim`, `green`, `gold`) so every existing call site keeps compiling unchanged — only their values move to the new palette. `green` is kept as the identifier for the primary accent color (now gold) to avoid a repo-wide rename; a comment notes the mismatch.

- [ ] **Step 1: Replace the constants**

```swift
// MARK: - styling
// Avatar: The Last Airbender cozy-game palette (Aang color scheme).
let bg = Color(red: 0.976, green: 0.937, blue: 0.890)      // #F9EFE3 cream
let fg = Color(red: 0.443, green: 0.329, blue: 0.278)      // #715447 brown
let bright = Color(red: 0.431, green: 0.090, blue: 0.0)    // #6E1700 dark red-brown
let green = Color(red: 0.957, green: 0.757, blue: 0.208)   // #F4C135 gold (kept as `green` -- primary accent, see below)
let dim = Color(red: 0.443, green: 0.329, blue: 0.278).opacity(0.55) // muted brown
let hoverAccent = Color(red: 0.933, green: 0.447, blue: 0.137) // #EE7223 orange, hover/pressed states
```

`gold` already exists lower in the file (`main.swift:308`, used by `StarBurst`) — leave that declaration as-is for now; Task 8 replaces its usage.

- [ ] **Step 2: Rebuild**

Run: `cd native && swiftc -swift-version 5 -O main.swift -o EsmeDay`
Expected: compiles with no errors (only pre-existing warnings, if any).

- [ ] **Step 3: Run and look**

Run: `./native/EsmeDay` (click the menu-bar icon to open the popup)
Expected: background is cream, body text brown, headers dark red-brown, previously-green accents (buttons, links, streak badges) are now gold.

- [ ] **Step 4: Commit**

```bash
git add native/main.swift
git commit -m "Swap dark terminal palette for the Avatar cozy-game color scheme"
```

---

## Phase 4 — Elemental token system

### Task 5: Merge categories to 4 and add the element mapping

**Files:**
- Modify: `native/main.swift:74-84` (`categorize()`, `CATEGORY_ORDER`)

**Interfaces:**
- Consumes: nothing new
- Produces: `CATEGORY_ORDER: [String]` now `["Writing", "Content", "Admin", "Health"]`; new `func element(for category: String) -> String` returning one of `"air"|"water"|"fire"|"earth"`, consumed by Tasks 6 and 7.

- [ ] **Step 1: Update `categorize()` to fold Art/Production into Content**

```swift
func categorize(_ text: String, _ target: String) -> String {
    let s = (text + " " + target).lowercased()
    if ["walk", "run", "calisthenic", "nutritious", "overeat", "gym", "movement"].contains(where: s.contains) { return "Health" }
    if ["jeff", "biography", "substack", "book", "essay", "chapter", "write", "story of our relationship", "journal"].contains(where: s.contains) { return "Writing" }
    if ["reel", "carousel", "content", "post", "video", "instagram", "ai project", "build", "vibecoding", "capcut", "footage",
        "paint", "art", "touchdesigner", "drawing",
        "lucas", "eti", "varvara", "production", "venue", "pr ", "fundrais"].contains(where: s.contains) { return "Content" }
    return "Admin"
}

let CATEGORY_ORDER = ["Writing", "Content", "Admin", "Health"]

func element(for category: String) -> String {
    switch category {
    case "Writing": return "air"
    case "Content": return "water"
    case "Health": return "fire"
    default: return "earth"   // Admin
    }
}
```

- [ ] **Step 2: Rebuild**

Run: `cd native && swiftc -swift-version 5 -O main.swift -o EsmeDay`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add native/main.swift
git commit -m "Merge Art/Production into Content, add category-to-element mapping"
```

---

### Task 6: Migrate existing category-stars.json counts and display element tokens

**Files:**
- Modify: `native/main.swift:196-198` (`categoryStars`), `native/main.swift:413-420` (category header row in `Dashboard`)

**Interfaces:**
- Consumes: `element(for:)` from Task 5
- Produces: `Model.categoryStars(_:)` unchanged signature (`(String) -> Int`), but now migrates `Art`/`Production` into `Content` on first read; category header row renders an element icon instead of `"★ N"`.

- [ ] **Step 1: Add one-time migration inside `categoryStars`**

```swift
func categoryStars(_ cat: String) -> Int {
    var cs = jsonDict("Daily/category-stars.json")
    if cs["Art"] != nil || cs["Production"] != nil {
        let merged = (cs["Content"] as? Int ?? 0) + (cs["Art"] as? Int ?? 0) + (cs["Production"] as? Int ?? 0)
        cs["Content"] = merged
        cs.removeValue(forKey: "Art")
        cs.removeValue(forKey: "Production")
        saveJSON("Daily/category-stars.json", cs)
    }
    return cs[cat] as? Int ?? 0
}
```

Note: `saveJSON` is currently `private` on `Model` (`main.swift:168`) — since `categoryStars` is already a `Model` method, this call is in-scope as-is, no visibility change needed.

- [ ] **Step 2: Replace the `"★ N"` display with an element icon + count**

Find this block in `Dashboard` (`main.swift:413-420`):

```swift
ForEach(CATEGORY_ORDER, id: \.self) { cat in
    let items = model.tasks.filter { $0.category == cat }
    if !items.isEmpty {
        HStack(spacing: 6) {
            Text(cat.lowercased()).font(mono(11, .semibold)).foregroundColor(bright)
            Text("★ \(model.categoryStars(cat))").font(mono(11)).foregroundColor(green)
            Spacer()
        }.padding(.top, 4)
        ForEach(items) { TaskRow(task: $0, model: model) }
    }
}
```

Replace with:

```swift
ForEach(CATEGORY_ORDER, id: \.self) { cat in
    let items = model.tasks.filter { $0.category == cat }
    if !items.isEmpty {
        HStack(spacing: 6) {
            Text(cat.lowercased()).font(mono(11, .semibold)).foregroundColor(bright)
            ElementIcon(element: element(for: cat), size: 12)
            Text("\(model.categoryStars(cat))").font(mono(11)).foregroundColor(green)
            Spacer()
        }.padding(.top, 4)
        ForEach(items) { TaskRow(task: $0, model: model) }
    }
}
```

`ElementIcon` is defined in Task 7 (needed here and by the burst effect) — this task's build will not compile until Task 7 lands; that's expected since they're two halves of one visual change. Do Task 7 immediately after this step, before rebuilding.

- [ ] **Step 3: Commit (after Task 7 makes it build — see that task's own commit step)**

No separate commit here; Task 7's commit step covers both files' changes together.

---

### Task 7: `ElementIcon` view and element-tinted tick burst

**Files:**
- Modify: `native/main.swift:288-306` (`StarBurst`), add a new small view near it
- Modify: `native/main.swift:310-334` (`Tick`) to pass through which element is bursting for task rows
- Modify: `native/main.swift:343-364` (`TaskRow`) to pass its category's element to `Tick`

**Interfaces:**
- Consumes: `element(for:)` (Task 5), PNGs at `native/Assets/Icons/{air,water,fire,earth,lotus}.png` (Task 3)
- Produces: `struct ElementIcon: View` with `init(element: String, size: CGFloat)`; `Tick` gains an `element: String? = nil` parameter (nil = old star behavior, used by the 3 affirm-row habits until Task 10 switches them to Lotus); `TaskRow` passes its own category's element.

- [ ] **Step 1: Add `ElementIcon` next to `StarBurst`**

```swift
// Loads a pre-extracted element/Lotus icon from native/Assets/Icons/ (see native/tools/extract_icons.py).
// Resolved relative to the running binary's directory, same approach as the vault paths above.
func assetsIconURL(_ name: String) -> URL {
    Bundle.main.bundleURL.deletingLastPathComponent()
        .appendingPathComponent("Assets/Icons/\(name).png")
}

struct ElementIcon: View {
    let element: String   // "air" | "water" | "fire" | "earth" | "lotus"
    var size: CGFloat = 14
    var body: some View {
        if let img = NSImage(contentsOf: assetsIconURL(element)) {
            Image(nsImage: img).resizable().interpolation(.none)
                .frame(width: size, height: size)
        } else {
            Text("?").font(mono(size)).foregroundColor(dim)
        }
    }
}
```

- [ ] **Step 2: Update `StarBurst` to render an `ElementIcon` instead of the `★` glyph**

Replace (`main.swift:288-306`):

```swift
struct StarBurst: View {
    @Binding var trigger: Int
    let element: String   // "air" | "water" | "fire" | "earth" | "lotus"
    @State private var scale: CGFloat = 0
    @State private var opacity: Double = 0
    var body: some View {
        ElementIcon(element: element, size: 16)
            .scaleEffect(scale).opacity(opacity)
            .onChange(of: trigger) { _, _ in
                scale = 1.6; opacity = 1
                withAnimation(.linear(duration: 0.06)) { scale = 0.9 }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) {
                    withAnimation(.linear(duration: 0.05)) { scale = 1.3 }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    withAnimation(.easeIn(duration: 0.3)) { opacity = 0; scale = 0.6 }
                }
            }
    }
}
```

(The `gold` constant at old `main.swift:308` is now unused by this view — leave it defined, Task 10 doesn't need it either, but removing dead code is out of scope for this task.)

- [ ] **Step 3: Update `Tick` to take and forward an element**

Replace (`main.swift:310-334`):

```swift
struct Tick: View {
    let on: Bool
    let element: String
    let action: () -> Void
    @State private var hover = false
    @State private var burstTrigger = 0
    var body: some View {
        ZStack {
            Button(action: {
                if !on { burstTrigger += 1 }
                action()
            }) {
                Text(on ? "●" : (hover ? "◉" : "○"))
                    .font(mono(13)).foregroundColor(on ? green : (hover ? green : dim))
                    .scaleEffect(hover ? 1.25 : 1)
                    .frame(width: 16).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hover = $0 }
            .animation(.easeOut(duration: 0.12), value: hover)
            .help(on ? "untick" : "tick, it counts")

            StarBurst(trigger: $burstTrigger, element: element).offset(x: 14, y: -10)
        }
    }
}
```

- [ ] **Step 4: Update `TaskRow` to pass its category's element**

Replace the `Tick` call inside `TaskRow` (`main.swift:343-364`, currently `Tick(on: task.done) { model.toggleTask(task) }`) with:

```swift
Tick(on: task.done, element: element(for: task.category)) { model.toggleTask(task) }
```

- [ ] **Step 5: Fix the 3 affirm-row `Tick` call sites to keep compiling**

In `Dashboard` (`main.swift:381-404`), the three affirm-row `Tick(on: ...)` calls need an `element:` argument too. Temporarily pass `"lotus"` for all three (Task 10 revisits this to also swap their glyph/burst framing, but this keeps the build green now):

```swift
Tick(on: model.habitDone("Morning manifestations"), element: "lotus") {
    model.toggleHabit("Morning manifestations")
}
...
Tick(on: model.habitDone("Read reminders"), element: "lotus") {
    model.toggleHabit("Read reminders")
}
...
Tick(on: model.habitDone("Journal feelings"), element: "lotus") {
    model.toggleHabit("Journal feelings")
}
```

- [ ] **Step 6: Rebuild**

Run: `cd native && swiftc -swift-version 5 -O main.swift -o EsmeDay`
Expected: compiles cleanly (this also completes Task 6, which depended on `ElementIcon` existing).

- [ ] **Step 7: Run and verify**

Run: `./native/EsmeDay`, tick a task in each of the 4 categories.
Expected: each category's header shows its element icon + count instead of `★ N`; ticking a task bursts that category's element icon instead of a star.

- [ ] **Step 8: Commit (covers Tasks 6 and 7 together)**

```bash
git add native/main.swift
git commit -m "Replace star tick-burst and category counts with elemental tokens"
```

---

## Phase 5 — Lotus tile as app icon and wellbeing ritual

### Task 8: Lotus tile as the menu-bar icon

**Files:**
- Modify: `native/main.swift:474-506` (`AppDelegate`)

**Interfaces:**
- Consumes: `native/Assets/Icons/lotus.png` (Task 3)
- Produces: menu-bar status item now shows the Lotus tile image instead of the `✿` text glyph; `updateTitle()` keeps setting the `done/total` count as text alongside it.

- [ ] **Step 1: Replace the icon assignment in `updateTitle()`**

Replace (`main.swift:502-506`):

```swift
func updateTitle() {
    let done = model.tasks.filter { $0.done }.count
    if let icon = NSImage(contentsOf: assetsIconURL("lotus")) {
        icon.size = NSSize(width: 16, height: 16)
        statusItem.button?.image = icon
        statusItem.button?.imagePosition = .imageLeading
    }
    statusItem.button?.title = " \(done)/\(model.tasks.count)"
    statusItem.button?.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)
}
```

- [ ] **Step 2: Rebuild and run**

Run: `cd native && swiftc -swift-version 5 -O main.swift -o EsmeDay && ./EsmeDay`
Expected: the menu bar shows the Lotus tile icon followed by "done/total", not the `✿` character.

- [ ] **Step 3: Commit**

```bash
git add native/main.swift
git commit -m "Use the Lotus tile as the menu-bar icon"
```

---

### Task 9: Lotus tick glyph and burst for the 3 wellbeing habits

**Files:**
- Modify: `native/main.swift:310-334` (`Tick`)
- Modify: `native/main.swift:378-405` (affirm-row `HStack`s in `Dashboard`)

**Interfaces:**
- Consumes: `ElementIcon` (Task 7), `native/Assets/Icons/lotus.png` (Task 3)
- Produces: `Tick` gains a `wellbeing: Bool = false` parameter — when true, the tick glyph itself (not just the burst) is the Lotus tile instead of `○/◉/●`.

- [ ] **Step 1: Extend `Tick` with a wellbeing mode**

Replace the `Tick` body (from Task 7's version) with:

```swift
struct Tick: View {
    let on: Bool
    let element: String
    var wellbeing: Bool = false
    let action: () -> Void
    @State private var hover = false
    @State private var burstTrigger = 0
    var body: some View {
        ZStack {
            Button(action: {
                if !on { burstTrigger += 1 }
                action()
            }) {
                Group {
                    if wellbeing {
                        ElementIcon(element: "lotus", size: 14)
                            .opacity(on ? 1.0 : (hover ? 0.85 : 0.45))
                    } else {
                        Text(on ? "●" : (hover ? "◉" : "○"))
                            .font(mono(13)).foregroundColor(on ? green : (hover ? green : dim))
                    }
                }
                .scaleEffect(hover ? 1.25 : 1)
                .frame(width: 16).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hover = $0 }
            .animation(.easeOut(duration: 0.12), value: hover)
            .help(on ? (wellbeing ? "wisdom absorbed" : "untick") : (wellbeing ? "tap to absorb it" : "tick, it counts"))

            StarBurst(trigger: $burstTrigger, element: element).offset(x: 14, y: -10)
        }
    }
}
```

- [ ] **Step 2: Mark the 3 affirm-row ticks as wellbeing**

Update the three call sites touched in Task 7 Step 5 (`main.swift:381-404`) to add `wellbeing: true`:

```swift
Tick(on: model.habitDone("Morning manifestations"), element: "lotus", wellbeing: true) {
    model.toggleHabit("Morning manifestations")
}
...
Tick(on: model.habitDone("Read reminders"), element: "lotus", wellbeing: true) {
    model.toggleHabit("Read reminders")
}
...
Tick(on: model.habitDone("Journal feelings"), element: "lotus", wellbeing: true) {
    model.toggleHabit("Journal feelings")
}
```

- [ ] **Step 3: Rebuild and run**

Run: `cd native && swiftc -swift-version 5 -O main.swift -o EsmeDay && ./EsmeDay`
Expected: the 3 affirm-row ticks show a (dim when untapped, bright when tapped) Lotus tile instead of `○/◉/●`; tapping one still bursts the Lotus tile (already the case since `element: "lotus"` was set in Task 7).

- [ ] **Step 4: Commit**

```bash
git add native/main.swift
git commit -m "Wellbeing habits use the Lotus tile as their tick glyph"
```

---

## Phase 6 — Aang body-sprite mascot (splash + idle)

### Task 10: Extraction script for splash + idle sprite sequences

**Files:**
- Create: `native/tools/extract_aang_sprites.py`
- Produces (gitignored): `native/Assets/Sprites/idle/frame_00.png` … `frame_06.png`, `native/Assets/Sprites/splash/frame_00.png` … `frame_03.png`, plus `native/Assets/Sprites/_overview.png` (a labeled reference image, not used by the app)

**Interfaces:**
- Consumes: `native/tools/extract_common.py` (Task 2)
- Produces: numbered frame PNGs consumed by `SpriteAnimator` (Task 11)

- [ ] **Step 1: Write the script**

Row/cluster rectangles below come from real content-bounding-box analysis of `~/Downloads/Avatar Aang Playable Characters.png` (804×1532px), not guesses — the idle default is a 7-frame walk cycle, the splash default is a larger 4-pose action cluster. Both are easy to repoint at a different row by editing `SEQUENCES` if a different animation reads better once you see it running.

```python
# native/tools/extract_aang_sprites.py
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import crop, chroma_key_transparent, upscale_nearest
from PIL import Image, ImageDraw

SRC = os.path.expanduser("~/Downloads/Avatar Aang Playable Characters.png")
OUT = "native/Assets/Sprites"
UPSCALE = 4

# name -> (cluster rect (x0,y0,x1,y1), frame_count) -- sliced evenly across the rect's width
SEQUENCES = {
    "idle":   ((7, 828, 179, 868), 7),    # walk cycle, ~172px / 7 frames, h=40
    "splash": ((225, 599, 500, 753), 4),  # larger action cluster, ~275px / 4 frames, h=154
}

def slice_frames(im, rect, count):
    x0, y0, x1, y1 = rect
    w = (x1 - x0) / count
    frames = []
    for i in range(count):
        fx0 = round(x0 + i * w)
        fx1 = round(x0 + (i + 1) * w)
        frames.append(im.crop((fx0, y0, fx1, y1)))
    return frames

def process(name, rect, count, sheet):
    folder = os.path.join(OUT, name)
    os.makedirs(folder, exist_ok=True)
    for i, frame in enumerate(slice_frames(sheet, rect, count)):
        frame = chroma_key_transparent(frame, bg_rgb=(255, 255, 255), tol=30)
        frame = upscale_nearest(frame, UPSCALE)
        frame.save(os.path.join(folder, f"frame_{i:02d}.png"))
    print(f"{name}: wrote {count} frames from {rect}")

def write_overview(sheet):
    """Draws a red box + label around every configured sequence, for visual review."""
    overview = sheet.convert("RGB").copy()
    draw = ImageDraw.Draw(overview)
    for name, (rect, count) in SEQUENCES.items():
        draw.rectangle(rect, outline=(255, 0, 0), width=2)
        draw.text((rect[0], max(0, rect[1] - 14)), f"{name} ({count})", fill=(255, 0, 0))
    overview.save(os.path.join(OUT, "_overview.png"))

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    sheet = Image.open(SRC).convert("RGB")
    write_overview(sheet)
    for name, (rect, count) in SEQUENCES.items():
        process(name, rect, count, sheet)
```

- [ ] **Step 2: Run it**

Run: `python3 native/tools/extract_aang_sprites.py`
Expected: prints `idle: wrote 7 frames from (7, 828, 179, 868)` and `splash: wrote 4 frames from (225, 599, 500, 753)`.

- [ ] **Step 3: Visually check the overview and the frames**

Run: `open native/Assets/Sprites/_overview.png` — confirm the two red boxes land on two distinct, sensible-looking Aang poses/sequences (not blank space or a cut-off sprite). Also `open native/Assets/Sprites/idle/frame_00.png` to confirm it's a clean, transparent-background sprite frame.

If a rect is wrong (cuts off a limb, catches two sprites, etc.), fix it now: edit the `SEQUENCES` rect/count in the script and re-run Step 2 before moving on — this loop (edit rect → re-run → open overview) **is** the intended workflow, not a sign something's broken.

- [ ] **Step 4: Commit the script only**

```bash
git add native/tools/extract_aang_sprites.py
git status --short   # confirm native/Assets/Sprites/*.png does NOT appear
git commit -m "Add extraction script for Aang splash/idle sprite sequences"
```

---

### Task 11: `SpriteAnimator` view and splash/idle integration

**Files:**
- Create: nothing new — add types directly to `native/main.swift` near `StarBurst` (keeps the pattern of this being a single-file app)
- Modify: `native/main.swift:474-522` (`AppDelegate.toggle()`)
- Modify: `native/main.swift:486-495` (window setup, to host the overlay)

**Interfaces:**
- Consumes: `native/Assets/Sprites/{idle,splash}/frame_NN.png` (Task 10)
- Produces: `enum MascotState { case idle, splash }`, `final class MascotModel: ObservableObject` with `@Published var state: MascotState`, `func playSplash()`; `struct SpriteAnimator: View` reading `MascotModel` via `@ObservedObject`.

- [ ] **Step 1: Add the mascot state + view**

```swift
// MARK: - Aang mascot (body-sprite splash/idle)

enum MascotState { case idle, splash }

final class MascotModel: ObservableObject {
    @Published var state: MascotState = .idle

    func playSplash() {
        state = .splash
        // splash is a 4-frame sequence at 6fps (see SpriteAnimator) -> ~0.67s, then fall back to idle
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
            self?.state = .idle
        }
    }
}

struct SpriteAnimator: View {
    @ObservedObject var mascot: MascotModel
    @State private var frameIndex = 0
    @State private var frames: [NSImage] = []
    @State private var timer: Timer?

    var body: some View {
        Group {
            if frameIndex < frames.count {
                Image(nsImage: frames[frameIndex]).resizable().interpolation(.none)
                    .frame(width: 72, height: 72)
            }
        }
        .onAppear { load(for: mascot.state); start() }
        .onChange(of: mascot.state) { _, newState in load(for: newState) }
        .onDisappear { timer?.invalidate() }
    }

    private func folderName(_ s: MascotState) -> String { s == .idle ? "idle" : "splash" }

    private func load(for state: MascotState) {
        let dir = Bundle.main.bundleURL.deletingLastPathComponent()
            .appendingPathComponent("Assets/Sprites/\(folderName(state))")
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        frames = files.sorted { $0.lastPathComponent < $1.lastPathComponent }
            .compactMap { NSImage(contentsOf: $0) }
        frameIndex = 0
    }

    private func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 6.0, repeats: true) { _ in
            guard !frames.isEmpty else { return }
            frameIndex = (frameIndex + 1) % frames.count
        }
    }
}
```

- [ ] **Step 2: Host `MascotModel` on `AppDelegate` and overlay `SpriteAnimator` on the window**

In `AppDelegate` (`main.swift:474-477`), add the model:

```swift
final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var window: NSWindow!
    let model = Model()
    let mascot = MascotModel()
```

In `applicationDidFinishLaunching`, replace the `window.contentView = NSHostingView(rootView: Dashboard(model: model))` line (`main.swift:495`) with a view that layers the mascot in the bottom-right corner over the dashboard:

```swift
window.contentView = NSHostingView(rootView:
    ZStack(alignment: .bottomTrailing) {
        Dashboard(model: model)
        SpriteAnimator(mascot: mascot)
            .padding(12)
    }
)
```

- [ ] **Step 3: Trigger splash on window open**

In `toggle()` (`main.swift:508-521`), add the trigger right before `window.makeKeyAndOrderFront(nil)`:

```swift
@objc func toggle() {
    if window.isVisible { window.orderOut(nil); return }
    model.load(); updateTitle()
    if let btnWin = statusItem.button?.window, let screen = btnWin.screen {
        let btn = btnWin.frame
        var x = btn.midX - window.frame.width + 40
        x = min(max(x, screen.visibleFrame.minX + 8),
                screen.visibleFrame.maxX - window.frame.width - 8)
        let y = screen.visibleFrame.maxY - window.frame.height - 6
        window.setFrameOrigin(NSPoint(x: x, y: y))
    }
    mascot.playSplash()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
}
```

- [ ] **Step 4: Rebuild**

Run: `cd native && swiftc -swift-version 5 -O main.swift -o EsmeDay`
Expected: compiles cleanly.

- [ ] **Step 5: Run and verify all three transitions**

Run: `./native/EsmeDay`, click the menu-bar icon.
Expected: Aang appears bottom-right; on open he briefly plays the splash sequence (~0.7s), then settles into the looping idle walk-cycle; closing and reopening the popup replays the splash each time.

- [ ] **Step 6: Commit**

```bash
git add native/main.swift
git commit -m "Add SpriteAnimator mascot with splash-on-open and looping idle state"
```

---

## Phase 7 — Avatar Airbender font

### Task 12: Register and use the licensed Airbender font

**Files:**
- Copy: `~/Downloads/Avatar Airbender Font.zip` → extract `Avatar Airbender.ttf` to `native/Fonts/Avatar Airbender.ttf` (**this file IS committed** — see Global Constraints)
- Modify: `native/main.swift:222-224` (near `mono()`)
- Modify: `native/main.swift:474-479` (register the font at launch)
- Modify: `native/main.swift:371-374` (date header uses the new font)

**Interfaces:**
- Produces: `func heading(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font` alongside the existing `mono()`, used wherever header/title-style text appears.

- [ ] **Step 1: Extract and place the font file, with its required credit**

```bash
mkdir -p native/Fonts
unzip -p "$HOME/Downloads/Avatar Airbender Font.zip" "avatar-airbender/Avatar Airbender.ttf" > "native/Fonts/Avatar Airbender.ttf"
```

- [ ] **Step 2: Register the font at launch**

Add near the top of `applicationDidFinishLaunching` (`main.swift:479`, before `model.load()`):

```swift
func applicationDidFinishLaunching(_ n: Notification) {
    // Avatar Airbender font by FontGet.com (free for personal/commercial use, credit required) -- native/Fonts/
    if let fontURL = Bundle.main.bundleURL.deletingLastPathComponent()
        .appendingPathComponent("Fonts/Avatar Airbender.ttf") as URL? {
        CTFontManagerRegisterFontsForURL(fontURL as CFURL, .process, nil)
    }
    model.load()
    ...
```

Note: since this app is a plain `swiftc`-built binary (not an `.app` bundle), `Fonts/` needs to sit alongside the `EsmeDay` executable at runtime, same as `Assets/` from earlier tasks — copy `native/Fonts/` next to wherever `EsmeDay` is actually run from if you move the binary out of `native/`.

- [ ] **Step 3: Add the `heading()` helper next to `mono()`**

```swift
func mono(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font {
    .system(size: s, weight: w, design: .monospaced)
}

// Avatar Airbender font (native/Fonts/Avatar Airbender.ttf) -- header/title text only;
// body text stays on mono() for small-size readability.
func heading(_ s: CGFloat) -> Font {
    .custom("Avatar Airbender", size: s)
}
```

- [ ] **Step 4: Apply it to the date header**

Replace (`main.swift:371-374`):

```swift
VStack(alignment: .leading, spacing: 2) {
    Text(Date(), format: .dateTime.weekday(.wide).day().month(.wide))
        .font(heading(20)).foregroundColor(bright)
    Text("// one honest day at a time").font(mono(11)).foregroundColor(dim)
}
```

- [ ] **Step 5: Rebuild and verify**

Run: `cd native && swiftc -swift-version 5 -O main.swift -o EsmeDay && ./EsmeDay`
Expected: the date header renders in the Airbender display font (visually distinct from the monospace body text below it); no console errors about missing fonts. If the font doesn't render (falls back to system font), check the font's actual PostScript name: `python3 -c "from fontTools.ttLib import TTFont; f=TTFont('native/Fonts/Avatar Airbender.ttf'); print([r.toUnicode() for r in f['name'].names if r.nameID==6])"` (install fonttools first with `pip3 install fonttools` if needed) and use that exact string in `Font.custom(...)`.

- [ ] **Step 6: Commit (font file included, per its license)**

```bash
git add native/main.swift native/Fonts/"Avatar Airbender.ttf"
git commit -m "Register and use the (freely licensed) Avatar Airbender font for headers"
```

---

## Phase 8 — Blocked on two additional source images

These two tasks are fully specified but cannot run until the missing source images are saved to disk. Once available, save them to the paths noted and proceed exactly as written.

### Task 13 (BLOCKED — needs the intro-backgrounds sheet): Background wash

**Prerequisite:** save the intro-backgrounds sheet (the one with the THQ/Nickelodeon logos, mountain-river art, and the sun/sky glow) to `~/Downloads/avatar_intro_backgrounds.png`.

**Files:**
- Create: `native/tools/extract_background.py`
- Modify: `native/main.swift` (`Dashboard`'s `body`, currently `main.swift:369-467`)

**Interfaces:**
- Consumes: `native/tools/extract_common.py`
- Produces: `native/Assets/Backgrounds/sunglow.png`; `Dashboard` gets a new bottom `ZStack` layer between the `.background(bg)` fill and its content.

- [ ] **Step 1: Locate the sun-glow rect and write the extraction script**

Run this first to get real coordinates (mirrors the analysis already done for other sheets in this plan):

```bash
python3 -c "
from PIL import Image
import numpy as np
im = Image.open('$HOME/Downloads/avatar_intro_backgrounds.png').convert('RGB')
arr = np.array(im)
is_bg = np.all(arr > 235, axis=2)
content = ~is_bg
row_has = content.any(axis=1)
bands=[]; in_band=False; start=0
for y,has in enumerate(row_has):
    if has and not in_band: in_band=True; start=y
    elif not has and in_band: in_band=False; bands.append((start,y))
print(im.size, bands)
"
```

Use the printed size/bands to identify the sun-glow cell's rect (it's the roughly-square soft radial glow image, not the mountain/river or logo cells), then write:

```python
# native/tools/extract_background.py
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import crop
from PIL import Image

SRC = os.path.expanduser("~/Downloads/avatar_intro_backgrounds.png")
OUT = "native/Assets/Backgrounds"
# Fill in from the band-detection step above -- placeholder until that's run:
SUNGLOW_RECT = (0, 0, 0, 0)  # (x0, y0, x1, y1)

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    im = Image.open(SRC).convert("RGB")
    piece = crop(im, SUNGLOW_RECT)
    piece.save(os.path.join(OUT, "sunglow.png"))
    print("wrote sunglow.png from", SUNGLOW_RECT)
```

- [ ] **Step 2: Fill in `SUNGLOW_RECT` from Step 1's output, run, and visually confirm**

Run: `python3 native/tools/extract_background.py && open native/Assets/Backgrounds/sunglow.png`
Expected: a clean soft glow image, no logo text or other sheet cells bleeding in.

- [ ] **Step 3: Add the background layer to `Dashboard`**

Wrap the existing `ScrollView` (`main.swift:369`) in a `ZStack`:

```swift
struct Dashboard: View {
    @ObservedObject var model: Model
    var body: some View {
        ZStack {
            if let glow = NSImage(contentsOf: assetsIconURL("../Backgrounds/sunglow")) {
                Image(nsImage: glow).resizable().aspectRatio(contentMode: .fill)
                    .opacity(0.25).allowsHitTesting(false)
            }
            ScrollView(showsIndicators: false) {
                // ... existing VStack content unchanged ...
            }
        }
        .frame(width: 340, height: 640)
        .background(bg)
    }
}
```

(`assetsIconURL` from Task 7 assumes `Assets/Icons/`; either add a small sibling helper for `Assets/Backgrounds/` or generalize `assetsIconURL` to take a subfolder argument — keep whichever this codebase already leans toward once Task 7 is in front of you.)

- [ ] **Step 4: Rebuild and verify**

Run: `cd native && swiftc -swift-version 5 -O main.swift -o EsmeDay && ./EsmeDay`
Expected: a subtle glow visible behind the dashboard content; all text still clearly readable.

- [ ] **Step 5: Commit**

```bash
git add native/tools/extract_background.py native/main.swift
git status --short   # confirm native/Assets/Backgrounds/*.png does NOT appear
git commit -m "Add sun-glow background wash behind the dashboard"
```

---

### Task 14 (BLOCKED — needs the Aang expression-portrait sheet): Reaction face portraits

**Prerequisite:** save the Aang expression-portrait sheet (blue background, grid of small face crops with varied expressions) to `~/Downloads/avatar_aang_faces.png`.

**Files:**
- Create: `native/tools/extract_portraits.py`
- Modify: `native/main.swift` (`toggleTask` call sites / `TaskRow`, and the mascot overlay from Task 11)

**Interfaces:**
- Consumes: `native/tools/extract_common.py`
- Produces: `native/Assets/Portraits/happy.png` (at minimum — add more expressions the same way if wanted); a `PortraitBurst` view fired alongside a good tick, shown near the `SpriteAnimator` overlay.

- [ ] **Step 1: Locate a "happy/proud" face cell and write the extraction script**

Same band-detection approach as Task 13 Step 1, run against `~/Downloads/avatar_aang_faces.png`, to find one clean expression cell:

```python
# native/tools/extract_portraits.py
import sys, os
sys.path.insert(0, "native/tools")
from extract_common import crop, chroma_key_transparent
from PIL import Image

SRC = os.path.expanduser("~/Downloads/avatar_aang_faces.png")
OUT = "native/Assets/Portraits"
# Fill in after visually locating a happy/proud expression cell in the sheet:
PORTRAITS = {
    "happy": (0, 0, 0, 0),  # (x0, y0, x1, y1)
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    im = Image.open(SRC).convert("RGB")
    for name, rect in PORTRAITS.items():
        piece = crop(im, rect)
        piece = chroma_key_transparent(piece, bg_rgb=(int(im.getpixel((2,2))[0]),
                                                        int(im.getpixel((2,2))[1]),
                                                        int(im.getpixel((2,2))[2])), tol=25)
        piece.save(os.path.join(OUT, f"{name}.png"))
        print(f"wrote {name}.png from {rect}")
```

(The background here is blue, not white, so the chroma-key sample point reads the actual corner pixel color rather than assuming white — check `open` on the output to confirm the blue is fully gone; if a fringe remains, sample a different corner or raise `tol`.)

- [ ] **Step 2: Fill in the rect, run, and visually confirm**

Run: `python3 native/tools/extract_portraits.py && open native/Assets/Portraits/happy.png`
Expected: a clean, transparent-background face crop.

- [ ] **Step 3: Add a `PortraitBurst` view and fire it on task tick**

```swift
struct PortraitBurst: View {
    @Binding var trigger: Int
    @State private var opacity: Double = 0
    var body: some View {
        if let img = NSImage(contentsOf: assetsIconURL("../Portraits/happy")) {
            Image(nsImage: img).resizable().interpolation(.none)
                .frame(width: 48, height: 48)
                .opacity(opacity)
                .onChange(of: trigger) { _, _ in
                    opacity = 1
                    withAnimation(.easeIn(duration: 0.3).delay(0.6)) { opacity = 0 }
                }
        }
    }
}
```

Host one `@State private var portraitTrigger = 0` on `Dashboard`, pass a binding down to each `TaskRow`/`Tick` (mirroring how `burstTrigger` already flows in `Tick`), and increment it from `toggleTask` right where the existing per-category `StarBurst` already fires — placing the `PortraitBurst` view itself next to the `SpriteAnimator` overlay added in Task 11.

- [ ] **Step 4: Rebuild and verify**

Run: `cd native && swiftc -swift-version 5 -O main.swift -o EsmeDay && ./EsmeDay`, tick a task.
Expected: Aang's happy face portrait briefly appears near the mascot corner alongside the elemental tick-burst, then fades.

- [ ] **Step 5: Commit**

```bash
git add native/tools/extract_portraits.py native/main.swift
git status --short   # confirm native/Assets/Portraits/*.png does NOT appear
git commit -m "Add Aang face-portrait reaction on task tick"
```

---

## Self-review notes

- **Spec coverage**: palette (Task 4), elemental tokens + migration (Tasks 5–7), Lotus tile app icon + wellbeing ticks (Tasks 8–9), Aang splash/idle mascot (Tasks 10–11), Avatar Airbender font (Task 12), background (Task 13, blocked), textbox/border art — **not yet a task**, see gap below, reaction portraits (Task 14, blocked). The parked visual-novel dialogue is intentionally excluded per the spec.
- **Gap found during self-review**: the spec's "Textbox/border art" section (9-slice panel backgrounds from the name-entry sheet) has no task above. Unlike the background/portraits, its source (`docs/superpowers/fontsavatar.png`) is already on disk — this is not blocked, just missing. Flagging rather than silently adding a rushed task: recommend a follow-up Task 15 (extract the box art, apply `.resizable(capInsets:)` to the journal-entry CTA button) sized and written with the same rigor as the tasks above, added as a fast-follow once Phase 1–7 are done and building, rather than bolted on here.
- **Type consistency check**: `Tick(on:element:wellbeing:action:)` signature is consistent between its Task 7 and Task 9 versions; `ElementIcon(element:size:)` matches usage in `StarBurst`, category headers, and `Tick`; `element(for:)` return values (`"air"|"water"|"fire"|"earth"`) match the filenames produced by Task 3 and consumed by `assetsIconURL`.
