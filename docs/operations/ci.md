---
type: Runbook
title: "CI quality gates"
description: "Local and CI quality gates using Vite+ (`vp`) commands."
tags: [operations, runbook]
timestamp: 2026-06-16T22:45:00Z
---

# CI quality gates

## Active workflows

| Workflow     | Path                                                                   | Jobs (summary)                                                                |
| ------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| CI           | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)           | Check (`vp check`, typecheck), Test, Test Browser, Mobile lint, Release Smoke |
| Release      | [`.github/workflows/release.yml`](../../.github/workflows/release.yml) | Preflight, desktop builds, GitHub Release, hosted web deploy, CLI npm publish |
| PR size      | `pr-size.yml`                                                          | Size labels                                                                   |
| PR vouch     | `pr-vouch.yml`                                                         | Vouch labels                                                                  |
| Issue labels | `issue-labels.yml`                                                     | Template sync                                                                 |

CI runs on every pull request and push to `main`. Local parity before push:

```bash
vp check
vp run typecheck
vp run test
vp run release:smoke   # matches CI Release Smoke job; required for release work
```

## Branch protection (`main`)

Require these **CI** job names before merging PRs (allowlist — there is no per-workflow exclude toggle):

| Required check                | Workflow |
| ----------------------------- | -------- |
| Check                         | CI       |
| Test                          | CI       |
| Test Browser                  | CI       |
| Release Smoke                 | CI       |
| Mobile Native Static Analysis | CI       |

Do **not** require PR label automation (`Label PR size`, `Label PR 2`, etc.) or **Release** workflow jobs — `release.yml` runs on tags and `workflow_dispatch`, not on pull requests.

## Disabled workflows (remaining Phase 2)

Relay deploy and mobile EAS preview are **not** active — they live in [`.github/disabled/`](../.github/disabled/README.md) until the remaining Phase 2 infra split.

**Policy:** do not gate workflows with branch-name `if:` skips (e.g. `head_ref != 'fork-setup'`). Move the whole file to `disabled/` instead. Re-enable by moving back to `.github/workflows/` and wiring fork secrets — see [disabled README](../../.github/disabled/README.md).

## Fork rebrand test fixtures

Partial fork renames can leave tests asserting `katacode` where fixtures still model upstream repos. When fixing CI after identity work:

| Surface                                                       | Expect                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| CLI binary, env prefix, protocols, npm scope                  | `katacode`, `KATACODE_*`, `@kata-sh/code-*`                    |
| Worktree / PR branch prefixes                                 | `katacode/`                                                    |
| Hosted pairing host and channel path                          | `app.kata.sh`, `/__katacode/channel`                           |
| Git remote repo name in fixtures (`octocat/t3code`)           | `t3code` (derived from repo name, not product name)            |
| Primary remote identity when `upstream` is `pingdotgg/t3code` | upstream repo name `t3code` (sidebar shows upstream by design) |

## Other notes

- Archived plans under `docs/specs/plans/` may still reference upstream toolchain commands; use this runbook and [AGENTS.md](../../AGENTS.md) for current tooling.
- See [Release runbook](./release.md) for cutting releases; [Release setup](./release-setup.md) for secrets and infrastructure.
- [Fork setup spec](../specs/fork-setup.md) tracks Phase 1 delivery and Phase 2 scope.
