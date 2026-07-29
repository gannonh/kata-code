---
type: Spec
title: "Task mode — workflow-driven tasks with a live plan artifact panel"
description: "First-class Task entity that executes a staged workflow (Setup → Questions → Plan → Build → Verify), codifying the plan-build-verify skill into the product with a dynamic right-side artifact panel, anchored comments, approval gates, and thread-per-stage fresh context."
status: Superseded
superseded_by: /specs/2026-07-28-task-workspaces-vertical-slices-design.md
tags: [specs, task-mode, workflow, artifact, orchestration, contracts, web, server]
timestamp: 2026-07-03T00:00:00Z
---

# Task mode — workflow-driven tasks with a live plan artifact panel

## Status

**Superseded** by
[Task workspaces — artifact-driven workflows delivered as autonomous vertical slices](/specs/2026-07-28-task-workspaces-vertical-slices-design.md)
(Approved 2026-07-29). Kept as historical context for the earlier Task Mode framing.

## Goal

Add a task mode to Kata Code: a first-class **Task** entity that moves work through a staged
workflow (product framing: **Plan – Build – Verify**), integrated into the product UI rather
than driven by ad-hoc prompting. A task owns a dedicated worktree, a spec/plan **artifact**
(a portable markdown file in the workspace), and one thread per workflow stage. A dynamic
right-side panel renders the artifact, live work-item progress, stage rail, approval gates,
and anchored comments that the agent reads and resolves.

The workflow codifies the battle-tested [`plan-build-verify`
skill](../../.agents/skills/plan-build-verify/SKILL.md). That skill's stage semantics,
gate discipline, and — critically — its carefully refined prompt language consistently
deliver good results and are the substrate for the stage prompt templates here. At the same
time, stage prompts are content, not schema: the design deliberately leaves room to iterate
on prompt language, stage sub-steps, and workflow shape without contract changes.

## References

- Source workflow: [`.agents/skills/plan-build-verify/SKILL.md`](../../.agents/skills/plan-build-verify/SKILL.md) and its `references/plan.md`, `references/build.md`, `references/verify.md`
- Companion skills referenced by workflow sub-steps: `user-acceptance`, `simplify`, `strict-quality-review`, `okf` (sub-steps in deferred stages)
- User-supplied mock: task creation form with workflow selection (RPI / PRD-oriented / oneshot / freeform), auto-advance toggle, worktree setup, and a vertical stage rail (worktree → questions → research → design → outline → implement → PR)
- Existing product plan surfaces: `apps/web/src/components/PlanSidebar.tsx`, `apps/web/src/proposedPlan.ts`, `OrchestrationProposedPlan` in `packages/contracts/src/orchestration.ts`
- Comment block format precedent (client-side only): `apps/web/src/reviewCommentContext.ts` parses/renders `<review_comment>` blocks; the composer lives in mobile (`apps/mobile/src/features/review/reviewCommentSelection.ts`). Task mode reuses the block _format_; server-side turn-prompt injection is new infrastructure (see Risks)
- Existing worktree bootstrap: `ThreadTurnStartBootstrap` (`prepareWorktree`, `createThread`) in `packages/contracts/src/orchestration.ts` and `apps/server/src/ws.ts`
- File-watch precedent: `apps/server/src/serverSettings.ts` (debounced `fs.watch`)

## Domain model and vocabulary

"Plan – Build – Verify" is the product-level framing. The domain model underneath:

| Term          | Meaning                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**      | Top-level unit of work: worktree + artifact + threads + one workflow                                                                                                                                                                                      |
| **Workflow**  | The stage graph a task executes. Data-driven definition; v1 ships one built-in (`kata-default`)                                                                                                                                                           |
| **Stage**     | Human-visible workflow node: Setup, Questions, Research, Design, Plan, Build, Verify, Ship                                                                                                                                                                |
| **Sub-step**  | Internal step within a stage (draft, agent review, checks, evidence). Shown as progress within the stage, not as rail nodes. (Named to avoid the existing `OrchestrationThreadActivity` thread-event type; this spec says "thread event stream" for that) |
| **Artifact**  | The spec/plan markdown file in the worktree; owns plan content and Build work items                                                                                                                                                                       |
| **Work item** | A plan-defined item in artifact frontmatter that Build executes (named to avoid collision with stages and with the existing `steps` plan UI)                                                                                                              |
| **Comment**   | User or reviewer note anchored to a work item or artifact section                                                                                                                                                                                         |
| **Gate**      | A stage property requiring explicit user action to advance (approval, signoff)                                                                                                                                                                            |

