"""Decide what an incoming WhatsApp reply means and file it into the vault.

Heuristic for now (keyword rules); Phase 2b swaps in Gemini so it robustly reads
mixed messages like "ugh today was hard but I did the walk" (journal + tick).
`route()` returns a list of human-readable actions taken (or previewed).
"""

import re

from src import obsidian

DONE_RE = re.compile(r"\b(done|did|finished|completed|sent|posted|wrote)\b", re.I)
IDEA_RE = re.compile(r"\b(idea|remember to|note to self|todo|need to|should)\b", re.I)
INTENT_RE = re.compile(r"\b(my intention|intention is|today i (will|want)|i'm going to|focus on)\b", re.I)


def route(message, dry_run=False):
    msg = message.strip()
    actions = []

    if INTENT_RE.search(msg):
        path, preview = obsidian.set_intention(msg, dry_run=dry_run)
        actions.append(preview)

    if DONE_RE.search(msg):
        path, preview = obsidian.tick_task(msg, dry_run=dry_run)
        actions.append(preview)

    if IDEA_RE.search(msg):
        path, preview = obsidian.add_to_master_todo(msg, dry_run=dry_run)
        actions.append(preview)

    # Anything reflective / emotional / unmatched → journal it (never lose a thought)
    if not actions or len(msg) > 120:
        path, preview = obsidian.append_journal(msg, dry_run=dry_run)
        actions.append(preview)

    return actions
