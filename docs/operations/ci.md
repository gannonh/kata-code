---
type: Runbook
title: "CI quality gates"
description: "Local and CI quality gates using Vite+ (`vp`) commands."
tags: [operations, runbook]
timestamp: 2026-06-16T22:45:00Z
---

# CI quality gates

## Active workflows

| Workflow     | Path                                                                   | Jobs (summary)                                                                                              |
| ------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| CI           | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)           | Check (`vp check`, typecheck, knip report), Test (coverage-gated), Test Browser, Mobile lint, Release Smoke |
| CodeQL       | [`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml)   | JavaScript/TypeScript security-extended analysis (uploads GitHub code-scanning alerts)                      |
| Release      | [`.github/workflows/release.yml`](../../.github/workflows/release.yml) | Preflight, desktop builds, GitHub Release, hosted web deploy, CLI npm publish                               |
| Dependabot   | [`.github/dependabot.yml`](../../.github/dependabot.yml)               | Weekly npm + GitHub Actions updates with cooldown (min package age)                                         |
| PR size      | `pr-size.yml`                                                          | Size labels                                                                                                 |
| PR vouch     | `pr-vouch.yml`                                                         | Vouch labels                                                                                                |
| Issue labels | `issue-labels.yml`                                                     | Template sync                                                                                               |

CI runs on every pull request and push to `main`. Local parity before push:

```bash
vp check
vp run typecheck
vp run test            # unit suite + coverage gate (matches CI Test job)
vp run knip            # unused/dead code report (soft-fail in CI Check job)
vp run release:smoke   # matches CI Release Smoke job; required for release work
```

### Coverage thresholds

Root `vite.config.ts` enforces minimum coverage on `vp run test` / `vp run test:coverage`:

| Metric     | Floor |
| ---------- | ----- |
| Lines      | 65%   |
| Statements | 65%   |
| Functions  | 60%   |
| Branches   | 50%   |

CI **Test** runs `vp run test` (coverage-enabled) and fails if any floor is missed. Use `vp run test:unit` for package-filtered runs without the coverage gate.

### Dependency update policy (minimum package age)

Dependabot opens version-update PRs only after a release has been on the registry for a cooldown window (see [`.github/dependabot.yml`](../../.github/dependabot.yml)):

- Default / minor / patch: **3 days**
- Major: **7 days**

This is the repository minimum-release-age policy for automated dependency bumps. Security advisories may still surface outside that window via GitHub security alerts.

## Branch protection (`main`)

Require these **CI** job names before merging PRs (allowlist — there is no per-workflow exclude toggle):

| Required check                | Workflow |
| ----------------------------- | -------- |
| Check                         | CI       |
| Test                          | CI       |
| Test Browser                  | CI       |
| Release Smoke                 | CI       |
| Mobile Native Static Analysis | CI       |

Do **not** require PR label automation (`Label PR size`, `Label PR 2`, etc.) or **Release** workflow jobs — `release.yml` runs on its nightly schedule and manual `workflow_dispatch`, not on pull requests.

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
- [Fork setup spec](../specs/archive/fork-setup.md) tracks Phase 1 delivery and Phase 2 scope.
