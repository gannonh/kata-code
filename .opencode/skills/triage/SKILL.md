---
name: triage
description: Use this skill when grooming the Linear backlog or answering what to work on next. Sweeps inbound GitHub Issues into Linear specs. Description-triggered. Never runs automatically from Plan, Build, Review, or Verify.
---

# Triage

Groom the Linear backlog so the roadmap stays readable and every spec issue is in a state Build, Review, or Verify can act on. Sweep inbound GitHub Issues into full Linear specs.

## Read the conventions first

Read `references/conventions.md` completely before any write.

## When to use

- The user asks to groom the backlog or the roadmap.
- The user asks what should we work on next.
- Plan, Build, Review, or Verify reported hygiene findings that need fixing.
- Inbound GitHub Issues need Linear specs.

Triage is on-demand. It never runs automatically. Other phases perform a lightweight read-only hygiene check at phase entry and report findings; fixing them is this workflow's job.

## Triage workflow

Read `references/triage.md` completely and follow it.

Hard gates:

- Report findings before mutating anything.
- Apply tier-1 safe corrections directly. Ask before tier-2 changes. Never do tier-3 work without explicit instruction.
- Never implement from a GitHub Issue.
- Use `gh issue list`, `gh issue view`, and `gh issue comment` only for inbound GitHub sweeping and backlinks. All other status and spec writes use Linear MCP.

## Shared principles

- Linear state is the status. There is no body Status mirror.
- Prefer the next user-facing slice when ranking ready work.
- Surface uncertainty instead of filling gaps with guesses.
