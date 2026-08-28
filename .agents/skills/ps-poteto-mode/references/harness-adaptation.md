# Harness adaptation

P-Stack describes work in terms of capabilities instead of product-specific tool calls.

## Delegation

When a workflow calls for a subagent, use the current harness's delegation mechanism. Start independent tasks concurrently when supported. If the harness has no delegation mechanism, run the lanes sequentially in the current agent and report that the intended independence was unavailable.

Read `.agents/pstack/models.json` from the repository root when it exists. Select the active harness, then resolve the requested role through `role_tiers` to `small`, `medium`, or `large`. Apply the recorded model identifier and reasoning level only when the harness supports child overrides. Do not guess a replacement for a rejected identifier. Use the parent model and record the limitation.

Every delegated task needs a self-contained brief, an output contract, and an access mode. Give concurrent writers separate worktrees, branches, or output directories. The parent owns the final diff, synthesis, and verification.

## User questions

Ask the user through the current harness's available question interface. Prefer structured choices when the harness supports them. Plain text is valid everywhere.

## Skills and tools

Invoke other skills through the current harness's skill mechanism. When a named helper skill is unavailable, perform the stated behavior directly or use an equivalent installed capability. Never silently skip verification because a product-specific helper is absent.

## Transcripts and background work

Use only transcript and task-status locations exposed for the active repository and session. Do not search unrelated global transcript directories. If the harness cannot retain background work or task handles, keep the work in the foreground and state the limitation.
