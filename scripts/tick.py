"""Windowed scheduler, run frequently by launchd. Fixes the 'all at once at a weird
time' problem: each message only goes out inside its own time window, once per day.
If the Mac was asleep and a window already passed, that slot is skipped (marked done)
rather than sent late, so you never get a stale morning message in the afternoon.

    morning  08:30 - 11:00   (also generates the day's note)
    midday   13:00 - 15:00
    evening  17:00 - 21:00
"""

import json
import os
import sys
from datetime import date, datetime, time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

from src import compose, planner, whatsapp

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

STATE = os.path.join(os.path.dirname(__file__), "..", "logs", "sent.json")
WINDOWS = {
    "morning": (time(8, 30), time(11, 0)),
    "midday": (time(13, 0), time(15, 0)),
    "evening": (time(17, 0), time(21, 0)),
}


def _load():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save(state):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f:
        json.dump(state, f)


def main():
    now = datetime.now()
    today = now.date().isoformat()
    state = _load()
    done = set(state.get(today, []))

    for slot, (start, end) in WINDOWS.items():
        if slot in done or now.time() < start:
            continue
        if now.time() >= end:
            done.add(slot)  # window missed, skip (don't send it late)
            continue
        if slot == "morning":
            planner.generate(write=True)
        whatsapp.send_text(os.environ["MY_NUMBER"], compose.render(slot))
        done.add(slot)
        print(f"sent {slot} at {now:%H:%M}")

    state = {today: sorted(done)}  # only keep today
    _save(state)


if __name__ == "__main__":
    main()
