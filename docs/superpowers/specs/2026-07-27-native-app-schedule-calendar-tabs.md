# Native app: Schedule + Calendar tabs (functional spec, no aesthetics)

*Placeholder styling throughout (existing mono font, dim/bright greens) — the design agent
themes this in a later pass. This spec is functional/UX only.*

## As-built (updated 2026-07-28)

Core design below shipped mostly as spec'd, plus several things added afterward in
response to live feedback, not originally planned here:

- **Add-task field** on both Today and Schedule tabs: typing suggests existing Backlog
  tasks by keyword overlap ("did you mean") before creating a new one.
- **Drag-to-schedule**: an "unscheduled" pool at the bottom of the Schedule tab lists
  today's to-dos not yet placed in any block; dragging one onto an open slot assigns it
  there. Dropping into the block containing right now starts it at now (rounded to 5 min).
- **Workouts always land in the "move" block** (Calisthenics, a walk/run, etc.) — Health
  items were originally fully excluded from scheduling; refined so exercise-type Health
  items still get a home in Dream Day's fixed rhythm block, while non-exercise Health
  lines (the nutrition reminder) stay unscheduled.
- **Delete consistency fix**: deleting a block from Schedule now also defers the
  underlying checkbox in today's note — originally it only edited `schedule.json`, so the
  task would silently reappear in Schedule on the next reload without this.
- **Design agent's later pass** replaced the native segmented Picker (mentioned above as
  still-native) with a themed `ThemedTabBar`, and layered in Silkscreen/Papyrus typography
  and border art — see the mascot spec's as-built note for the full picture.

## Why

Two problems this solves:
1. The Daily Note is cluttered by an embedded, static "Schedule" section
   (`src/planner.py:_schedule()`) that Esme doesn't want in the note or texted to her.
2. There's no deadline/calendar view anywhere today.

Both move into the native app (`native/main.swift`, "EsmeDay") as new tabs, alongside the
existing "Today" dashboard. No web app; nothing changes about WhatsApp.

## Window changes

- Remove the fixed 340×640 frame (`native/main.swift:462`); make the window user-resizable
  with a sensible minimum size (enough to render the Calendar month grid without squashing —
  suggest ~420×560 minimum, no maximum).
- Persist window size + position across launches (`NSWindow` autosave, or store in the
  existing small-JSON state pattern used for habits/stars).
- Add a top-level tab switcher (segmented control) above the existing content: **Today /
  Schedule / Calendar**. "Today" is the current `Dashboard` view, unchanged.

## Tab: Schedule

**Data source (new):** `Daily/schedule.json` — one entry per block:
```json
{ "id": "uuid", "task_ref": "<link to backlog/note task>", "start": "09:00", "duration_min": 45 }
```
Generated once per day (morning run, `scripts/run.py`) by repurposing
`src/planner.py:_schedule()`: instead of writing markdown into the Daily Note, it writes this
JSON, pre-populated with **all** of today's to-dos (not just the current top-6 `{top1..top6}`
slots — the cap goes away since this is now an editable UI list, not fixed template slots),
slotted using the existing `Daily/Dream Day.md` template as the starting shape.

**Interactions:**
- Reorder blocks (drag).
- Resize a block's duration (drag its edge).
- Delete a block — two actions on the same control:
  - **"not today"**: un-schedules the task for today only. It is *not* deleted from the
    backlog (`Goals & Direction/Backlog.md`); it becomes eligible again for `backlog.plan_for()`
    whenever it's next due/relevant (tomorrow, or its actual due date).
  - **"move to [date]"**: same as above, but writes/updates a `[due <date>]` tag on the task
    in `Backlog.md` so it resurfaces on that specific day.
- When a block is removed, the time it held becomes **open** — nothing auto-shifts to fill
  the gap (she placed things deliberately; auto-collapsing would silently move other blocks).
  An open slot is a visibly empty row she can drag another task into, or leave alone.

**Live sync (source → schedule):**
- If a task referenced by `task_ref` is ticked done, deleted from the Daily Note, or removed
  via a WhatsApp reply (any path that already writes to the vault), its block disappears from
  the Schedule tab and that slot goes open — same as a manual delete, just triggered by the
  underlying data changing instead of a direct tap.
- If a *new* task appears mid-day (WhatsApp text-in, Google Tasks sync via
  `scripts/cron_dispatch.py`), it **auto-inserts into the next open slot** in today's schedule
  (if one exists; otherwise it just sits in the backlog until a slot opens or tomorrow's
  regen). Mark it with a small "new" indicator for a few minutes so it doesn't feel like it
  silently appeared.
- **Mechanism:** replace the existing 5-minute poll (`native/main.swift`, the
  `Timer.scheduledTimer` in `AppDelegate`) with an `FSEventStream` watch on the vault folder,
  so edits from any source (Obsidian, the WhatsApp pipeline writing to the vault, this app
  itself) reflect within roughly a second. This is a local macOS API — no network calls, no
  LLM calls, no cost.
- **Edits write back**: dragging/resizing/reordering writes the new block list straight to
  `Daily/schedule.json` (same pattern as `toggleTask`/`toggleHabit` already use for other
  state). "Move to [date]" additionally edits the task's line in `Backlog.md`.

## Tab: Calendar

- Toggle control (top of tab) between **month grid** and **agenda/list** view of the same
  data — not two separate features, one dataset, two renderings.
- Data source: parse `[due yyyy-mm-dd]` tags out of `Goals & Direction/Backlog.md` (the
  existing `_DUE_RE` regex in `src/backlog.py:25` — reuse the same parsing logic, don't
  reimplement it in Swift; either call out to `backlog.parse()` or port the identical regex).
- **Only** due-dated tasks/deadlines — no recurring commitments (`[recur: ...]` items are
  explicitly excluded from this view per Esme's answer).
- Month grid: a badge/dot on days with a due task; tapping a day shows that day's due items.
- List view: flat, sorted by due date ascending.
- Read-only for now (no spec'd interaction beyond viewing — tapping a task could jump to it
  in Obsidian, consistent with the existing `openInObsidian` pattern used elsewhere in the app).

## Open implementation questions for whoever builds this (not for Esme — technical calls)

- Exact drag/resize gesture implementation for the Schedule timeline (SwiftUI `DragGesture`
  composition) — no existing precedent in this codebase, will need to be built from scratch.
- Whether `schedule.json` generation on the Python side and the FSEvents watch on the Swift
  side both need to guard against read/write races (e.g. app reads mid-write from the morning
  cron job) — likely solved with the same atomic-write pattern already used for the other
  JSON state files, worth confirming `writeVault`/`saveJSON` already do this safely.
