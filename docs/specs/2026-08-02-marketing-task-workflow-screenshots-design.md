---
type: Spec
title: "Marketing task workflow screenshots"
description: "Generate repeatable desktop E2E screenshots that present Kata Code's task-driven workflow as publishable marketing frames."
status: Approved
approved_at: 2026-08-03T02:03:44Z
tags: [marketing, screenshots, task-workspaces, e2e, playwright]
timestamp: 2026-08-02T00:00:00Z
---

# Marketing task workflow screenshots

## Status

Approved

## Goal

Create a repeatable E2E capture flow for a numbered set of desktop screenshots that communicates
Kata Code's task-driven workflow from task creation through planning and implementation controls.
The output is a set of individual PNG frames. The marketing homepage remains unchanged.

## Current state

- The desktop E2E foundation lives under `e2e/` and uses a real Electron app, isolated homes, and
  real persisted task-workspace events.
- Task creation and the conversation-first Guided surface are implemented in
  `apps/web/src/components/taskWorkspace/TaskWorkspaceNewView.tsx` and
  `apps/web/src/components/taskWorkspace/GuidedTaskPanel.tsx`.
- Hierarchical Build, check, checkpoint, and amendment projections are rendered by
  `TaskWorkspaceView.tsx`.
- Existing Guided provider E2E requires credentials and can vary with provider output. The new
  capture flow uses seeded task snapshots so the screenshots remain reproducible while still
  rendering the product through the normal app route.
- Existing publishable marketing assets live under `apps/marketing/public/`.

## Scope

### Included

- A `@marketing` Playwright tag and screenshot spec under `e2e/tests/marketing/`.
- Deterministic task-workspace seed data for the captured workflow states.
- Fixed desktop capture settings and stable, numbered PNG names.
- Configurable output directory with an ignored default and a publishable marketing override.
- Regeneration documentation and targeted E2E/static verification.

### Excluded

- Changes to the marketing homepage or Astro layout.
- Provider API calls, service mocks, DOM overlays, or fabricated screenshot content.
- Browser/web target coverage for the publishable desktop frames.
- A combined storyboard image. The numbered frames preserve left-to-right ordering for later use.

## Capture frames

The capture sequence is:

1. `01-guided-create.png`: the Guided workflow picker with an inline brief, task identity, and
   resolved capability asserted in the form state.
2. `02-guided-plan-review.png`: the conversation-first Guided task panel with the Clarify,
   Research, Design, and Plan rail plus an open Plan review gate. This frame captures the panel
   locator so an unavailable seeded conversation cannot leave a blank left pane in the asset.
3. `03-guided-plan-approved.png`: an approved Plan rendered read-only with the task's approval
   state and deferred next action. This frame uses the `task-workspace@0.3.0` first-slice state.
4. `04-build-checkpoint.png`: the legacy-compatible `task-workspace@0.2.0` hierarchical Build
   panel with multiple phases, work items, checks, and a waiting checkpoint.
5. `05-build-amendment.png`: the same Build projection after a failed check, with a blocked work
   item and a reviewable Plan amendment gate containing expected/found details and a revision diff.

## Implementation design

The spec will use the existing project-aware Playwright fixture and the desktop development target.
A file-session seed writes valid task-workspace events into the isolated app home before Electron
launch. The seed matrix uses `task-workspace@0.3.0` for the Guided Plan frames and
`task-workspace@0.2.0` for the hierarchical Build frames because the current renderer selects the
conversation-first view for `@0.3.0` and the Build panel for the legacy-compatible view. Each seed
asserts its contract version, stage, occurrence status, artifact revision, gate/checkpoint state,
and amendment state before capture.

The test creates a real fixed-name demo repository at a safe display path and registers cleanup for
it. It then opens that project through the existing workspace flow, fills the real task creation
form, navigates through the seeded task routes, and calls `page.screenshot` or a locator screenshot
after user-visible state assertions pass. The configured provider/model must be present in the
local provider registry so the creation form can render its selected agent and model; the test
calls the existing provider prerequisite helper but never starts a provider turn.

