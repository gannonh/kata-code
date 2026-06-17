# Active GitHub Actions workflows

All workflows in this directory run on their declared triggers.

Release, relay deploy, and mobile EAS preview are **not** here — they live in [`.github/disabled/`](../disabled/) until [Phase 2](../../FORK.md#phase-2--infrastructure-split).

| Workflow           | Triggers                                                               |
| ------------------ | ---------------------------------------------------------------------- |
| `ci.yml`           | PRs and pushes to `main`                                               |
| `pr-size.yml`      | `pull_request_target`                                                  |
| `pr-vouch.yml`     | `pull_request_target`, issue comments, pushes to `main` (vouch config) |
| `issue-labels.yml` | Pushes to `main` (issue templates), `workflow_dispatch`                |

See [docs/operations/ci.md](../../docs/operations/ci.md).
