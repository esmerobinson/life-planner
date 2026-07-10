"""One entry point for the scheduled runs. GitHub Actions calls this at each time.

    python3 scripts/run.py morning   # generate today's Daily Note (if missing), then send
    python3 scripts/run.py midday
    python3 scripts/run.py evening
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

from src import compose, planner, whatsapp

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))


def main():
    slot = sys.argv[1] if len(sys.argv) > 1 else "morning"
    if slot == "morning":
        path, text = planner.generate(write=True)
        print("daily note:", "created" if text else "already existed", os.path.basename(path))
    msg = compose.render(slot)
    whatsapp.send_text(os.environ["MY_NUMBER"], msg)
    print(f"sent {slot} message")


if __name__ == "__main__":
    main()
