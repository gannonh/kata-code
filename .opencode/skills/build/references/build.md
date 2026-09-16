# Build Workflow

Use this workflow to execute an approved Linear spec issue through small implementation tasks, review gates, pre-merge acceptance, and a draft pull request.

Build starts from Todo after an explicit start. Read `references/conventions.md` before starting.

## Required inputs

- Spec issue identifier. For an epic, the specific child to build.
- Todo (explicit start) or In Progress (resume), or explicit user override.
- `## Acceptance criteria` section with observable pass/fail outcomes.
- `## Build handoff` section with scope, non-goals, ordered slices, verification commands, and blocking open questions.
- A `## Demonstration` section naming the consumer, action/input, observable result, and evidence. An approved technical-enablement exception instead names its blocker, minimum scope, contract/integration evidence, and immediate user-facing slice unlocked.
- A `## Verification` section naming the required public-boundary E2E seam/command, or the contract test for approved technical enablement, plus screenshot checkpoints for visual targets.

## Required bundled workflow

Implementation tasks must use the bundled TDD workflow before writing production code.

1. Read `references/tdd/workflow.md` completely.
2. Follow linked references under `references/tdd/` as needed.
3. Do not substitute ad hoc TDD guidance when the bundled workflow applies.

## Build workflow

### 1. Run Build preflight

Before editing files:

1. Run the preflight from `references/conventions.md`.
2. Read the issue completely:

```
get_issue({
  "id": "<id>",
  "includeRelations": true
})
```

3. **Check `blockedBy` before writing any code.** If a blocker is still open, comment with the exact ask and stop. Do not start a blocked issue unless the user explicitly acknowledges the blocker and chooses to proceed. A Done blocker no longer blocks Build; preserve the dependency for traceability. Use `removeBlockedBy` only for a relation confirmed to be incorrect. A Canceled or Duplicate blocker requires checking whether its prerequisite was delivered or replaced.
4. Confirm the issue is Todo or In Progress, or confirm the user explicitly overrode the approval gate. Backlog is unapproved. Human Review, Canceled, and Duplicate are stop conditions.
5. **If the issue has children**, do not build the parent. Pick the first Todo child with no open blockers:

```
list_issues({
  "team": "<team>",
  "project": "<project>",
  "parentId": "<id>"
})
```

If several are ready, ask which to build or confirm the order. State the choice before proceeding.

6. Confirm the issue contains `## Acceptance criteria` with concrete checkbox criteria. If missing or ambiguous, stop and return to Plan.
7. Confirm `## Demonstration` describes behavior that can be exercised after this issue alone.
8. Run the phase-entry hygiene check from `references/conventions.md` and report findings.
9. Inspect repo instructions such as `AGENTS.md`, `CLAUDE.md`, and README command sections.
10. Check worktree state with `git status --short --branch`.
11. Confirm `Blocking open questions` is `None`, or confirm the user explicitly approved proceeding with listed questions.
12. Create or check out the working branch using `gitBranchName` from `get_issue`. Resume that branch when it already exists.

```bash
git switch -c "<gitBranchName>"
```

Use `git switch "<gitBranchName>"` when the branch already exists. Do not start implementation on `main` or `master` without explicit user consent.

13. Capture a base SHA with `git rev-parse HEAD`.
14. Identify verification commands from the issue's `## Build handoff` and `## Verification` sections plus repo scripts.
15. Confirm required tools are available: todo tracking and subagent dispatch if using the subagent path.
16. On an explicit start from Todo, move the issue to In Progress using the state-write protocol in `references/conventions.md`:

```
get_issue({ "id": "<id>", "includeRelations": true })
save_issue({ "id": "<id>", "state": "In Progress" })
save_comment({
  "issueId": "<id>",
  "body": "Build started on branch `<branch>` at base SHA `<sha>`."
})
```

Skip the state write when the issue is already In Progress.

Stop and ask if the issue is unapproved, the worktree has unrelated changes, the branch is unsafe, required tools are missing, or the issue has blocking questions.

### 2. Extract tasks and create todos

Extract implementation tasks from the issue's `## Delivery slices` and `## Build handoff` sections. Preserve the full task text, context, files, acceptance criteria, demonstration path, required public-boundary E2E/contract test, screenshot checkpoints, and verification commands.

Implementation tasks inside a slice may follow technical layers, but the selected issue must finish end to end.

Create todo items for all tasks when a todo tool is available. Keep exactly one implementation task in progress at a time.

