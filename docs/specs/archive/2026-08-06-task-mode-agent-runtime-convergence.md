---
type: Spec
title: "Task mode and Agent Runtime convergence"
description: "Kata-native design for one durable, same-provider-instance agent runtime with role-specific models, shared by Standard mode and Task mode without inheriting provider-specific orchestration."
recommendation: "Review implementation against the accepted conversation-plus-panel shell plan"
tags: [specs, task-mode, agents, subagents, workflows, orchestration, providers, codex, upstream]
timestamp: 2026-08-06T16:20:00Z
parent: /specs/archive/2026-08-01-task-mode-design.md
related_upstream:
  repository: pingdotgg/t3code
  pull_request: 5219
  merge_commit: a2ca89aa10f13a2222e08afd98c66285121d5ba2
status: Migrated
source_status: proposed
github_issue: 75
migrated: true
archived_at: 2026-08-06T22:05:46Z
---

> **Migrated to #75.** The GitHub Issue is the canonical spec. This file is history and is not maintained.

# Task mode and Agent Runtime convergence

## Status

**Draft; the Task mode shell is accepted, but runtime implementation remains a separate review.**
This remains the proposed next runtime vertical slice in the authoritative [Task mode roadmap](/specs/archive/2026-08-01-task-mode-design.md)
and must preserve the bounded [conversation-plus-panel shell plan](/specs/archive/2026-08-06-task-mode-conversation-panel-shell-plan.md).
The [UX Playground decision](/specs/archive/2026-08-06-task-mode-ux-playground-plan.md) selected Prototype A.
It unifies
Kata-managed subagents, Standard mode, and Task mode under one durable Agent Runtime rather than
creating a parallel provider-specific workflow feature.

