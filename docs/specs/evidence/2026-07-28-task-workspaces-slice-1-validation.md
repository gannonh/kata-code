---
type: Evidence
title: "Task workspaces Slice 1 validation"
description: "Automated and manual validation record for the Standard task-workspace walking skeleton."
status: In Progress
tags: [evidence, task-workspaces, workflows, verification, slice-1]
timestamp: 2026-07-28T12:48:00-07:00
parent: /specs/2026-07-28-task-workspaces-slice-1-plan.md
---

# Task workspaces Slice 1 validation

## Scope under test

This record covers the Standard one-repository walking skeleton implemented by
[Task workspaces Slice 1](/specs/2026-07-28-task-workspaces-slice-1-plan.md): task creation,
Questions and Plan revisions, before-Build approval, worktree provisioning, deterministic Build,
commit-specific Verify, signoff, linked sessions, durable replay, idempotence, and invalid-gate
rejection.

## Automated evidence

### Focused test run

Command:

```bash
vp test \
  packages/contracts/src/taskWorkspace.test.ts \
  apps/web/src/taskWorkspace/taskWorkspaceStore.test.ts \
  apps/server/src/taskWorkspace/TaskWorkspaceService.test.ts \
  apps/server/src/server.test.ts
```

Result:

```text
Test Files  4 passed (4)
Tests       105 passed (105)
Duration    9.70s
```

The server integration test creates a real temporary Git repository and proves:

- one distinct task worktree is created from `main`;
- the deterministic fixture is committed and the full 40-character SHA is recorded;
- the worktree is clean and the fixture contents match;
- duplicate command IDs do not create another artifact revision, worktree, commit, or event;
- Plan approval and Verify signoff fail before their required gates;
- verification fails after HEAD moves beyond the recorded Build commit;
- verification passes after resetting to the recorded Build SHA;
- Verified state, artifacts, Build SHA, and evidence replay after service restart;
- corrupt persisted history fails startup rather than silently resetting state.

### Focused typechecks

The contracts, client-runtime, web, and desktop packages typechecked successfully in the local
validation environment. The server service and router paths compile as part of the focused test
transforms. The repository CI Check job remains the authoritative full-monorepo typecheck and
build gate.

### Release smoke

GitHub Actions Release Smoke passed on the implementation branch. A local release-smoke attempt
was blocked before repository checks by an HTTP 503 from the internal package mirror while
fetching pnpm; the successful Actions result supersedes that environment-only failure.

## Acceptance-criterion matrix

| AC  | Evidence                                                                                      |
| --- | --------------------------------------------------------------------------------------------- |
| 1   | `TaskWorkspaceNewView` browser surface and typed `task.create` contract.                      |
| 2   | `TaskWorkspaceView.browser.tsx` plus stage schemas and rendering.                             |
| 3   | Contract/store tests and integration assertions for immutable numbered revisions.             |
| 4   | Integration test rejects Questions completion without the required artifact.                  |
| 5   | Integration test rejects Plan approval before the Plan artifact exists.                       |
| 6   | Real-Git integration assertion for distinct worktree path, branch, and provisioned state.     |
| 7   | Server-owned Build phase/work-item schemas, commands, projection, and workspace rendering.    |
| 8   | Real-Git integration assertion for fixture commit and full SHA.                               |
| 9   | Integration assertion for status, summary, timestamp, and tested commit SHA.                  |
| 10  | Premature and stale signoff rejection assertions.                                             |
| 11  | Browser component assertion for Verified plus unavailable Deliver state.                      |
| 12  | Restart replay assertions for stage, revisions, worktree binding, Build SHA, and evidence.    |
| 13  | Duplicate artifact and Plan-approval command assertions, including one worktree creation.     |
| 14  | Invalid transition exits are failures and accepted state remains usable afterward.            |
| 15  | Linked Questions-stage thread assertion; existing chat router/server regression suite passes. |

## Manual evidence status

The sandbox browser runtime blocks navigation to the local application with
`ERR_BLOCKED_BY_ADMINISTRATOR`, so a trustworthy screen recording and product screenshots could
not be captured in this execution environment. The browser component test covers the new task
workspace states in CI, but it is not a substitute for the parent spec's headed visual record.

Before merge, maintainer UAT should record:

1. task creation and initial Questions workspace;
2. Questions and Plan revision history;
3. Plan approval with the provisioned branch and worktree path;
4. Build completion with the recorded commit SHA;
5. Verify pass and final Verified state with Deliver unavailable.

## Recommendation

The implementation is suitable for a draft pull request and code review. Merge recommendation
remains pending successful full CI and the headed visual evidence described above.
