---
type: ADR
title: "Kata Code product identity"
description: "npm scope @kata-sh/code, katacode CLI binary, KATACODE_* env prefix, and ~/.katacode state directory for the fork."
tags: [fork, branding, identity, adr]
timestamp: 2026-06-16T22:45:00Z
---

# ADR 0002: Kata Code product identity

## Status

Accepted (Phase 1 complete)

## Context

The fork must be distinguishable from upstream T3 Code in package names, CLI, environment variables, state directories, desktop bundle IDs, and user-visible branding. `@kata-sh/cli` already owns the `kata` binary — the coding-agent CLI must not collide.

## Decision

| Surface                  | Kata Code value                   |
| ------------------------ | --------------------------------- |
| Product name             | Kata Code                         |
| GitHub                   | `gannonh/kata-code`               |
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
- Kata Code is a hard fork with no upstream-state migration: `~/.t3` data is ignored, and the startup warning / `KATACODE_HOME=~/.t3` affordance described in the original Phase 1 decision was removed (2026-06-20). The legacy-T3 branding constants and `warnLegacyHomeDirectoryIfNeeded` no longer exist; `KATACODE_HOME` remains a general state-dir override.
- Hosted pairing and user-facing URLs use fork domains from `packages/shared/src/branding.ts` (not upstream `app.t3.codes`).
- Release workflows (`release.yml`) and hosted web deploy are active on the fork; relay and mobile EAS remain under `.github/disabled/` until explicitly re-enabled. PR CI (`ci.yml`) gates `main`.
- Production Kata icons ship on all channels (dev, nightly, production); canonical source is `apps/desktop/resources/source.png` ([FORK.md — brand marks](../../FORK.md#brand-logo-marks)).

## Related

- [Fork setup spec](/specs/fork-setup.md)
- [ADR 0001 — Connected fork](/adrs/0001-connected-fork-upstream-merge.md)
- [FORK.md](../../FORK.md) identity map
