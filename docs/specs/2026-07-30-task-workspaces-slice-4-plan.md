---
type: Spec
title: "Task workspaces Slice 4 — Hierarchical Build, checkpoints, and plan amendments"
description: "Child implementation plan for the fourth autonomous vertical slice: make Build hierarchical, resumable, checkpointed, and explicit about reviewed plan amendments when implementation reality diverges from the approved plan."
status: Draft
tags: [specs, task-workspaces, build, checkpoints, amendments, recovery, web, desktop]
timestamp: 2026-07-30T00:00:00Z
parent: /specs/2026-07-28-task-workspaces-vertical-slices-design.md
base_sha: cf95a03c9c658d3677fc85d46d486a4ecfda57ae
---

# Task workspaces Slice 4 — Hierarchical Build, checkpoints, and plan amendments

## Status

**Draft.** This child spec is based on the stabilized Slice 3 result. It is ready for
adversarial scope review; implementation starts only after the spec is Approved.

The parent spec delegates child-slice planning through a draft PR, but does not authorize
merging or human acceptance. This plan stays inside the parent Slice 4 boundary and does not
revise a locked parent decision.

## Outcome

A person can approve a Plan containing multiple Build phases, work items, and check policies;
watch Build progress through a hierarchical projection; pause and resume at explicit
checkpoints; and recover the exact phase/work-item state after a restart. When a deterministic
check shows that the approved Plan no longer matches the codebase, the task stops at a visible
amendment gate. The person reviews the proposed Plan diff, approves it, and resumes only the
affected work items. Earlier Plan revisions, checks, checkpoints, sessions, and events remain
inspectable.

The implementation is provider-neutral. A provider receives task-control state and commands;
it cannot silently complete a mismatched work item or mutate an approved Plan.

## Base and prerequisites

