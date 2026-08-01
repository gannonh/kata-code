---
type: Spec
title: "Task workflow UX reset — product-first Standard, Guided, and Freeform flows"
description: "Re-baseline task onboarding and stage navigation around automatic conversations and human-readable artifacts while preserving the durable task-workspace infrastructure."
status: Draft
tags: [specs, task-workspaces, ux, onboarding, workflows, standard, guided, freeform]
timestamp: 2026-08-01T00:53:02Z
parent: /specs/2026-07-28-task-workspaces-vertical-slices-design.md
---

# Task workflow UX reset — product-first Standard, Guided, and Freeform flows

## Status

**Draft.** This spec records the agreed product reset after review of the current task screen
and the maintainer-provided reference interaction. It is not approved for implementation yet.

## Goal

Make Tasks understandable as a user-facing workflow for starting and reviewing agent work.
The first product slice is a Guided task from creation through Plan approval. The user enters a
brief, chooses a workflow, and enters a normal agent conversation. The application manages
stage sessions and artifact handoffs automatically. Internal persistence and context machinery
remain available to the runtime without becoming onboarding controls.

Success means a maintainer can create a Guided task, watch it move through Clarify, Research,
and Design, review a readable Plan, approve it, restart the app, and return to the same stage
with the same conversation and artifacts.

## Product decisions

- Kata owns the workflow templates and terminology.
- The product keeps three templates: **Standard**, **Guided**, and **Freeform**.
- Guided automatically advances through Clarify, Research, and Design, then starts Plan and
  pauses at the Plan approval gate.
- The first slice accepts an inline task brief. GitHub, Linear, Jira, and other source adapters
  are a separate source-intake slice.
- The conversation is the primary work surface. The task panel provides stage context and the
  current artifact.
- The application creates and links primary stage sessions. Users do not link threads manually
  during the normal workflow.
- Artifacts are human-readable stage outputs. Context manifests, session roles, fork points,
  token budgets, and thread identifiers are runtime details.
- The existing task aggregate, event log, worktree service, artifact revisions, session records,
  and Build reducer remain reusable infrastructure.
- PR #63 and the next verification slice remain paused until this UX reset is implemented and
  accepted.

## Workflow templates

### Standard

Standard is the default for well-understood work:

```text
Clarify → Plan → Implement → Verify
```

Deliver is a post-Verify task action, not a stored workflow stage in this contract.

Clarify uses the task brief and one conversation to resolve material ambiguity. It does not
expose a blank Questions artifact editor. Plan is the first durable planning artifact and has a
human approval gate.

### Guided

Guided is for work that benefits from explicit discovery and design:

```text
Clarify → Research → Design → Plan → Implement → Verify
```

Deliver is a post-Verify task action, not a stored workflow stage in this contract.

The first slice implements Clarify through Plan. After each early stage completes, the server
creates the next primary session and carries forward the relevant artifact context. Plan is
started automatically after Design output is accepted, and the task pauses after the Plan
artifact is ready for human review and approval.

The user-facing labels describe the work. Existing stored stage values may remain compatible
with `questions`, `research`, `design`, `plan`, `build`, and `verify`; the presentation maps
`questions` to **Clarify** and `build` to **Implement** where appropriate.

### Freeform

Freeform is a task workspace without a required stage rail. The user can hold conversations and create artifacts without a required stage sequence. Explicit
planning, implementation, or verification entry is a later Freeform slice. The first Freeform
shell only guarantees the active conversation and task context. The application does not require
the user to understand session roles or context selection.

### First-slice availability

The first slice exposes all three templates in the creation form with honest behavior:

- Guided implements the complete Clarify → Research → Design → Plan path and is the acceptance
  path for this spec.
- Standard creates the same conversation-first shell and initial Clarify session. Its complete
  Implement and Verify path is a later slice.
- Freeform creates a conversation-first task with no automatic rail. Explicit stage entry and
  artifact workflows are later-slice behavior.

The creation form does not present a template as complete when only its shell is available. The
server workflow registry carries the same capability metadata and rejects unsupported stage-entry
or completion commands with a typed error; hiding a button is not the enforcement boundary.

## Reference interaction

The maintainer-provided task-creation reference establishes the interaction contract:

- repository or directory selection;
- inline task description as the initial source;
- task name and editable URL-safe slug;
- workflow template selection with plain-language descriptions;
- worktree timing selection: Now, Later, or Never;
- agent, model, and effort selection using existing provider settings;
- a visible workflow preview;
- one Create task action.

The first slice implements the inline source path and the three worktree timing choices. Source
integration tabs are excluded until their adapters exist. The form uses Kata terminology and
styling rather than copying HumanLayer product names or branding.

## User journey

### Create task

1. The user opens **Create task**.
2. The form collects the inline brief, task name, slug, repository, base ref, workflow, worktree
   timing, coding agent, model, and effort.
