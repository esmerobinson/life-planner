"""One entry point for the scheduled runs. GitHub Actions calls this at each time.

    python3 scripts/run.py morning   # generate today's Daily Note (if missing), then send
    python3 scripts/run.py midday
    python3 scripts/run.py evening
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime

from dotenv import load_dotenv

from src import compose, planner, whatsapp

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))


def slot_for_now():
    """Pick the message that matches the time of day, so a morning message never
    goes out in the evening."""
    h = datetime.now().hour
    if h < 11:
        return "morning"
    if h < 16:
        return "midday"
    return "evening"


def main():
    slot = sys.argv[1] if len(sys.argv) > 1 else slot_for_now()
    if slot == "morning":
        path, text = planner.generate(write=True)
        print("daily note:", "created" if text else "already existed", os.path.basename(path))
    msg = compose.render(slot)
    whatsapp.send_text(os.environ["MY_NUMBER"], msg)
    print(f"sent {slot} message")

    # record the send so the nudge loop can chase an unanswered check-in
    import json
    import time
    from datetime import date
    from src import storage, vault
    state = {}
    try:
        state = json.loads(vault.read("Daily/planner-sent.json") or "{}")
    except Exception:
        pass
    today = date.today().isoformat()
    state = {today: {**state.get(today, {}), slot: int(time.time())}}
    storage.write("Daily/planner-sent.json", json.dumps(state))


if __name__ == "__main__":
    main()
