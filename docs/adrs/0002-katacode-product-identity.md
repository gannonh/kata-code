---
type: ADR
title: "KataCode product identity"
description: "npm scope @kata-sh/code, katacode CLI binary, KATACODE_* env prefix, and ~/.katacode state directory for the fork."
tags: [fork, branding, identity, adr]
timestamp: 2026-06-16T22:45:00Z
---

# ADR 0002: KataCode product identity

## Status

Accepted (Phase 1 complete)

## Context

The fork must be distinguishable from upstream T3 Code in package names, CLI, environment variables, state directories, desktop bundle IDs, and user-visible branding. `@kata-sh/cli` already owns the `kata` binary — the coding-agent CLI must not collide.

## Decision

| Surface                  | KataCode value                    |
| ------------------------ | --------------------------------- |
| Product name             | KataCode                          |
| GitHub                   | `gannonh/katacode`                |
| npm scope                | `@kata-sh/code-*`                 |
| CLI package              | `@kata-sh/code-cli`               |
| CLI binary               | `katacode` (not `kata`, not `t3`) |
| Env prefix               | `KATACODE_*`                      |
| Default state dir        | `~/.katacode`                     |
| URL protocols            | `katacode` / `katacode-dev`       |
| Desktop bundle ID (prod) | `com.katacode.app`                |
| Desktop bundle ID (dev)  | `com.katacode.dev.<suffix>`       |

Shared constants live in `packages/shared/src/branding.ts`.

## Consequences

- No wire compatibility with upstream npm `t3` package or upstream desktop update channels until explicitly chosen.
- Existing `~/.t3` data is not auto-migrated; use `KATACODE_HOME=~/.t3` temporarily if needed. Server startup warns when `~/.t3` exists and `~/.katacode` does not.
- Hosted pairing and user-facing URLs use fork domains from `packages/shared/src/branding.ts` (not upstream `app.t3.codes`).
- Release, relay, and mobile EAS workflows are disabled under `.github/disabled/` until [Phase 2](/specs/fork-setup.md); PR CI (`ci.yml`) is active on the fork.

## Related

- [Fork setup spec](/specs/fork-setup.md)
- [ADR 0001 — Connected fork](/adrs/0001-connected-fork-upstream-merge.md)
- [FORK.md](../../FORK.md) identity map
