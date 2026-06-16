#!/usr/bin/env python3
"""Quote OKF frontmatter fields that break YAML parsing."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SKIP = {"index.md", "log.md"}


def quote_yaml(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def parse_frontmatter(text: str) -> tuple[dict[str, str], str] | None:
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end == -1:
        return None
    block = text[4:end]
    body = text[end + 5 :]
    fields: dict[str, str] = {}
    for line in block.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        if line.startswith("tags:"):
            fields["tags"] = line.split(":", 1)[1].strip()
            continue
        m = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", line)
        if m:
            fields[m.group(1)] = m.group(2).strip().strip('"')
    return fields, body


def render_frontmatter(fields: dict[str, str]) -> str:
    lines = [f"type: {fields['type']}"]
    for key in ("title", "description"):
        if key in fields and fields[key]:
            lines.append(f"{key}: {quote_yaml(fields[key])}")
    if "tags" in fields:
        lines.append(f"tags: {fields['tags']}")
    if "timestamp" in fields:
        lines.append(f"timestamp: {fields['timestamp']}")
    return "---\n" + "\n".join(lines) + "\n---\n\n"


def main() -> None:
    fixed = 0
    for path in sorted(DOCS.rglob("*.md")):
        if path.name in SKIP:
            continue
        parsed = parse_frontmatter(path.read_text(encoding="utf-8"))
        if not parsed:
            continue
        fields, body = parsed
        if "type" not in fields:
            continue
        path.write_text(render_frontmatter(fields) + body.lstrip(), encoding="utf-8")
        fixed += 1
    print(f"Re-rendered frontmatter on {fixed} files.")


if __name__ == "__main__":
    main()
