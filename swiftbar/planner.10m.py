#!/usr/bin/env python3
"""SwiftBar plugin: Esme's planner in the macOS menu bar (a la 'Usage for Claude').

Menu bar shows habits done today; the dropdown shows today's focus, goal progress,
and habit streaks, with links to the full dashboard and the vault. Self-contained
(stdlib only), reads the local vault files. Refreshes every 10 min (from the filename).

Install: put this file in your SwiftBar Plugins folder and `chmod +x` it.
"""

import json
import os
import re
from datetime import date, timedelta

VAULT = os.path.expanduser("~/Desktop/Esme's Brain")
MONO = "font=Menlo size=13"
GREEN = "color=#8fae87"
DIM = "color=#888888"


def read(p):
    try:
        with open(os.path.join(VAULT, p), encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


cfg = read("Goals & Direction/Goals & Habits.md")
try:
    log = json.loads(read("Daily/habits.json") or "{}")
except Exception:
    log = {}
focus = [l.strip()[2:].strip() for l in read("Daily/Focus.md").splitlines() if l.strip().startswith("- ")]


def section(name):
    out, grab = [], False
    for l in cfg.splitlines():
        if l.startswith("## "):
            grab = name.lower() in l.lower()
            continue
        if grab and l.strip().startswith("- "):
            out.append(l.strip()[2:].strip())
    return out


def streak(h):
    days = {d for d, hs in log.items() if h in hs}
    n, day = 0, date.today()
    while day.isoformat() in days:
        n += 1
        day -= timedelta(days=1)
    return n


def strip_links(t):
    return re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", re.sub(r"\[\[([^\]|]*)\]\]", r"\1", t))


habits = section("Daily habits")
done_today = [h for h in habits if h in log.get(date.today().isoformat(), [])]

# --- menu bar title ---
print(f"✿ {len(done_today)}/{len(habits) or '·'} | {MONO}")
print("---")
print(f"{date.today():%A %-d %B} | {MONO} {DIM}")

if focus:
    print(f"today's focus | {MONO}")
    for f in focus[:3]:
        print(f"-- {strip_links(f)} | {MONO}")

print(f"goals | {MONO}")
for g in section("Big goals"):
    m = re.match(r"(.+?):\s*([\d,]+)\s*/\s*([\d,]+)", g)
    if m:
        cur, tgt = int(m.group(2).replace(",", "")), int(m.group(3).replace(",", ""))
        pct = round(cur / tgt * 100) if tgt else 0
        f = round(pct / 100 * 10)
        bar = "█" * f + "░" * (10 - f)
        print(f"-- {m.group(1).strip()} | {MONO}")
        print(f"-- {bar}  {pct}% | {MONO} {GREEN}")

print(f"habits | {MONO}")
for h in habits:
    s = streak(h)
    mark = "●" if h in done_today else "○"
    tail = f"  🔥 {s}" if s else ""
    print(f"-- {mark} {h}{tail} | {MONO}")

print("---")
print("Open dashboard | href=https://esmerobinson.github.io/life-planner/")
print("Open vault in Obsidian | href=obsidian://open?vault=Esme%27s%20Brain")