The screenshot destination is resolved from `KATACODE_E2E_MARKETING_OUTPUT`, relative to the
repository root when the value is relative. When unset, files go to
`e2e/test-results/marketing-screenshots/`. When set to
`apps/marketing/public/task-workflow`, the same test writes publishable frames. The helper creates
the destination directory, removes stale files matching the five managed names, and replaces the
same names on each run. Unmanaged files remain untouched.

Transient provider toasts and loading indicators are dismissed or awaited through existing E2E
flows. The capture uses a fixed 1600×1200 desktop viewport, disables animations for the capture,
and captures the app content or the asserted task panel locator only. Assertions remain in the test
so a missing or stale task state fails before a screenshot is written. The Plan-review frame
explicitly asserts the rail, open gate, artifact revision, and approval controls; it does not claim
to include a conversation transcript.

## Acceptance criteria

1. `vp run e2e --list --grep @marketing` lists the marketing screenshot spec and its feature tag.
2. `KATACODE_E2E_MARKETING_OUTPUT=<directory> vp run e2e --grep @marketing` exits successfully on
   the desktop development target when the documented local provider registry prerequisite is
   available; a missing provider/model fails with its named prerequisite.
3. A successful run writes exactly these five managed PNGs into the configured directory:
   `01-guided-create.png`, `02-guided-plan-review.png`, `03-guided-plan-approved.png`,
   `04-build-checkpoint.png`, and `05-build-amendment.png`.
4. The test asserts these visible invariants before capture: Guided is selected and the brief/task
   identity are populated; the Plan rail is visible with an open gate and enabled approval action;
   the approved Plan state contains `Plan approved` and no Implement controls; the Build checkpoint
   has a waiting checkpoint and completed checks; and the amendment frame contains a failed check,
   blocked work item, expected/found values, and a Plan revision diff.
5. The capture uses a 1600×1200 viewport or an asserted task-panel locator, and each PNG contains
   no browser chrome, diagnostics, credentials, provider transcript, or run-specific paths such as
   `katacode-e2e-home`, `katacode-e2e-workspace`, or `/var/folders`. The test also scans rendered
   text for those forbidden patterns before writing assets.
6. Re-running the same command leaves exactly the same five managed filenames, removes stale
   managed PNGs, and does not create timestamped or duplicate publishable filenames. Unmanaged
   files in the destination are preserved.
7. The default output remains under ignored E2E artifacts, while the explicit marketing output
   path is suitable for tracked assets and is documented in the E2E catalog or screenshot spec.
8. `vp check` and `vp run typecheck` pass after the implementation.

## Verification

Run the smallest screenshot command with an ignored destination first:

```bash
vp run e2e --grep @marketing
```

Generate publishable frames with:

```bash
KATACODE_E2E_MARKETING_OUTPUT=apps/marketing/public/task-workflow vp run e2e --grep @marketing
```

Confirm the test inventory and exact output inventory:

```bash
vp run e2e --list --grep @marketing
for frame in \
  01-guided-create.png \
  02-guided-plan-review.png \
  03-guided-plan-approved.png \
  04-build-checkpoint.png \
  05-build-amendment.png; do
  test -f "apps/marketing/public/task-workflow/$frame"
done
```

Run repository gates:

```bash
vp check
vp run typecheck
```

## Risks and mitigations

- Seeded aggregate states can drift from the task contract. Build the seed through the shared
  contract types and assert that each route renders before capture.
- The existing task UI can expose asynchronous loading. Wait on state-specific test ids and hide
  transient overlays through existing navigation helpers.
- Marketing assets can accidentally include local paths. Use display-safe seeded labels and review
  the generated images before committing them.
- A changed layout can make a frame technically pass while losing its intended story. Keep the
  state assertions and stable filenames tied to the visual sequence.

## Build handoff

Implement the approved screenshot spec without changing the marketing page. Keep one writer for the
new E2E spec and any capture helper. Use seeded real task-workspace events, existing E2E flows, and
Playwright screenshots. Verify the ignored-output run before generating tracked marketing frames,
then run `vp check` and `vp run typecheck`. If a task state cannot be rendered from the current
contract version or projection, stop with the failing state, the attempted seed, and the missing
contract or projection rather than substituting fabricated UI.
