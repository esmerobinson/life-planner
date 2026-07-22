"""Rebuild the visual dashboard HTML into docs/ (served by GitHub Pages)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

from src import dashboard

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

root = os.path.join(os.path.dirname(__file__), "..")
os.makedirs(os.path.join(root, "docs"), exist_ok=True)
with open(os.path.join(root, "docs", "index.html"), "w", encoding="utf-8") as f:
    f.write(dashboard.build_html())
print("dashboard built -> docs/index.html")
