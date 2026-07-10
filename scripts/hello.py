"""Phase 0 smoke test — send Esme one WhatsApp message and prove the pipes work.

Sends the default `hello_world` template (works as first contact, no 24h window
needed). Once you reply to it in WhatsApp, the 24h window opens and free-form
`send_text` will work too — try scripts/hello.py --text after replying.

Run:
    python scripts/hello.py           # sends the hello_world template
    python scripts/hello.py --text    # sends a free-form text (needs an open window)
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
from src import whatsapp

load_dotenv()


def main():
    to = os.environ["MY_NUMBER"]  # your number, country code, digits only e.g. 447700900123
    if "--text" in sys.argv:
        resp = whatsapp.send_text(
            to,
            "hi Esme — it's you, from your own corner of the internet. "
            "the pipes work. tomorrow this becomes your 8:30 x",
        )
    else:
        resp = whatsapp.send_template(to)
    print("sent:", resp)


if __name__ == "__main__":
    main()
