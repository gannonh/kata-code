---
type: Spec
title: "Kata Code Connect record lifecycle remediation"
description: "Make Connect runtime discovery self-healing through leases, observable deletion, retention, E2E teardown, and explicit cleanup."
tags: [connect, relay, lifecycle, environments, e2e]
timestamp: 2026-07-12T09:00:00-07:00
status: Approved
---

# Kata Code Connect record lifecycle remediation

## Status

Approved by the maintainer on 2026-07-12 by directing implementation of all six recommended remediation tracks.

## Problem

Connect registrations are durable relay rows whose only inactive state is explicit revocation. A crashed server, interrupted E2E run, lost credential, or failed best-effort unlink leaves a visible runtime forever. Sandbox disposal currently detaches unlink and reports only provider deletion, while E2E teardown removes isolated local state without guaranteeing cloud cleanup.

## Decision

Connect availability is lease-based. Explicit unlink remains the fast path; lease expiry is the correctness backstop. Destructive sandbox lifecycle responses report provider deletion and Connect cleanup independently. Relay maintenance revokes expired links and purges retained revoked data. E2E teardown registers remote cleanup as soon as it creates a link. Users and operators can explicitly remove stale records.

## Scope

1. Persist and renew relay link leases; exclude expired links from discovery.
2. Reconcile expired links and purge revoked rows after a retention interval.
3. Make sandbox disposal perform a bounded unlink and return structured partial-cleanup state with retry support.
4. Register failure-safe E2E cleanup before deleting isolated credentials and assert relay disappearance.
5. Add automated coverage for expiry, renewal, deletion, partial failure, retry, and teardown.
6. Add user-facing and CLI/operator cleanup for disconnected Connect records.

## Non-goals

- Replacing the existing relay database or Cloudflare Worker deployment model.
- Adding endpoint reachability probes to the relay request path.
- Hard-deleting active links without user authorization or lease expiry.
- Changing local pairing or direct environment traffic.

## Acceptance criteria

1. A newly linked environment has a bounded lease, and renewing it extends its discoverable lifetime.
2. `GET /v1/environments` excludes unrevoked rows whose lease has expired.
3. Relay maintenance revokes expired links, deprovisions managed endpoints, revokes environment credentials, and purges revoked records older than the configured retention period.
4. A successful sandbox delete returns provider deletion and Connect unlink success only after a bounded unlink attempt completes.
5. If provider deletion succeeds but Connect unlink fails, the response reports partial cleanup, the UI preserves enough identity to retry, and retry can complete the unlink without recreating the sandbox.
6. Available Runtimes offers an explicit remove action for a disconnected Connect record and removes it from relay discovery after confirmation.
7. A CLI/operator command can list stale Connect records and revoke a selected record or records older than an explicit age threshold, with confirmation for bulk cleanup.
8. E2E registers relay cleanup immediately after a cloud registration, runs it during fixture teardown even after test failure, and performs cleanup before deleting the isolated home/token.
9. Automated tests cover lease expiry, renewal, maintenance retention, successful unlink, partial unlink failure and retry, user removal, relay absence after delete, and failure-safe E2E cleanup registration.
10. Existing Connect, sandbox stop/start, notification preference, and direct connection behavior remains compatible.

## Build handoff

### Ordered tasks

1. Add contract and persistence support for leases and maintenance.
2. Add server renewal and structured sandbox cleanup behavior.
3. Add explicit UI and CLI cleanup surfaces.
4. Add E2E cleanup registration and lifecycle assertions.
5. Update operations documentation and run acceptance verification.

### Verification

- Focused relay, server, web, CLI, and E2E unit/integration tests.
- Manual Playwright validation of Available Runtimes removal and partial-cleanup messaging.
- `vp run e2e --project desktop-dev --grep @environments-deploy`
- `vp check`
- `vp run typecheck`
- `vp run test`
- `vp run release:smoke`

### Blocking open questions

None. Lease and retention durations are configuration constants with conservative defaults and tests using an injected clock.
