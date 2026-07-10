"""WhatsApp Cloud API client — send text, images, and templates.

Uses Meta's official Cloud API. Free-form ("session") messages only work inside
the 24-hour window that opens when Esme messages the bot. To make first contact
(or reach her after >24h of silence) we send a pre-approved template instead —
every app ships with the default `hello_world` template, which is what Phase 0
uses to prove the pipes.
"""

import os
import requests

GRAPH_VERSION = "v21.0"
BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"


def _config():
    token = os.environ["WHATSAPP_TOKEN"]
    phone_number_id = os.environ["PHONE_NUMBER_ID"]
    return token, phone_number_id


def _post(payload):
    token, phone_number_id = _config()
    r = requests.post(
        f"{BASE}/{phone_number_id}/messages",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if not r.ok:
        # Surface Meta's error body — it's specific and worth reading.
        raise RuntimeError(f"WhatsApp API {r.status_code}: {r.text}")
    return r.json()


def send_text(to, body):
    """Free-form message. Only delivers inside an open 24h window."""
    return _post({
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": body},
    })


def send_image(to, image_url, caption=None):
    """Send an image by public URL (used for vision-board imagery)."""
    image = {"link": image_url}
    if caption:
        image["caption"] = caption
    return _post({
        "messaging_product": "whatsapp",
        "to": to,
        "type": "image",
        "image": image,
    })


def send_template(to, name="hello_world", language="en_US", components=None):
    """Pre-approved template — works with no open window (first contact, or after silence)."""
    template = {"name": name, "language": {"code": language}}
    if components:
        template["components"] = components
    return _post({
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": template,
    })
