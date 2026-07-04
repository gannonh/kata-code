---
type: ADR
title: "Sandbox provider auth model and Railway as the first cloud driver"
description: "Adopt the AgentBox provider-auth pattern for sandboxes (bind-mount for local Docker, credential-file seeding for cloud, env-var API keys as alternative) and select Railway Service (Docker image) as the first cloud driver, replacing Vercel."
tags: [adr, environments, deployments, sandbox, auth, railway, cloud-driver, byoc, docker]
timestamp: 2026-07-04T00:00:00Z
---

# ADR 0006: Sandbox provider auth model and Railway as the first cloud driver

## Status

Accepted. Supersedes [ADR 0005 — Vercel Sandbox as the first cloud driver](/adrs/0005-vercel-first-cloud-driver.md).

## Context

[ADR 0005](/adrs/0005-vercel-first-cloud-driver.md) selected Vercel Sandbox as the first cloud driver for the [Environments/Deployments roadmap](/specs/2026-06-27-kata-environments-deployments-design.md) Phase 3, on the strength of live-verified `wss` over `sandbox.domain(port)` and the free Hobby tier. While drafting the Phase 3 deep-dive that would implement it, two gaps surfaced that the Vercel spec never had to address because Vercel forbids custom images and assumes a snapshot-bake of an already-working environment:

1. **The sandbox container has no provider CLIs and no credentials.** The `katacode:local` image ships only the Kata server bundle and `cloudflared` over `node:24-alpine`. Codex, Cursor (`agent`), and Grok binaries are absent; the SDK-based providers (Claude, Pi, OpenCode) ship as npm deps but find an empty `HOME=/home/katacode`. Every provider starts unauthenticated. This is true on any fresh remote host (`npx @kata-sh/code-cli serve` on a VPS) too — providers always authenticate from the host machine, and the sandbox container is a fresh host with no escape hatch.

2. **The in-container terminal is broken.** The web UI swallows `terminal.open` failures (every call site ends with `.catch(() => undefined)`), and the terminal manager resolves the shell as `env.SHELL ?? "bash"` while the alpine image sets no `SHELL` and ships no bash. Users get a dead drawer with no error and no way to run `codex login` / `claude` interactively even if the binaries were present. OAuth-based provider logins also need a device-code path to complete headlessly.

These gaps are prerequisites for _any_ cloud sandbox driver, not just Vercel: the cloud driver runs the same image, so the image must be provider-ready and the terminal must work in-container before a cloud driver can ship.

Investigating the AgentBox prior-art checkout (`/Volumes/EVO/repos/agentbox`, the reference repo already cited in the roadmap) revealed the auth model the Vercel spec was missing. AgentBox does not use env vars as the primary provider-auth path. It uses two mechanisms keyed to the driver kind:

- **Local Docker (`packages/sandbox-docker/src/claude.ts`, `claude-credentials.ts`):** bind-mounts the host's real credential directories into the container — `~/.codex`, `~/.config/opencode`, and a shared Docker volume for `~/.claude` (with `~/.claude.json` mounted separately). In-box provider CLIs read the same auth files the user already has on their laptop. No copying, no env vars.
- **Cloud (`packages/sandbox-docker/src/claude-credentials.ts` lines 22-30, the `CODEX_CREDENTIALS_BACKUP_FILE` / `OPENCODE_CREDENTIALS_BACKUP_FILE` / `CREDENTIALS_BACKUP_FILE` host-backup pattern):** cloud providers have no shared volume, so AgentBox captures the credential file produced by an interactive in-box login (`claude auth login`, `codex login`) back to the host at `~/.agentbox/<agent>-credentials.json` (mode 0600), then seeds that file into every subsequent cloud box at the provider-expected path. A headless login worker (`apps/cli/src/commands/_claude-login-worker.ts`) drives `claude auth login` under a PTY and relays the OAuth URL + code, so the interactive login completes even from a headless host.

