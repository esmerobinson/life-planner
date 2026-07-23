"""Weekly + monthly reviews, generated in the cloud.

    python scripts/review.py weekly    # Sunday evenings: honest week review + next week's priorities
    python scripts/review.py monthly   # 1st of month: month check-in against Goals
    python scripts/review.py auto      # picks weekly on Sundays, monthly on the 1st, else exits

Reads the week's daily notes + Goals + habit log, writes the review into the vault,
and sends a short WhatsApp summary. Voice rules: hers, honest, never guilt.
"""

import json
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

from src import compose, fancy, headers, llm, storage, vault, whatsapp

VOICE = (
    "Write as Esme's own warm, honest inner voice, from-me-to-me, never guilt. Be truthful "
    "about what moved and what stalled, name stalls plainly as information, not failure. "
    "Celebrate real wins including invisible ones. " + llm.HUMANIZE
)


def _week_notes(d):
    out = []
    for i in range(7, 0, -1):
        day = d - timedelta(days=i)
        txt = vault.read(vault.daily_note_path(day))
        if txt:
            out.append(f"--- {day:%A %d %b} ---\n{txt[:2500]}")
    return "\n".join(out)


def weekly(d=None):
    d = d or date.today()
    goals = vault.read("Goals & Direction/Goals.md")
    habits = vault.read("Daily/habits.json") or "{}"
    inbox = [l for l in vault.read("Goals & Direction/Backlog.md").split("## ")[1:]
             if l.startswith("Inbox")]
    body = llm.generate(
        f"Esme's goals:\n{goals[:2500]}\n\nHer last 7 daily notes:\n{_week_notes(d)[:9000]}\n\n"
        f"Habit log (dates -> habits done): {habits[:800]}\n"
        f"Backlog inbox awaiting triage:\n{inbox[0][:600] if inbox else '(empty)'}\n\n"
        "Write her weekly review note in markdown with EXACTLY these sections:\n"
        "## Week in review (what genuinely moved, incl. invisible wins; what stalled, named plainly)\n"
        "## Rhythm check (how the weekly cadence went: reels, carousels, book sessions, art, "
        "calisthenics, vs her targets)\n"
        "## Top 3 for next week (specific, doable)\n"
        "## Commit or kill (anything carried 2+ weeks: ask for a real decision)\n"
        "## One honest line (kind, true, short)\n"
        "Keep the whole thing under 450 words. No em dashes.",
        system=VOICE,
    )
    if not body:
        print("Gemini unavailable, skipping")
        return
    note = f"# Weekly Priorities - week of {d + timedelta(days=1):%-d %B %Y}\n\n*Generated {d:%A %-d %B}. Edit freely, this is a draft, not a verdict.*\n\n{body}\n"
    storage.write("Goals & Direction/Weekly Priorities.md", note)
    top3 = body.split("## Top 3", 1)[-1].split("##")[0].strip() if "## Top 3" in body else ""
    msg = (headers.random_header() + "\n\n" + fancy.bold_italic("Weekly review is in") + "\n\n"
           + "your week, looked at honestly, is in Weekly Priorities in the vault.\n\n"
           + (fancy.bold("Top 3 for next week") + "\n" + top3 + "\n\n" if top3 else "")
           + "read it tonight or with tomorrow's coffee x")
    whatsapp.send_text(os.environ["MY_NUMBER"], msg)
    print("weekly review written + sent")


def monthly(d=None):
    d = d or date.today()
    goals = vault.read("Goals & Direction/Goals.md")
    gh = vault.read("Goals & Direction/Goals & Habits.md")
    prev = vault.read("Goals & Direction/Goals for month.md")
    body = llm.generate(
        f"Esme's goals:\n{goals[:2500]}\n\nDashboard numbers:\n{gh[:800]}\n\n"
        f"Last month's note (for continuity):\n{prev[:2000]}\n\n"
        f"Recent daily notes:\n{_week_notes(d)[:6000]}\n\n"
        f"Write her month check-in for {d:%B %Y} in markdown: ## Last month in one line / "
        "## This month's goals (3-5, each tied to a yearly goal, with a mid-month checkpoint) / "
        "## Watch out for (patterns from her notes) / ## One honest line. Under 400 words. No em dashes.",
        system=VOICE,
    )
    if not body:
        print("Gemini unavailable, skipping")
        return
    storage.write("Goals & Direction/Goals for month.md",
                  f"# Goals for {d:%B %Y}\n\n*Generated {d:%-d %B}. Adjust anything that doesn't fit.*\n\n{body}\n")
    whatsapp.send_text(os.environ["MY_NUMBER"], headers.random_header() + "\n\n"
                       + fancy.bold_italic("New month, fresh page") + "\n\n"
                       + "your month check-in is ready in Goals for month. read it when you're settled x")
    print("monthly review written + sent")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "auto"
    today = date.today()
    if mode == "weekly" or (mode == "auto" and today.weekday() == 6):
        weekly(today)
    if mode == "monthly" or (mode == "auto" and today.day == 1):
        monthly(today)
    if mode == "auto" and today.weekday() != 6 and today.day != 1:
        print("not a review day")
