---
type: ADR
title: "Episodic upstream sync and fork independence"
description: "Kata Code is an independent product that merges upstream T3 Code selectively on a needs-based cadence, not upstream parity."
tags: [fork, git, upstream, adr]
timestamp: 2026-06-17T23:30:00Z
---

# ADR 0003: Episodic upstream sync and fork independence

## Status

Superseded by [ADR 0004](/adrs/0004-selective-vendor-pull.md)

## Context

Kata Code is a hard fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code). [ADR 0001](/adrs/0001-connected-fork-upstream-merge.md) chose a **connected** fork with merge-based sync rather than a disconnected repo and ad-hoc cherry-picks.

Product independence is largely established: Kata Code branding, `KATACODE_*`, `~/.katacode`, fork-owned releases, and hosted web on `app.kata.sh` ([ADR 0002](/adrs/0002-katacode-product-identity.md)). The codebase will continue to diverge as fork-only features land.

Questions that motivated this ADR:

- Does “stronger independence” require removing the `upstream` remote or severing git history?
- How should maintainers sync upstream without implying parity with `upstream/main`?
- How should new fork features be structured so future merges remain tractable?

## Decision

1. **Operational independence, connected history.** Kata Code is an independent product. Keep the read-only `upstream` remote and shared git ancestry so selective merges remain possible. Do **not** reset history or drop the remote to signal independence.

2. **No upstream parity goal.** Kata Code does not track `upstream/main` continuously. Upstream is a **vendor** consulted episodically when there is concrete value (security, reliability, provider protocol changes, or a refactor worth absorbing).

3. **Episodic merge cadence.** Default sync workflow remains merge-based on dated `upstream-sync-*` branches ([FORK.md — Phase 3](../../FORK.md#phase-3--upstream-sync-runbook), [upstream sync guide](/guides/upstream-sync.md)). Triggers:
   - Security or reliability fix worth merging
   - Provider or protocol change that affects shared `contracts` / server paths
   - Deliberate decision to absorb a bounded upstream feature set
   - Before large fork work that would make a later merge much harder (optional prep sync)

   **Not** a default weekly sync while upstream is active.

4. **Pin upstream range when syncing.** Prefer merging from an explicit upstream SHA or tag (document the range in the sync PR and [FORK.md](../../FORK.md) “Last upstream sync” block), not an implicit “always latest `main`” habit.

5. **Divergence log is mandatory.** Before merging, classify upstream commits since the last sync baseline as **take**, **cherry-pick**, **reject**, or **defer**. Record **reject** and **cherry-pick** outcomes in [FORK.md — divergence log](../../FORK.md#divergence-log). Do not re-litigate rejected work on every sync.

6. **Extension-first fork development.** Fork-only behavior belongs in new modules, adapter boundaries, and `packages/kata-*` / `apps/kata-*` style locations per [FORK.md — Phase 4](../../FORK.md#phase-4--divergence-boundaries). Avoid editing shared upstream core files when an extension point exists.

7. **Cherry-pick as escape hatch.** Single urgent upstream commits may be cherry-picked between episodic merges ([ADR 0001](/adrs/0001-connected-fork-upstream-merge.md)). Record SHAs in the divergence log.

8. **GitHub fork link is optional.** Unlinking the GitHub “forked from” relationship or removing the local `upstream` remote does not change merge capability. Neither is required for independence.

## Consequences

- First sync from baseline `708d5383` should follow the [upstream sync guide](/guides/upstream-sync.md) inventory step; expect heavy conflict in `contracts`, `server`, `web`, `desktop`, and lockfiles.
- Fork PRs should prefer extension boundaries so episodic syncs stay bounded.
- Intentional upstream-shaped wire identifiers (see [FORK.md — deferred wire compatibility](../../FORK.md#deferred-upstream-wire-compatibility-phase-2)) remain valid divergence until a dedicated migration is scheduled.
- [ADR 0001](/adrs/0001-connected-fork-upstream-merge.md) remains authoritative for merge-over-rebase and never pushing to `upstream`; this ADR refines **cadence**, **parity expectations**, and **development boundaries** only.

## Related

- [ADR 0001 — Connected fork with merge-based upstream sync](/adrs/0001-connected-fork-upstream-merge.md)
- [ADR 0002 — Kata Code product identity](/adrs/0002-katacode-product-identity.md)
- [Upstream sync guide](/guides/upstream-sync.md)
- [Fork setup spec](/specs/archive/fork-setup.md)
- [FORK.md](../../FORK.md)
