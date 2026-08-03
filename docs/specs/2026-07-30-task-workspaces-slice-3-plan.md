---
type: Spec
title: "Task workspaces Slice 3 — Workflow presets and guided context boundaries"
description: "Child implementation plan for the third autonomous vertical slice: replace the hardcoded Standard rail with a data-driven, versioned workflow registry; ship Standard, Guided, and Freeform presets; and make context manifests budget-aware and inspectable."
status: Verified
roadmap_status: Historical
approved_at: 2026-07-30T00:00:00Z
tags: [specs, task-workspaces, workflows, presets, context, versioning, orchestration, web, server]
timestamp: 2026-07-30T00:00:00Z
parent: /specs/2026-07-28-task-workspaces-vertical-slices-design.md
base_sha: 6aceff8a85b8a6dfd673ceb9947b7518d8aa9579
---

# Task workspaces Slice 3 — Workflow presets and guided context boundaries

## Status

**Historical delivery record; Verified.** Slice 3a and 3b merged through PR #62 at
`cf95a03c9c658d3677fc85d46d486a4ecfda57ae`. The authoritative current roadmap is
[Task mode — product-first workflows](/specs/2026-08-01-task-mode-design.md).

The implementation was delivered in two parts:

- **Slice 3a (Phases A–B):** versioned workflow definition registry and a table-driven reducer.
- **Slice 3b (Phases C–E):** Guided and Freeform presets, new stages/kinds, context budgeting,
  and the pre-reset web surfaces.

Resolved review decisions:

1. **Split:** yes — Phase B rewrites live transition logic, so it lands behind a green Standard
   suite before new presets stack on it.
2. **Definition storage:** registry-only. Tasks pin `definitionVersion`; no inline snapshot is
   stored in the aggregate. A pinned version this build no longer ships fails loudly with the
   version named.
3. **Budget semantics:** decided, to be built in 3b. Overflow **summarizes and flags**: the stage
   generates a `summary` artifact, the manifest references it in place of the raw blocks, and the
   inspector surfaces a prominent "N blocks compressed" marker so the lossy step is never
   invisible. The budget is a **fixed token count** (default 32,000), not a fraction of a model's
   context window — this matches the decision to estimate tokens locally and keeps budget tests
   independent of provider or model metadata.

This child spec plans only Slice 3 and does not approve any later slice.

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
   version string but there is no way to resolve _that version's_ definition later — so the
   parent spec's negative proof ("editing the latest definition does not mutate an existing
   task") is currently unprovable in either direction.
4. **The stage union is Standard-shaped.** `TaskWorkspaceStage` is
   `questions | plan | build | verify | verified`. Guided needs `research` and `design`.
5. **Artifact kinds are Standard-shaped.** `questions | plan | verification`. Guided needs
   `research` and `design` artifacts, and context budgeting needs a `summary` kind.
6. **Artifact-kind gating is a hardcoded ladder.** `task.artifact.upsert` maps stage→kind with a
   nested ternary (service lines 744–758). This becomes a definition lookup.
7. **Manifests are deliberately minimal.** `TaskWorkspaceContextManifest` carries only
   `artifactRefs` and `notes` (contracts 166–176) — no token estimate, no budget, no summary
   linkage.
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
reducer decision resolves _that_ key.

This is what makes the parent spec's negative proof real: bumping `guided@0.1.0` → `guided@0.2.0`
leaves `guided@0.1.0` in the registry, and the existing task keeps resolving the old record.
Superseded versions are never deleted.

