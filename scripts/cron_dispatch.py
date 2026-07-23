"""One dispatcher for the housekeeping crons, decides what to run from the clock:

    ~06:xx daily      Google Tasks -> Backlog inbox sync (once a day is plenty)
    ~21:xx daily      nightly day-review (reads her replies, writes + sends the review)
    Sunday ~18:xx     weekly review
    1st ~08:xx        monthly check-in
"""

import os
import subprocess
import sys
from datetime import datetime

HERE = os.path.dirname(__file__)


def run(script, *args):
    print(f">>> {script}")
    subprocess.run([sys.executable, os.path.join(HERE, script), *args], check=False)


def main():
    now = datetime.now()  # TZ set by the workflow
    if now.hour < 12:
        run("gtasks_sync.py")
        if now.day == 1:
            run("review.py", "monthly")
    if now.hour >= 17 and now.weekday() == 6:
        run("review.py", "weekly")
    if now.hour >= 20:
        run("day_review.py")


if __name__ == "__main__":
    main()
