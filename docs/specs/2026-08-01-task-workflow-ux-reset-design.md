---
type: Spec
title: "Task workflow UX reset: product-first Standard, Guided, and Freeform flows"
description: "Re-baseline task onboarding and stage navigation around automatic conversations and human-readable artifacts while preserving durable task-workspace infrastructure."
status: Implemented
tags: [specs, task-workspaces, ux, onboarding, workflows, standard, guided, freeform]
timestamp: 2026-08-01T16:29:19Z
parent: /specs/2026-07-28-task-workspaces-vertical-slices-design.md
---

# Task workflow UX reset: product-first Standard, Guided, and Freeform flows

## Status

**Implemented for Phases 0–3.** Guided creation, bootstrap/recovery, typed completion, atomic
handoffs, Plan approval, worktree policy, provider capability enforcement, and the
conversation-first surface are implemented. Provider-backed desktop UAT remains dependent on an
eligible configured task-stage provider.

## Goal

Make Tasks a user-facing workflow for starting and reviewing agent work. The first complete
product slice is a Guided task from creation through approved Plan. The user enters a brief,
chooses a workflow, and enters a normal agent conversation. Kata manages stage sessions,
provider-scoped task tools, artifact handoffs, and recovery.

Success means a maintainer can create a Guided task, watch it move through Clarify, Research,
Design, and Plan, approve or revise the Plan, restart the app during any transition, and return to
the same task state with the same conversations and artifacts.

## Relationship to the parent design

This spec amends the [task-workspaces vertical-slices design](/specs/2026-07-28-task-workspaces-vertical-slices-design.md).
It supersedes the parent document's default UI shape, built-in-template presentation, and slice
sequencing for the normal task experience:

- The conversation becomes the primary task surface.
- The session navigator, context-manifest editor, and tabbed database-style workspace leave the
  default surface.
- Guided through approved Plan becomes the next product slice.
- Existing Slice 4 Build work remains implementation infrastructure for a later Implement slice.

The parent document remains authoritative for durable task ownership, append-only workflow
versions, repeatable stage occurrences, artifact revisions, context provenance, recovery,
security, and eventual Build, Verify, and Deliver behavior. Approval of this spec requires a
follow-up parent-spec and roadmap status update before Build starts.

## Verified current-state constraints

The Build plan must account for these repository facts:

- `TaskWorkspaceService` currently writes one full-snapshot NDJSON event per command and treats a
  recorded command id as terminal. A multi-step bootstrap saga needs transactional event,
  receipt, and outbox persistence before external worktree or orchestration effects run.
- Task-workspace RPC currently exposes dispatch and subscription on one server environment. The
  web bootstrap currently subscribes only to the primary environment. Multi-environment task
  routes require environment-scoped query and subscription management.
- `thread.create` requires `runtimeMode`, `interactionMode`, and `ModelSelection`. Pre-Implement
  stages need a server-owned planning execution profile with enforced write protection.
- Kata already issues provider-scoped, thread-bound MCP credentials to supported adapters. The
  task workflow can extend that boundary with task-stage tools. Providers without that MCP path,
  including an in-process provider, need an equivalent native adapter bridge before the Guided
  flow may offer them.
- Workflow definitions are already pinned and registered append-only. Historical definitions and
  task contracts must remain decodable.

## Product decisions

- Kata owns the workflow templates and terminology.
- The product keeps **Standard**, **Guided**, and **Freeform**.
- Guided is the creation default while it is the only complete first-slice path. Standard becomes
  the general default after its full path ships.
- Guided automatically advances through Clarify, Research, and Design, then starts Plan and pauses
  for Plan approval.
- The first slice accepts an inline brief. External source adapters are separate work.
- The conversation is the primary surface. The task panel shows stage context, artifacts, and the
  current user action.
- Kata creates and links primary stage sessions. The normal workflow contains no manual thread
  linking.
- Kata task-stage tools provide agent context and accept typed stage output. Users work through the
  normal composer.
- Clarify, Research, Design, and Plan sessions run under an enforced planning execution profile.
- Plan approval ends this slice. No Implement occurrence or session starts in this slice.
- PR #63 and the next verification slice remain paused until this UX reset is implemented and
  accepted.

## Workflow templates

### Standard

Standard is the intended default for well-understood work:

```text
Clarify → Plan → Implement → Verify
```

Clarify resolves material ambiguity through conversation. Plan is the first durable planning
artifact and has a human approval gate. The first slice exposes Standard as a clearly labeled
conversation-shell preview. Automatic Clarify completion and later stages arrive with the
Standard slice.

### Guided

Guided supports explicit discovery and design:

```text
Clarify → Research → Design → Plan → Implement → Verify
```

The first slice implements Clarify through approved Plan. Every early stage has a fresh primary
conversation and a readable artifact. A completed artifact transaction queues the next handoff.
Plan output opens a human approval gate.

### Freeform

Freeform is a task-owned conversation without a required stage rail. The first slice exposes a
clearly labeled conversation-shell preview. Explicit stage entry and structured artifact actions
arrive with the Freeform slice.

### Deliver boundary

Deliver is a post-Verify task action. It is outside the stored `TaskWorkspaceStage` union and the
first-slice rail.

### First-slice availability

The creation form exposes all three templates with capability labels:

- **Guided:** available through approved Plan and selected by default.
- **Standard preview:** creates the conversation-first shell and initial Clarify conversation.
- **Freeform preview:** creates one task conversation without automatic stage progression.

Standard and Freeform previews identify deferred behavior before creation. Their task panels show
only available actions. The server workflow catalog enforces the same capabilities and returns a
typed error for unsupported completion or stage-entry operations.

