---
type: Reference
title: "Scripts"
description: "Root package scripts for local development and release tooling."
tags: [reference, reference]
timestamp: 2026-06-16T17:10:05Z
---

# Scripts

- `pnpm run dev` — Starts contracts, server, and web via `scripts/dev-runner.ts` (default server port **13773**, web **5733**).
- `pnpm run dev:server` — Starts just the WebSocket server.
- `pnpm run dev:web` — Starts just the Vite dev server for the web app.
- `pnpm run dev:desktop` — Starts desktop + web dev shells.
- Dev commands default `KATACODE_HOME` to `~/.katacode/dev` via the dev runner.
- Override server CLI-equivalent flags from root dev commands with `--`, for example:
  `pnpm run dev -- --base-dir ~/.katacode-2`
- `pnpm run start` — Runs the production server (serves built web app as static files).
- `pnpm run build` — Builds apps and packages through Vite+ (`vp`).
- `pnpm run typecheck` — Strict TypeScript checks for all packages.
- `vp test` / `pnpm run test` — Runs workspace tests.
- `node scripts/check-okf.mjs` — Validates OKF docs for broken anchors and stale toolchain strings in operations/reference docs.

Default dev ports can be offset with `KATACODE_DEV_INSTANCE` or `KATACODE_PORT_OFFSET` (see [AGENTS.md](../../AGENTS.md)).
