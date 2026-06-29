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
