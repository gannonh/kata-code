---
type: Spec
title: Sandbox status refresh + Vercel start bootstrap bugfix
description: Fix web/Electron sandbox status divergence (one-shot reconcile) and Vercel start-from-stopped invalid_credential (stale serve keeps the old bootstrap grant).
status: Draft
---

# Sandbox status refresh + Vercel start bootstrap bugfix

## Status

Draft

## Goal

When web and Electron both drive the same Vercel sandbox (same server `stateDir`), the UI status matches the provider API, and Start never exchanges a bootstrap token against a leftover `katacode serve` process.

## Problem

Observed 2026-07-12 with `vercel_kata-code-sandbox` (`https://sb-mj6gwes724iq.vercel.run`):

1. **Status split** — Electron showed `running` / Session ready; web showed `stopped` with Start enabled. `reconcileSessions` ran only once per process (`reconcileDone`). After Electron started the sandbox, web kept its boot-time `stopped` cache and never re-queried Vercel. Cross-process truth is **provider `lifecycle.status`**, not the shared JSON file (the store is load-once in memory per process).
2. **Start `invalid_credential`** — Web Start took the start-from-stopped path against a still-running VM, relaunched `katacode serve` with a fresh bootstrap token via `nohup` **without replacing the old serve**, waited on the old process’s readiness, then POSTed the new token to `/oauth/token` → `EnvironmentAuthInvalidError` / `invalid_credential`.

## References

- [Sandbox lifecycle design](/specs/2026-07-07-kata-sandbox-lifecycle-design.md)
- `apps/server/src/sandbox/SandboxService.ts` — `reconcileSessions`, `refreshLockedInstanceStatus`, `startSession`
- `packages/sandbox-vercel/src/VercelSandboxProvider.ts` — `lifecycle.start`
- `packages/sandbox-vercel/src/bootstrap.ts` — `buildReplaceServeCommand`

## Design

### 1. Always-refresh status; one-shot discovery; join in-flight refresh

- **Status refresh** — every `listInstances` runs `reconcileStoredRecords` (provider `lifecycle.status` → store). Concurrent callers **await the in-flight refresh** (Deferred join) instead of skipping.
- **Busy instances** — records under a lifecycle lock are skipped in the full refresh (last-known status kept); the locked op uses a single-instance probe.
- **Discovery** — `discoverUntrackedSessions` remains one-shot (`discoveryDone`), and only when no instance is busy.
- **Lifecycle vs list** — Start/Stop/Delete refuse only on **per-instance busy**, not on `reconcileInProgress`, so Environments refresh cannot flake Start.
- **Admin token** — `cacheLiveSession` preserves `adminAccessToken` across refresh so Retry pairing still works after listInstances.

### 2. Locked single-instance status probe before Start/Stop branch

After taking the instance busy lock, `refreshLockedInstanceStatus` probes `lifecycle.status` for that instance and updates the store before branching. This is required because full reconcile skips busy ids.

### 3. Vercel `lifecycle.start` replaces serve, then waits for real readiness

1. **Blocking kill** — `buildKillServeCommand` (pkill + wait for port free). Must not be detached.
2. **Detached serve** — `buildServeCommand` with fresh bootstrap env.
3. **Readiness** — poll `/.well-known/kata/environment` for HTTP 200 + `application/json` + `environmentId`. Do **not** treat `/healthz` HTTP 200 as ready (SPA HTML catch-all).

### 4. Start path uses refreshed status

If the provider reports `running` after the locked probe, return the existing “already running” error (UI should not offer Start after a fresh list).

### 5. Available Runtimes + unpaired UI

- Managed-relay skeleton only while `isPending`; on error/idle show empty (not infinite skeleton).
- Running sandbox without a saved pair shows “not paired” copy + primary **Retry pairing** on the Environments card.
- `RelayEnvironmentLinkResponse.leaseExpiresAt` is **optional** so Start works against production relay that predates the 2026-07-12 lease field (same tolerance as list environments).
- Environments `refreshList` times out at 30s, ignores stale generations, and never clears a prior successful list on error (avoids indefinite “Loading sandbox status…”).

## Out of scope

- Merging Electron and web into a single orchestrator process
- Making Start fully idempotent (re-pair without restart) when already running
- Changing Docker start (container env recovery path stays as-is)
- Debouncing/TTL for status refresh (acceptable cost: one Vercel status call per configured instance per list)
- Cross-`stateDir` sync (`dev/` vs `userdata/`)

## Acceptance criteria

1. With Electron and web both running against the **same** server `stateDir` and the same Vercel sandbox, after Electron starts it, a web Environments refresh shows `running` (provider-API refresh — not file coalescing) without restarting the web server.
2. Concurrent `listInstances` during an in-flight refresh join that refresh and do not return a skipped/stale probe.
3. Vercel `lifecycle.start` kills prior `katacode serve` on the port (blocking), waits for the listener to drop, then relaunches serve detached with the new bootstrap env (unit-tested).
4. Readiness requires `/.well-known/kata/environment` JSON with `environmentId` — SPA `/healthz` HTML 200 does not count as ready.
5. Start-from-stopped against a sandbox that still had an old serve process exchanges the fresh bootstrap token successfully (no `invalid_credential` from leftover serve).
6. `startSession` / `stopSession` after `refreshLockedInstanceStatus` reports `running` / `stopped` branch correctly; Start does not take start-from-stopped when the provider says running.
7. Start/Stop are not refused solely because a status refresh is in progress (only per-instance busy blocks).
8. Untracked-session discovery still runs at most once per process boot (and not while any instance is busy).
9. `adminAccessToken` survives status refresh so Retry pairing works without Stop/Start in the same server process.
10. Available Runtimes does not stay on skeletons when managed-relay is idle/failed; unpaired running sandboxes show Retry pairing on the Environments card.
11. Connect auto-registration succeeds against a relay that omits `leaseExpiresAt` (field optional on decode).
12. Environments list does not stay on “Loading sandbox status…” after a timed-out or failed refresh once a successful list has loaded (or after timeout shows error + Retry on first load).
13. Existing Vercel lifecycle unit tests remain green; new coverage for kill-then-serve, readiness probe shape, skip-busy reconcile, and admin-token preserve.

## Build handoff

1. `SandboxService.ts` — always-refresh + Deferred join; `refreshLockedInstanceStatus`; lifecycle guards ignore `reconcileInProgress`.
2. `sandboxReconcile.ts` — `skipInstanceIds`.
3. `bootstrap.ts` / `VercelSandboxProvider.ts` — `buildReplaceServeCommand` on lifecycle start.
4. Unit tests + `vp check` / `vp run typecheck`.
