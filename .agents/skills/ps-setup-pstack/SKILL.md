---
name: ps-setup-pstack
description: Configure P-Stack for Pi, Codex, Cursor, OpenCode, and Claude Code. Use when installing P-Stack, choosing its small, medium, and large models, setting reasoning levels, adding harness adapters, or refreshing model identifiers.
license: MIT. See LICENSE.txt
metadata:
  ps-upstream-name: setup-pstack
  ps-upstream-version: "0.14.4"
---

# Set up P-Stack

Configure one repository for the user's selected agent harnesses. The generated model registry is shared. Harness-specific files are adapters derived from it.

Read [the harness reference](references/harnesses.md) before asking questions or writing files. Run `scripts/configure.py --help` before using the renderer.

## 1. Choose harnesses

Ask which harnesses the user wants to configure. The supported values are `pi`, `codex`, `cursor`, `opencode`, and `claude`.

Do not create `.pi/APPEND_SYSTEM.md`, a Codex instruction import, Cursor rules, or OpenCode instruction entries. Pi, Codex, Cursor, and OpenCode read root `AGENTS.md` directly. Claude Code is the only listed harness that needs a root instruction adapter.

## 2. Resolve model tiers

For each selected harness, ask for three model choices:

- `small` for fast, bounded work.
- `medium` for ordinary implementation and investigation.
- `large` for design, judgment, and difficult work.

For every tier, collect the user's display label, the exact harness model identifier, and the exact reasoning level or variant. Treat the user's label as intent, not as an identifier. Use the active harness catalog and current primary documentation to resolve it.

For example, a Codex user may choose GPT-5.6 Luna, Terra, and Sol. Resolve and verify the exact slugs exposed to that account. Do not assume an example slug is still current.

## 3. Verify before writing

Probe every model and reasoning pair with a small read-only request. Save how each pair was verified and the current date in the plan. If a harness can prove only that it accepted the requested pair, say that. Do not claim that the provider exposed hidden applied reasoning.

A failed or ambiguous pair stops setup for that harness. Never substitute a fallback silently.

## 4. Build the plan

Write a temporary JSON plan with this shape:

```json
{
  "schema_version": 1,
  "harnesses": {
    "codex": {
      "harness_version": "version reported by the installed harness",
      "tiers": {
        "small": {
          "label": "GPT-5.6 Luna",
          "model": "exact-slug",
          "reasoning": "exact-level",
          "verified_by": "catalog source and probe command",
          "verified_on": "YYYY-MM-DD"
        },
        "medium": {},
        "large": {}
      }
    }
  }
}
```

Fill every tier object. Do not leave placeholders.

## 5. Preview and apply

Preview the transaction:

```bash
python3 scripts/configure.py --repo <repo-root> --plan <plan.json> --check
```

Show the user the selected harnesses and tier mappings. Then apply:

```bash
python3 scripts/configure.py --repo <repo-root> --plan <plan.json> --mirror-claude-skills
```

The mirror flag has an effect only when Claude Code is selected. It copies owned `ps-*` skills from `.agents/skills/` into `.claude/skills/` without replacing unowned directories.

## 6. Verify discovery

Read back `.agents/pstack/models.json`, the bounded `AGENTS.md` block, and every generated profile. For Claude Code, also verify the `CLAUDE.md` import and mirrored skills.

Start a new session in each configured harness. Confirm that `ps-setup-pstack` and `ps-poteto-mode` are discoverable. Run one harmless subagent task at each tier when the harness supports delegation. Report harnesses that can run P-Stack only inline.

An unchanged rerun must produce byte-identical generated files.
