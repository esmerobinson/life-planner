"""Thin wrapper around Gemini (free tier). Used for two jobs:
smart reply-routing, and light polishing of message text into Esme's voice.
Falls back gracefully (returns None) if the key is missing or the call fails,
so the tool still works on heuristics without it.
"""

import json
import os

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

_client = None


def _get_client():
    global _client
    if _client is None:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            return None
        from google import genai
        _client = genai.Client(api_key=key)
    return _client


def generate(prompt, system=None):
    client = _get_client()
    if not client:
        return None
    try:
        from google.genai import types
        cfg = types.GenerateContentConfig(system_instruction=system) if system else None
        r = client.models.generate_content(model=MODEL, contents=prompt, config=cfg)
        return (r.text or "").strip()
    except Exception:
        return None


def generate_json(prompt, system=None):
    client = _get_client()
    if not client:
        return None
    try:
        from google.genai import types
        cfg = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
        )
        r = client.models.generate_content(model=MODEL, contents=prompt, config=cfg)
        return json.loads(r.text)
    except Exception:
        return None
