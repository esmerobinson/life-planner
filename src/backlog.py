"""The single task backlog: parser + daily triage.

Reads `Goals & Direction/Backlog.md`, where every task lives on one line:

    - [ ] task text !p1 [due 2026-09-01] [recur: mon,wed,fri] #thread

Selection rule for a day (the thing that keeps daily plans short and right):
    1. today's recurring rhythm items (by weekday)
    2. overdue / due within DUE_HORIZON days (highest priority first)
    3. p1 tasks, then rotating p2 picks, up to the day's capacity
    Sundays: rhythm + genuinely-due only. Parked/Inbox sections are never auto-picked.
"""

import re
from datetime import date, timedelta

from src import vault

BACKLOG_PATH = "Goals & Direction/Backlog.md"
DUE_HORIZON = 3          # days ahead a due date starts surfacing
CAPACITY = 3             # backlog picks per day, on top of rhythm
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

_TASK_RE = re.compile(r"^- \[( |x|>)\] (.+)$")
_PRIO_RE = re.compile(r"\s*!p([123])\b")
_DUE_RE = re.compile(r"\s*\[due (\d{4}-\d{2}-\d{2})\]")
_RECUR_RE = re.compile(r"\s*\[recur: ([a-z,]+)\]")
_TAG_RE = re.compile(r"\s*#([\w-]+)")


def parse():
    """Return (tasks, rhythm): open backlog tasks and recurring rhythm items."""
    tasks, rhythm, section = [], [], ""
    for ln in vault.read(BACKLOG_PATH).splitlines():
        if ln.startswith("## "):
            section = ln[3:].strip().lower()
            continue
        m = _TASK_RE.match(ln.strip())
        if not m or m.group(1) != " ":
            continue
        if "parked" in section or "moved elsewhere" in section:
            continue
        raw = m.group(2)
        recur = _RECUR_RE.search(raw)
        prio = _PRIO_RE.search(raw)
        due = _DUE_RE.search(raw)
        text = _TAG_RE.sub("", _RECUR_RE.sub("", _DUE_RE.sub("", _PRIO_RE.sub("", raw)))).strip()
        item = {
            "text": text,
            "prio": int(prio.group(1)) if prio else 2,
            "due": date.fromisoformat(due.group(1)) if due else None,
            "days": recur.group(1).split(",") if recur else None,
            "tags": _TAG_RE.findall(raw),
            "inbox": "inbox" in section,
        }
        (rhythm if item["days"] else tasks).append(item)
    return tasks, rhythm


def plan_for(d=None, done=None):
    """Return (rhythm_today, picks) for the day. `done` = normalized texts to skip."""
    d = d or date.today()
    done = done or set()
    wd = WEEKDAYS[d.weekday()]
    tasks, rhythm = parse()

    def fresh(t):
        norm = " ".join(t["text"].lower().split())
        return norm not in done

    today_rhythm = [t for t in rhythm if wd in t["days"] and fresh(t)]

    pool = [t for t in tasks if fresh(t) and not t["inbox"]]
    due = sorted([t for t in pool if t["due"] and (t["due"] - d).days <= DUE_HORIZON],
                 key=lambda t: (t["due"], t["prio"]))
    if wd == "sun":                     # Sunday stays light: rhythm + truly due only
        return today_rhythm, due[:2]

    picks = list(due)
    p1 = [t for t in pool if t["prio"] == 1 and t not in picks]
    picks += p1[: max(0, CAPACITY - len(picks))]
    if len(picks) < CAPACITY:           # rotate p2s so different ones surface each day
        p2 = [t for t in pool if t["prio"] == 2 and t not in picks]
        if p2:
            start = d.toordinal() % len(p2)
            picks += [p2[(start + i) % len(p2)] for i in range(min(CAPACITY - len(picks), len(p2)))]
    return today_rhythm, picks[:CAPACITY + len(due)]


def format_task(t, d=None):
    d = d or date.today()
    text = t["text"]
    if t.get("due"):
        days = (t["due"] - d).days
        text += " (overdue!)" if days < 0 else (" (due today)" if days == 0 else f" (due in {days}d)")
    return text


def add_to_inbox(text):
    """Append a captured task to the Inbox (to triage) section."""
    from src import storage
    content = vault.read(BACKLOG_PATH)
    marker = "## Inbox (to triage)"
    line = f"- [ ] {text.strip()}"
    if line.lower() in content.lower():
        return False
    if marker in content:
        content = content.replace(marker, f"{marker}\n{line}", 1)
    else:
        content = content.rstrip() + f"\n\n{marker}\n{line}\n"
    storage.write(BACKLOG_PATH, content)
    return True