This is the missing piece. Env-var API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CURSOR_API_KEY`) remain the right path for API-key providers and for users who prefer not to seed OAuth tokens, but they cannot carry OAuth refresh tokens for `codex login` / `claude` subscription auth, and they cannot help where the provider binary is absent from the image.

In parallel, the cloud-driver choice was re-examined against Railway rather than Vercel. Railway supports pre-built Docker images as a service source (select "Docker Image" instead of a GitHub repo, point it at `ghcr.io/...`), persistent volumes for state that should survive a stop/start, and public service domains with HTTPS + WebSocket. Unlike Vercel Sandbox, Railway runs real Docker images, so the entire snapshot-bake layer that ADR 0005 spent half its consequences on (base-snapshot bake, `prepared.json`, `currentSnapshotId` aliasing, tombstone guards, the 4-port/no-privileged-ports limit, no nested containers) does not apply. The same katacode Docker image becomes the single provision unit for both the local Docker sandbox and Railway cloud deploys. Railway Sandboxes (the VM primitive with checkpoints/forking/templates) exist as an alternative, but the Railway Service (Docker image) primitive is closest to the existing local Docker driver, reuses the image as-is, and requires no new snapshot/checkpoint semantics in the frozen `SandboxProvider` SPI.

## Decision

1. **Adopt the AgentBox provider-auth pattern for sandboxes.** Three paths, keyed to driver kind and provider auth model:
   - **Local Docker driver:** bind-mount the host's provider credential directories into the container (`~/.codex`, `~/.config/opencode`, `~/.claude` via a shared volume, `~/.claude.json` separately). In-box provider CLIs read host auth directly. Respect the existing `CODEX_HOME` / shadow-home precedence the providers already use.
   - **Cloud drivers:** capture credential files produced by an interactive in-sandbox login into a host-side encrypted store (`ServerSecretStore`, the existing sandbox-secret path), and seed them into the container at provision at the provider-expected path. A headless login worker drives OAuth-based logins under a PTY and relays the URL + code to the UI.
   - **Env-var API keys** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CURSOR_API_KEY`, etc.) remain an always-available alternative, injected via the existing sandbox environment-variable / saved-env secret path. This is the primary path for API-key-only providers and for users who prefer not to seed OAuth tokens.

2. **Railway Service (Docker image) is the first cloud driver.** Phase 3b targets `packages/sandbox-railway` against the frozen `SandboxProvider` SPI, provisioning a Railway Service from a published katacode Docker image ref. Reachability advertises a `public` endpoint via the Railway service domain — a native public HTTPS + WebSocket URL, no tunnel. The same image is the provision unit for both the local Docker driver (Phase 3a) and Railway (Phase 3b).

3. **Vercel Sandbox moves to the future BYOC cloud drivers list** alongside Cloudflare, Hetzner, and DigitalOcean. ADR 0005's snapshot-bake design is retired; its `wss` finding remains informative for any future driver that targets a no-custom-image platform. The Phase 3 deep-dive that implemented it (`docs/specs/2026-07-03-kata-environments-deployments-phase-3-design.md`) is superseded by the new Phase 3a/3b specs.

4. **Phase 3 is split into two staged halves:**
   - **Phase 3a — Docker sandbox gaps:** bake provider CLIs into the `katacode` image, fix the in-container terminal (set `SHELL=/bin/sh` or fix the fallback chain) and surface `terminal.open` errors in the UI, implement host credential bind-mounts for the local Docker driver, document the env-var auth path. Local-only; ships the working local sandbox. This is the prerequisite for 3b.
   - **Phase 3b — Railway cloud driver:** publish the katacode image to GHCR, implement `packages/sandbox-railway` against the frozen SPI using a Railway Service from the published image, seed credential files at provision from the host-side encrypted store, public `wss` reachability via the Railway service domain, ephemeral deploy-on-start / delete-on-dispose lifecycle.

