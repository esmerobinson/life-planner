# Life Planner

A personal planning + motivation tool for Esme. Replaces the current Claude Task
that writes the Obsidian daily notes, and adds a two-way WhatsApp coach that shows
up twice+ a day — in *her own voice, me-to-me*, never with guilt.

Vault: `~/Desktop/Esme's Brain` (a Google Drive mount).
Motivation source bank: `Mind & Wellbeing/Motivation & Manifestation Kit.md` in the vault.

## Design principles (non-negotiable)
- **Never guilt.** Guilt spirals her. Motivate with *why it compounds*, not pressure.
- **From-me-to-me voice.** The 8:30am message reads as Esme reminding herself of her own commitments.
- **Be visual.** Surface vision-board imagery, not just text.
- **Persist until answered.** Gently re-ping until the morning intention and evening reflection are done.
- **3–4 items max**, over a daily spine: *write something + touch content, every day.*
- **Plain terminal / 8-bit** for any UI. No fancy design.

## Free stack
- **WhatsApp** — official Meta Cloud API (free for daily use; replies keep the 24h window open).
- **Cloudflare Worker** — catches inbound replies (GitHub Actions can't hold a webhook). *(Phase 2)*
- **GitHub Actions** — scheduled sends + planning + writes to the vault. Free.
- **Gemini** — the "brain" (free tier). *(Phase 1)*
- **Google Drive API** — edits the Obsidian notes even when the Mac is off. *(Phase 2/3)*

## Phases
- **Phase 0 — Plumbing.** A real message reaches the phone. → `scripts/hello.py`  ← *we are here*
- **Phase 1 — The 8:30am from-me-to-me message.** Reads daily note + goals + Kit; composes in her voice.
- **Phase 2 — Two-way capture.** Cloudflare Worker → replies routed into Obsidian; nag-until-answered.
- **Phase 3 — The smarter planner.** Ingest + urgency rule (3–4, deadlines + spine + stalled-goal move + balance), carry-over aging & commit-or-kill.
- **Phase 4 — 1pm + 5pm check-ins** and the evening reflection loop.
- **Phase 5 — Goals + the plain terminal dashboard.** North Star register, movement-per-goal, weekly review.

## Setup (Phase 0)
1. `pip install -r requirements.txt`
2. Create the WhatsApp app (see below), copy `.env.example` → `.env`, fill in the three WhatsApp values.
3. `python scripts/hello.py` — the `hello_world` template lands in your WhatsApp.
4. Reply to it, then `python scripts/hello.py --text` to confirm free-form messages work.
