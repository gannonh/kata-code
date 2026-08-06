---
type: Plan
title: "Task mode UX Playground exploration"
description: "Short prototype plan for comparing a refined conversation-plus-panel Task layout with a Task-first horizontal-stage workspace before approving Agent Runtime convergence."
status: Active
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

## Shared product hypothesis

Both prototypes test the same Task-first model:

- the Task is the top-level navigation unit;
- Task-owned stage sessions are internal to the Task and do not appear as peer rows under Chats;
- the canonical Task route remains stable while the user views different stages;
- the active stage and the viewed stage are distinct;
- viewing completed work is read-only and never changes workflow state;
- returning to current work is always visible; and
- revisiting a prior stage is an explicit, impact-previewed branch action that preserves history.

## Prototype A — refined current layout

Retain the current conversation-first, two-column composition:

- active or selected stage conversation in the main column;
- persistent Task panel in the right column;
- vertical stage navigation in the panel;
- clearer separation of stage outcome, repository state, progress, and actions;
- a historical-stage banner with **Return to current**; and
- past-stage outcome and conversation views inside the existing shell.

This variant determines whether the current overall layout is sound once navigation leakage and
panel hierarchy are corrected.

## Prototype B — horizontal stage workspace

Move stage navigation above the content:

- horizontal workflow rail below the Task header;
- current-stage conversation in the main canvas;
- completed stages open an outcome-first historical canvas;
- optional collapsible details inspector; and
- explicit stage occurrence/history selection when a stage has more than one outcome.

This variant tests whether stages should be the persistent primary navigation rather than content
inside the Task panel.

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

After interactive UAT:

- record the preferred layout and rejected aspects;
- update the authoritative [Task mode parent](/specs/2026-08-01-task-mode-design.md);
- write the bounded production UX child plan;
- rebase the [Agent Runtime convergence design](/specs/2026-08-06-task-mode-agent-runtime-convergence.md)
  on the accepted Task shell; and
- retain the rejected prototype only as historical design evidence.
