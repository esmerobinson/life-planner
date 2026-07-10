"""Compose the daily messages — three slots, each with its own job.

    morning (08:30)  set the intention: today's 3-4, a manifestation, a reminder, a why-it-matters
    midday  (13:00)  light nudge: how's it going, one thing to move this afternoon, a coping/practice line
    evening (17:00)  reflect: priorities moved? one win? energy? one appreciation? anything to park?

Right now this assembles the message from the vault + the Kit deterministically, so it's
testable with `--dry-run` before any API keys exist. Phase 1b wires Gemini in as a final pass
to smooth it into Esme's own from-me-to-me voice (never guilt). The source material stays the
same either way — Gemini only rephrases, it doesn't invent tasks.

Run:
    python3 -m src.compose morning --dry-run
    python3 -m src.compose midday  --dry-run
    python3 -m src.compose evening --dry-run
"""

import sys

from src import vault

SLOTS = ("morning", "midday", "evening")


def _priorities_block():
    items = vault.unchecked_priorities()
    if not items:
        return "- (no priorities set yet — what are the 3-4 that matter today?)"
    return "\n".join(f"- {p}" for p in items[:4])  # 3-4 max, never the full list


def morning():
    lines = [
        "morning, Esme — it's you, from you.",
        "",
        "today's few (just these — not the whole list):",
        _priorities_block(),
    ]
    mani = vault.random_manifestation()
    if mani:
        lines += ["", f"remember: {mani}"]
    why = vault.random_why_it_matters()
    if why:
        lines += ["", why]
    rem = vault.random_reminder()
    if rem:
        lines += ["", f"and one to hold today: {rem}"]
    lines += ["", "reply with your intention for the day — I'll hold you to it (gently) x"]
    return "\n".join(lines)


def midday():
    items = vault.unchecked_priorities()
    focus = items[0] if items else "the one that matters most"
    lines = [
        "midday check-in — no pressure, just a look up.",
        "",
        f"how's it going? if the morning got away from you, that's ok.",
        f"what's *one* thing you can move this afternoon? (even the 10-min version of: {focus})",
    ]
    coping = vault.random_coping_line()
    if coping:
        lines += ["", coping]
    lines += ["", "tell me what you'll do next and I'll check back x"]
    return "\n".join(lines)


def evening():
    lines = [
        "evening, love. let's close the day kindly.",
        "",
        "- did you move any of your priorities? what got done? (however small counts)",
        "- one thing that went well today:",
        "- energy & mood, 1-5, and why:",
        "- one thing you appreciated — in yourself or someone else:",
        "- anything bothering you? can you park it, or let it go?",
        "",
        "reply however you like — I'll write it into your journal and carry what's left to tomorrow x",
    ]
    return "\n".join(lines)


def render(slot):
    return {"morning": morning, "midday": midday, "evening": evening}[slot]()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    slot = args[0] if args else "morning"
    if slot not in SLOTS:
        sys.exit(f"slot must be one of {SLOTS}")
    msg = render(slot)
    if "--dry-run" in sys.argv:
        print(f"===== {slot} =====\n{msg}")
    else:
        # Phase 1: actually send via WhatsApp once pipes are live.
        import os
        from src import whatsapp
        whatsapp.send_text(os.environ["MY_NUMBER"], msg)
        print(f"sent {slot} message")


if __name__ == "__main__":
    main()
