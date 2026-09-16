---
name: build
description: Use this skill when executing a named Linear spec issue that is in Todo or In Progress. Runs the plan-build-verify Build workflow with bundled TDD, pre-merge acceptance, a draft pull request, and an Agent Review handoff.
---

# Build

Execute an approved Linear spec issue through small implementation tasks, review gates, pre-merge acceptance, and a draft pull request.

## Read the conventions first

Read `references/conventions.md` completely before any write.

## When to use

- The user named a Todo issue, or Plan just handed off a Todo issue, and the user gave an explicit start.
- Resume is allowed when the issue is already In Progress on its `gitBranchName` branch.

Build must not start from Backlog. Todo means approved and queued. An explicit start moves Todo to In Progress.

## Build workflow

Read `references/build.md` completely and follow it.

Required bundled TDD:

1. Read `references/tdd/workflow.md` completely.
2. Follow linked files under `references/tdd/` as needed.
3. Do not substitute ad hoc TDD guidance when the bundled workflow applies.

Pre-merge acceptance:

1. Look for a project-local `verify-*` skill first and follow it when present.
2. Read `references/user-acceptance/workflow.md` completely and follow it for the evidence contract.
3. Use scripts under `scripts/user-acceptance/`.
4. For this repository, run `.opencode/skills/verify-plan-build-verify/` against isolated installed candidates before opening the implementing PR.

Hard gates:

- Confirm the issue is Todo (start) or In Progress (resume), or confirm an explicit user override.
- Confirm `## Acceptance criteria` with concrete checkbox criteria.
- Open a draft PR while the issue is In Progress. Name exactly one Linear issue ID in the PR title or body.
- Record the AC evidence matrix in the PR body and a Linear comment.
- Mark the PR ready and confirm Agent Review. Stop. Do not continue into Review or Verify.

## Shared principles

- Keep scope tied to the selected issue and its acceptance criteria.
- Prefer the smallest end-to-end slice a user can see, use, or evaluate.
- Do not silently implement a different spec.
- Record approved deviations as Linear comments starting with `## Approved deviation`.
- Do not close the spec issue from Build.
- Stop immediately in Human Review, Canceled, or Duplicate.
