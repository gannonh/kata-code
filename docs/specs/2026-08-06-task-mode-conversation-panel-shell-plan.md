---
type: Plan
title: "Task mode conversation-plus-panel shell"
description: "Bounded production UX plan for the accepted Task-first conversation and persistent right-panel shell before Agent Runtime convergence."
status: Approved
approved_at: 2026-08-06T20:15:00Z
tags: [specs, task-mode, ux, shell, workflows]
timestamp: 2026-08-06T20:15:00Z
parent: /specs/2026-08-01-task-mode-design.md
related: /specs/2026-08-06-task-mode-ux-playground-plan.md
---

# Task mode conversation-plus-panel shell

## Decision and boundary

Prototype A is the accepted Task mode shell. The Task is the navigation unit, the active stage
conversation remains the primary canvas, and a persistent right panel owns Task progress, stage
navigation, outcomes, history, and human actions. Fresh stage sessions remain internal details.

This child plan implements the shell and its read-only history behavior. It does not change provider
contracts, stage completion commands, persistence versioning, Agent Runtime lifecycle, or the
Task authority model. Agent Runtime convergence remains a separate follow-up that consumes this
shell rather than redefining it.

Prototype B's horizontal rail and inspector are retained in the Playground commit as comparison
evidence but are not part of the production direction.

## Product requirements

1. **Task-first route:** Opening a Task keeps the canonical Task route and never exposes its stage
   sessions as peer Chat rows.
2. **Conversation-first canvas:** The active stage conversation occupies the primary canvas; the
   right panel remains available at desktop widths and becomes a predictable stacked or sheet
   surface at narrow widths.
3. **Stage clarity:** The panel shows the active stage, the stage being viewed, completion state,
   and whether the viewed content is read-only history.
4. **Outcome-first history:** Completed stages show their latest outcome by default. The user may
   open the associated conversation for inspection without changing workflow state.
5. **Occurrence history:** When a stage has revisions, the panel exposes occurrence selection and
   preserves superseded outcomes as append-only history.
6. **Explicit revision:** **Revise from here** explains affected downstream stages before creating a
   new occurrence. Existing outcomes remain inspectable; the new occurrence becomes the only active
   path.
7. **Return path:** **Return to current** remains visible whenever the user is inspecting history.
8. **Responsive behavior:** At narrow widths, the Task navigation and panel remain reachable
   without clipping the active conversation or hiding the current-stage identity.
9. **Error recovery:** Plan validation and other human-action failures appear beside the relevant
   action with a direct next step, rather than presenting an inert control.

## Implementation sequence

### Phase 1 — Production shell

- Keep Task-owned conversations internal to the Task route and remove stage-session navigation from
  normal Chat surfaces.
- Refine `TaskWorkspaceView` and `GuidedTaskPanel` around the Prototype A composition.
- Keep stage selection non-mutating and separate selected/viewed state from active workflow state.
- Preserve existing server commands and task/workflow versions.

### Phase 2 — Historical outcomes and occurrences

- Add a read-only outcome/conversation view for completed occurrences.
- Add occurrence selection for repeated stages and a persistent return-to-current affordance.
- Reuse existing Task artifacts, occurrences, sessions, and gate history; do not add a parallel
  branch graph for the first production shell.
- Add the explicit revision confirmation and append-only occurrence behavior already proven by the
  fixture prototype.

### Phase 3 — Verification and handoff

- Complete browser coverage for current/history state, occurrence selection, return-to-current,
  revision impact, responsive layout, and error recovery.
- Run maintainer desktop and narrow-width UAT against the nine comprehension questions in the
  Playground plan.
- Rebase the Agent Runtime implementation plan on the accepted shell and keep runtime controls
  outside the Task navigation foundation.

## Verification

- `vp check`
- `vp run typecheck`
- focused Task workspace browser tests
- `vp run e2e --project desktop-dev --grep @task-workspaces`
- manual desktop and narrow-width UAT at `/playground/task-mode` and on the production Task route

Every product requirement must have a browser or E2E assertion. Subjective visual quality remains
maintainer UAT evidence.

## Non-goals

- Agent Runtime fleet controls or provider lifecycle changes.
- A full parallel branch graph.
- Provider-specific Plan or stage contracts.
- Replacing the existing Task route with a horizontal stage workspace.
