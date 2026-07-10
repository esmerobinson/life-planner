"""Write side of the two-way loop: file a message into the right place in the
vault. Local file writes for now; Phase 3 swaps in the Google Drive API so it
works when the Mac is off. Every function is safe to dry-run (returns a
(path, preview) describing what it would do) before it writes.
"""

import os
import re
from datetime import date, datetime

from src import vault

MASTER_TODO = os.path.join(vault.VAULT, "Master To-Do.md")


def _daily_title(d=None):
    d = d or date.today()
    return f"{d.strftime('%A')} {vault._ordinal(d.day)} {d.strftime('%B')}"


def _append_to_section(path, header, entry, title):
    """Append `entry` under `header` in the daily note, creating file/section as needed."""
    content = vault.read(path) or f"# {title}\n"
    if header in content:
        content = content.rstrip() + "\n" + entry + "\n"
    else:
        content = content.rstrip() + f"\n\n{header}\n" + entry + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def append_reflection(text, d=None, dry_run=False):
    """Add a timestamped reflection under the Daily Note's Reflections section."""
    path = vault.daily_note_path(d)
    entry = f"**{datetime.now().strftime('%H:%M')}** {text.strip()}"
    preview = f"add to Daily Note › Reflections: {entry}"
    if not dry_run:
        _append_to_section(path, vault.REFLECTIONS_HEADER, entry, _daily_title(d))
    return path, preview


def append_note(text, d=None, dry_run=False):
    """Add a work/to-do-related note under the Daily Note's Notes section."""
    path = vault.daily_note_path(d)
    entry = f"- {text.strip()}"
    preview = f"add to Daily Note › Notes: {entry}"
    if not dry_run:
        _append_to_section(path, "Notes:", entry, _daily_title(d))
    return path, preview


def add_to_master_todo(text, dry_run=False):
    """Append a captured idea under the '## Brain Dump' section of Master To-Do."""
    path = MASTER_TODO
    line = f"- {text.strip()}"
    preview = f"add to Master To-Do › Brain Dump: {line}"
    if not dry_run:
        content = vault.read(path).splitlines()
        out, inserted = [], False
        for i, ln in enumerate(content):
            out.append(ln)
            if ln.strip().startswith("## Brain Dump") and not inserted:
                out.append(line)
                inserted = True
        if not inserted:
            out += ["", "## Brain Dump", line]
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(out) + "\n")
    return path, preview


def tick_task(keywords, d=None, dry_run=False):
    """Check off the first unchecked task in today's daily note matching keywords."""
    path = vault.daily_note_path(d)
    text = vault.read(path)
    if not text:
        return path, "no daily note yet, nothing to tick"
    kws = [k.lower() for k in keywords.split() if len(k) > 3]
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        if re.match(r"\s*-\s*\[ \]", ln) and any(k in ln.lower() for k in kws):
            preview = f"tick off: {ln.strip()}"
            if not dry_run:
                lines[i] = ln.replace("[ ]", "[x]", 1)
                with open(path, "w", encoding="utf-8") as f:
                    f.write("\n".join(lines) + "\n")
            return path, preview
    return path, f"no matching task found for: {keywords}"


def set_intention(text, d=None, dry_run=False):
    """Record the morning intention into today's daily note."""
    path = vault.daily_note_path(d)
    preview = f"record intention in daily note: {text.strip()}"
    if not dry_run:
        existing = vault.read(path)
        block = f"\n## Intention\n{text.strip()}\n"
        with open(path, "a", encoding="utf-8") as f:
            f.write((existing and "" or f"# {os.path.basename(path)[:-3]}\n") + block)
    return path, preview