The full stage graph is modeled from day one; v1 executes a subset (see Scope). The
`kata-default` workflow:

```text
Task
  Workflow (kata-default)
    Setup                system stage: worktree provisioning
    Questions            agent stage, interactive: refine and disambiguate the task
    Research             deferred in v1 (folded into Plan)
    Design               deferred in v1 (folded into Plan)
    Plan                 agent stage, approval gate
      sub-steps: draft → agent review (adversarial) → human review (comments) → approve
    Build                agent stage
      sub-steps: implement → review/revise loop → checks (repo gates)
    Verify               agent stage, signoff gate
      sub-steps: evidence → acceptance   (per the user-acceptance skill)
    Ship                 deferred in v1 (pre-PR review, docs, open PR)
```

Deferred stages appear muted in the stage rail; adding them later is workflow data plus
prompt content, not schema change.

## Scope

**In scope (v1):**

- Task entity, workflow/stage state machine, and projections on the server (full 8-stage model)
- Execution of **Setup → Questions → Plan → Build → Verify** in the built-in workflow
- Artifact contract (frontmatter work items + markdown body), server-side watcher/parser
- Task creation from the sidebar with automatic worktree provisioning
- Thread-per-stage orchestration with stage prompt templates adapted from the plan-build-verify skill
- Right-side task panel: stage rail, artifact rendering, live work-item progress, gate controls
- Server-stored comments anchored to sections/work items, injected into agent turns, creatable and resolvable by agents via artifact frontmatter
- Adversarial second-agent plan review as a Plan-stage sub-step
- Verify evidence checklist mapped to acceptance criteria with user signoff
- Providers: Pi, Claude, Codex
- Platforms: web + desktop

**Out of scope (v1):**

- Research, Design, Ship stage execution (modeled, muted in the rail, no prompts/automation)
- Cross-stage rollback (reopening Plan from Build); v1 has restart-current-stage plus gate-driven revision only
- Worktree cleanup on task completion/abandonment
- Custom or user-defined workflow definitions; workflow selection UI
- Mobile task UI (task threads render as ordinary threads)
- Slack/webhook notifications for artifacts and comments (mock feature, later)

## Constraints

- **Provider uniformity.** No per-provider adapter parsing for task mode. All progress,
  completion, comment-creation, and comment-resolution signals ride on artifact file edits
  plus existing thread event streams; every provider can edit files.
- **Fail loud.** Parse failures, provisioning failures, contract violations, and turn
  failures surface visibly and block advancement; nothing silently stalls or silently
  advances.
- **Reliability first.** All task/stage state is event-sourced through the existing
  projection pipeline and survives server restarts and client reconnects.
- **Portability.** The artifact file is valid standalone markdown a human or another tool can
  read without the server. Server projections mirror it; they do not replace it.
- **Skill fidelity with room to improve.** Stage prompt templates start from the
  plan-build-verify skill's language (it is battle-tested; a lot of subtle refinement has
  gone into it). Prompts live as versioned content the team can iterate on without schema or
  code changes, and improvements to the skill and the product prompts should cross-pollinate.
- Fork rules apply: no upstream product strings; branding constants from
  `packages/shared/src/branding.ts`.

## Architecture

### Task entity and state machine (server)

New `task` domain alongside threads, persisted through the existing event-sourced
contracts → commands/events → projections → WS stream pipeline:

```text
Task
├─ id, projectId, name, slug, createdAt
├─ worktreePath, branch
├─ workflowId ("kata-default")
├─ currentStageId
├─ stageStatus: "running" | "awaiting-input" | "awaiting-approval"
│               | "awaiting-signoff" | "failed"
├─ taskStatus: "active" | "verified" | "abandoned"        (terminal states)
├─ stageHistory: [{ stageId, startedAt, completedAt, gateOutcome }]
├─ autoAdvance: boolean
├─ artifactPath (relative to worktree, e.g. .kata/tasks/<slug>.md)
├─ threads: [{ threadId, stageId, createdAt }]
└─ comments: [{ id, anchor, text, authorKind: "user" | "agent-review",
                createdAt, resolvedAt, resolvedBy, orphaned }]
```

