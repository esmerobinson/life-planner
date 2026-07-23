"""Nightly day-review (~21:30): reads today's note INCLUDING everything Esme replied
during the day (her reflections, ticks, moods), writes a short honest 'Day in review'
into the note, and sends it as a goodnight message. Her responses are the input, this
is the reflect-back half of the loop.
"""

import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

from src import fancy, headers, llm, storage, vault, whatsapp


def main():
    d = date.today()
    note = vault.read(vault.daily_note_path(d))
    if not note:
        return print("no note today")
    if "𝐃𝐚𝐲 𝐢𝐧 𝐫𝐞𝐯𝐢𝐞𝐰" in note:
        return print("already reviewed today")
    ticked = [l for l in note.splitlines() if l.strip().startswith("- [x]")]
    body = llm.generate(
        f"Esme's daily note for {d:%A %d %B}, including her own reflections and replies:\n\n"
        f"{note[:5000]}\n\nTicked today: {len(ticked)}\n\n"
        "Write a short 'day in review' (4-6 lines, lowercase, from-me-to-me): what actually "
        "happened today, drawing on HER OWN words from the reflections; one thing worth being "
        "proud of (invisible wins count); anything she flagged as hard, acknowledged kindly; "
        "one small seed for tomorrow. If she wrote nothing today, gently note the day passed "
        "quietly and that's okay. Never guilt. No em dashes.",
        system="You are Esme's own warm, honest inner voice closing out her day. " + llm.HUMANIZE,
    )
    if not body:
        return print("Gemini unavailable")
    storage.write(vault.daily_note_path(d),
                  note.rstrip() + "\n\n" + fancy.heading("Day in review") + "\n" + body + "\n")
    whatsapp.send_text(os.environ["MY_NUMBER"],
                       headers.random_header() + "\n\n" + fancy.bold_italic("Day in review") + "\n\n"
                       + body + "\n\ngoodnight, love. tomorrow is already set up for you x")
    print("day review written + sent")


if __name__ == "__main__":
    main()