Stored stage values remain `questions`, `research`, `design`, `plan`, `build`, `verify`, and
`verified`. Presentation maps `questions` to **Clarify**, `build` to **Implement**, and `verified`
to **Done**.

## Reference interaction

The maintainer-provided task-creation reference establishes these interaction requirements:

- repository or directory selection;
- inline task description;
- task name and editable URL-safe slug;
- workflow selection with plain-language descriptions;
- worktree timing: Now, Later, or Never;
- coding agent, model, and model-owned effort selection;
- visible workflow preview;
- one Create task action.

The first slice implements the inline source path. Source integration tabs appear only after their
adapters exist. Kata uses its own terminology and styling.

## User journey

### Create task

1. The user opens **Create task**.
2. The form collects the inline brief, task name, editable slug, repository, base ref, workflow,
   worktree timing, coding agent, model, and available model options.
3. The slug is the new task's immutable `taskId`. It is environment-scoped and appears in the
   canonical task URL. Historical opaque task ids remain valid.
4. Selecting a repository chooses the target environment connection. The server resolves the
   repository path and pinned base commit from the selected project.
5. Creating the task writes the task, create receipt, bootstrap intent, and reserved identifiers
   in one transaction. Navigation proceeds immediately to the canonical task route.
6. The route shows Starting until the initial conversation is ready, then renders that
   conversation without a manual session-link action.

### Worktree timing

- **Now:** provision the task worktree from the pinned base commit before Clarify starts. Planning
  sessions use that worktree.
- **Later:** run pre-Implement sessions against the selected source repository under the enforced
  planning profile. Provision from the pinned base commit after Plan approval.
- **Never:** run the planning slice in the source repository under the enforced planning profile.
  Future Implement remains unavailable until the user changes the policy to Now or Later.

The form describes Never as planning-only for this slice.

### Clarify

The agent reads the brief and stage context through the task-stage bridge. The user answers through
the normal composer. When the goal, constraints, open decisions, and success conditions are clear,
the agent submits a typed Clarification proposal. Kata commits it after the provider turn
completes and starts Research.

### Research and Design

Guided creates a fresh primary conversation for each stage. Research records codebase facts,
conventions, and evidence. Design records the chosen approach, boundaries, and decisions. The
route stays stable while the conversation target changes. The surface shows explicit Finalizing,
Starting next stage, and Failed transition states.

The user can steer the active conversation and inspect prior artifacts. Runtime manifest and
session identifiers stay internal.

### Plan

Design completion queues the Plan handoff. Plan produces a readable artifact containing scope,
implementation phases, acceptance criteria, risks, and verification. The task then pauses with:

- the current Plan artifact;
- a short stage summary;
- **Approve plan**;
- **Request changes**.

Request changes records feedback and starts a new Plan continuation occurrence. The route retargets
to the continuation conversation after bootstrap becomes ready.

### Approved Plan

Approval records an approved gate outcome and completes the current Plan occurrence. The route
continues to show the approved Plan conversation read-only. The task panel shows **Plan approved**
and the worktree status. This slice creates no Implement occurrence or session.

A later Implement slice adds a new append-only workflow version and an explicit workflow-run
upgrade for eligible approved-Plan tasks. Existing pinned definitions never gain behavior
silently.

## Surface model

### Canonical task route

`/tasks/$environmentId/$taskId` is canonical. It composes the existing `ChatView` with a compact,
task-keyed panel. The URL stays stable across stage handoffs because the task route resolves the
current conversation target from durable state.

The route renders:

- **Starting:** durable bootstrap or handoff work is pending;
- **Ready:** the selected current or last approved conversation is available;
- **Failed:** the transition failed and exposes an idempotent Retry action;
- **Needs repair:** repository or legacy association needs explicit user repair.

The create result always returns `taskRoute: { environmentId, taskId }`. It may also return
`conversationTarget: { environmentId, threadId }` after bootstrap is ready.

### Environment-scoped discovery and subscription

Each task server owns tasks for its own `ServerEnvironment`. The client never supplies an
authoritative environment id or repository path in `task.create`.

The web task subscription manager follows authenticated environment connections:

- subscribe once per connected environment;
- key snapshots and sequences by `(environmentId, taskId)`;
- retain disconnected environment entries as offline until reconnect or explicit removal;
- reset and resubscribe only the affected environment partition;
- dispatch commands through the task's environment connection.

The compatibility route `/tasks/$taskId` performs a read-only `getTask` fanout across authenticated
connected environments. One match redirects to the canonical route. Multiple matches show an
environment chooser. Zero matches show Not found plus unavailable-environment guidance. Lookup
never mutates a task.

### Task panel

The default panel contains:

- the Guided rail or a preview-template task status;
- current stage, transition status, and next user action;
- current artifact with a clear loading or failure state;
- compact prior-artifact history;
- repository, pinned base, and worktree status;
- Plan approval, request-changes, Retry, or policy-change controls when applicable.

Manual session linking, session roles, fork controls, raw thread ids, manifest editing, token
budgets, fixture controls, and empty future-stage panels remain outside the default surface.

### Artifact presentation

A stage artifact revision persists:

- server-derived artifact kind and title;
- model-provided short summary and Markdown body;
- source stage, occurrence, session, and provider turn;
- revision identity and stable block index;
- creation time and superseded revision identity.

The task panel renders title, summary, body, revision, and source stage. Conversation is the
feedback path. A raw Markdown editor is outside the first slice.

## Presentation vocabulary and workflow catalog

A single versioned built-in workflow catalog under `packages/shared` supplies server and web
consumers with preset identity, stages, presentation labels, prompt bundle, and first-slice
capabilities. Server-only validators compile transitions from that catalog. Tests reject catalog
entries whose server and web projections differ.

Each versioned entry declares:

