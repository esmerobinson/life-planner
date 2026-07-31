# Tick celebration: coin-fly + mascot reaction (first SpriteKit feature)

*First of several planned gamification sessions (currency/economy, dialogue boxes, and a
cosmetic shop are separate future specs). This one covers only the moment-to-moment
celebration when a task gets ticked — no persistent coin count, no economy.*

## Why

Ticking a task today already does two things: `Model.toggleTask()` flips the checkbox and
awards a star (`Daily/stars.json`, `category-stars.json`), and `MascotModel.playReaction()`
plays the mascot's existing body-sprite reaction animation. Both stay exactly as they are —
this spec adds a third thing on top: a coin that visibly flies out of the ticked row toward
the mascot and disappears in a small burst, layered on top of (not replacing) the reaction
that already plays.

This is deliberately the first real SpriteKit feature in this app (see the earlier Xcode/
SpriteKit conversation) — a self-contained, low-risk way to prove out hosting an `SKView`
alongside the existing SwiftUI window before anything bigger (coins-as-currency, dialogue,
a shop) depends on that plumbing working.

## Two pieces of scope

1. **Give the Schedule tab a tick control** — it currently has none; `ScheduleRow` only
   *displays* `isDone` (strikethrough), it can't cause a tick. Needed so the celebration can
   genuinely fire from both tabs, per the approved design.
2. **The coin-fly + poof celebration itself**, triggered from either tab's tick action.

## Part 1: Schedule tab tick control

`ScheduleRow` currently only holds a `ScheduleBlock` (`task_ref: String?` — display text
only), not the full `TaskItem` `Model.toggleTask()` needs. `ScheduleView` already has access
to `taskModel: Model` (added earlier for the unscheduled-task pool), so:

- `ScheduleView` resolves each task-carrying block's matching `TaskItem` by display text —
  `taskModel.tasks.first { $0.display == block.task_ref }` — the same matching approach
  `ScheduleModel.reconcile()` already uses internally — and passes it into `ScheduleRow`
  alongside the block.
- `ScheduleRow` gets the same `Tick` component `TaskRow` already uses (not a new one),
  wired to `taskModel.toggleTask(matchedTask)`. This automatically gets the existing
  element-colored `StarBurst` micro-animation for free, same as Today.
- If no matching `TaskItem` is found (block references a task that's since vanished —
  `ScheduleModel.reconcile()`'s own "genuinely gone" handling already covers this case by
  freeing the slot before this ever renders), no tick control is shown, same as open slots.

## Part 2: Coin-fly + poof celebration

### Architecture

A single, persistent, transparent SpriteKit layer sits as a new sibling overlay in the
window's content view, exactly like the mascot's `SpriteAnimator` already does (see
`AppDelegate.applicationDidFinishLaunching`'s `ZStack` — this becomes a three-layer stack:
`RootView`, the coin-effects layer, `SpriteAnimator`, in that order so coins render above
the app content but the mascot stays on top of everything). It renders nothing at rest and
never intercepts clicks (`allowsHitTesting(false)`, matching the mascot layer).

**New types:**
- `CoinEffectsModel: ObservableObject` — holds one `@Published` value: a queue/trigger of
  "fire a coin from point P" requests. `Model.toggleTask()` and the new Schedule tick both
  call into this after a successful (not-already-done) tick, passing the tapped row's
  on-screen position.
- `CoinEffectsView: NSViewRepresentable` — wraps an `SKView` hosting a single persistent
  `CoinEffectsScene: SKScene` with a transparent background. Observes `CoinEffectsModel`;
  each new fire-request calls a method on the scene to spawn a coin node.

### Getting the row's position into SpriteKit's coordinate space

This is the one real technical wrinkle. `Tick`'s button already knows it was tapped, but
SwiftUI view frames and the `SKView`'s coordinate space aren't the same by default.
Approach: read the tapped `Tick`'s frame via a `GeometryReader` background (the same
pattern already used for `DayCell`'s hover tooltip positioning in the Calendar tab),
converted to the window's coordinate space via `.global` — then `CoinEffectsView` converts
that window-space point into its own view's local coordinate space (standard AppKit
flipped-Y conversion, since SpriteKit's Y axis grows upward while SwiftUI/AppKit's grows
downward) before spawning the coin node there.

### The animation itself

On a fire request: spawn an `SKSpriteNode` (a simple coin texture — reuse/recolor an
existing element icon as a placeholder until real coin art exists) at the converted origin
point, then run an `SKAction` sequence: arc toward the mascot's known corner position
(quadratic-ish path via two chained `SKAction.move` calls, or `SKAction.follow` along a
short `UIBezierPath`-equivalent `CGPath`) over ~0.4s, then a quick scale-up+fade-out
"poof" (~0.15s) with a small particle burst (`SKEmitterNode`, a handful of particles,
short lifetime), then `node.removeFromParent()`. No physics simulation needed — a scripted
path reads more "juicy game feedback" than realistic physics for something this short.

Mascot's reaction fires at the same moment via the existing `mascot.playReaction()` call,
completely unchanged — the two effects are visually simultaneous but technically
independent systems, deliberately, so this doesn't require touching the mascot code at all.

### Non-goals (explicitly out of scope for this spec)

- No persistent coin count or counter UI anywhere — confirmed poof-and-gone.
- No real coin art yet — placeholder (recolored element icon) is fine until the shop/economy
  session produces real assets.
- No sound effects — not discussed, not assumed.
- No changes to the mascot's animation system itself.

## Testing

No automated tests (consistent with the rest of this single-file personal app). Manual
verification: `swift build` (via `native/Package.swift`) or the existing `swiftc` CLI build,
run the app, tick a task from Today, confirm a coin visibly arcs from that row toward the
mascot and disappears with a small burst while the mascot's reaction plays simultaneously;
repeat from the Schedule tab's new tick control; tick a task that's part of a Schedule block
and confirm the block's own strikethrough/done-state still updates correctly alongside the
new celebration.
