---
type: ADR
title: "Connected fork with merge-based upstream sync"
description: "Maintain connected git history with an upstream remote and merge upstream/main on sync branches rather than cherry-picking into a disconnected repo."
tags: [fork, git, upstream, adr]
timestamp: 2026-06-16T00:00:00Z
---

# ADR 0001: Connected fork with merge-based upstream sync

## Status

Accepted

## Context

Kata Code is a hard fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code). We need upstream bug fixes and features while shipping an independent product from `gannonh/katacode`.

Alternatives considered:

- **Fresh repo + cherry-picks** — loses merge context; painful for large upstream changes.
- **Rebase fork on upstream** — rewrites fork history; poor fit for a diverging hard fork.
- **Stop syncing** — minimizes merge cost but abandons upstream improvements.

## Decision

1. Keep `origin` → `gannonh/katacode` and `upstream` → `pingdotgg/t3code`.
2. Default sync strategy: **merge `upstream/main`** on a dated `upstream-sync-*` branch, verify, then merge to `main`.
3. Use **cherry-pick** only for urgent single commits between scheduled merges.
4. Record rejected upstream commits and cherry-picks in [FORK.md](../../FORK.md) divergence log.
5. **Never push** to the `upstream` remote.

## Consequences

- Merge conflicts are expected in `contracts`, `server`, `web`, `desktop`, and lockfiles.
- Branding and package renames (Phase 1) should land before heavy feature work to reduce conflict surface.
- Agents and maintainers must read [FORK.md](../../FORK.md) before large refactors or syncs.

## Related

- [Fork setup spec](/specs/fork-setup.md)
- [ADR 0002 — Product identity](/adrs/0002-katacode-product-identity.md)
