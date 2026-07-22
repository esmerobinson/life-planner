"""Write side of the two-way loop: file a message into the right place in the
vault, through the storage layer (local files or Google Drive). Every function is
safe to dry-run (returns a (path, preview)) before it writes.
"""

import re
from datetime import date, datetime

from src import fancy, storage, vault

MASTER_TODO = "Goals & Direction/Master To-Do.md"


def log_habit(name, d=None, dry_run=False):
    """Record a completed daily habit (for dashboard streaks) in Daily/habits.json."""
    import json
    day = (d or date.today()).isoformat()
    preview = f"logged habit: {name}"
    if not dry_run:
        try:
            log = json.loads(vault.read("Daily/habits.json") or "{}")
        except Exception:
            log = {}
        log.setdefault(day, [])
        if name not in log[day]:
            log[day].append(name)
        storage.write("Daily/habits.json", json.dumps(log))
    return "Daily/habits.json", preview


def _daily_title(d=None):
    d = d or date.today()
    return f"{d.strftime('%A')} {vault._ordinal(d.day)} {d.strftime('%B')}"


def _append_to_section(path, search, create_header, entry, title):
    """Append `entry` under the section matching `search`; create it (with the
    decorated `create_header`) if the day's note has no such section yet."""
    content = vault.read(path) or f"# {title}\n"
    if search in content:
        content = content.rstrip() + "\n" + entry + "\n"
    else:
        content = content.rstrip() + f"\n\n{create_header}\n" + entry + "\n"
    storage.write(path, content)


def append_reflection(text, d=None, dry_run=False):
    """Add a timestamped reflection under the Daily Note's Reflections section."""
    path = vault.daily_note_path(d)
    entry = f"**{datetime.now().strftime('%H:%M')}** {text.strip()}"
    preview = f"add to Daily Note › Reflections: {entry}"
    if not dry_run:
        _append_to_section(path, vault.REFLECTIONS_HEADER, fancy.heading("Reflections"), entry, _daily_title(d))
    return path, preview


def append_note(text, d=None, dry_run=False):
    """Add a work/to-do-related note under the Daily Note's Notes section."""
    path = vault.daily_note_path(d)
    entry = f"- {text.strip()}"
    preview = f"add to Daily Note › Notes: {entry}"
    if not dry_run:
        _append_to_section(path, "𝐍𝐨𝐭𝐞𝐬", fancy.heading("Notes"), entry, _daily_title(d))
    return path, preview


def add_to_master_todo(text, dry_run=False):
    """Append a captured idea under the '## Brain Dump' section of Master To-Do."""
    line = f"- {text.strip()}"
    preview = f"add to Master To-Do › Brain Dump: {line}"
    if not dry_run:
        out, inserted = [], False
        for ln in vault.read(MASTER_TODO).splitlines():
            out.append(ln)
            if ln.strip().startswith("## Brain Dump") and not inserted:
                out.append(line)
                inserted = True
        if not inserted:
            out += ["", "## Brain Dump", line]
        storage.write(MASTER_TODO, "\n".join(out) + "\n")
    return MASTER_TODO, preview


def _flip_checkbox(keywords, mark, d, dry_run, verb):
    path = vault.daily_note_path(d)
    text = vault.read(path)
    if not text:
        return path, f"no daily note yet, nothing to {verb}"
    kws = [k.lower() for k in keywords.split() if len(k) > 3]
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        if re.match(r"\s*-\s*\[ \]", ln) and any(k in ln.lower() for k in kws):
            preview = f"{verb}: {ln.strip()}"
            if not dry_run:
                lines[i] = ln.replace("[ ]", mark, 1)
                storage.write(path, "\n".join(lines) + "\n")
            return path, preview
    return path, f"no matching task to {verb} for: {keywords}"


def tick_task(keywords, d=None, dry_run=False):
    """Check off the first unchecked task matching keywords."""
    return _flip_checkbox(keywords, "[x]", d, dry_run, "tick off")


def defer_task(keywords, d=None, dry_run=False):
    """Mark a matching task '- [>]' (not today): drops off tomorrow, cycles back later."""
    return _flip_checkbox(keywords, "[>]", d, dry_run, "defer")


def set_intention(text, d=None, dry_run=False):
    """Record the morning intention into today's daily note."""
    path = vault.daily_note_path(d)
    preview = f"record intention in daily note: {text.strip()}"
    if not dry_run:
        existing = vault.read(path)
        header = "" if existing else f"# {_daily_title(d)}\n"
        storage.write(path, existing.rstrip() + f"\n\n## Intention\n{text.strip()}\n" if existing
                      else header + f"\n## Intention\n{text.strip()}\n")
    return path, preview
