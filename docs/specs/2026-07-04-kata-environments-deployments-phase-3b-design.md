---
type: Spec
title: "Kata Environments / Deployments Phase 3b — Railway cloud driver (Docker image, credential seeding)"
description: "Deep-dive for Phase 3b: the first BYOC cloud driver on Railway — provision a Railway Service from the published katacode GHCR image, public wss reachability via the Railway service domain, credential-file seeding from a host-side encrypted store, ephemeral deploy-on-start / delete-on-dispose lifecycle. Builds on Phase 3a (provider-ready image, terminal, auth model)."
status: Draft
tags: [specs, phase-3b, environments, deployments, sandbox, railway, cloud-driver, byoc, auth]
timestamp: 2026-07-04T00:00:00Z
---

# Kata Environments / Deployments Phase 3b — Railway cloud driver

## Status

Draft. Implements roadmap Phase 3b per [ADR 0006](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md). Builds on [Phase 3a](/specs/2026-07-04-kata-environments-deployments-phase-3a-design.md) (provider-ready image, in-container terminal, host credential bind-mounts, env-var auth). Cannot ship until Phase 3a is implemented and the katacode image is published to GHCR.

## Goal

A user configures a Railway deployment target in Settings → Environments with their Railway API token and a region, starts a session, and gets a Kata server running in a Railway Service from the published `ghcr.io/gannonh/kata-code:<tag>` image — reachable from every paired client over `wss` through the Railway service's public domain, with provider credentials seeded from the host-side encrypted store and the repo seeded and environment config executed exactly as the local Docker driver does it. Dispose deletes the Railway Service. The driver is a thin layer over the frozen `SandboxProvider` SPI; no SPI change.

## Source of truth

