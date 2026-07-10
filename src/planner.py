"""Phase 3: generate the full Daily Note each morning.

Pulls the day's plan from the vault (never Google Tasks, which feeds the longer-term
backlog instead): yesterday's unchecked tasks carry over (and age toward commit-or-kill),
the daily spine (write + content) is always there, and a few backlog items from Master
To-Do round it out. Every task is its own checkbox line so it's tickable by her or the bot.

Structure written (her spec):
    # Weekday Nth Month
    𝐓𝐨 𝐝𝐨 𝐭𝐨𝐝𝐚𝐲   (checkbox line items)
    Notes:
    𝐇𝐞𝐚𝐥𝐭𝐡
    𝐑𝐞𝐦𝐢𝐧𝐝𝐞𝐫𝐬
    𝐑𝐞𝐟𝐥𝐞𝐜𝐭𝐢𝐨𝐧𝐬

Run:
    python3 -m src.planner --dry-run           # today, print only
    python3 -m src.planner --dry-run 2026-07-11 2026-07-09   # date + carry-from
"""

import os
import re
import random
import sys
from datetime import date, datetime, timedelta

from src import compose, fancy, obsidian, vault

SPINE = [
    "Write something today, even 15 rough minutes",
    "Touch content today: post, edit, or capture one thing",
]

# one funny dog per weekday (Monday=0 .. Sunday=6), embedded small at the top
DOGS = [
    "angel.png", "birthdaydog.jpg", "borzoidog.png", "jotchuaclown.jpg",
    "jotchualove.gif", "puppyfriends.png", "sillychuwawa.gif",
]


def _age(task):
    """Bump a carry counter and flag commit-or-kill after 3 days. No em dashes."""
    m = re.search(r"\s*\(carried (\d+)d[^)]*\)", task)
    if m:
        n = int(m.group(1)) + 1
        base = task[: m.start()].strip()
        flag = ", commit or kill?" if n >= 3 else ""
        return f"{base} (carried {n}d{flag})"
    return f"{task} (carried 1d)"


def _backlog(n, exclude):
    text = vault.read(obsidian.MASTER_TODO)
    items = []
    for ln in text.splitlines():
        m = re.match(r"\s*-\s*(?:\[[ x]\]\s*)?(.+)", ln)
        if m:
            t = m.group(1).strip().strip("*")
            if t and len(t) > 6 and not t.startswith("#") and t not in exclude:
                items.append(t)
    random.shuffle(items)
    return items[:n]


def build(d=None, carry_from=None):
    d = d or date.today()
    carry_from = carry_from or (d - timedelta(days=1))
    carried = vault.unchecked_priorities(carry_from)
    todo = [_age(t) for t in carried] + SPINE + _backlog(2, exclude=set(carried))
    health = vault.daily_health(d)
    reminder = vault.random_reminder()

    checks = lambda items: "\n".join(f"- [ ] {i}" for i in items)
    dog = DOGS[d.weekday()]
    parts = [
        f"![[{dog}|200]]",
        "",
        f"# {obsidian._daily_title(d)}",
        "",
        fancy.heading("To do today"),
        checks(todo),
        "",
        fancy.heading("Notes"),
        "",
        fancy.heading("Health"),
        checks(health),
        "",
        fancy.heading("Reminders"),
        f"  • {reminder}" if reminder else "",
        "",
        fancy.heading("Reflections"),
        "",
    ]
    return "\n".join(parts)


def generate(d=None, carry_from=None, write=False):
    d = d or date.today()
    path = vault.daily_note_path(d)
    if write and os.path.exists(path):
        return path, None  # never clobber a day that already has content
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