`stageHistory` is the projection the stage rail renders completed stages from; Verify
signoff sets `taskStatus: verified`.

`WorkflowDefinition` is a contracts schema shipped as a built-in constant:

```text
WorkflowDefinition
├─ id: "kata-default"
└─ stages: [
     { id: "setup",     kind: "system",  gate: "none" }
     { id: "questions", kind: "agent",   gate: "none", interactive: true }
     { id: "research",  kind: "agent",   deferred: true }
     { id: "design",    kind: "agent",   deferred: true }
     { id: "plan",      kind: "agent",   gate: "approval",
       subSteps: ["draft", "agent-review", "human-review"] }
     { id: "build",     kind: "agent",   gate: "none",
       subSteps: ["implement", "review-revise", "checks"] }
     { id: "verify",    kind: "agent",   gate: "signoff",
       subSteps: ["evidence", "acceptance"] }
     { id: "ship",      kind: "agent",   deferred: true }
   ]
```

### Artifact contract

Markdown file in the task worktree. The file owns content; the server owns process state.

```markdown
---
type: task-artifact
task: <slug>
stages: # per-stage completion map, monotonic; agents append their
  questions: complete # own stage's key when done. No reset protocol needed.
  plan: draft # draft | complete
work_items: # optional until Plan writes them; at most one in_progress
  - id: w1
    title: Wire contracts
    status: pending | in_progress | completed
acceptance: # written by Verify; mirrored into projections
  - id: ac1
    criterion: "Sidebar task creation provisions a worktree"
    status: pass | fail | blocked
    evidence: "e2e/verify-evidence/task-mode/ac1.png or textual summary"
new_comments: # agent-authored comments; server consumes idempotently
  - id: agent-generated-stable-id
    anchor: w1 | "## Section heading"
    text: "..."
resolved_comments: [c1, c2] # server consumes idempotently
---

# <Title>

## Goal

## Approach

## Acceptance criteria

1. ...
```

**Parsing and mirroring.** The server watches the artifact (debounced `fs.watch`, same
pattern as `apps/server/src/serverSettings.ts`; Setup creates the `.kata/tasks/` directory
so the watch target exists before any agent write), parses frontmatter, and mirrors
work-item statuses, stage completion, and acceptance results into projections so the UI
never re-parses markdown. Parse failure raises a visible panel error, blocks stage
completion, and injects a structured parse-error notice into the agent's next turn.

**Contract rules (fail loud):**

- At most one work item may be `in_progress`. Violations surface as a panel contract
  warning and the earliest `in_progress` item wins for activity correlation.
- `stages` keys are monotonic per stage instance: a stage's agent sets `draft` while
  working (only meaningful during gate-driven revision, below) and `complete` when done.
  Watcher-observed transitions to `complete` are the completion signal; the server state
  machine is authoritative and ignores flags for stages it does not consider active.
- `new_comments` / `resolved_comments` are consumed **idempotently**: the server tracks
  processed comment ids, so an agent's whole-file rewrite that resurrects an
  already-consumed entry is a no-op. Unknown ids in `resolved_comments` surface as panel
  warnings. `new_comments` entries with anchors that do not match a work item or section
  heading create the comment in `orphaned` state (visible, not dropped).
- The server writes to the artifact only at stage boundaries (no agent turn in flight),
  and only to prune consumed `new_comments`/`resolved_comments` entries as hygiene.
  Because consumption is idempotent, this pruning is optional and can never lose data.

**Git policy.** The artifact is deliberately committed: it is the task's durable
documentation and ships in the eventual PR diff. Setup creates the directory; Build-stage
commits include artifact updates like any other file.

### Stage orchestration

Each stage transition:

1. Server composes the stage prompt: stage instructions (adapted from the corresponding
   plan-build-verify reference), current artifact contents, unresolved comments (rendered
   in the `<review_comment>`-style block format), and a server-templated prior-stage line
   (stages completed so far and their gate outcomes — the artifact itself is the real
   handoff; no summarization turn).
