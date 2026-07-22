"""A tiny, vague activity signal so the planner can be proactive.

It only ever reads two things: the name of the app in front, and how many seconds
since you last touched the keyboard/mouse. No screenshots, no window titles, no
content, no keylogging. It writes one small line to the vault (Daily/activity.json)
which the cloud reads to decide whether a gentle nudge would help.

    python3 scripts/activity.py --demo    # just print what it sees, write nothing
    python3 scripts/activity.py           # capture + save the signal (run by launchd)
"""

import json
import subprocess
import sys
import time

sys.path.insert(0, __file__.rsplit("/", 2)[0])


def frontmost_app():
    try:
        return subprocess.check_output(
            ["osascript", "-e",
             'tell application "System Events" to name of first process whose frontmost is true'],
            text=True).strip()
    except Exception:
        return "unknown"


def idle_seconds():
    try:
        out = subprocess.check_output(
            "ioreg -c IOHIDSystem | grep HIDIdleTime | head -1", shell=True, text=True)
        return round(int(out.split("=")[-1].strip()) / 1e9)
    except Exception:
        return 0


def capture():
    return {"app": frontmost_app(), "idle_seconds": idle_seconds(), "ts": int(time.time())}


if __name__ == "__main__":
    sig = capture()
    if "--demo" in sys.argv:
        print("this is all it sees:", sig)
    else:
        from dotenv import load_dotenv
        import os
        load_dotenv(dotenv_path=os.path.join(__file__.rsplit("/", 2)[0], ".env"))
        from src import storage
        try:
            log = json.loads(storage.read("Daily/activity.json") or "[]")
        except Exception:
            log = []
        log.append(sig)
        log = log[-24:]  # keep roughly the last couple of hours
        storage.write("Daily/activity.json", json.dumps(log))
        print("saved:", sig)
