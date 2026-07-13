"""Generate the daily note. Four sections only, kept short and calm:

    ˚₊✩ To do today ✩₊˚   focus (pinned) + a few carried + a rotating couple from the backlog
    ✿ Health ✿           movement + nutrition (from vault.daily_health)
    ♡ Reminders ♡        one line
    ☾ Reflections ☽      wellbeing/mental prompts + space for her own writing

Rules that keep it clean:
  - Focus lives in Calendar/Focus.md and is pinned first every day.
  - ONE task per line: compound items ("A; B; C") are split apart.
  - Health/movement items live only under Health; mental/wellbeing items go to Reflections,
    not To do.
  - De-duplication is semantic (via Gemini), so "two chapters of the Jeff biography" and
    "1-2 rough draft chapters of the Jeff biography" collapse to one.
  - The backlog rotates by date so lower-priority tasks cycle in and out.

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
MIND_WORDS = ("self-compassion", "self compassion", "anger pause", "self soothe",
              "self-soothe", "kind to myself", "gratitude", "meditat", "dbt workbook",
              "self-hate", "self hate", "how i deal with negative", "rotating practice")

CAP_CARRIED = 4
CAP_BACKLOG = 2


def _strip_prefix(t):
    label, sep, rest = t.partition(":")
    if sep and rest.strip() and any(label.lower().strip().startswith(w) for w in AREA_WORDS):
        return rest.strip()
    return t.strip()


def _base(t):
    t = re.sub(r"\s*\(carried[^)]*\)", "", t)
    return " ".join(_strip_prefix(t).lower().split())


def _classify(t):
    low = t.lower()
    head = low.split(":")[0]
    if "physical" in head or "health" in head or any(w in low for w in HEALTH_WORDS):
        return "health"
    if any(w in low for w in MIND_WORDS):
        return "mind"
    return "todo"


def _explode(raw):
    """One task per line: drop the carried tag + area prefix, split compound ';' items."""
    txt = re.sub(r"\s*\(carried[^)]*\)", "", _strip_prefix(raw)).strip()
    return [p.strip().rstrip(".") for p in re.split(r"\s*;\s*", txt) if len(p.strip()) > 3]


def _carry_n(raw):
    m = re.search(r"\(carried (\d+)d", raw)
    return int(m.group(1)) if m else 0


def _age(sub, raw):
    n = _carry_n(raw) + 1
    flag = ", commit or kill?" if n >= 3 else ""
    return f"{sub} (carried {n}d{flag})"


def _focus():
    return [ln.strip()[2:].strip()
            for ln in vault.read(FOCUS_FILE).splitlines() if ln.strip().startswith("- ")]


def _backlog_raw(d, n, seen):
    items = []
    for ln in vault.read(obsidian.MASTER_TODO).splitlines():
        m = re.match(r"\s*-\s*(?:\[[ x]\]\s*)?(.+)", ln)
        if not m:
            continue
        raw = m.group(1).strip().strip("*")
        if _base(raw) in seen or len(raw) <= 6:
            continue
        items.append(raw)
    if not items:
        return []
    start = (d.toordinal() * n) % len(items)
    return [items[(start + i) % len(items)] for i in range(min(n * 3, len(items)))]


_STOP = {"the", "a", "an", "of", "to", "and", "or", "for", "in", "on", "my", "is", "it",
         "two", "one", "some", "do", "get", "out", "up", "with", "into", "not", "plan"}


def _keywords(t):
    t = re.sub(r"\(carried[^)]*\)", "", t.lower())
    return {w for w in re.findall(r"[a-z]+", t) if len(w) > 2 and w not in _STOP}


def _dedupe(items, threshold=0.55):
    """Deterministic de-dup by keyword overlap, so differently-worded versions of the
    same task ('two chapters of the biography' vs '1-2 rough draft chapters of the
    biography') collapse to the first one. Reliable and fast, no LLM."""
    kept, kept_kw = [], []
    for it in items:
        kw = _keywords(it)
        if any(kw and k and len(kw & k) / len(kw | k) >= threshold for k in kept_kw):
            continue
        kept.append(it)
        kept_kw.append(kw)
    return kept


def build(d=None, carry_from=None):
    d = d or date.today()
    carry_from = carry_from or (d - timedelta(days=1))

    focus = _focus()
    seen = {_base(f) for f in focus}
    todo, mind = list(focus), []

    def take(raw, aged):
        for sub in _explode(raw):
            b = _base(sub)
            if b in seen:
                continue
            seen.add(b)
            cls = _classify(sub)
            if cls == "health":
                continue
            if cls == "mind":
                mind.append(sub)
            else:
                todo.append(_age(sub, raw) if aged else sub)

    carried_before = len(todo)
    for raw in vault.unchecked_priorities(carry_from):
        if len(todo) - carried_before >= CAP_CARRIED:
            break
        take(raw, aged=True)

    backlog_before = len(todo)
    for raw in _backlog_raw(d, CAP_BACKLOG, seen):
        if len(todo) - backlog_before >= CAP_BACKLOG:
            break
        take(raw, aged=False)

    todo = _dedupe(todo)

    checks = lambda items: "\n".join(f"- [ ] {i}" for i in items)
    refl = "\n".join(f"- {m}" for m in mind[:2])
    parts = [
        f"![[{DOGS[d.weekday()]}|200]]",
        "",
        f"# {obsidian._daily_title(d)}",
        "",
        f"*{vault.random_manifestation() or 'I am building the life I want, one honest day at a time.'}*",
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
        refl,
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
