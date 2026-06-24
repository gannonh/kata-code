---
type: Spec
title: "Kata Code fork setup"
description: "Fork operations plan covering identity, upstream sync, release split, and intentional divergence."
tags: [fork, roadmap, katacode]
timestamp: 2026-06-16T22:45:00Z
---

# Kata Code fork setup

**Canonical source:** [FORK.md](../../FORK.md) at the repository root. Update `FORK.md` when sync policy, identity, or divergence decisions change; keep this spec's summary and links aligned.

## Summary

Kata Code is a hard fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) at [gannonh/kata-code](https://github.com/gannonh/kata-code). Goals:

1. Ship an independent product without waiting on upstream contribution policy.
2. Pull upstream fixes via **episodic merge-based sync** ([ADR 0003](/adrs/0003-episodic-upstream-sync.md)), not continuous parity with `upstream/main`.
3. Complete branding renames early to reduce merge pain.
4. Preserve MIT attribution.

## Current status

| Item                                                                                 | Status                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fork / upstream remotes                                                              | Done                                                                                                                                                                                                                                                                                |
| Phase 1 — packages, branding, `KATACODE_*`, `~/.katacode`                            | **Done**                                                                                                                                                                                                                                                                            |
| Phase 1 — PR [#1](https://github.com/gannonh/kata-code/pull/1) & CI gates            | **Done**                                                                                                                                                                                                                                                                            |
| Phase 2 — desktop/web release ([PR #2](https://github.com/gannonh/kata-code/pull/2)) | **Done** (merged)                                                                                                                                                                                                                                                                   |
| Phase 2 — remaining infra (relay, mobile EAS, marketing)                             | **Planned**                                                                                                                                                                                                                                                                         |
| Upstream sync since `708d5383`                                                       | **Retired** — episodic bulk-merge plan ([ADR 0003](/adrs/0003-episodic-upstream-sync.md)) superseded by selective vendor-pull ([ADR 0004](/adrs/0004-selective-vendor-pull.md)); first scan pending. See [strategy analysis](/specs/2026-06-21-upstream-sync-strategy-analysis.md). |

## Phase 1 delivery (PR #1)

Branch `fork-setup` delivers Phase 1 identity work. GitHub Actions on [PR #1](https://github.com/gannonh/kata-code/pull/1) passes: Check, Test, Test Browser, Mobile lint, and Release Smoke.

**Review and hardening applied before merge:**

- Hosted pairing defaults use [branding constants](../../packages/shared/src/branding.ts) (`app.kata.sh`, `/__katacode/channel`) — no fallback to upstream `app.t3.codes`.
- Phase 1 moved release/relay/mobile EAS workflows to [`.github/disabled/`](../../.github/disabled/README.md) until Phase 2; **desktop/web `release.yml` re-activated in [PR #2](https://github.com/gannonh/kata-code/pull/2)**. Relay deploy and mobile EAS remain disabled.
- Mobile EAS preview gated on `KATACODE_EAS_PROJECT_ID`; Expo owner `gannonh`.

**Test fixture rule of thumb:** rename product surfaces (`katacode` CLI, `KATACODE_*`, worktree branch prefix `katacode/`, Grok OAuth referrer) but keep upstream-shaped **repository names** in fixtures (`octocat/t3code` → clone dir `t3code`, sidebar identity from `upstream` remote). See [CI runbook](/operations/ci.md#fork-rebrand-test-fixtures).

## Phases (detail in FORK.md)

- **Phase 0** — Git remotes — complete
- **Phase 1** — Branding and rename — complete ([ADR 0002](/adrs/0002-katacode-product-identity.md))
- **Phase 2** — Desktop/web release — complete on [PR #2](https://github.com/gannonh/kata-code/pull/2); remaining relay/mobile EAS/marketing infra still planned
- **Phase 3** — Upstream sync — selective vendor-pull per [ADR 0004](/adrs/0004-selective-vendor-pull.md) (supersedes [ADR 0003](/adrs/0003-episodic-upstream-sync.md)); [upstream sync guide](/guides/upstream-sync.md), [FORK.md — upstream sync](../../FORK.md#phase-3--upstream-sync-runbook)
- **Phase 4** — Divergence boundaries (where to put fork-only code)
- **Phase 5** — Ongoing maintenance checklists

## Related

- [Specs roadmap](/specs/index.md)
- [ADR 0001 — Connected fork](/adrs/0001-connected-fork-upstream-merge.md)
- [ADR 0004 — Selective vendor-pull](/adrs/0004-selective-vendor-pull.md) (active upstream strategy; supersedes [ADR 0003](/adrs/0003-episodic-upstream-sync.md))
- [Upstream sync guide](/guides/upstream-sync.md)
- [ADR 0002 — Product identity](/adrs/0002-katacode-product-identity.md)
- [Release runbook](/operations/release.md)
