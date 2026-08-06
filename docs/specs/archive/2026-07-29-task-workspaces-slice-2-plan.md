---
type: Spec
title: "Task workspaces Slice 2 — Artifact workspace, comments, revisions, and multiple sessions"
description: "Child implementation plan for the second autonomous vertical slice: make a Standard task a reviewable workspace with artifact lineage/selection, stable block comments, multiple stage sessions, ad hoc sessions, context forks, and reviewer sessions."
status: Verified
roadmap_status: Historical
approved_at: 2026-07-29T17:15:00Z
verified_at: 2026-07-29T23:20:00Z
tags: [specs, task-workspaces, workflows, artifacts, comments, sessions, orchestration, web, server]
timestamp: 2026-07-29T16:54:00Z
parent: /specs/2026-07-28-task-workspaces-vertical-slices-design.md
base_sha: 12cc158e8b8210e96b74800b7b9772280ffe8d59
---

# Task workspaces Slice 2 — Artifact workspace, comments, revisions, and multiple sessions

## Status

**Historical delivery record; Verified.** Merged to `main` via
[PR #58](https://github.com/gannonh/kata-code/pull/58) (`25ce0cc1`). Headed UAT, focused gates,
review hardening, and cumulative desktop `@task-workspaces` E2E are recorded in
[Slice 2 validation](/specs/evidence/2026-07-29-task-workspaces-slice-2-validation.md). The
authoritative current roadmap is [Task mode — product-first workflows](/specs/archive/2026-08-01-task-mode-design.md).

## Outcome

A person can open a Slice 1 Standard task and treat it as a reviewable workspace: browse the
artifact collection, compare and select Plan revisions, comment on stable Plan blocks (with
outdated/orphaned lifecycle), run alternative and reviewer sessions alongside the primary stage
session, start an ad hoc session and a context fork without advancing the workflow, and keep all
of that state after restart.

Slice 1's end-to-end Standard path (Questions → Plan approval → Build fixture → Verify signoff)
continues to work unchanged.

## Base

- **Parent:** [/specs/2026-07-28-task-workspaces-vertical-slices-design.md](/specs/2026-07-28-task-workspaces-vertical-slices-design.md)
- **Prerequisite:** [/specs/2026-07-28-task-workspaces-slice-1-plan.md](/specs/2026-07-28-task-workspaces-slice-1-plan.md)
  (Verified; feature merge `a660027c`, parent-approval docs tip `12cc158e`)
- **Code base SHA for implementation:** `12cc158e8b8210e96b74800b7b9772280ffe8d59`
- **Program ACs (incremental):** TW-AC5, TW-AC6; TW-AC7 incremental (new commands + frontmatter
  non-effect). Slice 1 already established idempotent event-sourced commands.

## Current-state research

| Area                  | Path                                                                                  | Slice 1 state                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Contracts             | `packages/contracts/src/taskWorkspace.ts`                                             | Stages, artifacts/revisions, sessions `{id,stage,threadId,createdAt}`, `comments: Unknown[]`, commands through signoff |
| RPC                   | `packages/contracts/src/rpc.ts`, `ipc.ts`                                             | `taskWorkspace.dispatchCommand` + `subscribe`                                                                          |
| Server                | `apps/server/src/taskWorkspace/TaskWorkspaceService.ts`                               | NDJSON reducer, subscribe-before-snapshot, Git fixture path                                                            |
| Tests                 | `TaskWorkspaceService.test.ts`, `taskWorkspace.test.ts`, `taskWorkspaceStore.test.ts` | Progression, restart, idempotence                                                                                      |
| Web store             | `apps/web/src/taskWorkspace/taskWorkspaceStore.ts`                                    | Snapshot + upsert sync; `currentTaskStage`                                                                             |
| UI                    | `apps/web/src/components/taskWorkspace/TaskWorkspaceView.tsx`                         | Stage rail, single linked session, per-stage editors                                                                   |
| Routes                | `apps/web/src/routes/tasks.new.tsx`, `tasks.$taskId.tsx`                              | Create + workspace                                                                                                     |
| Reuse (patterns only) | `apps/web/src/reviewCommentContext.ts`, `PlanSidebar.tsx`                             | Anchored comment cards / markdown panel patterns — not task-workspace-backed                                           |

## User-visible path

1. Open an existing Slice 1 Standard task (or create one and stop at Plan with a Plan artifact that
   includes `<!-- kata:block:… -->` markers).
2. View the artifact collection (Questions, Plan, Verification).
3. Link an **alternative** Plan session (existing thread + context manifest) and upsert a second
   Plan revision.
4. Compare two Plan revisions in the lineage UI, then select a non-latest revision as current.
5. Comment on a stable Plan block, reply, then resolve the thread.
6. Upsert a Plan revision that changes block content → thread becomes `outdated`; remove the
   marker → `orphaned`.
7. Link an **ad-hoc** session (no stage) and confirm the stage rail does not advance.
8. **Fork** from a parent session (new thread + fork point + manifest) and inspect the manifest.
9. Link a **reviewer** session with a manifest; capture reviewer findings as comments and/or a
   Plan/Verification upsert; confirm navigator shows role `reviewer`.
10. Restart the server, re-pair if needed, and confirm artifacts, comments, sessions, manifests,
    and block indexes rehydrate.

## Scope

### Included

- Artifact collection UI with list, revision history, lineage, compare, and select-current.
- `task.artifact.select-revision` and revision lineage metadata (`supersedesRevisionId`).
- Stable Markdown block markers and a **persisted** block index on each artifact revision.
- Threaded comments with typed author identity and statuses
  `open | resolved | outdated | orphaned`.
- Multiple sessions per stage; roles matching the parent locked set:
  `primary | reviewer | alternative | debugging | ad-hoc`.
- Session navigator (role, provider label, status, linked thread).
- Extended `task.session.link`, `task.session.fork`, context manifests.
- Frontmatter/YAML cannot mutate workflow (TW-AC7 incremental).
- Restart rehydration; idempotent receipts; Slice 1 path regression.

### Excluded

- Auto-create or steer provider turns from task commands.
- New artifact kinds; workflow presets; plan amendments; multi-repo; GitHub intake; delivery PR;
  SQL event-store migration; rich context budgets / unresolved-comment packing (Slice 3+).
- Dedicated Build-debug UX for `debugging` role beyond schema + navigator visibility (UAT may
  link a debugging session; no separate AC demo required). File follow-up if product wants a
  Build-debug flow later.

## Architecture decisions

### 1. Extend the Slice 1 aggregate in place

Extend `taskWorkspace.ts` and `TaskWorkspaceService.ts`. Keep NDJSON + subscribe-before-snapshot.
No SQL migration.

### 2. Artifact lineage and selection

Upsert appends a revision and sets `supersedesRevisionId` to the previous current revision id when
one exists. `task.artifact.select-revision` sets `currentRevision` to an existing revision
**number** for a given `kind` without rewriting lineage edges. Compare UI shows ≥2 revisions;
select updates current without deleting history. Kinds remain `questions | plan | verification`.

### 3. Stable blocks and persisted block index

Marker syntax: `<!-- kata:block:<id> -->` immediately before a region. On every artifact upsert
the server persists `blockIndex` on that revision:

```text
BlockIndexEntry { id, headingPath, contentHash }
```

Select-revision reads the stored index. Comment create fails loudly if the target block is missing
from the base revision index. Heading text changes / reorders that preserve `id` keep identity;
content-hash changes mark comments `outdated`; missing ids mark `orphaned`. Threads are never
deleted.

### 4. Sessions (locked parent roles)

```text
role: primary | reviewer | alternative | debugging | ad-hoc
```

Use parent literals exactly (`ad-hoc` with hyphen; include `debugging` in schema even when UAT
focuses on primary/alternative/reviewer/ad-hoc/fork).

Additional fields:

| Field               | Type                         | Notes                                                         |
| ------------------- | ---------------------------- | ------------------------------------------------------------- |
| `stage`             | `TaskWorkspaceStage \| null` | Required for non-ad-hoc; `null` only when `role === "ad-hoc"` |
| `parentSessionId`   | string \| null               | Set by fork                                                   |
| `forkPoint`         | string \| null               | Opaque message/turn marker                                    |
| `contextManifestId` | string \| null               | Required for alternative, reviewer, fork                      |
| `provider`          | string \| null               | Display label; Slice 1 replay defaults `null`                 |
| `status`            | `active \| completed`        | Slice 1 replay defaults `active`                              |

**Stage gate:** Linking `primary | alternative | reviewer | debugging` requires
`workflowRun.currentStage === command.stage` (same spirit as Slice 1). `ad-hoc` is exempt and
must use `stage: null`.

**Fork** is the `task.session.fork` command (not a role). It requires an existing parent session
id, a new `threadId`, `forkPoint`, `role`, and `contextManifestId`.

Slice 2 does not launch provider turns. Artifacts still come from `task.artifact.upsert`.

### 5. Context manifests (intentionally subset)

```text
ContextManifest
├─ id, taskId, createdAt
├─ sessionId?
├─ artifactRefs: [{ kind, revision, blockIds[] }]
└─ notes?
```

Parent §13 fields such as token budgets and unresolved-comment ids are deferred to Slice 3+.
Manifests are immutable; sessions store `contextManifestId`.

### 6. Comment author identity

```text
CommentAuthor { kind: "user" | "agent", id: string, displayName: string }
CommentMessage { id, author: CommentAuthor, body: string, createdAt }
CommentThread {
  id, taskId, artifactId, anchorBlockId, baseRevisionId,
  status: open | resolved | outdated | orphaned,
  messages: CommentMessage[],
  createdAt, resolvedAt?, resolvedBy?
}
```

Reply allowed when status is `open` or `outdated` (not `orphaned` or `resolved`). Resolve sets
`resolved` + `resolvedAt` + `resolvedBy`.

### 7. Frontmatter cannot command the workflow

Artifact markdown may include YAML frontmatter for portable metadata only. The reducer never
reads frontmatter to advance stages. A planted `status: approved` frontmatter edit leaves
`currentStage` and approval state unchanged.

### 8. Workspace UI

Expand `TaskWorkspaceView`:

- Stage rail + Slice 1 controls.
- **Artifacts:** list, lineage, compare (≥2 revisions), select current, editor bound to current.
- **Comments:** threads for selected artifact with status chips.
- **Sessions:** navigator (role/provider/status/thread).
- **Manifest inspector:** read-only view of a session's context manifest.

Reuse `reviewCommentContext` / `PlanSidebar` as visual patterns only.

### 9. Replay / migration rules for Slice 1 events

When decoding historical sessions: `role` defaults to `primary`; `provider`/`parentSessionId`/
`forkPoint`/`contextManifestId` default `null`; `status` defaults `active`; `stage` remains
required as stored. `comments` empty array stays valid. New optional revision fields default
absent/`null`. Event `type` literals expand; unknown types still fail loud (unchanged policy).

## Contract and command schemas

### New / changed schema highlights

- `TaskWorkspaceSessionRole = "primary" | "reviewer" | "alternative" | "debugging" | "ad-hoc"`
- `TaskWorkspaceSession.stage: NullOr(TaskWorkspaceStage)`
- `TaskWorkspaceArtifactRevision.supersedesRevisionId: NullOr(string)`
- `TaskWorkspaceArtifactRevision.blockIndex: Array<BlockIndexEntry>` (persisted at upsert)
- `TaskWorkspace.comments: Array<CommentThread>` (replace `Unknown`)
- `TaskWorkspace.contextManifests: Array<ContextManifest>` (new collection on aggregate)
- Event types add: `task.artifact.select-revision`, `task.context-manifest.create`,
  `task.session.fork`, `task.comment.create`, `task.comment.reply`, `task.comment.resolve`
  (and keep existing Slice 1 literals). `task.session.link` remains the link event type.

### Commands (Slice 2 additions / changes)

Shared base: `commandId`, `taskId`, `createdAt`.

| Command                         | Required fields                                                                                                                                                                        | Result                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `task.artifact.select-revision` | `kind`, `revision` (number)                                                                                                                                                            | Sets that kind's `currentRevision`.                  |
| `task.context-manifest.create`  | `artifactRefs[]`, optional `notes`, optional `sessionId`                                                                                                                               | Appends immutable manifest; returns id on task.      |
| `task.session.link`             | `threadId`, `role`, `stage` (`null` iff `role === "ad-hoc"`); `contextManifestId` required when `role` is `alternative` or `reviewer`, optional for `primary` / `debugging` / `ad-hoc` | Links thread; stage gate as above.                   |
| `task.session.fork`             | `parentSessionId`, `threadId`, `forkPoint`, `role`, `contextManifestId`, `stage` (null iff ad-hoc)                                                                                     | Appends child session with parent + fork metadata.   |
| `task.comment.create`           | `artifactId`, `anchorBlockId`, `baseRevisionId`, `author`, `body`                                                                                                                      | Opens thread if block exists on base revision index. |
| `task.comment.reply`            | `threadId`, `author`, `body`                                                                                                                                                           | Appends message if thread `open` or `outdated`.      |
| `task.comment.resolve`          | `threadId`, `resolvedBy` (CommentAuthor)                                                                                                                                               | Sets resolved.                                       |

Slice 1 commands unchanged. Invalid transitions → `TaskWorkspaceError`; duplicate `commandId` →
original receipt.

**Link vs fork:** Fork always uses `task.session.fork`. Do not invent a `role: "fork"`.

## Exact UI states

| Surface   | States / interactions                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifacts | Empty collection; per-kind list; revision list with lineage edges; compare two revisions; select current (disabled if already current); editor dirty/save upsert |
| Comments  | Empty; open thread; reply composer; resolve; chips for outdated/orphaned; create disabled if no block index entry                                                |
| Sessions  | Empty; primary link; multi-role list; open thread; fork dialog (parent, fork point, manifest); ad-hoc link                                                       |
| Manifest  | Empty; show refs/block ids/notes for selected session's manifest                                                                                                 |

## Provider and platform

- **Providers:** link existing threads only; no auto session create/steer.
- **Web + desktop-dev:** primary UAT surfaces (shared web code).
- **Mobile:** no new chrome; ordinary-thread fallback must not error (TW-AC17 partial).

## Implementation phases

### Phase A — Contracts

Schemas, commands, event literals, replay defaults; contract tests for new types and Slice 1
decode compatibility.

### Phase B — Server reducer

Persisted block index; comment lifecycle; multi-session link/fork; manifests; select-revision;
heading-change / whole-file rewrite tests; frontmatter non-effect; restart; Slice 1 regression.

### Phase C — Web workspace

Artifact compare/select; session navigator; comments; manifest inspector; browser tests.

### Phase D — Validation

Focused gates + headed UAT evidence + Playwright `e2e/tests` scenario tagged for task workspaces
(AGENTS Feature Validation) + draft PR pending sign-off.

## Acceptance criteria

Stable ids for Build/Verify matrices:

1. **TW-S2-AC01** Artifact collection lists Questions, Plan, and Verification with revision
   history and lineage.
2. **TW-S2-AC02** User can compare two Plan revisions, then select a non-latest revision as
   current without deleting newer revisions; editor shows selected markdown.
3. **TW-S2-AC03** An `alternative` Plan session can be linked with a context manifest and upsert
   a second Plan revision without changing stage until an explicit stage command runs.
4. **TW-S2-AC04** A Plan revision with `<!-- kata:block:… -->` markers persists a block index on
   that revision (id, heading path, content hash).
5. **TW-S2-AC05** Same block id survives heading text change and reorder; content-hash change
   marks open threads `outdated`; removed marker marks `orphaned`; threads are not deleted.
6. **TW-S2-AC06** Comment create/reply/resolve works with typed `CommentAuthor`; restart retains
   identity fields.
7. **TW-S2-AC07** An `ad-hoc` session links with `stage: null` and does not advance the workflow.
8. **TW-S2-AC08** `task.session.fork` records `parentSessionId`, `forkPoint`, and
   `contextManifestId` and appears in the navigator.
9. **TW-S2-AC09** A `reviewer` session with a manifest can record findings (comment and/or
   artifact upsert) visible in the UI; navigator shows role `reviewer`.
10. **TW-S2-AC10** Context manifests list artifact revision and block ids and are inspectable.
11. **TW-S2-AC11** Restart reconstructs artifacts, current revisions, persisted block indexes,
    comments (including outdated/orphaned), sessions (role/provider/status), and manifests.
12. **TW-S2-AC12** Duplicate Slice 2 `commandId` values do not create another comment, session,
    selection, or event.
13. **TW-S2-AC13** Planted workflow-like YAML frontmatter does not change `currentStage` or
    approval state (TW-AC7 incremental).
14. **TW-S2-AC14** Slice 1 Standard path still succeeds on the same aggregate.
15. **TW-S2-AC15** Invalid Slice 2 transitions return a typed error and leave the snapshot
    unchanged.
16. **TW-S2-AC16** Session navigator shows role and provider label (null provider allowed).

**Program mapping:** TW-AC5 ← AC03, AC07, AC08, AC09, AC11; TW-AC6 ← AC01–AC06, AC10–AC11;
TW-AC7 incremental ← AC12–AC13 (+ Slice 1 command discipline).

## Automated test matrix

| AC                    | Automated coverage                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| AC01–AC02             | Contract + store tests; `TaskWorkspaceView` browser tests for compare/select                                              |
| AC03, AC07–AC09, AC16 | Service integration for link/fork/roles; browser navigator                                                                |
| AC04–AC05             | Service unit/integration: index persistence, heading change, rewrite, outdated/orphaned                                   |
| AC06                  | Service comment identity + restart replay                                                                                 |
| AC10–AC11             | Service restart; manifest decode                                                                                          |
| AC12–AC13, AC15       | Service idempotence + frontmatter non-effect + invalid transition                                                         |
| AC14                  | Existing Slice 1 integration path remains green                                                                           |
| E2E                   | `e2e/tests/` Playwright scenario `@task-workspaces` covering compare, comment lifecycle, multi-session (after headed UAT) |

## Failure, recovery, rollback

- Invalid commands → `TaskWorkspaceError`; snapshot unchanged.
- Comment create against missing block → typed error (visible).
- Block parse/index failure on upsert → command fails; no partial revision appended.
- Slice 1 session replay without `role` → default `primary` / `active`.
- Rollback: revert feature commits; NDJSON remains forward-compatible for unread new event types
  only if never deployed — production rollback requires not shipping partial writers without
  readers (ship contracts + server + web together).

## Required evidence

- Recording: alternative Plan session, compare/select, comment → revise → outdated/orphaned →
  resolve, ad-hoc, fork, reviewer findings.
- Screenshots: artifact list/lineage/compare; comment states; session navigator with
  role/provider; reviewer findings; manifest inspector.
- Outputs: two Plan revisions; block index JSON; comment projection; two manifests; post-restart
  snapshot.
- Logs: heading-change and whole-file rewrite tests; comment identity/restart; session/fork
  tests; frontmatter non-effect; focused tests; `vp check` / typecheck / test / release:smoke.
- AC matrix for TW-S2-AC01–16 and TW-AC5/6/7 incremental.
- Negative: duplicate command ids, invalid transitions, frontmatter non-effect.

## PR handoff and deferred work

Draft PR on the implementation branch with validation record and
`Recommendation: Pending user sign-off`. Do not merge without human acceptance.

Defer explicitly (file GitHub deferred issues when Build starts if not already tracked):

- Full parent context-manifest richness (token budgets, unresolved comment packing) — Slice 3+.
- Dedicated Build-debug UX for `debugging` role.
- Playwright E2E if temporarily blocked — still required for AGENTS Feature Validation before
  Verified; prefer land with the slice.

## Risks and safeguards

- **Role/stage confusion:** nullable stage only for `ad-hoc`; stage gate for other roles.
- **Comment churn:** content-hash outdated vs missing orphan; never drop threads.
- **Manifest drift:** immutable manifests by id.
- **Locked parent roles:** schema uses parent literals including `debugging` and `ad-hoc`.
- **Provider coupling:** link-only keeps Slice 2 testable without live model credentials.

## Completion rule

Slice 2 is complete only when all TW-S2-AC criteria are evidenced, required checks pass, the
Playwright scenario is green or explicitly deferred with a tracking issue, and the draft PR
contains a reproducible validation record. Pending user sign-off. Does not authorize Slice 3+.

## Adversarial review record

Fresh-context review against parent Slice 2 / TW-AC5–7 and Slice 1 contracts produced blocking
findings on missing child-spec sections, role enum drift, underspecified commands, stage
nullability/replay, ephemeral block index, evidence/AC gaps, and author identity. This Draft
incorporates those fixes. Delegated approval still requires a human read of this Draft before
status becomes Approved / Build starts.
