---
name: verify
description: Use this skill when proving merged work meets a Linear spec issue's acceptance criteria. Runs the plan-build-verify Verify workflow against merged state and records per-criterion results. Starts after Done.
---

# Verify

Validate merged implementation against the spec issue's acceptance criteria and publish the evidence on the Linear issue.

## Read the conventions first

Read `references/conventions.md` completely before any write.

## When to use

- The issue is Done, or merge just completed and entered this workflow.
- The user asks for post-merge UAT, acceptance proof, or AC results against merged code.

## Verify workflow

Read `references/verify.md` completely and follow it.

Merged-state evidence:

1. Confirm the relevant PR actually merged.
2. Look for a project-local `verify-*` skill first and follow it when present.
3. Reuse Build's user-acceptance contract against merged code. Read `../build/references/user-acceptance/workflow.md` and run scripts under `../build/scripts/user-acceptance/`.
4. Do not generate a verification skill during Verify.

Hard gates:

- Verify starts after Done. It does not open PRs or land CI.
- Verify must not claim a criterion passed without evidence in the matrix.
- Never edit the wording of an acceptance criterion to make it pass.
- The original issue remains Done. Failed criteria become linked Backlog follow-up issues.
- Automatically closed parents require aggregate AC confirmation. Auto-close is not evidence that code merged or AC landed.

## Shared principles

- Keep Verify tied to the approved acceptance criteria.
- Test the merged default-branch state.
- Never merge a pull request from Verify.
