---
type: Spec
title: "Kata Environments / Deployments Phase 3b — Vercel Sandbox cloud driver"
description: "Historical Phase 3b deep-dive for the Vercel Sandbox cloud driver; durable lifecycle behavior is defined by the later stop/start design."
status: Implemented
approved_at: 2026-07-05T00:00:00Z
tags: [specs, phase-3b, environments, deployments, sandbox, vercel, cloud-driver, byoc, auth]
timestamp: 2026-07-09T00:00:00Z
---

# Kata Environments / Deployments Phase 3b — Vercel Sandbox cloud driver

## Status

Implemented as the initial Phase 3b delivery per [ADR 0007](/adrs/0007-vercel-sandbox-first-cloud-sandbox-driver.md). The current lifecycle contract is the [durable sandbox lifecycle design](/specs/2026-07-07-kata-sandbox-lifecycle-design.md): persistent named sandboxes use stop/start/delete, and explicit snapshot, lapse, and resume controls were removed. Identity recovery is defined by the [sandbox identity recovery plan](/specs/2026-07-08-sandbox-identity-recovery-plan.md). Credentialed Vercel UAT remains maintainer-local.

## Goal

A user configures a Vercel Sandbox deployment target in Settings -> Environments with their Vercel token, team id, project id, runtime/image settings, and timeout. Starting a session provisions an ephemeral Vercel Sandbox microVM, seeds the repo and provider credentials, runs the resolved environment config, starts `katacode serve`, exposes the server over `sandbox.domain(port)`, and auto-registers the public endpoint with Connect so every paired client can reach it over `wss`.

The driver remains a thin implementation of the frozen `SandboxProvider` SPI. Phase 3b uses Vercel's sandbox lifecycle directly: persistent filesystem snapshots by default, explicit `snapshot()` support, `extendTimeout()` keepalive, and manual resume after lapse.

## Lifecycle revision

The initial driver, credential seeding, public endpoint, and provider-login work from this design remain implemented. The following initial design elements are superseded by the lifecycle design:

- explicit snapshot source/configuration and user-facing snapshot actions;
- keepalive-driven `lapsed` state and Resume controls;
- in-memory session ownership and client-side orphan deletion.

The current implementation persists non-secret session state under the server state directory, namespaces Vercel names per server installation, serializes lifecycle operations per instance, and treats unavailable summary data as `unknown` rather than `gone`.

## Source of truth