- `availableInFirstSlice`;
- `autoAdvanceStages`;
- `humanGateStages`;
- `explicitEntryStages`;
- `completionTransportRequired`;
- visible capability status for each stage.

The `@0.2.0` entries describe Guided through approved Plan and the Standard/Freeform preview
shells. All `@0.1.0` entries remain registered.

Every user-facing surface consumes this presentation map:

- stage `questions` → **Clarify**;
- artifact kind `questions` → **Clarification**;
- stage `build` → **Implement**;
- stage `verified` → **Done**;
- artifact kind `verification` → **Verification**;
- artifact kind `summary` stays internal.

## Runtime architecture

### Environment and repository authority

The client dispatches `task.create` through the selected environment connection with `projectId`
and `baseRef`. The server:

1. stamps its own `environmentId`;
2. resolves `projectId` through the environment's project projection;
3. derives `workspaceRoot` and repository identity server-side;
4. verifies repository authorization;
5. resolves and persists `baseRef` to `baseCommitSha`;
6. for Later and Never, requires the source checkout to be clean and at the pinned base commit;
7. rejects missing projects, path mismatches, invalid refs, unsafe source state, and unauthorized
   repositories before task creation.

Later Git operations use only the persisted server-resolved repository binding. The client cannot
choose an arbitrary filesystem path. Plan approval revalidates the pinned source state before
Later provisioning; drift blocks provisioning visibly and preserves the approved Plan.

### Task identity and aggregate additions

For new tasks, the submitted slug is `TaskWorkspace.id`. The server validates lowercase letters,
digits, and single dashes; requires an alphanumeric start and end; limits the value to 80
characters; and enforces uniqueness within the environment.

The aggregate adds:

- `environmentId`;
- `intake: { brief, source: { kind: "inline", body } }`;
- `preferences: { worktreePolicy, modelSelection, executionProfile: "planning" }`;
- repository `baseCommitSha`, planning-root fingerprint, and
  `provisioningStatus: "not-requested" | "pending" | "running" | "ready" | "failed"`;
- bootstrap state with semantic operation key, current step, reserved session/thread ids,
  conversation target, attempt count, and redacted failure;
- active workflow-run `definitionVersion` and `promptBundleVersion` pins, plus occurrence history with
  stage, ordinal, status, session ids, artifact revision ids, current completion-proposal id,
  timestamps, gate outcome, and supersession;
- active Plan gate plus append-only gate and feedback history;
- session environment, model selection, occurrence, bootstrap key, source session, and status;
- session status `superseded` in addition to `active` and `completed`;
- `taskRevision`, incremented for every persisted task event.

Stage occurrence status is one of `starting`, `running`, `finalizing`, `awaiting-approval`,
`blocked`, `completed`, or `failed`. Changes requested is a Plan gate outcome, not an occurrence
status.

### Transactional task store, receipts, and outbox

The current one-event-per-command NDJSON append path cannot provide the required multi-step crash
contract. Before bootstrap orchestration ships, task events move to transactional storage using
the repository's SQLite persistence infrastructure.

One transaction may append task events, update the task snapshot, update command and operation
receipts, persist a completion proposal, and enqueue outbox work. The store provides unique
indexes for environment-scoped task ids, operation keys, command ids, and completion proposals.
Event type is independent from command type, so one semantic operation may emit requested,
step-completed, ready, or failed lifecycle events.

A command receipt binds environment, `commandId`, canonical command digest, terminal accepted or
rejected outcome, semantic operation key when present, and immutable result identity. It prevents
a replayed retry command from incrementing the target operation attempt twice.

Operation receipts are durable service records rather than task-local replay caches. A receipt
binds:

- environment id and task id;
- operation type and semantic operation key;
- canonical payload digest;
- status `pending | completed | failed`;
- attempt count and source command ids;
- immutable result identity;
- latest result task revision and redacted failure.

A durable completion proposal binds task, stage occurrence, session, thread, provider turn,
payload digest, summary, Markdown, and status `proposed | committed | rejected`. Terminal turn
outcome, committed artifact revision, timestamps, and redacted rejection reason are recorded when
known.

Outbox rows persist deterministic external identities before side effects run:

- worktree branch and path;
- task session id and orchestration thread id;
- thread-create command id;
- turn-start command id and message id;
- source and target stage occurrences.

A restart worker reconciles each target before retrying. Worktree adoption verifies the reserved
path, branch, pinned base, and task ownership. Orchestration replay uses the persisted thread,
command, and message ids. The task becomes Ready only after canonical provider runtime events
confirm thread and turn start. Runtime failure marks the same operation Failed.

The legacy NDJSON file is imported transactionally once and then retained read-only. Malformed
legacy records fail with an explicit repair error. No historical file is rewritten in place.

### Command idempotency and compare-and-set order

`commandId` identifies one transport request. `operationKey` identifies one semantic operation
across retries. Reusing either key with a different canonical payload digest returns a typed
conflict.

The service linearizes a request in this order:

1. Look up the environment-scoped command receipt and validate the command digest. A match returns
   current task state plus the command's immutable outcome without processing the command again.
2. For a new command, look up the semantic operation receipt and validate its operation type and
   payload digest.
3. Return current task state plus the immutable stored result for a completed operation.
4. Return current task and operation status for pending work.
5. Require an explicit `task.operation.retry` request naming failed work and carrying the latest
   `expectedTaskRevision`, then increment the target receipt's attempt count.
6. For an absent operation, validate `expectedTaskRevision`, append pending intent, enqueue side
   effects, and persist the terminal command receipt in one transaction.

Accepted and rejected retry commands receive terminal command receipts. Replaying an accepted
retry after the target fails again returns the original retry outcome and never increments the
attempt count a second time.

