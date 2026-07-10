"""Decide what an incoming WhatsApp reply means and file it into the vault.

Heuristic for now (keyword rules); Phase 2b swaps in Gemini so it robustly reads
mixed messages like "ugh today was hard but I did the walk" (journal + tick).
`route()` returns a list of human-readable actions taken (or previewed).
"""

import re

from src import llm, obsidian

ROUTER_SYSTEM = (
    "You parse a WhatsApp reply Esme sent to her personal planner bot, and break it "
    "into actions to file in her notes. A single message can yield several actions. "
    "Always capture any reflective, emotional, or diary-like content as a journal action "
    "so nothing she says is ever lost. Never invent content. "
    "Output a JSON array of objects, each with a 'type' and its fields:\n"
    '  {"type":"journal","text":"..."}   a thought, feeling, or reflection (verbatim-ish)\n'
    '  {"type":"tick","task":"..."}       she reports finishing something (task = a few keywords)\n'
    '  {"type":"todo","text":"..."}       a new idea/task to remember\n'
    '  {"type":"intention","text":"..."}  her stated focus/intention for the day\n'
    '  {"type":"note","text":"..."}       a work/task-related note or progress update (not a new todo)\n'
    '  {"type":"mood","note":"..."}       a mood or energy check-in'
)


def smart_route(message, dry_run=False):
    """Gemini-parsed routing; returns action previews, or None to fall back."""
    actions = llm.generate_json(message, system=ROUTER_SYSTEM)
    if not isinstance(actions, list):
        return None
    done = []
    for a in actions:
        t = a.get("type")
        if t == "journal":
            done.append(obsidian.append_reflection(a.get("text", ""), dry_run=dry_run)[1])
        elif t == "tick":
            done.append(obsidian.tick_task(a.get("task", ""), dry_run=dry_run)[1])
        elif t == "todo":
            done.append(obsidian.add_to_master_todo(a.get("text", ""), dry_run=dry_run)[1])
        elif t == "intention":
            done.append(obsidian.set_intention(a.get("text", ""), dry_run=dry_run)[1])
        elif t == "note":
            done.append(obsidian.append_note(a.get("text", ""), dry_run=dry_run)[1])
        elif t == "mood":
            done.append(obsidian.append_reflection("mood: " + a.get("note", ""), dry_run=dry_run)[1])
    return done or None

DONE_RE = re.compile(r"\b(done|did|finished|completed|sent|posted|wrote)\b", re.I)
IDEA_RE = re.compile(r"\b(idea|remember to|note to self|todo|need to|should)\b", re.I)
INTENT_RE = re.compile(r"\b(my intention|intention is|today i (will|want)|i'm going to|focus on)\b", re.I)


def route(message, dry_run=False):
    smart = smart_route(message, dry_run=dry_run)
    if smart is not None:
        return smart

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

    # Anything reflective / emotional / unmatched → reflections (never lose a thought)
    if not actions or len(msg) > 120:
        path, preview = obsidian.append_reflection(msg, dry_run=dry_run)
        actions.append(preview)

    return actions