3. The form explains each workflow in terms of the work it performs. It does not expose contract
   versions, approval-policy literals, or schema names.
4. Creating a Guided task creates the durable task and its initial Clarify session. The user is
   navigated to the normal conversation surface in the task workspace.
5. Worktree behavior follows the selected timing:
   - **Now:** provision before the initial session starts.
   - **Later:** keep the task on the source repository until Plan approval, then provision before
     Implement.
   - **Never:** keep the task in the current repository context and leave implementation actions
     unavailable until the user selects a supported worktree policy.

### Clarify

The agent uses the brief and the conversation to identify ambiguity, goals, constraints, and
success conditions. The user answers through the normal composer. The resulting Clarification
artifact is generated and rendered as a readable summary. The screen does not ask the user to
write a generic Questions document.

### Research and Design

Guided starts a fresh primary conversation for each stage after the prior stage completes.
Research records relevant codebase facts, conventions, and evidence. Design records the chosen
approach, boundaries, and important decisions. Each artifact is visible in the task panel as a
stage output. The user can steer the active conversation and can inspect prior artifacts without
managing thread links.

The server creates the handoff context from the previous stage artifacts. The normal UI does not
show or require a context-manifest form.

### Plan

After Design output is accepted, Guided automatically starts the Plan session and generates the
Plan artifact. The task then pauses at the approval gate. The Plan artifact contains the proposed
scope, implementation slices, acceptance criteria, risks, and verification approach. The task
panel provides:

- the current Plan artifact;
- a short stage summary;
- **Approve plan**;
- **Request changes**, which returns feedback to the Plan conversation.

Plan approval is the first required human gate in the Guided-to-Plan slice. Implement controls do
not appear before approval.

### Implement and Verify

These stages are represented in the template but remain later delivery slices for this spec. The
existing hierarchical Build/checkpoint implementation becomes the internal engine for Implement
after the product-first task flow is accepted. Verify evidence follows as a separate vertical
slice.

Deliver is a post-Verify task action. It may render a final action such as **Open draft PR**, but
it is not part of the stored `TaskWorkspaceStage` union or the first-slice stage rail.

## Surface model

### Task creation surface

`TaskWorkspaceNewView` becomes a focused creation form. It owns user choices and validates them
before dispatching task creation. It does not display internal workflow-definition versions or an
approval-policy literal.

### Conversation surface and routes

`/tasks/$environmentId/$taskId` is the canonical task route. It resolves the task's current
primary session and composes the existing `ChatView` with a task-keyed workspace panel. The task
repository and primary session persist `environmentId` alongside the thread id, so the route can
construct the environment-scoped chat target required by `ChatView`. The task route has three
explicit bootstrap states:

- **Starting:** the task was persisted and the primary session is being created;
- **Ready:** the primary session exists and the conversation is rendered;
- **Failed:** session/worktree bootstrap failed, with the error and an idempotent Retry action.

Reloading `/tasks/$environmentId/$taskId` repeats the lookup from durable task state. It never
asks the user to select a thread. `TaskWorkspaceBootstrap` and `useTaskWorkspaceCommands` resolve
the route environment before subscribing or dispatching; they do not hard-code the primary
connection. If an existing task has no current primary session, the route shows the bootstrap
state and invokes the server-owned recovery path. The existing chat route remains usable for
ordinary non-task conversations; the task route owns task-panel composition. Legacy tasks may use
the primary connection only after repository/project mapping confirms that it is the task
environment.

### Environment lookup and subscription

New task links use the canonical route `/tasks/$environmentId/$taskId`. `TaskWorkspaceSidebar`
and the create response construct that route from the task repository environment. The existing
`/tasks/$taskId` route remains a compatibility resolver only; it redirects after an environment
lookup or shows a repair state when the lookup is ambiguous.

The client task store is keyed by `(environmentId, taskId)`. `TaskWorkspaceBootstrap` receives the
environment id, subscribes through that environment's task-workspace RPC connection, and records
bootstrap state under that scoped key. `useTaskWorkspaceCommands` receives the same environment id
and dispatches through that connection. `TaskWorkspaceView` derives its ChatView target from the
persisted session `{ environmentId, threadId }`; it never substitutes the primary environment.

For legacy tasks without an environment id, the server returns the repository/project mapping as
part of the task lookup. One matching environment is repaired into the task snapshot. Zero or
multiple matches produce an explicit recovery state and no automatic fallback.

### Task panel

The default panel contains only:

- the workflow rail or Freeform task status;
- the current stage and next user action;
- the current stage artifact or a clear empty/loading state;
- prior stage artifacts in a compact history;
- repository/worktree status;
- the relevant approval or continuation control.

The default panel does not contain:

