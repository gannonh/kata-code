---
type: Spec
title: "Task workspaces Slice 1 — Standard walking skeleton"
description: "Child implementation plan for the first autonomous vertical slice: create a durable Standard task workspace, approve a plan, provision one worktree, apply a deterministic fixture change, verify the exact commit, and sign off as Verified."
status: Verified
approved_at: 2026-07-28T10:00:00-07:00
verified_at: 2026-07-29T16:42:27Z
tags: [specs, task-workspaces, workflows, orchestration, verification, web, server]
timestamp: 2026-07-28T10:00:00-07:00
parent: /specs/2026-07-28-task-workspaces-vertical-slices-design.md
---

# Task workspaces Slice 1 — Standard walking skeleton

## Status

**Verified.** Merged to `main` via [PR #51](https://github.com/gannonh/kata-code/pull/51)
(`a660027c`). This child spec remains authorized only for Slice 1 and does not approve any
later slice.

## Outcome

A person can create one Standard task bound to one existing local repository, move through
Questions, Plan, Build, and Verify, and sign off a commit-specific result. The task remains
available after a server restart. Deliver is visible but unavailable.

The slice proves the smallest real task-workspace path without replacing the existing thread,
provider-session, Git, or worktree systems.

## Scope

### Included

- Create a Standard task with title, project, repository root, base ref, and the
  `before-build` approval policy.
- Persist task commands as an append-only event log and rebuild the current snapshot from that
  log on startup.
- Expose typed task commands and a snapshot-plus-live-update WebSocket stream.
- Keep plural task collections and explicit contract/version fields from the parent design.
- Link existing orchestration threads to task stages as task sessions.
- Save versioned Questions, Plan, and Verification artifact revisions.
- Require Questions completion before Plan and Plan approval before Build.
- Provision one worktree through the existing Git workflow service.
- Apply one deterministic fixture change and commit it in the task worktree.
- Track one Build phase, one work item, and one acceptance criterion using server-owned state.
- Verify the fixture against the exact resulting commit SHA.
- Require passing commit-specific evidence before Verify signoff.
- Show the task list in the existing sidebar and a dedicated task workspace route.
- Show Deliver as unavailable after signoff.

### Excluded

- Automatic extraction of Questions or Plan artifacts from provider output.
- Creating or steering provider sessions from task commands.
- Multiple repositories, multiple workflow presets, comments, artifact block anchors, plan
  amendments, phase checkpoints, GitHub issue intake, pull-request delivery, and provider
  parity hardening.
- Editing the existing thread projection schema to make a thread itself own task state.

These exclusions remain assigned to later parent-spec slices.

## Architecture decisions

### 1. Separate task aggregate beside orchestration threads

Slice 1 adds a focused task-workspace service rather than extending every existing thread
projection table. A task references existing `ThreadId` values for sessions and delegates
worktree creation to the existing Git workflow service. This keeps task state authoritative
without destabilizing the mature chat projection path.

### 2. Append-only durable event log

The server writes one schema-validated NDJSON event for every accepted command. Each event
contains the resulting task snapshot, command ID, sequence, and timestamp. Startup replay
reconstructs task snapshots and accepted-command receipts. Duplicate command IDs return the
original receipt and do not repeat side effects.

This is an intentionally small Slice 1 persistence implementation. A later hardening slice may
move the aggregate into the shared SQL event store without changing the public task contract.

### 3. Structured task-control transport

Task progression uses a typed command union over the existing Effect RPC/WebSocket transport.
Markdown remains artifact content only; it never controls workflow state. The command surface
is provider-neutral and can later be exposed to agent tools without changing the reducer.

### 4. Existing threads are linked sessions

A task can link an existing thread to any current stage. Slice 1 does not automatically create
or prompt sessions because that would couple the walking skeleton to provider-specific runtime
behavior. Later slices can automate session creation and artifact emission through the same
server command surface.

### 5. Deterministic Build fixture

Build creates and commits `task-workspace-slice-1.txt` with canonical content. This gives the
slice a reproducible repository mutation and a stable acceptance criterion without pretending
to implement arbitrary agent-authored changes.

### 6. Exact-SHA verification

Verify records the current worktree HEAD and passes only when it equals the Build result SHA and
the fixture content matches. Signoff rejects missing, failed, or stale results.

## Command and transition rules

| Command                           | Required stage | Result                                                                |
| --------------------------------- | -------------- | --------------------------------------------------------------------- |
| `task.create`                     | none           | Creates a Questions-stage Standard task.                              |
| `task.session.link`               | current stage  | Links an existing thread to a task stage.                             |
| `task.artifact.upsert`            | matching stage | Appends a revision to Questions, Plan, or Verification.               |
| `task.questions.complete`         | Questions      | Requires a Questions artifact; advances to Plan.                      |
| `task.plan.approve`               | Plan           | Requires a Plan artifact; provisions worktree and advances to Build.  |
| `task.build.work-item.set-status` | Build          | Sets the server-owned item to Pending or Running.                     |
| `task.fixture.apply`              | Build          | Commits the deterministic change, completes Build, and enters Verify. |
| `task.verification.run`           | Verify         | Records pass/fail evidence for the exact current commit.              |
| `task.verification.signoff`       | Verify         | Requires every criterion to pass at the Build SHA; enters Verified.   |

Invalid transitions fail loudly and leave the task unchanged.

## Implementation phases

### Phase A — Contracts and durable reducer

- Add task IDs, stages, repositories, workflow runs, sessions, artifacts, Build hierarchy,
  criteria/results, commands, events, snapshots, and errors to `packages/contracts`.
- Add task RPC methods to the shared RPC group and environment API.
- Implement restart-safe replay, idempotent command receipts, invariants, and live events in
  the server task-workspace service.

### Phase B — Git-backed Standard flow

- Resolve a task's single project/repository binding.
- Provision a worktree from the selected base ref after Plan approval.
- Apply and commit the deterministic fixture.
- Verify fixture contents and HEAD against the recorded Build SHA.

### Phase C — Web workspace

- Add task snapshot synchronization and a dedicated task store.
- Add `/tasks/new` and `/tasks/$taskId` routes.
- Add a Tasks section in the existing sidebar.
- Render stage controls, repository/worktree state, linked sessions, artifact revisions, Build
  status, verification evidence, signoff, and unavailable Deliver state.

### Phase D — Validation and evidence

- Unit-test contract decoding and client snapshot/upsert behavior.
- Integration-test complete server progression, restart replay, duplicate command idempotence,
  invalid transitions, and stale/missing evidence rejection.
- Run repository checks and targeted task tests.
- Manually exercise the path in a temporary Git repository and capture the required evidence.

## Acceptance criteria

1. A Standard task can be created from the UI with one project, repository root, base ref, and
   before-Build approval policy.
2. The task opens at Questions and shows explicit Questions, Plan, Build, Verify, and Verified
   stages.
3. Questions and Plan save immutable numbered revisions.
4. Questions cannot complete without a Questions artifact.
5. Plan cannot be approved without a Plan artifact.
6. Plan approval provisions a distinct worktree and records its branch/path.
7. The Build phase and work item status are server-owned and visible.
8. Applying the fixture creates a real Git commit and records its full SHA.
9. Verify records criterion status, summary, timestamp, and the exact tested SHA.
10. Signoff is rejected until all criteria pass at the Build result SHA.
11. Successful signoff moves the task to Verified and shows Deliver as unavailable.
12. Reloading or restarting reconstructs the same task, revisions, worktree binding, Build SHA,
    and verification evidence.
13. Reusing a command ID does not create another revision, worktree, commit, or event.
14. An invalid transition returns a typed error and leaves the persisted snapshot unchanged.
15. A linked existing thread is shown as a stage session without changing normal chat behavior.

## Required evidence

The PR must include or link:

- a short screen recording of task creation through Verified;
- screenshots of the created task, approved Plan/worktree, Build commit, and final Verify result;
- command output showing the worktree branch, fixture commit SHA, file contents, and clean status;
- automated test output for contract/store behavior and server progression/restart/idempotence;
- `vp check`, `vp run typecheck`, `vp run test`, and `vp run release:smoke` results;
- an acceptance-criterion matrix naming the automated assertion or manual evidence for every
  criterion above;
- negative evidence for duplicate command IDs, invalid stage transitions, and signoff before a
  passing exact-SHA result.

## Risks and safeguards

- **Task and thread state drift:** task sessions store stable thread IDs only; thread content
  remains owned by orchestration.
- **Partial Git side effects:** the command reducer serializes commands, records task state only
  after Git work succeeds, and makes command receipts durable with accepted events.
- **Stale verification:** every result includes a commit SHA and signoff compares it with the
  current Build result SHA.
- **Contract expansion pressure:** plural collections and explicit versions are present now,
  while unsupported behaviors remain unavailable rather than represented by temporary booleans.
- **Temporary storage implementation:** the public contract and append-only semantics are kept
  independent from the NDJSON storage adapter so later SQL migration remains possible.

## Completion rule

Slice 1 is complete only when all acceptance criteria are evidenced, required checks pass, the
temporary source/tooling workflow has been removed, and the draft pull request contains a
reproducible validation record. The PR remains pending user signoff.
