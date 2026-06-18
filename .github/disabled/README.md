# Disabled GitHub Actions workflows

GitHub only runs YAML under [`.github/workflows/`](../workflows/). **Nothing in this directory runs.**

Workflows land here until [Phase 2 — infrastructure split](../../FORK.md#phase-2--infrastructure-split) provisions fork-owned credentials and deploy targets.

## What runs today

| Path                         | Role                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `workflows/ci.yml`           | `vp check`, typecheck, test, browser tests, mobile lint, release smoke |
| `workflows/release.yml`      | Desktop/web release, macOS signing, GitHub Release, hosted web deploy  |
| `workflows/pr-size.yml`      | PR size labels                                                         |
| `workflows/pr-vouch.yml`     | PR vouch labels                                                        |
| `workflows/issue-labels.yml` | Issue label sync                                                       |

## What is disabled (this directory)

| File                     | Blocked until Phase 2                                       |
| ------------------------ | ----------------------------------------------------------- |
| `mobile-eas-preview.yml` | Fork Expo project (`KATACODE_EAS_PROJECT_ID`, `EXPO_OWNER`) |

Production relay deploy moved to [`.github/workflows/deploy-relay.yml`](../workflows/deploy-relay.yml). See [Relay deploy setup](../../docs/operations/relay-deploy-setup.md).

`release.yml` moved back to [`.github/workflows/release.yml`](../workflows/release.yml) for the Phase 2 desktop/web release split.

## Policy

- **Do not** gate workflows with branch-name `if:` skips (e.g. `head_ref != 'fork-setup'`). Move the whole file here instead.
- **To enable:** move the file back to `.github/workflows/`, wire fork secrets/vars, run a dry-run, update [docs/operations/release.md](../../docs/operations/release.md).
