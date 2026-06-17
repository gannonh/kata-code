---
type: Guide
title: "Quick start"
description: "KataCode is developed from the [gannonh/katacode](https://github.com/gannonh/katacode) fork. See [FORK.md](../../FORK.md) for upstream sync and identity decisions."
tags: [getting-started, guide]
timestamp: 2026-06-16T17:10:05Z
---

# Quick start

KataCode is developed from the [gannonh/katacode](https://github.com/gannonh/katacode) fork. See [FORK.md](../../FORK.md) for upstream sync and identity decisions.

```bash
# Install dependencies
vp i

# Ensure Electron runtime (desktop dev, first time / fresh worktree)
vp run --filter @kata-sh/code-desktop ensure:electron

# Development (with hot reload)
pnpm run dev

# Desktop development
pnpm run dev:desktop

# Desktop development on an isolated port set
KATACODE_DEV_INSTANCE=feature-xyz pnpm run dev:desktop

# Production build
pnpm run build
pnpm run start

# Build a shareable macOS .dmg (arm64 by default)
pnpm run dist:desktop:dmg

# CLI from workspace (after build)
pnpm exec katacode --help
```

Default state directory: `~/.katacode` (override with `KATACODE_HOME`).

Default dev ports: web `5733`, server `13773` (offset with `KATACODE_DEV_INSTANCE` or `KATACODE_PORT_OFFSET`).