Create has no prior task revision. Its operation key, task id, task event, receipt, and bootstrap
intent are written in one transaction. A duplicate create returns the current task and original
route identity. Concurrent create requests for the same task id or operation key resolve through
unique constraints.

Public semantic mutations other than create carry `expectedTaskRevision`, `operationKey`, and a
unique request `commandId`:

- `task.stage.request-changes`;
- `task.plan.approve`;
- `task.worktree.policy.set`;
- `task.session.recover-primary`;
- `task.environment.repair` for explicit legacy repair.

`task.operation.retry` carries a unique `commandId`, the latest `expectedTaskRevision`, and
`targetOperationKey`. It reopens the existing target receipt and does not create a second semantic
operation.

Server workers and the authenticated task-stage bridge derive the current revision inside the
task service's serialized transaction. They validate the active task, stage, occurrence, session,
and operation state rather than trusting a provider-authored revision.

Server audit time and resolved actor identity are authoritative. Remote environments use the
authenticated connection principal; the embedded local environment uses a stable `local-user`
actor. Plan approval does not accept an arbitrary `approvedBy` value from the client or agent.

### Task creation payload and result

The first-slice `task.create` payload contains:

- existing transport `commandId` and `createdAt`;
- stable client-generated `operationKey`;
- `taskId`, populated from the edited slug;
- `title` and required inline `brief`;
- `source: { kind: "inline", body: brief }`;
- `projectId` and `baseRef`;
- `preset: "standard" | "guided" | "freeform"`;
- `worktreePolicy: "now" | "later" | "never"`;
- the existing `ModelSelection` shape.

The server requires trimmed non-empty brief text, enforces a shared
`TASK_BRIEF_MAX_CHARS = 100_000` limit below the existing 120,000-character turn limit, and
requires `source.body === brief`. It derives environment id, workspace root, repository identity,
base commit, workflow version, prompt version, approval policy, planning profile, actor, and audit
timestamps. Client `createdAt` remains transport metadata; server time drives audit state.

`TaskWorkspaceDispatchResult` adds:

```text
operation: { key, status, attempt, error? }
taskRoute: { environmentId, taskId }
conversationTarget?: { environmentId, threadId }
```

The result retains global event `sequence` and current `task`. Clients use `taskRevision` for task
compare-and-set and `sequence` only for stream ordering.

### Primary-session bootstrap

Bootstrap uses semantic key `<task-id>:bootstrap:<stage>:<occurrence>:primary`. The initial
occurrence of a stage is zero. Every new occurrence allocates
`1 + max(recorded occurrences for that stage)`. Failed retries retain the same occurrence.
Request changes and recovery that create new work allocate a new occurrence atomically. Recovery
that adopts an existing session preserves its recorded occurrence.

The outbox worker:

1. provisions or reconciles the worktree when policy requires it;
2. creates or reconciles the reserved task session and orchestration thread;
3. resolves the pinned prompt bundle and attaches it through the provider adapter's trusted
   system/developer-instruction channel;
4. dispatches the deterministic thread-create command with persisted `ModelSelection`,
   `runtimeMode: "approval-required"`, and `interactionMode: "plan"`;
5. dispatches a deterministic visible kickoff message;
6. waits for provider thread/turn start or a terminal runtime failure;
7. records the conversation target and Ready state.

Trusted task instructions are server-only input. Public orchestration commands cannot provide or
override them. The task session persists their prompt-bundle reference, and restart resolves the
same append-only version. Provider adapters without a trusted instruction channel are ineligible
for Guided.

The Clarify kickoff message is the user's brief. Later stages use concise product language such as
“Research this task using the approved Clarification.” The task-stage context tool returns selected
untrusted task data. Manifests, token budgets, trusted instructions, and runtime prompts never
appear as synthetic user prose.

Retry sends `task.operation.retry` with the failed bootstrap operation key and latest task
revision. It reclaims the same outbox identities and increments the target receipt's attempt. It
does not allocate a second session or occurrence.

### Provider-neutral task-stage bridge

A `TaskStageBridge` owns trusted instruction attachment and two provider tools with one shared
schema:

- trusted instructions tell the provider how to run the pinned stage, treat task content as
  untrusted data, use the context tool, and propose completion;
- `task_stage_context` is read-only and returns only the brief snapshot, selected artifact content,
  stage and occurrence, and current request-changes feedback as untrusted data;
- `task_stage_complete` accepts `{ summary, markdown }` and proposes completion of the caller's
  current stage.

MCP-capable providers receive these tools through the existing thread-bound Kata MCP credential.
The credential adds a `task-stage` capability only when its thread is the active primary session
for a task occurrence. The handler derives environment, task, session, stage, occurrence, and
active provider turn from the invocation scope. An in-process or non-MCP provider must implement
the same `TaskStageBridge` contract as a native tool before it is selectable for Guided.

Task-stage tool activities use an internal projection class. The normal conversation renders
concise states such as **Loaded task context** and **Completed Clarify**; it does not render raw
tool arguments, Markdown payloads, prompt instructions, or context results. Authorized server
audit records retain the tool provenance with normal redaction.

Task-stage MCP credentials use a separate three-hour idle lease and the existing eight-hour
maximum lifetime. Before every task-bound turn, the provider service ensures a fresh lease with at
least three hours remaining; a task-stage turn has a two-hour hard timeout. Rotation resumes or recreates the provider session with the same
orchestration thread and provider resume cursor before the turn starts. Stage completion,
supersession, or thread deletion revokes the lease. Every invocation still revalidates the active
primary session, occurrence, gate, and turn. Lease expiry or rotation failure leaves the occurrence
Running and exposes Retry; it never authorizes a stale session.

