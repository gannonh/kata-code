#!/usr/bin/env python3
"""Render P-Stack model tiers and harness adapters into a repository."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile


HARNESSES = ("pi", "codex", "cursor", "opencode", "claude")
TIERS = ("small", "medium", "large")
ROLES = {
    "feature": "medium",
    "refactoring": "medium",
    "bug-fix": "large",
    "perf-issue": "large",
    "hillclimb": "large",
    "judgment and prose": "large",
    "hardest tasks": "large",
    "exploration": "small",
    "implementation": "medium",
    "verification": "medium",
    "how explorer": "small",
    "how explainer": "large",
    "how critics": ["small", "medium", "large"],
    "why investigators": "small",
    "why synthesizer": "large",
    "reflect tooling": "medium",
    "reflect judgment": "large",
    "reflect divergent": "large",
    "reflect synthesizer": "large",
    "arena runners": ["small", "medium", "large"],
    "arena cross-judge pool": ["small", "medium", "large"],
    "swarm workers": "medium",
    "architect runners": ["small", "medium", "large"],
    "interrogate reviewers": ["small", "medium", "large"],
}
AGENTS_BEGIN = "<!-- ps-pstack:begin -->"
AGENTS_END = "<!-- ps-pstack:end -->"
CLAUDE_BEGIN = "<!-- ps-pstack:claude:begin -->"
CLAUDE_END = "<!-- ps-pstack:claude:end -->"
CODEX_BEGIN = "# ps-pstack:agents:begin"
CODEX_END = "# ps-pstack:agents:end"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--mirror-claude-skills", action="store_true")
    parser.add_argument("--skills-source", type=Path)
    return parser.parse_args()


def validate_scalar(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\n" in value or "\r" in value:
        raise ValueError(f"{field} must be a non-empty single-line string")
    return value.strip()


def validate_plan(raw: object) -> dict:
    if not isinstance(raw, dict) or raw.get("schema_version") != 1:
        raise ValueError("plan schema_version must be 1")
    harnesses = raw.get("harnesses")
    if not isinstance(harnesses, dict) or not harnesses:
        raise ValueError("plan must select at least one harness")
    unknown = set(harnesses) - set(HARNESSES)
    if unknown:
        raise ValueError(f"unsupported harnesses: {sorted(unknown)}")
    result = {"schema_version": 1, "harnesses": {}}
    for harness in HARNESSES:
        if harness not in harnesses:
            continue
        entry = harnesses[harness]
        if not isinstance(entry, dict):
            raise ValueError(f"{harness} entry must be an object")
        tiers = entry.get("tiers")
        if not isinstance(tiers, dict) or set(tiers) != set(TIERS):
            raise ValueError(f"{harness} must define exactly small, medium, and large")
        normalized_tiers = {}
        for tier in TIERS:
            choice = tiers[tier]
            if not isinstance(choice, dict):
                raise ValueError(f"{harness}.{tier} must be an object")
            normalized_tiers[tier] = {
                key: validate_scalar(choice.get(key), f"{harness}.{tier}.{key}")
                for key in ("label", "model", "reasoning", "verified_by", "verified_on")
            }
            if not re.fullmatch(r"[A-Za-z0-9_.:/+@#\[\]-]+", normalized_tiers[tier]["model"]):
                raise ValueError(f"{harness}.{tier}.model contains unsupported characters")
            if not re.fullmatch(r"[A-Za-z0-9_-]+", normalized_tiers[tier]["reasoning"]):
                raise ValueError(f"{harness}.{tier}.reasoning contains unsupported characters")
        result["harnesses"][harness] = {
            "harness_version": validate_scalar(entry.get("harness_version"), f"{harness}.harness_version"),
            "tiers": normalized_tiers,
        }
    return result


def replace_block(existing: str, begin: str, end: str, body: str) -> str:
    begin_count = existing.count(begin)
    end_count = existing.count(end)
    if begin_count != end_count or begin_count > 1:
        raise ValueError(f"inconsistent bounded block: {begin} / {end}")
    block = f"{begin}\n{body.rstrip()}\n{end}"
    if begin_count == 0:
        return (existing.rstrip() + "\n\n" + block + "\n").lstrip("\n")
    start = existing.index(begin)
    finish = existing.index(end, start) + len(end)
    if finish <= start:
        raise ValueError(f"reversed bounded block: {begin}")
    return existing[:start] + block + existing[finish:]


def yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def profile_body(tier: str) -> str:
    return (
        f"You are the P-Stack {tier} tier. Follow the complete task brief from the parent. "
        "Respect its requested access mode, return evidence, and do not expand scope.\n"
    )


def render_profile(harness: str, tier: str, choice: dict) -> str:
    description = f"P-Stack {tier} model tier"
    model = choice["model"]
    reasoning = choice["reasoning"]
    if harness == "codex":
        return (
            f"model = {json.dumps(model)}\n"
            f"model_reasoning_effort = {json.dumps(reasoning)}\n"
            f"developer_instructions = {json.dumps(profile_body(tier))}\n"
        )
    if harness == "cursor":
        selector = model if reasoning == "default" else f"{model}[effort={reasoning}]"
        return (
            "---\n"
            f"name: ps-{tier}\n"
            f"description: {description}\n"
            f"model: {yaml_string(selector)}\n"
            "---\n\n"
            + profile_body(tier)
        )
    if harness == "opencode":
        selector = model if reasoning == "default" else f"{model}#{reasoning}"
        return (
            "---\n"
            f"description: {description}\n"
            "mode: subagent\n"
            f"model: {yaml_string(selector)}\n"
            "---\n\n"
            + profile_body(tier)
        )
    if harness == "claude":
        return (
            "---\n"
            f"name: ps-{tier}\n"
            f"description: {description}\n"
            f"model: {yaml_string(model)}\n"
            f"effort: {yaml_string(reasoning)}\n"
            "---\n\n"
            + profile_body(tier)
        )
    return (
        "---\n"
        f"name: ps-{tier}\n"
        f"description: {description}. Requires a Pi subagent extension that reads .pi/agents.\n"
        f"model: {yaml_string(model)}\n"
        f"thinking: {yaml_string(reasoning)}\n"
        "---\n\n"
        + profile_body(tier)
    )


def render_agents_block(config: dict) -> str:
    lines = [
        "# P-Stack",
        "",
        "P-Stack skills use the lowercase `ps-` prefix required by the Agent Skills standard.",
        "Read `.agents/pstack/models.json` before delegating P-Stack work.",
        "Resolve the workflow role through `role_tiers`, then use the active harness's matching `ps-small`, `ps-medium`, or `ps-large` profile when supported.",
        "Use the current harness's normal delegation mechanism. Run independent lanes concurrently when supported. If delegation or child model overrides are unavailable, run inline and disclose the limitation.",
        "",
        "Configured tiers:",
        "",
    ]
    for harness, entry in config["harnesses"].items():
        lines.append(f"- {harness}:")
        for tier in TIERS:
            choice = entry["tiers"][tier]
            lines.append(f"  - {tier}: `{choice['model']}` with `{choice['reasoning']}` reasoning")
    return "\n".join(lines)


def config_payload(plan: dict) -> dict:
    return {
        "schema_version": 1,
        "role_tiers": ROLES,
        "harnesses": plan["harnesses"],
    }


def build_outputs(repo: Path, plan: dict) -> dict[Path, bytes]:
    config = config_payload(plan)
    outputs: dict[Path, bytes] = {}
    model_path = repo / ".agents" / "pstack" / "models.json"
    outputs[model_path] = (json.dumps(config, indent=2, sort_keys=True) + "\n").encode()
    agents_path = repo / "AGENTS.md"
    existing_agents = agents_path.read_text() if agents_path.exists() else ""
    outputs[agents_path] = replace_block(
        existing_agents, AGENTS_BEGIN, AGENTS_END, render_agents_block(config)
    ).encode()
    locations = {
        "pi": repo / ".pi" / "agents",
        "codex": repo / ".codex" / "agents",
        "cursor": repo / ".cursor" / "agents",
        "opencode": repo / ".opencode" / "agents",
        "claude": repo / ".claude" / "agents",
    }
    extensions = {"codex": ".toml"}
    for harness, entry in plan["harnesses"].items():
        for tier in TIERS:
            suffix = extensions.get(harness, ".md")
            path = locations[harness] / f"ps-{tier}{suffix}"
            outputs[path] = render_profile(harness, tier, entry["tiers"][tier]).encode()
    if "codex" in plan["harnesses"]:
        config_path = repo / ".codex" / "config.toml"
        existing = config_path.read_text() if config_path.exists() else ""
        body = "\n\n".join(
            f"[agents.\"ps-{tier}\"]\n"
            f"description = \"P-Stack {tier} model tier\"\n"
            f"config_file = \"agents/ps-{tier}.toml\""
            for tier in TIERS
        )
        outputs[config_path] = replace_block(existing, CODEX_BEGIN, CODEX_END, body).encode()
    if "claude" in plan["harnesses"]:
        claude_path = repo / "CLAUDE.md"
        existing = claude_path.read_text() if claude_path.exists() else ""
        outputs[claude_path] = replace_block(
            existing, CLAUDE_BEGIN, CLAUDE_END, "@AGENTS.md"
        ).encode()
    return outputs


def write_outputs(outputs: dict[Path, bytes], check: bool) -> int:
    drift = [path for path, content in outputs.items() if not path.exists() or path.read_bytes() != content]
    if check:
        if drift:
            print("would update:")
            for path in drift:
                print(path)
            return 1
        print("P-Stack configuration is current")
        return 0
    snapshots = {path: path.read_bytes() if path.exists() else None for path in outputs}
    written = []
    try:
        for path, content in outputs.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
                handle.write(content)
                temporary = Path(handle.name)
            os.replace(temporary, path)
            written.append(path)
        for path, content in outputs.items():
            if path.read_bytes() != content:
                raise OSError(f"readback mismatch: {path}")
    except Exception:
        for path in reversed(written):
            previous = snapshots[path]
            if previous is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(previous)
        raise
    print(f"updated {len(drift)} of {len(outputs)} generated files")
    return 0


def owned_skill(path: Path) -> bool:
    return (path / ".ps-port.json").exists()


def mirror_claude_skills(repo: Path, source: Path, check: bool) -> int:
    destination = repo / ".claude" / "skills"
    if not source.exists():
        raise ValueError(f"skills source does not exist: {source}")
    skills = sorted(path for path in source.glob("ps-*") if path.is_dir() and owned_skill(path))
    if not skills:
        raise ValueError(f"no owned ps-* skills found in {source}")
    drift = []
    for skill in skills:
        target = destination / skill.name
        if target.exists() and not owned_skill(target):
            raise ValueError(f"refusing to replace unowned Claude skill: {target}")
        if not target.exists() or hash_tree(skill) != hash_tree(target):
            drift.append(skill)
    if check:
        for skill in drift:
            print(f"would mirror: {skill.name}")
        return 1 if drift else 0
    destination.mkdir(parents=True, exist_ok=True)
    for skill in drift:
        target = destination / skill.name
        staged = Path(tempfile.mkdtemp(prefix=f".{skill.name}-", dir=destination))
        shutil.rmtree(staged)
        shutil.copytree(skill, staged, copy_function=shutil.copy2)
        backup = None
        if target.exists():
            backup = destination / f".{skill.name}.backup"
            if backup.exists():
                raise ValueError(f"stale mirror backup exists: {backup}")
            os.replace(target, backup)
        try:
            os.replace(staged, target)
            if hash_tree(skill) != hash_tree(target):
                raise OSError(f"mirror readback mismatch: {target}")
            if backup:
                shutil.rmtree(backup)
        except Exception:
            if target.exists():
                shutil.rmtree(target)
            if backup and backup.exists():
                os.replace(backup, target)
            raise
    print(f"mirrored {len(drift)} Claude skill directories")
    return 0


def hash_tree(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> int:
    args = parse_args()
    repo = args.repo.resolve()
    plan = validate_plan(json.loads(args.plan.read_text()))
    result = write_outputs(build_outputs(repo, plan), args.check)
    if args.mirror_claude_skills and "claude" in plan["harnesses"]:
        source = args.skills_source.resolve() if args.skills_source else repo / ".agents" / "skills"
        result = max(result, mirror_claude_skills(repo, source, args.check))
    return result


if __name__ == "__main__":
    raise SystemExit(main())
