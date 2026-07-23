"""One-way sync: Google Tasks -> Backlog inbox.

Anything Esme adds to Google Tasks (usually from her phone) that the Backlog doesn't
already know about gets appended to the '## Inbox (to triage)' section, carrying its
due date if it has one. Nothing is ever deleted from Google Tasks. Runs hourly in the
cloud. The 'Slides Quality Checks' list is a reference checklist and is skipped.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

from src import backlog, vault

SKIP_LISTS = {"slides quality checks"}


def _norm(s):
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


def main():
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    creds = Credentials.from_authorized_user_info(
        json.loads(os.environ["GDRIVE_OAUTH_JSON"]),
        ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/tasks"])
    svc = build("tasks", "v1", credentials=creds, cache_discovery=False)

    known = _norm(vault.read(backlog.BACKLOG_PATH))
    added = 0
    for tl in svc.tasklists().list(maxResults=50).execute().get("items", []):
        if tl["title"].strip().lower() in SKIP_LISTS:
            continue
        token = None
        while True:
            r = svc.tasks().list(tasklist=tl["id"], showCompleted=False,
                                 maxResults=100, pageToken=token).execute()
            for t in r.get("items", []):
                title = (t.get("title") or "").strip()
                if not title or t.get("status") == "completed":
                    continue
                if _norm(title) and _norm(title) in known:
                    continue
                entry = title
                if t.get("due"):
                    entry += f" [due {t['due'][:10]}]"
                if backlog.add_to_inbox(entry + " (from Google Tasks)"):
                    known += " " + _norm(title)
                    added += 1
                    print("  + inbox:", title)
            token = r.get("nextPageToken")
            if not token:
                break
    print(f"synced, {added} new task(s) added to Backlog inbox")


if __name__ == "__main__":
    main()
