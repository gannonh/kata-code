---
type: Runbook
title: "CI quality gates"
description: "Local and CI quality gates using Vite+ (`vp`) commands."
tags: [operations, runbook]
timestamp: 2026-06-16T22:45:00Z
---

# CI quality gates

## Active workflows

| Workflow     | Path                                                         | Jobs (summary)                                                                |
| ------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| CI           | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | Check (`vp check`, typecheck), Test, Test Browser, Mobile lint, Release Smoke |
| PR size      | `pr-size.yml`                                                | Size labels                                                                   |
| PR vouch     | `pr-vouch.yml`                                               | Vouch labels                                                                  |
| Issue labels | `issue-labels.yml`                                           | Template sync                                                                 |

CI runs on every pull request and push to `main`. Local parity before push:

```bash
vp check
vp run typecheck
vp run test
```

## Disabled workflows (Phase 2)

Release, relay deploy, and mobile EAS preview are **not** active — they live in [`.github/disabled/`](../.github/disabled/README.md) until [Phase 2](../../FORK.md#phase-2--infrastructure-split).

**Policy:** do not gate workflows with branch-name `if:` skips (e.g. `head_ref != 'fork-setup'`). Move the whole file to `disabled/` instead. Re-enable by moving back to `.github/workflows/` and wiring fork secrets — see [disabled README](../../.github/disabled/README.md).

## Fork rebrand test fixtures

Partial fork renames can leave tests asserting `katacode` where fixtures still model upstream repos. When fixing CI after identity work:

| Surface                                                       | Expect                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| CLI binary, env prefix, protocols, npm scope                  | `katacode`, `KATACODE_*`, `@kata-sh/code-*`                    |
| Worktree / PR branch prefixes                                 | `katacode/`                                                    |
| Hosted pairing host and channel path                          | `app.katacode.sh`, `/__katacode/channel`                       |
| Git remote repo name in fixtures (`octocat/t3code`)           | `t3code` (derived from repo name, not product name)            |
| Primary remote identity when `upstream` is `pingdotgg/t3code` | upstream repo name `t3code` (sidebar shows upstream by design) |

## Other notes

- Archived plans under `docs/specs/plans/` may still reference upstream toolchain commands; use this runbook and [AGENTS.md](../../AGENTS.md) for current tooling.
- See [Release Checklist](./release.md) for desktop/npm release workflow (fork-specific release split pending Phase 2).
- [Fork setup spec](../specs/fork-setup.md) tracks Phase 1 delivery and Phase 2 scope.
