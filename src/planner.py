"""Generate the daily note. Four sections only, kept short on purpose:

    ˚₊✩ To do today ✩₊˚   focus (pinned) + a few carried + a rotating couple from the backlog
    ✿ Health ✿           movement + nutrition (from vault.daily_health, never duplicated in To do)
    ♡ Reminders ♡        one line
    ☾ Reflections ☽      empty, filled through the day

Design rules that keep it calm:
  - Focus lives in Calendar/Focus.md and is pinned first every day.
  - Everything is de-duplicated (ignoring the '(carried Nd)' tag and area prefixes).
  - Health/movement items never appear in To do (they belong only under Health).
  - The backlog rotates by date so lower-priority tasks cycle in and out instead of repeating.
  - No 'Notes', no separate 'Priorities', no separate 'Carried over' list.

Run:  python3 -m src.planner --dry-run [date] [carry-from]
"""

import os
import re
import sys
from datetime import date, timedelta

from src import fancy, obsidian, vault

DOGS = [
    "angel.png", "birthdaydog.jpg", "borzoidog.png", "jotchuaclown.jpg",
    "jotchualove.gif", "puppyfriends.png", "sillychuwawa.gif",
]

FOCUS_FILE = os.path.join(vault.VAULT, "Calendar", "Focus.md")

AREA_WORDS = (
    "work", "mental", "physical", "health", "enrichment", "creative", "mind",
    "wellbeing", "relationship", "money", "career", "admin", "learning",
)
HEALTH_WORDS = ("walk", "calisthenic", "gym", "workout", "exercise", "movement",
                "nutrition", "food tracker", "macro")

CAP_CARRIED = 4
CAP_BACKLOG = 2


def _strip_prefix(t):
    label, sep, rest = t.partition(":")
    if sep and rest.strip() and any(label.lower().strip().startswith(w) for w in AREA_WORDS):
        return rest.strip()
    return t.strip()


def _base(t):
    """Normalised form for de-duplication: no carried tag, no prefix, lowercased."""
    t = re.sub(r"\s*\(carried[^)]*\)", "", t)
    return " ".join(_strip_prefix(t).lower().split())


def _is_health(t):
    head = t.lower().split(":")[0]
    return "physical" in head or "health" in head or any(w in t.lower() for w in HEALTH_WORDS)


def _age(task):
    m = re.search(r"\s*\(carried (\d+)d[^)]*\)", task)
    base = task[: m.start()].strip() if m else task.strip()
    n = (int(m.group(1)) + 1) if m else 1
    flag = ", commit or kill?" if n >= 3 else ""
    return f"{base} (carried {n}d{flag})"


def _focus():
    return [ln.strip()[2:].strip()
            for ln in vault.read(FOCUS_FILE).splitlines() if ln.strip().startswith("- ")]


def _backlog(d, n, seen):
    """A rotating window of backlog items, so different ones surface each day."""
    items = []
    for ln in vault.read(obsidian.MASTER_TODO).splitlines():
        m = re.match(r"\s*-\s*(?:\[[ x]\]\s*)?(.+)", ln)
        if not m:
            continue
        t = _strip_prefix(m.group(1).strip().strip("*"))
        b = _base(t)
        if len(t) <= 6 or _is_health(t) or b in seen:
            continue
        seen.add(b)
        items.append(t)
    if not items:
        return []
    start = (d.toordinal() * n) % len(items)
    return [items[(start + i) % len(items)] for i in range(min(n, len(items)))]


def build(d=None, carry_from=None):
    d = d or date.today()
    carry_from = carry_from or (d - timedelta(days=1))

    focus = _focus()
    seen = {_base(f) for f in focus}

    carried = []
    for t in vault.unchecked_priorities(carry_from):
        if _is_health(t):
            continue
        b = _base(t)
        if b in seen:
            continue
        seen.add(b)
        carried.append(_age(_strip_prefix(t)))
    carried = carried[:CAP_CARRIED]

    todo = focus + carried + _backlog(d, CAP_BACKLOG, seen)

    checks = lambda items: "\n".join(f"- [ ] {i}" for i in items)
    parts = [
        f"![[{DOGS[d.weekday()]}|200]]",
        "",
        f"# {obsidian._daily_title(d)}",
        "",
        fancy.heading("To do today"),
        checks(todo) if todo else "- [ ] (set today's focus in Calendar/Focus.md)",
        "",
        fancy.heading("Health"),
        checks(vault.daily_health(d)),
        "",
        fancy.heading("Reminders"),
        f"  • {vault.random_reminder()}",
        "",
        fancy.heading("Reflections"),
        "",
    ]
    return "\n".join(parts)


def generate(d=None, carry_from=None, write=False):
    d = d or date.today()
    path = vault.daily_note_path(d)
    if write and os.path.exists(path):
        return path, None
    text = build(d, carry_from)
    if write:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    return path, text


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    d = date.fromisoformat(args[0]) if len(args) > 0 else None
    carry = date.fromisoformat(args[1]) if len(args) > 1 else None
    if "--dry-run" in sys.argv:
        print(build(d, carry))
    else:
        path, _ = generate(d, carry, write=True)
        print(f"wrote {os.path.basename(path)}")


if __name__ == "__main__":
    main()
