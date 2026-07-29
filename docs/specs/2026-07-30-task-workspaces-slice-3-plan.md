---
type: Spec
title: "Task workspaces Slice 3 — Workflow presets and guided context boundaries"
description: "Child implementation plan for the third autonomous vertical slice: replace the hardcoded Standard rail with a data-driven, versioned workflow registry; ship Standard, Guided, and Freeform presets; and make context manifests budget-aware and inspectable."
status: Draft
tags: [specs, task-workspaces, workflows, presets, context, versioning, orchestration, web, server]
timestamp: 2026-07-30T00:00:00Z
parent: /specs/2026-07-28-task-workspaces-vertical-slices-design.md
base_sha: 6aceff8a85b8a6dfd673ceb9947b7518d8aa9579
---

# Task workspaces Slice 3 — Workflow presets and guided context boundaries

## Status

**Draft.** Awaiting human review before Approved / Build. This child spec plans only Slice 3 and
does not approve any later slice.

## Outcome

A person can create Standard, Guided, and Freeform tasks from a workflow picker. A Guided task
runs Questions → Research → Design → Plan, producing a separate artifact per reasoning stage,
and each next-stage session starts from a compact, inspectable context manifest rather than the
whole prior transcript. A Freeform task accumulates sessions and artifacts with no fixed rail
until the person explicitly starts Plan or Verify. Changing a built-in workflow definition in
development does not mutate any existing task.

Slice 1's and Slice 2's Standard behavior continues to work unchanged on the same aggregate.

## Base

