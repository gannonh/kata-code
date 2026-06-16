---
type: Runbook
title: "CI quality gates"
description: "Local and CI quality gates using Vite+ (`vp`) commands."
tags: [operations, runbook]
timestamp: 2026-06-16T17:10:05Z
---

# CI quality gates

- `.github/workflows/ci.yml` runs `vp check`, `vp run typecheck`, `vp run test`, and `vp run build:desktop` on pull requests and pushes to `main`.
- Release, relay deploy, and mobile EAS preview workflows are disabled until [Phase 2](../../FORK.md#phase-2--infrastructure-split); see [`.github/disabled/README.md`](../../.github/disabled/README.md).
- Archived plans under `docs/specs/plans/` may still reference upstream toolchain commands; use this runbook and [AGENTS.md](../../AGENTS.md) for current tooling.
- See [Release Checklist](./release.md) for desktop/npm release workflow (fork-specific release split pending Phase 2).
