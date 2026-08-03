---
type: Spec
title: "Task mode Vertical Slice 1 — Guided planning"
description: "Delivered child slice for creating a Guided task and advancing through Clarify, Research, Design, and approved Plan in the conversation-first Task mode UI."
status: Implemented
acceptance_status: In progress
approved_at: 2026-08-01T00:00:00Z
tags: [specs, task-mode, task-workspaces, guided, planning, conversations, recovery]
timestamp: 2026-08-03T22:00:00Z
parent: /specs/2026-08-01-task-mode-design.md
---

# Task mode Vertical Slice 1 — Guided planning

## Status

**Implemented on `main`; provider-backed manual acceptance is in progress.** This is the current
Task mode baseline and the only current product path. It ends at approved Plan.

The implementation was originally delivered inside the Task workflow UX reset work. This child
record separates that shipped slice from the [authoritative Task mode parent design](/specs/2026-08-01-task-mode-design.md)
so future work can proceed through explicit vertical slices.

## Outcome

A user creates a Guided task from the New task form, selects its repository, worktree timing,
provider, model, and model options, and works through fresh Clarify, Research, Design, and Plan
conversations. Kata persists each stage output, advances automatically, and pauses for Plan
approval or requested changes. The canonical task URL remains stable throughout the workflow.

## Implemented scope

- Environment-scoped task creation and immutable task slug.
- Inline brief, repository, base ref, worktree timing, provider, model, and model-option selection.
- Transactional task persistence, command and operation receipts, durable outbox work, and restart
  reconciliation.
- Server-authoritative repository resolution and planning-root checks.
- Guided `guided@0.2.0` workflow through approved Plan.
- Automatic primary conversation creation for Clarify, Research, Design, and Plan.
- Trusted provider stage instructions, task context, and typed stage-completion proposals.
- Artifact handoffs and repeatable Plan request-changes occurrences.
- Conversation-first task route with a compact workflow and artifact panel.
- Explicit Starting, Failed, Retry, offline, and repair states.

## Boundaries

This slice does not start an Implement occurrence, execute the approved Plan, render current-task
Build progress, verify a resulting commit, or deliver a pull request. Those outcomes belong to
later child slices of the parent design.

Pre-reset artifact editors, manual session linking, raw context-manifest controls, and deterministic
fixture actions are compatibility and test infrastructure. They are not part of the current Task mode surface.

## Acceptance criteria

1. A user can create a Guided task through the New task form with a valid title, slug, brief,
   repository, base ref, worktree policy, eligible provider, model, and available model options.
2. The created task opens at `/tasks/$environmentId/$taskId` and keeps that URL through every
   stage handoff and reload.
3. Kata automatically starts Clarify and advances completed output through Research, Design, and
   Plan without manual session linking.
4. Each stage uses its pinned trusted instructions and authorized task context, and persists one
   readable artifact only after the provider turn settles.
5. Plan output opens a human gate for the exact occurrence and revision. Approve and Request
   changes reject stale or conflicting commands.
6. Request changes preserves the reviewed Plan, records feedback, and starts a distinct Plan
   continuation occurrence.
7. Plan approval records the resolved actor and server time, applies the selected worktree policy,
   keeps the approved Plan readable, and starts no Implement occurrence in this slice.
8. Reload, reconnect, and retry preserve task, occurrence, artifact, gate, session, and operation
   identity without duplicate work.
9. Planning-root drift and unsupported providers fail visibly before accepting stage output.
10. The default surface contains the active conversation and compact task context without raw
    session, manifest, credential, token-budget, fixture, or future-stage controls.

## Verification status

Automated contract, server, store, browser, and repository gates were completed with the merged
implementation. The credentialed form-driven scenario lives in
`e2e/tests/task-workspaces/slice-4.spec.ts`; its filename reflects repository history, not the
current slice numbering.

Manual provider-backed acceptance remains open. Current maintainer testing is the acceptance pass
for the real provider, model-option, handoff, and Plan-gate path. Findings from that pass should be
fixed within this slice before Vertical Slice 2 begins.

## Historical substrate

The following delivered earlier infrastructure that this slice retained or replaced:

- [Pre-reset Slice 1 walking skeleton](/specs/2026-07-28-task-workspaces-slice-1-plan.md)
- [Pre-reset Slice 2 artifact workspace](/specs/2026-07-29-task-workspaces-slice-2-plan.md)
- [Pre-reset Slice 3 workflow presets](/specs/2026-07-30-task-workspaces-slice-3-plan.md)
- [Pre-reset Slice 4 Build/checkpoint substrate](/specs/2026-07-30-task-workspaces-slice-4-plan.md)

These are historical delivery records. The current parent design and this child record govern
product behavior and sequencing.

## Next slice

[Vertical Slice 2: Guided implementation](/specs/2026-08-03-task-mode-slice-2-guided-implementation-plan.md)
is the next implementation target. Its Draft child spec requires explicit approval before product
changes begin.
