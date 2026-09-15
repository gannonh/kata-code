---
name: plan
description: Use this skill when scoping, designing, or specifying work as a Linear issue. Runs the plan-build-verify Plan workflow. Default for a new build request even when the user says "build".
---

# Plan

Turn ideas into complete Backlog specs in Linear.

## Read the conventions first

Read `references/conventions.md` completely before any write. It defines preflight, Linear MCP tools, the spec body template, hierarchy, dependencies, and state rules.

## When to use

- Scoping, designing, or specifying work.
- No Todo issue exists for the request.
- Revising a Backlog spec.

A new build request starts here even when the user says "build". For tiny, clearly bounded edits such as a copy change, do not force the full Plan workflow and do not open an issue. State the assumption and ask whether the user wants the full process.

## Plan workflow

Read `references/plan.md` completely and follow it.

Hard gates:

- Do not draft a spec issue before the user has answered an alignment question or approved a recommended direction.
- Every spec issue must include an exact `## Acceptance criteria` section with observable pass/fail checkboxes.
- Create and revise specs with Linear MCP. End at human approval into Todo. Do not write Todo yourself.
- After Plan, the only workflow you invoke is Build. Do not implement product code here.

## Requirements

- Host Linear MCP with `get_issue`, `save_issue`, `save_comment`, `list_comments`, `list_issues`, and `list_issue_statuses`.
- `gh` authenticated for the GitHub repo (read remote and existing PRs during context gathering).

Run the preflight in `references/conventions.md` before the first Linear write of a session.

## Shared principles

- Inspect the repo and the Linear backlog before making claims about project structure or existing work.
- In Plan, ask focused alignment questions one at a time before drafting the issue.
- Propose 2-3 approaches when more than one viable direction exists.
- Prefer the smallest end-to-end slice a user can see, use, or evaluate.
- Decompose epics by demonstrable behavior.
- A spec issue is incomplete unless it has an exact `## Acceptance criteria` section.
- The Linear issue is the spec.
- Surface uncertainty instead of filling gaps with guesses.
