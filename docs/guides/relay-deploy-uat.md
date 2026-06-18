---
type: Guide
title: "Relay Deploy UAT"
description: "Manual acceptance steps and evidence expectations for production Kata Code Connect relay deployment."
tags: [relay, uat, connect, operations]
timestamp: 2026-06-18T00:00:00Z
---

# Relay Deploy UAT

Use this guide after a successful production relay deploy and before signoff on [Relay Deploy](../specs/2026-06-18-relay-deploy-design.md).

## Prerequisites

- Production relay deployed through `deploy-relay.yml` with apply mode (after [Relay credentials playbook](./relay-credentials-playbook.md) phases 1–3)
- GitHub `production` environment configured per [Relay deploy setup](../operations/relay-deploy-setup.md)
- A production-configured stable or nightly build (or release artifact) with Connect public config baked in
- A Clerk-approved beta test user
- A running local test environment via `katacode serve`

## Evidence to capture

Include all of the following in the UAT bundle:

- Workflow URLs for relay deploy dry-run and apply runs
- Terminal output for CLI commands below
- Screenshots of Connect UI states (signed-out, signed-in, linked environment, connected state)
- Environment label or identifier used for link/connect verification
- Cleanup confirmation after `katacode connect unlink`

## Steps

1. Open a production-configured stable/nightly build and confirm Kata Code Connect UI is visible with no missing-config error.
2. Signed out as an approved test user, start the Connect sign-in path.
3. If waitlist is enabled, signed out as an unapproved user, confirm the waitlist path starts instead of sign-in.
4. Sign in as the approved beta test user and open **Connections**.
5. Record the test environment label from `katacode serve`.
6. Run `katacode connect --help` and confirm the command group is present.
7. Run `katacode connect login` and complete Clerk authorization through the loopback callback.
8. Run `katacode connect link` for the test environment and confirm the relay link is created.
9. Confirm the signed-in app lists the linked environment with the expected label or identifier.
10. Connect through the relay-managed endpoint and record a usable connected state (metadata, projects, or authenticated status).
11. Run `katacode connect unlink` and confirm cleanup in CLI and app state after refresh or reconnect.

## Pass criteria

All acceptance criteria in [Relay Deploy — User-path UAT criteria](../specs/2026-06-18-relay-deploy-design.md#user-path-uat-criteria) must pass with attached evidence.
