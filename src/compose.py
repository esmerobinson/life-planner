"""Compose the daily messages in Esme's template.

Layout (from her spec):
    [random cute header]

    𝑮𝒐𝒐𝒅 𝒎𝒐𝒓𝒏𝒊𝒏𝒈 <3
    𝑖𝑡𝑎𝑙𝑖𝑐 manifestation / motivation line
    𝐓𝐨 𝐝𝐨 𝐭𝐨𝐝𝐚𝐲  (generated from the vault / goals)
    𝐇𝐞𝐚𝐥𝐭𝐡
    𝐑𝐞𝐦𝐢𝐧𝐝𝐞𝐫𝐬  (one random line from Daily reminders)
    𝐐𝐮𝐞𝐬𝐭𝐢𝐨𝐧𝐬 𝐟𝐨𝐫 𝐲𝐨𝐮:  (morning = intention; midday = emotional + task check-in;
                              evening = how it went, was it hard, tomorrow)

Section headers use fancy unicode so they render styled in WhatsApp.
Task punchiness is basic here (prefix-stripping); Gemini polish comes in Phase 1b.

Run:
    python3 -m src.compose morning --dry-run
"""

import re
import sys

from src import fancy, headers, vault


def _plain(t):
    """Strip Obsidian wikilinks for WhatsApp, which shows them as raw [[..]] text."""
    t = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", t)  # [[Hub|alias]] -> alias
    return re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)         # [[Note]] -> Note

SLOTS = ("morning", "midday", "evening")

# leading "Area:" labels we recognise, so we can strip them and route Health out
AREA_WORDS = (
    "work", "mental", "physical", "health", "enrichment", "creative", "mind",
    "wellbeing", "relationship", "money", "career", "admin", "learning",
)


def _split_task(p):
    """Return (area_label_or_'', clean_text). Only strips a recognised area prefix."""
    label, sep, rest = p.partition(":")
    low = label.lower().strip()
    if sep and rest.strip() and any(low.startswith(w) for w in AREA_WORDS):
        return low, rest.strip()
    return "", p.strip()


def _categorize(priorities):
    todo, health = [], []
    for p in priorities:
        label, text = _split_task(p)
        if any(w in label for w in ("physical", "health")):
            health.append(text)
        else:
            todo.append(text)
    return todo, health


def _bullets(items, indent=""):
    return "\n".join(f"{indent}• {i}" for i in items)


def _questions(items):
    return fancy.heading("Questions for you:") + "\n" + _bullets(items, "    ")


def morning(d=None):
    todo, health = _categorize(vault.unchecked_priorities(d))
    mani = vault.random_manifestation() or "I am building the life I want, one honest day at a time."
    reminder = vault.random_reminder()

    parts = [fancy.bold_italic("Good morning") + " <3", "", fancy.italic(mani), ""]
    parts += [fancy.heading("To do today")]
    parts += [_bullets([_plain(t) for t in todo[:5]]) if todo else "• (let's set today's few, reply with what matters)"]
    parts += ["", fancy.heading("Health"), _bullets(vault.daily_health(d), "  ")]
    if reminder:
        parts += ["", fancy.heading("Reminders"), "  • " + reminder]
    qs = vault.select_prompts("Morning", 3) or [
        "What task do you want to start with today?",
        "Is anything missing from the to do list?",
        "What is your intention for today?",
    ]
    parts += ["", _questions(qs)]
    return "\n".join(parts)


def midday(d=None):
    todo, _ = _categorize(vault.unchecked_priorities(d))
    coping = vault.random_coping_line()

    parts = [fancy.bold_italic("Afternoon check in"), "",
             fancy.italic("just checking in. how's it going so far?"), ""]
    parts += [fancy.heading("Still on today")]
    parts += [_bullets([_plain(t) for t in todo[:5]]) if todo else "• whatever you can move, counts"]
    if coping:
        parts += ["", fancy.heading("Reminders"), "  • " + coping]
    parts += ["", _questions([
        "How are you feeling this afternoon?",
        "How is it going with today's tasks?",
        "What is one thing you can move before this evening?",
    ])]
    return "\n".join(parts)


def evening(d=None):
    mani = vault.random_manifestation() or "I am proud of myself for showing up today."
    qs = vault.select_prompts("Reflection", 4) or [
        "How did today go? what did you get done, however small?",
        "Was any of it difficult? how are you feeling tonight?",
        "One thing that went well, or that you appreciated?",
        "What do you want to get done tomorrow?",
    ]
    parts = [fancy.bold_italic("Good evening"), "",
             fancy.italic("winding down. no scorekeeping tonight."), ""]
    parts += [_questions(qs)]
    parts += ["", fancy.italic(mani)]
    return "\n".join(parts)


def render(slot, d=None):
    body = {"morning": morning, "midday": midday, "evening": evening}[slot](d)
    return headers.random_header() + "\n\n" + body


def acknowledge(message, actions):
    """A short, human reply after her message is processed."""
    from src import llm
    system = (
        "You are Esme replying to herself on WhatsApp after her note got filed. "
        "One or two short lowercase sentences. Say plainly what you saved and, if it "
        "fits, one warm real line. Not a coach. " + llm.HUMANIZE
    )
    reply = llm.generate(
        f"Her message: {message}\nWhat got saved: {'; '.join(actions)}\nWrite the reply.",
        system=system,
    )
    if not reply:
        reply = "saved. that's in your notes now x"
    return headers.random_header() + "\n\n" + reply


def nudge():
    """The 'annoying' follow-up if she hasn't replied. Sent by the scheduler
    when Phase 2 reply-detection sees no answer within the wait window."""
    return headers.random_header() + "\n\n" + fancy.italic(
        "text me back if you want to make some progress on your life today xox"
    )


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    slot = args[0] if args else "morning"
    if slot not in SLOTS:
        sys.exit(f"slot must be one of {SLOTS}")
    msg = render(slot)
    if "--dry-run" in sys.argv:
        print(f"===== {slot} =====\n{msg}")
    else:
        import os
        from src import whatsapp
        whatsapp.send_text(os.environ["MY_NUMBER"], msg)
        print(f"sent {slot} message")


if __name__ == "__main__":
    main()
