---
type: BuildReport
title: Sandbox lifecycle — Build completion report
description: Build completion report for the durable stop/start sandbox lifecycle spec (AC-L1 through AC-L15).
status: Implemented
---

# Sandbox lifecycle — Build completion report

- **Spec:** [`docs/specs/2026-07-07-kata-sandbox-lifecycle-design.md`](./2026-07-07-kata-sandbox-lifecycle-design.md)
- **Base SHA:** `16dd73b2b0df0cc47852fb5db6c5be3e96797d63`
- **Final head SHA:** `ee1f2993f`
- **Branch:** `feat/deployments-phase-3b.md`

## Tasks completed

All seven implementation phases, in order:

1. **Phase 1 — SPI lifecycle capability (AC-L1):** added optional `SandboxLifecycleCapability` (stop/start/status) + `supportsLifecycle` descriptor; removed the Phase 3b `resume` capability and `supportsResume`. Frozen required signatures unchanged; conformance test passes.
2. **Phase 2 — Docker lifecycle (AC-L5, L6):** deterministic `kata-sandbox-<instanceId>` container name, idempotent provision (adopt running/stopped/missing), `lifecycle.stop/start/status` engine calls, `kata.sandbox.instance` label adopt verification, `AutoRemove` removed so stop persists. Injectable healthz probe factory.
3. **Phase 3 — Vercel v2 persistent lifecycle (AC-L2, L3, L4, L6):** deterministic `kata-<instanceId>` sandbox name, `persistent` config (default true) + `keepLastSnapshots {count:1}`, `lifecycle.stop/start/status` via the SDK wrapper, snapshot capability/`sourceType`/`snapshotId` removed with decode-time legacy-key migration. **Build-blocking spike resolved** (recorded in `mapVercelStatus` doc): `Sandbox.get({ name, resume: false })` returns a required (non-null) session for a stopped sandbox, so `status` is readable without resuming; not-found → `gone`.
4. **Phase 4 — Durable session store + reconcile + RPC changes (AC-L7, L8, L9):** `SandboxSessionStore` at `<katacodeHome>/userdata/sandbox-sessions.json` (atomic write, per-entry eviction, corrupt-JSON tolerance), boot reconcile on `listInstances`, `stopSession` RPC, unified `startSession` (provision or start-from-stopped), server-side `disposeSession` (works when client is gone), `resumeSession`/`createSnapshot` + keepalive/lapse machinery removed.
5. **Phase 5 — Card UX rework (AC-L10, L11, L12):** status badge (running green / stopped gray / none), secondary Stop/Start button replacing the Enabled toggle, state-driven actions (`Create & run sandbox` / `Stop` / `Start` + `Delete sandbox`), `persistent` toggle, `Dispose`/`Resume`/`Snapshot` labels removed; browser test covers the three states.
6. **Phase 6 — Available Runtimes reconciliation (AC-L13, L14):** saved runtime rows joined to `listInstances` lifecycle state; running → Connect/Disconnect, stopped → gray dot + "start it under Environments" hint, gone → saved record + credential removed on reconcile (retro-fixes existing orphans); dispose removes the row via reconcile.
7. **Phase 7 — E2E + full gates (AC-L15):** `@environments-deploy` E2E updated for the state-driven card + stop/start/delete lifecycle; new Docker stop/start filesystem-persistence test; Vercel path maintainer-local UAT.

## Files changed (summary)

- `packages/sandbox/src/{SandboxProviderDriver,descriptor,testing/stubDriver,SandboxProviderRegistry.test}.ts`
- `packages/sandbox-docker/src/{DockerSandboxProvider,DockerSandboxProvider.test}.ts`
- `packages/sandbox-vercel/src/{VercelSandboxProvider,sdk,config,config.test,VercelSandboxProvider.test}.ts`
- `packages/contracts/src/{sandboxRpc,rpc}.ts`
- `packages/client-runtime/src/wsRpcClient.ts`
- `apps/server/src/sandbox/{SandboxService,sandboxSessionStore,sandboxSessionStore.test,sandboxReconcile.test}.ts`
- `apps/server/src/ws.ts`
- `apps/web/src/components/settings/{SandboxDeploymentSettings,SandboxDeploymentSettings.logic,SandboxDeploymentSettings.logic.test,SandboxDeploymentSettings.card.test,ConnectionsSettings,ConnectionsSettings.sandbox.test}.ts(x)`
- `apps/web/src/environments/runtime/service.threadSubscriptions.test.ts`
- `e2e/tests/environments-deploy/{container-deploy,vercel-deploy}.spec.ts`