**Decided (registry-only).** A task does not store an inline snapshot of its resolved definition.
This keeps the aggregate small; the accepted cost is that a definition dropped from a future
build strands tasks pinned to it, which `resolveWorkflowDefinition` surfaces as a loud error
naming the missing version rather than a silent fallback. Revisit if we ship user-authored
definitions.

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
provenance rather than a recomputed guess. This closes
[#55](https://github.com/gannonh/kata-code/issues/55).

The budget is a fixed token count, defaulting to 32,000. A fraction-of-context-window budget was
rejected: manifests carry no target model, and a model-dependent budget would make the budget
tests depend on provider metadata.

When selected blocks exceed the budget the stage produces a `summary` artifact, the manifest
references it in place of the raw blocks, and the manifest records that it was compressed along
with how many blocks it replaced. The inspector surfaces that prominently — summarization is
automatic so Guided stays hands-off, but never silent, because a person reviewing a downstream
artifact needs to know the upstream context was compressed.

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

Phases A–B are Slice 3a and ship on this branch. Phases C–E are Slice 3b.

### Phase A — Workflow definition registry (Slice 3a)

Registry module with the `standard@0.1.0` built-in whose table reproduces Slice 1 / Slice 2
behavior; version resolution, duplicate-version rejection, and a loud error naming an
unresolvable pinned version. Unit tests including the version-pinning negative proof.

Widened stage/kind/preset schemas, `task.stage.start`, and manifest budget fields move to
Slice 3b, where the presets that need them land.

### Phase B — Server reducer becomes table-driven (Slice 3a)

Replace hardcoded transitions and the artifact-kind ladder with definition lookups. Standard
regression suite must pass untouched. Service test for pinning at creation, definition-driven
artifact-kind gating and transition legality, and no-worktree-before-Build.

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
4. **TW-S3-AC04** When selected blocks exceed the budget, a `summary` artifact is produced, the
   manifest references it in place of the raw blocks, and the inspector shows how many blocks
   were compressed.
5. **TW-S3-AC05** A Freeform task accepts sessions and artifacts with no automatic stage
   advancement, and `task.stage.start` explicitly enters Plan and Verify.
6. **TW-S3-AC06** Bumping a built-in definition version leaves an existing task on its pinned
   version — asserted as an explicit negative proof.
7. **TW-S3-AC07** All Slice 1 and Slice 2 Standard tests pass without modification.
8. **TW-S3-AC08** No worktree exists for any preset before Build; asserted for all three.
9. **TW-S3-AC09** Slice 1 / Slice 2 persisted events replay into the widened schema with correct
   defaults (`preset: "standard"`).
10. **TW-S3-AC10** Restart retains preset, pinned versions, manifests, budgets, and summaries.

## Slice 3a build record

Phases A–B implemented on `claude/task-workspaces-slice-3` from base `6aceff8a`.

- `apps/server/src/taskWorkspace/workflowDefinitions.ts` — registry, `standard@0.1.0`,
  `resolveWorkflowDefinition`, `transitionFor`, `artifactKindForStage`.
- `apps/server/src/taskWorkspace/TaskWorkspaceService.ts` — `definitionFor` / `applyTransition`;
  all four transitions (`task.questions.complete`, `task.plan.approve`, `task.fixture.apply`,
  `task.verification.signoff`) and the artifact-kind ladder now read the pinned definition;
  `STANDARD_WORKFLOW_VERSION` / `PROMPT_VERSION` constants removed in favor of the definition.

Gates: server `taskWorkspace` suite **12 passed** (5 pre-existing Standard tests unmodified —
TW-S3-AC07 — plus 6 registry and 1 service test); contracts **192 passed**; `@kata-sh/code-cli`
typecheck, lint, and format clean.

Satisfied here: **TW-S3-AC06** (version-pinning negative proof), **TW-S3-AC07** (Slice 1 / Slice 2
regression), **TW-S3-AC08** (no worktree before Build, Standard). The remaining acceptance
criteria belong to Slice 3b.

Note: `apps/server`'s full suite has 7 pre-existing failures unrelated to this work (Docker-guarded
sandbox integration tests, plus two tests that assume a non-root user); they reproduce identically
on the unmodified tree.

## Slice 3b build record

Phases C–E implemented on `claude/task-workspaces-slice-3b`, stacked on Slice 3a.

- `packages/contracts/src/taskWorkspace.ts` — widened `TaskWorkspaceStage`,
  `TaskWorkspaceArtifactKind`, and `preset`; `task.stage.start`,
  `task.research.complete`, `task.design.complete`; manifest `tokenEstimate` / `budget` /
  `summaryArtifactRef` / `compressedBlockCount`; and `TASK_WORKSPACE_PRESET_CATALOG`, the
  display projection clients render rails from.
