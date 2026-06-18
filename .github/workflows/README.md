# Active GitHub Actions workflows

All workflows in this directory run on their declared triggers.

Mobile EAS preview remains in [`.github/disabled/`](../disabled/) until the remaining Phase 2 infra split lands.

| Workflow           | Triggers                                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| `ci.yml`           | PRs and pushes to `main`                                                     |
| `release.yml`      | Version tags (`v*.*.*`), manual `workflow_dispatch` (stable/nightly/dry-run) |
| `deploy-relay.yml` | Manual `workflow_dispatch` (production relay dry-run or apply)               |
| `pr-size.yml`      | `pull_request_target`                                                        |
| `pr-vouch.yml`     | `pull_request_target`, issue comments, pushes to `main` (vouch config)       |
| `issue-labels.yml` | Pushes to `main` (issue templates), `workflow_dispatch`                      |

See [docs/operations/ci.md](../../docs/operations/ci.md), [docs/operations/release.md](../../docs/operations/release.md), and [docs/operations/relay-deploy-setup.md](../../docs/operations/relay-deploy-setup.md).