`task_stage_complete` is valid only while its occurrence is Running or is Finalizing the same
proposal. It persists a proposal linked to the active provider turn and returns an acknowledgement
to the agent. The task remains Finalizing until the canonical provider event marks that turn
completed. The completion reactor then commits the artifact and transition atomically. A gate-open
Plan occurrence rejects replacement proposals until Request changes allocates a continuation.

An aborted or failed turn rejects the proposal and returns the stage to Running with a visible
failure. Malformed tool input returns a typed tool error and leaves task state unchanged. A turn
that completes without a proposal leaves the stage Running and shows a completion-needed notice;
the UI can send a normal “Finish this stage” message through the composer. On startup, a proposal
reconciler reads canonical turn state: completed proposals commit, aborted or failed proposals
reject, active proposals wait, and missing terminal state becomes a visible recoverable failure.

The internal operation key derives from task, session, occurrence, provider turn, and canonical
payload digest. Repeated delivery of the same tool call is idempotent. A unique constraint permits
one proposal per task occurrence and provider turn; a different second payload conflicts. Any
proposal after the occurrence completes is rejected.

### Guided output and handoff transaction

On successful completion of Clarify, Research, or Design, one task transaction:

1. validates active task, environment, stage, occurrence, session, provider turn, artifact schema,
   and payload digest;
2. persists the artifact revision and block index;
3. marks the source occurrence and session completed;
4. allocates the next stage occurrence in Starting;
5. persists its handoff manifest and reserved identifiers;
6. enqueues target bootstrap work.

The source occurrence remains completed if target bootstrap later fails. The task displays the
target stage as Failed with Retry. It never reruns the completed source occurrence implicitly.

Design completion allocates Plan. Plan output persists the Plan revision, sets the Plan occurrence
to Awaiting approval, and opens a gate for that exact revision. The Plan session remains the
conversation target while the gate is open.

### Plan gate state machine

The gate is repeatable across any number of requested revisions:

```text
open(occurrence K, revision N)
  → approved(occurrence K, revision N)
  or
  → changes-requested(occurrence K, revision N, feedback)
  → continuation-starting(occurrence K+1)
  → open(occurrence K+1, revision N+1)
  → ...
```

While a gate is open, occurrence K is `awaiting-approval`. Request changes atomically appends the
`changes-requested` gate outcome, marks occurrence K and its session completed with that outcome,
allocates occurrence K+1 in `starting`, persists continuation context, and queues bootstrap. A
bootstrap failure marks K+1 `failed`, keeps the active gate outcome `changes-requested`, and
retries the same K+1. Successful bootstrap moves K+1 to `running`; accepted output moves it through
`finalizing` to `awaiting-approval` and appends a new open gate for revision N+1. The loop may
repeat. Approval succeeds only for the current open occurrence and revision.

Approval atomically records resolved actor and server time, appends the approved gate outcome,
marks the Plan occurrence and session completed, and applies worktree policy. Post-approval
provisioning uses operation key `<task-id>:worktree:<base-commit>:<policy>`; its failure never
changes the approved gate. The first-slice post-state is:

| Policy  | Current stage after approval | Plan state | Worktree action                                              | Conversation target      | Visible next action                                      |
| ------- | ---------------------------- | ---------- | ------------------------------------------------------------ | ------------------------ | -------------------------------------------------------- |
| `now`   | `plan`                       | completed  | already `ready`                                              | approved Plan, read-only | Plan approved; Implement deferred                        |
| `later` | `plan`                       | completed  | revalidate source, then enqueue; show `running/failed/ready` | approved Plan, read-only | Resolve drift or retry failure; Implement deferred       |
| `never` | `plan`                       | completed  | remain `not-requested`                                       | approved Plan, read-only | Choose Now or Later before a future Implement occurrence |

No row creates an Implement occurrence or session in this slice.

### Planning-root checks and worktree policy changes

`planningRootFingerprint` is SHA-256 over the planning root's resolved HEAD SHA, a newline, and
canonical `git status --porcelain=v2` output. Now records it after clean worktree provisioning.
Later and Never record it from the source checkout, which must be clean at creation. The server
revalidates it before every task-bound turn, when accepting a completion proposal, and at Plan
approval; Later also revalidates the source immediately before provisioning.

A server-side `TaskTurnGuard` resolves task ownership by thread, so the check applies from task and
ordinary chat routes. It also rejects turns for completed or superseded task sessions. Drift blocks
the occurrence before artifact acceptance and exposes the expected and observed state. Restoring
the planning root permits Retry on the same occurrence; changing the baseline or accepting drift
is outside this slice.

In this slice, `task.worktree.policy.set` is available for a Never task only after Plan approval.
Changing to Now or Later then records the policy and immediately enqueues deterministic
provisioning because the approval boundary has already passed. Provisioning failure preserves the
approved Plan and exposes Retry. The canonical writer persists `ready`; `provisioned` remains
decode-only compatibility vocabulary.

Generated refs use the Kata branch prefix and task id. Existing refs or paths are adopted only when
they match the task's persisted reservation and pinned base. Any ownership conflict fails visibly.

### Automatic handoff context

The server creates versioned, immutable manifests. A manifest records:

```text
ContextManifest
├─ id, taskId, environmentId
├─ taskContractVersion, artifactContractVersion
├─ workflowDefinitionVersion, promptBundleVersion
├─ sourceSessionId?, targetSessionId
├─ sourceStageOccurrence?, targetStageOccurrence
├─ reason: initial | stage-handoff | request-changes | recovery
├─ operationKey
├─ briefSnapshot: { sourceKind: "inline", body }
├─ feedbackSnapshot?
├─ artifactRefs: [{
│    artifactId, revisionId, kind, revision,
│    selection: full | blocks | summary,
│    blockIds[]
│  }]
├─ tokenEstimate, budget
├─ summaryArtifactRef?
└─ createdAt
```

