# Goal cascade redesign: Master → Monthly → Weekly → Daily

*Design doc. Status: agreed with Esme in conversation on 2026-07-27, live-tested with a real task. Not yet implemented.*

## 1. Problem

Goal and task data was spread across 12+ overlapping files in `Goals & Direction/`
(`Backlog.md`, `Master To-Do.md`, `Task Inbox (organized).md`, `Goals.md`, `Goals for
year.md`, `Direction Plan.md`, `Goals & Habits.md`, `Mind & Relationships Goals.md`,
`Stress List 1.md`, `Reminders about your work this year.md`, plus the auto-generated
`Weekly Priorities.md` and `Goals for month.md`). Several actively disagreed with each
other (e.g. Direction Plan's 20k-follower target vs. Goals.md's 10k; three different
weekly-schedule definitions).

Worse, the cascade wasn't real in code: `src/backlog.py` only ever read `Backlog.md`.
The weekly and monthly review docs were one-shot Gemini prose, regenerated wholesale,
never read back by anything — so "month → week → day" was three disconnected surfaces
that each restated targets slightly differently, and nothing enforced consistency
between them.

Esme's ask: one clean capture point, quantified monthly targets, an editable weekly
plan, and a daily touchpoint that's just today's slice of that — "nothing else should
exist."

## 2. The four tiers

**Tier 0 — direction, not tasks.** `Goals.md` stays as-is: identity + measurable
marker + weekly rhythm, per life thread. Not machine-parsed for triage; read by the
monthly/weekly planner as context for what a month "should" contain. `2026 Goals.md`
(rename of `Goals & Habits.md`) holds the plain numeric trackers (`Instagram followers:
1200 / 10000`) that the reconcile step updates and the dashboard/native app read.

**Tier 1 — `Backlog.md`, the one capture point** (already renamed conceptually to
"Master To Do" in conversation; filename can stay `Backlog.md` to avoid breaking
existing links). Every task lands here — typed directly, via WhatsApp, or via the
GTasks sync. Nine sections, matching Goals.md's threads plus two: Writing, Content,
Vibecoding, Art, Production, Inner work, Health, Life admin, Leisure. Plus:
- `## Inbox (to triage)` — transient. Anything landing here gets filed into a real
  section the same day (or immediately, for same-day-due items). Never a resting
  place.
- `## 🔁 Weekly rhythm` — recurring items, `[recur: mon,wed,fri]` tags. The one
  machine-readable source of cadence; Goals.md's "Weekly:" lines are the human-facing
  restatement, not a second source of truth.
- `## Parked / someday` — engine ignores, nothing deleted.

Task line format (unchanged from current `backlog.py`):
`- [ ] text !p1-3 [due YYYY-MM-DD] [recur: mon,wed] #thread`

**Tier 2 — Monthly To Do** (rename of `Goals for month.md`). Quantified targets only,
in the same nine sections, each with a progress count updated by reconcile:
`- [ ] 4 Substack posts (1/4)`. Only holds rhythm-derived counts and due-this-month
one-offs — **not** every task; a one-off like "eat a protein yogurt" never appears
here (confirmed in the live test, §6). Terse footer (1-2 lines, factual) instead of
the current prose review.

**Tier 3 — Weekly To Do** (rename of `Weekly Priorities.md`). This week's slice,
day-tagged (`· mon`), freely editable — edits always win over the next regen. Same
nine sections, only populated where there's something this week. Terse footer.

**Tier 4 — Daily Note** (unchanged file/location). Dog, manifestation, then
**sectioned** "To do today" (only sections with tasks that day), Health, Reminders,
Reflections. **No Schedule section** (removed from `planner.py` on 2026-07-27,
per repeated explicit request).

## 3. Engine: deterministic spine, AI plans and audits, never authors

- **All arithmetic is pure code.** Parsing, tick roll-up, carry-forward, progress
  counts, format enforcement. This is what makes "edit freely, everything catches up"
  trustworthy — extends the existing `backlog.py` parser to all four tiers.
