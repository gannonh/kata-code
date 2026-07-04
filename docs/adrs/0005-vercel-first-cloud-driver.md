---
type: ADR
title: "Vercel Sandbox as the first cloud driver"
description: "Reverse the Phase 3 cloud driver order: Vercel Sandbox first, Cloudflare deferred to the future-drivers list."
tags: [adr, environments, deployments, sandbox, vercel, cloudflare, byoc]
timestamp: 2026-07-03T00:00:00Z
---

# ADR 0005: Vercel Sandbox as the first cloud driver

## Status

Superseded by [ADR 0006 — Sandbox provider auth model and Railway as the first cloud driver](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md).

## Context

The [Environments/Deployments roadmap](/specs/2026-06-27-kata-environments-deployments-design.md) (approved 2026-06-27) selected Cloudflare Sandbox as the first cloud driver (Phase 3), with Vercel, Hetzner, and DigitalOcean deferred. The roadmap's highest-flagged cloud risk was Cloudflare tunnels feasibility: reachability depends on the tunnels API that superseded the deprecated `exposePort()` path, so Phase 3 was gated on a tunnels spike with a Connect-relay re-plan as fallback.

Before drafting the Phase 3 deep-dive, we re-examined the driver order against the AgentBox prior-art checkout (`/Volumes/EVO/repos/agentbox`), which ships a production Vercel `CloudBackend` (`packages/sandbox-vercel/src/backend.ts`) plus live-verified findings (`docs/vercel-sandbox-findings.md`, observed 2026-05-28 on `@vercel/sandbox@2.0.1`):

- **`wss` reachability is verified working on Vercel.** `sandbox.domain(port)` preview URLs carry HTTPS + WebSocket and are stable across stop/start cycles. No tunnel provisioning. The exact capability the Cloudflare spike was designed to prove is already proven on Vercel.
- **Session lifetime is bounded but manageable.** Max session 45 min (Hobby) / 5 hr (Pro+). `extendTimeout` is additive; AgentBox runs a keepalive loop (`renewTimeout`) against a tracked deadline. On lapse, the sandbox auto-snapshots and auto-resumes via `Sandbox.get({ resume: true })` with the filesystem intact.
- **Free Hobby tier** enables UAT and contributor testing without paid infra. The Cloudflare plan required the user's paid infra and downgraded the demo AC to a recorded manual UAT.
- **Reference asymmetry.** AgentBox has a complete, commented Vercel driver against the same SPI shape our `packages/sandbox` mirrors, plus documented SDK footguns and workarounds. No AgentBox Cloudflare driver exists.
- **Verified constraints:** no custom images (snapshot-bake provisioning, which aligns with the roadmap's Phase 5 snapshot design); ≤4 exposed ports, none <1024; region `iad1` only; no nested containers (seccomp); no SSH/PTY channel (irrelevant to us — the full Kata server runs in the sandbox and clients connect over `wss`); headless auth via the `VERCEL_TOKEN` + team + project trio.

## Decision

1. **Vercel Sandbox is the first cloud driver.** Phase 3 targets `packages/sandbox-vercel` against `@vercel/sandbox` (v2). Reachability advertises a `public` endpoint via `sandbox.domain(port)` — a native public HTTPS + WebSocket URL, no tunnel.
2. **Cloudflare moves to the future BYOC cloud drivers list** alongside Hetzner and DigitalOcean. Its named-tunnel custom-domain story returns when a user need justifies re-running the tunnels spike.
3. **The Phase 3 tunnels spike and its re-plan branch are deleted.** No spike gates Phase 3.
4. **Session lifetime handling is a first-class Phase 3 requirement:** a keepalive loop via the SPI's optional `renewTimeout` capability, surfaced remaining lifetime, explicit lapse/resume UX (a lapsed sandbox pauses; a mid-turn agent stream breaks and must surface an explicit error, not a silent hang), and documented Hobby-tier behavior.
5. **BYOC auth uses the access-token trio** (`VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`) stored via `ServerSecretStore`. OIDC dev tokens are not supported (they cannot refresh headlessly).

## Consequences

- The roadmap spec's Phase 3 section, risk register, out-of-scope list, package layout, key files, and AC-3.x are rewritten for Vercel; `packages/sandbox-cloudflare` is replaced by `packages/sandbox-vercel` in the anticipated key files.
- AC-3.6's demo upgrades from recorded-manual-UAT-only to mostly e2e-automatable on the free Hobby tier; a live cloud agent-turn slice may still use manual UAT where CI credentials are unavailable.
- The Phase 3 deep-dive must address the verified Vercel constraints: snapshot-bake provisioning (no custom images), the 4-port/no-privileged-ports limit, no nested containers (a repo whose `.kata/environment.json` needs Docker inside the sandbox is unsupported on this driver and must fail loud), and the documented SDK footguns (tombstone snapshots gated on `status === 'created'`, `currentSnapshotId` aliasing on fresh sandboxes, `list()`/`get()` lifecycle disagreement).
- The SPI is unchanged. Capability flags (`supportsRenewTimeout`, `supportsSnapshot`, `maxLifetimeMs`) already cover the Vercel shape; this validates the Phase 1 Part A freeze.
- AgentBox remains pattern reference only (AGENTS.md reference-repo policy): adapt, don't transplant.

## Related

- [Environments/Deployments roadmap](/specs/2026-06-27-kata-environments-deployments-design.md)
- [Phase 1 deep-dive](/specs/2026-06-27-kata-environments-deployments-phase-1-design.md) (SPI freeze)
- AgentBox findings: `/Volumes/EVO/repos/agentbox/docs/vercel-sandbox-findings.md`, `docs/vercel-backlog.md`, `packages/sandbox-vercel/src/backend.ts`