5. **The frozen `SandboxProvider` SPI is unchanged.** The auth model is implemented inside `provision` (bind-mounts for Docker; credential-file seeding for cloud) and the existing environment-variable path, not as new SPI members. Railway's persistent-service lifecycle means the Vercel keepalive/lapse/resume UX from the superseded Phase 3 deep-dive is not needed; dispose deletes the service.

6. **An official katacode image is published to GHCR.** Phase 3b requires a pinned `ghcr.io/gannonh/kata-code:<tag>` ref for the Railway driver to pull. This adds a publish step to the release pipeline (`release.yml` / `build:docker-image`) as a Phase 3b prerequisite. The image is the same `Dockerfile` used for local Docker, with provider CLIs baked in during Phase 3a.

## Consequences

- ADR 0005 is superseded. Its Phase 3 deep-dive (`docs/specs/2026-07-03-kata-environments-deployments-phase-3-design.md`) is replaced by the new Phase 3a/3b specs; the roadmap Phase 3 section, risk register, and AC numbering are rewritten for Railway and the auth model.
- The `katacode` Docker image gains provider CLIs (codex, agent/grok as available) and a working shell (`/bin/sh` as the default `SHELL`), increasing image size. The Dockerfile is updated in Phase 3a.
- The local Docker sandbox driver gains host credential bind-mounts, touching `packages/sandbox-docker` and the provision env construction in `apps/server/src/sandbox/SandboxService.ts`. The existing `CODEX_HOME` / shadow-home precedence is preserved.
- A host-side encrypted credential store for cloud-seeded provider credentials is added to `ServerSecretStore`, parallel to the existing sandbox-instance secret path. Credential files are written mode 0600; plaintext-at-rest matches the existing provider-secret model (the host-side `~/.codex/auth.json` etc. are already plaintext on the user's laptop).
- A headless in-sandbox login flow (PTY-driven OAuth URL + code relay) is added for OAuth-based providers, surfacing in the web UI as a "Sign in <provider>" affordance on the sandbox card when a provider is unauthenticated and no credential is seeded.
- `terminal.open` failures are surfaced in the web UI (no more `.catch(() => undefined)`), so a broken in-container terminal shows a real error instead of a dead drawer.
- Phase 3b adds a GHCR publish step to the release pipeline and a new `packages/sandbox-railway` package implementing the frozen SPI against the Railway Service (Docker image) primitive, using the Railway CLI/GraphQL API and a `RAILWAY_API_TOKEN` stored via `ServerSecretStore`.
- The Vercel-specific constraints in ADR 0005 (snapshot-bake, no custom images, 4-port limit, no nested containers, 45-min session lifetime, keepalive/lapse/resume UX) no longer apply to Phase 3. Railway's constraints (ephemeral filesystem outside a mounted Volume; persistent service process model; public service domain) are documented in the Phase 3b spec.
- AgentBox remains pattern reference only (AGENTS.md reference-repo policy): adapt, don't transplant.

## Related

- [Environments/Deployments roadmap](/specs/2026-06-27-kata-environments-deployments-design.md)
- [Phase 1 deep-dive](/specs/2026-06-27-kata-environments-deployments-phase-1-design.md) (SPI freeze)
- [Phase 2 deep-dive](/specs/2026-06-27-kata-environments-deployments-phase-2-design.md) (env config, secret injection)
- [Superseded ADR 0005 — Vercel Sandbox as the first cloud driver](/adrs/0005-vercel-first-cloud-driver.md)
- AgentBox auth pattern: `/Volumes/EVO/repos/agentbox/packages/sandbox-docker/src/claude-credentials.ts`, `claude.ts`, `apps/cli/src/commands/_claude-login-worker.ts`
- Railway docs: [Services](https://docs.railway.com/services), [Volumes](https://docs.railway.com/volumes), [Private registries](https://docs.railway.com/builds/private-registries)