- manual session linking;
- session role or fork controls;
- context-manifest creation;
- token-budget fields;
- raw thread identifiers;
- empty Comments, Deliver, or Implement panels for stages that have not started.

Advanced inspection may expose runtime provenance later, but it is outside the first slice.

### Artifact presentation

Stage artifacts render as documents with title, summary, revision, and source stage. The default
interaction is conversation-driven feedback. A raw Markdown editor is not the primary Clarify,
Research, Design, or Plan experience. Artifact revision and comment infrastructure remains
available to later review surfaces.

## Presentation vocabulary

The stored contract remains compatible while every user-facing surface uses one presentation map:

- stage `questions` → **Clarify**;
- artifact kind `questions` → **Clarification**;
- stage `build` → **Implement**;
- stage `verified` → **Done**;
- artifact kind `verification` → **Verification**;
- artifact kind `summary` remains internal handoff output.

`taskWorkspacePresets.ts` is the authoritative source for workflow descriptions, stage labels,
workflow previews, versioned catalog entries, and first-slice capabilities. Entries are keyed by
`preset@version`, not only by the current preset. Each entry declares `availableInFirstSlice`,
`autoAdvanceStages`, `humanGateStages`, and `explicitEntryStages`. The new `@0.2.0` entries
therefore describe Guided through Plan, Standard's conversation shell, and Freeform's
conversation shell without implying full Implement/Verify behavior. The older `@0.1.0` entries
remain available for historical tasks.

Sidebar, task panel, artifact history, browser fixtures, and E2E assertions consume that
presentation map rather than rendering stored literals. A catalog test fails when a user-facing
stage has no label, when a surface bypasses the map, or when a first-slice capability is shown as
implemented without an acceptance path.

## Runtime contracts

### Aggregate additions

The task aggregate needs explicit persisted state for the new user flow:

- `intake`: `title`, editable `slug`, `brief`, and `sourceKind: "inline"`;
- `preferences`: `worktreePolicy: "now" | "later" | "never"` and a `ModelSelection` value
  containing the provider instance, model, and provider option selections;
- `bootstrap`: `state: "pending" | "starting" | "ready" | "failed"`, stable operation key,
  current primary session id, route target, and a redacted error string;
- repository `environmentId` and `provisioningStatus: "pending" | "running" | "ready" | "failed"`;
- workflow-run `currentStageOccurrence`, `stageStatus: "starting" | "running" |
"awaiting-approval" | "awaiting-worktree" | "completed" | "failed"`, and an optional Plan
  gate containing `status: "open" | "approved" | "changes-requested"`, artifact revision,
  opening time, approver, and latest request-changes note;
- session `environmentId`, `ModelSelection`, stage occurrence, bootstrap operation key, and
  optional source session id;
- session status `superseded` in addition to `active` and `completed`, so a conflicting primary
  session can be resolved without deleting history;
- `taskRevision`, a per-task compare-and-set counter incremented on every task event;
- operation receipts keyed by operation key, with `pending`, `completed`, or `failed` status,
  source command id, result task revision, and redacted error. Receipts are part of the task
  snapshot, so replay can return an earlier result without repeating a side effect.

The current `provisioned` repository value decodes to the new user-facing `ready` state. Existing
fields remain readable through additive defaults. Existing `stageStatus` values default to
`running` for the current stage and `gate: null`.

### Task creation payload

The first-slice creation command extends the existing `task.create` payload with a typed intake
record and task preferences:

- `title`: required display name;
- `slug`: required URL-safe identifier, generated from title and editable before submission;
  it uses lowercase letters, digits, and single dashes, begins and ends with an alphanumeric
  character, and is limited to 80 characters;
- `brief`: required inline task description;
- `source`: `{ kind: "inline", body: brief }` for this slice;
- `operationKey`: client-generated stable create key reused when the create request is retried;
- `environmentId`, `projectId`, `workspaceRoot`, and `baseRef`: selected repository context;
- `preset`: `standard | guided | freeform`;
- `worktreePolicy`: `now | later | never`;
- `modelSelection`: the existing `ModelSelection` shape (`instanceId`, `model`, and optional
  provider `options`). Effort is represented by the provider option with id `effort` when that
  option exists; it is not a second task-specific model field.

`approvalPolicy` remains a server policy field and is not a user-facing literal. The server
validates the slug pattern and uniqueness within the environment, requires a non-empty brief
within the existing provider input limit, requires `source.kind === "inline"` and
`source.body === brief`, verifies that `environmentId` owns `projectId`, checks repository
authorization, and validates supported model selections and provider option values before
persisting the task.

New task versions use additive contract versions: `task-workspace@0.3.0` and
`task-artifact@0.3.0`. Existing `@0.2.0` events remain readable. The selected workflow versions
are append-only: `standard@0.2.0`, `guided@0.2.0`, and `freeform@0.2.0` describe the new
presentation and automatic stage behavior while `@0.1.0` definitions remain registered for
historical tasks. Prompt bundle versions advance with the corresponding workflow definition.