Current `main` at `397fe925a` already contains Guided planning and Guided implementation. The
implementation arrived in merge commit `59c0c573b` through `guided@0.3.0`; the Task surface remains
development-only behind `FF_TASK_MODE=1`. Cumulative provider-backed acceptance remains tracked in
[#64](https://github.com/gannonh/kata-code/issues/64).

This document replaces the earlier proposal to port upstream observability as an isolated feature.
Upstream PR [#5219](https://github.com/pingdotgg/t3code/pull/5219) remains source evidence for
lifecycle normalization, fleet UX, background liveness, and failure handling, but not the runtime
architecture Kata adopts.

## Decision

Kata owns child-agent lifecycle.

- A fleet is homogeneous by **provider instance**: the parent and every child use the same
  configured provider instance and credentials.
- A fleet may use different **models and provider options by role**. A high-capability model can
  orchestrate and review while lower-cost models scout or implement.
- Child sessions are Kata-created first-class threads with durable Kata identities, operation
  receipts, cancellation, recovery, and ownership.
- The initial target provider is Codex because current Task mode already implements its model
  catalog, deterministic resume, worktree-write profile, credential isolation, and interruption
  path. The Agent Runtime slice must complete its own conformance and real-provider proof before
  calling Codex conforming. Additional providers require the same suite; no fallback changes
  provider.
- Task mode remains the durable workflow control plane. The Agent Runtime executes and reports;
  only `TaskWorkspaceService` may advance stages, persist artifacts, settle checks, review
  amendments, or complete an occurrence.

## Goal

Ship one end-to-end execution substrate that:

1. lets a Standard conversation delegate bounded work to Kata-managed child agents;
2. lets a Guided Implement orchestrator delegate scouting, implementation, and review to the same
   runtime;
3. selects role-appropriate models without crossing provider-instance boundaries;
4. exposes one Agents surface, aggregate usage, cancellation, and background liveness in both
   modes; and
5. recovers after response loss, reconnect, and process restart without duplicate child threads,
   overlapping writers, or false Task completion.

The first slice is successful when a user can observe and control the same child-run lifecycle in
Standard mode and in a `guided@0.4.0` Implement occurrence, with Task state remaining authoritative.

## Current baseline on `main`

### Delivered Task mode

- Form-created Guided tasks pin `guided@0.3.0` and use the transactional Task aggregate, command and
  operation receipts, completion proposals, and durable outbox.
- Clarify, Research, Design, and Plan run through `TaskStageBridge`; Implement runs through
  `TaskImplementationBridge` and its typed context, progress, check, amendment, and completion
  tools.
- The selected provider and model are pinned to the Task. Guided creation requires
  `supportsTaskWorktreeWrite`.
- Codex implements the server-owned `task-worktree-write` profile with worktree-only writes,
  credential isolation, deterministic resume, bounded turns, and network denial.
- `TaskWorkspaceBootstrapWorker` reconciles deterministic worktree, task session, thread, turn, and
  message identities.
- `GuidedTaskPanel` renders durable phases, work items, checks, attempts, checkpoints, amendments,
  and the resulting commit beside the normal `ChatView`.
- Guided Verify, Done, Deliver, full Standard/Freeform workflows, and native mobile Task UI remain
  deferred.

### Shared runtime seams

- `ProviderAdapter` is the provider-native SPI for start, send, interrupt, stop, requests, thread
  reads, and canonical runtime events.
- `ProviderService` resolves one provider instance, manages the provider session binding, and routes
  Standard and Task turns.
- `ProviderSessionDirectory` persists provider-instance, runtime-mode, resume, payload, and
  last-seen data keyed by thread.
- The orchestration event store, command receipts, projection pipeline, and canonical provider
  ingestion already provide durable command/event machinery for Standard threads.
- `TaskWorkspaceView` already composes the shared conversation with a separate Task authority
  projection.

### Missing shared capability

Kata does not yet have:

- a durable fleet or child-run identity;
- an explicit Standard-versus-Task runtime owner on provider sessions;
- role-based model routing within one provider instance;
- app-owned spawn, wait, result, message, or fleet-stop operations;
- workspace read/write leases between parent and children;
- an Agents projection shared by Standard and Task routes; or
- aggregate child liveness in sidebar, Connect, unread, mobile, and session-reaper decisions.

## Product topology

```text
TaskWorkspaceService (Task workflow authority)
                 │
                 │ owner + policy
                 ▼
          Kata Agent Runtime
       ┌─────────┴─────────┐
       │                   │
Standard thread       Task occurrence
       │                   │
       └─────────┬─────────┘
                 ▼
          ProviderService
                 ▼
        ProviderAdapter SPI
                 ▼
     one configured provider instance
```

The Agent Runtime sits above provider adapters and below Standard and Task product authorities. It
must not become another workflow-definition engine. Task mode owns durable workflows; Standard mode
gets bounded agent-directed delegation without a second workflow DSL.

## Runtime ownership and identity

### Fleet

One `AgentFleet` belongs to exactly one parent execution owner:

```text
AgentFleet
├─ fleetId
├─ environmentId
├─ providerInstanceId
├─ owner
│  ├─ standard: parentThreadId
│  └─ task: taskId + occurrenceId + taskSessionId + parentThreadId
├─ modelPolicy
├─ limits
├─ status
└─ runIds[]
```

A Task fleet is associated with one stage occurrence. A Standard fleet is associated with one
normal parent thread. Ownership is persisted and included in every runtime command and event; raw
thread id is never sufficient authorization.

### Run

Every orchestrator and child execution has a Kata-owned `AgentRunId`. A run records:

- fleet, optional parent run, and thread ids; the orchestrator has no parent run;
- role: `orchestrator | scout | implementer | reviewer`;
- provider instance and resolved `ModelSelection`;
- workspace binding and execution profile;
- request operation key and deterministic external identities;
- status: `requested | waiting-parent | starting | running | waiting | stopping | completed |
failed | stopped`;
- bounded brief, expected output, result summary, and failure;
- provider-native session/turn ids as non-authoritative metadata;
- usage, created/started/settled timestamps, and last observed activity.

The first slice has maximum depth one. Children cannot spawn children.

### Origin

The first slice creates only `origin: "kata"` runs. A later provider adapter may project a
provider-native child as `origin: "provider"` after it proves stable identity, lifecycle,
cancellation, permission, and resume semantics. Provider-native events never allocate Task state or
bypass Agent Runtime authorization.

## Role-based model policy

An `AgentFleetModelPolicy` pins one provider instance and a model selection per role:

```text
providerInstanceId: codex-personal
orchestrator: gpt-high + high reasoning
scout:        gpt-low  + low reasoning
implementer:  gpt-low  + medium reasoning
reviewer:     gpt-high + high reasoning
```

Rules:

1. The orchestrator defaults to the parent thread or Task's existing `ModelSelection`.
2. Each child role defaults to the orchestrator selection but may be explicitly overridden.
3. Every role selection must resolve from the same provider instance's current model catalog.
4. Provider-owned options are decoded and validated through the existing model-option contracts.
5. The parent requests a role, not an arbitrary model. The server resolves the role's pinned
   selection, preventing an agent from silently escalating cost or changing provider.
6. The policy is snapshotted when the fleet is created. Existing runs never change model after
   allocation.
7. Missing, unavailable, or no-longer-supported models fail visibly. There is no provider or model
   fallback.
8. Usage is recorded per run and aggregated by role, model, fleet, parent thread, and Task
   occurrence.

The Task creation form and Standard Agent settings expose an optional **Agent models** section.
Leaving it unchanged uses the parent model for every role. The first implementation should not add
pricing heuristics or automatically choose a model based on marketing names.

## Kata-managed child lifecycle

The initial agent tool surface is deliberately asymmetric:

- parent-only `agent_spawn` requests one or more children by role, bounded brief, expected output,
  and workspace access class; and
- child-only `agent_result` submits a typed completion proposal with summary and optional bounded
  evidence.

Waiting and parent continuation are runtime-owned rather than a synchronous parent tool: children
cannot start until the parent turn is terminal. `agent_message` and `agent_stop` are authenticated
Native API/UI commands, so a user can steer or stop live children without starting a conflicting
parent provider turn.

All handlers derive environment, fleet, parent/child thread, provider instance, owner, workspace,
and capability scope from the leased invocation credential. Model-supplied ids are treated only as
references and revalidated.

### Handoff ordering

A child never starts while its parent has an active provider turn:

1. the parent calls `agent_spawn`;
2. the runtime persists the requested runs and deterministic identities;
3. the tool acknowledges the accepted request;
4. the runtime waits for the canonical parent turn to settle;
5. workspace leases are acquired and children start;
6. each child proposes a typed result and reaches a terminal provider outcome;
7. the runtime settles the run and releases its lease; and
8. one deterministic parent continuation receives bounded child results.

If the parent turn does not settle, the request remains visibly `waiting-parent`; the runtime does
not start a child concurrently or guess from transcript text.

### Workspace leases

The first slice supports two access classes:

- **shared read:** one or more scouts/reviewers may run concurrently against one observed commit;
  no writer or parent turn may run until the read batch settles;
- **exclusive write:** one implementer may run in the canonical workspace while the parent and all
  other children are quiescent.

The lease is server-owned and persisted. Starting a conflicting provider turn fails before adapter
dispatch. Task implementers inherit the `task-worktree-write` profile and canonical Task worktree.
Standard implementers inherit the parent's approved runtime boundary. A process restart reconciles
provider state before reclaiming or releasing a lease.

Parallel write agents and isolated child worktrees are deferred. This serializes writes in the
first slice and avoids speculative merge/cherry-pick machinery.

## Standard mode integration

A Standard conversation can enable an Agent fleet without becoming a Task:

- the current thread is the orchestrator and remains a normal sidebar thread;
- children are hidden from the top-level thread list and appear beneath the parent in the Agents
  panel;
- the parent receives the shared agent tools and a fleet-scoped leased credential;
- child results resume the same parent thread through deterministic continuation messages;
- stopping the parent stops its active fleet before stopping the provider session; and
- no Task occurrence, artifact, gate, check, amendment, or Task credential is created.

The Standard surface provides the smallest end-to-end proof of the runtime independent of Task
workflow policy.

## Task mode integration

### Authority boundary

The relationship is:

```text
Task
└─ Implement occurrence
   └─ primary Task session / orchestrator
      └─ Agent fleet
         ├─ scout runs
         ├─ implementer runs
         └─ reviewer runs
```

The primary Task session remains the sole caller of `TaskImplementationBridge`. Child credentials
never contain `task-stage` or `task-implementation` capabilities. Children receive only their
bounded assignment and Agent Runtime completion capability.

A child may change the Task worktree only while holding the exclusive write lease. After it
settles, the primary orchestrator resumes, observes the worktree, and uses the existing typed Task
tools to record progress, request approved checks, propose an amendment, or propose completion.
Child prose and provider events cannot mutate the Task aggregate.

### Workflow version

The converged slice adds append-only `guided@0.4.0` and a matching prompt bundle. It retains
`guided@0.3.0` unchanged and adds an explicit upgrade edge for an eligible active or completed-Plan
Task with no conflicting Implement operation. The upgrade command requires an explicit valid role
model policy before it creates a fleet.

`guided@0.4.0` changes Implement execution behavior:

- the Task primary is an orchestrator with Agent Runtime tools and Task implementation tools;
- role model policy is pinned before fleet creation;
- implementation work may be delegated to write-exclusive implementers;
- scouting and review use shared-read runs;
- Task completion requires a quiescent fleet in addition to the existing Build, check, gate,
  provider-turn, branch, lineage, and clean-worktree requirements.

Historical Tasks and current `guided@0.3.0` execution continue unchanged.

### Task lifecycle integration

- Implement bootstrap creates or reconciles the fleet association through a durable outbox target.
- Task cancellation, supersession, provider change rejection, and thread deletion stop the fleet
  before completing session cleanup.
- A failed child does not fail or complete the Task occurrence automatically. The orchestrator or
  user may retry with the same semantic operation, choose a new run, or stop the occurrence.
- Task restart reconciliation owns whether to retry an operation; Agent Runtime only reconciles the
  exact reserved run/session and reports its outcome.
- `task_implementation_complete` rejects while any child is requested, starting, running, waiting,
  or stopping, or while a workspace lease remains held.
- Verify remains a later Task slice. Agent reviewers in this slice report implementation review;
  they do not create authoritative verification evidence or mark Done.

## Contracts, persistence, and package boundaries

### Contracts

`packages/contracts` receives schemas only for:

- fleet, run, role, owner, status, workspace access, model policy, limits, usage, and capability
  records;
- Agent Runtime commands, events, queries, and tool payloads;
- additive provider-runtime correlation fields; and
- the optional Task occurrence fleet association and `guided@0.4.0` commands/events.

Runtime folds, policy, validation logic, and model routing do not enter the schema-only package.

### Server runtime

A focused `apps/server/src/agentRuntime/` module owns:

- command validation and durable fleet/run projection;
- deterministic child thread/session/turn/message identities;
- model-role resolution;
- workspace leases;
- parent/child MCP capabilities;
- start, result settlement, continuation, cancellation, and restart reconciliation;
- provider event correlation and aggregate liveness; and
- Task/Standard owner policy callbacks.

`ProviderAdapter` remains provider-native. Agent Runtime wraps `ProviderService`; it does not add
Task fields to every adapter method.

### Persistence

Agent lifecycle commands and events use the existing orchestration SQLite/event/receipt
infrastructure. Every side effect is preceded by persisted intent. At minimum, operation receipts
cover fleet creation, run request, child thread start, child turn start, result settlement, parent
continuation, stop, and lease acquisition/release.

Task persistence stores only the fleet association and Task-owned consequences. Agent runs are not
copied into the Task event log. A Task outbox row dispatches an idempotent Agent Runtime operation
and records the resulting fleet identity.

### Client runtime

A shared client fold derives:

- ordered runs and role/model labels;
- active, waiting, failed, completed, and stopped counts;
- aggregate usage and latest material activity;
- fleet liveness and stop capability; and
- quiet-timeline call-to-action state.

The fold is a projection, not lifecycle authority. Reconnect rehydrates from server persistence.

## UX

### Agents panel

Both Standard and Task routes use one Agents panel showing:

- role, model, status, elapsed time, and bounded current task;
- aggregate and per-run token usage when available;
- failure or waiting reason;
- latest result summary;
- fleet Stop and capability-gated per-run Stop; and
- parent/child grouping without adding children to the top-level sidebar.

Task routes keep the Guided task panel authoritative for stages, checks, checkpoints, amendments,
and completion. The Agents panel answers **who is executing**; the Task panel answers **where the
workflow stands**.

### Quiet timeline

Child tool chatter and duplicated child transcripts do not flood the parent conversation. The
parent timeline shows one stable delegation card with material status changes and an **Open Agents**
action. The deterministic parent continuation carries bounded results after settlement.

### Liveness and remote clients

An active or waiting child keeps the parent thread and owning Task occurrence alive for:

- sidebar Active/Idle derivation;
- Connect publication and unread/completion priority;
- mobile aggregate running state;
- session-reaper eligibility; and
- whole-fleet Stop.

Mobile does not receive the full Agents roster in this slice, but it must not display false idle or
completed state while children run.

## Security and reliability invariants

1. Fleet owner, environment, provider instance, parent thread, Task occurrence, and workspace are
   server-derived and persisted.
2. Every child model comes from the fleet's pinned provider instance and role policy.
3. Children cannot receive Task implementation credentials or call Task mutation tools.
4. The parent cannot have an active turn while any child holds a workspace lease.
5. One workspace has at most one write lease; read and write leases never overlap.
6. Task write children receive the same worktree, Git metadata, credential, and network isolation
   guarantees as the current primary Implement session.
7. No child reads provider credentials, parent MCP credentials, unrelated Task data, or another
   environment's runtime state.
8. Spawn, start, result, continuation, stop, and lease operations are idempotent across replay and
   response loss.
9. Provider text, tool names, Bash commands, and guessed native ids never create lifecycle state.
10. Session reaping cannot stop a parent or child while the fleet has live work; stale sessions are
    reconciled before stopping.
11. A Task can complete only after the fleet and workspace leases are quiescent.
12. Bounded strings, result payloads, activity rings, usage counters, concurrency, depth, and total
    run limits prevent unbounded retention or recursive spawning.

## Upstream PR #5219 disposition

### Adopt as design evidence

- canonical lifecycle normalization;
- parent-transcript suppression and quiet delegation CTA;
- fleet-level Agents UI;
- aggregate background liveness;
- whole-fleet Stop;
- typed usage and parent-child linkage;
- session-reaper, Connect, unread, and mobile liveness integration; and
- defensive adapter-local parsing and bounded retained activity.

### Reimplement for Kata

- durable server-owned fleet/run state instead of a client-only lifecycle fold as authority;
- explicit Standard/Task owner correlation;
- role-based model routing within one provider instance;
- Kata-managed child threads and operation receipts;
- workspace leases and parent-turn quiescence;
- Task completion and cancellation integration; and
- one Agents projection shared with Kata's Sidebar v2 and Task route.

### Skip or defer

- Claude workflow-script filesystem inspection RPC;
- provider-native lifecycle as the primary scheduler;
- per-agent controls that fall back to interrupting the parent;
- inferred agents from prose, shell commands, or generic tool names;
- mixed-provider fleets;
- nested children;
- parallel write agents and child-branch integration;
- a general workflow DSL for Standard mode; and
- any upstream branding, package paths, or orchestration-v2 assumptions.

The full upstream scan baseline in `FORK.md` is unchanged until an approved implementation lands.

## Next vertical slice

The next child spec is **Shared Agent Runtime and Guided delegation**. It is one workstream delivered
in working layers:

1. **Durable core:** contracts, owner identity, operation receipts, run projection, role model
   policy, workspace leases, cancellation, liveness, and a fake adapter conformance harness.
2. **Codex Standard slice:** one Standard parent delegates a read-only scout and receives a bounded
   result after restart-safe settlement; Agents UI and whole-fleet Stop work end to end.
3. **Role and write slice:** role-specific Codex models, shared-read batches, one exclusive writer,
   parent-turn quiescence, usage, and deterministic parent continuation.
4. **Guided integration:** `guided@0.4.0`, fleet association, orchestrator-only Task authority,
   Task worktree lease, completion quiescence, cancellation, and restart recovery.
5. **Remote and hardening:** sidebar, Connect, unread, mobile aggregate state, session reaper,
   bounded retention, manual validation, E2E, and security conformance.

Each layer must work end to end and keep existing `guided@0.3.0` and Standard behavior green before
the next layer begins. This slice precedes Guided verification so Verify can consume the final
shared runtime rather than introducing another execution path.

## Acceptance criteria

1. **AR-AC01, durable identity:** A Standard parent and a Guided Implement occurrence each create
   one durable fleet whose owner, provider instance, parent thread, and deterministic operations
   survive restart without duplicate children.
2. **AR-AC02, provider homogeneity:** Every fleet run uses the pinned provider instance. Attempts to
   cross provider instances are rejected without fallback.
3. **AR-AC03, role models:** Orchestrator, scout, implementer, and reviewer can pin different models
   and options from that provider instance; defaults inherit the parent selection and usage is
   attributed by role/model.
4. **AR-AC04, bounded delegation:** The parent can request depth-one child runs through typed tools;
   children cannot spawn descendants or choose arbitrary models.
5. **AR-AC05, parent quiescence:** No child starts until the parent turn is terminal, and no parent
   continuation starts until the relevant child runs and leases settle.
6. **AR-AC06, workspace safety:** Read runs may share a lease only with other reads. Exactly one
   implementer may hold the write lease. Conflicting parent/child turns are rejected before
   provider dispatch.
7. **AR-AC07, Task authority:** Task children cannot call Task tools. Only the primary Task session
   records progress, checks, amendments, or completion after child results.
8. **AR-AC08, Task completion:** Guided completion is rejected while a child or lease is live and
   succeeds only after all existing Slice 2 worktree, check, gate, provider-turn, and lineage
   conditions also pass.
9. **AR-AC09, recovery:** Response loss or restart at request, parent settlement, child start,
   result proposal, child terminal, parent continuation, stop, or lease release reconciles the same
   semantic operation.
10. **AR-AC10, cancellation:** Whole-fleet Stop settles children before the parent. Unsupported
    per-run stop controls remain hidden and never fall back to unsafe parent interruption.
11. **AR-AC11, observability:** Standard and Task routes show the same Agents projection with role,
    model, status, activity, usage, result, and failure without duplicating child transcripts in the
    parent timeline.
12. **AR-AC12, background liveness:** Sidebar, Connect, unread, mobile aggregate state, and session
    reaping treat live children as live parent work.
13. **AR-AC13, isolation:** Child credentials and sandboxes cannot access another environment,
    fleet, Task, source checkout, sibling worktree, provider credential, or parent Task credential.
14. **AR-AC14, compatibility:** Existing Standard threads, historical Task contracts, and
    `guided@0.3.0` Tasks remain decodable and behaviorally unchanged.
15. **AR-AC15, cumulative proof:** One real-provider desktop E2E proves Standard delegation, one
    real-provider desktop E2E proves Guided delegation through completed Implement, and both cover
    restart and Stop within the standard test ceiling.

## Verification

### Focused automated coverage

- Contract decoding, operation digests, role-model policy, owner isolation, and historical decoding.
- Agent Runtime reducer/store/receipt tests for every lifecycle and conflict transition.
- Fake-adapter conformance for duplicate request, dropped response, restart, cancellation, stream
  closure, stale event, and result-before-terminal/terminal-before-result orderings.
- Codex conformance for model routing, parent interruption/quiescence, deterministic resume,
  worktree permissions, credential isolation, and stop settlement.
- Workspace lease concurrency and crash-injection tests.
- Task service tests for fleet association, child authority rejection, completion quiescence,
  cancellation, supersession, and `guided@0.3.0` compatibility.
- Client fold, Agents panel, timeline suppression, sidebar, Connect, unread, mobile aggregate, and
  session-reaper tests.

### Manual validation and E2E

Use `playwright-cli` against Standard and Task routes. Capture snapshots for model-role selection,
read delegation, write delegation, Agents status, failure, Stop, restart, parent continuation,
Task progress, and Task completion.

Encode every criterion in Playwright under `e2e/tests/` using shared harness/flow helpers and a new
`@agents` tag. The Task scenario also retains `@task-workspaces`. Mobile aggregate liveness receives
Maestro coverage if the visible mobile state changes.

### Repository gates

```bash
vp check
vp run typecheck
vp run check:okf
vp run test
vp run release:smoke
vp run e2e --project desktop-dev --grep '@agents|@task-workspaces'
```

## Risks and mitigations

| Risk                                                | Mitigation                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Agent Runtime becomes a second Task workflow engine | Runtime executes and reports only; Task service remains sole workflow authority        |
| Different models silently change provider or cost   | Fleet pins provider instance and explicit role selections; agents request roles only   |
| Parent and child corrupt one worktree               | Canonical terminal observation plus persisted shared-read/exclusive-write leases       |
| Task child bypasses gates or checks                 | Child credentials exclude Task capabilities; primary bridge remains sole mutation path |
| Restart duplicates child work                       | Persist intent and deterministic identities before every provider side effect          |
| Provider-native behavior leaks into contracts       | Adapter-local mapping and provider-native metadata remain non-authoritative            |
| Child chatter overwhelms UI or persistence          | Stable delegation activities, bounded summaries/rings, hidden top-level child threads  |
| Task verification is confused with agent review     | Reviewer result is implementation advice; Verify remains a later authoritative slice   |
| Current provider acceptance gaps are hidden         | Keep issue #64 and the Slice 2 evidence status explicit until independently closed     |

## Rollback

- Disable new fleet creation while retaining decoding and read-only Agents history.
- Keep `guided@0.4.0` registered for existing Tasks but move the current catalog pointer back to
  `guided@0.3.0` for new Tasks.
- Stop active fleets through durable cancellation before disabling runtime workers.
- Never rewrite or delete Task, orchestration, fleet, run, receipt, usage, or provider event history.

## Deferred work

- [#68 — provider expansion and advanced fleet topology](https://github.com/gannonh/kata-code/issues/68)
  tracks additional adapters, provider-native adoption, mixed providers, nested agents, isolated
  parallel writers, and any general Standard workflow layer built on the runtime.
- [#67 — mobile Agents roster and controls](https://github.com/gannonh/kata-code/issues/67)
  follows the aggregate mobile liveness required by this slice.

Guided Verify/Done and Deliver are not Agent Runtime deferrals; they remain explicit later slices in
the authoritative Task roadmap.

## Related

- [Task mode parent design](/specs/archive/2026-08-01-task-mode-design.md)
- [Guided planning delivery](/specs/archive/2026-08-01-task-mode-slice-1-guided-planning-plan.md)
- [Guided implementation delivery](/specs/archive/2026-08-03-task-mode-slice-2-guided-implementation-plan.md)
- [Provider acceptance issue #64](https://github.com/gannonh/kata-code/issues/64)
- [Provider architecture](/architecture/providers.md)
- [Archived Sidebar v2 Active/Idle design](/specs/archive/2026-07-16-sidebar-v2-active-idle-design.md)
- [Selective vendor-pull ADR](/adrs/0004-selective-vendor-pull.md)
- [Upstream PR #5219](https://github.com/pingdotgg/t3code/pull/5219)
- [Upstream issue #4198 — session reaper kills background work](https://github.com/pingdotgg/t3code/issues/4198)
- [Upstream issue #5518 — false completion during delegation](https://github.com/pingdotgg/t3code/issues/5518)