- **AI plans Weekly/Monthly/Daily by selecting from real task IDs only.** "ID" here
  is the task's exact text as parsed from Master (the same normalization
  `backlog.py`/`planner._base()` already do for dedup) — no separate numeric ID
  scheme needed. Given goals, the parsed Master list, the recur schedule, capacity
  limits, and recent completion history, the AI **chooses and day-assigns** — judging
  what's achievable, balancing the week. **Every output line is validated against
  Master before being written (exact or near-exact text match); anything that doesn't
  match a real task is dropped.**
  If the AI call fails or returns something unparseable, fall back to the existing
  deterministic rule (due-first → priority → capacity cap → rhythm-by-day, the same
  logic already in `backlog.plan_for()`).
- **AI runs one alignment check, one line, only when something's off.** Compares real
  progress (Monthly's counts, days elapsed in the period) against Goals.md's markers.
  Silent on a normal day/week. Example: `⚠ no book sessions this week — goal says 3`.
  Never prose, never multi-line, never fires just to have something to say.
- **AI never invents tasks, manifestations, or reminders.** Those keep coming only
  from Esme's own banks (`Manifestations & Vision Board`, `Daily reminders.md`) —
  already the existing rule, restated here because it's load-bearing.
- **The old prose weekly/monthly review is dead.** No "Week in review" narrative, no
  "honest line," no evaluative commentary on her character. Esme was explicit this
  isn't wanted, even though it existed in the shipped code — replaced by the terse
  footer described in §2.

## 4. Pipeline

**Every morning, before Daily is generated:**
1. **Reconcile (pure code).** Read yesterday's Daily Note. Ticked (`[x]`) lines roll
   up: match against Weekly's line → increment its count → increment Monthly's
   matching quantified target → increment 2026 Goals where relevant. Hand-typed lines
   that don't match any known Master task get filed into Master's Inbox. Deferred
   (`[>]`) and anything Esme edited by hand are left exactly as she left them.
2. **Generate today's Daily** from the *current* Weekly To Do (not straight from
   Master) — today's day-tagged items + today's rhythm. AI selects/validates per §3;
   deterministic fallback if it fails.
3. **Alignment audit**, appended only if triggered.

**Sunday evening — Weekly regen:** after the normal morning reconcile, AI re-plans
next week's Weekly To Do from Monthly's *remaining* targets + Master (due/priority/
rhythm), day-tagged, capacity-capped. Terse footer.

**1st of the month — Monthly regen:** AI re-plans Monthly To Do from Goals.md's weekly
rhythm × weeks-in-month + Master's due-this-month items. Terse footer.

## 5. Vault cleanup already done (2026-07-27, live, not simulated)

- `Backlog.md`: Inbox emptied and triaged, split into the 9 sections (added
  Vibecoding, Health, Leisure; split "Content & creative tech" into Content +
  Vibecoding), ~15 duplicate/stale/cryptic items resolved with Esme directly, due
  dates added, 6 tasks rescued from legacy files that had never made it in.
- Archived to `Archive/Superseded Task Lists (merged into Backlog, 2026-07-24)/`:
  `Master To-Do.md`, `Task Inbox (organized).md`, `Mind & Relationships Goals.md`,
  `Goals for year.md`, `Direction Plan - Building a Creative Life.md`, `Reminders
  about your work this year.md`, `Stress List 1.md`.
- Merged: the relationship daily-practice rotation → `Oliver & Me - Relationship
  Notes.md`; the "Work & creative confidence" reminders → `Daily reminders.md`;
  Inner work identity lines → `Goals.md`, written out properly instead of a one-line
  summary.
- Fixed dead links / findability in `Mind & Wellbeing - Home.md` and `START HERE.md`.
- `Weekly Priorities.md` and `Goals for month.md` stripped from prose review format
  to clean checklists (ahead of the tier rename in §2 — content is already in the new
  shape, filename rename is the only thing left).

