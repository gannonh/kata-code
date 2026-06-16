# Disabled GitHub Actions workflows

Workflows in this directory are **not executed** by GitHub Actions (only `.github/workflows/` is scanned).

They are kept here until [Phase 2 — infrastructure split](../../FORK.md#phase-2--infrastructure-split) provisions fork-owned release, relay, and mobile signing infrastructure.

| Workflow                 | Disabled reason                                                       |
| ------------------------ | --------------------------------------------------------------------- |
| `release.yml`            | Upstream-shaped signing, Vercel deploy, npm publish, and relay config |
| `deploy-relay.yml`       | Fork relay infra not split from upstream                              |
| `mobile-eas-preview.yml` | Fork Expo project / EAS credentials not configured                    |

Restore a workflow by moving it back to `.github/workflows/` after fork infra is ready.