### 3. Choose execution mode

Prefer the subagent path when subagent dispatch is available and the current agent is acting as orchestrator.

Use the single-agent path only when subagents are unavailable or the user explicitly asks you to work without them. Preserve the same gates: bundled TDD workflow, self-review, spec compliance check, code quality check, tests, and completion report.

## Subagent path

### 4. Dispatch the implementer

For each task, dispatch a fresh implementer subagent using `references/implementer-prompt.md`.

Give the subagent:

- Issue identifier and URL.
- The relevant issue body sections, pasted into the prompt.
- Task ID and full task text.
- Acceptance criteria for the task.
- Slice target: consumer, action/input, observable result, and demonstration/evidence.
- Relevant code paths and repo context.
- Approved scope and non-goals.
- Base SHA for the task.
- Required verification commands.
- Instruction to read and follow `references/tdd/workflow.md` before writing implementation code.

Do not make the implementer read the issue to discover its own task. Provide the needed context directly. Implementers should not run Linear writes; issue state is the orchestrator's responsibility.

### 5. Handle implementer status

Implementers report one of four statuses:

- `DONE`: proceed to spec compliance review.
- `DONE_WITH_CONCERNS`: read concerns before review. Resolve correctness or scope concerns first.
- `NEEDS_CONTEXT`: provide missing context and re-dispatch.
- `BLOCKED`: assess whether to provide context, use a stronger model, split the task, or ask the user because the spec is wrong.

Never ignore an escalation or force the same retry without changing context, model, or task shape.

If the work is genuinely blocked, record it on the issue:

```
save_comment({
  "issueId": "<id>",
  "body": "## Blocked\n<reason>"
})
```

Leave the workflow state in In Progress unless the user asks to return the issue to Backlog.

### 6. Run spec compliance review

After implementation, dispatch a spec compliance reviewer using `references/spec-reviewer-prompt.md`.

The reviewer must inspect actual code and compare it to:

- The issue body (give the reviewer the identifier so it can run `get_issue`).
- Task text.
- Acceptance criteria.
- Slice target.
- Non-goals.
- Approved deviations recorded in Linear comments.

If the reviewer finds issues, send the task back to the implementer. Re-run spec compliance review after fixes. Do not proceed to code quality review until spec compliance passes.

### 7. Run code quality review

After spec compliance passes, dispatch a code quality reviewer using `references/code-quality-reviewer-prompt.md`. Prefer a compatible installed code-review skill when available; otherwise use the compact rubric in `references/code-reviewer.md`.

If the reviewer finds Critical or Important issues, send them back to the implementer and re-run code quality review after fixes.

### 8. Complete the task

A task is complete only when:

- Bundled TDD workflow from `references/tdd/workflow.md` was followed.
- Required tests and verification commands pass.
- Spec compliance review passes.
- Code quality review passes.
- Concerns and approved deviations are recorded as Linear comments.

Commit after each coherent task when project instructions require commits or the user requested commits. Stage only files changed for that task. Reference the Linear issue identifier in the commit body.

Mark the todo item complete only after the task meets all completion criteria.

Repeat steps 4-8 for each task.

## Single-agent path

Use this path only when subagents are unavailable or disallowed.

For each task:

1. Read the task text and acceptance criteria.
2. Read and follow `references/tdd/workflow.md` before writing implementation code.
3. Implement the smallest end-to-end slice that satisfies the task and reaches the stated public interface.
4. Run required verification commands and the documented demonstration or enablement evidence.
5. Perform a written spec compliance check against the task and non-goals.
6. Perform a written code quality check using a compatible installed code-review skill or the compact rubric in `references/code-reviewer.md`.
7. Fix issues and re-run checks until clean.
8. Record evidence and deviations.
9. Commit if project instructions or the user require commits.
10. Mark the todo complete.

Disclose in the Linear comment that independent subagent review was unavailable.

## Deviation policy

If repo facts invalidate the spec, pause before changing scope.

When this happens:

1. State the conflict clearly.
2. Propose the smallest adjustment.
3. Ask the user to approve the deviation.
4. Record the approved deviation as a Linear comment starting with `## Approved deviation`.
5. Edit the issue description when the decision changes scope, acceptance criteria, task order, or verification. Acceptance criteria changes require the user's explicit approval.

Do not silently implement a different spec.

## Pre-merge acceptance

After all tasks pass their per-task gates, prove the work on the branch before the PR is ready.