- Decision: [ADR 0007 — Vercel Sandbox as the first cloud sandbox driver](/adrs/0007-vercel-sandbox-first-cloud-sandbox-driver.md)
- Superseded decision: [ADR 0006 — Sandbox provider auth model and Railway as the first cloud driver](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md)
- Master roadmap: [2026-06-27-kata-environments-deployments-design.md](/specs/2026-06-27-kata-environments-deployments-design.md)
- Phase 3a prerequisite: [2026-07-04-kata-environments-deployments-phase-3a-design.md](/specs/2026-07-04-kata-environments-deployments-phase-3a-design.md)
- Frozen SPI: `packages/sandbox/src/SandboxProviderDriver.ts` (`validate`/`provision`/`exec`/`reachability`/`dispose`/`describe`; optional `snapshot`, `renewTimeout`, `copyInto`; `SandboxProviderError` reasons). **Phase 3b adds no required member.**
- Server orchestration: `apps/server/src/sandbox/SandboxService.ts`, `apps/server/src/sandbox/sandboxSetupRunner.ts`, `environmentConfigLoader.ts`.
- Secret infra: `apps/server/src/serverSettings.ts` (`materializeSandboxProviderEnvironmentSecrets`), `apps/server/src/auth/ServerSecretStore.ts`.
- Web UI: `apps/web/src/components/settings/SandboxDeploymentSettings.tsx` (deployment-target card, sandbox start/dispose).
- Vercel platform docs: [Vercel Sandbox](https://vercel.com/docs/sandbox), [Concepts](https://vercel.com/docs/sandbox/concepts), [JS SDK Reference](https://vercel.com/docs/sandbox/sdk-reference), [Duration and persistence](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence), [Optimizing Vercel Sandbox snapshots](https://vercel.com/blog/optimizing-vercel-sandbox-snapshots).
- Prior art (pattern reference only, AGENTS.md reference-repo policy): AgentBox `/Volumes/EVO/repos/agentbox`
  - `packages/sandbox-vercel/src/backend.ts` — production cloud driver against the same SPI shape.
  - `packages/sandbox-docker/src/claude-credentials.ts` — host backup + seed pattern for provider credential files.
  - `apps/cli/src/commands/_claude-login-worker.ts` — PTY-driven OAuth URL + code relay.

## Locked decisions

1. **`packages/sandbox-vercel` implements the frozen SPI; no SPI change.** Required members (`validate`, `provision`, `exec`, `reachability`, `dispose`, `describe`) plus optional `snapshot`, `renewTimeout`, and `copyInto` where the Vercel SDK supports them.

2. **Vercel Sandbox is the first cloud sandbox provider.** The product model is an ephemeral task sandbox, not a long-lived service deployment. Vercel's Firecracker microVM, persistent filesystem snapshot, `Sandbox.getOrCreate`, `snapshot()`, `extendTimeout()`, exposed port domain, and file/command APIs match the eventual Kata task-environment shape more closely than Railway Service.

3. **Provision starts from a Vercel runtime, VCR image, or prepared snapshot.** V1 supports a configured Vercel runtime (`node24` default) and an optional `source` override for a VCR image or snapshot id. A prepared Kata snapshot may be built lazily from the provider-ready Phase 3a setup: install the provider CLIs and `katacode` server bundle, seed immutable base files, capture a snapshot, and reuse that snapshot for later provisions. The configured source is explicit and visible in the target card.

4. **Reachability advertises a `public` endpoint via `sandbox.domain(port)`.** The driver creates the sandbox with the Kata server port in the `ports` list, starts `katacode serve`, reads `sandbox.domain(port)`, and returns an `AdvertisedEndpoint` with `reachability: "public"`, `source: "server"`, and `wss` URL. Connect auto-registration proceeds against this public endpoint.

5. **Lifecycle: keepalive, lapse, resume, dispose.** The target config includes `timeoutMs`; default is 45 minutes to work on Hobby. Pro/Enterprise users can raise it up to the Vercel plan maximum. The driver advertises `supportsRenewTimeout: true` and calls `extendTimeout()` while a session is active. If the session lapses, the UI shows `lapsed`; Resume uses `Sandbox.get`/`getOrCreate` and restarts `katacode serve`, then re-registers Connect. Dispose calls `sandbox.delete()` when the session should be permanently removed.

6. **Snapshot support is first-class in Phase 3b.** Vercel persistent sandboxes snapshot the filesystem on stop, and the driver also exposes explicit `snapshot()` for prepared bases and Phase 5 reuse. A created snapshot id is stored with the sandbox session metadata and redacted where needed. Snapshot creation/restoration failures surface visibly and do not silently fall back unless the user explicitly starts from base.

7. **Credential seeding from a host-side encrypted store.** Cloud provider OAuth files are stored under `ServerSecretStore` and seeded into the Vercel sandbox at provider-expected paths before provider startup:
   - `/home/katacode/.claude/.credentials.json`
   - `/home/katacode/.codex/auth.json`
   - `/home/katacode/.config/opencode/auth.json`
     Env-var API keys remain an alternative via existing sandbox instance environment secrets. Seed values are redacted in logs and never written to `.kata/environment.json`.

8. **Interactive "Sign in <provider>" affordance on the sandbox card.** When a provider is unauthenticated in a running Vercel sandbox and no stored credential exists, the card shows "Sign in <provider>". The action runs the provider login command in the sandbox under a PTY-like command session, relays the OAuth URL + code to the UI, and captures the resulting credential file into `ServerSecretStore`.

9. **Auth: Vercel token trio via `ServerSecretStore`; OIDC optional later.** V1 stores `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID` using the existing sandbox-instance secret path. Vercel OIDC can be added later for Vercel-hosted Kata, but local desktop BYOC must work with explicit tokens.

10. **Docker-in-sandbox is unsupported for V1 Vercel target configs.** If `.kata/environment.json` needs Docker daemon access, the Vercel driver fails loud during validation/setup with a driver-unsupported message. Local Docker and future Railway/E2B/Hetzner drivers can cover Docker-native tasks.

## Verified Vercel constraints

| Constraint                                                                                  | Consequence                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Vercel Sandbox runs Firecracker microVMs with dedicated kernel isolation                    | Better match for untrusted agent/task sandboxes than service containers                    |
| Sandbox filesystem persistence is snapshot-backed and enabled by default                    | Resume and prepared-base flows are core driver behavior                                    |
| Vercel documented p75 snapshot restore improvement from >40s to <1s                         | Time-to-usable should be measured against Vercel snapshot restore, not service deploy time |
| `sandbox.domain(port)` exposes a public URL for declared ports                              | Driver uses direct public `wss`; no tunnel                                                 |
| Default timeout is 5 minutes; max is 45 minutes on Hobby and 24 hours on Pro/Enterprise     | Default target timeout is 45 minutes; Pro/Enterprise can configure longer                  |
| Built-in runtimes use Amazon Linux 2023 with `dnf`; VCR custom images are available in beta | Prepared image/snapshot setup uses Linux package installs or a VCR image path              |
| Built-in provisioning currently runs in `iad1`                                              | Region selection is not a V1 target field                                                  |
| Vercel Sandbox auth supports OIDC or access tokens                                          | BYOC desktop uses access-token trio; OIDC is future                                        |

## Acceptance criteria

1. **AC-3b.1** `packages/sandbox-vercel` implements the frozen `SandboxProvider` SPI. `describe()` advertises `reachabilityKind: "public"`, `supportsSnapshot: true`, `supportsRenewTimeout: true`, and `supportsCopyInto: true` when implemented. A type-level conformance test asserts the driver satisfies the interface.
2. **AC-3b.2** `validate` resolves Vercel credentials from `ServerSecretStore` and confirms the configured project is reachable through the Vercel Sandbox SDK/API. Invalid token, team, or project returns a `SandboxRpcError` with `reason: "invalid-config"`.
3. **AC-3b.3** `provision` creates a Vercel Sandbox from the configured runtime/image/snapshot source, sets sandbox env vars, seeds stored credential files, seeds the repo, runs setup, starts `katacode serve`, and resolves once `/healthz` responds.
4. **AC-3b.4** `reachability` returns `sandbox.domain(port)` as an `AdvertisedEndpoint` with `reachability: "public"` and a working `wss` URL. A unit test covers URL mapping; a credentialed integration/UAT confirms WebSocket connection.
5. **AC-3b.5** `renewTimeout` extends a running sandbox session and the UI surfaces remaining lifetime. When the plan cap is reached or the sandbox stops, the session enters `lapsed` with an explicit error for any in-flight agent stream.
6. **AC-3b.6** Resume reattaches to the named sandbox or recreates it from the current snapshot, restarts `katacode serve`, re-registers Connect, and restores the session card to ready. Expired/missing snapshots surface a visible error.
7. **AC-3b.7** `snapshot.createSnapshot` captures a prepared base or running session and stores the returned snapshot id. Booting from that snapshot skips repeated setup and records time-to-ready for comparison.
8. **AC-3b.8** Starting a Vercel sandbox session in the web UI provisions the sandbox, Connect-auto-registers the public endpoint, and the sandbox appears under Environments in the left-rail Add project picker.
9. **AC-3b.9** A second paired client reaches the Vercel sandbox via Connect with no manual setup. Manual UAT confirms.
10. **AC-3b.10** With a stored Claude or Codex credential, a started Vercel sandbox reports that provider as authenticated without env-var configuration. A credentialed integration test or manual UAT confirms.
11. **AC-3b.11** With no stored credential for a provider, the sandbox card shows "Sign in <provider>"; the flow relays the OAuth URL + code and stores the resulting credential file for future provisions. Manual UAT confirms for at least one OAuth-based provider.
12. **AC-3b.12** Disposing a Vercel sandbox deletes it and removes it from the Connect pool. A second paired client can no longer reach it. Manual UAT confirms.
13. **AC-3b.13** `vp check`, `vp run typecheck`, and the `@environments-deploy` e2e suite pass. Credentialed Vercel tests are maintainer-local with recorded UAT where CI credentials are unavailable.

## Deferred work

- **Railway Sandbox driver:** Railway's VM sandbox primitive has checkpoints, forks, templates, exec, files, and port forwarding, but it is still in Priority Boarding with breaking-change risk. Revisit after Vercel 3b or when Railway Sandbox stabilizes.
- **Railway Service driver:** Useful as a service-deploy target, but no longer the first cloud sandbox. Revisit when users need long-lived BYOC service hosting.
- **E2B driver:** Strong candidate for advanced snapshot/pause/resume and isolated agent-computer workflows after Vercel validates the SPI shape.
- **Vercel OIDC auth:** Add for Vercel-hosted Kata once the desktop BYOC token path is stable.
- **VCR production image pipeline:** Start with runtime/snapshot support. Add a dedicated VCR image build/publish path if measured cold-start or setup time requires it.

## Build handoff

- New package: `packages/sandbox-vercel` (driver implementation, SDK wrapper, snapshot/source helpers, credential seeding helpers).
- Files to touch: `apps/server/src/sandbox/SandboxService.ts` (register `vercel` driver kind), `apps/server/src/serverSettings.ts` (materialize Vercel token secrets), `apps/web/src/components/settings/SandboxDeploymentSettings.tsx` (Vercel target config, lifetime/resume/snapshot state, "Sign in <provider>" affordance), `apps/web/src/components/chat/ProviderStatusBanner.tsx` (sign-in affordance for unauthenticated providers in a sandbox).
- Tests: `packages/sandbox-vercel` unit tests (config decode, source selection, provision payload, reachability URL, timeout extension, dispose, credential seeding); credentialed integration tests guarded by `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`; extend `@environments-deploy` e2e with Vercel target validation/start/dispose where credentials are available.
- Gate: `vp check`, `vp run typecheck`, `vp run test`, `vp run e2e --project desktop-dev --grep @environments-deploy`. Credentialed Vercel ACs are maintainer-local with recorded UAT.
