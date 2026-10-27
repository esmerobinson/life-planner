# Life Hub: design

A personal hub app (Mac + phone) replacing Obsidian, Google Tasks and the Notes app for to-dos, projects, goals and ideas. Written 2026-10-27 from the brainstorm with Esme. "Said" = Esme's decision. "My call" = a default the builder or Esme can overturn.

## Intent and why
Esme can't see what to spend time on each day, can't see priorities, and can't open a section of her work (writing, art, content, health) and see its to-dos, ideas and goals together. Obsidian is text-heavy and she forgets it exists; she dumps tasks into Notes and Google Tasks and they get lost. She wants Notion's feel (board and table views, clean linked pages, everything in one place or filtered by area) with a tool that triages for her, reminds her, and makes each small tick visibly move a goal.

Success in a month (said): she checks her to-dos every morning, works toward every goal a little each day, never feels lost about what to do, and looks back happy that she did a bit of everything because the system was organised.

## Goals
1. **Home** (said, layout "A"): sidebar to browse; centre = a calm **Today** list of 3-4 picks chosen by the app; right column = **goal progress bars**. Below Today, a **Journal card** (said, "A2") with two buttons: Morning pages, Daily check-in.
2. **Goals drive everything** (said). Goals have tasks, habits and projects attached. Ticking a task, even a small one, visibly moves the goal's bar (+ confetti and a star). Each goal view shows what can be done today / this week / this month (e.g. "10 calisthenics sessions this month: 6 done, one today moves it").
3. **Every project has a deadline** (said; required field, soft default allowed). Some goals are loose and unplanned and can exist without tasks.
4. **Browse three ways** (said): by life area, by priority, by project/goal. Areas seen so far: Book, Hardware art, Content creation, Mental health, Calisthenics, Painting, Substack/articles, Artist's Way, plus small projects. To-dos, ideas and goals can be viewed separately or together. Views: board, table, calendar, list, with filter toggles.
5. **Move-to menu everywhere a task appears** (said): Today / Tomorrow / This week, plus kill. Works from Today, from goal pages, and from area pages.
6. **Quick-add is a form with fields** (said): what, area, goal (optional), priority, deadline, recurring. Fields are what let the triage work. Ideas, reading notes, wishlist and research items are also capturable (different type, no deadline required).
7. **Triage picks Today for her** (said): engine chooses using due dates, priority, recurring cadence, goal needs; fully overridable. Existing logic to reuse: `src/backlog.py` (`plan_for`, parse of `!p1`, `[due]`, `[recur]`, `#tag`).
8. **Nothing disappears** (said). Overdue items stay on lists with an OVERDUE sticker. Stale items ("you haven't looked at this in a while") prompt: kill / reprioritise / reschedule. A popup with the Animal Crossing mole looking sad appears for missed items (mascot behaviour is gated on art direction, below).
9. **Reminders and notifications** (said) on Mac and phone from the app (not WhatsApp): a prompt to plan the day, due-day prompts for reviews.
10. **Reviews** (said): weekly and monthly review pages are generated with questions plus a free-reflection section. She is prompted on the due day by task or popup.
11. **Journal area** (said): its own sidebar page.
    - **Morning pages** (Artist's Way): no prompts, by design (the technique is three pages, no topic, no editing or rereading). She writes "a bit of both" paper and screen. In-app: photo upload as proof (said), optional typed/stylus entry, completion tick and streak. Typed entries are hidden after saving (my call, matches the no-rereading rule).
    - **Daily check-in** (said): DBT-style, rotating prompts. Starter set from Esme: what triggered negative feelings; good things that happened and why they're good; if a trigger comes, take 10 minutes to breathe; what the trigger points to / what the negative emotion is responding to in the world. Builder writes a larger rotating bank in the same spirit; Esme reviews it. This is a mental-health feature, so tone is never guilt (project principle).
12. **Vision board and manifestations page** (said): image-based, own sidebar entry; images are first-class (she disliked doing it in Notion).
13. **Google Calendar integration** (said): events shown alongside Today/calendar view; deadlines can appear on the calendar. Direction of sync (read-only vs write deadlines) is the builder's call to propose.
14. **Import so nothing is lost** (said): from Obsidian (`Goals & Direction/Backlog.md`, `Goals.md`, vault notes), Google Tasks (existing `scripts/gtasks_sync.py`), and Notes app (manual paste/import). Reuse the parsers already written.
15. **Gamification** (said): stars and confetti on completion; bars for goals.

## Non-goals
- Not a Notion clone: no general block editor is required for v1. Pages need simple rich text, links between pages, and attached links/images.
- No WhatsApp (said). The existing WhatsApp scripts, GitHub Actions engine, SwiftBar and native Swift app are retired or reused only for logic (said: "all of it I don't mind" losing).
- Single user. No auth beyond protecting her own data, no sharing (said).
- No paid services (said).

## Anti-goals (a failure even if it technically works)
- Anything that makes her feel overwhelmed by text, or guilt-trips her about missed items.
- Another place tasks can get lost: capture must be fast on both devices.
- A Today list longer than about 4 by default.
- Losing or locking in her data.

## Constraints (said)
- **Free**, **local to her PC**, core notes **backed up elsewhere**, **editable on phone**, **works offline** (ideal), notifications on phone and Mac. She is comfortable creating free accounts. Cloudflare account already exists.
- Animal Crossing-leaning, cute, clean, dark mode available (said "sure"). **No colour, type, easing, composition or timing choices are made in this document.**

## Art direction (blocking for visuals, not for structure)
`CLAUDE.md` forbids choosing colour, easing, type, composition or timing. There is no `VISUAL-LANGUAGE.md` yet. Esme has said: Notion's cleanliness but cuter, Animal Crossing wiki as reference, bars for progress, confetti and stars, mole popup, a "design cycle" with a design agent and a few simple options. Plan: Esme supplies reference screenshots/links; those become `VISUAL-LANGUAGE.md`; until then every build uses obviously-placeholder styling (magenta, system font, linear easing). The existing `design-options` agent is hard-wired to a dark theme with no cute styling, so a copy should be adapted to read `VISUAL-LANGUAGE.md`. Any technical choice that narrows aesthetics (e.g. a UI kit with fixed look) must be flagged before adopting.

## Architecture (my call; Esme asked for a custom tool, free, local, with phone access)
- **Installable web app (PWA)**: one codebase for Mac and phone, offline-capable, supports notifications. Not a native Swift app.
- **Master data location: see Open decision 1.** Recommended: free Cloudflare tier (Worker + D1/R2, already in use) as the sync point, with each device holding a local copy, plus a nightly export of core notes to plain files on the Mac and a second off-site copy.
- Stack suggestion (builder may change): React + TypeScript + Vite, IndexedDB locally, Cloudflare Worker + D1, web push. Reuse: Python parsers for import; Cloudflare worker patterns.

## Decisions made by Esme (2026-10-27)
1. **Master copy: Cloudflare free tier** (Worker + D1/R2), each device keeps a local copy, Mac keeps an exported plain-file backup (said: "b").
2. **Journal privacy: end-to-end encrypted** with a passphrase only she holds (said: "i"). No server-side search of journal content; a lost passphrase means lost entries, so the app must make that clear at setup and offer a recovery key she stores herself.

## Settled by me (builder review, 2026-10-27; Esme can overturn)
- **Kill = archive.** Item is hidden but recoverable from an Archive view. Progress already earned stays; a killed task leaves the goal's denominator.
- **Goal progress has two levels** (Esme: goals are huge and long-term, e.g. a book, years of calisthenics, becoming a good artist, so one bar is wrong). (1) **Overall arc**: for finite goals (book) a bar of milestones done / total milestones she defines; for open-ended practices (calisthenics, art) no bar that can "finish", instead cumulative evidence (sessions this year, months in a row, streak). (2) **This month**: a monthly target with a bar (e.g. 10 sessions, 12 chapters' worth of outline steps) that tasks, habits and projects feed directly; ticking a task moves this bar and, if the task is a milestone, the arc. Monthly bars reset on the 1st with the monthly review. Loose goals with nothing attached show an empty bar and a prompt to plan, not a warning. The exact mapping is my guess pending Esme's confirmation.
- **Today vs the cap.** Up to 4 picks. Overdue and due-today items compete for those slots first; any overflow sits in a collapsed "Also due (n)" row, never hidden. Her moves (pin/remove/reorder) stick for that day and reset the next morning.
- **Triage.** `src/backlog.py` `plan_for` is the starting rule (recurring, then due within 3 days, then p1, then rotating p2). Port the logic, add "goal needs a move this period" as a tie-breaker.
- **Import.** Followed by a guided manual triage session at kickoff for items with no obvious home (Esme agreed). One-shot first, then re-runnable and idempotent (dedupe by source + source id) because she will keep using old tools for a while. Items without an area land in an Inbox to triage.
- **Offline.** Phone and Mac queue writes offline and sync later; last write wins per field (single user). Push notifications must reach a closed app via web push from the Worker; iOS requires the PWA added to the home screen.
- **Defaults, all configurable.** Plan-the-day reminder 08:30; an item is "stale" after 14 days untouched; weekly review Sunday, monthly review the 1st.
- **Mole popup.** A magenta placeholder until art direction exists. Animal Crossing artwork is not bundled; Esme supplies or approves any assets (personal use only).

## Left to the builder
Data schema, sync/conflict handling, notification mechanics (iOS needs the PWA added to the home screen), prompt-bank wording, the triage scoring details beyond the existing rule, calendar sync direction, import tooling, and test strategy. Visual styling waits for `VISUAL-LANGUAGE.md`.

## Suggested order (my call)
1. Data model + import of existing backlog/goals; local-only Today view with placeholder styling.
2. Goals with progress bars; move-to menu; quick-add form; areas and board/table views.
3. Phone access + sync + backup.
4. Notifications and reminders; overdue handling; mole popup.
5. Journal (morning pages upload, daily check-in); weekly/monthly reviews.
6. Vision board; Google Calendar integration.
7. Design cycle and visual polish once `VISUAL-LANGUAGE.md` exists (can run in parallel from step 1).
