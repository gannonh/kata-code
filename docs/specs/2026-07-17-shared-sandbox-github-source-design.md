---
type: Spec
title: Shared sandbox GitHub source picker and Docker remote seed
description: Generalize the Vercel GitHub repo/branch picker for all sandbox drivers and replace Docker local-worktree archive seeding with an in-container gh/git clone of the selected source.
status: Approved
approved_at: 2026-07-18T00:00:00Z
---

# Shared sandbox GitHub source picker and Docker remote seed

## Status

Approved

## Build handoff

Implement the locked decisions and acceptance criteria in this design. Base worktree is the isolated Herdr pane on `pi-sandbox-support`. Do not reopen Pi sandbox support. Follow TDD; commit each logical unit; run `vp check`, `vp run typecheck`, `vp run test`, `vp run release:smoke`, and focused `@environments-deploy` desktop-dev coverage before marking Implemented.

Blocking open questions: None

## Goal

Every sandbox deployment target uses one shared GitHub repository + branch picker. Docker Create & run clones that selected source into `/workspace` using host-seeded GitHub credentials. The Docker local-worktree archive seed path is removed.

## Background

Vercel sandboxes already persist a GitHub `source: { repository, branch }` and pick it through `VercelSourcePicker` (`apps/web/src/components/settings/VercelSourcePicker.tsx`), backed by host `gh` discovery RPCs and native Vercel Git clone ([Vercel GitHub repository and branch seeding](/specs/2026-07-10-vercel-github-source-seeding-design.md)).

Docker targets still use `SavedEnvironmentEditor`'s local-project "Saved environment" dropdown and seed via host `repoSeedArchive` + `copyInto`. That UX divergence is what this spec closes. Docker remote-source follow-up was previously deferred as [#29](https://github.com/gannonh/kata-code/issues/29); this spec accepts that work.

## Locked decisions

1. **Shared picker component.** Rename/generalize `VercelSourcePicker` → `SandboxGitHubSourcePicker`. Vercel and Docker cards both render it. Discovery RPCs stay as today (`sandbox.searchGitHubRepositories`, `sandbox.listGitHubBranches`).
2. **Docker config gains `source`.** Same optional `{ repository: owner/name, branch }` shape as Vercel. Persist on the Docker target. Derive/set `repositoryKey` from `https://github.com/<owner>/<name>.git` so `savedSandboxEnvironments` continues to key off the GitHub canonical key.
3. **In-container clone for Docker.** After credential seed (so `gh`/git auth exists in the box), shallow-clone `owner/name@branch` into `/workspace`. No host archive upload for Docker create.
4. **Replace local-worktree seed entirely.** Create & run requires a selected GitHub repo + branch. No local-project seed mode and no silent fallback to an open worktree.
5. **Source lock matches Vercel.** Picker locked while a sandbox session exists. Changing source requires delete + recreate. Store a source fingerprint on the Docker session record; Start rejects mismatch.
6. **Saved environment editor.** Keep install/start/terminals/secrets via `SavedEnvironmentEditor` with `fixedRepositoryKey` (same as Vercel). Remove Docker's local-project repository selector.

## Design

### Shared picker

- Move `VercelSourcePicker` → `SandboxGitHubSourcePicker` (file + export rename; update imports/tests).
- Props remain: `idPrefix`, `repository`, `branch`, `locked`, `onRepositoryChange`, `onBranchChange`.
- Behavior unchanged: paginated repo/branch discovery through the primary environment connection; locked copy when a sandbox exists; no token in the browser.

### Docker source record and card wiring

- Extend Docker sandbox config with optional `source` (hidden from generic settings form rendering; card owns the picker).
- `SandboxDeploymentTargetCard` Docker branch renders `SandboxGitHubSourcePicker` + conditional `SavedEnvironmentEditor` with `fixedRepositoryKey`, mirroring the Vercel branch.
- Legacy Docker targets without `source` remain editable and show a required-source state until the user selects one (same posture as legacy Vercel targets).

### Docker startSession clone step

