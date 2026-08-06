---
type: Spec
title: "Task mode Vertical Slice 1 — Guided planning"
description: "Delivered child slice for creating a Guided Task and advancing through Clarify, Research, Design, and approved Plan in the conversation-first Task mode UI."
status: Implemented
acceptance_status: In progress
approved_at: 2026-08-01T00:00:00Z
tags: [specs, task-mode, task-workspaces, guided, planning, conversations, recovery]
timestamp: 2026-08-06T16:20:00Z
parent: /specs/2026-08-01-task-mode-design.md
---

# Task mode Vertical Slice 1 — Guided planning

## Status

**Implemented on `main`.** This delivered the current Guided planning foundation through approved
Plan. It is no longer the end of the current implementation: [Vertical Slice 2](/specs/2026-08-03-task-mode-slice-2-guided-implementation-plan.md)
now continues the same product path through completed Implement.

Provider-backed acceptance is tracked cumulatively with Guided implementation in
[#64](https://github.com/gannonh/kata-code/issues/64). This open evidence does not change the merged
implementation status and no longer gates code that has already landed.

The complete Task surface remains development-only behind `FF_TASK_MODE=1`.

## Outcome

A user creates a Guided Task from the New task form, selects repository, worktree timing, provider,
model, and provider-owned options, and works through fresh Clarify, Research, Design, and Plan
conversations. Kata persists each stage artifact, advances automatically, and pauses for Plan
approval or requested changes. The canonical Task URL remains stable throughout.

## Implemented scope

- Environment-scoped Task creation and immutable Task slug.
- Inline brief, repository, base ref, worktree timing, provider instance, model, and model options.
- Transactional Task persistence, command and operation receipts, durable outbox, and restart
  reconciliation.
- Server-authoritative repository resolution and planning-root checks.
- Guided `guided@0.2.0` planning path through approved Plan.
- Automatic primary conversation creation for Clarify, Research, Design, and Plan.
- Trusted provider stage instructions, authorized Task context, and typed completion proposals.
- Artifact handoffs and repeatable Plan request-changes occurrences.
- Conversation-first Task route with compact workflow and artifact presentation.
- Explicit Starting, Failed, Retry, offline, and repair states.

## Slice boundary

This slice itself ends at approved Plan. It does not claim Implement, checks, checkpoints,
amendments, resulting commit, Verify, or delivery as Slice 1 outcomes.

That historical boundary does not describe the present product ceiling. Slice 2 subsequently added
`guided@0.3.0`, explicit upgrade/start, and Guided Implement. The current
[Task mode parent](/specs/2026-08-01-task-mode-design.md) is authoritative for cumulative behavior.

Pre-reset artifact editors, manual session linking, raw context-manifest controls, and deterministic
fixture actions remain compatibility/test infrastructure rather than the current default surface.

## Acceptance criteria

1. A user can create a Guided Task with valid title, slug, brief, repository, base ref, worktree
   policy, eligible provider, model, and available model options.
2. The created Task opens at `/tasks/$environmentId/$taskId` and keeps that URL through handoffs and
   reload.
3. Kata automatically starts Clarify and advances completed output through Research, Design, and
   Plan without manual session linking.
4. Each stage uses pinned trusted instructions and authorized context, and persists one readable
   artifact only after the provider turn settles.
5. Plan output opens a human gate for the exact occurrence and revision. Approve and Request changes
   reject stale or conflicting commands.
6. Request changes preserves the reviewed Plan, records feedback, and starts a distinct Plan
   continuation occurrence.
7. Plan approval records resolved actor and server time, applies selected worktree policy, and keeps
   the approved Plan readable. Implement behavior is owned by later workflow versions.
8. Reload, reconnect, and retry preserve Task, occurrence, artifact, gate, session, and operation
   identity without duplicate work.
9. Planning-root drift and unsupported providers fail visibly before accepting stage output.
10. The default surface contains active conversation and compact Task context without raw session,
    manifest, credential, token-budget, fixture, or future-stage controls.

## Verification status

Automated contract, server, store, browser, and repository gates shipped with the implementation.
The cumulative credentialed form-driven scenario lives in
`e2e/tests/task-workspaces/slice-4.spec.ts`; the filename reflects repository history rather than
current vertical-slice numbering.

The merged Slice 2 validation reached active Implement with real Clerk/Codex credentials and
preserved the planning path. The remaining real-provider checkpoint, amendment, restart,
adversarial isolation, and exact-commit proof is tracked in
[#64](https://github.com/gannonh/kata-code/issues/64). Until that issue closes,
`acceptance_status` remains **In progress**.

## Relationship to Agent Runtime convergence

The next proposed [Agent Runtime convergence slice](/specs/2026-08-06-task-mode-agent-runtime-convergence.md)
does not rewrite Slice 1 planning state or artifacts.

- Task planning stages remain Task-owned primary sessions.
- Existing `guided@0.2.0` and `guided@0.3.0` records remain unchanged.
- The first fleet integration targets Guided Implement and Standard chat, not planning-stage
  delegation.
- A future planning-delegation slice may use the same Agent Runtime only after explicit approval.

This preserves the proven planning foundation while allowing implementation execution to converge
with Standard-mode subagents.

## Historical substrate

Earlier delivery records retained or replaced by this slice:

- [Pre-reset Slice 1 walking skeleton](/specs/archive/2026-07-28-task-workspaces-slice-1-plan.md)
- [Pre-reset Slice 2 artifact workspace](/specs/archive/2026-07-29-task-workspaces-slice-2-plan.md)
- [Pre-reset Slice 3 workflow presets](/specs/archive/2026-07-30-task-workspaces-slice-3-plan.md)
- [Pre-reset Slice 4 Build/checkpoint substrate](/specs/archive/2026-07-30-task-workspaces-slice-4-plan.md)

They remain implementation history. This child record and the current parent govern Slice 1
behavior.

## Subsequent work

1. [Vertical Slice 2: Guided implementation](/specs/2026-08-03-task-mode-slice-2-guided-implementation-plan.md)
   — **Implemented on `main`**.
2. [Shared Agent Runtime and Guided delegation](/specs/2026-08-06-task-mode-agent-runtime-convergence.md)
   — **Draft; proposed next slice**.
