---
type: Spec
title: "KataCode fork setup"
description: "Fork operations plan covering identity, upstream sync, release split, and intentional divergence."
tags: [fork, roadmap, katacode]
timestamp: 2026-06-16T00:00:00Z
---

# KataCode fork setup

**Canonical source:** [FORK.md](../../FORK.md) at the repository root. Update `FORK.md` when sync policy, identity, or divergence decisions change; keep this spec's summary and links aligned.

## Summary

KataCode is a hard fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) at [gannonh/katacode](https://github.com/gannonh/katacode). Goals:

1. Ship an independent product without waiting on upstream contribution policy.
2. Pull upstream fixes via **merge-based sync** (not disconnected cherry-picks).
3. Complete branding renames early to reduce merge pain.
4. Preserve MIT attribution.

## Current status

| Item | Status |
| ---- | ------ |
| Fork / upstream remotes | Done |
| Phase 1 — packages, branding, `KATACODE_*`, `~/.katacode` | **Done** |
| Phase 2 — CI / release split | Not started |
| First upstream merge since `708d5383` | Not started |

## Phases (detail in FORK.md)

- **Phase 0** — Git remotes — complete
- **Phase 1** — Branding and rename — complete ([ADR 0002](/adrs/0002-katacode-product-identity.md))
- **Phase 2** — Infrastructure split (workflows, secrets, release channels)
- **Phase 3** — Upstream sync runbook ([ADR 0001](/adrs/0001-connected-fork-upstream-merge.md))
- **Phase 4** — Divergence boundaries (where to put fork-only code)
- **Phase 5** — Ongoing maintenance checklists

## Related

- [Specs roadmap](/specs/index.md)
- [ADR 0001 — Connected fork](/adrs/0001-connected-fork-upstream-merge.md)
- [ADR 0002 — Product identity](/adrs/0002-katacode-product-identity.md)
- [Release runbook](/runbooks/index.md) (operations docs; fork release split pending Phase 2)
