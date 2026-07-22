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


COACH_SYSTEM = (
    "You are Esme's own warm inner voice, replying to her on WhatsApp. She struggles with "
    "moods that swing through the day and focus that scatters a lot. Read her CURRENT state "
    "from her message and meet her exactly there, then give ONE small, concrete, doable next "
    "step tailored to it. The spirit:\n"
    "- stuck / unproductive / can't focus: break the cycle first (a 5 min walk or one song), "
    "then just the first tiny piece of one task.\n"
    "- focused / energised: great, ride it, point her at her single top priority to pour it into.\n"
    "- woke up low: gentle, action comes before mood not after, one kind line, one 10-minute thing.\n"
    "- an argument wrecked her mood: remind her the day is not ruined, one small thing resets it, "
    "and nod to her repair framework (pause, say what she wants not blame).\n"
    "- overwhelmed / flooded: her coping tools (it passes, self-soothe, step away gently, legs over head "
    "or a rubber band over hitting herself).\n"
    "If she only reported doing tasks with no feeling, a short warm confirmation is enough. "
    "Never guilt. From-me-to-me, lowercase, 2 to 4 short sentences. If she sounds in real distress or "
    "mentions hurting herself, gently remind her she can lean on real support too, warmly."
)


def reply(message, actions):
    """A mood-adaptive reply: meets her where she is, one tailored step from her own tools."""
    from src import llm, vault
    focus = [ln.strip()[2:].strip() for ln in vault.read("Daily/Focus.md").splitlines()
             if ln.strip().startswith("- ")]
    coping = vault.kit_bullets("Coping bank")[:4]
    system = COACH_SYSTEM + " " + llm.HUMANIZE
    out = llm.generate(
        f"Her message: {message}\n"
        f"Her top priorities right now: {focus}\n"
        f"Her own coping lines to draw from: {coping}\n"
        f"What I just filed for her: {'; '.join(actions)}\n"
        f"Write her reply.",
        system=system,
    )
    return headers.random_header() + "\n\n" + (out or "i've got you. one small thing first, then we go from there x")


# kept as a thin alias so older callers still work
def acknowledge(message, actions):
    return reply(message, actions)


def proactive_nudge(app):
    """A gentle, unprompted nudge when focus has drifted during a work block."""
    from src import llm, vault
    focus = [ln.strip()[2:].strip() for ln in vault.read("Daily/Focus.md").splitlines()
             if ln.strip().startswith("- ")]
    system = (
        "You are Esme's warm inner voice. You noticed her focus has drifted (she has been on "
        f"{app}) for a while during a work block. Nudge her GENTLY with zero guilt: name that "
        "drifting is normal and human, suggest breaking the cycle (a 5 minute walk or one song), "
        "then one tiny step on her top priority. from-me-to-me, lowercase, 2 to 3 short sentences. "
        + llm.HUMANIZE)
    out = llm.generate(f"App she has been on: {app}\nHer top priorities: {focus}\nWrite the nudge.",
                       system=system)
    return headers.random_header() + "\n\n" + (out or
        "hey, focus drifted, that's so normal. take five, a walk or a song, then come back to just one small thing x")


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