- Decision: [ADR 0006 — Sandbox provider auth model and Railway as the first cloud driver](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md)
- Master roadmap: [2026-06-27-kata-environments-deployments-design.md](/specs/2026-06-27-kata-environments-deployments-design.md)
- Phase 3a (prerequisite): [2026-07-04-kata-environments-deployments-phase-3a-design.md](/specs/2026-07-04-kata-environments-deployments-phase-3a-design.md)
- Frozen SPI: `packages/sandbox/src/SandboxProviderDriver.ts` (`validate`/`provision`/`exec`/`reachability`/`dispose`/`describe`; optional capabilities; `SandboxProviderError` reasons). **Phase 3b adds no required member.**
- Server orchestration: `apps/server/src/sandbox/SandboxService.ts` (`startSession` provision → seed/setup → Connect registration; idempotency guard; `disposeAfterFailure`), `apps/server/src/sandbox/sandboxSetupRunner.ts`, `environmentConfigLoader.ts`.
- Secret infra: `apps/server/src/serverSettings.ts` (`materializeSandboxProviderEnvironmentSecrets`), `apps/server/src/auth/ServerSecretStore.ts`.
- Web UI: `apps/web/src/components/settings/SandboxDeploymentSettings.tsx` (deployment-target card, sandbox start/dispose).
- Railway platform docs: [Services](https://docs.railway.com/services), [Volumes](https://docs.railway.com/volumes), [Private registries](https://docs.railway.com/builds/private-registries), [Sandboxes](https://docs.railway.com/sandboxes). Railway CLI: `railway` (the [use-railway](/.agents/skills/use-railway/SKILL.md) skill is the operational reference).
- Prior art (pattern reference only, AGENTS.md reference-repo policy): AgentBox `/Volumes/EVO/repos/agentbox`
  - `packages/sandbox-docker/src/claude-credentials.ts` — host backup + seed pattern: `CREDENTIALS_BACKUP_FILE`, `CODEX_CREDENTIALS_BACKUP_FILE`, `OPENCODE_CREDENTIALS_BACKUP_FILE`, `isRealAgentCredential`, `extractCloudAgentCredentials`.
  - `apps/cli/src/commands/_claude-login-worker.ts` — PTY-driven headless OAuth login worker (URL + code relay).
  - `packages/sandbox-vercel/src/backend.ts` — production cloud driver against the same SPI shape (pattern for provision/reachability/dispose, not for snapshot-bake which Railway does not need).

## Locked decisions

1. **`packages/sandbox-railway` implements the frozen SPI; no SPI change.** Required members (`validate`, `provision`, `exec`, `reachability`, `dispose`, `describe`) plus the optional capabilities the Railway Service primitive supports. The Railway Service (Docker image) primitive is a persistent process, not an ephemeral microVM, so the Vercel keepalive/lapse/resume UX from the superseded Phase 3 deep-dive does not apply. Dispose deletes the service.

2. **Provision creates a Railway Service from the published image ref.** The driver uses the Railway GraphQL API (`https://backboard.railway.com/graphql/v2`) or the Railway CLI to create a service in the configured project/environment with source = Docker Image, pointing at `ghcr.io/gannonh/kata-code:<tag>`. The tag is resolved from the deploying server's version (or a target-config override for pinned tags). The service is created with the sandbox instance's environment variables (provider API keys, `KATACODE_*` config) and the seeded credential files. `provision` resolves once the service is `RUNNING` and healthy (a healthz probe against the in-container Kata server's HTTP endpoint succeeds).

3. **Reachability advertises a `public` endpoint via the Railway service domain.** Railway assigns a public `<service>-<hash>.up.railway.app` domain with HTTPS + WebSocket to a service. The driver reads the assigned domain from the service and returns it as the `AdvertisedEndpoint` with `reachability: "public"`, `source: "server"`. No tunnel provisioning (unlike the Cloudflare plan); no `sandbox.domain(port)` (unlike Vercel). Connect auto-registration proceeds against this public endpoint exactly as the local Docker driver does against the loopback endpoint.

4. **Ephemeral lifecycle: deploy on start, delete on dispose.** `startSession` creates the Railway Service; `disposeSession` deletes it. No stop/resume, no keepalive, no snapshot. A Railway Volume may be mounted at `/home/katacode/.katacode` for session-state persistence across redeploys, but Phase 3b ships without Resume UX — a disposed sandbox is gone. Volume-retained resume is a deferred sub-phase.

5. **Credential seeding from a host-side encrypted store.** Phase 3b adds the AgentBox host-backup + seed pattern for cloud drivers:
   - A host-side encrypted store under `ServerSecretStore` holds provider credential files (`claude-credentials.json`, `codex-credentials.json`, `opencode-credentials.json`), captured once via an interactive in-sandbox login flow (decision 6).
   - At provision, the driver seeds the credential files into the container at the provider-expected paths (`/home/katacode/.claude/.credentials.json`, `/home/katacode/.codex/auth.json`, `/home/katacode/.config/opencode/auth.json`) via the Railway files API or by baking them into the service environment as base64 env vars decoded at container start. The seed values are redacted in logs.
   - If no credential is stored for a provider, the provider starts unauthenticated and surfaces its normal error. The user can then run the interactive login flow (decision 6) or use env-var API keys.

6. **Interactive "Sign in \<provider>" affordance on the sandbox card.** When a provider is unauthenticated in a running Railway sandbox and no credential is seeded, the sandbox card shows a "Sign in \<provider>" button. Clicking it opens a terminal session in the container, runs the provider's login command under a PTY, relays the OAuth URL + code to the web UI (the AgentBox `_claude-login-worker` pattern), and on success captures the resulting credential file back to the host-side encrypted store for future provisions. This is the cloud analogue of Phase 3a's host bind-mount.

7. **Auth: Railway API token via `ServerSecretStore`.** The deployment target stores a `RAILWAY_API_TOKEN` (account-scoped) or `RAILWAY_TOKEN` (project-scoped) via the existing sandbox-instance secret path. No OIDC, no interactive Railway login from the server. The user creates the token in the Railway dashboard and pastes it into the deployment-target config.

8. **An official katacode image is published to GHCR.** Phase 3b adds a publish step to the release pipeline (`release.yml` / `build:docker-image`) that pushes `ghcr.io/gannonh/kata-code:<version>` and `:latest` on release. The driver pulls the tag matching the deploying server's version. This is a hard prerequisite — the driver cannot pull a tag that does not exist.

## Verified Railway constraints

| Constraint                                                            | Consequence                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Railway Service supports pre-built Docker image as source             | Provision creates a service pointing at the GHCR image ref (decision 2)                     |
| Public service domain carries HTTPS + WebSocket                       | Reachability is a direct `public` endpoint; no tunnel (decision 3)                          |
| Ephemeral filesystem outside a mounted Volume                         | Session state needs a Volume mount or git-branch sync (roadmap's model)                     |
| Persistent service process model                                      | No keepalive/lapse/resume UX (decision 4); dispose = delete                                 |
| GraphQL API (`backboard.railway.com/graphql/v2`) for service creation | Driver uses GraphQL (the CLI does not support image-ref service creation)                   |
| `RAILWAY_API_TOKEN` / `RAILWAY_TOKEN` for headless auth               | Token-only auth (decision 7); no interactive Railway login from the server                  |
| Service creation + image pull + healthz probe takes 30-90s            | `provision` resolves on healthz success; `startSession` already supports long provision     |
| Region selection at project/environment level                         | Target config includes region; the driver creates the service in the configured environment |

## Acceptance criteria

1. **AC-3b.1** `packages/sandbox-railway` implements the frozen `SandboxProvider` SPI (required members; `describe()` advertises `reachabilityKind: "public"`, no `supportsSnapshot`, no `supportsRenewTimeout`). A type-level conformance test asserts the driver satisfies the interface.
2. **AC-3b.2** `validate` resolves a Railway API token from `ServerSecretStore` and confirms the configured project/environment is reachable (a GraphQL query against `backboard.railway.com/graphql/v2`). Invalid token or unreachable project returns a `SandboxRpcError` with `reason: "invalid-config"`.
3. **AC-3b.3** `provision` creates a Railway Service from `ghcr.io/gannonh/kata-code:<tag>` in the configured environment, sets the sandbox instance environment variables, seeds the stored credential files, and resolves once the in-container Kata server's healthz endpoint responds. A unit test covers the provision payload construction; a credentialed integration test (maintainer-local) covers the full provision against a real Railway project.
4. **AC-3b.4** `reachability` returns the Railway service's public domain as an `AdvertisedEndpoint` with `reachability: "public"`. A unit test covers the domain extraction from the service record.
5. **AC-3b.5** `dispose` deletes the Railway Service. A subsequent `listInstances` no longer reports a running session for that instance. A credentialed integration test confirms the service is gone.
6. **AC-3b.6** Starting a Railway sandbox session in the web UI provisions the service, Connect-auto-registers the public endpoint, and the sandbox appears under Environments in the left-rail Add project picker. The existing Phase 1/2 session-flow wiring (saved-environment registration via the returned pairing token) works unchanged. Manual UAT + an e2e test tagged `@environments-deploy` confirms.
7. **AC-3b.7** A second paired client (mobile or hosted web) reaches the Railway sandbox via the relay with no manual setup (AC-1.11 parity). Manual UAT confirms.
8. **AC-3b.8** With a stored Claude credential, a started Railway sandbox reports Claude as authenticated without any env-var configuration. A credentialed integration test or manual UAT confirms.
9. **AC-3b.9** With no stored credential for a provider, the sandbox card shows a "Sign in \<provider>" affordance. Clicking it opens a terminal, runs the provider's login command, relays the OAuth URL + code to the UI, and on success captures the credential to the host-side encrypted store. A manual UAT confirms for at least one OAuth-based provider (Claude or Codex).
10. **AC-3b.10** Disposing a Railway sandbox removes it from the Connect pool (the relay link lapses when the public origin becomes unreachable). A second paired client can no longer reach it. Manual UAT confirms.
11. **AC-3b.11** The release pipeline publishes `ghcr.io/gannonh/kata-code:<version>` and `:latest` on release. A CI job or manual release smoke confirms the image is pullable.
12. **AC-3b.12** `vp check`, `vp run typecheck`, and the `@environments-deploy` e2e suite pass. Credentialed Railway tests are maintainer-local with recorded UAT (no CI secret); the e2e suite covers the uncredentialed path (target config validation, error surfacing).

## Deferred work

- **Volume-retained resume for Railway sandboxes:** mount a Railway Volume at `/home/katacode/.katacode` and add a Resume affordance so a disposed-but-volume-retained sandbox can be re-provisioned with its session state. Future sub-phase; revisit when session-persistence demand surfaces.
- **Railway Sandbox VM primitive as an alternative driver:** the TS SDK (`@railwayapp/railway-ts-sdk`) exposes ephemeral VMs with checkpoints/forking/templates/SSH/exec. A future driver could target this for snapshot-resume semantics closer to the Vercel model. Deferred until the Railway Service driver proves the SPI fit and a user need for snapshots surfaces. The SDK is in Priority Boarding and may change.
- **Multi-region selection:** the target config includes a region field, but Phase 3b creates the service in the environment's configured region. Per-target region override is future.

## Build handoff

- New package: `packages/sandbox-railway` (driver implementation, GraphQL client, credential seeding helpers).
- Files to touch: `apps/server/src/sandbox/SandboxService.ts` (register the `railway` driver kind in the registry), `apps/server/src/serverSettings.ts` (materialize Railway token secrets), `apps/web/src/components/settings/SandboxDeploymentSettings.tsx` (Railway target config form, "Sign in \<provider>" affordance), `apps/web/src/components/chat/ProviderStatusBanner.tsx` (sign-in affordance for unauthenticated providers in a sandbox), `release.yml` / `build:docker-image` (GHCR publish step).
- Tests: `packages/sandbox-railway` unit tests (provision payload, reachability extraction, dispose, credential seeding); a credentialed integration test guarded by a `RAILWAY_API_TOKEN` env var (maintainer-local); extend `@environments-deploy` e2e with the Railway target-config + start/dispose flow.
- Gate: `vp check`, `vp run typecheck`, `vp run test`, `vp run e2e --project desktop-dev --grep @environments-deploy`. Credentialed Railway ACs (3b.3/5/8/9) are maintainer-local with recorded UAT.
- Prerequisite: Phase 3a implemented and the katacode image published to GHCR (AC-3b.11).
