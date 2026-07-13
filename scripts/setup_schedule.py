"""Install launchd agents so the planner runs itself on this Mac:
    8:30  morning  (generate Daily Note + send)
    13:00 midday   (send)
    17:00 evening  (send)
    every 15 min   process_replies (file your texts into the vault)

Run:  python3 scripts/setup_schedule.py         (install + load)
      python3 scripts/setup_schedule.py remove   (unload + delete)
"""

import os
import subprocess
import sys

PROJECT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PYTHON = sys.executable
LA = os.path.expanduser("~/Library/LaunchAgents")
LOGS = os.path.join(PROJECT, "logs")

# Old fixed-time jobs, replaced by the windowed tick (unloaded on install).
LEGACY = ["com.esme.planner.morning", "com.esme.planner.midday", "com.esme.planner.evening"]

# label -> (script args, schedule dict-or-interval)
JOBS = {
    "com.esme.planner.tick": (["scripts/tick.py"], 1200),  # windowed sender, every 20 min
    "com.esme.planner.replies": (["scripts/process_replies.py"], 900),  # every 15 min
}


def _plist(label, args, sched):
    prog = "".join(f"    <string>{a}</string>\n"
                   for a in [PYTHON] + [os.path.join(PROJECT, args[0])] + args[1:])
    if isinstance(sched, dict):
        trig = ("  <key>StartCalendarInterval</key>\n  <dict>\n"
                + "".join(f"    <key>{k}</key><integer>{v}</integer>\n" for k, v in sched.items())
                + "  </dict>\n")
    else:
        trig = f"  <key>StartInterval</key><integer>{sched}</integer>\n"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n<dict>\n'
        f"  <key>Label</key><string>{label}</string>\n"
        f"  <key>ProgramArguments</key>\n  <array>\n{prog}  </array>\n"
        f"  <key>WorkingDirectory</key><string>{PROJECT}</string>\n"
        f"{trig}"
        f"  <key>StandardOutPath</key><string>{LOGS}/{label}.log</string>\n"
        f"  <key>StandardErrorPath</key><string>{LOGS}/{label}.err</string>\n"
        "</dict>\n</plist>\n"
    )


def install():
    os.makedirs(LA, exist_ok=True)
    os.makedirs(LOGS, exist_ok=True)
    for label in LEGACY:  # retire the old fixed-time jobs
        path = os.path.join(LA, f"{label}.plist")
        subprocess.run(["launchctl", "unload", path], capture_output=True)
        if os.path.exists(path):
            os.remove(path)
    for label, (args, sched) in JOBS.items():
        path = os.path.join(LA, f"{label}.plist")
        with open(path, "w") as f:
            f.write(_plist(label, args, sched))
        subprocess.run(["launchctl", "unload", path], capture_output=True)
        r = subprocess.run(["launchctl", "load", "-w", path], capture_output=True, text=True)
        print(f"loaded {label}" + (f" ({r.stderr.strip()})" if r.stderr.strip() else ""))


def remove():
    for label in JOBS:
        path = os.path.join(LA, f"{label}.plist")
        subprocess.run(["launchctl", "unload", path], capture_output=True)
        if os.path.exists(path):
            os.remove(path)
        print(f"removed {label}")


if __name__ == "__main__":
    remove() if "remove" in sys.argv else install()
