---
type: Spec
title: "Task workspaces — artifact-driven workflows delivered as autonomous vertical slices"
description: "Replacement architecture for Task Mode: tasks are versioned workspaces containing repository bindings, sessions, artifacts, comments, workflow runs, verification evidence, source context, and delivery state; implementation proceeds through independently specified vertical slices."
status: Draft
tags: [specs, task-workspaces, workflows, artifacts, orchestration, comments, verification, delivery, web, desktop]
timestamp: 2026-07-28T00:00:00-07:00
supersedes_on_approval: /specs/2026-07-03-task-mode-design.md
---

# Task workspaces — artifact-driven workflows delivered as autonomous vertical slices

## Status

**Draft.**

When approved, this spec supersedes
[Task mode — workflow-driven tasks with a live plan artifact panel](/specs/2026-07-03-task-mode-design.md).
Until then, the July 3 spec remains the approved source of truth.

This document is the parent architecture and delivery roadmap. It does **not** authorize a
single large implementation. Every vertical slice defined below must receive its own dated
child spec before code changes begin. Approval of this parent spec delegates child-spec
approval to an autonomous agent only under the rules in
[Autonomous slice delivery contract](#autonomous-slice-delivery-contract).

## Goal

Make Tasks a first-class workspace for sustained agent work rather than a rigid workflow run.

A task workspace contains:

- one or more repository bindings and their worktrees;
- a versioned workflow definition and the current workflow run;
- multiple agent sessions, including repeated, forked, and ad hoc sessions;
- a collection of independently reviewable artifacts;
- comments anchored to stable artifact blocks;
- hierarchical Build phases and work items;
- acceptance criteria and commit-specific verification evidence;
- optional external source context, such as a GitHub issue;
- delivery state through a draft pull request.

The product must support structured workflows without forcing every task through the same
shape. It must preserve the strongest parts of the July 3 design: durable event-sourced task
state, provider neutrality, fresh context between major reasoning phases, explicit human
gates, fail-loud behavior, and committed artifacts.

## Why revise the July 3 design

The July 3 design correctly made tasks durable and workflow-aware, but it couples too much
behavior to one workflow and one Markdown artifact:

1. One artifact owns plan content, workflow completion flags, mutable work-item status,
   acceptance results, and comment commands.
2. V1 ships one built-in workflow while deferring workflow choice, Research, Design, and
   Ship.
3. One thread is created per stage, making repeated research, alternative plans, and ad hoc
   debugging awkward.
4. A task owns one project and one worktree, which makes later multi-repository work a
   contract migration.
5. Build is one long stage with no first-class phase checkpoints.
6. Cross-stage revision is deferred even though Build commonly disproves approved plan
   assumptions.
7. Server schemas are intended to freeze before the product interaction is proven end to
   end.

The replacement architecture treats the task as a workspace containing workflow runs,
sessions, artifacts, and repository bindings. Workflow orchestration remains explicit, but it
is no longer the task's entire identity.

## Design influences

This design adapts several useful patterns from HumanLayer's public task and RPI approach:

- tasks as containers for sessions, artifacts, and worktrees;
- separate research, design, plan, implementation, and validation outputs;
- explicit phase boundaries that compact context;
- reviewable artifacts rather than a single growing conversation;
- implementation phases with automated and manual checkpoints;
- external ticket intake and delivery linkage.

Kata does not copy HumanLayer's workflow names or require a long workflow for every task.
Kata retains a distinct Verify stage, provider-neutral orchestration, server-owned durable
state, and explicit user signoff.

## Product principles

1. **Task is a workspace.** Workflow state is one part of the task, not the task itself.
2. **Artifacts are first-class.** A task owns an artifact collection, not one overloaded file.
3. **Markdown is content, not a control channel.** Human-facing files do not carry mutable
   orchestration commands.
4. **Fresh context is curated context.** New sessions receive an explicit context manifest,
   not an unbounded transcript or every task file.
5. **Plans can be amended.** Build and Verify may request a controlled return to Plan without
   deleting history.
6. **Build is hierarchical.** Phases, work items, checks, and checkpoints are separate
   concepts.
7. **Verification is evidence-backed.** Results are tied to acceptance criteria and a tested
   commit.
8. **Workspaces are plural-ready.** The domain uses repository arrays from the first slice,
   even while the initial UI supports one repository.
9. **Workflow and prompt versions are durable.** Existing tasks remain reproducible after
   definitions change.
10. **Provider behavior is uniform.** No provider-specific parsing of prose or tool output.
11. **Failures are visible.** Invalid transitions, stale evidence, setup errors, and contract
    mismatches block progress.
12. **Learn before freezing.** The first walking slice proves the interaction before v1
    contracts are declared stable.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Task** | Top-level durable unit of work and product workspace. |
| **Workspace** | Repository bindings, provisioning policy, worktrees, setup state, and local-file policy owned by a task. |
| **Workflow definition** | Versioned stage graph and policy bundle selected for a task. |
| **Workflow run** | Task-specific execution of a workflow definition. |
| **Stage instance** | One occurrence of a workflow stage. Stage instances may repeat after restart or amendment. |
| **Session** | One provider conversation attached to a task and optionally to a stage instance. |
| **Artifact** | Stable task-owned output with one or more revisions, such as questions, research, design, plan, verification report, HTML mockup, or image. |
| **Artifact revision** | Immutable record of an artifact's content hash, path, producer session, and source commit at a point in time. |
| **Block** | Stable addressable region inside an artifact used for comments and context selection. |
| **Comment** | Threaded note anchored to an artifact block or task entity. |
| **Build phase** | Ordered implementation unit containing work items and checkpoint policy. |
| **Work item** | Server-owned execution record derived from an approved plan. |
| **Checkpoint** | Policy boundary after a Build phase or check result. |
| **Amendment** | Reviewed change to an approved plan triggered by Build or Verify findings. |
| **Verification record** | Pass, fail, or blocked result for one acceptance criterion at one commit SHA. |
| **Source** | Optional external origin such as inline text, GitHub issue, Linear ticket, or Jira issue. |
| **Delivery** | Branch, commits, pull request, source linkage, and delivery status. |

## Locked architecture decisions

### 1. Task domain

The top-level domain remains `Task`, but its shape changes from a workflow-centric record to a
workspace aggregate:

```text
Task
├─ id, name, slug, description, createdAt, updatedAt
├─ status: active | paused | awaiting-user | blocked | verified
│          | delivered | abandoned
├─ source?: TaskSource
├─ workspace: TaskWorkspace
├─ workflowRun: WorkflowRun
├─ sessions: Session[]
├─ artifacts: Artifact[]
├─ comments: CommentThread[]
├─ build?: BuildExecution
├─ verification: VerificationRecord[]
├─ delivery: TaskDelivery
└─ versions:
     taskContractVersion
     artifactContractVersion
     workflowDefinitionVersion
     promptBundleVersion
```

All mutable task process state is event-sourced through the existing
contracts → commands/events → projections → WebSocket pipeline.

### 2. Workspace and repositories

The workspace is plural-ready from the first implementation:

```text
TaskWorkspace
├─ provisioningPolicy: now | before-build | none
├─ primaryRepositoryId
├─ repositories: RepositoryBinding[]
└─ status: unprovisioned | provisioning | ready | failed | cleaned
```

```text
RepositoryBinding
├─ id
├─ projectId?
├─ repositoryUrl?
├─ sourceRef
├─ branch
├─ worktreePath?
├─ isPrimary
├─ setupCommand?
├─ copiedLocalFiles: LocalFileBinding[]
└─ status: unprovisioned | provisioning | ready | failed | removed
```

Slice 1 exposes one repository in the UI but persists it in
`workspace.repositories`. Multi-repository provisioning arrives later without replacing the
contract.

Provisioning is workspace lifecycle, not a user-visible workflow stage:

- `now` provisions when the task is created;
- `before-build` allows Questions, Research, Design, and Plan without a worktree;
- `none` supports freeform or documentation-only tasks.

### 3. Workflow definitions and runs

Workflow definitions are versioned data:

```text
WorkflowDefinition
├─ id
├─ version
├─ label
├─ description
├─ stageDefinitions: StageDefinition[]
└─ defaults:
     gatePolicies
     checkpointPolicy
     provisioningPolicy
     contextBudget
```

```text
WorkflowRun
├─ workflowId
├─ workflowVersion
├─ currentStageInstanceId?
├─ stageInstances: StageInstance[]
├─ status: active | awaiting-gate | blocked | completed | abandoned
└─ policyOverrides
```

```text
StageInstance
├─ id
├─ stageDefinitionId
├─ ordinal
├─ status: pending | running | awaiting-input | awaiting-approval
│          | awaiting-signoff | blocked | failed | completed | skipped
├─ sessionIds
├─ inputArtifactRevisionIds
├─ outputArtifactIds
├─ startedAt, completedAt
├─ gateOutcome?
└─ supersedesStageInstanceId?
```

A stage may have more than one session and may be repeated. History is appended, not rewritten.

### 4. Built-in workflow presets

The product ships three built-in presets before custom workflow definitions:

#### Standard

```text
Questions → Plan → Build → Verify → Deliver
```

Research and Design may still occur as ad hoc sessions or artifacts.

#### Guided

```text
Questions → Research → Design → Plan → Build → Verify → Deliver
```

Each reasoning phase produces a separate artifact and fresh session.

#### Freeform

No required stage rail. The task owns sessions and artifacts; the user may explicitly start
Plan, Build, Verify, or Deliver actions when useful.

`Deliver` never auto-merges. It may create or update a draft pull request after verification.

### 5. Sessions

A task owns a session collection:

```text
Session
├─ id
├─ taskId
├─ stageInstanceId?
├─ role: primary | reviewer | alternative | debugging | ad-hoc
├─ provider
├─ status
├─ parentSessionId?
├─ forkPoint?
├─ contextManifestId
├─ producedArtifactIds
└─ createdAt, completedAt
```

The orchestrator launches a default session for structured stages, but the model and UI allow:

- another research pass;
- an alternative design or plan;
- a fresh adversarial reviewer;
- a focused debugging session during Build;
- a fork from an earlier session point;
- an ad hoc task conversation.

A session is never inferred to equal a stage.

### 6. Artifact collection and revisions

Artifacts are independently addressable and reviewable:

```text
Artifact
├─ id
├─ taskId
├─ kind: intake | questions | research | design | plan | amendment
│        | progress | verification | delivery | attachment | custom
├─ title
├─ currentRevisionId
├─ revisionIds
├─ status: draft | in-review | approved | superseded | final
├─ blockIndex
└─ createdAt, updatedAt
```

```text
ArtifactRevision
├─ id
├─ artifactId
├─ revision
├─ path
├─ mediaType
├─ contentHash
├─ producerSessionId
├─ sourceCommitSha?
├─ createdAt
└─ supersedesRevisionId?
```

Artifacts may be Markdown, HTML, JSON, images, diagrams, or other task outputs. Markdown
frontmatter is minimal and portable:

```yaml
---
type: task-artifact
task_id: <task-id>
artifact_id: <artifact-id>
kind: plan
revision: 3
---
```

The following do **not** belong in human-facing artifact frontmatter:

- workflow completion flags;
- mutable work-item status;
- comment creation or resolution commands;
- gate transitions;
- acceptance result state.

The server snapshots a revision at stage output, approval, explicit save, amendment, and
verification boundaries. Content may remain a normal committed file in the workspace.

### 7. Stable blocks and comments

Addressable Markdown blocks use stable embedded IDs, for example:

```markdown
<!-- kata:block:approach-auth -->
## Authentication approach
```

The exact syntax may be refined in the relevant child spec, but block identity must survive
heading edits and document reordering.

```text
CommentThread
├─ id
├─ taskId
├─ artifactId
├─ anchorBlockId?
├─ baseRevisionId
├─ status: open | resolved | outdated | orphaned
├─ messages: CommentMessage[]
├─ createdAt, resolvedAt?
└─ resolvedBy?
```

Comments support replies and record real user or agent identity. `outdated` means the anchor
still exists but has changed since the base revision. `orphaned` means the anchor no longer
exists. Neither state silently drops the thread.

### 8. Server-owned task-control protocol

Agents update task process state through validated server commands, not by editing YAML flags.

All providers must have access to a provider-neutral task-control surface. The recommended
implementation is a workspace-local `kata task` CLI backed by a server command API or local
IPC route. The Slice 1 child spec must prove the transport before contracts stabilize.

The protocol must support operations equivalent to:

```text
artifact.register / artifact.revise
stage.complete / stage.fail
work-item.start / work-item.complete / work-item.fail
comment.resolve
checkpoint.request
amendment.request
verification.record
delivery.request
```

Requirements:

- every command is task- and session-scoped;
- every mutation carries an idempotency key;
- version-sensitive mutations carry an expected aggregate version;
- the server validates transition legality and emits domain events;
- retries are safe;
- command output is structured and recorded in the session event stream;
- no provider adapter parses prose markers or shell output to infer completion.

File watching remains useful for content refresh and external edits, but it is not the
workflow command channel.

### 9. Build phases and work items

The approved Plan artifact defines static implementation phases, work items, checks, and
acceptance criteria. The server registers those definitions into execution state.

```text
BuildExecution
├─ approvedPlanRevisionId
├─ phases: BuildPhaseExecution[]
├─ currentPhaseId?
├─ currentWorkItemId?
├─ checkpointPolicy
└─ status
```

```text
BuildPhaseExecution
├─ id
├─ title
├─ objective
├─ workItems: WorkItemExecution[]
├─ automatedChecks
├─ manualChecks
├─ checkpointPolicy: always | manual-only | on-failure | never
└─ status
```

Mutable execution status belongs to the server projection. The plan file remains readable and
stable.

Checkpoint policy is separate from approval policy. Tasks may:

- pause after every phase;
- pause only when manual checks exist;
- continue while automated checks pass;
- continue through all phases.

A single global `autoAdvance` boolean is not sufficient.

### 10. Controlled plan amendment

Build or Verify may discover that an approved assumption is false. The agent must not silently
deviate or discard progress.

The amendment flow is:

```text
Build or Verify finding
  → amendment requested
  → amendment artifact + plan diff
  → fresh review
  → explicit approval or rejection
  → affected work items invalidated as needed
  → resume from recorded checkpoint
```

An amendment records:

- what the approved plan expected;
- what the implementation or verification found;
- why it matters;
- proposed changes;
- affected phases, work items, and acceptance criteria;
- plan revision diff;
- gate outcome.

Stage history and previous plan revisions remain visible.

### 11. Verification records

Verification is a separate stage and always requires human signoff.

```text
VerificationRecord
├─ id
├─ taskId
├─ acceptanceCriterionId
├─ planRevisionId
├─ testedCommitSha
├─ result: pass | fail | blocked
├─ method: automated | manual | mixed
├─ command?
├─ evidenceArtifactRefs
├─ producerSessionId
├─ timestamp
└─ notes
```

If the tested branch changes after verification, affected results become `stale`; delivery is
blocked until required criteria are reverified.

The final signoff records the signing user, timestamp, plan revision, and tested commit SHA.

### 12. Source and delivery

Source and delivery are optional from the first contract version:

```text
TaskSource
├─ kind: inline | github | linear | jira
├─ externalId?
├─ url?
├─ snapshotArtifactId
├─ lastSyncedAt?
└─ syncStatus
```

```text
TaskDelivery
├─ status: not-started | ready | opening-pr | draft-pr | in-review
│          | merged | failed
├─ branch?
├─ commitSha?
├─ pullRequestUrl?
├─ externalSourceUpdateStatus?
└─ lastError?
```

Initial slices may support only inline input and GitHub issues. Linear and Jira adapters remain
future integrations, but adding them must not require replacing the Task contract.

Delivery creates or updates a **draft** pull request. It never merges automatically.

### 13. Context manifests

Each session starts from a durable context manifest:

```text
ContextManifest
├─ id
├─ taskId
├─ sessionId
├─ workflowVersion
├─ promptBundleVersion
├─ repositoryRefs
├─ artifactSelections:
│    artifactRevisionId
│    selectedBlockIds?
│    inclusionReason
├─ unresolvedCommentIds
├─ priorStageOutcomes
├─ generatedSummaryArtifactIds?
├─ estimatedTokens
└─ createdAt
```

Rules:

- approved artifacts, not conversation memory, are the default handoff;
- a full artifact is included only when it fits the configured context budget;
- otherwise the manifest selects blocks or a generated summary artifact;
- successful command and test logs are summarized and linked;
- failure output is included in detail;
- every session can show the user exactly what context it received;
- a fork records its parent manifest and any additional selections.

### 14. Gates and review policies

Gate policy is defined per stage:

```text
none | manual | auto-if-clean
```

Plan defaults to `manual`. A task may opt into `auto-if-clean`, but only after an independent
fresh-context review produces no unresolved blocking comments.

Verify signoff is always manual.

Build checkpoint policy is separate and may be task-specific.

Delivery never merges automatically.

### 15. UI shape

Tasks remain in a collapsible sidebar section, but selecting a task opens a dedicated task
workspace rather than treating the experience as only a thread with a right-side plan panel.

The desktop/web task view contains:

- **Task header:** name, status, workflow preset/version, source, repository readiness, and
  task actions.
- **Workflow rail or timeline:** structured stages for Standard/Guided; session/artifact
  timeline for Freeform.
- **Session navigator:** all task sessions with stage, role, provider, and status.
- **Conversation area:** active session.
- **Workspace panel:** tabs for Artifacts, Build, Comments, Verification, Repositories, and
  Delivery.
- **Gate controls:** approval, request changes, amendment review, signoff, and delivery.
- **Evidence browser:** criterion results and linked screenshots, recordings, logs, and
  outputs.

The workspace panel is task-keyed and persists while switching sessions.

Mobile may render task sessions as ordinary conversations with a read-only task summary until
a native task UI is separately specified.

## Reliability, concurrency, and recovery

- Commands use aggregate versions or compare-and-set semantics to prevent two sessions from
  advancing the same stage or work item.
- Idempotency keys make provider retries safe.
- Server restart rehydrates tasks, workspace provisioning, sessions, artifacts, comments,
  workflow runs, Build state, verification, and delivery.
- A session failure does not erase stage history. Retry starts a new stage session or resumes
  only where the provider supports safe continuation.
- Artifact parse or block-index failure is visible and blocks only behavior that depends on
  the invalid content.
- Stale comment anchors, plan revisions, verification records, and delivery SHAs are explicit.
- Worktree cleanup is an explicit task lifecycle action with preview and confirmation; it is
  not silently performed on verification.
- Long-running Build sessions checkpoint after work items and may start a fresh continuation
  session from the artifact and Build projection.

## Security and privacy

- Setup commands and copied local files require explicit task policy and visible provenance.
- Copied local files are allowlisted; secrets and credentials are excluded by default and
  marked never-commit.
- Setup command output is captured with timeouts and redaction.
- Source attachments are treated as untrusted input.
- Evidence generation must redact tokens, local home paths when sensitive, private issue
  content, and provider credentials.
- Agent task-control commands are authorized to the current task and session only.
- Delivery requires a verified commit and cannot target an unexpected repository or branch.
- No task or evidence artifact may contain plaintext provider credentials.

## Contract versioning and migrations

Persist:

```text
taskContractVersion
artifactContractVersion
workflowDefinitionVersion
promptBundleVersion
```

Migration rules:

- tasks retain the workflow and prompt versions they started with unless explicitly upgraded;
- workflow definition changes create a new version rather than mutating active runs;
- migrations are idempotent and produce a report;
- the July 3 Task model is not migrated until the Slice 1 interaction is accepted and the
  replacement contract is stable;
- development fixtures may be reset before stability, but real persisted tasks must not be
  silently discarded.

## Autonomous slice delivery contract

Approval of this parent spec delegates each child slice from planning through a **draft pull
request**, subject to the rules below. It does not authorize merging.

### Child-spec requirement

Before implementing a slice, the agent creates:

```text
docs/specs/YYYY-MM-DD-task-workspaces-slice-<NN>-<slug>.md
```

Each child spec must include:

1. Parent spec and prerequisite slice SHAs.
2. Current-state code research with exact file paths.
3. User-visible end-to-end scenario.
4. Locked scope and explicit non-goals.
5. Contract, event, projection, storage, and migration changes.
6. Exact UI states and interaction behavior.
7. Provider and platform scope.
8. Detailed implementation sequence.
9. Observable acceptance criteria with stable IDs.
10. Automated test matrix.
11. UAT and evidence plan.
12. Failure, recovery, security, and rollback behavior.
13. PR handoff and deferred work.

### Delegated approval

A child spec may move from Draft to Approved without another human round only when:

- it stays inside this parent spec and the named slice;
- it does not revise a locked parent decision;
- current-state research is complete;
- a fresh-context adversarial reviewer evaluates scope, feasibility, migrations, security,
  acceptance criteria, and evidence requirements;
- all blocking findings are incorporated or explicitly rebutted with evidence;
- no unresolved product or business decision remains;
- the child spec records the review and why delegated approval applies.

The parent approval acts as the explicit user authorization required to implement a conforming
child spec.

The agent must stop for human direction when a child spec would:

- change a locked parent decision;
- require a destructive or irreversible migration;
- introduce a paid external dependency or new credential requirement;
- expose secrets or materially change the security boundary;
- reduce acceptance scope because implementation is difficult;
- leave an unresolved design choice with materially different user behavior.

### Autonomous implementation sequence

For each slice, the agent:

1. Reads this parent spec and all prerequisite slice specs.
2. Researches the current repository and drafts the child spec.
3. Runs adversarial spec review and applies corrections.
4. Records delegated approval.
5. Creates a dedicated branch/worktree.
6. Implements the full slice without starting later slices.
7. Runs focused tests continuously and repository-wide required gates at completion.
8. Runs a fresh-context strict code review and fixes blocking findings.
9. Executes UAT through normal product behavior.
10. Captures and verifies evidence.
11. Runs an adversarial evidence review against every acceptance criterion.
12. Creates intentional commits.
13. Pushes the branch and opens a **draft PR**.
14. Updates the PR body with the acceptance matrix, evidence, test output, known gaps, manual
    run instructions, rollback, and `Recommendation: Pending user sign-off`.

The agent never merges the PR or marks human acceptance complete.

### Slice sequencing

Slices are implemented sequentially unless a later child spec proves that it touches no
shared contracts or UI surfaces.

Implementation of slice N+1 begins from the accepted or merged result of slice N. Its child
spec records the exact base SHA. Research may begin earlier, but code must not assume unmerged
contracts.

Each PR contains one slice. Incidental fixes outside slice scope require a separate commit and
must be called out, or a separate PR when substantial.

### Blocked delivery

If external credentials or unavailable infrastructure block one acceptance criterion, the
agent may open a blocked draft PR only when the child spec explicitly permits credentialed
maintainer-local evidence. The criterion remains `Blocked`, not `Pass`, and the PR cannot
claim completion.

## Evidence standard for every slice

Use the existing
[User Acceptance Evidence workflow](../../.agents/skills/plan-build-verify/references/user-acceptance/workflow.md)
and its helpers.

Evidence is generated under:

```text
uat-evidence/<target>-<YYYYMMDD-HHMMSS>/
├─ evidence.json
├─ evidence.md
├─ screenshots/
├─ recordings/
├─ logs/
├─ responses/
└─ outputs/
```

The evidence manifest must include:

- slice ID and child-spec path;
- verified code SHA;
- task contract, artifact contract, workflow, and prompt versions;
- provider and platform;
- each acceptance criterion with Pass, Fail, or Blocked;
- exact evidence paths;
- commands and exit codes;
- adversarial evidence-review result.

Requirements:

1. **Video for user-visible UI slices.** Capture the normal end-to-end path, including a
   failure or recovery state when the slice adds one. Playwright or Electron recordings are
   acceptable when they show the real product surface.
2. **Screenshots at meaningful checkpoints.** At minimum: initial state, main transition,
   approval/checkpoint state, final state, and any required error state.
3. **Command output.** Save focused tests, type checking, repository gates, migrations,
   task-control transcripts, server logs, and Git/GitHub commands with exit codes.
4. **Product outputs.** Save generated artifacts, context manifests, event/projection
   snapshots, verification reports, or PR bodies relevant to the slice.
5. **Adversarial review.** A fresh reviewer must issue Pass or Fail for every criterion and
   cite evidence paths.
6. **Manual run instructions.** The PR must tell a maintainer how to reproduce the visible
   behavior through normal product actions.
7. **No unilateral acceptance.** Every slice ends with
   `Recommendation: Pending user sign-off`.
8. **Artifact storage.** Small text evidence and selected screenshots may be committed when
   useful. Large recordings and traces should be uploaded as CI/PR artifacts and linked from
   `evidence.md`; do not add large opaque binaries to Git history.
9. **Redaction.** Run a secret/path review before publishing evidence.
10. **Verified SHA discipline.** If evidence is captured before an evidence-only commit, the
    manifest records the product-code SHA and the final PR diff after that SHA may contain
    only evidence or documentation changes.

## Program acceptance criteria

The full task-workspaces program is complete when:

1. **TW-AC1** Tasks persist as workspace aggregates with repository arrays, workflow runs,
   sessions, artifacts, comments, Build state, verification, source, delivery, and explicit
   contract versions.
2. **TW-AC2** Standard, Guided, and Freeform presets are selectable and persist their exact
   workflow definition versions.
3. **TW-AC3** A user can complete Standard end to end:
   Questions → Plan approval → Build → Verify signoff → draft PR.
4. **TW-AC4** Guided produces separate Questions, Research, Design, and Plan artifacts with
   curated context manifests between stages.
5. **TW-AC5** A task can own multiple sessions in a stage, an ad hoc session, and a fork,
   without corrupting workflow state.
6. **TW-AC6** Artifact revisions, lineage, stable block comments, replies, resolution,
   outdated state, and orphan state survive restart.
7. **TW-AC7** No human-facing artifact contains mutable workflow commands; provider-neutral
   task-control commands are validated, idempotent, and event-sourced.
8. **TW-AC8** Build executes hierarchical phases and work items with configurable checkpoints
   and survives restart.
9. **TW-AC9** Build or Verify can request a reviewed plan amendment and resume without
   deleting prior history.
10. **TW-AC10** Verification results are criterion- and commit-specific; changed code makes
    affected results stale and blocks delivery.
11. **TW-AC11** The workspace model supports more than one repository with one primary
    repository and independent provisioning/setup state.
12. **TW-AC12** A GitHub issue can seed a source artifact and remain linked through delivery.
13. **TW-AC13** Delivery creates or updates a draft PR only after required verification and
    never merges automatically.
14. **TW-AC14** Pi, Claude, and Codex complete the task-control contract without
    provider-specific prose parsing.
15. **TW-AC15** Task state and active work recover across server restart and client reconnect.
16. **TW-AC16** Every slice has a child spec, automated gates, experiential UAT, recordings,
    screenshots, command output, adversarial evidence review, and a draft PR.
17. **TW-AC17** Web and desktop share the task-workspace behavior; mobile ordinary-thread
    fallback does not error.

## Vertical slices (implementation phases)

Each phase below is a product-visible vertical slice. The bullets are parent requirements;
the child spec supplies exact files, contracts, migrations, and implementation details.

### Slice 1 — Walking skeleton: one Standard task from creation to signoff

**Purpose:** Prove the product interaction and the minimum architecture before freezing v1
contracts.

**User-visible path:**

1. Create a task from the sidebar.
2. Select **Standard**, one repository, base ref, and `before-build`.
3. Complete Questions in a session and produce a Questions artifact.
4. Produce a Plan artifact with one implementation phase, one work item, and one acceptance
   criterion.
5. Approve the Plan.
6. Provision the worktree automatically before Build.
7. Build a deterministic fixture change and show work progress.
8. Verify the criterion against the resulting commit.
9. Sign off and show the task as Verified. Deliver remains visible but unavailable.

**Required architecture:**

- Task aggregate with plural collections and all version fields.
- One-entry `workspace.repositories`.
- Versioned Standard workflow definition.
- Stage instances and one session per stage.
- Artifact collection and revisions for Questions, Plan, and Verification.
- Minimal provider-neutral task-control transport.
- Server-owned work-item status.
- Plan approval and Verify signoff.
- Restart/reconnect rehydration.
- Task-keyed workspace panel.
- Pi as the reference provider; shared web code with desktop-dev UAT.

Contracts remain provisional until Slice 1 UAT is accepted.

**Required evidence:**

- Continuous desktop recording: create → Questions → Plan → approve → restart app/server →
  Build → Verify → signoff.
- Screenshots: creation form; task workspace; Plan approval; provisioned repository; Build
  progress; verification criterion; final Verified state.
- Outputs: Questions, Plan, and Verification artifact files; context manifests; task event
  and projection snapshots.
- Logs: task-control command transcript; provisioning/Git output; focused tests; migration
  or fixture setup; `vp check`; `vp run typecheck`; Slice 1 E2E with exit codes.
- Negative proof: duplicate completion command is idempotent and an invalid transition is
  visibly rejected.
- Draft PR AC matrix for Slice 1 and TW-AC1/TW-AC3/TW-AC7/TW-AC15 partial coverage.

### Slice 2 — Artifact workspace, comments, revisions, and multiple sessions

**Purpose:** Make the task a reviewable workspace rather than a single stage thread.

**User-visible path:**

1. Open the Slice 1 task and view the artifact collection.
2. Start an alternative Plan session and produce another Plan revision or candidate.
3. Compare artifact lineage and select the current revision.
4. Comment on a stable Plan block, receive a revision, and resolve the thread.
5. Edit or remove an anchor and see `outdated` or `orphaned` state.
6. Start an ad hoc task session and a context fork without advancing the workflow.
7. Run an independent adversarial Plan review as a reviewer session.

**Required architecture:**

- Artifact list, revision history, lineage, and selection.
- Stable block index.
- Threaded comments and identity.
- Multiple sessions per stage.
- Ad hoc sessions and context forks.
- Reviewer session role.
- Artifact/comment task-control commands.
- No mutable process commands in artifact frontmatter.

**Required evidence:**

- Recording of alternative Plan session, artifact comparison, anchored comment, revision,
  resolution, ad hoc session, and fork.
- Screenshots: artifact list; revision lineage; comment open/resolved/outdated/orphaned;
  session navigator with role/provider; reviewer findings.
- Outputs: two context manifests; artifact revision records; block index; comment projection.
- Logs: whole-file rewrite and heading-change tests; comment identity/restart tests;
  session/fork projection tests; proof that artifact frontmatter contains only portable
  metadata.
- Negative proof: a direct YAML workflow flag edit does not advance the task.
- Draft PR AC matrix for TW-AC5/TW-AC6/TW-AC7.

### Slice 3 — Workflow presets and guided context boundaries

**Purpose:** Prove that the workflow engine is genuinely data-driven and that reasoning stages
produce compact handoffs.

**User-visible path:**

1. Create Standard, Guided, and Freeform tasks from the workflow picker.
2. Run a Guided task through Questions → Research → Design → Plan.
3. Inspect the separate artifacts and the context manifest used by each next-stage session.
4. Create a Freeform task, add sessions/artifacts, then explicitly start Plan or Verify.
5. Change the built-in workflow definition in development and show that existing tasks retain
   their original version.

**Required architecture:**

- Three built-in workflow definitions.
- Workflow picker and preset descriptions.
- Guided stage prompts and artifacts.
- Freeform timeline behavior.
- Prompt bundle and workflow definition versions.
- Context budget, block selection, summary artifacts, and manifest inspection UI.
- Lazy provisioning through reasoning stages.

**Required evidence:**

- Recording of workflow selection and a Guided Questions → Research → Design → Plan flow.
- Short second recording or trace showing Freeform sessions/artifacts without a fixed rail.
- Screenshots: workflow picker; Guided rail; separate artifacts; context manifest inspector;
  Freeform timeline; version display.
- Outputs: all Guided artifacts; exact context manifests; token estimates; versioned workflow
  snapshots.
- Logs: workflow schema round trips; old-version rehydration; context-budget tests; no
  worktree-before-Build assertion.
- Negative proof: modifying the latest workflow definition does not mutate an existing task.
- Draft PR AC matrix for TW-AC2/TW-AC4.

### Slice 4 — Hierarchical Build, checkpoints, and plan amendments

**Purpose:** Make implementation resumable, reviewable, and honest when codebase reality
differs from the Plan.

**User-visible path:**

1. Approve a Plan with at least two Build phases and automated/manual checks.
2. Execute phase 1 and pause according to checkpoint policy.
3. Continue phase 2 automatically while checks pass.
4. Encounter a deterministic mismatch between the Plan and fixture code.
5. Request an amendment with expected/found/impact/proposed changes.
6. Review the Plan diff and approve the amendment.
7. Resume Build from the checkpoint with affected work items invalidated.
8. Restart during Build and recover the exact phase/work-item state.

**Required architecture:**

- Hierarchical Build projection.
- Checkpoint policies.
- Automated and manual check records.
- Phase/work-item task-control commands.
- Amendment artifacts, plan revision diff, approval gate, and resume semantics.
- Continuation sessions for long Build work.
- Optional phase commits or commit references.

**Required evidence:**

- Recording of phase progress, checkpoint, mismatch, amendment gate, Plan diff, approval,
  resume, and completion.
- Screenshots: hierarchical Build panel; checkpoint controls; failed check; amendment detail;
  affected item invalidation; resumed state.
- Outputs: original and amended Plan revisions; amendment artifact; Build projection before
  and after; context manifest for continuation session.
- Logs: passing and failing check output; task-control transcript; restart recovery; Git
  history showing phase boundaries when enabled.
- Negative proof: the agent cannot silently mark a mismatched work item complete or mutate
  the approved Plan without an amendment event.
- Draft PR AC matrix for TW-AC8/TW-AC9/TW-AC15.

### Slice 5 — Commit-specific verification and evidence browser

**Purpose:** Turn Verify into inspectable proof rather than a final agent summary.

**User-visible path:**

1. Verify several acceptance criteria using automated and manual methods.
2. View pass, fail, and blocked results with linked evidence.
3. Fix a failing criterion and re-run only affected verification.
4. Change the branch after verification and see previous results become stale.
5. Reverify the changed criteria.
6. Review the evidence browser and sign off the tested commit.

**Required architecture:**

- Verification records tied to criterion, plan revision, and commit SHA.
- Evidence browser and artifact linking.
- Pass/fail/blocked/stale state.
- Selective reverification.
- Human signoff record.
- Integration with the repo's UAT evidence helpers.
- Delivery guard against unverified or stale commits.

**Required evidence:**

- Recording of fail → fix → reverify → stale-after-change → reverify → signoff.
- Screenshots: criterion matrix; failed evidence; blocked state; stale warning; evidence
  preview; signoff confirmation.
- A complete `uat-evidence` directory containing `evidence.json`, `evidence.md`,
  screenshots, recording, logs, and outputs.
- Command logs with exit codes for every automated criterion.
- Adversarial evidence-review report citing each criterion's artifact.
- Negative proof: delivery remains blocked after a post-verification commit.
- Draft PR AC matrix for TW-AC10/TW-AC16.

### Slice 6 — Workspace expansion and GitHub source intake

**Purpose:** Prove the plural workspace model and source provenance without changing the core
Task contract.

**User-visible path:**

1. Create a task from an inline request and another from a GitHub issue.
2. View the immutable source snapshot artifact, issue comments/attachments metadata, and sync
   state.
3. Configure two repositories, choose a primary, and select independent source refs.
4. Use `now`, `before-build`, and `none` provisioning policies.
5. Provision one worktree per repository.
6. Run explicit setup commands and copy allowlisted local files with visible provenance.
7. Confirm secrets and never-commit files are excluded.

**Required architecture:**

- Multiple repository bindings and primary-repository rules.
- Independent worktree/setup status.
- Source adapter contract and GitHub issue adapter.
- Source snapshot artifacts and refresh.
- Setup command capture, timeout, redaction, and failure recovery.
- Local file allowlist and never-commit policy.

**Required evidence:**

- Recording of GitHub issue import, source artifact review, two-repository configuration,
  lazy provisioning, and setup completion.
- Screenshots: source picker/snapshot; repository panel; primary indicator; provisioning
  policy; setup output; redacted/excluded-file state.
- Outputs: source snapshot; repository binding projection; worktree paths and refs; setup
  logs; copied-file manifest.
- Logs: Git commands for each worktree; source refresh; setup success/failure; secret scan;
  negative `git status` proof for never-commit files.
- Negative proof: a setup command timeout fails loud and a repository cannot be delivered to
  the wrong remote.
- Draft PR AC matrix for TW-AC11/TW-AC12.

### Slice 7 — Delivery, draft PR creation, and source linkage

**Purpose:** Complete the autonomous task loop through an evidence-backed draft pull request.

**User-visible path:**

1. Open a verified task at its tested commit.
2. Review delivery readiness.
3. Request Deliver.
4. Create intentional commits if needed, push the branch, and open a draft PR.
5. Generate the PR body from source, approved Plan, Build summary, verification matrix,
   evidence links, risks, rollback, and manual instructions.
6. Link the PR to the GitHub issue and update task/source delivery state.
7. Retry safely without opening a duplicate PR.

**Required architecture:**

- Delivery readiness and tested-SHA guard.
- Commit/push/draft-PR orchestration.
- PR body generation.
- Existing-PR detection and idempotent update.
- GitHub source linking and status/comment update.
- Failure and retry state.
- No auto-merge path.

**Required evidence:**

- Recording from verified task through draft PR and linked source.
- Screenshots: delivery readiness; guarded stale state; pushing/opening progress; final task
  delivery card; created draft PR; linked GitHub issue.
- Outputs: generated PR body; delivery events/projection; source update payload.
- Logs: Git status/log; push; PR create/update; duplicate retry; remote/branch validation.
- Negative proof: stale verification blocks delivery and retry does not create a second PR.
- Draft PR AC matrix for TW-AC3/TW-AC13.

### Slice 8 — Provider parity, recovery, cleanup, and production hardening

**Purpose:** Prove the completed workflow across supported providers and failure modes.

**User-visible path:**

1. Complete a slim Standard task with Pi, Claude, and Codex.
2. Disconnect and reconnect a client during active work.
3. Restart the server during Questions, Build, and Verify.
4. Interrupt and retry a provider session.
5. Exercise concurrent commands and observe conflict handling.
6. Abandon or complete a task and explicitly preview/confirm worktree cleanup.
7. Open task sessions on mobile fallback without errors.

**Required architecture:**

- Provider-neutral task-control conformance suite.
- Per-provider prompt/task-control fixtures without prose parsing.
- Reconnect/restart recovery.
- Aggregate-version conflict UI and retry.
- Context continuation for long Build.
- Cleanup preview and explicit removal.
- Schema migration coverage and performance budgets.
- Web/desktop parity and mobile fallback.

**Required evidence:**

- One full recording on the reference provider plus slim recordings or continuous traces for
  the other providers.
- Screenshots: provider matrix; reconnect/recovered states; conflict error; cleanup preview;
  mobile fallback.
- Outputs: per-provider task-control transcripts; migration reports; projection snapshots;
  cleanup manifest.
- Logs: slim provider E2E matrix; restart/reconnect suites; concurrency tests; performance
  measurements; repository-wide gates.
- Negative proof: no provider-specific completion marker/parser exists in active code and
  cleanup never runs without explicit confirmation.
- Draft PR AC matrix for TW-AC14/TW-AC15/TW-AC17 and final regression coverage for all program
  criteria.

## Slice dependency map

```text
Slice 1  Walking skeleton
  ├─ Slice 2  Artifact workspace and sessions
  ├─ Slice 3  Workflow presets and guided context
  └─ Slice 4  Build phases and amendments
        └─ Slice 5  Verification evidence
              ├─ Slice 6  Workspace expansion and source
              └─ Slice 7  Delivery
                    └─ Slice 8  Provider/recovery hardening
```

Slices 2 and 3 may be researched in parallel after Slice 1 contracts stabilize, but their
implementation remains sequential by default.

## Parent-level testing strategy

Every child spec defines focused tests, but the program must accumulate these suites:

- **Contracts:** versioned Task, workspace, workflow, stage instance, session, artifact,
  comment, Build, verification, source, and delivery round trips.
- **State machine:** legal/illegal transitions, idempotency, expected-version conflicts,
  amendment flow, checkpoint policy, stale verification, and delivery guards.
- **Persistence:** restart migration and projection rehydration for every task subdomain.
- **Artifacts:** revision hashing, stable block indexing, comment states, content refresh, and
  no-control-frontmatter enforcement.
- **Context:** manifest determinism, budget enforcement, block selection, summary lineage, and
  fork inheritance.
- **Workspace:** provisioning policy, multi-repo worktrees, setup commands, local-file
  exclusion, and cleanup.
- **Providers:** task-control contract for Pi, Claude, and Codex.
- **Web/Desktop:** shared workspace panel logic, workflow rail, sessions, artifacts, Build,
  Verification, Repositories, and Delivery.
- **E2E:** one cumulative `@task-workspaces` core loop plus slice-specific tags.
- **UAT:** normal product walkthrough, recording, screenshots, outputs, and adversarial
  evidence review for every slice.

Required repository gates at the end of each slice child spec must include at least:

```bash
vp check
vp run typecheck
```

The child spec adds focused unit, browser, E2E, release-smoke, migration, and provider commands
appropriate to its scope.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| The domain becomes too broad before any UX is proven. | Slice 1 is a thin full loop; contracts remain provisional until its UAT is accepted. |
| Multiple artifacts increase context and UI complexity. | Artifact kinds, lineage, current revision, context manifests, and a dedicated workspace panel keep boundaries explicit. |
| A provider cannot call the task-control transport reliably. | Slice 1 treats transport as a blocking proof; all providers ultimately use the same structured CLI/API contract. |
| Artifact and server state diverge. | Artifacts own content and static definitions; server owns execution state; revisions and hashes make drift visible. |
| Repeated sessions race workflow state. | Aggregate versions, idempotency keys, and stage-instance ownership reject conflicting mutations. |
| Plans become stale during Build. | Controlled amendment flow records the finding and resumes from checkpoints. |
| Evidence is captured against the wrong code. | Every verification record and evidence manifest carries the tested commit SHA; later code changes mark results stale. |
| Multi-repo and setup features expose secrets. | Allowlisted files, never-commit policy, redacted setup logs, source validation, and secret scans. |
| Autonomous agents silently reduce scope. | Child specs inherit locked acceptance criteria; blocked criteria remain blocked; parent deviations require human direction. |
| Large recordings bloat Git history. | Store large video/trace artifacts in CI or PR artifacts and link them from the evidence report. |
| Eight slices create coordination overhead. | One child spec and one draft PR per slice; explicit dependency SHAs; no broad parallel implementation. |

## Explicitly deferred

- User-authored workflow editor and marketplace.
- Real-time multi-human collaborative editing.
- Native mobile task workspace.
- Linear and Jira source adapters beyond the versioned source contract.
- Automatic merge or deployment after PR creation.
- Cross-task dependency graphs and portfolio/WIP management.
- Autonomous paid-service provisioning.
- General-purpose artifact editor beyond task review needs.
- Workflow analytics and organization policy management.
- Background notifications and Slack/webhook delivery.

## Build handoff

No implementation begins from this parent spec alone.

After approval:

1. Create the Slice 1 child spec.
2. Research the current orchestration, worktree, task/sidebar, artifact, and provider bootstrap
   paths.
3. Prove the provider-neutral task-control transport.
4. Implement the walking skeleton as one end-to-end draft PR.
5. Gather UAT evidence and request human signoff.
6. Stabilize contract v1 only after Slice 1 acceptance.
7. Continue one evidence-backed slice at a time.

## References

- Superseded on approval:
  [Task mode — workflow-driven tasks with a live plan artifact panel](/specs/2026-07-03-task-mode-design.md)
- Source workflow:
  [plan-build-verify](../../.agents/skills/plan-build-verify/SKILL.md)
- Evidence workflow:
  [User Acceptance Evidence](../../.agents/skills/plan-build-verify/references/user-acceptance/workflow.md)
- Existing worktree bootstrap and orchestration contracts:
  `packages/contracts/src/orchestration.ts`, `apps/server/src/ws.ts`
- Existing plan surface:
  `apps/web/src/components/PlanSidebar.tsx`, `apps/web/src/proposedPlan.ts`
- Existing comment block precedent:
  `apps/web/src/reviewCommentContext.ts`
- Existing task-mode source spec:
  [July 3 Task Mode](/specs/2026-07-03-task-mode-design.md)
- HumanLayer public repository:
  `https://github.com/humanlayer/humanlayer`
- HumanLayer RPI command examples:
  `.claude/commands/ralph_research.md`, `.claude/commands/create_plan.md`,
  `.claude/commands/implement_plan.md`, `.claude/commands/validate_plan.md`