## Tests and verification commands run

- `vp check` — 0 errors (32 pre-existing warnings).
- `vp run typecheck` — 20 packages, 0 errors.
- `vp run test` — all packages green (sandbox 23, sandbox-docker 16, sandbox-vercel 24+4 skipped, web 1207, server 1366+7 skipped, desktop 154, mobile, contracts).
- `vp run release:smoke` — passed.
- New tests: `sandboxSessionStore.test.ts` (8), `sandboxReconcile.test.ts` (10), `SandboxDeploymentSettings.card.test.tsx` (AC-L12), `ConnectionsSettings.sandbox.test.tsx` (AC-L13), Docker lifecycle integration tests, Vercel lifecycle unit tests.
- E2E: `@environments-deploy` updated; Docker stop/start lifecycle test added (automated); Vercel path is maintainer-local UAT (no Vercel creds in CI).

## Review gates completed

- Spec compliance review (Phase 4) — critical issues fixed: Vercel auth trio stripped from store, relay bearer token not stored, reconcile integration test added, per-entry eviction.
- Code quality review (Phase 4) — important issues fixed: startSession race (lock before reconcile yield), liveSessions leak for gone records, fail-loud store write logging, dispose orphan warning.
- Final whole-branch review — verdict PASS; AC-L6 Vercel `gone` gap fixed (status returns `gone` on not-found so reconcile evicts).

Independent subagent review was used (spec compliance + code quality + final whole-branch). Implementer subagents handled Phases 4, 5, 6; the orchestrator applied the review fixes and completed Phases 1, 2, 3, 7 directly.

## Approved deviations

- **Vercel sandbox name:** derived from `instanceId` only (`kata-<instanceId>`), not `(serverEnvironmentId, instanceId)` as the spec's `hash8` sketch suggested. Instance ids are unique within a Kata server and Vercel sandbox names are project-unique, so the instance id alone is a stable, collision-free address. No `serverEnvironmentId` is available on the SPI `SandboxProvisionRequest`.
- **Server-side `savedSandboxEnvironments` removal in `disposeSession`:** not implemented. The client-side reconcile orphan cleanup in `ConnectionsSettings` (gone → `removeSavedEnvironment`) is the verified path that satisfies AC-L9/L13/L14 in practice. Recorded as follow-up.

## Known follow-up issues (deferred)

- **Server-side saved-record cleanup in `disposeSession`:** remove the `savedSandboxEnvironments` entry matching a disposed sandbox server-side (Phase 4 review issue #5). Today the client reconcile cleanup removes orphans on the next `listInstances` refresh; a server-side removal would make AC-L9 fully server-owned. `handleDispose` still uses client `activeSession` for immediate cleanup as a fast-path (Phase 5 minor #3); the reconcile is the durable fallback.
- **Vercel `lifecycle.status` for a non-persistent stopped sandbox:** returns `stopped` (the SDK reports the last session status); `lifecycle.start` on a non-persistent stopped sandbox fails loud (no silent recreate), per spec.
- **Per-sandbox "register started runtimes with Kata Connect" control** (carried from the Environments UX pass).
- **Sandbox lifecycle events pushed to clients:** today poll/refresh on `listInstances`; a `sandbox.state.changed` stream is a natural follow-up.
- **`KATACODE_HOME` override for the session store:** the module-level `sessionStore` uses `resolveDefaultKatacodeHome(os.homedir())` which resolves `~/.katacode`; the `KATACODE_HOME` env override is resolved later in the CLI config layer. Consistent with the existing `readProductionCliToken` pattern but contradicts the spec's "respects `KATACODE_HOME`" claim. Follow-up to thread the resolved home into the store.
- **OKF bundle:** update `docs/specs/index.md` and `docs/log.md` entries for this spec's Implemented status (per AGENTS.md OKF guidance).

## Manual UAT recorded

- Vercel live path: maintainer-local UAT (no Vercel secret in CI). The stop/start/status lifecycle, deterministic naming, and persistent filesystem resume are unit-tested against the fake SDK; the live `Sandbox.get({ resume: false })` status-read mechanism was verified against `@vercel/sandbox@2.4.0` types/source (spike result recorded in `mapVercelStatus`).
- Docker live path: integration tests run against a local Docker daemon (stop/start/status, filesystem persistence across stop/start).