- **Parent:** [/specs/2026-07-28-task-workspaces-vertical-slices-design.md](/specs/2026-07-28-task-workspaces-vertical-slices-design.md)
  ([Slice 3 section](/specs/2026-07-28-task-workspaces-vertical-slices-design.md#slice-3--workflow-presets-and-guided-context-boundaries))
- **Predecessor:** [Slice 2](/specs/2026-07-29-task-workspaces-slice-2-plan.md), merged as `25ce0cc1`
- **Base SHA:** `6aceff8a85b8a6dfd673ceb9947b7518d8aa9579`
- **Absorbs deferred:** [#55](https://github.com/gannonh/kata-code/issues/55) — richer context
  manifests. Its recorded revisit trigger is "Slice 3+ context-budget work", which this slice is.

## Current-state research

Read before planning; these are the constraints Slice 3 actually inherits.

1. **There is no workflow engine today.** `TaskWorkspaceService.ts` hardcodes every transition
   inside its command handlers — `currentStage: "plan"` at line 767, `"build"` at 822, `"verify"`
   at 913, `"verified"` at 1011. Nothing reads a definition. "Making the engine data-driven" is
   therefore net-new construction, not a refactor of an existing abstraction.
2. **`preset` is a single literal.** `TaskWorkspaceWorkflowRun.preset` is
   `Schema.Literal("standard")` (contracts line 212) and `task.create` requires
   `preset: "standard"` (line 271). Both must widen.
3. **Versions are constants, not a registry.** `STANDARD_WORKFLOW_VERSION` /`PROMPT_VERSION` are
   module constants (service lines 45–48) stamped onto the task at creation. A task records the
   version string but there is no way to resolve *that version's* definition later — so the
   parent spec's negative proof ("editing the latest definition does not mutate an existing
   task") is currently unprovable in either direction.
4. **The stage union is Standard-shaped.** `TaskWorkspaceStage` is
   `questions | plan | build | verify | verified`. Guided needs `research` and `design`.
5. **Artifact kinds are Standard-shaped.** `questions | plan | verification`. Guided needs
   `research` and `design` artifacts, and context budgeting needs a `summary` kind.
6. **Artifact-kind gating is a hardcoded ladder.** `task.artifact.upsert` maps stage→kind with a
   nested ternary (service lines 744–758). This becomes a definition lookup.
7. **Manifests are deliberately minimal.** `TaskWorkspaceContextManifest` carries `artifactRefs`
   + `notes` only (contracts 166–176) — no token estimate, no budget, no summary linkage.
8. **The creation UI hardcodes Standard.** `TaskWorkspaceNewView.tsx` posts `preset: "standard"`
   (line 53) and prints "Standard · standard@0.1.0" (line 124).
9. **Worktree creation already happens at `task.plan.approve`**, not at creation — so
   "no worktree before Build" is currently true for Standard and needs an explicit assertion plus
   preservation for Guided/Freeform, not new machinery.

## User-visible path

1. Create a task from a workflow picker offering Standard, Guided, and Freeform with preset
   descriptions.
2. Run a Guided task through Questions → Research → Design → Plan, each stage producing its own
   artifact.
3. Open the context manifest inspector on each next-stage session and see exactly which artifact
   blocks were carried forward, with a token estimate against the budget.
4. Create a Freeform task, add sessions and artifacts with no rail, then explicitly start Plan
   and Verify.
5. Edit the built-in Guided definition in development, reload, and observe an existing Guided
   task still running its original pinned version.

## Scope

### Included

- Versioned workflow definition registry with three built-ins: `standard`, `guided`, `freeform`.
- Table-driven stage transitions, artifact-kind gating, and terminal-stage rules read from the
  pinned definition.
- Workflow picker in task creation, with preset descriptions and version display.
- New stages `research`, `design`; new artifact kinds `research`, `design`, `summary`.
- Freeform timeline behavior: no implicit rail; explicit `task.stage.start` for Plan/Verify.
- Prompt bundle versioning alongside workflow definition versioning.
- Context budget: block selection, token estimation, `summary` artifacts, manifest inspector UI.
- Lazy provisioning: assert no worktree exists before Build for all three presets.
- Replay compatibility for every Slice 1 / Slice 2 task.

### Excluded

- Hierarchical Build, checkpoints, plan amendments (Slice 4).
- Commit-specific verification and the evidence browser (Slice 5).
- User-authored or user-editable workflow definitions — built-ins only.
- Real token counting via a provider tokenizer; Slice 3 uses a deterministic local estimator.
- Build-debug UX for the `debugging` role ([#56](https://github.com/gannonh/kata-code/issues/56)
  stays deferred; its trigger is a product request, not this slice).

## Architecture decisions

### 1. Definitions are versioned data, resolved by pinned id

A workflow definition is a plain data record — ordered stages, per-stage artifact kind, allowed
transitions, approval policy, prompt bundle ref. Built-ins live in an append-only registry keyed
by `"<preset>@<semver>"`. A task pins `definitionVersion` at creation and every subsequent
reducer decision resolves *that* key.

This is what makes the parent spec's negative proof real: bumping `guided@0.1.0` → `guided@0.2.0`
leaves `guided@0.1.0` in the registry, and the existing task keeps resolving the old record.
Superseded versions are never deleted.

**Open decision for review:** whether a task also stores an inline *snapshot* of its resolved
definition. Registry-only is cleaner and keeps the aggregate small, but a definition dropped from
a future build would strand old tasks. Recommendation: registry-only in Slice 3, with a decode
error that names the missing version — and revisit if we ever ship user-authored definitions.

### 2. Transitions become a lookup, not a ladder

`task.questions.complete` / `task.plan.approve` and friends stop naming their successor stage.
The reducer asks the definition for the successor of the current stage and validates that the
requested transition is legal. Standard's table reproduces today's behavior exactly, so Slice 1 /
Slice 2 regression is the proof that the table is faithful.

### 3. Freeform has stages but no automatic rail

Freeform is modeled as a definition whose transition table is empty except for explicit entries
into `plan` and `verify`. That keeps one code path — there is no "railless mode" branch. A new
`task.stage.start` command performs an explicit transition that the definition permits.

### 4. Stage and artifact-kind unions widen; replay defaults hold

`TaskWorkspaceStage` gains `research`, `design`. `TaskWorkspaceArtifactKind` gains `research`,
`design`, `summary`. Both are additive literal unions, so Slice 1 / Slice 2 events decode
unchanged. `preset` widens from `Schema.Literal("standard")` to a three-way literal union with a
decoding default of `"standard"` for pre-Slice-3 rows.

### 5. Context manifests become budget-aware

`TaskWorkspaceContextManifest` gains `tokenEstimate`, `budget`, and `summaryArtifactRef`.
Selection is explicit: the manifest records which block ids were carried, so the inspector shows
provenance rather than a recomputed guess. When selected blocks exceed budget, the stage produces
a `summary` artifact and the manifest references it instead of the raw blocks. This closes
[#55](https://github.com/gannonh/kata-code/issues/55).

Token estimation is a deterministic local function in Slice 3 — reproducible in tests and
CI-stable. Provider-accurate counting is out of scope.

### 6. Prompt bundles version alongside definitions

`PROMPT_VERSION` becomes a per-definition `promptBundleRef`, so a Guided stage prompt can change
without touching Standard. The task's `versions.prompt` records the resolved bundle at creation
and is pinned identically to the definition.

### 7. Slice 1 and Slice 2 behavior is the regression contract

Every existing Standard test must pass unmodified. If a Standard test needs editing to
accommodate the engine, that is a signal the table is wrong — not that the test is stale.

## Implementation phases

### Phase A — Workflow definition registry and contracts

Registry module + three built-ins; widened stage/kind/preset schemas; `task.stage.start`;
manifest budget fields. Contract tests for Slice 1 / Slice 2 decode compatibility and for
old-version resolution.

### Phase B — Server reducer becomes table-driven

Replace hardcoded transitions and the artifact-kind ladder with definition lookups. Standard
regression suite must pass untouched. Negative proof test: mutate the latest definition in a
fixture, assert an existing pinned task is unaffected. No-worktree-before-Build assertions.

### Phase C — Guided path and context budgeting

Research and Design stages end to end; block selection; token estimation; `summary` artifact
generation at budget overflow; manifest provenance.

### Phase D — Web surfaces

Workflow picker with preset descriptions and version display; Guided rail; Freeform timeline;
manifest inspector showing carried blocks, estimate, and budget. Browser tests.

### Phase E — Validation

Focused gates, headed UAT, and a cumulative desktop `@task-workspaces` Playwright scenario
extended with Guided and Freeform paths plus the Standard regression.

## Acceptance criteria

Stable ids for Build/Verify matrices:

1. **TW-S3-AC01** The creation view offers Standard, Guided, and Freeform with descriptions, and
   displays the resolved definition version.
2. **TW-S3-AC02** A Guided task runs Questions → Research → Design → Plan, producing one artifact
   per stage, each with its own revision history.
3. **TW-S3-AC03** Each Guided next-stage session has a context manifest listing the exact block
   ids carried forward, a token estimate, and the budget.
4. **TW-S3-AC04** When selected blocks exceed budget, a `summary` artifact is produced and the
   manifest references it.
5. **TW-S3-AC05** A Freeform task accepts sessions and artifacts with no automatic stage
   advancement, and `task.stage.start` explicitly enters Plan and Verify.
6. **TW-S3-AC06** Bumping a built-in definition version leaves an existing task on its pinned
   version — asserted as an explicit negative proof.
7. **TW-S3-AC07** All Slice 1 and Slice 2 Standard tests pass without modification.
8. **TW-S3-AC08** No worktree exists for any preset before Build; asserted for all three.
9. **TW-S3-AC09** Slice 1 / Slice 2 persisted events replay into the widened schema with correct
   defaults (`preset: "standard"`).
10. **TW-S3-AC10** Restart retains preset, pinned versions, manifests, budgets, and summaries.

## Risks

- **Phase B is the load-bearing change.** Rewriting live transition logic under a passing
  regression suite is the main risk; the suite is the mitigation.
- **Slice size.** This is materially larger than Slice 2. Phases A–B (engine + registry, Standard
  only) form a coherent shippable unit if we want to split; Phases C–E (Guided, Freeform,
  budgeting) would then be Slice 3b. Flagged for the reviewer to decide before Build.
- **Budget semantics are a product decision.** What the default budget is, and whether overflow
  summarizes silently or prompts, needs an answer before Phase C.
