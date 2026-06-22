---
type: Reference
title: "Deferred work registry"
description: "Review queue for work intentionally deferred from specs so future planning can revisit, promote, or close it."
tags: [specs, roadmap, deferred-work, planning]
timestamp: 2026-06-18T00:00:00Z
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