The default handoff includes the brief and complete immediately preceding stage artifact. Request
changes also snapshots feedback and the reviewed Plan revision. The task-stage context tool reads
only the target session's authorized manifest and returns stage/occurrence metadata plus its
untrusted brief, feedback, and selected artifact data. Trusted instructions remain exclusively in
the provider-native system/developer channel.

Full selection uses `selection: "full"` and an empty block list. Block selection requires explicit
stable `<!-- kata:block:... -->` markers. When an artifact lacks markers or selected content exceeds
the budget, the server creates a summary artifact through a dedicated context-budgeting service
extracted from the current helpers. Heading text alone never defines durable block identity.

Manifest creation authorizes task, environment, source session, target session, artifact revision,
and occurrence. Retries return the existing manifest/session association. The first slice exposes
manifest provenance only through human-readable artifact history.

### Agent and model selection

`modelSelection` reuses the existing contract: `instanceId`, `model`, and provider-owned option
selections. The form renders option descriptors from the selected model. Effort remains a provider
option such as `reasoningEffort` or `effort`, based on the descriptor.

The server validates:

- configured provider instance and driver;
- selected model from that instance's catalog;
- unique option ids, option types, and select choices;
- cached capability support for enforced Plan mode and the task-stage bridge.

An unknown instance, model, option, or missing Guided capability fails before task creation. A
known configured instance with cached capabilities may create a task while temporarily
unavailable; bootstrap then records a visible, retryable failure. No provider, model, or option
falls back silently.

The resolved selection is copied to every automatic stage session. Provider changes require a
later explicit task action. Legacy tasks resolve the existing project/provider default during
recovery and persist that resolved selection on the recovered session.

### Workflow version upgrades

A shipped capability never changes a pinned definition. Phase 4 introduces `standard@0.3.0` and
`freeform@0.3.0`; Phase 5 introduces `guided@0.3.0`. Each new version pins a matching prompt bundle.

A later `task.workflow.upgrade` command carries source version, target version,
`expectedTaskRevision`, and operation key. The server accepts only a catalog-declared upgrade edge
whose eligibility predicate matches the task:

- a Standard or Freeform preview task has no structured occurrence beyond its initial shell;
- a Guided task has an approved current Plan and no Implement occurrence;
- no bootstrap, proposal, gate mutation, or repair operation is pending.

The upgrade transaction appends `task.workflow.upgraded` with source/target workflow and prompt
versions, actor, time, and occurrence mapping. It atomically updates the active run's
`definitionVersion` and `promptBundleVersion` plus compatibility mirrors
`versions.workflowDefinition` and `versions.prompt`. It starts no stage implicitly and retains
append-only upgrade history. Prompt resolution uses the active run's prompt pin; tests reject
inconsistent workflow or prompt mirrors.

## Contract versions and migration

New records use `task-workspace@0.3.0` and `task-artifact@0.3.0`. New built-in definitions use
`standard@0.2.0`, `guided@0.2.0`, and `freeform@0.2.0`, with matching prompt bundle versions.
Historical definitions stay registered.

Migration covers both existing contract generations:

- `task-workspace@0.1.0` and `task-artifact@0.1.0`;
- `task-workspace@0.2.0` and `task-artifact@0.2.0`;
- all `@0.1.0` workflow definitions.

A version-aware whole-aggregate normalizer handles defaults that a field decoder cannot derive:

- preserve historical opaque task ids; display them as the legacy slug;
- create legacy intake from the existing title without generating a fake artifact;
- default missing worktree policy to Later;
- map `provisioned` to canonical `ready`;
- preserve old workflow and prompt pins, populating a missing run-level prompt pin from
  `versions.prompt`;
- derive historical `taskRevision` from the imported per-task event order;
- set missing stage occurrence to zero;
- resolve missing model selection only when a recovery session starts.

During transactional import, each server stamps its own environment id through an explicit
migration event and validates the persisted project binding. Missing projects enter Needs repair.
A user-authorized repair command records the replacement project and repository binding. Read-only
route lookup performs no repair.

Existing manually linked sessions remain readable. Recovery rules are deterministic:

- exactly one active primary for the current occurrence is adopted;
- zero primaries enters failed/recoverable bootstrap;
- multiple primaries enters conflict;
- `selection.kind: "existing"` preserves the selected occurrence and marks other active primaries
  superseded;
- `selection.kind: "new"` allocates the next occurrence and creates new work.

No historical event log is deleted or rewritten.

## Implementation phases

### Phase 0: persistence and contract foundation

- Add version-aware aggregate normalization and NDJSON import.
- Add transactional task events, snapshots, receipts, indexes, and outbox.
- Separate event types from command types.
- Add task revision, occurrence, gate, bootstrap, artifact provenance, and canonical repository
  states.
- Add crash-boundary and historical replay tests before external orchestration work.

### Phase 1: workflow catalog, creation, and environment routing

- Create one shared versioned workflow catalog and server/web parity tests.
- Rebuild `TaskWorkspaceNewView` around the specified fields and template capability labels.
- Dispatch create through the selected environment and resolve repositories server-side.
- Add environment-scoped task query, subscription manager, store partitions, canonical route, and
  compatibility fanout.
- Implement Starting, Ready, Failed, offline, and Needs repair surfaces.

### Phase 2: task-stage bridge and bootstrap saga

- Add task-stage MCP tools and the provider-neutral native bridge interface.
- Advertise Guided only for provider instances with enforced Plan mode and completion transport.
- Implement deterministic worktree, thread, turn, and provider-runtime reconciliation.
- Compose `ChatView` and the compact task panel at `/tasks/$environmentId/$taskId`.
- Verify retry, reload, reconnect, process restart, and crash injection.

### Phase 3: Guided Clarify through approved Plan