Order inside Docker provision (after existing credential seed, before / as the workspace materialization step that today's archive seed occupied):

1. Validate `source.repository` and `source.branch` (fail loud if missing).
2. Compute and store `sourceFingerprint` (SHA-256 of `<canonical repository key>\0<branch>`, same algorithm as Vercel).
3. Ensure `/workspace` is empty or owned for clone destination.
4. In-container shallow clone of the selected branch into `/workspace` using seeded GitHub credentials (`gh`/`git`). Prefer HTTPS with the seeded credential path already used for authenticated git in sandboxes.
5. Run existing setup runner against `/workspace` (`.kata/environment.json` / saved env install/start/terminals).

Lifecycle Start re-derives the fingerprint from current config and rejects missing/mismatched stored fingerprints (delete + recreate).

### Error handling

| Condition                                | Behavior                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Missing source on Create & run           | Block with clear "select a GitHub repository and branch" guidance                                         |
| `gh` unauthenticated / discovery failure | Same recovery messages as Vercel discovery                                                                |
| Clone failure                            | Surface concrete stderr; do not mark session ready; clean up partial provision per existing failure paths |
| Fingerprint mismatch on Start            | Reject; require delete + recreate                                                                         |
| No open local project                    | Irrelevant — local project is not a seed source                                                           |

No silent fallback to local-project archive seeding.

## Non-goals

- Changing Vercel's native Git clone implementation (picker rename/wiring only on that path).
- Keeping Docker local-archive seed as an alternate mode.
- Pi sandbox provider un-gating (separate spec: [Pi sandbox support](/specs/2026-07-17-pi-sandbox-support-design.md)).
- New GitHub token settings on the target (host `gh` session only).

## Acceptance criteria

- **AC-1:** Docker and Vercel sandbox cards share one GitHub repository + branch picker component (`SandboxGitHubSourcePicker`).
- **AC-2:** Docker Create & run requires a selected source; the sandbox workspace `/workspace` is a clone of that `owner/name@branch`, not a host worktree archive.
- **AC-3:** While a Docker sandbox session exists, the source picker is locked; changing source requires delete + recreate. Start rejects a fingerprint mismatch.
- **AC-4:** Saved-environment install/start/terminals/secrets still key off the GitHub canonical `repositoryKey` derived from the selected source.
- **AC-5:** Unit tests cover Docker source validation/fingerprint behavior and the shared picker rename/wiring. Existing `@environments-deploy` Docker e2e is updated for the new picker (or a follow-up gated update is filed if credentialed CI cannot land in the same PR).
- **AC-6:** `vp check` and `vp run typecheck` pass.

## Affected surfaces

| Surface                    | Path                                                                                 | Change                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Shared picker              | `apps/web/src/components/settings/VercelSourcePicker.tsx` (+ logic/tests)            | Rename to `SandboxGitHubSourcePicker`                                    |
| Target card                | `apps/web/src/components/settings/SandboxDeploymentTargetCard.tsx`                   | Docker uses shared picker + fixed-key saved env editor                   |
| Docker config              | `packages/sandbox-docker` (config schema)                                            | Optional `source` field                                                  |
| Docker provision           | `apps/server/src/sandbox/*` (start session / seed path)                              | In-container clone; remove Docker create dependency on host archive seed |
| Contracts / session record | sandbox session types as needed                                                      | Docker `sourceFingerprint` parity with Vercel                            |
| E2E                        | `e2e/tests/environments-deploy/container-deploy.spec.ts` + flows                     | Drive GitHub picker instead of local project selector                    |
| Deferred work              | [#29](https://github.com/gannonh/kata-code/issues/29), `docs/specs/deferred-work.md` | Accept/close Docker remote-source deferral when implemented              |

## Risks

- **Clone auth in container:** depends on credential seed already placing usable GitHub auth for `git`/`gh` inside the box. Validation must prove clone works with the seeded path; if not, fix seed before un-gating Create & run.
- **E2E churn:** container-deploy specs assume local-project selection; updating them is in scope for AC-5 unless explicitly deferred with a tracking issue in the same change.
- **Large repos:** shallow clone (`depth: 1`) is required for cold-start; document that full history is out of scope (same depth posture as Vercel native source).

## References

- [Vercel GitHub repository and branch seeding](/specs/2026-07-10-vercel-github-source-seeding-design.md)
- [Phase 3b Vercel Sandbox driver](/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md)
- [Deferred Docker remote source #29](https://github.com/gannonh/kata-code/issues/29)
- [Pi sandbox support](/specs/2026-07-17-pi-sandbox-support-design.md) (parallel track; not blocked by this spec)
