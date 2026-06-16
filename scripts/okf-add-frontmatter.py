#!/usr/bin/env python3
"""Add OKF frontmatter to concept docs missing it. Run from repo root."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
TIMESTAMP = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

SKIP_NAMES = {"index.md", "log.md"}
SKIP_DIRS = {".repos", "node_modules"}


def infer_type(path: Path) -> str:
    rel = path.relative_to(DOCS).as_posix()
    if rel.startswith("specs/plans/"):
        return "Plan"
    if rel.startswith("specs/"):
        return "Spec"
    if rel.startswith("adrs/"):
        return "ADR"
    if rel.startswith("architecture/"):
        return "Architecture Note"
    if rel.startswith("operations/"):
        return "Runbook"
    if rel.startswith("reference/"):
        return "Reference"
    if rel.startswith("getting-started/") or rel.startswith("user/"):
        return "Guide"
    if rel.startswith("providers/") or rel.startswith("cloud/") or rel.startswith("integrations/"):
        return "Guide"
    return "Guide"


def infer_tags(path: Path, doc_type: str) -> list[str]:
    parts = path.relative_to(DOCS).parts
    tags = [p for p in parts[:-1] if p not in {"specs", "plans"}]
    tags.append(doc_type.lower().replace(" ", "-"))
    return tags[:6]


def title_from_body(body: str, fallback: str) -> str:
    for line in body.splitlines():
        m = re.match(r"^#\s+(.+)$", line.strip())
        if m:
            return m.group(1).strip()
    return fallback


def description_from_body(body: str) -> str:
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        return stripped[:200]
    return "KataCode documentation."


def has_frontmatter(text: str) -> bool:
    return text.startswith("---\n") and "\n---\n" in text[4:]


def add_frontmatter(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if has_frontmatter(text):
        return False

    doc_type = infer_type(path)
    title = path.stem.replace("-", " ").title()
    body = text
    title = title_from_body(body, title)
    description = description_from_body(body)
    tags = infer_tags(path, doc_type)

    frontmatter = (
        "---\n"
        f"type: {doc_type}\n"
        f"title: {title}\n"
        f"description: {description}\n"
        f"tags: [{', '.join(tags)}]\n"
        f"timestamp: {TIMESTAMP}\n"
        "---\n\n"
    )
    path.write_text(frontmatter + body.lstrip(), encoding="utf-8")
    return True


def main() -> None:
    changed = 0
    for path in sorted(DOCS.rglob("*.md")):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.name in SKIP_NAMES:
            continue
        if add_frontmatter(path):
            print(path.relative_to(ROOT))
            changed += 1
    print(f"\nAdded frontmatter to {changed} files.")


if __name__ == "__main__":
    main()
