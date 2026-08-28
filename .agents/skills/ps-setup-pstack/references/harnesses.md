# Harness reference

Use current primary documentation and a live probe before recording any model identifier. Model catalogs and reasoning levels change.

## Shared files

Codex, Pi, Cursor, and OpenCode discover root `AGENTS.md` directly. They also discover project skills under `.agents/skills/`. Claude Code reads `CLAUDE.md` rather than `AGENTS.md`, and discovers project skills under `.claude/skills/`.

The setup renderer therefore keeps `AGENTS.md` as the instruction source. It adds `@AGENTS.md` to `CLAUDE.md` and mirrors P-Stack skills into `.claude/skills/` only when Claude Code is selected.

## Pi

- List models with `pi --list-models`.
- Model identifiers use `provider/id`. Probe with `pi -p --no-tools --model <provider/id> --thinking <level> <prompt>`.
- Pi loads root `AGENTS.md`; `.pi/APPEND_SYSTEM.md` appends to the system prompt and is not an AGENTS loader.
- Pi core does not prescribe one subagent extension. The renderer writes `.pi/agents/ps-*.md` model profiles for compatible extensions, while P-Stack retains a sequential fallback.
- Docs: https://pi.dev/docs/latest/usage and https://pi.dev/docs/latest/skills

## Codex

- Use the model picker, installed model catalog, or official model documentation. Verify a candidate with a read-only one-shot run.
- Record the exact model slug and a supported reasoning value.
- The renderer creates `.codex/agents/ps-*.toml` and registers them in a bounded block in `.codex/config.toml`.
- Codex loads root `AGENTS.md`; `.codex/config.toml` configures the harness rather than importing AGENTS.
- Docs: https://developers.openai.com/codex/models and https://developers.openai.com/codex/multi-agent

## Cursor

- Use Cursor's model list and model reference. Probe the exact ID before saving it.
- Cursor subagent model values accept an exact ID with options such as `model-id[effort=high]` when that model supports the option.
- The renderer creates `.cursor/agents/ps-*.md`.
- Cursor loads root `AGENTS.md`; `.cursor/rules` is optional for scoped rules.
- Docs: https://cursor.com/docs/models and https://cursor.com/docs/subagents

## OpenCode

- List the active catalog with `opencode models` and use the exact `provider/model` value.
- Reasoning controls are model-specific variants. Record only a variant shown by the active catalog.
- The renderer creates `.opencode/agents/ps-*.md` and appends `#<variant>` to the model only when a variant was verified.
- OpenCode loads root `AGENTS.md`; `opencode.json` can add more instruction sources but is unnecessary here.
- Docs: https://opencode.ai/docs/models, https://opencode.ai/docs/agents, and https://opencode.ai/docs/rules

## Claude Code

- Use the model picker or official model catalog and record a full model ID or supported alias.
- Reasoning levels are separate `effort` values. The renderer creates `.claude/agents/ps-*.md` with separate `model` and `effort` fields.
- Root `CLAUDE.md` must import `@AGENTS.md`.
- Docs: https://code.claude.com/docs/en/model-config, https://code.claude.com/docs/en/sub-agents, and https://code.claude.com/docs/en/memory
