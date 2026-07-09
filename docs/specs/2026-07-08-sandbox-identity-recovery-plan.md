---
type: Spec
title: Sandbox identity recovery — one key, one join, no label matching
description: Fix the sandbox/saved-environment identity model that broke the lifecycle rollout. Join by ids everywhere, make orphan cleanup non-destructive, and restore the create→pair→connect→project flow.
status: Approved
---

# Sandbox identity recovery — one key, one join, no label matching

## Status

Approved — supersedes the joins introduced by the
[lifecycle spec](/specs/2026-07-07-kata-sandbox-lifecycle-design.md) Phase 6
(Available Runtimes reconciliation). The lifecycle SPI, drivers, and session
store from that spec are sound and stay.

## The user-facing contract (what "works as intended" means)

1. **Create & run sandbox** → container/VM runs, environment is paired and
   auto-connects, and it appears in the Add Project environment picker.
2. **Stop** → machine stops, filesystem and records survive; the runtime row
   shows "stopped" with a hint, not a dead Connect button.
3. **Start** → machine starts, re-registers, reconnects; back in Add Project.
4. **Delete sandbox** → provider sandbox, session record, saved environment,
   credential, and relay link are all removed; no ghost rows anywhere.
5. **Restarts don't lose track** — Kata server restart or app reload
   reconciles from durable state; the UI never invents or destroys state.

## Root cause of the breakage

The lifecycle rollout introduced a **join by slugified display label** between
two stores that each have real ids:

- `resolveSandboxLifecycleState` matched a saved environment record to a
  sandbox instance by `sandboxInstanceIdForLabel(record.label)`. Any rename,
  label drift, or (as happened) a saved label of "docker test 09" against
  instance id `docker_docker_test_06` breaks the join.
- A broken join returned `"gone"`, and a **destructive cleanup effect** in
  `ConnectionsSettings` then deleted the saved record and credential of a
  _running_ sandbox.
- With the record gone, the Available Runtimes list fell through to the
  relay-managed environment list (stale relay links from earlier deletes),
  whose Connect path (`connectManagedCloudEnvironment`) can never reach a
  loopback Docker sandbox → "Could not connect to relay-managed environment."
- Separately, `73544b117` disabled auto-connect for sandbox records at
  startup, which broke "shows up in Add Project" even when records survived.
  (Reverted in `6afa7f9ee`.)

One flaw, four symptoms. The fix is an identity model, not more patches.

## Identity model (the invariant going forward)

Three durable stores, one key each, explicit foreign keys:

