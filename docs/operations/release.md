---
type: Runbook
title: "Release Checklist"
description: "Fork release workflow for KataCode desktop and CLI packages."
tags: [operations, runbook]
timestamp: 2026-06-16T17:10:05Z
---

# Release Checklist

This runbook describes the **KataCode fork** release workflow. Upstream T3 release docs are obsolete for this repository.

## Status — disabled until Phase 2

The release workflow is **disabled** until [Phase 2 in FORK.md](../../FORK.md#phase-2--infrastructure-split) provisions fork-owned signing, npm channels, hosted web domains, and relay config.

- Workflow file (inactive): [`.github/disabled/release.yml`](../../.github/disabled/release.yml)
- See [`.github/disabled/README.md`](../../.github/disabled/README.md)

Do **not** configure upstream production secrets on the fork repo until Phase 2 checklist items are complete.

## What the workflow will do (when re-enabled)

- Triggers:
  - push tag matching `v*.*.*` for stable releases
  - manual `workflow_dispatch` for stable or nightly channels
- Runs quality gates first: `vp check`, `vp run typecheck`, `vp run test`.
- Builds macOS (`arm64`, `x64`), Linux (`x64`), and Windows (`x64`) desktop artifacts.
- Publishes the CLI package **`@kata-sh/code-cli`** (binary `katacode`) with OIDC trusted publishing:
  - stable releases publish npm dist-tag `latest`
  - nightly releases publish npm dist-tag `nightly`
- Hosted web deploy targets fork domains (`app.katacode.sh`, channel cookies) — not upstream `app.t3.codes`.

## Local verification before tagging

```bash
vp check
vp run typecheck
vp run test
vp run build:desktop
```

## Related

- [CI quality gates](./ci.md)
- [Fork setup spec](../specs/fork-setup.md)
- [FORK.md — Phase 2](../../FORK.md#phase-2--infrastructure-split)