### Command and event transport

All task mutations carry the existing `commandId`, `taskId`, and `createdAt`. Every stage,
bootstrap, policy, gate, or recovery mutation additionally carries `expectedTaskRevision` and a
unique `operationKey`. `taskRevision` is a per-task compare-and-set counter; the existing global
NDJSON sequence remains an event-log position only. The operation receipt is written to the task
snapshot before any external side effect is retried. The first slice adds these exact typed
operations:

- `task.session.bootstrap` (server-owned): `{ stage, occurrence, sourceSessionId?, operationKey,
expectedTaskRevision }`; starts or resumes a primary session using the persisted `ModelSelection`.
- `task.stage.output.commit` (provider-neutral): `{ stage, sessionId, occurrence, artifactKind,
artifactTitle, markdown, operationKey, expectedTaskRevision }`.
- `task.stage.request-changes`: `{ stage: "plan", sessionId, occurrence, baseRevisionId,
feedback, operationKey, expectedTaskRevision }`.
- `task.plan.approve`: `{ planRevisionId, approvedBy, operationKey, expectedTaskRevision }`.
- `task.worktree.policy.set`: `{ policy: "now" | "later", operationKey, expectedTaskRevision }`;
  only a `never` task before Implement may use it.
- `task.session.recover-primary`: `{ stage, selection: { kind: "existing", sessionId } |
{ kind: "new" }, operationKey, expectedTaskRevision }`.

`task.create` includes `operationKey` and returns `{ sequence, task, routeTarget: null | { taskId,
environmentId, threadId }, bootstrapState }`. The create event stores that operation key on the
new task. A duplicate create request first looks up the operation receipt and returns the original
task; it never creates a second task. Bootstrap retries and stage operations return the existing
`TaskWorkspaceDispatchResult` when their operation receipt is already completed. A pending receipt
returns the current task and bootstrap state without starting a second side effect. A failed receipt
can be retried with the same operation key; the service records a new attempt and either completes
the original operation or leaves the same failure visible. A stale
`expectedTaskRevision`, wrong task/session, wrong environment, duplicate active occurrence,
invalid artifact kind, or invalid gate produces a typed `TaskWorkspaceError` and no partial
snapshot mutation.

The matching event types are `task.session.bootstrap.started`, `.ready`, and `.failed`,
`task.stage.output.committed`, `task.stage.gate.opened`, `task.stage.request-changes`,
`task.plan.approved`, `task.worktree.policy.changed`, and `task.session.primary.recovered`.
Each event uses the existing full-task snapshot envelope; operation key, command id, gate outcome,
receipt, session, artifact, and route state are persisted in that snapshot. These operations are
server validated and task/session scoped; the normal UI invokes only user actions for Plan approval,
request changes, retry, and worktree policy changes.

### Worktree policy

Worktree timing is persisted separately from Plan approval:

- `now` maps to immediate provisioning before the initial session;
- `later` maps to provisioning after Plan approval and before Implement;
- `never` maps to no task worktree and leaves Implement unavailable.

Provisioning has durable `pending`, `running`, `ready`, and `failed` states. A failed provision
or session bootstrap preserves the task and exposes Retry. Retrying the same operation is
idempotent by task and operation key. `never` tasks may complete the Guided-to-Plan slice and
remain reviewable; they cannot enter Implement until `task.worktree.policy.set` changes the policy
to `now` or `later` and provisioning reaches `ready`. A policy change is rejected after Implement
starts.

For replay compatibility, the decoder maps the existing repository `provisioned` value to
`ready`; the persisted compatibility encoder may continue accepting `provisioned` until all
writers use the new vocabulary.

Plan approval and worktree state follow this table:

| Policy  | After task creation                                                        | After Plan approval                                                                                 | Implement eligibility                                                    |
| ------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `now`   | Provisioning runs before the initial session; task waits or fails visibly. | Plan gate closes after approval and Implement bootstrap may start.                                  | Worktree must be `ready`.                                                |
| `later` | Initial sessions use the source repository; worktree is `pending`.         | Plan gate closes, provisioning starts, and the task enters `awaiting-worktree`.                     | Implement bootstrap starts only after provisioning reaches `ready`.      |
| `never` | No worktree is requested; task remains in the source context.              | Plan gate records `approved`, then workflow remains `awaiting-worktree` with Implement unavailable. | Requires `task.worktree.policy.set` followed by successful provisioning. |

A `later` or `never` task never claims to have entered Implement when no worktree is ready. A
provisioning failure after approval preserves the approved Plan and exposes Retry or a policy
change; it does not reopen the Plan gate or silently create a source-repository session.

### Primary-session bootstrap

Task creation persists the task before invoking side effects. A server-owned bootstrap service
then performs the following idempotent saga:

1. record bootstrap `pending`;
2. provision according to `worktreePolicy` when required;
3. create the primary session for the workflow's initial stage using the selected `ModelSelection`;
4. start the existing `thread.turn.start` flow in that session with the brief, stage prompt, and
   generated initial handoff context. Derive deterministic `commandId = <operationKey>:turn` and
   `messageId = <operationKey>:message`, persist both in the bootstrap receipt, and reuse them on
   restart. The turn-start operation cannot be duplicated after a completed receipt;
5. persist the session id, environment id, stage, model selection, and bootstrap `ready` state;
6. return the route target `{ taskId, environmentId, threadId }` used by
   `/tasks/$environmentId/$taskId` to compose `ChatView`.

Bootstrap uses the stable operation key
`<task-id>:bootstrap:<stage>:<occurrence>:primary`. The initial occurrence for every stage is `0`;
a transition to a new stage starts occurrence `0`, while request changes or recovery that creates
new work increments the current stage occurrence. Recovery that selects an existing session
preserves that session's recorded occurrence. Handoff uses a separate key:
`<task-id>:handoff:<source-session-id>:<target-stage>:<artifact-revision-id>`. Restart recovery
resumes `pending` or `running` bootstrap work. A duplicate request with the same operation key
returns the receipt result. A Retry reuses the same operation key and increments only the receipt
attempt count after a failed external operation; it never creates a second session for the same
stage occurrence. A task never receives two active primary sessions for the same stage occurrence.
Plan request-changes sessions therefore receive a new occurrence rather than colliding with the
original Plan bootstrap. The service records `failed` with a user-visible error when a provider,
worktree, or route target cannot be prepared.

### Guided stage output and transitions

Stage completion is a server-owned operation, not a manual UI button. The active primary session
submits `task.stage.output.commit` with `stage`, `sessionId`, `occurrence`, `artifactKind`,
`artifactTitle`, `markdown`, `expectedTaskRevision`, and `operationKey`. The server:

1. authorizes the session against the task, environment, current stage, and stage occurrence;
2. validates the artifact schema and persists its revision and stable block index;
3. marks the stage session complete;
4. emits `task.stage.output.committed` once by command id;
5. creates the next handoff manifest and primary session when the workflow allows it.

For Guided, Clarify → Research → Design transitions auto-start the next stage. Design completion
starts a new Plan occurrence, and Plan output opens a durable `plan-approval` gate containing the
Plan revision id. The workflow run remains `awaiting-approval` until `task.plan.approve` or
`task.stage.request-changes` is accepted. A stage output failure leaves the current stage visible
with Retry; it never silently advances.

`task.plan.approve` requires the current Plan revision id, approver identity, operation key, and
expected task revision. It records the gate outcome before starting the next operation, and it
rejects stale revision or task-revision values. `task.stage.request-changes` requires the Plan
session id, current Plan revision, feedback, operation key, and expected task revision. It
preserves the prior revision, starts a new Plan occurrence with a distinct bootstrap key, and
leaves the gate open until a new Plan revision is accepted and explicitly approved.

### Automatic handoff context

The server creates handoff context. The caller does not supply artifact references or token
budgets during ordinary stage progression. The persisted manifest has this logical shape:

```text
ContextManifest
├─ id, taskId
├─ taskContractVersion, artifactContractVersion, workflowDefinitionVersion, promptBundleVersion
├─ sourceSessionId?, targetSessionId?
├─ operationKey
├─ briefSnapshot: { sourceKind: "inline", body }
├─ artifactRefs: [{ kind, revision, selection: full | blocks | summary, blockIds[] }]
├─ tokenEstimate, budget
├─ summaryArtifactRef?
└─ createdAt
```

Each artifact reference includes `selection: "full" | "blocks" | "summary"`; `selection: "full"`
removes the ambiguity of an empty block-id array and is required for a whole-artifact handoff.
Legacy manifests retain their existing interpretation.

- The persisted manifest includes a brief snapshot with `sourceKind: "inline"` and the complete
  immediately preceding artifact by default.
- If the configured budget would be exceeded, the server selects stable artifact blocks or creates
  a summary artifact using the existing budgeting service. A full selection uses `selection: "full"`
  and `blockIds: []`; block selection always names its selected ids.
- The server derives stable block ids from headings when the artifact has no explicit markers. A
  collision fails loudly and does not advance the stage.
- The persisted manifest records the brief snapshot, selected revisions, block ids, token estimate,
  budget, and any summary artifact for recovery and advanced inspection.
- The active session id, target environment, and task id are authorized at creation; a manifest
  cannot be attached to a session or task from another aggregate.
- Automatic handoff uses the task's expected task revision and the handoff operation key
  `<task-id>:handoff:<source-session-id>:<target-stage>:<artifact-revision-id>`. Retries return the
  existing manifest/session association.