## 6. Live test (2026-07-27)

Task "eat a protein yogurt by the end of the day" run through the full pipeline by
hand, writing directly into the real vault files, to validate format before
committing to the design:

1. Dropped into Backlog Inbox (raw capture state, shown then immediately triaged).
2. Triaged into Health: `!p1 [due 2026-07-27] #health` — same-day due date, so triage
   happened immediately rather than waiting for a morning batch. **Open question,
   §7.**
3. Added to Weekly To Do under a new Health section, day-tagged `· mon`.
4. **Correctly skipped Monthly** — confirmed one-offs shouldn't appear there.
5. Added to today's Daily Note, Health section.
6. Esme ticked it for real, via her native macOS widget (`EsmeDay.app`), which writes
   directly to the Daily Note as plain markdown checkboxes — confirming the widget's
   write format matches what every tier in this design assumes (no adapter needed).
7. Roll-up completed by hand: Master ticked, Weekly ticked, Monthly correctly
   untouched.

This becomes the first acceptance test once built (§8).

## 7. Decisions (resolved 2026-07-28, quick-fire)

- **Same-day-due items**: triage immediately on capture, not just at next morning's
  reconcile. If a captured task states a due date of today (or "by end of day"/etc.),
  file it into its real section right away instead of leaving it in Inbox overnight.
- **Filename**: rename `Backlog.md` → `Master To Do.md`, for real, to match the
  language used everywhere else. All code paths and vault links need updating
  (`obsidian.MASTER_TODO`, `backlog.BACKLOG_PATH`, `START HERE.md`, etc.) — this is an
  implementation-plan item, not yet done.
- **Second intention of the day**: append as an "updated intention" rather than
  overwrite. `set_intention`'s current single-slot-replace behavior (fixed
  2026-07-27) needs a follow-up change: keep the first intention visible and add the
  new one underneath, clearly marked as updated — not silently discard it.
- **"Remove" semantics**: removing a task from today should drop it from today's view
  entirely, while it remains in the overall task pool (Master) rather than being
  deleted outright. This is different from both current behaviors — `tick_task`
  (marks done, permanent) and `defer_task` (marks `[>]`, stays visible on today's
  note). Needs a new action: pull the line out of today's Daily Note display, leave
  the Master task open/untouched so it can be picked up another day.
- **Router misfiling meta-feedback** (unresolved): Esme's messages *about* the bot
  ("that's too much") get filed as journal/reflection content by `router.py`'s Gemini
  classifier instead of being recognized as feedback about the message itself.
  Flagged, not fixed — deeper than this design's scope, needs its own pass on
  `ROUTER_SYSTEM`.

## 8. Acceptance tests (for the implementation plan)

1. Capture → triage: an untagged item in Inbox is filed into the right section with a
   sensible priority by the next reconcile; Inbox ends up empty.
2. Tick roll-up: ticking a rhythm-linked task in Daily bumps Weekly's count, which
   bumps Monthly's count, which bumps 2026 Goals where relevant — **with zero manual
   editing** (the gap the live test exposed: it worked, but a human did the roll-up).
3. Edits stick: a task manually moved to a different day in Weekly is respected by the
   next day's Daily generation, not overwritten by regen.
4. AI can't invent: feeding the planner a task ID absent from Master results in that
   line being dropped, not written.
5. Deterministic fallback: if the AI call fails, Daily/Weekly generation still
   produces a valid result via the existing rule-based logic.
6. Audit silence: a normal, on-pace week produces no alignment-audit line.
7. Audit trigger: a goal thread untouched past a threshold produces exactly one
   warning line, referencing only real goals/tasks.
8. Capacity respected: once a Monthly target is met, Weekly regen doesn't keep
   scheduling more of that rhythm item for the rest of the month.
9. One-offs skip Monthly: a due-dated one-off task (like the yogurt test) never
   produces a Monthly To Do line.
