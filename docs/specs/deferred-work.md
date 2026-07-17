---
type: Reference
title: "Deferred work registry"
description: "Review queue for work intentionally deferred from specs so future planning can revisit, promote, or close it."
tags: [specs, roadmap, deferred-work, planning]
timestamp: 2026-06-29T00:00:00Z
---

# Deferred work registry

Use this registry for work that a spec intentionally leaves out but future planning should revisit. Keep entries short, source-linked, and actionable.

## Entry format

Each entry should include:

- **Status:** `deferred`, `planned`, `accepted`, or `closed`
- **Area:** product or technical area
- **Source:** spec, ADR, roadmap, runbook, or PR that deferred the work
- **Rationale:** why it was deferred
- **Revisit trigger:** when future planning should review it
- **Notes:** current context or next decision needed

## Review workflow

- When writing a spec, include an `## Explicitly deferred work` section.
- If a deferred item should survive beyond that spec, add or update an entry here.
- During `/okf update`, review entries related to changed areas and either keep them deferred, promote them to planned work, mark them accepted into an active spec, or close them with rationale.
- Do not use this registry for speculative ideas without a source. Use the product backlog or a new spec when direction is not tied to a deferral.

## Deferred / review queue

### Live Waiting chip E2E for sidebar state detection

- **Status:** deferred
- **Tracking issue:** [#39](https://github.com/gannonh/kata-code/issues/39)
- **Area:** sidebar, orchestration, e2e
- **Source:** [Shell attention-state detection](/specs/2026-07-16-sidebar-v2-state-detection-design.md) (Phase D, AC10)
- **Rationale:** Live approval/Ask prompts are not deterministically forceable in current `@agent` harness; projection tests gate ship. Avoid flaky real-LLM CI for Waiting chips.
- **Revisit trigger:** When a deterministic provider fixture or scripted adapter can open approval/Ask prompts in desktop-dev E2E.
- **Notes:** Maintainer UAT against real projects remains the interim evidence path.

### Vercel source-selection and worktree Electron E2E

- **Status:** accepted
- **Tracking issue:** [#32](https://github.com/gannonh/kata-code/issues/32)
- **Area:** sandbox, vercel, web, testing
- **Source:** [Vercel GitHub repository and branch seeding](/specs/2026-07-10-vercel-github-source-seeding-design.md) (AC-GS5, AC-GS13, AC-GS14)
- **Rationale:** The E2E harness spawns its own isolated stack and the Vercel path is maintainer-local UAT with no CI secret. The tagged `@environments-deploy` specs are authored in [`e2e/tests/environments-deploy/vercel-deploy.spec.ts`](../../e2e/tests/environments-deploy/vercel-deploy.spec.ts): they drive repository + branch selection, assert the selected branch is a New worktree base ref, and assert locked source controls, but stay credential-gated (`E2E_VERCEL_*` + `E2E_VERCEL_SOURCE_REPOSITORY`) so CI skips them.
- **Revisit trigger:** When a credentialed Vercel E2E lane runs in CI, or before release sign-off record the maintainer-local run.
- **Notes:** Remaining work is a maintainer-local execution with the Vercel trio and an accessible GitHub source, plus recorded evidence. The specs and shared flow helpers already exist.

### Vercel source picker component tests

- **Status:** deferred
- **Tracking issue:** [#31](https://github.com/gannonh/kata-code/issues/31)
- **Area:** sandbox, vercel, web, testing
- **Source:** [Vercel GitHub repository and branch seeding](/specs/2026-07-10-vercel-github-source-seeding-design.md) (AC-GS3, AC-GS13)
- **Rationale:** `VercelSourcePicker` shipped with logic-level and static-markup coverage. Interactive combobox behavior and discovery RPC wiring need a component-test harness that mocks the sandbox client.
- **Revisit trigger:** Next settings component-test pass, or when the picker changes.
- **Notes:** Assert discovery RPCs fire on open, branch initializes from the repo default, loading/empty/error status renders, Load more paginates, and locked disables both triggers.

### Vercel sandbox orchestration tests (GitHub source path)

- **Status:** deferred
- **Tracking issue:** [#30](https://github.com/gannonh/kata-code/issues/30)
- **Area:** sandbox, vercel, server, testing
- **Source:** [Vercel GitHub repository and branch seeding](/specs/2026-07-10-vercel-github-source-seeding-design.md) (AC-GS9, AC-GS11, AC-GS12)
- **Rationale:** `SandboxService.startSession` Vercel orchestration needs a materialized Vercel driver, Connect finalization context, and a live-ish sandbox. The underlying units are covered; a `startSession` driver-fake harness is separate test infrastructure.
- **Revisit trigger:** When a Vercel driver-fake `startSession` harness is built.
- **Notes:** Assert reject-local-repo, source-required, dispose-on-setup-failure, start-from-stopped fingerprint mismatch, and `seedGitHubAuth` token redaction.

### Docker GitHub remote-source seeding

- **Status:** deferred
- **Tracking issue:** [#29](https://github.com/gannonh/kata-code/issues/29)
- **Area:** sandbox, docker, source-control
- **Source:** [Vercel GitHub repository and branch seeding](/specs/2026-07-10-vercel-github-source-seeding-design.md)
- **Rationale:** The approved source-selection work targets Vercel native Git source. Docker retains its established local-worktree archive seed path so the feature does not introduce two provisioning redesigns together.
- **Revisit trigger:** When a separately approved Docker source-selection and provisioning design is scheduled.
- **Notes:** Define Docker repository/branch UX, local-versus-remote seed behavior, GitHub credential handling, lifecycle semantics, migration path, automated coverage, and maintainer validation without regressing local Docker deployment.

### Pi provider full adapter parity

- **Status:** closed
- **Area:** providers, pi, agent-runtime
- **Source:** [Pi coding agent provider support](/specs/2026-06-25-pi-coding-agent-support-design.md)
- **Rationale:** The approved build shipped a verified vertical slice (snapshot discovery, session start/send/stream/interrupt/stop, driver registration, gated `@pi` e2e). Full parity was sequenced after the slice to keep each capability independently verifiable.
- **Revisit trigger:** Before marking the Pi spec complete or before Pi is promoted out of early-access status.
- **Notes:** Completed 2026-06-27 on `feat/pi-phase2`. AC 5 (tool lifecycle, image attachments, resume cursor, readThread, rollback), AC 6 (`compactThread` + canonical `thread.state.changed` compaction lifecycle), AC 8 (extension UI bridge), AC 9 (runtime mode warnings), AC 10 (project trust surfacing), AC 11/12 (real `PiTextGeneration` parity), AC 13 (instance isolation), AC 14 (existing-provider regression) all implemented and verified, including AC 15 (covered by the credentialed `@pi` E2E and `e2e/verify-evidence/` screenshots). See the [Build completion report](/specs/2026-06-25-pi-coding-agent-support-design.md#build-completion-report).

### Pi provider validation (AC 15)

- **Status:** closed
- **Area:** providers, pi, testing, validation
- **Source:** [Pi coding agent provider support](/specs/2026-06-25-pi-coding-agent-support-design.md#acceptance-criteria)
- **Rationale:** AC 15 requires evidence that a Pi instance appears in settings, a runtime-discovered model can be selected, a Pi prompt streams, and interrupt/stop works.
- **Revisit trigger:** None. Resolved 2026-06-27 on `feat/pi-phase2`.
- **Notes:** Resolved. The credentialed `@pi` E2E (`e2e/tests/agent/pi-smoke.spec.ts`, `e2e/tests/settings/pi-provider.spec.ts`, gated by `KATACODE_E2E_ENABLE_PI`/`KATACODE_E2E_PI_AGENT_DIR`/`KATACODE_E2E_PI_MODEL`) configures Pi in settings, selects a runtime-discovered model, streams a response, and exercises interrupt/stop. The [`e2e/verify-evidence/README.md`](../../e2e/verify-evidence/README.md) screenshots map the settings, model-picker, streaming, and interrupt surfaces to AC 15. No manual maintainer step remains.

### Pi compaction transport + UI surface

- **Status:** deferred
- **Tracking issue:** [#16](https://github.com/gannonh/kata-code/issues/16)
- **Area:** providers, pi, orchestration, ui
- **Source:** [Pi coding agent provider support](/specs/2026-06-25-pi-coding-agent-support-design.md#build-completion-report)
- **Rationale:** `ProviderService.compactConversation` is wired (mirroring `rollbackConversation`'s internal-caller pattern) but no orchestration `thread.compact` command + reactor or web/desktop UI surface invokes it yet.
- **Revisit trigger:** When compaction is exposed in the Kata UI (web/desktop), mirroring the `thread.checkpoint.revert` → `rollbackConversation` precedent.
- **Notes:** Add a `thread.compact` orchestration command + `CheckpointsReactor`-style reactor that calls `providerService.compactConversation`. The adapter already emits the canonical `thread.state.changed`/`compacted` lifecycle events.

### Pi provider strict quality review follow-ups

- **Status:** deferred
- **Tracking issue:** [#14](https://github.com/gannonh/kata-code/issues/14)
- **Area:** providers, pi, code-quality, testing
- **Source:** [GitHub issue #14](https://github.com/gannonh/kata-code/issues/14), strict-quality-review carried into `feat/pi-phase2`
- **Rationale:** Low-severity findings from the strict quality review. Blockers (duplicate `turn.completed`, orphaned items), high-priority issues (stop/restart asymmetry, unsupervised fiber, dead `projectTrustPolicy` config, `withInstanceIdentity` duplication), and medium-priority issues (`makeEvent` type safety, `resolveModel` test-override leak, dead `turns` state) were all fixed in the same pass. These remaining items are cosmetic, pre-existing cross-cutting patterns, or forward-looking contract surface.
- **Revisit trigger:** Before Pi is promoted out of early-access, or during the next provider-layer refactor sprint.
- **Notes:** Branch finalize pass (`f8c2b5f5f`) extracted `piRuntimeWarning` in `PiAdapter.ts` to dedupe `runtime.warning` scaffolding. Eight low-severity items remain: L1 PiProvider timeout-branch test, L2 disabled-branch `buildServerProvider` duplication across all providers, L3 `mapPiModels` bespoke dedup, L4 `DateTime.nowUnsafe()` testability, L5 `piTurnFailure` case-sensitivity, L6 unused `TextGenerationProvider` type, L7 `"pi.sdk.event"` literal with no producer, L8 `ThreadErrorBanner.tsx` PR scope.

### Production Relay Deploy

- **Status:** closed
- **Area:** relay, infrastructure, release
- **Source:** [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md), [Phase 2 desktop/web release design](/specs/2026-06-16-phase-2-desktop-web-release-design.md), [specs roadmap](/specs/index.md), `.github/disabled/README.md`
- **Rationale:** Deferred from the desktop/web release split until fork-owned relay infrastructure and secrets are ready.
- **Revisit trigger:** Build and Verify [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md); close after implementation and UAT evidence are complete.
- **Notes:** Completed 2026-06-19. Production relay deployed via [deploy-relay.yml](https://github.com/gannonh/kata-code/actions/runs/27798366259). Nightly runtime regressions (asar native libs, x64 cross-arch packaging) fixed. Connect UAT passed: sign-in, linked environment visible, tunnel started, hosted web connected.

### CI automation for full relay link/connect smoke

- **Status:** deferred
- **Area:** relay, testing, infrastructure
- **Source:** [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md)
- **Rationale:** Full link/connect automation requires a live environment process, Clerk identity, DNS/tunnel provisioning, signed-in client behavior, and cleanup.
- **Revisit trigger:** Review after first successful manual production Relay Deploy UAT.
- **Notes:** Manual UAT for link/connect/unlink is required by the Relay Deploy spec; this item tracks later CI automation only.

### CI-managed developer relay stages

- **Status:** deferred
- **Area:** relay, infrastructure, developer-experience
- **Source:** [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md)
- **Rationale:** Initial GitHub Actions scope is production-only; personal stages remain local CLI-driven.
- **Revisit trigger:** Review when multiple maintainers need shared non-production relay stages.
- **Notes:** Do not add a stage input to the initial production deploy workflow.

### APNs optionalization for relay deploy

- **Status:** deferred
- **Area:** relay, mobile, infrastructure
- **Source:** [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md)
- **Rationale:** Current relay stack expects APNs config, and initial production deploy should prove the full existing stack.
- **Revisit trigger:** Review if product direction requires relay deployments without mobile notification support.
- **Notes:** Relay Deploy requires APNs vars and secrets.

### Mobile EAS preview and production release

- **Status:** deferred
- **Area:** mobile, release, infrastructure
- **Source:** [fork setup spec](/specs/fork-setup.md), `.github/disabled/README.md`
- **Rationale:** Requires fork Expo project ownership and production-ready EAS credentials.
- **Revisit trigger:** Review after Relay Deploy is implemented or before any mobile release planning.
- **Notes:** Known required values include `KATACODE_EAS_PROJECT_ID` and `EXPO_OWNER`.

### Marketing release and Connect pages

- **Status:** deferred
- **Area:** marketing, release, product
- **Source:** [Phase 2 desktop/web release design](/specs/2026-06-16-phase-2-desktop-web-release-design.md), [specs roadmap](/specs/index.md)
- **Rationale:** Excluded from the desktop/web release split and Relay Deploy planning so infrastructure work can remain independently verifiable.
- **Revisit trigger:** Review before public Connect launch, release download page work, or marketing site deployment work.
- **Notes:** Keep release/download surfaces aligned with hosted web and desktop artifact channels.

### Connect: open signups (waitlist off)

- **Status:** deferred
- **Area:** connect, relay, auth
- **Source:** relay UAT 2026-06-19
- **Rationale:** New sign-ups are currently being rejected. The relay or Clerk config is set to waitlist/restricted mode. Accepting new users requires flipping the signup gate.
- **Revisit trigger:** Before any public Connect announcement or invite expansion.
- **Notes:** Determine whether the gate lives in Clerk (sign-up restrictions), the relay waitlist logic, or both, and flip it to open enrollment.

### Connect: stale relay link on account switch

- **Status:** deferred
- **Area:** connect, desktop, relay
- **Source:** relay UAT 2026-06-19
- **Rationale:** Discovered during UAT when switching between Google accounts; the relay link from the first account persisted and the new account's `listEnvironments` returned empty.
- **Revisit trigger:** Before stable release or public Connect launch.
- **Notes:** On sign-out, revoke the relay link for the departing `cloudUserId` before clearing credentials. On sign-in, detect that `cloudUserId` changed and re-link under the new user.

### CI integration for local Electron E2E

- **Status:** deferred
- **Area:** testing, desktop, CI
- **Source:** [Local Electron E2E testing foundation design](/specs/2026-06-21-e2e-testing-foundation-design.md)
- **Rationale:** V1 is local-only; tests require macOS GUI session, real Clerk credentials, Google test user, and provider API keys unsuitable for default PR CI.
- **Revisit trigger:** Review when dedicated macOS E2E runners, secret management, and stable test accounts exist.
- **Notes:** `.github/workflows/ci.yml` must not invoke E2E scripts until an explicit CI spec approves gating.

### Release-target E2E validation (`desktop-release`)

- **Status:** deferred
- **Area:** testing, desktop, release
- **Source:** [Local Electron E2E testing foundation design](/specs/2026-06-21-e2e-testing-foundation-design.md)
- **Rationale:** Dev-target headed verification passed for starter tags; release smoke/settings against a built `.app` depends on maintainer-local `KATACODE_E2E_RELEASE_APP`.
- **Revisit trigger:** Before nightly desktop promotion or when release artifact paths are standardized in CI/release runbooks.
- **Notes:** Prerequisite gate verified (`KATACODE_E2E_RELEASE_APP` fails loudly when unset). Nightly commands documented in [e2e/README](../../e2e/README.md).

### Sandbox: reclaim orphaned containers on server restart

- **Status:** deferred
- **Area:** sandbox, server, docker
- **Source:** strict quality review of `feat/kata-cloud` — [#18](https://github.com/gannonh/kata-code/issues/18)
- **Rationale:** Phase 1 session tracking is in-memory (`runningSessions` in `apps/server/src/sandbox/SandboxService.ts`). Server restart resets the map while Docker containers keep running, orphaning `kata.sandbox=true` labeled containers. `AutoRemove` and labels bound the leak but no startup sweep exists. Fixing it expands Phase 1 scope past its acceptance criteria.
- **Revisit trigger:** Before Phase 3 extends the driver registry beyond Docker, or before any non-developer user relies on deployment sessions.
- **Notes:** On startup, list `kata.sandbox=true` containers and re-adopt or dispose them by `kata.sandbox.instance` id.

### Sandbox: share Docker config schema between web UI and driver

- **Status:** deferred
- **Area:** sandbox, web, contracts
- **Source:** strict quality review of `feat/kata-cloud` — [#19](https://github.com/gannonh/kata-code/issues/19)
- **Rationale:** `DockerConfigFields` in `apps/web/src/components/settings/SandboxDeploymentSettings.tsx` duplicates the `providerSettingsForm` annotations on `DockerSandboxConfig` (`packages/sandbox-docker/src/config.ts`) because the web cannot import the server-only driver package. The definitions are in sync today but will drift when a field is added. Moving the schema into `packages/sandbox-contracts` and rendering via `ProviderSettingsForm` is a contracts-boundary change out of Phase 1 scope.
- **Revisit trigger:** Before adding a new Docker config field (e.g. `memory`, `cpus`), or during the Phase 2 sandbox config refactor.
- **Notes:** Suggested home `packages/sandbox-contracts/src/dockerConfig.ts`; render via the existing `ProviderSettingsForm`.

### Sandbox: Connect managed-tunnel origin must use container port

- **Status:** deferred
- **Area:** sandbox, relay, cloud
- **Source:** chatgpt-codex-connector review of `feat/kata-cloud` PR #20 (P1) — [#21](https://github.com/gannonh/kata-code/issues/21)
- **Rationale:** `registerSandboxWithConnect` (`apps/server/src/sandbox/SandboxService.ts`) derives the relay link proof `origin.localHttpPort` from the host-published endpoint port, but the managed tunnel ingress (set from that origin in `infra/relay/src/environments/ManagedEndpointProvider.ts`) routes to `http://<host>:<port>` as seen by cloudflared inside the container, where the Kata server listens on the container port. The container-side `isAllowedEndpointOrigin` validation requires the origin port to match the incoming request URL port (host-published), which conflicts with the container-internal port the tunnel needs. Fixing it requires an architecture decision on sandbox origin attestation that touches the shared relay linking contract.
- **Revisit trigger:** Before end-to-end sandbox Connect pairing UAT (paired client reaching the in-container server through the managed tunnel), or when reviewing the relay managed-endpoint origin contract.
- **Notes:** See [#21](https://github.com/gannonh/kata-code/issues/21) for the two candidate approaches.

### Sandbox: surface pairing URL and token in deployment target UI

- **Status:** deferred
- **Area:** sandbox, web, contracts, connect
- **Source:** Phase 2 Verify UAT — [#23](https://github.com/gannonh/kata-code/issues/23)
- **Rationale:** The pairing URL and token are not rendered in the web UI. A user who wants to pair an external client must inspect container logs. Out of Phase 2 scope (environment configuration and setup execution); fits Phase 4 (composer "Run on" / cross-device connecting).
- **Revisit trigger:** Phase 4 composer work, or as a quick win if pairing is needed before Phase 4.
- **Notes:** `SandboxStartSessionResult` now returns `pairingToken` for local saved-environment registration; still render a user-facing pairing URL/token on the deployment card.

### Sandbox: HTTP pairing URL triggers browser security warning

- **Status:** deferred
- **Area:** sandbox, relay, connect, security
- **Source:** Phase 2 Verify UAT — [#24](https://github.com/gannonh/kata-code/issues/24)
- **Rationale:** The in-container `katacode serve` listens on HTTP (no TLS in the container). The relay tunnel provides HTTPS for remote clients, but the local pairing URL remains HTTP and triggers a browser security warning. Fixing requires TLS termination in-container or always routing through the relay tunnel — an architecture decision outside Phase 2 scope.
- **Revisit trigger:** Before end-to-end sandbox Connect pairing UAT, or when the pairing URL is surfaced in the UI (#23) and the HTTPS relay URL should be preferred.
- **Notes:** Related to [#23](https://github.com/gannonh/kata-code/issues/23). Once the pairing URL is in the UI, prefer the relay HTTPS endpoint as the primary pairing surface.

### Sandbox: interactive "Sign in <provider>" affordance on the sandbox card

- **Status:** closed
- **Area:** sandbox, web, auth, cloud
- **Source:** [Phase 3a deep-dive](/specs/2026-07-04-kata-environments-deployments-phase-3a-design.md) — [ADR 0006](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md) (provider-auth model), [ADR 0007](/adrs/0007-vercel-sandbox-first-cloud-sandbox-driver.md) (Phase 3b provider choice)
- **Rationale:** Phase 3b implemented a bounded provider-login session with OAuth URL/code relay, credential capture in `ServerSecretStore`, cancellation, and cleanup.
- **Revisit trigger:** None. Credentialed Vercel UAT remains a release-evidence task.
- **Notes:** Completed 2026-07-09. `ProviderSignInDialog` starts, submits to, and cancels the instance-bound provider-login RPC; stored credentials seed future deployments.

### Sandbox: volume-retained resume for Railway Service cloud sandboxes

- **Status:** closed (superseded)
- **Area:** sandbox, railway, cloud
- **Source:** [Phase 3b deep-dive](/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md) — [ADR 0006](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md) (superseded by [ADR 0007](/adrs/0007-vercel-sandbox-first-cloud-sandbox-driver.md))
- **Rationale:** The Railway Service (Docker image) driver was superseded by Vercel Sandbox as the first cloud sandbox driver per ADR 0007. Vercel Sandbox has persistent filesystem snapshots by default and an explicit snapshot/resume lifecycle, so the Railway Volume-retained resume concept is no longer applicable to the active Phase 3b plan.
- **Revisit trigger:** If a Railway Service driver is implemented as a future service-deploy target.
- **Notes:** ADR 0007's Vercel Sandbox model handles persistence through snapshot-backed filesystems and `Sandbox.getOrCreate` resume, not volume mounts.

### Sandbox: Railway Sandbox VM primitive as an alternative driver

- **Status:** deferred
- **Area:** sandbox, railway, cloud
- **Source:** [Phase 3b deep-dive](/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md) — [ADR 0007](/adrs/0007-vercel-sandbox-first-cloud-sandbox-driver.md)
- **Rationale:** Railway also exposes a Sandbox VM primitive via the TS SDK (`@railwayapp/railway-ts-sdk`) with ephemeral lifecycle, checkpoints, forking, templates, SSH, and an exec API. A future driver could target this for snapshot-resume semantics. Vercel Sandbox was selected as the first cloud sandbox driver per ADR 0007; Railway Sandbox remains in the future-drivers list to revisit after Vercel validates the SPI shape or when Railway-native workflows become a near-term priority. The SDK is in Priority Boarding and may change.
- **Revisit trigger:** After Vercel Sandbox validates the SPI shape, or when Railway Sandbox stabilizes.
- **Notes:** Railway Sandboxes docs: https://docs.railway.com/sandboxes. The `use-railway` skill references the sandbox CLI in `references/sandbox.md`.

### Sandbox: publish official katacode image to GHCR

- **Status:** deferred
- **Area:** sandbox, release, cloud
- **Source:** [Phase 3b deep-dive](/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md) — [ADR 0007](/adrs/0007-vercel-sandbox-first-cloud-sandbox-driver.md)
- **Rationale:** The Vercel Sandbox driver provisions from a runtime, VCR image, or prepared snapshot — not from a published Docker image ref. The official GHCR image publish requirement from the Railway Service plan is no longer a Phase 3b prerequisite. A VCR image pipeline may still be added if measured cold-start or setup time justifies it. The image remains useful for local Docker sandboxes and future Railway Service/E2B/Hetzner drivers.
- **Revisit trigger:** When a VCR production image pipeline is needed for Vercel cold-start optimization, or when a future driver requires a published image ref.
- **Notes:** Closer to the future managed Kata Cloud product than to BYOC; the official image is the first step toward a managed registry. The `Dockerfile` with provider CLIs baked in during Phase 3a remains the local Docker provision unit.

### Sandbox: durable RunningSession reclamation across server restarts

- **Status:** closed
- **Area:** sandbox, lifecycle, reliability
- **Source:** [Phase 3b plan](/specs/2026-07-04-kata-environments-deployments-phase-3b-plan.md) — Build completion report, risk #6; [Phase 3b deep-dive](/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md)
- **Rationale:** The lifecycle implementation persists non-secret session records in `SandboxSessionStore`, reconciles them on startup, and recovers configured provider sandboxes by instance id.
- **Revisit trigger:** None.
- **Notes:** Completed 2026-07-09. The store is bound to the resolved server state directory, reconciles through provider lifecycle status, and unlinks relay state for confirmed-gone records.
