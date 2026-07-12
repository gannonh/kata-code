---
type: Spec
title: Sandbox status refresh + Vercel start bootstrap bugfix
description: Fix web/Electron sandbox status divergence (one-shot reconcile) and Vercel start-from-stopped invalid_credential (stale serve keeps the old bootstrap grant).
status: Approved
---

# Sandbox status refresh + Vercel start bootstrap bugfix

## Status

Approved

## Goal

When web and Electron both drive the same Vercel sandbox against a shared session store, the UI status matches the provider, and Start never exchanges a bootstrap token against a leftover `katacode serve` process.

## Problem

Observed 2026-07-12 with `vercel_kata-code-sandbox` (`https://sb-mj6gwes724iq.vercel.run`):

1. **Status split** — Electron showed `running` / Session ready; web showed `stopped` with Start enabled. Both orchestrators share `~/.katacode/dev/sandbox-sessions.json`, but `reconcileSessions` runs only once per process (`reconcileDone`). After Electron started the sandbox, web kept its boot-time `stopped` cache and never re-queried Vercel.
2. **Start `invalid_credential`** — Web Start took the start-from-stopped path against a still-running VM, relaunched `katacode serve` with a fresh `KATACODE_DESKTOP_BOOTSTRAP_TOKEN` via `nohup` **without killing the old serve**, waited on the old process’s readiness, then POSTed the new token to `/oauth/token` → `EnvironmentAuthInvalidError` / `invalid_credential`.

## References

- [Sandbox lifecycle design](/specs/2026-07-07-kata-sandbox-lifecycle-design.md)
- `apps/server/src/sandbox/SandboxService.ts` — `reconcileSessions`, `startSession`
- `packages/sandbox-vercel/src/VercelSandboxProvider.ts` — `lifecycle.start` / `buildServeCommand`
- `packages/sandbox-vercel/src/bootstrap.ts` — serve launch env inlining

## Design

### 1. Refresh provider status on every `listInstances` / lifecycle entry

Split the one-shot boot work:

- **Status refresh** — always run `reconcileStoredRecords` (provider `lifecycle.status` → store) when `listInstances`, `startSession`, `stopSession`, or `disposeSession` needs current status. Guard with `reconcileInProgress` + busy locks as today.
- **Discovery** — keep `discoverUntrackedSessions` one-shot (`discoveryDone`) so we do not repeatedly probe unnamed sandboxes.

`getSessionStore().records` remains the in-process cache; refresh reloads provider truth into that cache (and persists). Cross-process file races still resolve on the next refresh because provider status wins.

### 2. Vercel `lifecycle.start` replaces serve before relaunch

Before `buildServeCommand` + detached `runCommand`, run a best-effort kill of any existing `katacode serve` bound to the sandbox port (or matching the serve command), then launch with the fresh bootstrap env. `waitForReady` must observe the new process.

Provision (first create) is unchanged — no prior serve.

### 3. Start path uses refreshed status

`startSession` refreshes status before branching. If the provider reports `running`, return the existing “already running” error (UI should not offer Start after a fresh list). Do not mint/exchange a new bootstrap token against a live serve unless Stop → Start intentionally replaced it.

## Out of scope

- Merging Electron and web into a single orchestrator process
- Making Start fully idempotent (re-pair without restart) when already running
- Changing Docker start (container env recovery path stays as-is)
- Separating `dev/` vs `userdata/` session stores further

## Acceptance criteria

1. With Electron and web both running against the same Vercel sandbox, after Electron starts it, a web Environments refresh shows `running` (not stale `stopped`) without restarting the web server.
2. Vercel `lifecycle.start` kills any prior `katacode serve` on the sandbox port before relaunching with the new bootstrap env (unit-tested against the fake SDK / command log).
3. Start-from-stopped against a sandbox that still had an old serve process exchanges the fresh bootstrap token successfully (no `invalid_credential` from leftover serve).
4. `startSession` after a status refresh that reports `running` does not take the start-from-stopped path.
5. Untracked-session discovery still runs at most once per process boot.
6. Existing Vercel lifecycle unit tests remain green; new coverage for kill-before-serve and always-refresh status.

## Build handoff

1. Update `reconcileSessions` (or split helpers) in `SandboxService.ts`.
2. Update `VercelSandboxProvider.lifecycle.start` + `bootstrap` helpers as needed; extend `VercelSandboxProvider.test.ts`.
3. Add/adjust server sandbox tests for refresh-before-start.
4. Run `vp check` and `vp run typecheck`.