- Implement typed completion proposals and turn-settlement reactor.
- Commit stage artifacts and queue atomic handoffs.
- Implement Plan gate state machine, continuation conversations, and post-approval worktree states.
- Remove manual stage editors, session-link forms, and manifest controls from the default surface.
- Complete browser, E2E, and manual acceptance for the Guided path.

### Phase 4: Standard and Freeform

- Add `standard@0.3.0` and `freeform@0.3.0` with matching prompt bundles.
- Ship Standard's shorter automatic path and Freeform explicit stage/artifact actions.
- Implement the catalog-declared `task.workflow.upgrade` edges and eligibility checks for preview
  tasks.
- Change the general creation default to Standard after its acceptance criteria pass.

### Phase 5: Implement, Verify, and Deliver

- Add `guided@0.3.0` and its explicit approved-Plan upgrade edge.
- Place the Slice 4 Build/checkpoint engine behind Implement.
- Add Verify evidence and post-Verify draft PR delivery in separately approved slices.

## Acceptance criteria

The first Guided-to-approved-Plan slice passes when every criterion has E2E coverage and the
required manual evidence:

1. **AC-01, creation:** A user can enter an inline brief, title, editable slug, repository, base
   ref, worktree timing, workflow, eligible coding agent, model, and available model options, then
   create a task.
2. **AC-02, template honesty:** Guided is the default and is labeled available through approved
   Plan. Standard and Freeform are labeled preview shells before creation and expose no deferred
   controls afterward. Direct unsupported completion or stage-entry commands receive a typed
   server rejection.
3. **AC-03, stable identity:** The edited slug becomes the new task id and canonical
   `/tasks/$environmentId/$taskId` URL. Reload and every stage handoff preserve that URL.
4. **AC-04, authoritative intake:** The persisted task contains the server environment,
   server-resolved repository path, pinned base commit, inline brief, worktree policy, and exact
   `ModelSelection`. Invalid slugs, oversized briefs, refs, model options, unsupported Guided
   providers, unsafe source state, and unauthorized repositories fail before task creation.
5. **AC-05, idempotent commands:** Repeated submission of one create operation returns one task and
   one canonical route. Replaying one accepted retry command after its target fails again leaves
   the attempt count unchanged. Reusing a command or operation key with different payload fails
   visibly.
6. **AC-06, automatic start and planning-root safety:** Guided creation reaches a Clarify
   conversation automatically. Now provisions first; Later and Never require a clean pinned source.
   Every policy blocks turns and completion on planning-root drift and resumes the same occurrence
   after the root is restored.
7. **AC-07, planning and tool safety:** Clarify, Research, Design, and Plan run with trusted
   versioned instructions, enforced Plan mode, and approval-required runtime policy. A provider
   missing any capability cannot be selected for Guided. Forced task-tool lease expiry renews or
   recovers before the next turn, and a superseded session cannot invoke task-stage tools.
8. **AC-08, conversation-first layout:** The active conversation is the primary surface. The task
   panel shows stage, artifact, repository, and next action without session, manifest, token,
   thread-id, fork, fixture, or empty future-stage controls.
9. **AC-09, typed stage completion:** The task-stage bridge accepts one valid proposal per active
   turn, waits for provider turn completion, and reconciles an unsettled proposal after restart. It
   shows a recoverable error or completion-needed notice for conflicting or malformed output,
   missing completion, aborted turns, tool failure, or a stale thread.
10. **AC-10, atomic handoffs:** Clarify, Research, Design, and Plan each produce a readable artifact.
    The Plan artifact includes scope, implementation phases, acceptance criteria, risks, and
    verification. Successful early-stage completion changes the active conversation automatically.
    A failed target bootstrap preserves the completed source artifact and retries the same target
    occurrence.
11. **AC-11, Plan gate:** Plan output opens approval for its exact occurrence and revision. A second
    Plan proposal is rejected while that gate is open. Implement controls and sessions remain
    absent before and after approval in this slice.
12. **AC-12, request changes:** Request changes records feedback, preserves each reviewed Plan,
    starts one continuation occurrence, and rejects approval until a new revision reopens the gate.
    Two consecutive Request changes cycles allocate distinct occurrences and remain recoverable.
13. **AC-13, approved post-state:** Approval records server time and resolved actor, keeps current
    stage `plan` with a completed occurrence, renders the approved Plan conversation read-only, and
    applies the documented Now/Later/Never worktree action without creating Implement work. A Never
    task can change policy only after approval; either allowed value provisions immediately. Direct
    navigation to the underlying chat route cannot send another turn to the completed Plan session.
14. **AC-14, context privacy and provenance:** Each handoff uses trusted versioned instructions and
    the authorized untrusted brief, feedback, and artifact selection. The visible conversation and
    task-tool work log contain concise states with no manifest serialization, context payload,
    token budget, trusted prompt, or cross-task content.
15. **AC-15, environment routing:** Tasks from two connected environments coexist in the sidebar,
    dispatch through their own connections, and open the correct conversation. The compatibility
    route redirects on one match and shows an environment chooser on duplicate ids.
16. **AC-16, recovery:** Reload, reconnect, server restart, and injected failure during worktree,
    thread, or turn bootstrap restore the same task, operation, occurrence, gate, and artifact
    state without duplicate worktrees, sessions, turns, or stage artifacts.
17. **AC-17, historical compatibility:** Imported `@0.1.0` and `@0.2.0` tasks decode and render with
    historical workflow pins. Zero, one, and multiple-primary cases follow the documented recovery
    rules. Missing repositories show Needs repair.
18. **AC-18, presentation:** Creation, sidebar, task panel, artifacts, browser tests, and E2E use
    Clarify, Implement, and Done presentation labels. Fixture text and raw Questions/Build control
    copy stay absent from the normal Guided surface.
