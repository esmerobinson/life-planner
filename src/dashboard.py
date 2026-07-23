"""Generate Esme's visual daily dashboard as one HTML page.

Reads from the vault:
  - Goals & Direction/Goals & Habits.md   her goals, weekly targets, daily habits
  - Daily/habits.json                      the habit log the tool keeps (for streaks)

Aesthetic: musicforprogramming.net, dark, monospace, muted olive + soft green, calm,
nothing wasted. Hosted on GitHub Pages so she can open it on her phone each day.
"""

import json
import re
from datetime import date, timedelta

from src import vault

HABIT_LOG = "Daily/habits.json"
CONFIG = "Goals & Direction/Goals & Habits.md"


def _section(text, name):
    out, grab = [], False
    for ln in text.splitlines():
        if ln.startswith("## "):
            grab = name.lower() in ln.lower()
            continue
        if grab and ln.strip().startswith("- "):
            out.append(ln.strip()[2:].strip())
    return out


def _streak(log, habit):
    days = {d for d, hs in log.items() if habit in hs}
    n, day = 0, date.today()
    while day.isoformat() in days:
        n += 1
        day -= timedelta(days=1)
    return n


def _week_count(log, keyword):
    monday = date.today() - timedelta(days=date.today().weekday())
    return sum(1 for d, hs in log.items()
               if date.fromisoformat(d) >= monday and any(keyword.lower() in h.lower() for h in hs))


def _bar(pct, width=24):
    f = round(min(1, pct) * width)
    return "█" * f, "░" * (width - f)


def build_html():
    cfg = vault.read(CONFIG)
    try:
        log = json.loads(vault.read(HABIT_LOG) or "{}")
    except Exception:
        log = {}

    goals = []
    for g in _section(cfg, "Big goals"):
        m = re.match(r"(.+?):\s*([\d,]+)\s*/\s*([\d,]+)", g)
        if not m:
            continue
        cur, tgt = int(m.group(2).replace(",", "")), int(m.group(3).replace(",", ""))
        pct = cur / tgt if tgt else 0
        fill, empty = _bar(pct)
        goals.append(
            f'<div class="row"><div class="lbl">{m.group(1).strip()} '
            f'<span class="dim">{cur:,} / {tgt:,}</span></div>'
            f'<span class="fill">{fill}</span><span class="empty">{empty}</span>'
            f'<span class="dim"> {round(pct*100)}%</span></div>')

    weekly = []
    for w in _section(cfg, "This week"):
        km = re.search(r"[A-Za-z]+", w)
        target = re.search(r"(\d+)", w)
        tgt = int(target.group(1)) if target else 1
        done = _week_count(log, km.group(0)) if km else 0
        check = "▪" * min(done, tgt) + "▫" * max(0, tgt - done)
        weekly.append(f'<div class="line"><span class="on">{check}</span>  {w}</div>')

    habits = []
    for h in _section(cfg, "Daily habits"):
        s = _streak(log, h)
        did = h in log.get(date.today().isoformat(), [])
        mark = "●" if did else "○"
        streak = f'<span class="on">{s} day{"s" if s != 1 else ""}</span>' if s else '<span class="dim">no streak yet</span>'
        habits.append(f'<div class="line"><span class="{ "on" if did else "dim" }">{mark}</span>  {h}'
                      f'   <span class="dim">·</span>   {streak}</div>')

    try:
        stars = json.loads(vault.read("Daily/stars.json") or "{}")
    except Exception:
        stars = {}
    monday = date.today() - timedelta(days=date.today().weekday())
    week_stars = sum(n for ds, n in stars.items() if date.fromisoformat(ds) >= monday)
    today_stars = stars.get(date.today().isoformat(), 0)
    star_row = (f'<div class="line"><span class="on">{"★" * min(today_stars, 12) or "·"}</span>'
                f'  today <span class="dim">·</span> {week_stars} this week</div>')

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>esme's day</title><style>
:root{{--bg:#1b1b1b;--fg:#9a9a82;--dim:#65655a;--bright:#c9c9ad;--on:#8fae87}}
*{{box-sizing:border-box}}
body{{background:var(--bg);color:var(--fg);font:14px/1.75 ui-monospace,Menlo,"Courier New",monospace;
margin:0;padding:38px 22px;max-width:600px;margin-inline:auto}}
h1{{color:var(--bright);font-weight:400;font-size:15px;margin:0}}
.sub{{color:var(--dim);margin:4px 0 30px}}
h2{{color:var(--dim);font-weight:400;font-size:13px;margin:30px 0 12px;letter-spacing:.5px}}
.row{{margin:11px 0}} .lbl{{color:var(--fg)}} .dim{{color:var(--dim)}} .on{{color:var(--on)}}
.fill{{color:var(--on)}} .empty{{color:#333}} .line{{margin:8px 0}}
.foot{{margin-top:34px;color:var(--dim);font-size:11px;border-top:1px solid #2a2a2a;padding-top:12px}}
a{{color:#7ea2b0;text-decoration:none}}
</style></head><body>
<h1>{date.today():%A %-d %B}</h1>
<p class="sub">// who are you becoming? one honest day at a time.</p>

<h2>// goals</h2>
{''.join(goals) or '<p class="dim">add goals in Goals &amp; Habits.md</p>'}

<h2>// this week</h2>
{''.join(weekly) or '<p class="dim">add weekly targets</p>'}

<h2>// star chart</h2>
{star_row}

<h2>// daily habits</h2>
{''.join(habits) or '<p class="dim">add daily habits</p>'}

<p class="foot">updated {date.today():%d %b %Y} · edit goals in Goals &amp; Habits.md · streaks grow from what you tick and text</p>
</body></html>"""
