"""Write side of the two-way loop: file a message into the right place in the
vault. Local file writes for now; Phase 3 swaps in the Google Drive API so it
works when the Mac is off. Every function is safe to dry-run (returns a
(path, preview) describing what it would do) before it writes.
"""

import os
import re
from datetime import date, datetime

from src import vault

JOURNAL_DIR = os.path.join(vault.VAULT, "Calendar", "Journal")
MASTER_TODO = os.path.join(vault.VAULT, "Master To-Do.md")


def _journal_path(d=None):
    d = d or date.today()
    return os.path.join(JOURNAL_DIR, f"Journal {vault._ordinal(d.day)} {d.strftime('%B')}.md")


def append_journal(text, d=None, dry_run=False):
    """Append a timestamped entry to today's Journal note, creating it if needed."""
    path = _journal_path(d)
    stamp = datetime.now().strftime("%H:%M")
    entry = f"\n**{stamp}** {text.strip()}\n"
    preview = f"append to Journal: {entry.strip()}"
    if not dry_run:
        header = "" if os.path.exists(path) else f"# Journal {vault._ordinal((d or date.today()).day)} {(d or date.today()).strftime('%B')}\n"
        with open(path, "a", encoding="utf-8") as f:
            f.write(header + entry)
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