The default UI shows a human-readable artifact history. A future advanced inspector may expose
manifest provenance, but the first slice has no create/edit manifest controls.

### Agent selection

`modelSelection` reuses the existing `ModelSelection` contract: `instanceId`, `model`, and
optional provider `options`. Provider option ids remain provider-owned, such as `reasoningEffort`
for Codex or `effort` for Claude. The creation form renders descriptors from the selected provider
instance; unsupported options are hidden, and submitted values are validated against the provider
registry before persistence. A schema-valid but temporarily unavailable provider instance creates
the task with bootstrap `failed` so the user can repair or retry; an invalid model or option is
rejected before task creation.

The selection is persisted on the task and copied onto every automatic stage session. A stage may
only change provider/model through a later explicit user action, not as an accidental bootstrap
fallback. Legacy tasks with no selection use the existing primary provider/model defaults and
record that resolved `ModelSelection` in the first recovered session. The task service receives a
provider-registry capability resolver for validation; it does not duplicate provider option
schemas.

## Current-state migration

The current implementation is preserved as a compatibility base while its default presentation
changes:

- `TaskWorkspaceNewView.tsx` gains the product creation fields and removes the visible definition
  version and `before-build` literal.
- `TaskWorkspaceView.tsx` becomes the task-route composition of `ChatView` and a compact panel.
- `SessionsPanel.tsx` and `ContextManifestPanel.tsx` leave the default task surface. Their runtime
  data remains available to automatic orchestration and future advanced inspection.
- `TaskWorkspaceView.tsx` no longer renders a blank Questions textarea as the primary onboarding
  action. The existing fixture placeholder is test-only and must not appear in product copy.
- `taskWorkspacePresets.ts` remains the catalog source but receives the new user-facing stage
  labels, descriptions, and append-only workflow versions.
- `TaskWorkspaceCommand` and the task aggregate gain the intake, preferences, worktree policy,
  bootstrap state, and primary-session association needed for automatic startup. Existing events
  decode with deterministic defaults.
- Existing tasks with `task-workspace@0.2.0` use `worktreePolicy: later` to preserve the current
  Plan-before-provision behavior. Missing brief/source values are displayed as legacy intake
  derived from the task title; no fake clarification artifact is generated.
- Existing workflow definitions remain registered. The client catalog becomes a versioned map keyed
  by `preset@version`, so an old pinned definition never falls through to the unknown-definition
  rail when the new `@0.2.0` entries are added.
- Existing manually linked sessions remain readable. Adoption rules are deterministic: exactly one
  active primary session for the current stage is adopted; zero sessions enters recoverable
  bootstrap; multiple active primary sessions produces a visible conflict. The advanced recovery
  action `task.session.recover-primary` with `selection.kind: "existing"` preserves the selected
  session's occurrence and marks the other active primaries `superseded`; `selection.kind: "new"`
  increments the current occurrence and creates a fresh session. No session is silently discarded.
- Existing tasks with no `environmentId` resolve it from their persisted repository/project mapping;
  if that mapping is unavailable, the task route stays in Failed bootstrap with an explicit repair
  action rather than opening a thread in the wrong environment.
- `task.fixture.apply` remains a test adapter and is removed from normal Implement controls. Slice
  4 Build controls are integrated later under Implement rather than exposed as a task database
  panel.
- No existing task event log is deleted or rewritten in place. Replay tests cover old snapshots,
  old workflow versions, zero-session tasks, and conflicting primary-session tasks.

## Approaches considered

### Surgical panel cleanup

Hide the worst internal panels, rename a few labels, and keep the current task page and manual
session-link flow. This is the smallest code change, but the task lifecycle would still be
conversation-disconnected and users would still encounter architecture concepts during normal
work.

### Product-first shell over the existing domain — selected

Keep the durable task/workspace domain and Build infrastructure, then replace creation, session
bootstrap, task routing, and default panel presentation around one real Guided path. This keeps
useful persistence work and provides a clear vertical slice for validation.

### Restart task mode from the earlier design

Discard the current task-workspace contracts and rebuild the original task mode from scratch.
This gives a clean UX boundary but duplicates durable infrastructure and loses the useful artifact
and recovery work already present.

The selected approach preserves the runtime substrate while changing the user-facing boundary
and slice sequencing.

## Implementation phases

### Phase 1 — UX contract and creation shell

- Update the workflow catalog descriptions, append-only versions, and presentation labels.
- Rebuild `TaskWorkspaceNewView` around inline brief, title, slug, repository, base ref, worktree
  timing, template, and existing agent/model/effort settings.
- Add a workflow preview that shows the selected template's user-facing stages.
- Add typed task intake/preferences fields and legacy defaults.
- Remove internal version and schema terminology from the creation surface.

