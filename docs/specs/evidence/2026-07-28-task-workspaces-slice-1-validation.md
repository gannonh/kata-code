---
type: Evidence
title: "Task workspaces Slice 1 validation"
description: "Automated and manual validation record for the Standard task-workspace walking skeleton."
status: Complete
recommendation: Accepted — merged via PR #51
tags: [evidence, task-workspaces, workflows, verification, slice-1]
timestamp: 2026-07-29T15:52:00Z
parent: /specs/2026-07-28-task-workspaces-slice-1-plan.md
---

# Task workspaces Slice 1 validation

## Scope under test

This record covers the Standard one-repository walking skeleton implemented by
[Task workspaces Slice 1](/specs/2026-07-28-task-workspaces-slice-1-plan.md): task creation,
Questions and Plan revisions, before-Build approval, worktree provisioning, deterministic Build,
commit-specific Verify, signoff, linked sessions, durable replay, idempotence, and invalid-gate
rejection.

## Product SHA under test

`ff2d61d1cf2401570d19edde2293a04c7bd96471`

## Automated evidence

### Focused test run

Command:

```bash
vp test \
  packages/contracts/src/taskWorkspace.test.ts \
  apps/web/src/taskWorkspace/taskWorkspaceStore.test.ts \
  apps/server/src/taskWorkspace/TaskWorkspaceService.test.ts \
  apps/server/src/server.test.ts \
  apps/web/src/localApi.test.ts
```

Result:

```text
Test Files  5 passed (5)
Tests       122 passed (122)
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
- corrupt persisted history fails startup rather than silently resetting state;
- an existing thread can be linked as a Questions-stage session.

### Repository gates

| Gate                     | Result     | Notes                                                                            |
| ------------------------ | ---------- | -------------------------------------------------------------------------------- |
| `vp check`               | Pass       | Local                                                                            |
| `vp run typecheck`       | Pass       | Local; server.test.ts Layer.provide pipe fixed                                   |
| Components browser shard | Pass       | 80/80 including KeybindingsToast + TaskWorkspaceView                             |
| `vp run release:smoke`   | Pass       | Local + Actions                                                                  |
| `vp run test`            | Pass on CI | Local Docker-guarded sandbox tests fail without Docker daemon                    |
| GitHub Actions CI        | Pass       | [run 30465264985](https://github.com/gannonh/kata-code/actions/runs/30465264985) |
| CodeQL                   | Pass       | [run 30465258142](https://github.com/gannonh/kata-code/actions/runs/30465258142) |

CI remediation included:

- merging TaskWorkspace + CheckpointDiffQuery mocks under Effect's 20-arg `pipe` limit;
- stubbing `taskWorkspaces` on the `localApi` RPC mock;
- registering `taskWorkspace.subscribe` as a stream in the browser WS harness;
- enabling `TaskWorkspaceView.browser.tsx` in the CI Components browser shard.

## Headed UAT evidence

Evidence package (gitignored): `uat-evidence/web-20260729-152008/`

Artifacts also copied for review under `/opt/cursor/artifacts/pr51-uat/`.

Walkthrough used `pnpm run dev` (web `5773`, server `13813`) against disposable repo
`/tmp/katacode-slice1-uat-repo` with isolated `KATACODE_HOME=/tmp/katacode-slice1-uat-home`.

Recorded Build SHA: `2bef69679f38f60ccfe11205ae37389ab9cfb1bf`

| Checkpoint                               | Artifact                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Create Standard task / Questions         | `screenshots/14-create-task-form.png`, `15-questions-initial.png`                                             |
| Invalid gate (complete without artifact) | `screenshots/16-invalid-gate.png`, `logs/16-invalid-gate.json`                                                |
| Plan approved + worktree                 | `screenshots/18-plan-approved-build.png`, `outputs/20-git-worktree.txt`                                       |
| Build commit + Verify PASS               | `screenshots/19-build-commit.png`, `21-verification.png`                                                      |
| Verified + Deliver unavailable           | `screenshots/22-verified.png`                                                                                 |
| Restart rehydration                      | `screenshots/24-rehydrate-verified.png`, `logs/24-rehydrate.json`, `outputs/33-rehydrated-task-snapshot.json` |
| Duplicate command ID                     | `outputs/34-duplicate-command.json`                                                                           |
| Linked existing thread (AC15)            | `screenshots/35-linked-session.png`, `36-open-linked-session-chat.png`, `outputs/35-linked-session.json`      |
| Continuous recording                     | `recordings/slice1-walkthrough.webm`                                                                          |

## Acceptance-criterion matrix

| AC  | Result | Evidence                                                                                                 |
| --- | ------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Pass   | UAT create form + typed `task.create`; `TaskWorkspaceNewView`                                            |
| 2   | Pass   | UAT stage rail Questions→Verified; browser component coverage                                            |
| 3   | Pass   | Contract/store tests + UAT Save revision; `outputs/33-…` revisionCount=1 for questions/plan/verification |
| 4   | Pass   | Integration rejection + UAT disabled Complete + forced RPC error                                         |
| 5   | Pass   | Integration rejection; UI disables Approve without Plan artifact                                         |
| 6   | Pass   | UAT provisioned worktree path/branch + real-Git integration                                              |
| 7   | Pass   | UAT Build progress + server-owned item schemas/tests                                                     |
| 8   | Pass   | UAT/git output full SHA `2bef6967…`; integration assertion                                               |
| 9   | Pass   | UAT verification PASS; `outputs/33-…` has `verifiedAt`, summary, exact SHA                               |
| 10  | Pass   | Integration premature/stale signoff rejection; UAT Sign off disabled until PASS                          |
| 11  | Pass   | UAT Verified + Deliver unavailable; browser component assertion                                          |
| 12  | Pass   | UAT restart UI + `outputs/33-…` stage/revisions/worktree/SHA/`signedOffAt` after restart                 |
| 13  | Pass   | Integration duplicate-command assertions + UAT `outputs/34-duplicate-command.json`                       |
| 14  | Pass   | Integration invalid-transition exits; UAT forced invalid complete                                        |
| 15  | Pass   | Integration linked-session assertion + UAT link UI (`35`/`36`) + `outputs/35-linked-session.json`        |

## Recommendation

**Accepted — merged** via [PR #51](https://github.com/gannonh/kata-code/pull/51) (`a660027c`).
