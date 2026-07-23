# Architecture, the one-page map

**Everything lives in ONE place: the Obsidian vault** (`~/Desktop/Esme's Brain` = a Google
Drive folder). Every other piece just reads it, writes it, or displays it. Markdown + a few
small JSON state files, all visible and editable.

```
                         ┌────────────────────────────────────┐
                         │  THE VAULT (Obsidian / Google Drive)│  ← single source of truth
                         │  Goals.md · Backlog.md · Daily Notes│
                         │  reminders/manifestations/prompts   │
                         │  state: habits/stars/sent/done .json│
                         └───────▲────────────────────▲───────┘
                                 │ Drive API (as Esme)│
   WhatsApp ◄── sends ──┐ ┌──────┴──────┐      ┌──────┴───────┐
   (her phone)          ├─┤GITHUB ACTIONS│      │ HER, directly │
      │ replies         │ │ the engine   │      │ in Obsidian   │
      ▼                 │ └──────┬──────┘      └───────────────┘
   Cloudflare Worker ───┘        │ builds
   (catches replies into a queue)▼
                          docs/index.html → GitHub Pages = the dashboard
```

## The schedules (all cloud, Mac not needed)
| When | What |
|---|---|
| 08:30 / 13:00 / 17:00 | `run.py`: morning generates the Daily Note from Goals+Backlog, all three send check-ins |
| every 5 min | `process_replies.py`: file her replies into the vault, mood-adaptive response, chase unanswered check-ins after ~100 min |
| ~06:00 daily | `cron_dispatch.py`: Google Tasks → Backlog inbox (once a day) |
| ~21:30 daily | nightly Day in review, built FROM her replies, written to the note + sent |
| Sun ~18:00 / 1st | weekly review / monthly check-in → Weekly Priorities / Goals for month |
| 07:00 + 17:30 | dashboard rebuild → GitHub Pages |
| work hours, 20 min | `proactive.py`: gentle drift nudge (needs the Mac's activity signal) |

## Data: what lives where
- **Tasks:** `Goals & Direction/Backlog.md`, the ONE landing page (typed, texted, or via
  Google Tasks). Format: `- [ ] task !p1 [due 2026-09-01] [recur: mon,wed] #thread`.
- **Goals:** `Goals & Direction/Goals.md` (direction) + `Goals & Habits.md` (dashboard numbers).
- **Each day:** one Daily Note, plan + her ticks + her reflections + the nightly review.
- **Small state** (streak/star/sent/reply tracking): JSON files in `Daily/`, visible, tiny.
- **Legacy** (superseded, kept until she archives them): Master To-Do, Task Inbox (organized).

## The only local pieces (optional, Mac)
- `scripts/activity.py` (launchd): the vague app-in-front signal for proactive nudges.
- `swiftbar/planner.10m.py`: menu-bar glance (prototype).

## Dashboard
Static page rebuilt from the vault, published at
**https://esmerobinson.github.io/life-planner/** , installable to a phone home screen
(PWA). Read-only today; making it interactive (tick/reprioritise) is the planned v2 via
the Cloudflare Worker.