- **Parent:** [/specs/2026-07-28-task-workspaces-vertical-slices-design.md](/specs/2026-07-28-task-workspaces-vertical-slices-design.md)
  ([Slice 4 section](/specs/2026-07-28-task-workspaces-vertical-slices-design.md#slice-4--hierarchical-build-checkpoints-and-plan-amendments))
- **Prerequisite:** Slice 3 workflow presets and context budgeting, merged as
  `cf95a03c9c658d3677fc85d46d486a4ecfda57ae` (PR #62 squash merge; includes the Slice 3a/3b
  implementation and post-merge stabilization).
- **Earlier prerequisite:** Slice 2, merged as `25ce0cc1`.
- **Planning branch:** `agent/task-workspaces-slice-4-plan`.
- **Child-spec path:** `docs/specs/2026-07-30-task-workspaces-slice-4-plan.md`.

## Current-state research

Research was performed against the stabilized Slice 3 tree at the base SHA above.

### Contracts and persisted aggregate

- `packages/contracts/src/taskWorkspace.ts` defines the durable aggregate and all task-control
  commands/events. `TaskWorkspaceBuildPhase` currently has only `id`, `title`, `status`, and
  `workItems`; `TaskWorkspaceWorkItem` has only `id`, `title`, `status`, and `summary`.
- `TaskWorkspace.build` currently stores `phases` and one `resultingCommitSha`. There is no active
  phase, checkpoint, check record, amendment, plan-revision linkage, invalidation reason, or
  continuation-session reference.
- The command union includes `task.build.work-item.set-status` and the deterministic
  `task.fixture.apply`, but no phase-control, check, checkpoint, amendment, or resume commands.
- The event union mirrors the command union. Events persist a complete task snapshot in the
  existing append-only NDJSON envelope, so additive schema defaults can replay Slice 1–3 events.
- `TaskWorkspaceArtifactKind` currently includes `questions`, `research`, `design`, `plan`,
  `verification`, and `summary`. Slice 4 adds `amendment`; the existing Plan artifact remains
  the source of truth for plan revisions.

### Server reducer and storage

- `apps/server/src/taskWorkspace/TaskWorkspaceService.ts` owns command validation, aggregate
  mutation, idempotent `commandId` receipts, append-only persistence, replay, and the event
  stream.
- `initialTask` seeds one deterministic fixture phase and one work item. Slice 4 must preserve
  that fixture as a compatibility default while allowing a Plan artifact to define multiple
  phases and work items.
- `task.plan.approve` currently provisions the first repository worktree and advances the pinned
  workflow to Build. `task.build.work-item.set-status` updates one item; `task.fixture.apply`
  marks every phase/item complete and commits a fixed fixture file. Slice 4 replaces the
  all-items completion shortcut with phase/item/check state transitions while retaining a small
  deterministic fixture adapter for CI and UAT.
- `readPersistedEvents` and `append` already provide restart recovery, ordered sequence numbers,
  and idempotency. New state must be represented in the task snapshot before the event is
  appended; no second mutable Build database is introduced.

### Workflow and context boundaries

- `apps/server/src/taskWorkspace/workflowDefinitions.ts` resolves the task's pinned workflow and
  keeps stage transitions table-driven. Slice 4 retains the existing Plan → Build → Verify
  transition and adds Build controls as stage-local commands, not new workflow stages.
- `packages/shared/src/taskWorkspacePresets.ts` is the client runtime projection of preset
  capabilities. Slice 4 does not move behavior back into the schema-only contracts package.
- Slice 3 context manifests already record selected block ids, estimates, budgets, and summary
  provenance. Continuation sessions reuse that mechanism instead of copying entire transcripts.

### Web, desktop, and tests

- `apps/web/src/components/taskWorkspace/TaskWorkspaceView.tsx` currently renders one Build card
  with a single work item, a Start work button, and the deterministic fixture action. It is the
  shared web/desktop surface and the correct place to extract a reusable Build panel.
- `apps/web/src/components/taskWorkspace/ArtifactsPanel.tsx`, `SessionsPanel.tsx`,
  `ContextManifestPanel.tsx`, and `CommentsPanel.tsx` already provide the surrounding artifact,
  session, context, and review surfaces that the Build panel must link to.
- `apps/server/src/taskWorkspace/TaskWorkspaceService.test.ts` contains the Standard,
  Guided, Freeform, replay, worktree, and context-budget regression suites. New reducer tests
  belong there or in focused neighboring files.
- `apps/web/src/components/taskWorkspace/*.browser.tsx` and
  `e2e/tests/task-workspaces/slice-3.spec.ts` provide the existing browser and desktop harness.
  Slice 4 extends the cumulative `@task-workspaces` path rather than creating a disconnected
  mock application.

## User-visible scenario

The deterministic UAT fixture uses a Standard task and a Plan with two phases:

1. Create a task and save a Plan containing **Prepare** and **Implement** phases. Prepare has a
   passing automated check and an `always` checkpoint. Implement has one work item, one
   automated check, and a `never` checkpoint.
2. Approve the Plan. The worktree is provisioned once, Build opens with the phase tree, and the
   current phase/work-item/check statuses are visible.
3. Run Prepare. Its work item and check pass; the task pauses at a visible checkpoint. The
   Continue control records the checkpoint decision and starts a continuation session with a
   context manifest containing the approved Plan revision and Build state.
4. Start Implement. The deterministic fixture check observes a planned file/content mismatch.
   The work item becomes `blocked`, the check records `fail`, and no completion command is
   accepted.
5. Request an amendment with expected value, found value, impact, and proposed change. The
   task writes an `amendment` artifact and shows the Plan revision diff at an approval gate.
6. Approve the amendment. The approved Plan revision is appended; the affected work item and
   downstream checks become `invalidated`; completed Prepare history remains unchanged.
7. Resume from the checkpoint. Implement runs against the amended Plan, the check passes, and
   Build completes. Restart the server during the flow and confirm the phase, item, check,
   checkpoint, amendment, Plan revision, and continuation session recover exactly.

The same controls support manual checks: a person can record pass, fail, or blocked with a
short note. Manual results never masquerade as automated command output.

## Scope

### Included

- Hierarchical Build projection with ordered phases, work items, dependencies, statuses, and
  phase-local checks.
- Configurable checkpoint policies: `always`, `manual-only`, `on-failure`, and `never`.
- Provider-neutral commands/events for phase control, work-item control, check execution/result,
  checkpoint continuation, amendment request/approval, and Build resume.
- Automated and manual check records with status, output/note, exit code where applicable,
  observed commit, and timestamps.
- Amendment artifact, approved Plan revision diff, approval gate, affected-item invalidation,
  and resume semantics.
- Continuation sessions linked to context manifests and checkpoint state.
- Additive replay/migration defaults for all Slice 1–3 task events and snapshots.
- Shared web/desktop Build panel, browser coverage, cumulative desktop E2E, UAT screenshots,
  recording, command logs, and adversarial evidence review.
- Optional phase commit references when the configured repository operation produces them.

### Excluded

- Commit-specific verification/evidence browser beyond the existing Slice 3 verification path
  (Slice 5 owns the full criterion browser and delivery guard).
- Multiple repositories, GitHub source intake, setup commands, and source refresh (Slice 6).
- Draft PR creation, push orchestration, or delivery (Slice 7).
- Provider-specific prose parsing, provider-specific checkpoint protocols, or new credentials.
- User-authored workflow definitions or arbitrary user code execution as a check.
- Automatic Plan mutation, silent work-item completion, or destructive deletion of prior
  revisions/history.

## Architecture and contract decisions

### 1. Build is an aggregate projection, not a second workflow

Build remains inside `TaskWorkspace.build`; the workflow definition still owns stage transitions.
Phase/work-item/check commands are legal only while the pinned workflow is in `build`. A phase
completion never changes the workflow stage by itself. Existing `task.fixture.apply` becomes a
deterministic test adapter that advances the selected work item through the same check gates.

### 2. Hierarchy and statuses

`TaskWorkspaceWorkStatus` widens additively to:

```text
pending | running | completed | blocked | invalidated
```

Each phase records ordered work items, check ids, checkpoint policy, status timestamps, and an
optional phase commit SHA. Work items record dependencies, check ids, invalidation reason, and
summary. A phase is `completed` only when every required work item and check passes; `blocked`
or `invalidated` children prevent completion. A parent status is derived and persisted in the
snapshot so the UI does not infer state differently after restart.

### 3. Check records are explicit and typed

Each `TaskWorkspaceBuildCheck` records:

- `id`, `phaseId`, and optional `workItemId`;
- `kind: automated | manual`;
- `status: pending | running | pass | fail | blocked`;
- `label`, `command` (automated only), `output`/`note`, and optional `exitCode`;
- observed `commitSha`, `startedAt`, and `completedAt`.

Automated checks are selected from a server-owned allowlisted fixture/check registry in Slice 4;
the provider cannot submit an arbitrary shell command through the task contract. Manual checks
require a person-authored note and never receive an exit code by inference.

### 4. Checkpoint policy and continuation

Every phase has one policy:

- `always`: pause after the phase's required work/checks pass;
- `manual-only`: require an explicit Continue command at the phase gate even when checks pass;
- `on-failure`: continue on passing checks, pause when a required check fails or is blocked;
- `never`: continue automatically after passing checks.

A `TaskWorkspaceCheckpoint` records phase, reason, state (`waiting | continued`), check ids,
created/continued timestamps, and the continuation session id. `task.build.resume` is the only
command that moves a waiting checkpoint forward. A continuation session is linked through the
existing session contract and receives a manifest containing the current Plan revision and
relevant Build blocks.

### 5. Amendments are append-only gates

`task.amendment.request` validates the current Plan revision and creates an `amendment` artifact
with:

- triggering phase/work item/check;
- expected, found, impact, and proposed changes;
- affected phase/work-item/check ids;
- base Plan revision id and status `requested`.

`task.amendment.approve` computes and stores a Plan revision diff, marks the amendment `approved`,
and invalidates only the affected work plus dependent downstream checks. It never edits an older
Plan revision in place. A future rejection action is out of Slice 4; the visible gate remains
blocked until approval or an explicit task error/recovery path.

### 6. Command and event names

The contracts add these control-plane commands and matching event types:

```text
task.build.phase.start
task.build.work-item.set-status              (extend existing command)
task.build.check.run
task.build.check.record-manual
task.build.checkpoint.continue
task.amendment.request
task.amendment.approve
task.build.resume
```

All commands retain `commandId`, `taskId`, and `createdAt`; duplicate command ids return the
original receipt. Human-facing artifacts contain descriptions and evidence, never these mutable
command names.

### 7. Versions, replay, and migration

Newly created tasks use `task-workspace@0.2.0` and `task-artifact@0.2.0`; the pinned workflow and
prompt versions remain unchanged. Existing snapshots/events decode with defaults:

- one legacy phase named `phase-1` with the existing fixture work item;
- `checkpointPolicy: never`;
- empty checks, checkpoints, amendments, and continuation references;
- no active phase and no amendment gate.

The event envelope and NDJSON file remain unchanged. Replay must preserve old sequence numbers,
command receipts, Plan revisions, and Slice 3 context manifests. No persisted task is deleted or
rewritten in place. A migration report is emitted by the focused replay test when a legacy
snapshot is normalized in memory.

## UI behavior

Extract a shared `BuildPanel` from `TaskWorkspaceView.tsx`.

- **Phase tree:** ordered phases with policy badge, status, current marker, work-item counts,
  check summary, and optional phase commit SHA.
- **Work item row:** title, dependency status, status badge, summary, Start/Complete controls,
  and invalidation reason. Complete is disabled while required checks are pending, failed, or
  blocked.
- **Checks:** automated Run control and output/exit-code display; manual Record result control
  requiring pass/fail/blocked plus note. Failed output is never hidden.
- **Checkpoint:** waiting card with reason, completed checks, Continue/Resume action, and the
  continuation session/context-manifest link.
- **Amendment gate:** expected/found/impact/proposed fields, affected items, Plan revision diff,
  Approve amendment action, and an explicit blocked state until approval.
- **Restart state:** after rehydration, the same phase/item/check/checkpoint/amendment statuses
  render from the server snapshot without client-only optimistic completion.
- **Accessibility:** status uses text and badges in addition to color; disabled actions explain
  the unmet check or gate; all controls have stable `data-testid` values for browser/E2E tests.

Web and desktop use the same component and command hook. Mobile remains on its ordinary-thread
fallback and receives no new required surface in this slice.

## Implementation sequence

1. **Contract groundwork:** add additive schemas/types for checks, checkpoints, amendment state,
   Plan diffs, phase policies, dependencies, invalidation, and new commands/events; add decoding
   defaults and bump contract versions.
2. **Projection helpers:** add pure server functions that derive phase/item status, required
   checks, checkpoint eligibility, affected-item invalidation, and Plan diffs.
3. **Reducer controls:** implement idempotent phase/work-item/check/checkpoint/amendment/resume
   commands in `TaskWorkspaceService`; preserve fixture behavior through the allowlisted adapter.
4. **Plan parser and initialization:** parse the approved Plan artifact into ordered phases,
   work items, dependencies, checks, and policies at `task.plan.approve`; reject ambiguous or
   malformed plans before provisioning.
5. **Replay and recovery:** add legacy-event fixtures, restart tests during an active phase, at a
   checkpoint, at a failed check, and at the amendment gate.
6. **UI:** extract `BuildPanel`, render hierarchy/checkpoint/amendment states, and connect every
   action to task commands with explicit error handling.
7. **Browser/E2E/UAT:** prove the full deterministic mismatch/amend/resume path and restart path
   through normal product behavior; capture required evidence.
8. **Quality pass:** run focused tests, `vp check`, `vp run typecheck`, `vp run test`, release
   smoke, browser/E2E, fresh-context review, and the repository's required CI checks.

## Acceptance criteria

These stable IDs map to parent TW-AC8, TW-AC9, TW-AC15, and TW-AC16.

1. **TW-S4-AC01 — Hierarchical Plan:** A Plan with at least two phases, multiple work items,
   dependencies, and phase checkpoint policies is accepted and projected in the task aggregate.
2. **TW-S4-AC02 — Phase/work-item control:** Phase and work-item commands are validated against
   the current Build state, idempotent by `commandId`, and cannot complete blocked/incomplete
   children.
3. **TW-S4-AC03 — Checks:** Automated and manual checks persist distinct records with status,
   output/note, observed commit, and the appropriate exit-code semantics.
4. **TW-S4-AC04 — Checkpoints:** `always`, `manual-only`, `on-failure`, and `never` produce the
   documented pause/continue behavior, with a durable checkpoint and continuation session.
5. **TW-S4-AC05 — Restart recovery:** Restart during an active phase, waiting checkpoint, failed
   check, and amendment gate restores the exact phase, item, check, checkpoint, session, and
   Plan revision state.
6. **TW-S4-AC06 — Deterministic mismatch:** A failed fixture check blocks the affected work item
   and prevents silent completion or automatic Build advancement.
7. **TW-S4-AC07 — Amendment artifact and diff:** Requesting an amendment records expected/found/
   impact/proposed values, and approval appends a new Plan revision plus a reviewable diff.
8. **TW-S4-AC08 — Targeted invalidation:** Amendment approval invalidates affected work items and
   dependent checks, preserves completed unaffected history, and exposes the invalidation reason.
9. **TW-S4-AC09 — Resume:** Resume starts a continuation session from the recorded checkpoint
   manifest and allows only invalidated/remaining work to run against the approved Plan revision.
10. **TW-S4-AC10 — Negative proof:** No provider or task-control path can mutate an approved Plan
    in place or mark a mismatched work item complete without an amendment approval event.
11. **TW-S4-AC11 — Compatibility:** All Slice 1–3 Standard/Guided/Freeform and replay tests
    remain green; legacy events receive the documented additive defaults.
12. **TW-S4-AC12 — Shared UX/evidence:** Web and desktop show the same hierarchy, checkpoint,
    failed-check, amendment, diff, invalidation, resume, and recovery states, with a cumulative
    desktop E2E scenario and evidence package covering every criterion.

## Automated test matrix

| Area               | Tests                                                                                                    | Proof                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Contracts          | schema round trips, command/event unions, legacy decoding, invalid status/policy combinations            | New `packages/contracts/src/taskWorkspace.test.ts` cases               |
| Projection helpers | phase derivation, dependencies, required checks, checkpoint policy, diff/invalidation                    | Pure server unit tests                                                 |
| Reducer            | command idempotency, phase gates, automated/manual checks, mismatch, amendment approval, targeted resume | `TaskWorkspaceService.test.ts`                                         |
| Replay             | Slice 1–3 fixtures, restart at each recovery boundary, sequence/receipt preservation                     | Persisted NDJSON fixtures and service tests                            |
| Web browser        | phase tree, check output, checkpoint, amendment diff, disabled completion, resume state                  | `TaskWorkspaceView.browser.tsx` or focused Build panel browser tests   |
| Desktop E2E        | create → approve → checkpoint → mismatch → amendment → resume → verified; restart during Build           | `e2e/tests/task-workspaces/slice-4.spec.ts`, tagged `@task-workspaces` |
| Repository gates   | formatting/lint, typecheck, full tests, release smoke, required CI jobs                                  | CI run linked in the PR                                                |

## UAT and evidence plan

Evidence is generated under `uat-evidence/<target>-<YYYYMMDD-HHMMSS>/` and references product
code SHA `cf95a03c9c658d3677fc85d46d486a4ecfda57ae` or the final implementation SHA.

Required recording path:

1. initial two-phase Plan and approval;
2. phase 1 completion and checkpoint pause;
3. continuation session and manifest;
4. failed deterministic check and blocked work item;
5. amendment request, artifact, Plan diff, and approval;
6. affected-item invalidation and resume;
7. restart recovery and final Build completion.

Required screenshots: initial Build tree, active phase, checkpoint controls, failed check output,
amendment detail, Plan diff, invalidated item, resumed state, and recovered state after restart.

Required outputs/logs: original Plan revision, amendment artifact, amended Plan revision, Build
projections before/after, checkpoint and check records, continuation context manifest, task
command transcript with exit codes, server restart log, and Git history when phase commits are
enabled. A secret/path scan runs before publishing evidence.

The adversarial evidence review must mark every TW-S4 criterion Pass, Fail, or Blocked and cite
an exact evidence path. A missing provider credential or unavailable infrastructure remains
Blocked and is reported as such; it is not converted into a pass.

## Failure, recovery, security, and rollback

- **Command failure:** append no partial task snapshot; return a typed `TaskWorkspaceError` with
  the command type and task id. Retrying the same `commandId` returns the prior receipt.
- **Check failure:** persist output and status `fail`; leave the work item blocked and expose a
  retry or amendment path. Never auto-mark it completed.
- **Restart/crash:** replay the last durable event. A checkpoint remains waiting until an
  explicit Continue/Resume command is accepted.
- **Amendment failure:** preserve the requested amendment and old Plan; no revision is appended
  until approval has validated the base revision and affected ids.
- **Stale approval:** reject approval against a Plan revision other than the amendment base;
  require a new amendment request.
- **Filesystem/Git failure:** leave the phase/check status and error output visible; do not claim
  a phase commit or resulting commit SHA that was not observed.
- **Security:** automated checks come from a server allowlist; command strings and outputs are
  redacted before persistence where the existing task redaction policy requires it. No provider
  credential, token, or secret is accepted in a task artifact, check note, amendment field, or
  evidence package.
- **Rollback:** the implementation is additive at the event/schema boundary. Reverting the
  implementation leaves old events readable by the prior build; any new Slice 4 task remains a
  visible migration/compatibility concern and is not silently deleted.

## Adversarial review checklist

Before changing this spec to **Approved**, a fresh-context reviewer must inspect:

- whether phase/work-item/check state is fully event-sourced and restart-safe;
- whether every new command is gated by the pinned workflow and idempotent;
- whether Plan revisions and amendment diffs can be mutated or bypassed;
- whether invalidation is targeted and preserves unaffected history;
- whether automated checks can execute arbitrary commands or leak secrets;
- whether old Slice 1–3 snapshots decode with deterministic defaults;
- whether the UI and evidence plan prove every parent and child criterion;
- whether the scope accidentally pulls in Slice 5 verification, Slice 6 source intake, or Slice 7
  delivery behavior.

Blocking findings must be incorporated or rebutted with evidence in this section. Delegated
approval can be recorded only after that review passes and no unresolved product decision
remains.

## PR handoff and deferred work

The implementation PR must:

- use a dedicated branch from `cf95a03c9c658d3677fc85d46d486a4ecfda57ae`;
- include the acceptance matrix, test commands/results, UAT/evidence links, known gaps, manual
  reproduction steps, rollback notes, and `Recommendation: Pending user sign-off`;
- keep commits atomic and conventional; separate any incidental fix into its own commit/PR;
- remain a draft until implementation, evidence, and fresh-context review are complete.

Deferred to later slices: full criterion/evidence browser and delivery guard (Slice 5), multiple
repositories/source setup (Slice 6), draft PR delivery (Slice 7), and provider-parity hardening
(Slice 8). User-authored checks, arbitrary shell commands, rejection/revision editing UX, and
automatic phase commits beyond an optional reference are explicitly outside this slice.

**Recommendation: Pending user sign-off.**
