"""Pull queued WhatsApp replies from the Cloudflare Worker and file them into
the vault via the router. Run on a schedule (GitHub Actions) or locally.

Needs in .env:  WORKER_URL (e.g. https://life-planner.<you>.workers.dev)  and  PULL_TOKEN
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import requests
from dotenv import load_dotenv

from src import compose, router, whatsapp

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))


NUDGE_AFTER = 100 * 60  # chase an unanswered check-in after ~100 minutes


def check_nudge(dry=False):
    """If the latest check-in has sat unanswered, send her nudge line, once per slot."""
    import json
    import time
    from datetime import date
    from src import storage, vault
    now, today = int(time.time()), date.today().isoformat()
    try:
        sent = json.loads(vault.read("Daily/planner-sent.json") or "{}").get(today, {})
        last_reply = json.loads(vault.read("Daily/planner-last-reply.json") or "{}").get("ts", 0)
        nudged = json.loads(vault.read("Daily/planner-nudged.json") or "{}")
    except Exception:
        return
    for slot, ts in sent.items():
        if (now - ts > NUDGE_AFTER and last_reply < ts and slot not in nudged.get(today, [])
                and now - ts < 6 * 3600):
            if not dry:
                whatsapp.send_text(os.environ["MY_NUMBER"], compose.nudge())
                nudged = {today: nudged.get(today, []) + [slot]}
                storage.write("Daily/planner-nudged.json", json.dumps(nudged))
            print(f"nudged: {slot} check-in unanswered")
            return


def main():
    dry = "--dry-run" in sys.argv
    base = os.environ["WORKER_URL"].rstrip("/")
    r = requests.get(f"{base}/pull", params={"token": os.environ["PULL_TOKEN"]}, timeout=30)
    r.raise_for_status()
    messages = r.json()
    if not messages:
        print("no new replies")
        check_nudge(dry)
        return

    # record that she replied, so pending nudges stand down
    import json
    import time
    from src import storage
    if not dry:
        storage.write("Daily/planner-last-reply.json", json.dumps({"ts": int(time.time())}))
    for m in messages:
        text = m.get("text", "").strip()
        if not text:
            continue  # media handling comes in Phase 2c
        print(f"\nREPLY: {text}")
        actions = router.route(text, dry_run=dry)
        for action in actions:
            print("  ->", action)
        # mood-adaptive reply: meets her where she is, one tailored step
        response = compose.reply(text, actions)
        print("  reply:", response.splitlines()[-1])
        if not dry:
            whatsapp.send_text(m.get("from") or os.environ["MY_NUMBER"], response)


if __name__ == "__main__":
    main()
