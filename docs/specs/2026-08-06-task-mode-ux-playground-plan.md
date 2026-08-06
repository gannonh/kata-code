---
type: Plan
title: "Task mode UX Playground exploration"
description: "Fixture-driven prototype record for selecting the production Task conversation-plus-panel shell before Agent Runtime convergence."
status: Completed
tags: [specs, task-mode, ux, playground, prototype, workflows]
timestamp: 2026-08-06T00:00:00Z
parent: /specs/2026-08-01-task-mode-design.md
related: /specs/2026-08-06-task-mode-agent-runtime-convergence.md
---

# Task mode UX Playground exploration

## Purpose

Pause approval of the next Task mode implementation slice long enough to validate the product
navigation model. Fresh sessions per stage remain useful execution boundaries, but exposing those
sessions as peer conversations makes the Task feel fragmented and causes users to leave the Task
workspace.

Build fixture-driven prototypes under `/playground/task-mode`. No production Task contracts,
commands, persistence, routing, or provider behavior change during this exploration.

## Current status

Both prototype layouts and the shared scenario catalog were implemented. Maintainer UAT selected
**Prototype A — refined current layout** as the production direction. The bounded production shell
plan is [Task mode conversation-plus-panel shell](/specs/2026-08-06-task-mode-conversation-panel-shell-plan.md).

```bash
pnpm run dev
open http://localhost:5733/playground/task-mode

cd apps/web
vp test run --project browser src/components/playground/taskMode/TaskModePrototype.browser.tsx

cd ../../
vp run e2e --project desktop-dev --grep @task-mode-ux
```

## Decision — Prototype A accepted

Prototype A is the accepted Task mode shell:

- the active stage conversation remains the primary canvas;
- a persistent right Task panel owns stage navigation, progress, outcomes, history, and actions;
- completed stages are read-only by default and expose outcome-first history;
- occurrence revision and **Revise from here** remain explicit and preserve append-only history; and
- the horizontal-stage rail and collapsible inspector are not part of the production direction.

The Playground remains available as fixture evidence while the bounded production shell plan is
implemented. This decision does not change provider contracts or Agent Runtime lifecycle.

## Shared product hypothesis

Both prototypes test the same Task-first model:

- the Task is the top-level navigation unit;
- Task-owned stage sessions are internal to the Task and do not appear as peer rows under Chats;
- the canonical Task route remains stable while the user views different stages;
- the active stage and the viewed stage are distinct;
- viewing completed work is read-only and never changes workflow state;
- returning to current work is always visible; and
- revisiting a prior stage is an explicit, impact-previewed branch action that preserves history.

## Prototype A — refined current layout (accepted)

Retain the current conversation-first, two-column composition:

- active or selected stage conversation in the main column;
- persistent Task panel in the right column;
- vertical stage navigation in the panel;
- clearer separation of stage outcome, repository state, progress, and actions;
- a historical-stage banner with **Return to current**; and
- past-stage outcome and conversation views inside the existing shell.

This variant is the accepted production direction. The bounded implementation work is recorded in
[Task mode conversation-plus-panel shell](/specs/2026-08-06-task-mode-conversation-panel-shell-plan.md).

## Prototype B — horizontal stage workspace (rejected as primary shell)

The comparison variant moved stage navigation above the content:

- horizontal workflow rail below the Task header;
- current-stage conversation in the main canvas;
- completed stages open an outcome-first historical canvas;
- optional collapsible details inspector; and
- explicit stage occurrence/history selection when a stage has more than one outcome.

Maintainer UAT rejected this as the primary production shell. It remains historical comparison
evidence only; stages stay inside the persistent Task panel.

## Branch interaction

The prototype uses **Revise from here** rather than silently reopening completed work. It previews:

- the selected stage occurrence used as the branch point;
- active work that must settle or stop;
- downstream outcomes that remain available as historical; and
- the new occurrence that becomes the single active workflow path.

The Playground simulates this interaction only. Whether production needs linear supersession or a
stronger workflow-path identity is decided after UAT.

## Fixture scenarios

One fixture catalog drives both layouts:

1. Design running with completed Clarify and Research.
2. Research selected while Design continues in the background.
3. Plan awaiting approval.
4. Implement paused at a checkpoint.
5. A prior-stage branch preview and resulting alternate occurrence.
6. A failed stage with a retry affordance.

The Playground includes full app chrome, Task and non-Task sidebar rows, layout switching, scenario
switching, stage selection, outcome/conversation switching, return-to-current, branch preview, and
inspector controls.

## Evaluation questions

A prototype is viable when a maintainer can answer without explanation:

1. Which Task is open?
2. Which stage is active?
3. Which stage and occurrence is being viewed?
4. Is current work still running while history is inspected?
5. How does the user return to current work?
6. What changes, and what remains preserved, when branching from an earlier stage?
7. Can Task progress and human actions be found without reading implementation vocabulary?

## Exit

The UAT decision is recorded above. The authoritative [Task mode parent](/specs/2026-08-01-task-mode-design.md)
links the accepted shell plan, and the [Agent Runtime convergence design](/specs/2026-08-06-task-mode-agent-runtime-convergence.md)
may now be reviewed against that shell. The rejected horizontal variant remains historical design
evidence and is not a production navigation recommendation.
