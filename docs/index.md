---
okf_version: "0.1"
---

# KataCode knowledge bundle

Open Knowledge Format (OKF) documentation for the [KataCode](https://github.com/gannonh/katacode) fork of [T3 Code](https://github.com/pingdotgg/t3code).

## Start here

| Section                                | Purpose                                             |
| -------------------------------------- | --------------------------------------------------- |
| [Specs roadmap](/specs/index.md)       | Active, planned, blocked, and completed work        |
| [Architecture](/architecture/index.md) | System map, runtime modes, providers, remote access |
| [Guides](/guides/index.md)             | Setup, user workflows, integrations, providers      |
| [Runbooks](/runbooks/index.md)         | CI, release, observability, operations              |
| [Reference](/reference/index.md)       | Scripts, workspace layout, encyclopedia             |
| [ADRs](/adrs/index.md)                 | Durable architecture decisions                      |
| [Fork operations](../../FORK.md)       | Upstream sync, identity, divergence (repo root)     |

## Fork status (summary)

Phase 1 (package rename, branding, `KATACODE_*`, `~/.katacode`) is **complete** on branch `fork-setup` ([PR #1](https://github.com/gannonh/katacode/pull/1)); GitHub Actions quality gates are **green**. Phase 2 (CI/release split from upstream) is **not started**. See [fork setup spec](/specs/fork-setup.md) and [FORK.md](../../FORK.md).

## Package map (quick)

- `apps/server` — WebSocket server, provider sessions, CLI (`katacode`)
- `apps/web` — React/Vite UI
- `apps/desktop` — Electron shell
- `packages/contracts` — shared schemas (schema-only)
- `packages/shared` — shared runtime utilities

Agent instructions: [AGENTS.md](../../AGENTS.md).

## History

See [log.md](/log.md) for bundle update history.