19. **AC-19, race safety:** Concurrent approval and Request changes accept exactly one command.
    Stale task revisions, stale Plan revisions, superseded task-stage credentials, and altered
    command replays fail visibly without partial task, gate, worktree, session, or artifact state.

## Testing and verification

### Acceptance coverage matrix

| E2E scenario                                      | Acceptance criteria               |
| ------------------------------------------------- | --------------------------------- |
| Guided creation and bootstrap                     | AC-01 through AC-08               |
| Guided completion and automatic handoffs          | AC-03, AC-07 through AC-10, AC-14 |
| Plan approval and repeated changes                | AC-11 through AC-14, AC-19        |
| Worktree policy, source drift, and restart        | AC-05, AC-06, AC-13, AC-16, AC-19 |
| Credential expiry and stale task-stage controls   | AC-07, AC-09, AC-16, AC-19        |
| Multi-environment routing and compatibility route | AC-03, AC-15                      |
| Historical import and recovery                    | AC-16, AC-17                      |
| Preview enforcement, vocabulary, hidden internals | AC-02, AC-08, AC-14, AC-18        |

The scenarios live under `e2e/tests/task-workspaces/`, compose reusable helpers from
`e2e/src/flows/`, use the `@task-workspaces` tag, and exercise real application services. The
provider-backed Guided scenario uses the E2E agent-provider prerequisites and fails loudly when
credentials are absent.

### Lower-level verification

- Contract tests cover all new schemas, canonical payload hashing, result shapes, version-aware
  normalization, and historical `@0.1.0`/`@0.2.0` decoding.
- Transaction-store tests cover unique indexes, event/receipt/outbox atomicity, command and
  operation payload conflicts, retry-command replay after repeated target failure, per-task CAS,
  and global sequence independence.
- Crash-injection integration tests stop after pending persistence, each external success, proposal
  persistence, provider turn settlement, terminal persistence, and response loss. Startup
  reconciliation verifies deterministic worktree, thread, turn, proposal, and artifact identities.
- Server tests cover repository authority, planning-root drift at turn/proposal/approval
  boundaries, base-ref pinning, provider capability validation, credential renewal/revocation,
  stale task-stage
  rejection, occurrence allocation, repeated gate cycles, concurrent gate commands, context
  selection, preview-shell enforcement, and cross-task rejection.
- Web browser tests cover template capabilities, route states, responsive conversation/panel
  composition, task retargeting, approved read-only state, and presentation vocabulary.
- Existing lower-level session, manifest, comment, Build, and artifact tests remain runtime
  regression coverage. UI tests for manual construction move to an advanced-inspection suite or
  are removed when the surface disappears.

### Manual acceptance and repository gates

Manual validation uses the running app and `playwright-cli` to capture snapshots for creation,
each Guided handoff, malformed completion recovery, Plan request changes, approval, each worktree
policy, multi-environment routing, restart recovery, and hidden internal controls.

Required commands before Build completion:

```bash
vp check
vp run typecheck
vp run check:okf
vp run test
vp run release:smoke
vp run e2e --project desktop-dev --grep @task-workspaces
```

Run the focused Guided flow headed during UAT.

## Out of scope

- GitHub, Linear, Jira, and other external source adapters.
- Slack notifications.
- Standard automatic progression and Freeform explicit stage entry.
- Implement sessions, Build UI integration, Verify evidence, and draft PR delivery.
- User-authored workflow definitions.
- Advanced session forking, reviewer/debugging roles, and manual context selection.
- Mobile-native task workspace UI.

## Risks and mitigations

- **Transactional migration expands the foundation.** Complete Phase 0 and crash tests before any
  provider or UI automation.
- **Provider task tools differ by runtime.** Use one `TaskStageBridge` schema, advertise explicit
  adapter capabilities, and keep unsupported providers out of Guided selection.
- **Task-tool credentials can expire during long work.** Renew before task turns, bound turn
  duration below the lease, revalidate every invocation, and recover the same occurrence on
  rotation failure.
- **Plan mode support differs by provider.** Require trusted instruction and enforced planning
  capabilities, then pair Plan interaction mode with approval-required runtime policy.
- **Automatic handoffs cross event stores.** Persist deterministic outbox identities and reconcile
  orchestration/provider projections before retrying.
- **Old tasks contain partial associations.** Import version-aware, preserve history, and expose
  explicit repair and conflict states.
- **Context selection can leak or misattribute content.** Keep trusted instructions in
  provider-native channels, classify task content as untrusted, and authorize every manifest
  reference to the target task, environment, session, occurrence, and artifact revision.
- **Planning roots can drift during planning.** Revalidate before turns, completion, and Later
  provisioning; accept no artifact produced against a changed fingerprint.
- **The Build PR contains useful work with an internal-facing surface.** Keep its reducer and
  contracts as infrastructure and integrate them only through the later Implement slice.

## Implementation outcome

- Phases 0 through 3 are implemented on the task-workspaces slice branch.
- Transactional task persistence, command-first replay, durable completion proposals, trusted task
  instructions, renewable task-tool credentials, enforced planning mode, source-state checks, exact
  post-approval state, and environment-scoped routing are included.
- Preserve historical task/workspace/artifact/session data and append-only workflow pins.
- Use the existing `ChatView`, environment connection runtime, orchestration command receipts,
  provider runtime events, and Kata MCP credential boundary.
- Keep Standard and Freeform as visibly limited preview shells until Phase 4.
- Keep manual session, manifest, fork, raw task-control, and fixture controls outside the default
  UI.
- Keep PR #63 and Slice 5 paused as product milestones until Guided passes all acceptance criteria
  and manual UAT.
- Update the parent spec and roadmap after this spec is approved and before Build begins.
