# Disabled GitHub Actions workflows

GitHub only runs YAML under [`.github/workflows/`](../workflows/). **Nothing in this directory runs.**

Workflows land here until [Phase 2 — infrastructure split](../../FORK.md#phase-2--infrastructure-split) (fork signing, release channels, relay, hosted web, mobile EAS).

## What runs today

| Path                         | Role                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `workflows/ci.yml`           | `vp check`, typecheck, test, browser tests, mobile lint, release smoke |
| `workflows/pr-size.yml`      | PR size labels                                                         |
| `workflows/pr-vouch.yml`     | PR vouch labels                                                        |
| `workflows/issue-labels.yml` | Issue label sync                                                       |

## What is disabled (this directory)

| File                     | Blocked until Phase 2                                           |
| ------------------------ | --------------------------------------------------------------- |
| `release.yml`            | Fork signing, npm publish, desktop artifacts, hosted web deploy |
| `deploy-relay.yml`       | Fork relay infra and secrets                                    |
| `mobile-eas-preview.yml` | Fork Expo project (`KATACODE_EAS_PROJECT_ID`, `EXPO_OWNER`)     |

## Policy

- **Do not** gate workflows with branch-name `if:` skips (e.g. `head_ref != 'fork-setup'`). Move the whole file here instead.
- **To enable:** move the file back to `.github/workflows/`, wire fork secrets/vars, run a dry-run, update [docs/operations/release.md](../../docs/operations/release.md).
