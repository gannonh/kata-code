---
type: Evidence
title: "Task workspaces Slice 2 validation"
description: "Automated and manual validation record for the artifact workspace, comments, revisions, and multiple sessions slice."
status: Complete
recommendation: Accepted — merged via PR #58
tags: [evidence, task-workspaces, workflows, verification, slice-2]
timestamp: 2026-07-29T18:11:00Z
parent: /specs/2026-07-29-task-workspaces-slice-2-plan.md
---

# Task workspaces Slice 2 validation

## Scope under test

This record covers Slice 2 of
[Task workspaces Slice 2](/specs/2026-07-29-task-workspaces-slice-2-plan.md): artifact
collection/lineage/compare/select-revision, persisted block indexes, comment lifecycle
(open/reply/outdated/orphaned/resolve), multi-session roles (primary/alternative/ad-hoc),
session fork + reviewer, context manifests, restart rehydration, idempotence, frontmatter
non-effect, and Slice 1 path continuity on the same aggregate.

## Product SHA under test

`55141e35d8ea993f07001cdc234b7f3a007881bf`

Includes the revision-allocation fix plus review hardening for context-reference integrity,
duplicate block markers, boundary-whitespace hashes, primary-session selection, command failure
handling, manifest creation, scoped test cleanup, and the cumulative desktop E2E gate.

## Automated evidence

### Focused test run

```bash
vp test \
  packages/contracts/src/taskWorkspace.test.ts \
  apps/web/src/taskWorkspace/taskWorkspaceStore.test.ts \
  apps/server/src/taskWorkspace/TaskWorkspaceService.test.ts \
  apps/server/src/server.test.ts \
  apps/web/src/localApi.test.ts
```

```text
Test Files  5 passed (5)
Tests       130 passed (130)
```

Browser:

```bash
cd apps/web && vp test --project browser src/components/taskWorkspace/TaskWorkspaceView.browser.tsx
```

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

Desktop E2E:

```bash
vp exec playwright test \
  --config e2e/playwright.config.ts \
  --project desktop-dev \
  --grep @task-workspaces
```

```text
Tests  5 passed (5)
```

### Repository gates

| Gate                          | Result | Notes                                                                            |
| ----------------------------- | ------ | -------------------------------------------------------------------------------- |
| `vp check`                    | Pass   | Local + CI Check                                                                 |
| `vp run typecheck`            | Pass   | Local + CI Check                                                                 |
| Components browser shard      | Pass   | CI Test Browser                                                                  |
| `vp run release:smoke`        | Pass   | CI Release Smoke                                                                 |
| `vp run test`                 | Pass   | CI Test                                                                          |
| GitHub Actions CI             | Pass   | [run 30494084263](https://github.com/gannonh/kata-code/actions/runs/30494084263) |
| Playwright `@task-workspaces` | Pass   | Desktop-dev cumulative Slice 1 + Slice 2 scenarios                               |

## Headed UAT evidence

Evidence package (gitignored): `uat-evidence/web-20260729-175915/`

Artifacts also copied for review under `/opt/cursor/artifacts/pr58-uat/`.

Walkthrough used `pnpm run dev` (web `5833`, server `13873`) against disposable repo
`/tmp/katacode-slice2-uat-repo` with isolated `KATACODE_HOME=/tmp/katacode-slice2-uat-home`.

| Checkpoint                                    | Artifact                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Create task / Slice 2 panels                  | `screenshots/01-create-task-form.png`, `02-questions-workspace.png`                               |
| Plan lineage + compare + select non-latest    | `screenshots/04-plan-revisions.png`, `05-compare-select-r1.png`, `outputs/05-artifacts-panel.txt` |
| Comment open → outdated → orphaned → resolved | `screenshots/06/09/10-*.png`, `outputs/20-clean-panels.json`                                      |
| Multi-session + fork reviewer + manifest      | `screenshots/07-sessions-multi.png`, `08-manifest-inspector.png`                                  |
| Unique revisions after select+upsert (fix)    | `outputs/20-clean-panels.json` (r1–r4), service test                                              |
| Restart rehydration                           | `screenshots/11-rehydrate-clean.png`, `12-rehydrate-sessions.png`                                 |
| NDJSON projection                             | `outputs/30-task-snapshots.json`, `30-task-workspace-events.ndjson`                               |

## Acceptance criteria matrix

| AC         | Result | Method                | Evidence                                      |
| ---------- | ------ | --------------------- | --------------------------------------------- |
| TW-S2-AC01 | Pass   | Headed UAT            | Artifacts list Questions/Plan + revisions     |
| TW-S2-AC02 | Pass   | Headed UAT            | Compare + select r1 while r2 retained         |
| TW-S2-AC03 | Pass   | Headed UAT            | Alternative link + manifest; stage stays Plan |
| TW-S2-AC04 | Pass   | Service + NDJSON      | `blockIndex` on revisions                     |
| TW-S2-AC05 | Pass   | Headed UAT + service  | outdated → orphaned; thread retained          |
| TW-S2-AC06 | Pass   | Headed UAT + restart  | create/reply/resolve + author fields          |
| TW-S2-AC07 | Pass   | Headed UAT + snapshot | ad-hoc `stage: null`                          |
| TW-S2-AC08 | Pass   | Headed UAT            | fork parent/forkPoint/manifest                |
| TW-S2-AC09 | Pass   | Headed UAT            | reviewer role in navigator                    |
| TW-S2-AC10 | Pass   | Headed UAT            | manifest inspector                            |
| TW-S2-AC11 | Pass   | Restart headed UAT    | clean + multi-session tasks                   |
| TW-S2-AC12 | Pass   | Service tests         | duplicate commandId                           |
| TW-S2-AC13 | Pass   | Service tests         | frontmatter non-effect                        |
| TW-S2-AC14 | Pass   | Headed UAT            | Questions → Plan still works                  |
| TW-S2-AC15 | Pass   | Service tests         | invalid transitions                           |
| TW-S2-AC16 | Pass   | Headed UAT            | role + provider `—`                           |

Program mapping: TW-AC5/6/7 incremental covered by the rows above.

## Bugs found in Verify

1. **Revision id collision after select-revision** — upsert used `currentRevision+1`, so selecting an older tip and upserting produced a duplicate `plan-revision-2` React key. Fixed in `cfc97c64` (`max(stored)+1`) with regression coverage.
2. **Review integrity gaps** — dangling manifest references, reused thread no-ops, duplicate block
   identities, whitespace-sensitive hashes, invalid manifest revisions/targets, optimistic input
   loss, and non-primary stage selection were fixed in `8a39c4c` / `ce9c31b`.
3. **Missing cumulative E2E gate** — added `e2e/tests/task-workspaces/slice-2.spec.ts` and a
   macOS desktop-dev CI job. The scenario covers Slice 2 plus the Slice 1 Standard path.

## Recommendation

**Accepted — merged.** [PR #58](https://github.com/gannonh/kata-code/pull/58) had complete
automated and headed evidence, all 16 review threads resolved, and all nine head checks green;
it squash-merged to `main` as `25ce0cc1` on 2026-07-29. The cumulative `@task-workspaces` E2E
closes the residual Slice 1 / Slice 2 validation debt tracked by
[#52](https://github.com/gannonh/kata-code/issues/52) and
[#57](https://github.com/gannonh/kata-code/issues/57).