- `apps/server/src/taskWorkspace/workflowDefinitions.ts` — `guided@0.1.0`, `freeform@0.1.0`,
  `explicitEntryStages`, `contextTokenBudget`, `DEFAULT_CONTEXT_TOKEN_BUDGET = 32_000`.
- `apps/server/src/taskWorkspace/TaskWorkspaceService.ts` — preset-driven creation, one
  table-driven handler for all reasoning-stage completions, `task.stage.start`, and
  budget-aware manifest creation with `summary` generation on overflow.
- `apps/web/src/components/taskWorkspace/` — workflow picker, preset-aware rail, Freeform
  timeline, and `ContextManifestPanel` (new).
- `e2e/tests/task-workspaces/slice-3.spec.ts` — Guided, Freeform, and budget-compression
  scenarios (**written but not executed**; see below).

### Decisions taken during Slice 3b

1. **The preset catalog lives in contracts, keyed by definition version.** The web cannot
   import the server registry, and hardcoding a second copy of each rail would drift. The
   catalog is display-only — labels, ordered stages, explicit entries — and
   `workflowDefinitions.test.ts` asserts every built-in definition matches its entry, so
   drift fails a test rather than shipping. Keying by version rather than preset mirrors
   the registry's append-only rule on the display side.
2. **`questions` is an explicit entry for Freeform.** Artifact writes are gated on the
   current stage, so without it a Freeform task could never amend its questions artifact
   after moving on — a one-way door in the preset whose whole point is not having a rail.
   Build and Verified remain non-entrable: they are reached by approving and signing off,
   which is what keeps Freeform on the same delivery path.
3. **`tokenEstimate` records the _selection_, not the post-compression payload.** It is
   the number the budget decision was made against, so `tokenEstimate > budget` reads
   directly as "this is why it was compressed". Recording the summary's size instead would
   make every compressed manifest look comfortably in budget and hide the overflow.
4. **`artifactRefs` are retained on a compressed manifest.** The summary is what the
   session actually starts from, but the manifest still records which blocks it stands in
   for, so the inspector shows provenance instead of an unexplained gap.

### Gates

| Check                                                                         | Result                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `@kata-sh/code-contracts` / `code-cli` / `code-web` / `apps/server` typecheck | clean                                             |
| `packages/contracts` suite                                                    | 197 passed (15 files)                             |
| `apps/server` `taskWorkspace` suites                                          | 21 passed (2 files)                               |
| `apps/web` `taskWorkspace` suites                                             | 16 passed (3 files)                               |
| `pnpm lint`                                                                   | no new warnings                                   |
| `pnpm fmt:check`                                                              | clean                                             |
| `e2e/tests/task-workspaces/slice-3.spec.ts`                                   | **not executed** — needs a headed desktop harness |

**TW-S3-AC07 evidence:** the Slice 1 / Slice 2 test files are pure additions —
`git diff ddc5725 -- <test files>` reports zero deleted lines across
`TaskWorkspaceService.test.ts`, `taskWorkspace.test.ts`, and
`TaskWorkspaceView.browser.tsx`. No existing Standard assertion was edited.

Satisfied here: **AC01**–**AC05**, **AC09**, **AC10**, and **AC08** extended to Guided and
Freeform. **AC06** and **AC07** carried from Slice 3a and re-verified.

## Risks

- **Phase B is the load-bearing change.** Rewriting live transition logic under a passing
  regression suite is the main risk; the suite is the mitigation.
- **Slice size — resolved by the 3a / 3b split.** Phases A–B ship as Slice 3a; Guided, Freeform,
  and budgeting follow as Slice 3b.
- **Budget semantics — resolved.** Fixed 32,000-token budget; overflow summarizes automatically
  and flags the compression in the inspector. The residual risk is that 32,000 is a guess until
  we see real Guided manifests; treat it as a tunable default, not a contract.