2. Server starts a **fresh thread** scoped to the task worktree (provisioned once at Setup).
   Fresh context per stage is deliberate: the artifact is the handoff, mirroring how the
   skill's Build phase starts from the approved spec file rather than
   planning-conversation memory. The existing turn-start bootstrap logic in
   `apps/server/src/ws.ts` is client-command-scoped today; phase 4 extracts it into a
   server-invocable service (see Risks).
3. Agent works. The server derives live progress from artifact edits (work-item statuses)
   plus the thread's event stream.
4. Agent signals completion by setting its stage's key in the `stages` frontmatter map to
   `complete`. **Questions** creates the artifact file (minimal frontmatter, resolved
   questions recorded in the body, `work_items` absent) and sets `stages.questions:
complete` — file creation alone is not a completion signal. **Plan** fills the body and
   `work_items` and sets `stages.plan: complete`.
5. Server runs post-completion sub-steps (e.g. Plan's adversarial review), then applies the
   gate.

**Gate semantics:**

- `awaiting-approval` (Plan): panel offers **Approve** and **Request changes**.
  - _Approve_ → gate outcome recorded in `stageHistory`, advance to Build.
  - _Request changes_ → user supplies a note; stage returns to `running`; the server starts
    a new turn **in the same stage thread** (drafting context is valuable) carrying the
    note and all unresolved comments. The revision prompt instructs the agent to set
    `stages.plan: draft` while revising and `complete` when done; the watcher treats the
    observed `draft → complete` transition as the new completion signal. If the revision
    turn ends without that transition, the server surfaces a contract-violation error and
    the stage stays `running` with a retry affordance. Restart-stage (fresh thread)
    remains the escape hatch.
- `awaiting-signoff` (Verify): panel offers **Sign off** and **Reject**, with identical
  revision mechanics (`stages.verify: draft → complete`). Sign off sets
  `taskStatus: verified`.

**Auto-advance:**

- When on, approval gates auto-approve — with one safety rule: auto-advance **waits for the
  adversarial review sub-step to finish**, and proceeds only if the review posted zero
  unresolved comments. Any unresolved finding parks the task at `awaiting-approval` for a
  human decision. Verify signoff always requires the user.
- Toggling auto-advance on while a task is already parked at a gate does **not**
  retroactively advance it; the setting applies to future gate evaluations. The user
  approves the parked gate explicitly.
- Unresolved comments always carry forward: whichever stage runs next receives them in its
  opening prompt until resolved.

**Adversarial review (Plan sub-step):** when the plan is marked complete, the server starts
a separate fresh-context review thread whose prompt instructs it to challenge the spec (the
skill's six review lenses: acceptance-criteria gate, placeholder scan, internal
consistency, scope, ambiguity, feasibility) and post findings via the artifact's
`new_comments` frontmatter key (`authorKind: agent-review`). When the review thread
completes, the task moves to `awaiting-approval` (or auto-advances per the rule above) with
findings visible in the panel.

**Interrupts and steering:** the user can always send messages into the active stage thread.
V1 rollback is restart-current-stage (fresh thread, same stage) plus the gate-driven
revision loops above.

### Progress signaling (decision record)

File-derived status was chosen over provider-injected tools and output markers:

- Uniform across Pi/Claude/Codex with zero per-provider adapter work
- Fully portable: the artifact alone tells the whole story
- Failure mode (parse errors) is visible and debuggable, consistent with fail-loud
- Live per-work-item activity: thread events that arrive while exactly one work item is
  `in_progress` attach to that item in the panel; when zero items are `in_progress`,
  activity renders at stage level

### Comments

Server-stored records anchored to a work item id or artifact section heading, created by
users (panel UI) or agents (`new_comments` frontmatter). Unresolved comments are injected
into the next turn of whichever stage is active as structured blocks (reusing the
`<review_comment>` block _format_ from `apps/web/src/reviewCommentContext.ts`; the
server-side prompt injection itself is new infrastructure). Agents resolve comments by
listing ids in `resolved_comments`; consumption is idempotent as specified in the artifact
contract. If a comment's anchor disappears (section renamed, work item deleted), the
comment surfaces as "orphaned" in the panel and is still injected with its last-known
context.

## UI design

### Left sidebar — Tasks section

Collapsible section below chats. Each task row shows name, current stage, and a status
indicator (running / awaiting input / awaiting approval / failed / verified). A "New task"
action opens a lightweight creation form: name, description, project, base branch. Creation
provisions the worktree/branch automatically and starts the Setup → Questions flow.
Selecting a task opens the task view.

### Task view — stage rail + task panel

The task view shows the active stage's thread in the conversation area plus a task-scoped
right panel. Because the existing right-panel state (`apps/web/src/rightPanelStore.ts`) is
keyed by thread and a task panel must persist across the task's per-stage threads, the task
panel gets its **own task-keyed store** (peer to `rightPanelStore`, keyed by task id) rather
than a new surface kind inside the thread-keyed store. Panel contents:

- **Stage rail:** the 8 stages of the workflow definition (vertical or horizontal per
  available width, per the mock). Current stage highlighted, completed stages (from
  `stageHistory`) checked, deferred stages muted. Clicking a completed stage shows its
  output (Plan → artifact, Verify → evidence).
- **Artifact area:** rendered artifact body (via `ChatMarkdown`, as `PlanSidebar` does
  today) with the work-item list rendered natively from projections. Statuses live-update
  as the agent edits the file. During Build, the single `in_progress` work item shows
  current agent activity beneath it.
- **Gate controls:** Approve / Request changes (Plan), Sign off / Reject (Verify), per the
  gate semantics above. The auto-advance toggle lives in the task header.
- **Comments:** hovering a section or work item exposes a comment affordance; comments
  render inline-anchored with resolve state and author kind (user vs agent review).

### Questions stage UX

Questions runs in the conversation itself (agent asks, user answers in the composer). The
panel shows the stage as active and, once complete, a summary of resolved questions (from
the artifact body). No new questionnaire UI in v1.

## Error handling

- **Artifact parse failure** → panel error banner; stage cannot complete; agent's next turn
  receives a structured parse-error notice.
- **Contract violation** (multiple `in_progress` items, missing `draft → complete`
  transition after revision, unknown `resolved_comments` ids) → visible panel warning or
  error per the artifact contract rules; never a silent stall.
- **Agent turn failure/interruption** → stage status `failed` with a retry action (fresh
  thread, same stage).
- **Worktree provisioning failure** → task creation fails visibly with the git error; no
  partial task is created.
- **Orphaned comment anchor** → visible "orphaned" state; still injected with last-known
  context.
- **Server restart mid-stage** → task rehydrates from projections; in-flight turns follow
  existing session-restart behavior; stage status preserved.

## Acceptance criteria

Task lifecycle:

1. From the sidebar "New task" action, a user can create a task with name and description;
   creation provisions a dedicated worktree/branch and starts the workflow. The task appears
   in a tasks section of the left sidebar with its current stage visible.
2. A task progresses Setup → Questions → Plan → Build → Verify. Each agent stage runs in its
   own fresh thread scoped to the task's worktree. Stage state is server-persisted and
   survives server restart and client reconnect (reopening the app shows the correct stage,
   threads, and artifact state).
3. Plan → Build requires explicit user approval of the plan artifact unless auto-advance
   applies (see AC 4). Requesting changes at a gate returns the stage to running with the
   user's note and unresolved comments delivered to the agent, and a revised completion is
   detectable (observed `draft → complete` transition). Verify concludes with user signoff
   setting the task to Verified.
4. A per-task auto-advance toggle exists. When on: the Plan gate auto-approves only after
   the adversarial review completes with zero unresolved comments; otherwise the task parks
   at awaiting-approval. Toggling auto-advance on while parked at a gate does not
   retroactively advance the task. Verify signoff always requires the user.

Artifact:

5. The Questions stage creates the artifact file (resolved questions recorded, completion
   signaled via `stages.questions: complete`); the Plan stage completes it with frontmatter
   work items (id, title, status) and a body including a `## Acceptance criteria` section.
   The file is valid standalone markdown (portable).
6. The task panel renders the artifact: body sections plus a native work-item list derived
   from server projections, with per-item status (pending / in progress / completed).
7. When the agent edits the artifact file, the panel reflects work-item status and content
   changes without a manual refresh.
8. A malformed artifact (unparseable frontmatter) surfaces a visible error in the panel and
   blocks stage completion; it does not silently stall the workflow. Contract violations
   (e.g. multiple `in_progress` work items) surface as visible warnings.

Comments:

9. A user can attach a comment to a work item or body section in the panel. Comments are
   server-persisted and survive restart.
10. Unresolved comments are injected into the next turn of the active stage as structured
    context; the agent can resolve a comment via `resolved_comments`, resolution is
    idempotent, and resolution state is visible in the panel.

Stages:

11. During Build, when exactly one work item is `in_progress`, the panel attributes live
    agent activity to that item; completed work items update as the agent progresses. With
    zero `in_progress` items, activity renders at stage level.
12. Before plan approval is requested, an adversarial review runs in a separate
    fresh-context session and posts findings as comments (via `new_comments`,
    `authorKind: agent-review`) visible in the panel.
13. Verify writes per-criterion results to the artifact's `acceptance` frontmatter
    (Pass/Fail/Blocked + evidence); the panel renders them and the user signs off from the
    panel.
14. The stage rail shows all 8 workflow stages with Research, Design, and Ship visibly
    deferred (muted); current and completed stages render from `stageHistory`.

Providers and platform:

15. Per-provider artifact-contract E2E passes for Pi, Claude, and Codex, and one full manual
    loop per provider (create → questions → plan → approve → build → verify → signoff) is
    evidenced per the user-acceptance skill.
16. Task mode ships in web + desktop; mobile renders task threads as ordinary threads
    without errors.

Quality gates:

17. `vp check` and `vp run typecheck` pass; E2E coverage exists for the core loop (create
    task → questions → plan → approve → build → verify → signoff) under a `@task-mode`
    feature tag.

## Implementation phases

Eight phases grouped into three build milestones. Each milestone lands as a reviewable,
demoable unit; if a milestone proves too dense during Build, a per-milestone deep-dive spec
may be authored (as the environments roadmap did with its phase deep-dives) without
reopening this spec.

**Milestone A — core substrate (server-only):**

1. **Contracts + task entity + projections.** Task/workflow/stage schemas in
   `packages/contracts`, server commands/events, stage state machine incl. gate outcomes and
   `stageHistory`, projections, WS stream. No UI. Ties to AC 2.
2. **Artifact contract + watcher/parser.** Frontmatter schema (stages map, work items,
   acceptance, comment keys), debounced watch with directory bootstrap, idempotent comment
   consumption, status mirroring into projections, parse-error and contract-violation
   surfacing. Ties to AC 5, 7, 8.
3. **Task creation + sidebar.** Creation form, worktree provisioning via the existing
   bootstrap path, sidebar tasks section. Ties to AC 1.
4. **Stage orchestration.** Extract turn-start bootstrap from `ws.ts` into a
   server-invocable service; prompt composition from skill-derived templates; thread-per-
   stage; gate semantics incl. request-changes/reject revision loops; auto-advance rules;
   restart-stage; failure states. Ties to AC 2, 3, 4.

**Milestone B — task surface (web/desktop UI):**

5. **Task panel.** Task-keyed panel store, stage rail, artifact rendering, work-item list,
   live activity correlation, gate controls. Ties to AC 6, 11, 14.
6. **Comments.** Store, panel UI, turn injection, `new_comments`/`resolved_comments`
   consumption, orphan handling. Ties to AC 9, 10.

**Milestone C — review, verify, and hardening:**

7. **Adversarial review + Verify UX.** Review thread sub-step, findings via `new_comments`,
   acceptance-results rendering, signoff. Ties to AC 12, 13.
8. **Provider matrix + E2E + UAT.** Pi/Claude/Codex hardening, `@task-mode` E2E for the core
   loop plus a slim per-provider artifact-contract E2E, manual UAT per provider. Ties to
   AC 15, 16, 17.

Phases 1–2 are pure server/contracts work; UI scaffolding starts only after phase 1 freezes
the schemas.

## Testing and verification

- **Contracts:** schema round-trip tests (workflow definition, task entity, artifact
  frontmatter parse incl. malformed and contract-violating inputs).
- **Server:** unit tests for stage-machine transitions (incl. request-changes/reject
  revision loops and auto-advance rules), gate enforcement, artifact watcher/parser,
  idempotent comment consumption (incl. resurrection-after-whole-file-rewrite), prompt
  composition, and restart rehydration.
- **Web:** logic tests for panel state derivation and activity correlation; browser tests
  for stage rail and work-item rendering.
- **E2E:** `@task-mode` tag; core loop on desktop-dev with one provider; per-provider slim
  artifact-contract E2E for the matrix.
- **Manual UAT:** full loop per provider (Pi, Claude, Codex) before merge, evidence captured
  per the user-acceptance skill.

## Risks and mitigations

| Risk                                                                                                                                                   | Mitigation                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agents drift from the artifact contract (wrong frontmatter, skipped statuses, missing revision transitions)                                            | Skill-derived prompts state the contract explicitly; violations surface as visible errors and are injected back into the agent's next turn; per-provider E2E pins the contract |
| Comment-key resurrection via whole-file agent rewrites                                                                                                 | Idempotent consumption keyed by processed comment ids; server frontmatter pruning happens only at stage boundaries and is optional hygiene                                     |
| Server-side turn-prompt composition and server-initiated turn starts are new infrastructure (today's bootstrap lives in the WS client-command handler) | Phase 4 extracts a server-invocable turn-start service before stage orchestration builds on it; treated as a named refactor cost, not incidental work                          |
| Long Build stages exhaust context despite thread-per-stage                                                                                             | Work items give natural checkpoints; restart-stage recovers; compaction behavior follows existing provider handling                                                            |
| Stage prompts underperform the interactive skill (no human in the loop mid-stage)                                                                      | Questions stage front-loads disambiguation; comments give a structured mid-stage feedback channel; prompts are versioned content, iterated without code changes                |
| Task-keyed panel store diverges from thread-keyed right-panel architecture                                                                             | Deliberate: a separate task-keyed store (documented above) rather than forcing task state into `byThreadKey`; boundary reviewed in phase 5                                     |
| Three-provider matrix inflates verification cost                                                                                                       | Core-loop E2E on one provider; slim artifact-contract E2E per provider; manual UAT for the rest                                                                                |

## Explicitly deferred work

- Research, Design, and Ship stage execution (including PR creation, pre-PR review
  sub-steps, and documentation sub-steps mapped to the `simplify`,
  `strict-quality-review`, and `okf` skills)
- Cross-stage rollback beyond gate-driven revision
- Worktree cleanup on task completion/abandonment
- Custom workflow definitions and workflow selection UI (the mock's RPI / PRD-oriented /
  oneshot / freeform choices)
- Mobile task UI
- Slack/webhook artifact and comment notifications

On approval, register these in [deferred-work.md](/specs/deferred-work.md) with this spec as
the source.

## Build handoff

- **Approved scope:** the v1 scope above; stage prompts adapted from
  `.agents/skills/plan-build-verify/references/` with fidelity to their refined language.
- **Non-goals:** everything under Out of scope and Explicitly deferred work.
- **Ordered phases:** Milestones A → B → C; do not start phase 4+ UI-visible behavior
  before phase 1 schemas are frozen; phase 4's bootstrap extraction precedes stage
  orchestration.
- **Required verification:** Testing and verification section; AC 17 gates completion.
- **Fixtures:** per-provider E2E requires provider credentials; follow the
  `kata-code-e2e-testing` skill and existing `@agent` tag patterns for credentialed runs.
- **Blocking questions:** none at approval time. If artifact-watch latency or frontmatter
  parsing proves problematic during phase 2, surface it before building phase 4 on top.

## Adversarial review record (2026-07-03)

A fresh-context reviewer challenged the draft; 17 of 19 findings were accepted and folded
in (gate transition semantics, per-stage completion map, acceptance-results schema, agent
comment creation via `new_comments`, task-keyed panel store, accurate precedent citations,
Questions completion signal, idempotent comment consumption, auto-advance × review
interplay, mid-gate toggle semantics, sub-step rename, activity-correlation rules, artifact
origin, observable provider AC, terminal states + stage history, artifact git policy,
prior-stage summary definition). Two were rebutted:

- **Link style** (`/specs/...`): root-absolute links are this OKF bundle's convention (see
  `docs/index.md`); no change.
- **Split into multiple specs:** task mode is one coherent subsystem with interlocking
  stages, not independent subsystems; splitting would multiply gate overhead. Accommodated
  by grouping phases into three demoable milestones with optional per-milestone deep-dives
  during Build.
