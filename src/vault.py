"""Read helpers for the Obsidian vault (`~/Desktop/Esme's Brain`).

Later phases will edit the vault via the Google Drive API so it works when the Mac
is off; for local building and dry-runs we read the mounted files directly.
"""

import random
import re
from datetime import date

from src import storage

# Vault-relative paths (storage maps them to local files or Google Drive).
VAULT = storage.VAULT
DAILY_DIR = "Daily/Daily Notes"
KIT = "Mind & Wellbeing/Motivation & Manifestation Kit.md"
DAILY_REMINDERS = "Daily/Daily reminders.md"
JOURNAL_PROMPTS = "Daily/Journal Prompts.md"
DISCIPLINE = "Mind & Wellbeing/Discipline - Stoic Reminders.md"

# The section headers used inside a unified Daily Note (fancy unicode).
REFLECTIONS_HEADER = "𝐑𝐞𝐟𝐥𝐞𝐜𝐭𝐢𝐨𝐧𝐬"


def _ordinal(n):
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def daily_note_filename(d=None):
    """Date-prefixed so notes sort chronologically, e.g. '2026-07-09 Thursday 9th July.md'."""
    d = d or date.today()
    return f"{d.isoformat()} {d.strftime('%A')} {_ordinal(d.day)} {d.strftime('%B')}.md"


def daily_note_path(d=None):
    return f"{DAILY_DIR}/{daily_note_filename(d)}"


def read(relpath):
    return storage.read(relpath)


def unchecked_priorities(d=None):
    """All unchecked '- [ ] ...' task lines in the day's note. In the unified
    Daily Note, checkboxes only appear under To do / Health, so this cleanly
    returns the day's open tasks (and still works on the old '## Priorities' notes)."""
    text = read(daily_note_path(d))
    if not text:
        return []
    out = []
    for line in text.splitlines():
        m = re.match(r"\s*-\s*\[ \]\s*(.+)", line)
        if m:
            out.append(m.group(1).strip())
    return out


def bullets_under_heading(text, heading):
    """All '- ...' bullets that follow a '### heading' / '## heading' until the next heading."""
    lines = text.splitlines()
    out, in_section = [], False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#") and heading.lower() in stripped.lower():
            in_section = True
            continue
        if in_section and stripped.startswith("#"):
            break
        if in_section:
            m = re.match(r"\s*-\s*(.+)", line)
            if m:
                out.append(m.group(1).strip().strip("*"))
    return out


def random_reminder():
    """A random line from Daily reminders.md (the coping/relationship ones)."""
    text = read(DAILY_REMINDERS)
    items = [
        re.sub(r"^\d+\.\s*", "", ln).strip()
        for ln in text.splitlines()
        if re.match(r"\s*\d+\.", ln)
    ]
    return random.choice(items) if items else None


def random_discipline():
    """A random Stoic / discipline line from the Discipline bank."""
    items = [ln.strip()[2:].strip() for ln in read(DISCIPLINE).splitlines()
             if ln.strip().startswith("- ")]
    return random.choice(items) if items else None


_FUTURE_SELF = [
    "Who are you becoming? The version of you who is financially free, published, strong. What would she do with this hour?",
    "Pick someone already where you want to be. They started exactly here, with an ordinary day like this one.",
    "Study the people you admire. Their success was built from unremarkable days done well, over and over.",
    "The you of three years from now is watching this day. Make her proud, not perfect.",
]


def random_inspiration():
    """A line from her Inspiration notes, or a 'who you're becoming' future-self prompt."""
    items = []
    for note in ("Resources/Inspiration & motivation.md", "Resources/Inspiration - Creators & References.md"):
        items += [ln.strip()[2:].strip().strip("*") for ln in read(note).splitlines()
                  if ln.strip().startswith("- ") and len(ln.strip()) > 20]
    if items and random.random() < 0.6:
        return random.choice(items)
    return random.choice(_FUTURE_SELF)


def _clean(s):
    """Turn a raw Kit bullet into clean message text: prefer the quoted part,
    drop bold labels and the '→ action' tail, strip markdown emphasis."""
    s = s.strip()
    quoted = re.search(r'"([^"]+)"', s)
    if quoted:
        return quoted.group(1).strip()
    s = re.sub(r"^\*\*[^*]+:\*\*\s*", "", s)  # drop a leading **Label:** prefix
    s = s.split("→")[0]                          # drop the paired action
    s = s.replace("**", "").replace("*", "").strip().strip('"').strip()
    return s


def kit_bullets(heading):
    """Pull a section's bullets from the Motivation & Manifestation Kit, cleaned."""
    raw = bullets_under_heading(read(KIT), heading)
    cleaned = [_clean(b) for b in raw]
    return [c for c in cleaned if len(c) > 3]  # skip separators / stragglers


def random_why_it_matters():
    items = kit_bullets("why it matters")
    return random.choice(items) if items else None


def random_manifestation():
    """Her own manifestations first (Manifestations & Vision Board), plus the Kit set."""
    vb = bullets_under_heading(
        read("Mind & Wellbeing/Manifestations & Vision Board.md"), "My manifestations")
    items = [_clean(b) for b in vb if len(_clean(b)) > 10] + kit_bullets("Manifestation set")
    return random.choice(items) if items else None


def random_coping_line():
    items = kit_bullets("Coping bank")
    return random.choice(items) if items else None


def daily_health(d=None):
    """Every day: a movement item (30 min walk OR 1 hr calisthenics) plus the
    standing nutrition reminder. Seeded by the date so the planner and the morning
    message pick the same movement for a given day."""
    d = d or date.today()
    rng = random.Random(d.toordinal())
    movement = rng.choice(["A 30 minute walk", "1 hour of calisthenics"])
    nutrition = "Fill your body with healthy, nutritious food today, and don't overeat"
    return [movement, nutrition]


def prompts(section):
    """Journal prompts from the shared bank, under 'Morning' or 'Reflection'."""
    return bullets_under_heading(read(JOURNAL_PROMPTS), section)


def select_prompts(section, n):
    """Pick up to n prompts. Any marked '(MUST INCLUDE)' are always kept (marker
    stripped); the rest fill the remaining slots at random."""
    raw = prompts(section)
    clean = lambda s: re.sub(r"\s*\(MUST INCLUDE\)\s*", "", s).strip()
    must = [clean(p) for p in raw if "MUST INCLUDE" in p.upper()]
    rest = [clean(p) for p in raw if "MUST INCLUDE" not in p.upper()]
    random.shuffle(rest)
    return must + rest[: max(0, n - len(must))]