### Phase 2 — Bootstrap saga and conversation routing

- Add the server-owned bootstrap service and durable pending/running/ready/failed state.
- Create the initial primary session with the selected agent/model and deterministic operation key.
- Compose `/tasks/$environmentId/$taskId` from `ChatView` and the task-keyed panel after bootstrap
  is ready; retain `/tasks/$taskId` only as a compatibility resolver.
- Implement starting, ready, failed, retry, reload, and reconnect states.
- Preserve idempotency and restart recovery for task creation, worktree provisioning, and session
  bootstrap.

### Phase 3 — Guided Clarify → Research → Design → Plan

- Replace manual stage textareas and completion buttons with conversation-led stage output.
- Add typed stage-output completion, artifact validation, block indexing, and automatic handoff
  selection.
- Persist Clarification, Research, Design, and Plan revisions from stage outputs.
- Auto-start the next primary session through Design and automatically start Plan.
- Pause at Plan approval and implement Approve plan / Request changes with durable gate state.
- Display only the current artifact and compact prior-stage history.

### Phase 4 — Standard and Freeform variants

- Standard uses the same creation and conversation shell with the shorter Clarify → Plan →
  Implement → Verify sequence.
- Freeform hides the fixed rail and supports user-directed stage entry without exposing session or
  manifest construction.
- Add regression coverage proving the three catalogs retain distinct behavior and historical
  workflow versions remain readable.

### Phase 5 — Implement integration and later delivery slices

- Move the Slice 4 Build/checkpoint engine behind the Implement stage.
- Add commit-specific Verify evidence.
- Add draft PR delivery and external source integrations in later approved slices.

## Acceptance criteria

The first Guided-to-Plan product slice passes when all of the following are observable:

1. **Creation form:** A user can enter an inline task brief, title, editable slug, repository,
   base ref, worktree timing, workflow, coding agent, model, and effort, then create the task.
2. **Template language:** The form describes Standard, Guided, and Freeform in user-facing terms
   and shows the selected workflow preview without exposing contract versions or schema literals.
3. **Typed intake:** The server persists the brief, inline source, slug, environment, worktree
   policy, and `ModelSelection`; invalid slugs, unsupported selections, and unauthorized
   repositories fail before task creation. Stage output, request-changes, approval, bootstrap,
   and recovery commands carry session/operation identity plus expected task revision.
4. **Automatic start:** Creating a Guided task persists the task, performs the selected worktree
   policy, creates its initial primary Clarify session with the persisted `ModelSelection`, starts
   the initial turn with the brief and stage prompt, and opens the associated environment-scoped
   conversation without a manual session-link action.
5. **Bootstrap recovery:** A failed or interrupted worktree/session bootstrap is visible with a
   Retry action; retrying the same task operation does not create duplicate worktrees or sessions.
6. **Conversation-first layout:** The active conversation is the primary task surface and the
   task panel shows current stage context beside it. A new task does not open to a page of empty
   Sessions, Context manifests, Comments, or Deliver panels.
7. **Clarify artifact:** Completing Clarify through the conversation produces a readable artifact
   summarizing the task goal, constraints, open decisions, and success conditions. The user never
   has to fill a generic Questions textarea to proceed.
8. **Guided handoffs:** Research and Design sessions and artifacts start automatically after the
   prior stage completes. The user can inspect each artifact and send feedback through the active
   conversation without linking threads or choosing context records.
9. **Plan generation and gate:** Design completion automatically starts Plan and persists a readable
   Plan artifact. The task pauses at Approve plan / Request changes, and it cannot enter Implement
   before explicit approval.
10. **Request changes:** Request changes records the user's note, preserves the prior Plan
    revision, and starts a Plan continuation session automatically. A new Plan revision is required
    before approval can succeed.
11. **Internal context:** The server records authorized handoff context with deterministic
    artifact blocks, budget/compression metadata, and task/session association, but the default UI
    contains no context-manifest editor, token-budget field, raw thread ID, fork form, or
    session-role selector.
12. **Worktree policy:** Now, Later, and Never produce the documented worktree behavior and show
    clear repository/worktree status in the task panel. Plan approval leaves `now` eligible for
    Implement, `later` in `awaiting-worktree` until provisioning is ready, and `never` in
    `awaiting-worktree` with Implement unavailable. A policy change and retry are explicit,
    idempotent actions.
13. **Recovery:** Restarting the server or reconnecting the client during Clarify, Research,
    Design, or the Plan gate restores the same task stage, primary session, artifact revisions,
    bootstrap state, and approval state.
14. **Presentation vocabulary:** The creation form, sidebar, task panel, artifact history, and
    browser/E2E surfaces use the shared Clarify/Implement/Done presentation map and contain no
    raw Questions/Build literals where the user-facing map applies.
