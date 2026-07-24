"""One entry point for the scheduled runs. GitHub Actions calls this at each time.

    python3 scripts/run.py morning   # generate today's Daily Note (if missing), then send
    python3 scripts/run.py midday
    python3 scripts/run.py evening
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date, datetime

from dotenv import load_dotenv

from src import compose, planner, storage, vault, whatsapp

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# WhatsApp only delivers free-form text inside 24h of her last reply. Outside that
# window the API still returns 200 OK with a message ID but silently drops it, so we
# must actively check and fall back to the approved template, which always delivers
# and reopens the window when she replies to it.
WINDOW_HOURS = 23  # leave an hour of slack inside Meta's real 24h cutoff
TEMPLATE_NAME = "daily_checkin"


def slot_for_now():
    """Pick the message that matches the time of day, so a morning message never
    goes out in the evening."""
    h = datetime.now().hour
    if h < 11:
        return "morning"
    if h < 16:
        return "midday"
    return "evening"


def window_open():
    try:
        last = json.loads(vault.read("Daily/planner-last-reply.json") or "{}").get("ts", 0)
    except Exception:
        last = 0
    return (time.time() - last) < WINDOW_HOURS * 3600


def _record_sent(slot, kind):
    state = {}
    try:
        state = json.loads(vault.read("Daily/planner-sent.json") or "{}")
    except Exception:
        pass
    today = date.today().isoformat()
    state = {today: {**state.get(today, {}), slot: {"ts": int(time.time()), "kind": kind}}}
    storage.write("Daily/planner-sent.json", json.dumps(state))


def send_checkin(slot, force_full=False):
    """Send a slot's check-in: the real message if the window's open (or force_full,
    used right after she replies), else the template to safely reopen the window."""
    if force_full or window_open():
        whatsapp.send_text(os.environ["MY_NUMBER"], compose.render(slot))
        print(f"sent {slot} message (full)")
        _record_sent(slot, "full")
    else:
        whatsapp.send_template(
            os.environ["MY_NUMBER"], name=TEMPLATE_NAME, language="en",
            components=[{"type": "body", "parameters": [{"type": "text", "text": slot}]}])
        print(f"window closed: sent {slot} via template (reply to unlock the full message)")
        _record_sent(slot, "template")


def main():
    slot = sys.argv[1] if len(sys.argv) > 1 else slot_for_now()
    if slot == "morning":
        path, text = planner.generate(write=True)
        print("daily note:", "created" if text else "already existed", os.path.basename(path))
    send_checkin(slot)


if __name__ == "__main__":
    main()
