# Life Planner, PRD (working draft)

*A living doc. Purpose: see the whole system at once, agree the data model, and catch gaps before building.*

## 1. Vision
A personal operating system for Esme that makes it easy to show up for her own life every day, reliably, calmly, and playfully. It replaces guilt and scattered focus with a clear daily rhythm, honest check-ins, and visible progress toward the life she wants. It should be sustainable for years.

## 2. The three surfaces (one brain behind them)
All three read and write the **same data** (source of truth in Obsidian, see §3):
1. **WhatsApp agent** — the daily voice: morning plan, midday + evening check-ins, mood-adaptive support, gamified encouragement. Where she is most of the day.
2. **Desktop dashboard / widget** — the glance: today's tasks on one side, goal progress on the other, quote + manifestation of the day at the top, a star chart. A small always-visible widget at the top of her screen, plus a fuller view (with a calendar of deadlines).
3. **Obsidian vault** — the workshop: where she reads and writes goals, manifestations, reminders, project notes, and daily notes.

## 3. Data model (corrected: the tool GENERATES, it doesn't just read)
**Reality (Esme, 2026-07-22):** Obsidian is *not* a clean source of truth yet, and the tool must actively **generate** the daily plan and the weekly + monthly reviews from her goals and activity. Obsidian is where she reads/edits; the engine reads goals + backlog and writes the generated plans back. The data has to be organised for this to work, right now it's messy and the daily messages are too long.

**The pieces:**
- **Goals (clean, focused)** — the direction the engine plans toward. Must be organised so it's crystal-clear what she's actually going for.
- **One task backlog / inbox (the "landing page")** — the single place *every* to-do lands, whether typed in Obsidian or sent to the WhatsApp bot. Each task carries metadata: **priority, due date, recurring, project, status.**
- **The engine** — reads goals + backlog + due dates + recurring + daily capacity, and generates: the **daily plan** (triaged + spaced by priority), the **weekly review**, the **monthly review**.

### 3a. Task model (new)
Every task: `text · project · priority(1-3) · due(optional) · recurring(optional: daily/weekly/Mon..) · status`. Where to store it (decision needed):
- **(a) an Obsidian Base** (a database table: task / priority / due / recurring / project / done). She already has the Bases plugin. Clean, editable as a table, one source of truth for tasks.
- **(b) a structured markdown Inbox** where each line carries light tags, e.g. `email the venues !p1 📅2026-07-30 🔁weekly #eti`.
*Lean: (a) a Base, it's the cleanest single backlog and she can see/sort it.*

### 3b. Triage + spacing (new)
Each morning the engine picks the day's tasks by: **due-soon first → higher priority → then fill up to a daily capacity (~3-4 meaningful tasks)** with backlog items, spacing lower-priority work across lighter days so nothing piles up and nothing is forgotten. **Recurring** tasks appear on their days. This is what makes the daily message short and right.

### 3c. First job, together: clean up Obsidian
Before the pretty widget, we do a **collaborative triage**: organise goals down to what she truly wants, build the single clean backlog, set priorities / due dates / recurring. Then generation is accurate and the messages get short. This is the real v1.

## 4. Dashboard (glance widget + full view)
**Widget (top of screen, always visible):**
- Quote of the day + manifestation of the day (top)
- Today's tasks (one side) with tick + quick reprioritise (drag or up/down)
- Goal progress (other side): bars toward each big goal
- Star chart: today's/this week's earned stars
- "Simple but coquette", cute, cozy

**Full view (opened from the widget):**
- Everything above, larger
- **Calendar view** with deadlines
- Bigger star chart / history
- Edit goals + reprioritise

**Reprioritise:** she can reorder/change today's tasks on the dashboard; it writes back to `Focus.md` / the daily note.

## 5. Gamification
- **Stars:** completing a task, hitting a habit, or reporting good progress on WhatsApp earns a star.
- **Star chart:** a visible board that fills up (day / week). Cozy, collectible feel.
- **Streaks:** already built for daily habits.
- **WhatsApp loop:** the agent asks how she's doing / what she's working on; a good answer earns a star and points her to the dashboard.
- **Theme:** Animal Crossing, cozy, warm, seasonal, gentle (candidate, see design directions).

## 6. Non-negotiables (from how she works)
- **Reliable** (cloud, runs without her Mac). Already true for reminders.
- **Calm, not overwhelming.** Short lists, one purpose per view.
- **Her voice**, never guilt.
- **She owns the data** (editable in Obsidian).

## 7. Open questions / gaps to resolve together
1. **Widget tech:** desktop widget (Übersicht, renders HTML on the desktop, reuses our dashboard) vs a native macOS app/WidgetKit vs menu bar (SwiftBar, already prototyped). Trade-off: speed vs polish.
2. **Theme:** Animal Crossing cozy vs coquette pastel vs calm terminal (musicforprogramming). Can the widget be cozy while the vault stays its own thing? (Probably yes.)
3. **Reprioritise + edit from dashboard:** needs the dashboard to *write* to Obsidian, not just read. Doable, but is it worth it vs editing in Obsidian? (Maybe v2.)
4. **Deadlines / calendar:** do we add due-dates to tasks now (and where), and do we want to sync with Google Calendar or keep it in-vault?
5. **Stars:** what exactly earns a star, and how many feels rewarding-not-cheap?
6. **Scope / phasing:** what's v1 (ship this week) vs later?

## 8. Suggested phasing (corrected, foundation first)
- **v1 (the real foundation):** clean up Obsidian *together* → organise goals, build the **single task backlog (Base)** with priority/due/recurring, one input landing page. Then the engine generates a **short, right** daily plan + weekly + monthly reviews, triaged and spaced by priority. Fix the too-long messages.
- **v2:** the desktop widget / dashboard (Übersicht, themed) reading the clean data: today's tasks + goal progress + quote/manifestation of the day + star chart. Calendar view with deadlines.
- **v3:** reprioritise/edit from the dashboard (writes back); deeper Animal Crossing gamification; Google Calendar sync if wanted; native app polish (Fable firepower).