1. Capture final head SHA.
2. Run the full verification command set from the issue, including the checked-in public-boundary E2E test for a user-facing slice or contract test for approved technical enablement.
3. **Look for a project-local `verify-*` skill first** (slash form `/verify-<app>`). If found, read that `SKILL.md` completely and use its Launch, Doctor, Drive, Evidence, and Cleanup sections.
4. Read `references/user-acceptance/workflow.md` completely and follow it. Use scripts under `scripts/user-acceptance/`. Map verify-* artifacts into that layout when practical.
5. If none found, drive the app with the bundled user-acceptance playbooks only. Do not generate a verification skill during Build.
6. Exercise the issue's `## Demonstration` through the public interface.
7. Dispatch or perform a final whole-branch review against the issue body.
8. For this repository, run `.opencode/skills/verify-plan-build-verify/` (launch, doctor, four drives, cleanup) against isolated installed candidates **before** opening the implementing PR. Keep evidence under `uat-evidence/`.

## Open a draft pull request

Push the branch, then open a **draft** PR while the issue is In Progress.

```bash
git push -u origin <branch>
```

```bash
PR_BODY="$(mktemp "${TMPDIR:-/tmp}/pbv-pr.XXXXXX.md")"
# write the PR body to "$PR_BODY"
gh pr create --draft \
  --base <default-branch> \
  --head <branch> \
  --title "<Linear issue id>: <issue title>" \
  --body-file "$PR_BODY"
rm -f "$PR_BODY"
```

The PR title or body must name exactly one distinct Linear issue identifier. The body must contain the acceptance-criteria matrix, scope, tasks completed, approved deviations, verification commands run, and a pointer to the Linear issue.

Retain scratch or follow-up issue IDs in a linked evidence artifact when needed so this PR names only its own issue.

Draft PR open may move the issue to In Progress via integration. Re-read the issue and skip a duplicate In Progress write.

If draft PR creation fails, comment on Linear with the exact ask and stop.

## Record the matrix and mark ready

Post the matrix as a Linear comment starting with `## Build: acceptance criteria matrix`. Include criterion, method, result, evidence path, and totals.

Then mark the PR ready:

```bash
gh pr ready
```

Re-read the issue. If it is already Agent Review, confirm and stop. If it is still In Progress, write Agent Review using the state-write protocol. If it is Human Review, Canceled, or Duplicate, stop.

```
get_issue({ "id": "<id>", "includeRelations": true })
save_issue({ "id": "<id>", "state": "Agent Review" })
```

Stop. Review owns Agent Review landing. Verify starts after Done.

## Epic rollup

When the built issue is a child:

1. Comment on the parent with a one-line status and a link to the child's matrix comment.
2. Leave the parent in its current state. Parent auto-close is not evidence that code merged or AC landed.

Do not pick the next sibling here. This child still has to pass Review, merge, and Verify.

## Follow-up work

When Build surfaces work that is out of scope, open a separate Backlog issue:

```
save_issue({
  "title": "<follow-up>",
  "team": "<team>",
  "project": "<project>",
  "state": "Backlog",
  "relatedTo": ["<id>"],
  "description": "<scoped spec, AC, and evidence>"
})
```

Link it from the matrix comment.

## Red flags

Stop and ask when:

- The issue is not Todo or In Progress and the user has not explicitly overridden the gate.
- The issue is Human Review without an explicit resume.
- The issue is Canceled or Duplicate.
- The issue is an epic and no child was selected.
- Blocking open questions remain.
- The worktree contains unrelated changes.
- The branch is `main` or `master` and the user has not approved direct implementation there.
- No dedicated TDD workflow is bundled or readable.
- Acceptance criteria are missing, vague, or not testable.
- The selected issue has no independently exercisable demonstration and no approved technical-enablement exception.
- The public-boundary E2E/contract seam or required verification commands are unknown.
- Reviewers find unresolved issues.
- The spec is wrong or incomplete.

Never:

- Skip the bundled TDD workflow before implementation.
- Skip spec compliance review.
- Skip code quality review.
- Start code quality review before spec compliance passes.
- Mark a task complete while tests or review issues are failing.
- Dispatch multiple implementers in parallel against the same worktree.
- Let implementer self-review replace actual review.
- Edit acceptance criteria to match what was built.
- Close the spec issue from Build.
- Continue into Review or Verify from Build.
- Merge the pull request.
