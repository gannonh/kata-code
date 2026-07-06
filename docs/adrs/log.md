# ADR log

## 2026-07-06 (ADR 0006 — credential model implementation note)

Updated [ADR 0006](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md) consequences to record that Phase 3a implementation pivoted the local-Docker credential model from bind-mounts to copy+sanitize (`credentialSeed.ts` + `ustarWriter.ts`) after bind-mounts leaked host-absolute paths into the container. The ADR's auth model (local credential access + cloud credential-file seeding + env-var alternative) is unchanged; only the local implementation detail evolved. See the [Phase 3a spec — Credential model deviation](/specs/2026-07-04-kata-environments-deployments-phase-3a-design.md#credential-model-deviation).

## 2026-07-05 (ADR 0007 — Vercel Sandbox first cloud sandbox driver)

- Added [ADR 0007 — Vercel Sandbox as the first cloud sandbox driver](/adrs/0007-vercel-sandbox-first-cloud-sandbox-driver.md): supersedes [ADR 0006](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md) for the Phase 3b provider choice, keeps ADR 0006's provider-auth model, and selects Vercel Sandbox because its Firecracker microVM, persistent snapshot/resume, `sandbox.domain(port)`, `extendTimeout`, and command/file APIs better match Kata's task-sandbox shape than Railway Service. Railway Sandbox, Railway Service, E2B, Daytona, and Hetzner move to future provider evaluation.

## 2026-07-04 (ADR 0006 — sandbox provider auth model + Railway first cloud driver)

- Added [ADR 0006 — Sandbox provider auth model and Railway as the first cloud driver](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md): adopts the AgentBox provider-auth pattern (bind-mount host credential dirs for local Docker, seed credential files from a host-side encrypted store for cloud, env-var API keys as an alternative) and selects Railway Service (Docker image) as the first cloud driver. Supersedes [ADR 0005](/adrs/0005-vercel-first-cloud-driver.md); Vercel moves to the future-drivers list. Splits Phase 3 into 3a (Docker sandbox gaps: provider CLIs in the image, in-container terminal fix + error surfacing, host credential bind-mounts) and 3b (Railway cloud driver: published GHCR image, credential seeding, public wss via Railway service domain, ephemeral deploy/delete lifecycle). Driven by the gaps surfaced while closing the sandbox session flow: the sandbox container is a fresh host with no provider CLIs and no credentials, and the in-container terminal was broken with errors swallowed by the UI.

## 2026-07-03 (ADR 0005 — Vercel first cloud driver)

- Added [ADR 0005 — Vercel Sandbox as the first cloud driver](/adrs/0005-vercel-first-cloud-driver.md): reverses the Phase 3 driver order in the [Environments/Deployments roadmap](/specs/2026-06-27-kata-environments-deployments-design.md). Vercel's `sandbox.domain(port)` public URL carries `wss` (live-verified in the AgentBox checkout), deleting the Cloudflare tunnels spike and its re-plan branch; Cloudflare moves to the future-drivers list. Session-lifetime handling (keepalive, lapse/resume UX) becomes a first-class Phase 3 requirement.

## 2026-06-24 (ADR 0004 promoted; ADR 0003 superseded)

- Promoted [ADR 0004 — Selective vendor-pull](/adrs/0004-selective-vendor-pull.md) to the active upstream strategy; moved [ADR 0003](/adrs/0003-episodic-upstream-sync.md) to Superseded in the [ADR index](/adrs/index.md).
- Reconciled the OKF bundle and [FORK.md](../../FORK.md) to the accepted decision after the first episodic bulk-merge attempt (branch `upstream-sync-2026-06-20`) stalled without landing. Rationale: [strategy analysis](/specs/2026-06-21-upstream-sync-strategy-analysis.md) (Option D adopted).

## 2026-06-20 (drop upstream-T3 migration)

- Updated [ADR 0002](/adrs/0002-katacode-product-identity.md) consequences: removed the `~/.t3` startup warning and migration affordance. Kata Code is a hard fork with no upstream-state migration; the legacy-T3 branding constants and `warnLegacyHomeDirectoryIfNeeded` were deleted.

## 2026-06-17 (episodic upstream sync)

- Added [ADR 0003 — Episodic upstream sync and fork independence](/adrs/0003-episodic-upstream-sync.md); cross-linked from [ADR 0001](/adrs/0001-connected-fork-upstream-merge.md).

## 2026-06-17 (release + brand icons)

- Updated [ADR 0002](/adrs/0002-katacode-product-identity.md) consequences: active `release.yml` and hosted web; production icons on all channels; relay/EAS still disabled.

## 2026-06-16 (Phase 1 consequences)

- Updated [ADR 0002](/adrs/0002-katacode-product-identity.md) consequences: `~/.t3` migration warning, hosted pairing domains, disabled release workflows vs active PR CI.

## 2026-06-16

- Added [ADR 0001 — Connected fork with upstream merge](/adrs/0001-connected-fork-upstream-merge.md).
- Added [ADR 0002 — Kata Code product identity](/adrs/0002-katacode-product-identity.md).
