---
type: Spec
title: Pi provider support in sandbox environments
description: Validate Pi end-to-end in Docker and Vercel sandboxes, fix what breaks, and remove Pi from the composer's sandbox "Coming Soon" dim set.
status: Draft
---

# Pi provider support in sandbox environments

## Status

Draft

## Goal

Make Pi selectable and functional in sandbox environments (Docker and Vercel). Today the composer dims Pi with a "Coming soon to sandboxes" tooltip whenever the active thread is on a sandbox environment. The infrastructure for running Pi in a sandbox already exists; this spec covers validating it end-to-end, fixing whatever validation surfaces, and removing the client-side gate.

## Background

Pi is an in-process SDK provider: the in-sandbox `katacode serve` loads `@earendil-works/pi-coding-agent` directly (unlike Codex/Claude, which spawn a CLI subprocess). Both sandbox provisioning paths already install the SDK:

- **Docker image:** `Dockerfile` installs `@earendil-works/pi-coding-agent` alongside the other provider CLIs.
- **Vercel bootstrap:** `packages/sandbox-vercel/src/bootstrap.ts` installs it pinned to `PI_SDK_PIN = "0.80.2"`. Pi 0.80.8 removed the root `AuthStorage` export; an unpinned install resolves a Pi build that crashes `katacode serve` at module load.

Credential seeding for `~/.pi/agent` already exists in `apps/server/src/sandbox/credentialSeed.ts`: it copies `auth.json`, excludes host-local caches/install trees, and sanitizes `settings.json` by stripping the `packages` list so the in-container SDK does not attempt to `npm install` host extensions with platform-specific binaries.

The only hard gate is client-side: `sandboxUnsupportedKinds` in `apps/web/src/components/chat/ChatComposer.tsx` (~line 669) includes `"pi"`, which dims Pi in the model picker whenever `isSandboxEnvironment` is true. Pi was gated preemptively; end-to-end sandbox behavior has not been validated.

## Design

Three sequential phases.

### Phase 1 — Validation (manual UAT)

Manually validate Pi in both sandbox kinds with host Pi credentials present. To make Pi selectable during validation, temporarily bypass the client gate locally (do not commit the un-gate until validation passes).

Validation matrix, per sandbox kind (Docker and Vercel):

1. Provision a sandbox from a host with `~/.pi/agent/auth.json` present.
2. Pi instance appears authenticated in the in-sandbox provider list.
3. Runtime model discovery returns models from the seeded auth.
4. A Pi turn streams to completion (assistant text and reasoning deltas).
5. Tool calls execute against `/workspace`.
6. Interrupt/stop works mid-turn.
7. Thread resume works after the session is re-opened.

Degraded-path check (either sandbox kind): provision from a host **without** Pi credentials. Pi shows as unauthenticated in the sandbox; the provider probe does not hang or crash, and other providers are unaffected.

Capture evidence (screenshots or session transcripts) for each matrix row and record it in the build report.

### Phase 2 — Fixes

Fix whatever Phase 1 surfaces. Known candidate failure areas:

- **Seeded settings sanitization gaps:** `sanitizePiSettings` only strips `packages`; other host-only paths in `settings.json` may break the in-container SDK.
- **Probe timeouts:** the provider status probe has a 10s budget; SDK startup work in the container could exceed it.
- **`PI_SDK_PIN` staleness:** Vercel sandboxes run Pi 0.80.2 while the host may run newer. If validation hits pin-related breakage (e.g. seeded auth or settings written by a newer host Pi that 0.80.2 cannot read), the fix is publishing a kata CLI built against the current Pi API and removing the pin. If that happens, the pin removal becomes a prerequisite of this spec rather than a side effect.

Every code fix ships with unit tests.

### Phase 3 — Un-gate

Remove `ProviderDriverKind.make("pi")` from `sandboxUnsupportedKinds` in `ChatComposer.tsx` and update the adjacent comment. OpenCode and Cursor remain dimmed; their tooltip logic is unchanged.

## Non-goals

- **In-sandbox Pi login flow.** Auth relies on host credential seeding only. Cloud-only sandboxes without host Pi credentials show Pi as unauthenticated. Adding a Pi entry to `apps/server/src/sandbox/providerLogin.ts` is future work.
- **Cursor tooltip fix.** The inaccurate "not enabled" Cursor tooltip is out of scope; file it as deferred work.
- **OpenCode or Cursor sandbox support.**
- **Server-driven sandbox-capability contract.** The dim set stays a client-side hardcoded set. A `sandboxSupported` provider capability in contracts is future work if the set churns.
- **Sandbox E2E automation for Pi.** Sandbox provisioning requires live infra and long provision times that do not fit the local E2E harness. Validation is manual with documented evidence.

## Acceptance criteria

- **AC-1:** Pi is selectable in the composer for sandbox environments (no dim, no "Coming soon" tooltip).
- **AC-2:** A Pi turn streams to completion in a Docker sandbox and in a Vercel sandbox, with evidence captured in the build report.
- **AC-3:** Interrupt/stop works mid-turn on a Pi sandbox session, with evidence captured.
- **AC-4:** With no host Pi credentials, Pi shows as unauthenticated in the sandbox without blocking the provider probe or other providers.
- **AC-5:** `vp check` and `vp run typecheck` pass; every code change from Phase 2 has unit test coverage.

## Affected surfaces

| Surface            | Path                                            | Change                                         |
| ------------------ | ----------------------------------------------- | ---------------------------------------------- |
| Composer gate      | `apps/web/src/components/chat/ChatComposer.tsx` | Remove `"pi"` from `sandboxUnsupportedKinds`   |
| Credential seeding | `apps/server/src/sandbox/credentialSeed.ts`     | Fixes only if Phase 1 surfaces gaps            |
| Vercel bootstrap   | `packages/sandbox-vercel/src/bootstrap.ts`      | Only if `PI_SDK_PIN` must move                 |
| Docker image       | `Dockerfile`                                    | Only if the installed Pi package needs changes |

## Risks

- **`PI_SDK_PIN` scope creep:** if the pin is the blocker, the spec inherits a kata CLI publish built against the current Pi API. This is the main schedule risk and is called out in Phase 2 so it is decided explicitly, not absorbed silently.
- **Host/container Pi version skew:** seeded auth or settings written by a newer host Pi may not be readable by the pinned container Pi. Validation covers this via the live matrix.
