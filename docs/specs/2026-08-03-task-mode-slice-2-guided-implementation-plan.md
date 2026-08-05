---
type: Spec
title: "Task mode Vertical Slice 2 — Guided implementation"
description: "Approved child slice for starting a write-enabled Implement occurrence from an approved Guided Plan and exposing durable agent progress, checks, checkpoints, amendments, and recovery in the conversation-first Task mode UI."
status: Implemented
approved_at: 2026-08-03T22:45:20Z
acceptance_status: In progress
tags: [specs, task-mode, task-workspaces, guided, implementation, agents, recovery]
timestamp: 2026-08-03T22:45:20Z
parent: /specs/2026-08-01-task-mode-design.md
---

# Task mode Vertical Slice 2 — Guided implementation

## Status

**Implemented on 2026-08-04.** The server, provider adapter, current Task route, browser coverage,
and required repository gates for Guided Implement are complete. The bounded authenticated path
passes through active Implement. Remaining cumulative provider acceptance is tracked in
[#64](https://github.com/gannonh/kata-code/issues/64).

This is the sole next Task mode slice. It extends the current conversation-first Guided path from
approved Plan through completed Implement. It does not start Verify or redesign the Task mode shell.

## Outcome

After approving a Guided Plan, a user can start one write-enabled Implement occurrence in the
managed task worktree. A real selected provider executes the approved Plan, while Kata records
phase and work-item progress, approved checks, checkpoints, and reviewed Plan amendments in the
task aggregate. The current task route keeps the active implementation conversation central and
shows durable implementation state in the compact task panel.

Implementation completes only after the server confirms a clean task worktree, records its exact
HEAD commit, and confirms all required work and checks are complete. The task remains at completed
Implement until the Guided verification slice becomes available.

## Current baseline

The implementation starts from `main` after the Task mode roadmap reconciliation:

- Form-created Guided tasks pin `guided@0.2.0` and stop at an approved Plan.
- `task.plan.approve` completes the Plan occurrence and applies the selected worktree policy. It
  creates no Implement occurrence or provider session for current tasks.
- `TaskStageBridge` authorizes planning context and typed artifact completion for Clarify through
  Plan. It has no implementation progress or completion contract.
- The bootstrap outbox already provides deterministic worktree, thread, turn, session, and
  occurrence recovery for automatic planning stages.
- `TaskWorkspace.build` already stores phases, work items, checks, checkpoints, amendments,
  continuation sessions, and a resulting commit SHA.
- Historical Build commands and `BuildPanel` prove reducer and presentation concepts, but their
  active path depends on fixture checks, direct UI commands, and older task records.
- The current Guided route renders `GuidedTaskPanel`, hides Implement from its stage rail, and shows
  the approved Plan as read-only.

Primary implementation surfaces:

- `packages/contracts/src/taskWorkspace.ts`
- `packages/shared/src/taskWorkspaceCatalog.ts`
- `packages/shared/src/taskWorkspaceBuild.ts`
- `apps/server/src/taskWorkspace/workflowDefinitions.ts`
- `apps/server/src/taskWorkspace/TaskWorkspaceService.ts`
- `apps/server/src/taskWorkspace/TaskStageBridge.ts`
- `apps/server/src/taskWorkspace/TaskWorkspaceBootstrapWorker.ts`
- `apps/web/src/components/taskWorkspace/GuidedTaskPanel.tsx`
- `apps/web/src/components/taskWorkspace/TaskWorkspaceView.tsx`
- `e2e/tests/task-workspaces/`

## User-visible scenario

1. Create a Guided task from the New task form and complete Clarify, Research, Design, and Plan
   through real provider conversations.
2. Approve a Plan with at least two implementation phases, one approved automated check, and one
   human checkpoint.
3. Kata provisions or adopts the deterministic task worktree according to the selected policy.
   The task shows a visible retry state if provisioning fails.
4. Kata starts one write-enabled Implement conversation in that worktree. The task panel moves to
   Implement and shows the approved Plan revision, phases, work items, and checks.
5. The provider executes work and reports typed progress. The server rejects unknown phase or work
   item ids, out-of-order dependencies, stale revisions, and progress from any non-primary session.
6. At the checkpoint, Kata blocks further implementation progress. The user reviews the current
   commit and recorded checks, then continues. Kata starts one continuation conversation with a
   bounded manifest containing the approved Plan revision and current implementation state.
7. If code reality requires a Plan change, the provider proposes an amendment. The user reviews the
   proposed Plan diff and either approves it or requests changes. Approval appends a Plan revision,
   invalidates only affected work, and starts a bounded continuation.
8. The provider completes the remaining work and requests implementation completion. Kata reads the
   worktree directly, rejects dirty or incomplete state, records the exact HEAD commit, and marks the
   Implement occurrence complete.
9. Reload and restart at the initial start, active work, checkpoint, amendment gate, continuation,
   and finalization boundaries restore the same task, occurrence, session, progress, and commit.

## Scope

### Included

- Append-only Guided workflow and prompt versions that make Implement available.
- Explicit upgrade support for eligible `guided@0.2.0` tasks with an approved current Plan.
- Automatic Implement start for newly approved Plans after the worktree is ready.
- Explicit **Start Implement** for an eligible task upgraded after Plan approval.
- One primary write-enabled provider session per active Implement occurrence.
- Deterministic Plan-to-Build projection with a safe compatibility projection for older Plans.
- Typed provider tools for implementation context, progress, approved check execution, amendment
  proposal, and completion.
- Human checkpoint continuation and amendment review through the current task panel.
- Server-observed worktree status and commit identity.
- Idempotent outbox recovery for worktree, implementation bootstrap, checkpoint continuation,
  amendment continuation, and completion settlement.
- Current-route browser coverage and cumulative form-driven desktop E2E.

### Excluded

- Verify execution, verification evidence, Done, and delivery.
- Standard and Freeform implementation flows.
- Multi-repository implementation.
- User-authored workflow definitions.
- Provider selection changes during an active Implement occurrence.
- Native mobile Task mode UI.
- A visual redesign of the conversation-first shell.

## Product and contract decisions

### 1. Slice boundary

This slice ends with a completed Implement occurrence and a server-observed `resultingCommitSha`.
It does not create a Verify occurrence. The route shows **Implementation complete** and identifies
Guided verification as unavailable until its child slice ships.

### 2. Workflow and prompt versions

Add `guided@0.3.0` and `task-workspace-guided@0.3.0` as append-only entries. The definition makes
`build` available under the Implement presentation label, retains Verify and Done as deferred, and
adds the Plan-to-Implement transition.

New Guided tasks pin `guided@0.3.0`. Historical definitions remain registered and unchanged.
Contract changes are additive and decode existing `task-workspace@0.3.0` and
`task-artifact@0.3.0` records with defaults. If implementation requires a persisted field that
cannot be represented by the existing aggregate, new form-created tasks pin the next contract
version while upgraded tasks retain their creation-version pins and receive an explicit additive
upgrade event.

### 3. Existing approved Plans

Add `task.workflow.upgrade` with the parent design's source version, target version,
`expectedTaskRevision`, and operation key. The only Guided edge in this slice is
`guided@0.2.0` to `guided@0.3.0`.

The server accepts the edge only when:

- the current Plan occurrence and revision are approved;
- no Implement occurrence exists;
- no Plan gate, completion proposal, bootstrap, repair, or worktree operation is pending; and
- the selected provider still supports the implementation execution profile.

The upgrade updates the active run's workflow and prompt pins, appends
`task.workflow.upgraded`, and starts no stage. The task panel then exposes **Start Implement**.
`task.implementation.start` performs the same worktree and bootstrap validations used by a new Plan
approval.

### 4. Plan-to-Build projection

A pure implementation-plan compiler converts the approved Plan revision into ordered phases, work
items, dependencies, checks, and checkpoint policies. Move this logic out of
`TaskWorkspaceService.ts` into a focused task-workspace implementation module.

The `guided@0.3.0` Plan instructions require a deterministic Markdown shape:

```markdown
## Phase [phase:foundation] Foundation

Checkpoint: always | manual-only | on-failure | never

### Work item [work:add-contract] Add the contract

Dependencies: work:earlier-item

- Automated check [check:typecheck]: Typecheck | vp run typecheck
- Manual check [check:review-contract]: Review the contract
```

Phase, work-item, and check ids are explicit, unique, and stable across Plan revisions. They use the
pattern `[a-z][a-z0-9-]{0,63}` after their namespace. Dependencies reference earlier work-item ids
only. The compiler rejects missing or duplicate ids, forward or missing dependencies, cycles,
invalid checkpoint policies, empty commands, and ambiguous check ownership before Plan approval
succeeds. Exact automated check commands are part of the reviewed Plan. Plan approval therefore
authorizes those commands for this task worktree.

An upgraded `guided@0.2.0` Plan without this shape receives one phase and one work item named
**Implement approved Plan**, with no automated checks. The user sees that compatibility projection
before selecting **Start Implement**. The server never invents a command from prose.

The compiled projection binds to the approved Plan revision id. Existing ids keep identity across
amendments. Removing or changing an id creates a structural delete or add. Any accepted amendment
appends a new Plan revision and recompiles only after the human approves its diff.

### 5. Write-enabled execution profile

Planning occurrences continue to use `approval-required`. Implement uses a new server-owned
`task-worktree-write` execution profile and keeps the selected provider, model, and provider options
pinned from task creation.

`task-worktree-write` requires an adapter-enforced filesystem sandbox whose writable root is the
canonical task worktree. It denies writes to the source checkout, sibling worktrees, credential
stores, and the remaining host filesystem. Tool and shell processes can read the worktree and only
the system/runtime paths required by the adapter; they cannot read user credential stores or task
control secrets. Network access is disabled unless a future approved contract adds it. Setting the
process working directory alone does not satisfy this profile.

The provider control process receives only its selected provider credential and the occurrence-
scoped Kata MCP credential through adapter-owned channels. Those credentials must remain
inaccessible to model-visible tools, shell subprocesses, check processes, logs, context results, and
the worktree. The MCP credential authorizes only this task, occurrence, primary session, and tool
set and expires with the task-stage lease.

An adapter may map the profile to an existing provider mode only when that mode enforces the same
filesystem and credential boundary. Codex may use its workspace-write sandbox after conformance
tests prove both boundaries. Providers that allow unrestricted shell, external-directory access, or
credential reads are ineligible. There is no fallback to `full-access` or a warning-only mode.

The server supplies the canonical task worktree as both branch and sandbox root. It rejects start
when the worktree is missing, points at an unexpected branch or base lineage, cannot be
fingerprinted, or the selected provider lacks the enforced profile.

Provider capability validation must explicitly cover:

- task-bound trusted instructions and tools;
- enforced worktree-only filesystem writes;
- resume or deterministic reconciliation for a previously created thread; and
- the configured maximum turn and credential lease requirements.

### 6. Implementation bridge

Extract shared task-session authorization from `TaskStageBridge` and add a focused
`TaskImplementationBridge`. MCP providers receive the implementation tools through the existing
thread-bound Kata credential. Native providers must implement the same bridge contract before they
are eligible.

The initial tool surface is:

- `task_implementation_context`: returns the brief, approved Plan revision, compiled phase and work
  graph, current progress, approved check definitions, checkpoint state, and accepted amendment
  history selected for this occurrence.
- `task_implementation_progress`: marks a known phase or work item running, completed, or blocked
  with a concise summary. The server validates dependencies, checks, gates, active occurrence, and
  optimistic task revision.
- `task_implementation_check_run`: requests one approved automated check by id. The server executes
  its exact approved command in the task worktree, captures bounded output and exit status, reads
  the observed commit, and persists pass or fail.
- `task_implementation_amendment_propose`: submits expected state, observed state, impact, and
  proposed Plan Markdown. It opens a human gate and instructs the provider to stop. The server
  derives affected ids from the structural graph diff.
- `task_implementation_complete`: proposes completion with a concise summary. It does not accept a
  caller-supplied commit as authority.

Tool handlers derive environment, task, occurrence, session, provider turn, and worktree from the
invocation scope. They reject stale, superseded, non-primary, cross-task, and cross-worktree calls.
Raw context and tool payloads remain internal; the conversation shows concise task activities.

### 7. Progress and checks

`TaskWorkspace.build` remains the durable implementation projection. Provider tools call service
operations that enforce the existing phase, dependency, check, checkpoint, and amendment
invariants. The browser never mutates progress optimistically.

Automated checks run only when their exact command was approved in the Plan or an approved
amendment. A `TaskWorktreeCommandRunner` applies the same enforced filesystem boundary as
`task-worktree-write`, starts with a minimal environment, and disables network and credential
forwarding. Execution has a bounded timeout and bounded output. The runner records HEAD and
canonical worktree status before and after the command. A command that changes HEAD or worktree
status fails the attempt and leaves the changed state visible for recovery.

Each run creates a durable check attempt before process spawn. The attempt records its stable id,
check id, Plan revision, starting commit, command digest, operation key, status, timestamps, bounded
output, exit status, and observed ending commit. Add an `implementation-check` outbox target. A
pending attempt may start once. A running attempt whose process result cannot be reconciled after
restart becomes `indeterminate`; startup never reruns it automatically. The user must inspect the
worktree and explicitly request a new attempt.

A failed or indeterminate attempt blocks its work item and remains visible. A user can explicitly
rerun an approved check, which creates the next attempt id. Manual checks require a human-authored
outcome and note; the server reads and stores the current HEAD when the result is recorded.

Every required automated and manual pass binds to one exact commit. Whenever the server observes a
new HEAD during progress, continuation, amendment, check, or completion handling, it marks passes
for another commit `stale`. Stale, failed, blocked, running, and indeterminate checks block
completion. The worktree must return to a clean state and all required checks must pass again at the
final HEAD.

These Build checks guide implementation. The later Verify slice independently evaluates acceptance
criteria against the resulting commit.

### 8. Checkpoints and continuations

A checkpoint is a human gate. Reaching one records its reason, phase, check ids, observed commit,
and waiting status. The provider is instructed to stop the turn and no later work item can start.

The current task panel exposes **Continue** when required work and checks pass. Continue creates a
bounded context manifest from the approved Plan revision, current Build projection, checkpoint, and
relevant amendment history. It starts one deterministic continuation session, records the
association, and marks the checkpoint continued only after the session is ready.

Response loss or restart retries the same manifest, session, thread, and kickoff identities.

### 9. Amendments

An amendment proposal is append-only and references the current approved Plan revision, triggering
phase and work item, an optional triggering check, expected state, observed state, impact, proposed
Plan Markdown, and provider turn. Widen `triggeringCheckId` to nullable with a decoding default of
`null` so checkless and compatibility-projection work can request an amendment. The provider does
not declare the authoritative invalidation set.

The task panel shows the Plan diff with **Approve amendment** and **Request changes**. Approval:

1. appends the proposed Plan as the next Plan artifact revision;
2. records actor and server time;
3. compiles the proposed graph and compares it with the prior compiled graph by stable ids;
4. derives changed, added, and removed nodes plus their reverse dependency closure;
5. invalidates that server-derived closure while preserving completed nodes whose definitions and
   dependencies are unchanged; and
6. starts one bounded implementation continuation.

Request changes closes that proposal with feedback and starts a continuation that may submit a new
proposal. Neither path mutates an approved Plan revision in place.

### 10. Completion

`task_implementation_complete` creates a proposal tied to the active provider turn. The server
commits completion only after that turn finishes successfully and it confirms:

- every required phase and work item is completed;
- every required automated and manual check passes at the current HEAD;
- no check attempt is pending, running, blocked, stale, or indeterminate;
- no checkpoint or amendment gate is open;
- the task worktree has no tracked or untracked changes;
- `git symbolic-ref --short HEAD` equals the expected task branch;
- `git rev-parse HEAD` equals `git rev-parse refs/heads/<task-branch>`;
- the pinned base commit is an ancestor of HEAD; and
- the active occurrence and Plan revision still match the proposal.

The server records HEAD as `resultingCommitSha`, marks the occurrence and session completed, and
retains `build` as the current stored stage until the verification slice adds its transition.
Aborted or failed turns reject the proposal and leave Implement recoverable.

### 11. Recovery and idempotency

Reuse the transactional event, command receipt, operation receipt, and outbox model. Add stable
operation keys for:

- workflow upgrade;
- initial Implement start;
- checkpoint continuation;
- amendment continuation;
- each approved check attempt; and
- implementation completion settlement.

Every external side effect has deterministic thread, session, turn, message, manifest, worktree,
check-attempt, and proposal identities. Startup reconciliation reads persisted task state,
canonical provider turn state, and command-runner state before retrying. It never allocates a
second active primary session for one occurrence and never automatically reruns a check whose
prior process result is unknown.

## Current UI behavior

Keep the current two-column Task route:

- The main column renders the active Implement conversation through the normal chat surface.
- The compact right panel includes Clarify through Implement in the stage rail.
- Approved Plan remains readable and linked to the Build projection.
- Implement shows phases, work items, check status and output, current commit, checkpoint state,
  amendment diff, invalidation, retry, and completion state.
- Human actions are limited to Start Implement, retry failed start, run or rerun an approved check,
  record a manual check, continue a checkpoint, and review an amendment.
- Disabled controls explain the unmet dependency, check, worktree, or gate condition.
- Reload renders only server-persisted state.

Extract reusable implementation presentation from the historical `BuildPanel` instead of routing
current Guided tasks through the historical workspace surface. Session linking, raw manifests,
fixture actions, and artifact editors remain outside the default product path.

## Implementation sequence

1. **Contracts and catalog:** Add `guided@0.3.0`, prompt pins, upgrade/start operations,
   implementation tool payloads, additive events, and compatibility decoding.
2. **Plan compiler:** Extract and test deterministic Plan compilation, strict new-Plan validation,
   and the one-phase compatibility projection.
3. **Workflow upgrade:** Implement the declared `guided@0.2.0` upgrade edge and eligibility checks.
4. **Implementation bootstrap:** Generalize stage bootstrap by execution profile, worktree, and
   kickoff context; add initial and continuation recovery tests.
5. **Implementation bridge:** Add authorized context, progress, check, amendment, and completion
   tools with provider capability checks.
6. **Build integration:** Connect typed tools to phase, work-item, check, checkpoint, and amendment
   service operations. Replace fixture-only checks on the current product path with approved real
   commands.
7. **Completion:** Add server-observed worktree and commit validation plus turn-settled completion.
8. **Current UI:** Extend `GuidedTaskPanel` and extract reusable progress presentation without
   exposing historical control surfaces.
9. **Browser and E2E:** Add focused browser tests and extend the form-driven `@task-workspaces`
   desktop scenario through completed Implement, including restart recovery.
10. **Acceptance:** Perform provider-backed manual validation, independent review, repository gates,
    and evidence mapping before marking the slice implemented.

## Acceptance criteria

1. **TM-S2-AC01, versioning:** New Guided tasks pin `guided@0.3.0`; historical definitions remain
   unchanged; an eligible approved `guided@0.2.0` task can upgrade explicitly without losing its
   task, Plan, gate, session, or artifact identity.
2. **TM-S2-AC02, start:** Plan approval or explicit Start Implement creates exactly one Implement
   occurrence and one primary provider session after the managed worktree is ready. Never policy
   blocks start until the user chooses Now or Later.
3. **TM-S2-AC03, isolation:** The Implement session uses the pinned provider selection and an
   adapter-enforced `task-worktree-write` sandbox rooted at the canonical task worktree. Adversarial
   writes to the source checkout, sibling worktrees, credentials, and host paths fail. Providers
   without that enforcement are ineligible.
4. **TM-S2-AC04, approved context:** The provider can load the exact approved Plan revision,
   compiled work graph, bounded prior context, and current implementation state without receiving
   trusted instructions or unrelated task data in the tool result.
5. **TM-S2-AC05, durable progress:** Valid typed phase and work-item progress survives reload and
   restart. Unknown ids, stale revisions, incomplete dependencies, failed checks, and non-primary
   sessions cannot advance work.
6. **TM-S2-AC06, checks:** Only exact automated commands approved by a Plan or amendment run inside
   the enforced command sandbox. Durable attempts persist output, exit status, commit, timeout, and
   failure. Unknown post-spawn outcomes become indeterminate and never rerun automatically. Manual
   results require a human note and server-observed commit. Any pass against another HEAD becomes
   stale.
7. **TM-S2-AC07, checkpoints:** A configured checkpoint blocks later progress, renders its reason
   and commit, and continues through exactly one bounded continuation session after human action.
8. **TM-S2-AC08, amendments:** A provider can propose a Plan amendment with or without a triggering
   check, including from the checkless compatibility projection. The user can approve it or request
   changes. Approval appends a reviewable Plan revision, and stable graph ids plus a server-derived
   structural dependency closure determine targeted invalidation before a recoverable continuation
   starts.
9. **TM-S2-AC09, completion:** Implementation completion fails for dirty worktrees, detached or
   mismatched branches, open gates, incomplete work, non-current required checks, stale Plan
   revisions, or failed provider turns. Success records the server-observed branch HEAD, whose base
   lineage is verified, and completes Implement without starting Verify.
10. **TM-S2-AC10, recovery:** Restart or response loss at worktree provisioning, initial bootstrap,
    active work, check execution, checkpoint, amendment, continuation, and completion settlement
    restores the same semantic operation without duplicate worktrees, occurrences, sessions, turns,
    check attempts, Plan revisions, or automatic reruns of indeterminate commands.
11. **TM-S2-AC11, current surface:** The canonical Task route keeps the active conversation central
    and exposes Implement progress and human gates in the compact panel without fixture controls,
    manual session linking, raw manifest controls, or historical workspace routing.
12. **TM-S2-AC12, cumulative proof:** One form-driven desktop E2E path uses a real task-stage-capable
    provider from New task through completed Implement, covers at least one checkpoint and approved
    amendment, restarts during Implement, and asserts the exact resulting commit.

## Verification plan

### Automated coverage

- Contract tests cover new command, event, tool, and workflow schemas plus `@0.3.0` decoding.
- Catalog parity tests prove server and web resolve the same Guided stages and capabilities.
- Pure compiler tests cover valid plans, fallback plans, explicit stable ids, duplicate ids,
  dependency cycles, structural diffs, server-derived invalidation closure, and check approval.
- Provider conformance tests prove the `task-worktree-write` profile rejects source, sibling, and
  host writes and prevents shell, tools, and checks from reading provider or MCP credentials.
  Unsupported adapters fail eligibility without fallback.
- Service tests cover upgrade eligibility, Plan approval start, Never policy, isolated bootstrap,
  tool authorization, progress invariants, commit-bound check staleness, approved check execution,
  checkpoint continuation, amendment review, exact branch completion, and optimistic conflicts.
- Crash-injection tests cover every external side-effect boundary, including pre-spawn and
  post-spawn check attempts, indeterminate outcomes, and startup reconciliation.
- Browser tests cover stage rail, start and retry, progress, failed checks, checkpoint, amendment
  diff, invalidation, completion, and hidden historical controls.
- Desktop E2E extends the cumulative form-created Guided scenario under `@task-workspaces`.

### Manual acceptance

Use `playwright-cli` against the running web app or attach to Electron. Capture snapshots for each
acceptance criterion, including source-checkout isolation, checkpoint continuation, amendment
review, restart recovery, and the exact final commit.

Use a real configured provider and repository with a deterministic two-phase task. Record the task
URL, provider and model selection, worktree path, approved Plan revision, continuation session ids,
command outputs, resulting commit, and source checkout status.

### Required repository gates

```bash
vp check
vp run typecheck
vp run check:okf
vp run test
vp run release:smoke
vp run e2e --project desktop-dev --grep @task-workspaces
```

## Failure and rollback

- Failed start preserves the approved Plan and exposes Retry for the same operation key.
- Failed provider turns preserve durable progress and expose a recoverable continuation action.
- Failed checks persist output and block dependent completion.
- Failed amendment or checkpoint continuation keeps the gate visible and retryable.
- Failed completion leaves the occurrence running or blocked and does not record a resulting commit.
- The feature can be disabled for new tasks by removing `guided@0.3.0` from the current catalog
  pointer while keeping the definition registered for existing tasks.
- Persisted events, artifacts, sessions, and workflow pins are never rewritten during rollback.

## Delivery record — 2026-08-04

Implemented in commits `c7e4109fb`, `88793ffcc`, `e6adff2da`, `adeeac8cb`, `910285d9a`,
`db26f0116`, `b746a694c`, `5fee4d9a4`, `a29db891e`, `7efe17e9e`, `03801fae0`, `18fc2bb58`, and
`b3805832b`. The delivery includes the append-only `guided@0.3.0` workflow, explicit upgrade and
start, provider-owned write-enabled implementation, bounded context, exact check evidence,
checkpoint continuation, amendment review, restart recovery, Codex credential isolation, and
conversation-first Implement presentation.

Automated evidence is recorded in
[Slice 2 implementation validation](/specs/evidence/2026-08-04-task-mode-slice-2-implementation-validation.md).
The authenticated desktop E2E path remains open because this environment lacks
`CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`; no provider-backed acceptance is claimed for that
criterion.

## Explicitly deferred work

No new durable work is deferred by this child spec. Guided verification, Standard and Freeform,
and Deliver remain assigned to Vertical Slices 3 through 5 in the parent design.

## Approval record

- **Approved at:** 2026-08-03T22:45:20Z
- **Decision:** The execution profile, approved-check policy, `guided@0.3.0` workflow, compatibility
  projection, upgrade UX, recovery model, and acceptance criteria are approved.
- **Independent review:** No blocking or high findings remain.
- **Implementation gate:** Provider-backed Vertical Slice 1 acceptance must complete before product
  code changes begin.