15. **No fixture leakage:** Fixture-only text such as `What should the fixture prove?`, `Apply
fixture build`, and raw task-control terminology is absent from the normal creation and
    Guided-to-Plan surfaces.
16. **Historical compatibility:** Existing `task-workspace@0.2.0` tasks and `@0.1.0` workflow
    definitions decode, render a known historical catalog entry, and follow the documented
    zero/one/multiple-primary-session adoption rules without event-log rewriting.
17. **Evidence:** A headed browser/UAT walkthrough captures task creation, automatic conversation
    start, each Guided artifact handoff, Plan review, approval/request-changes behavior, bootstrap
    failure/retry, and restart recovery. A Playwright test covers the primary path under the
    task-workspaces feature tag.

### Later template acceptance

These criteria are Phase 4 gates and are not required to pass the first Guided-to-Plan slice.
The first slice still makes the options honest:

- Standard can be selected, creates the conversation-first shell, and starts Clarify. Its full
  Implement and Verify path is unavailable until its Phase 4 slice is shipped.
- Freeform can be selected, creates a conversation-first task without a mandatory rail, and does
  not claim automatic stage progression. Explicit stage entry arrives in Phase 4.
- Neither preview shell exposes a control that implies its deferred stages are complete.

## Testing and verification

- Contract tests cover task brief, slug, inline source, worktree policy, agent selection,
  bootstrap state, stage-output commands, request-changes commands, and legacy decoding defaults.
- Server tests cover automatic primary-session creation, idempotent task creation, all worktree
  policies, stage completion handoffs, artifact block indexing, handoff authorization, Plan gating,
  request-changes routing, bootstrap failure/retry, and restart/reconnect recovery.
- Web browser tests cover creation fields, workflow previews, conversation-first routing, hidden
  internal panels, stage/artifact rendering, Plan gates, and the presentation vocabulary map.
- Existing lower-level session, manifest, comment, and Build tests remain as runtime regression
  coverage. Tests for manual UI construction of those records are removed or moved to an advanced
  inspection suite.
- The current task-workspace browser/E2E tests that assert manual Questions/Research editors,
  version literals, session-link forms, or manifest creation are replaced by the Guided-to-Plan
  path. Their persistence assertions remain in server tests where they still describe runtime
  behavior.
- Desktop E2E covers the Guided-to-Plan path through the normal product surface, using the existing
  task-workspaces feature tag.
- Manual UAT captures the reference creation form, Clarify/Research/Design handoffs, Plan gate,
  bootstrap failure/retry, restart recovery, and the absence of internal controls.
- Required repository gates remain `vp check` and `vp run typecheck`; the task-workspace E2E and
  release smoke paths run when the environment supports them.

## Out of scope

- GitHub, Linear, Jira, or other external source adapters.
- Slack notifications.
- Full Implement, Verify evidence, or draft PR delivery behavior.
- User-authored workflow definitions.
- Advanced session forking, reviewer/debugging roles, or manual context selection.
- Automatic Plan amendment and Build checkpoint UI beyond keeping the existing runtime substrate.
- Mobile-native task workspace UI.

## Risks and mitigations

- **Automatic session bootstrap touches orchestration boundaries.** Reuse the existing provider
  thread-start path and add a task-owned service boundary with idempotent creation tests.
- **Old tasks have manual sessions and older stage labels.** Preserve stored enums, historical
  workflow descriptors, deterministic defaults, and explicit adoption outcomes rather than
  rewriting event history.
- **Artifact completion remains ambiguous.** Require a typed stage-output result from the active
  primary session, validate the expected stage/session/version, and surface a visible failure when
  the agent does not produce the required artifact.
- **Automatic handoff can leak or misattribute context.** Select references server-side, authorize
  task/session ownership, record budget/compression metadata, and reject cross-task manifests.
- **Provider settings differ by agent.** Store a neutral selection with provider-specific validation
  and inherit the resolved selection across automatic stage sessions.
- **Worktree timing can blur task state.** Keep repository readiness visible and make each policy's
  next action explicit in the creation form and task header.
- **The Build PR contains useful work but wrong presentation.** Keep its reducer and contracts as
  internal infrastructure and defer user-facing integration until the new task shell is proven.

## Build handoff

- Implement only the product-first creation and Guided-to-Plan slice described here.
- Keep Standard and Freeform catalog compatibility, but defer their complete paths to Phase 4.
- Preserve durable task/workspace/artifact/session events and add the specified additive decoding
  defaults for new fields.
- Use the existing `ChatView` and task route composition rather than a standalone task database
  page.
- Do not expose manual session linking, context-manifest creation, fork controls, or raw task
  control commands in the default UI.
- Do not begin Slice 5 or merge the existing Slice 4 PR as a product milestone until this slice
  passes its browser/UAT acceptance criteria.
- The spec remains Draft until adversarial review and explicit maintainer approval are complete.