| Store                                 | Owner           | Primary key                                 | Foreign keys                                                    |
| ------------------------------------- | --------------- | ------------------------------------------- | --------------------------------------------------------------- |
| `sandboxProviderInstances` (settings) | server settings | `instanceId`                                | —                                                               |
| `sandbox-sessions.json`               | server          | `instanceId`                                | `sandboxEnvironmentId` (the in-sandbox server's environment id) |
| `saved-environments.json`             | client          | `environmentId` (== `sandboxEnvironmentId`) | `sandbox.instanceId` (new)                                      |

**Rules:**

- **R1 — ids only.** Every join between these stores uses `instanceId` or
  `environmentId`. Display labels are never join keys. The
  `sandboxInstanceIdForLabel` label join is deleted.
- **R2 — server state is authoritative for lifecycle; client state is
  authoritative for pairing.** The client never infers "gone" from a failed
  fuzzy match. "Gone" requires: summaries loaded successfully AND the record's
  `sandbox.instanceId` is absent from the instance list AND no running session
  claims the record's `environmentId`.
- **R3 — destructive actions are explicit or server-driven.** The client-side
  orphan auto-delete effect is removed. Cleanup of saved records happens on
  server-confirmed `disposeSession` (already implemented, AC-L9) or via an
  explicit per-row "Remove" action on genuinely orphaned rows.
- **R4 — one connect path per record kind.** `sandbox` records (loopback)
  connect via the bearer pairing path. `relayManaged` records connect via
  relay/DPoP. A record is never routed down the other path; relay rows that
  duplicate a saved sandbox record's environment id are filtered out.
- **R5 — auto-connect is universal.** Every saved environment record
  auto-connects at startup and on registry change. Lifecycle state only
  _decorates_ the row (stopped hint); it never gates connection attempts for
  records whose sandbox is running.

## Work plan

### Phase R1 — stop the bleeding (client join + cleanup)

Files: `apps/web/src/components/settings/SandboxDeploymentSettings.logic.ts`,
`ConnectionsSettings.tsx`, `packages/contracts/src/ipc.ts`,
`apps/web/src/environments/runtime/catalog.ts`, `service.ts`,
`SandboxDeploymentSettings.tsx`

1. Add `instanceId` to the sandbox marker:
   `sandbox: { providerKind, instanceId? }` in
   `PersistedSavedEnvironmentRecordSchema` and `SavedEnvironmentRecord`
   (optional for backward compatibility with existing records).
2. `handleStart` passes `instanceId` into `addSavedEnvironment`; the record
   persists it.
3. Rewrite `resolveSandboxLifecycleState`:
   - Primary join: any available summary whose
     `runningSession.environmentId === record.environmentId`.
   - Secondary join: `record.sandbox.instanceId === summary.instanceId`.
   - No label fallback. Records with neither match and loaded summaries →
     `"unknown"` (rendered as plain Connect row), not `"gone"`.
4. Delete the orphan auto-remove `useEffect` in `ConnectionsSettings`. Replace
   with a per-row "Remove" button shown only for `unknown` sandbox rows.
5. Filter `ConfiguredCloudRemoteEnvironmentRows` against saved sandbox
   environment ids AND against sandbox summaries' running environment ids so
   stale relay links for local sandboxes don't render dead Connect rows.

Verification: unit tests for the new join (rename survival, id match,
unknown fallback); browser test for the row states; manual: create sandbox,
rename display name, row stays green.

### Phase R2 — repair pairing recovery (server)

Files: `apps/server/src/sandbox/SandboxService.ts`,
`packages/contracts/src/sandboxRpc.ts`, web card.

Problem: if `addSavedEnvironment` fails after a successful start (the exact
failure you hit), the sandbox runs but the client has no pairing. There is no
RPC to re-issue a pairing token for a running sandbox — `startSession` refuses
("A session is already running").

1. Add `sandbox.issuePairingToken` RPC: for a `running` store record, mint a
   fresh bootstrap→admin→pairing token chain against the live container
   (reuses `issueSandboxPairingCredential`), returning
   `{ environmentId, pairingToken, endpoint }`.
2. Web `handleStart`: when `addSavedEnvironment` fails, surface a "Retry
   pairing" action on the card that calls `issuePairingToken` +
   `addSavedEnvironment` — never a dead end.
3. Card "running" state with no saved record for its
   `runningSession.environmentId` renders the same "Retry pairing" action.

Verification: unit test for the RPC; browser test for retry flow; manual:
kill the pairing mid-create, click Retry pairing, environment appears.

### Phase R3 — relay link hygiene (server)

Files: `apps/server/src/sandbox/SandboxService.ts`.

1. Dispose already unlinks best-effort. Add unlink retry during boot
   reconcile: a store record removed as `gone` also attempts relay unlink
   (log-only failure).
2. Reconcile logs (not deletes) relay links it cannot verify.

Verification: reconcile unit test asserting unlink call on gone eviction.

### Phase R4 — UAT script + E2E lock-in

1. Manual UAT (recorded in the build report): create → appears in Add
   Project → stop → hint row → start → reconnects → delete → all rows gone →
   app reload at each step changes nothing.
2. E2E (`@environments-deploy`): extend the Docker spec to assert the saved
   environment row appears after create and disappears after delete, joined
   by environment id.
3. Full gates: `vp check`, `vp run typecheck`, `vp run test`, targeted
   browser tests.

## What is explicitly NOT changing

- The lifecycle SPI, Docker/Vercel drivers, session store, and reconcile from
  the lifecycle spec — verified sound; the Docker container survived every UI
  failure today.
- The pairing/bearer credential flow (`addSavedEnvironment`) — it works when
  fed correct identity.
- No new user-facing concepts (no "Add to projects" button); the contract is
  the five behaviors at the top.

## Why this can't corner us again

- One key per store, joins by id only — renames and label drift cannot break
  linkage (R1).
- No client-side destructive inference — records are deleted only by explicit
  user action or server-confirmed dispose (R3).
- Every failure mode in the create flow has a recovery action (R2) — no state
  where "running" is true but unreachable.
- Startup behavior is uniform (R5) — no special-cased connect gating to
  silently regress.
