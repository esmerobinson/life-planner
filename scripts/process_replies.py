"""Pull queued WhatsApp replies from the Cloudflare Worker and file them into
the vault via the router. Run on a schedule (GitHub Actions) or locally.

Needs in .env:  WORKER_URL (e.g. https://life-planner.<you>.workers.dev)  and  PULL_TOKEN
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import requests
from dotenv import load_dotenv

from src import router

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))


def main():
    dry = "--dry-run" in sys.argv
    base = os.environ["WORKER_URL"].rstrip("/")
    r = requests.get(f"{base}/pull", params={"token": os.environ["PULL_TOKEN"]}, timeout=30)
    r.raise_for_status()
    messages = r.json()
    if not messages:
        print("no new replies")
        return
    for m in messages:
        text = m.get("text", "").strip()
        if not text:
            continue  # media handling comes in Phase 2c
        print(f"\nREPLY: {text}")
        for action in router.route(text, dry_run=dry):
            print("  ->", action)


if __name__ == "__main__":
    main()
