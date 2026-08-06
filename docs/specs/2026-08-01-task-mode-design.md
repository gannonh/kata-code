---
type: Spec
title: "Task mode and Agent Runtime — product-first workflows"
description: "Authoritative product and architecture roadmap for durable Task workflows and the shared Kata-managed Agent Runtime used by Task and Standard chat."
status: Active
tags:
  [specs, task-mode, task-workspaces, agents, subagents, ux, workflows, standard, guided, freeform]
timestamp: 2026-08-06T16:20:00Z
supersedes:
  - /specs/archive/2026-07-03-task-mode-design.md
  - /specs/archive/2026-07-28-task-workspaces-vertical-slices-design.md
---

# Task mode and Agent Runtime — product-first workflows

## Status

**Active parent design.** Current `main` at `397fe925a` contains:

- [Vertical Slice 1: Guided planning](/specs/2026-08-01-task-mode-slice-1-guided-planning-plan.md),
  implemented through approved Plan; and
- [Vertical Slice 2: Guided implementation](/specs/2026-08-03-task-mode-slice-2-guided-implementation-plan.md),
  implemented through a completed Implement occurrence in merge commit `59c0c573b`.

The merged implementation is distinct from cumulative real-provider acceptance. Remaining
checkpoint, amendment, restart, adversarial isolation, and exact-commit proof is tracked in
[#64](https://github.com/gannonh/kata-code/issues/64).

The in-development web and desktop surface is disabled by default. Start development with
`FF_TASK_MODE=1` to expose Task navigation, routes, and subscriptions.

The next proposed production slice is the Draft
[Task mode and Agent Runtime convergence](/specs/2026-08-06-task-mode-agent-runtime-convergence.md).
It makes Kata-managed, same-provider child agents one shared execution substrate for normal
Standard chat and Guided Implement before Guided Verify is designed. The accepted shell is the
conversation-first Task route with a persistent right panel, and its bounded production work is
owned by the [conversation-plus-panel shell plan](/specs/2026-08-06-task-mode-conversation-panel-shell-plan.md).

This document is the sole authoritative Task mode product design and roadmap. Dated child specs own
bounded implementation and acceptance criteria. Earlier Task mode and task-workspace designs remain
historical delivery records.

## Goal

Make Tasks a user-facing workflow that carries real agent work from intake through planning,
implementation, verification, and delivery. The user enters a brief, chooses a workflow, and works
through normal agent conversations while Kata manages stage sessions, artifacts, worktrees,
progress, gates, checks, evidence, and recovery.

Build one Agent Runtime beneath both Task mode and Standard chat so delegation does not create a
second workflow system. A Task is the durable control plane; agent runs are its execution layer.
Standard chat can use the same runtime without creating Task stages, artifacts, or gates.

Program completion means a maintainer can:

1. create a Guided Task;
2. move through Clarify, Research, Design, and Plan;
3. approve or revise the Plan;
4. orchestrate role-specialized child agents to execute it in a managed worktree;
5. verify the exact resulting commit;
6. reach Done; and
7. explicitly create a draft pull request.

Restarting during any transition must restore the same Task, fleet, run, session, gate, operation,
worktree, and evidence identity without duplicate work.

## Authority and terminology

This design supersedes the [archived July 3 Task mode design](/specs/archive/2026-07-03-task-mode-design.md)
and the [archived July 28 task-workspaces design](/specs/archive/2026-07-28-task-workspaces-vertical-slices-design.md).
Their child plans remain useful implementation history but do not define current sequencing.

Terms are deliberately distinct:

- **Standard chat** is the normal non-Task conversation surface.
- **Standard Task preset** is the shorter structured Task template.
- **Task workflow** means Kata-owned durable stages and gates.
- **Agent fleet** means one parent plus Kata-managed child runs that execute bounded work.
- **Agent run** or **delegation** describes child execution. Provider-native “workflow” terminology
  does not replace Task stages.

Authority is layered:

```text
TaskWorkspaceService     Standard thread authority
         │                         │
         └──────────┬──────────────┘
                    ▼
             Kata Agent Runtime
                    ▼
              ProviderService
                    ▼
             ProviderAdapter SPI
```

`TaskWorkspaceService` alone commits Task stages, artifacts, checks, checkpoints, amendments,
gates, resulting commits, and completion. Agent Runtime owns child execution, model routing,
workspace leases, liveness, cancellation, and result delivery. Provider adapters own only
provider-native protocol behavior.

## Verified current state

### Implemented

- New form-created Tasks use the transactional `task-workspace@0.3.0` and
  `task-artifact@0.3.0` aggregate shape, environment-scoped routing, command and operation receipts,
  completion proposals, durable outbox, and pinned workflow/prompt versions.
- New Guided Tasks pin `guided@0.3.0` and require a provider that advertises and proves
  `supportsTaskWorktreeWrite`.
- Guided automatically creates fresh Clarify, Research, Design, and Plan conversations, persists
  artifacts, supports repeated Plan request-changes cycles, and records Plan approval.
- Plan approval or explicit upgrade/start provisions or adopts the managed Task worktree and creates
  one write-enabled Implement occurrence and primary provider session.
- `TaskStageBridge` owns planning context and completion proposals.
  `TaskImplementationBridge` owns typed implementation context, progress, approved check requests,
  amendment proposals, and completion proposals.
- A deterministic Plan compiler creates durable phases, work items, dependencies, checks, and
  checkpoint policies. Approved check commands run through `TaskWorktreeCommandRunner` with bounded
  output and persisted attempts.
- Implement progress, checks, checkpoints, amendments, retries, completion state, and resulting
  commit render in `GuidedTaskPanel` beside the normal `ChatView`.
- Task bootstrap and completion reconciliation preserve deterministic worktree, Task session,
  orchestration thread, provider turn, message, proposal, and outbox identities.
- The feature flag added in `ff2ec710d` hides Task navigation/routes/subscriptions by default.

### Implemented but not fully accepted

- The bounded authenticated Codex E2E reaches active Implement within the standard test ceiling.
- Deterministic contract, compiler, service, provider, sandbox, recovery, browser, and completion
  tests cover the merged implementation.
- Full provider-backed proof through checkpoint, amendment, restart, adversarial isolation, and
  exact completed commit remains open in issue #64. The roadmap must not describe that acceptance as
  complete until the evidence record changes.

### Not implemented

- Kata-managed fleets and child runs.
- Explicit runtime owner correlation between Standard threads, Task occurrences, and provider
  sessions.
- Role-specific model routing within one provider instance.
- Shared Agents UI, fleet cancellation, child usage, and aggregate background liveness.
- Guided Verify, Done, and Deliver.
- Complete Standard Task preset and Freeform Task preset paths.
- Native mobile Task UI.

## Product decisions

These decisions govern current and future child slices:

- The conversation remains the primary surface.
- Kata owns Task templates, stage terminology, and transition authority.
- The product retains the Standard, Guided, and Freeform Task presets.
- Guided is the only Task preset implemented through real planning and implementation.
- Standard chat remains available independently of Task mode.
- Kata creates and links primary Task sessions; the normal workflow has no manual thread linking.
- Trusted Task instructions are server-only. Task data returned to an agent is untrusted content.
- Planning sessions use the enforced planning profile. Implement uses
  `task-worktree-write`; there is no full-access fallback.
- Task creation pins provider instance, model, provider options, workflow, prompt, repository, base,
  and worktree policy.
- The next Agent Runtime slice is Kata-managed, not provider-managed.
- One fleet uses one provider instance but may pin different models/options by role. The parent
  requests a role; the server resolves its pinned model policy.
- The first Agent Runtime slice allows depth-one children, concurrent shared-read runs, and one
  exclusive writer while the parent is quiescent. Parallel writers and mixed providers are
  deferred.
- Child agents cannot mutate Task state. The primary Task session remains the sole Task bridge
  caller.
- Provider-native child events may be normalized later but never become workflow authority.
- Task completion requires authoritative Task conditions and, once Agent Runtime is enabled, a
  quiescent fleet.

## Workflow templates

### Standard Task preset

```text
Clarify → Plan → Implement → Verify
```

The Standard Task preset is intended for well-understood work. Its current `standard@0.2.0` catalog
entry is a preview shell; automatic completion beyond the shell remains deferred. This is separate
from Standard chat, which receives shared Agent Runtime delegation in the next proposed slice.

### Guided Task preset

```text
Clarify → Research → Design → Plan → Implement → Verify
```

`guided@0.3.0` implements Clarify through completed Implement. Every planning stage has a fresh
primary conversation and readable artifact. Plan has a human approval gate. Implement uses the
managed worktree, typed progress/check/amendment/completion tools, and server-observed Git state.
Verify remains deferred.

The next proposed `guided@0.4.0` keeps these Task semantics and changes Implement execution to use a
shared Agent fleet with role-specific models.

### Freeform Task preset

Freeform is a Task-owned conversation without a required stage rail. Its current
`freeform@0.2.0` catalog entry is a preview shell. Explicit stage entry and structured completion
arrive in a later approved slice.

### Deliver boundary

Deliver is a post-Verify Task action. It remains outside the stored `TaskWorkspaceStage` union until
its child spec defines the contract.

### Current availability

- **Guided:** implemented through completed Implement, development-gated, with cumulative
  provider-backed acceptance still open.
- **Standard Task preset:** preview shell.
- **Freeform Task preset:** preview shell.
- **Standard chat:** existing normal conversation; no Kata-managed child agents yet.

The shared server catalog is authoritative. Web labels and controls consume its versioned
capability projection rather than inferring stage availability.

Stored values remain `questions`, `research`, `design`, `plan`, `build`, `verify`, and `verified`.
Presentation maps `questions` to **Clarify**, `build` to **Implement**, and `verified` to **Done**.

## Current user journey

### Create

1. The user opens **Create task** with `FF_TASK_MODE=1`.
2. The form collects brief, task name, immutable slug, repository, base ref, Task preset, worktree
   timing, provider instance, model, and provider-owned options.
3. Guided filters out providers that cannot enforce the complete `task-worktree-write` profile.
4. The server resolves repository identity and base commit, persists Task and bootstrap intent, and
   reserves deterministic external identities in one transaction.
5. The canonical route is `/tasks/$environmentId/$taskId` and remains stable through every stage.

### Worktree timing

- **Now:** provision from the pinned base before Clarify and use the Task worktree throughout.
- **Later:** plan in a clean pinned source checkout, then provision after Plan approval.
- **Never:** plan in the source checkout; Implement remains blocked until the user changes policy to
  Now or Later.

The server revalidates repository identity, branch, base lineage, cleanliness, and planning-root
fingerprint at the relevant boundaries.

### Guided planning

Clarify, Research, Design, and Plan each receive pinned trusted instructions and bounded authorized
context. Stage completion is a typed proposal tied to the active occurrence, Task session, thread,
and provider turn. Kata commits an artifact only after the canonical turn settles successfully.

Request changes preserves the reviewed Plan, records feedback, and starts a new Plan occurrence.
Approval records server time and the resolved actor for the exact current revision.

### Guided implementation

For `guided@0.3.0`, Plan approval starts Implement automatically when the worktree is ready. An
eligible historical `guided@0.2.0` Task upgrades explicitly and shows **Start Implement**.

The provider executes the compiled Plan in one write-enabled primary session. The Task panel shows
phases, work items, checks, attempts, checkpoint gates, amendment review, failures, and recovery.
Completion records the exact server-observed HEAD only after all required work and checks are
current, gates are closed, the branch and base lineage match, the provider turn succeeds, and the
worktree is clean.

The completed Task remains at Implement. Verify is unavailable until its child slice ships.

### Guided delegation — next slice

`guided@0.4.0` will preserve the same Task journey while the primary becomes an orchestrator. It may
delegate scouting, implementation, and review to role-specific models from the same provider
instance. Child execution is visible in the Agents panel; Task progress and completion remain in the
Guided panel.

## Surface model

### Canonical Task route

`/tasks/$environmentId/$taskId` composes `ChatView` with a compact Task panel. The route resolves the
current conversation target from durable Task state and renders Starting, Ready, Failed/Retry,
offline, or Needs repair states without changing URL.

### Task panel

The current Guided panel contains:

- Clarify through Implement in the stage rail;
- transition and bootstrap state;
- current and prior artifacts;
- repository, pinned base, branch, worktree, and observed commit;
- Plan approval and request-changes actions;
- Implement phases, work items, checks and attempts;
- checkpoints and continuation;
- amendment diff, review, and invalidation;
- retry and completion state.

Manual session linking, raw thread ids, manifest editing, fixture actions, token budgets, and
historical artifact editors remain outside the default surface.

### Agents panel — next slice

Standard and Task routes will share one Agents panel for role, model, status, elapsed time, usage,
result, failure, and Stop. It answers **who is executing**. The Task panel continues to answer
**where the workflow stands**.

Children remain nested under their parent and do not appear as top-level sidebar threads. The
parent timeline uses one stable delegation card instead of duplicating child transcripts.

## Runtime architecture

### Environment and repository authority

The client selects a project and base ref, never a trusted filesystem path. The server stamps its
environment, resolves the project binding, derives the repository root, verifies authorization,
resolves the base ref, and persists the canonical binding. All later Git and worktree operations use
that server-owned record.

### Task aggregate and persistence

Task state is transactional SQLite persistence, not an in-memory or one-event-per-command file
workflow. A transaction can append Task events, update the snapshot, write command and operation
receipts, persist a completion proposal, and enqueue outbox work.

The aggregate owns:

- environment, Task identity, intake, repository, base, and worktree policy;
- pinned workflow, prompt, provider, model, and options;
- stage occurrences and Task sessions;
- artifacts, revisions, gates, feedback, and manifests;
- implementation phases, work items, checks, attempts, checkpoints, and amendments;
- operation/bootstrap status and resulting commit; and
- monotonic `taskRevision` for compare-and-set commands.

Every external side effect has a semantic operation key and deterministic identity. Startup workers
reconcile before retrying. Unknown post-spawn check outcomes become indeterminate and never rerun
automatically.

### Provider runtime

`ProviderService` routes through `ProviderAdapterRegistry` and the selected provider instance.
Adapters own start, send, interrupt, stop, approval/input responses, thread reads, resume, and
canonical event emission. Provider-native ids are metadata; Kata operation and owner identity are
authoritative.

Task execution currently layers Task-specific pinning, MCP leases, worktree policy, and watchdogs
inside this path. The Agent Runtime slice extracts shared lifecycle/owner/liveness mechanics while
keeping Task policy behind Task-owned authorization callbacks.

### Task bridges

`TaskStageBridge` supports planning context and typed artifact completion.
`TaskImplementationBridge` supports:

- `task_implementation_context`;
- `task_implementation_progress`;
- `task_implementation_check_run`;
- `task_implementation_amendment_propose`; and
- `task_implementation_complete`.

Handlers derive environment, Task, occurrence, primary Task session, provider instance, provider
turn, and worktree from the leased invocation scope. Stale, superseded, non-primary, cross-Task, and
cross-worktree calls fail. The browser never mutates Task progress optimistically.

### Shared Agent Runtime — next slice

The [convergence spec](/specs/2026-08-06-task-mode-agent-runtime-convergence.md) adds a durable
runtime above `ProviderService` for:

- Standard-versus-Task owner identity;
- fleet/run lifecycle and command receipts;
- role-based model routing within one provider instance;
- parent/child leased credentials;
- shared-read and exclusive-write workspace leases;
- parent-turn quiescence and deterministic continuation;
- result settlement, cancellation, restart reconciliation, and usage;
- Agents projection and aggregate background liveness.

Task persistence stores only its fleet association and Task consequences. Fleet/run lifecycle stays
in orchestration persistence. The Task outbox dispatches idempotent Agent Runtime operations.

Task children receive no `task-stage` or `task-implementation` capability. After a child settles,
the primary orchestrator resumes and uses the existing Task bridge to report authoritative
progress.

### Model routing

The current Task pins one `ModelSelection`. The next fleet policy keeps its provider instance fixed
while allowing explicit role selections for orchestrator, scout, implementer, and reviewer.
Selections default to the parent model, resolve through the same instance catalog, and snapshot at
fleet creation. An agent requests a role rather than a raw model, preventing silent provider/cost
escalation.

### Liveness, cancellation, and recovery

Canonical protocol state—not transcript text—determines running, waiting, terminal, failed, and
stopped outcomes. Once fleets ship, live child work keeps the parent alive for sidebar, Connect,
unread, mobile aggregate state, and session reaping.

Whole-fleet Stop settles children and releases workspace leases before stopping the parent. A Task
interprets cancellation through its own occurrence/operation policy; Agent Runtime never marks the
Task complete or failed by itself.

## Workflow and contract versions

Current form-created records use `task-workspace@0.3.0` and `task-artifact@0.3.0`. Current built-in
catalog entries are:

- `standard@0.2.0` / `task-workspace-standard@0.2.0`;
- `guided@0.3.0` / `task-workspace-guided@0.3.0`; and
- `freeform@0.2.0` / `task-workspace-freeform@0.2.0`.

Historical task, artifact, workflow, and prompt versions remain registered and decodable. The
normalizer preserves historical ids, versions, occurrences, sessions, repository bindings, and
worktree vocabulary.

The next slice adds `guided@0.4.0` and a matching prompt bundle plus an explicit catalog-declared
upgrade edge. Existing pinned definitions never gain behavior silently. Standard chat Agent Runtime
metadata is versioned separately from Task workflow definitions.

## Roadmap

| Slice                                         | Product outcome                                                                                                                                   | Status                                                                                | Child plan                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Guided planning                            | Create a Guided Task and move through Clarify, Research, Design, and approved Plan.                                                               | **Implemented on `main`; cumulative provider proof continues in #64**                 | [Guided planning](/specs/2026-08-01-task-mode-slice-1-guided-planning-plan.md)             |
| 2. Guided implementation                      | Execute an approved Plan in a write-enabled Task worktree with durable progress, checks, checkpoints, amendments, recovery, and resulting commit. | **Implemented on `main`; cumulative provider proof continues in #64**                 | [Guided implementation](/specs/2026-08-03-task-mode-slice-2-guided-implementation-plan.md) |
| UX Playground exploration                     | Compare Task navigation and stage-history layouts before changing the production shell.                                                           | **Completed — Prototype A accepted; horizontal rail retained as historical evidence** | [Prototype decision](/specs/2026-08-06-task-mode-ux-playground-plan.md)                    |
| Task conversation-plus-panel shell            | Implement the accepted conversation-first Task route and persistent right panel.                                                                  | **Approved — bounded production UX child plan**                                       | [Shell plan](/specs/2026-08-06-task-mode-conversation-panel-shell-plan.md)                 |
| 3. Shared Agent Runtime and Guided delegation | Add Kata-managed, single-provider fleets with role-specific models to Standard chat and Guided Implement under one runtime.                       | **Draft — shell accepted; implementation review follows the bounded shell plan**      | [Convergence design](/specs/2026-08-06-task-mode-agent-runtime-convergence.md)             |
| 4. Guided verification                        | Verify the resulting commit against acceptance criteria, preserve evidence, and reach Done.                                                       | **Upcoming — child spec required**                                                    | Not written                                                                                |
| 5. Standard Task preset and Freeform          | Complete both Task presets using the same runtime, worktree, recovery, and verification model.                                                    | **Upcoming — child spec required**                                                    | Not written                                                                                |
| 6. Deliver                                    | Create and track a draft pull request from a verified Task after explicit approval.                                                               | **Upcoming — child spec required**                                                    | Not written                                                                                |

The UX Playground changed no production Task behavior. Its accepted outcome is now captured by the
bounded conversation-plus-panel shell child plan. Slice 3 remains a separate runtime review and
must preserve the accepted shell; the open Slice 2 provider acceptance record remains visible and
may be completed in parallel as validation work.

## Program acceptance criteria

Task mode and its shared runtime are complete when cumulative slices prove:

1. **Creation and identity:** A form-created Task persists its brief, slug, repository, base,
   worktree policy, Task preset, provider instance, model, and options under one canonical URL.
2. **Guided planning:** Clarify, Research, Design, and Plan use fresh managed conversations,
   readable artifacts, bounded authorized context, and repeatable Plan review.
3. **Guided implementation:** An approved Plan starts one isolated Implement occurrence with durable
   progress, approved checks, checkpoints, amendments, recovery, and exact resulting commit.
4. **Agent Runtime:** Standard chat and Task mode use one durable fleet/run lifecycle with explicit
   owner identity, idempotency, recovery, cancellation, usage, and liveness.
5. **Model specialization:** A fleet remains on one provider instance while roles may pin different
   validated models/options; no agent silently changes provider or model policy.
6. **Workspace safety:** Parent and children obey server-owned read/write leases, Task sandbox,
   credential isolation, network policy, and depth/concurrency bounds.
7. **Task authority:** Child runs cannot advance Task state. Only the primary Task bridge and Task
   service settle progress, checks, gates, amendments, and completion.
8. **Guided verification:** Verify evaluates acceptance criteria against the exact resulting commit,
   preserves evidence, reruns affected results, and marks stale evidence when code changes.
9. **Done:** A Task reaches Done only after required verification passes or an authorized human
   records a documented blocked/waived outcome.
10. **Task preset completion:** Standard and Freeform Task presets use the same Task, Agent Runtime,
    provider, worktree, artifact, recovery, and verification foundations.
11. **Delivery:** A verified Task creates and tracks a draft pull request only after explicit user
    approval; failure preserves the verified Task and exposes retry.
12. **Recovery:** Reload, reconnect, response loss, and restart preserve Task, operation, fleet, run,
    stage, session, artifact, gate, worktree, check, and evidence identity.
13. **Safety and authority:** The server owns repository resolution, execution policy, tool
    authorization, transition authority, actor identity, and audit time. Unsupported or stale input
    fails visibly.
14. **Compatibility:** Historical contracts and pinned definitions remain decodable and unchanged.
15. **Cumulative proof:** Real-provider desktop E2E coverage grows from creation through Implement,
    delegation, Verify, Done, and Deliver as slices ship.

## Testing and verification

### Vertical-slice product proof

| Slice | Required proof                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Form-created Guided Task reaches approved Plan with stable identity and repeated Plan review.                                  |
| 2     | Approved Plan reaches completed Implement with progress, checkpoint, amendment, restart, isolation, and exact-commit evidence. |
| 3     | Standard chat and Guided Implement delegate to role-specific same-provider models, recover, stop, and preserve Task authority. |
| 4     | The exact resulting commit reaches Done through inspectable verification evidence.                                             |
| 5     | Standard and Freeform Task presets complete through the current contracts and UI.                                              |
| 6     | Done creates and tracks a draft pull request after explicit approval.                                                          |

The cumulative Task scenario lives under `e2e/tests/task-workspaces/` with `@task-workspaces`.
Agent Runtime adds `@agents` and shared harness/flow helpers. Direct-dispatch historical fixtures and
browser-only projections do not substitute for form-driven, real-provider proof.

### Lower-level proof

- Schema/version decoding and canonical operation-digest tests.
- Transactional Task and orchestration receipt/outbox atomicity.
- Crash injection around every external provider, worktree, check, child, lease, and continuation
  side effect.
- Provider conformance for resume, cancellation, permissions, credentials, model routing, and
  canonical event ordering.
- Task bridge authorization and cross-environment/cross-owner rejection.
- Plan compiler, progress, check, checkpoint, amendment, completion, and Git-state invariants.
- Fleet reducer, model policy, workspace lease, liveness, reaper, Connect, sidebar, unread, mobile
  aggregate, and Agents UI behavior.
- Historical contract and `guided@0.3.0` compatibility.

### Manual acceptance and gates

Use `playwright-cli` against the running web app or Electron for every user-facing criterion and
capture snapshots at material states. Real-provider acceptance records the Task URL, provider
instance, role models, worktree, Plan revision, fleet/run/session ids, checks, resulting commit, and
source checkout status without recording credentials.

Required commands before completing each child slice:

```bash
vp check
vp run typecheck
vp run check:okf
vp run test
vp run release:smoke
vp run e2e --project desktop-dev --grep '@task-workspaces|@agents'
```

## Out of scope

- External intake adapters such as GitHub, Linear, and Jira before their own slices.
- Slack notifications.
- User-authored workflow definitions.
- Provider-native workflow-script filesystem inspection.
- Mixed-provider fleets, nested child agents, and parallel write agents in the first Agent Runtime
  slice.
- Native mobile Task UI and full mobile Agents roster.
- A broad visual redesign before Guided reaches Done.

## Risks and mitigations

- **Merged implementation is confused with completed acceptance.** Roadmap and evidence keep code
  status separate from issue #64's real-provider proof.
- **Agent Runtime becomes another Task workflow.** Runtime executes and reports only; Task service
  remains sole Task authority.
- **Standard chat and Standard Task preset are confused.** Product terminology and roadmap name
  them explicitly.
- **Models silently escalate cost or cross providers.** One provider instance and explicit pinned
  role policy; agents request roles only.
- **Parent and child corrupt the same workspace.** Canonical parent terminal state plus persisted
  shared-read/exclusive-write leases; one writer maximum.
- **Child bypasses Task gates.** Child credentials contain no Task capabilities; the primary bridge
  remains the only Task mutation path.
- **Restart duplicates provider work.** Persist intent and deterministic external identity before
  side effects, then reconcile provider state before retrying.
- **Background work appears idle or is reaped.** Fleet liveness participates in sidebar, Connect,
  unread, mobile aggregate, and reaper decisions.
- **Agent review is mistaken for Verify.** Reviewer results are implementation advice; authoritative
  verification remains Slice 4.
- **Historical infrastructure is mistaken for current UX.** Current route and child specs distinguish
  compatibility fixtures from the product path.

## Delivery status

Delivered in Slice 1:

- transactional Task persistence, receipts, outbox, and environment-scoped canonical routing;
- Guided Clarify, Research, Design, Plan, artifacts, request changes, and approval;
- trusted planning instructions, typed stage completion, worktree timing, and planning-root safety;
- conversation-first Task route.

Delivered in Slice 2:

- `guided@0.3.0`, explicit `guided@0.2.0` upgrade, and Implement start;
- deterministic Plan compiler and durable Build projection;
- write-enabled Codex Task profile and typed implementation bridge;
- approved checks, attempts, checkpoints, amendments, continuation, and recovery;
- server-observed completion and resulting commit;
- Implement presentation in the current Guided route.

Open validation:

- cumulative real-provider acceptance in issue #64 and the Slice 2 evidence record.

Next proposed work:

- the shared Kata-managed Agent Runtime and Guided delegation slice described in the
  [convergence spec](/specs/2026-08-06-task-mode-agent-runtime-convergence.md).
