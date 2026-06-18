---
type: Architecture Note
title: "Hosted web and remote stack"
description: "Interactive diagram of app.kata.sh, katacode serve environments, manual pairing, and optional Kata Code Connect."
tags: [architecture, diagram, hosted-web, remote, connect]
timestamp: 2026-06-17T02:00:00Z
---

# Hosted web and remote stack

Open the interactive diagram: **[hosted-remote-stack.html](./hosted-remote-stack.html)**

## What it shows

- **Hosted client** — `apps/web` on Vercel at `app.kata.sh` (static React UI, not the agent runtime)
- **Execution environment** — `katacode serve` (`apps/server`) as a long-running process on user-controlled infrastructure
- **Manual pairing** — “Add Environment” stores host + pairing code; browser connects directly over WebSocket
- **Kata Code Connect** (optional) — Clerk identity + relay control plane + optional managed tunnel; not in the hot path for agent traffic

## Related

- [Remote architecture](/architecture/remote.md)
- [Remote access guide](/user/remote-access.md)
- [Kata Code Connect](/cloud/index.md)
- [Branding constants](../../packages/shared/src/branding.ts) — default `app.kata.sh` domains
- [Phase 2 release spec](/specs/2026-06-16-phase-2-desktop-web-release-design.md)
