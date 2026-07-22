"""Proactive check: reads the vague activity signal and, if focus looks drifted
during a work block, sends one gentle nudge (rate-limited to once every 2 hours).
Runs in the cloud on a schedule. Only reacts to obvious time-sink apps to avoid
false alarms; browsers are ignored on purpose (could be work or play).
"""

import json
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

from src import compose, storage, vault, whatsapp

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

DISTRACTIONS = ("instagram", "tiktok", "netflix", "youtube", "messages", "discord",
                "reddit", "facebook", "whatsapp", "twitter", "tv")
STATE = "Daily/planner-proactive.json"


def main():
    now = int(time.time())
    hour = datetime.now().hour  # TZ Europe/London set in the workflow
    if not (9 <= hour < 18):
        return print("outside work hours")

    log = json.loads(vault.read("Daily/activity.json") or "[]")
    if not log:
        return print("no activity signal")
    if now - log[-1]["ts"] > 20 * 60:
        return print("signal is stale (Mac likely off)")

    recent = [e for e in log if now - e["ts"] <= 40 * 60]
    if len(recent) < 4:
        return print("not enough recent data")

    drifted = sum(1 for e in recent if any(d in e["app"].lower() for d in DISTRACTIONS))
    if drifted < len(recent) * 0.6:
        return print("looks focused enough")

    state = json.loads(vault.read(STATE) or "{}")
    if now - state.get("last_nudge", 0) < 2 * 3600:
        return print("nudged recently, holding off")

    whatsapp.send_text(os.environ["MY_NUMBER"], compose.proactive_nudge(log[-1]["app"]))
    storage.write(STATE, json.dumps({"last_nudge": now}))
    print("sent proactive nudge (drift to", log[-1]["app"], ")")


if __name__ == "__main__":
    main()
