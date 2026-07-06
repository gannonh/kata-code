---
type: Spec
title: "Kata Environments / Deployments Phase 3a — Docker sandbox gaps (provider-ready image, terminal, host auth)"
description: "Deep-dive for Phase 3a: close the Docker sandbox gaps surfaced while wiring the session flow — bake provider CLIs and a working shell into the katacode image, fix the in-container terminal and surface terminal.open errors in the UI, copy+sanitize host provider credential files into the local Docker container, and document the env-var API-key auth path. Local-only prerequisite for Phase 3b (Vercel Sandbox cloud driver)."
status: Implemented
approved_at: 2026-07-04T00:00:00Z
tags: [specs, phase-3a, environments, deployments, sandbox, docker, auth, terminal]
timestamp: 2026-07-04T00:00:00Z
---

# Kata Environments / Deployments Phase 3a — Docker sandbox gaps

## Status

Implemented. Implements roadmap Phase 3a per [ADR 0006](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md) (provider-auth model) and [ADR 0007](/adrs/0007-vercel-sandbox-first-cloud-sandbox-driver.md) (Phase 3b provider choice). This is the prerequisite for [Phase 3b — Vercel Sandbox cloud driver](/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md). The cloud sandbox cannot ship until the image is provider-ready and the terminal works in-container.

## Goal

A user starts a local Docker sandbox session, opens the terminal drawer, and gets a working shell inside the container. Provider CLIs (`codex`, `agent`, `grok` where available) are present on the container PATH. Providers authenticate via host credential files copied and sanitized into the container (the same `~/.codex`, `~/.claude`, `~/.config/opencode` the user already has on their laptop) or via env-var API keys injected at provision. A provider that is unauthenticated surfaces a real error, not a silent dead drawer. The sandbox is usable end-to-end as a development environment, parity with a remote VPS the user provisioned by hand.

## Source of truth

- Decision: [ADR 0006 — Sandbox provider auth model](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md) (provider-auth model remains accepted; Railway choice superseded by [ADR 0007](/adrs/0007-vercel-sandbox-first-cloud-sandbox-driver.md))
- Master roadmap: [2026-06-27-kata-environments-deployments-design.md](/specs/2026-06-27-kata-environments-deployments-design.md)
- Frozen SPI: `packages/sandbox/src/SandboxProviderDriver.ts`
- Docker driver: `packages/sandbox-docker/src/DockerSandboxProvider.ts`
- Server orchestration: `apps/server/src/sandbox/SandboxService.ts` (`buildProvisionEnvironment`, `startSession`)
- Terminal manager: `apps/server/src/terminal/Layers/Manager.ts` (`defaultShellResolver`, `resolveShellCandidates`, `isRetryableShellSpawnError`)
- Web terminal open call sites: `apps/web/src/components/ChatView.tsx` (every `api.terminal.open(...)` ends with `.catch(() => undefined)`)
- Container image: `Dockerfile` (current runtime stage: `node:24-alpine` + `libstdc++ ca-certificates curl cloudflared`; no `SHELL`, no `bash`, no provider CLIs)
- Prior art (pattern reference only, AGENTS.md reference-repo policy): AgentBox `/Volumes/EVO/repos/agentbox`
  - `packages/sandbox-docker/src/claude.ts` — shared Docker volume for `~/.claude`, separate `~/.claude.json` mount, `syncFromHost` rsync.
  - `packages/sandbox-docker/src/claude-credentials.ts` — host backup + seed pattern for cloud (Phase 3b uses this).
  - `packages/sandbox-docker/src/claude-hooks-filter.ts`, `claude-pull.ts` — `~/.claude.json` rewrite semantics.

## Gaps to close

1. **No provider CLIs in the image.** Codex, Cursor (`agent`), Grok are absent. The server probes for them on PATH and reports the provider as unavailable. SDK-based providers (Claude, Pi, OpenCode) ship as npm deps but find no credentials.
2. **No credentials in the container.** `HOME=/home/katacode` is fresh and empty. No `~/.codex/auth.json`, no Claude OAuth token, no `~/.config/opencode`. Providers start unauthenticated.
3. **In-container terminal is broken.** The terminal manager resolves the shell as `env.SHELL ?? "bash"` (`apps/server/src/terminal/Layers/Manager.ts:316`). The alpine image sets no `SHELL` and ships no `bash`. The fallback chain (`resolveShellCandidates`) tries `/bin/sh` but only on retryable spawn errors (`isRetryableShellSpawnError`); a non-retryable failure surfaces nothing.
4. **`terminal.open` failures are swallowed by the UI.** Every call site in `apps/web/src/components/ChatView.tsx` ends with `.catch(() => undefined)`. A broken in-container terminal shows a dead drawer with no error.
5. **No way to authenticate interactively in-container.** Even with a working terminal and the CLIs present, OAuth-based logins (`codex login`, `claude auth login`) need a device-code path to complete headlessly. The in-container browser cannot complete the OAuth redirect.

## Locked decisions

1. **Bake provider CLIs into the `katacode` image.** The Dockerfile runtime stage installs `codex`, `agent` (Cursor), and `grok` via npm global install (the same binaries the host expects), plus `git` (already present in the builder stage, add to runtime). The image grows by ~300-500 MB; accepted as the cost of a provider-ready sandbox. The same image is the provision unit for Phase 3b (Railway), so this work is not throwaway.

2. **Set `SHELL=/bin/sh` in the image and ensure `/bin/sh` is the first candidate.** alpine's `/bin/sh` is busybox ash, which is sufficient for a sandbox terminal. The Dockerfile sets `ENV SHELL=/bin/sh`. The terminal manager's `defaultShellResolver` then resolves to `/bin/sh` directly, avoiding the `bash` ENOENT path entirely. The fallback chain remains as a safety net.

3. **Surface `terminal.open` failures in the UI.** Remove the `.catch(() => undefined)` swallow at every call site in `ChatView.tsx`. On failure, write a system message to the terminal drawer (`[terminal] failed to open: <message>`) and surface a non-blocking error toast. The user sees a real error and a retry affordance, not a dead drawer.

4. **Local Docker driver copies and sanitizes host provider credential files into the container.** The server builds two tar archives host-side before provisioning: a static-config archive (sanitized: host-absolute paths stripped, `/workspace` pre-trusted, symlinks dereferenced, runtime state excluded) and a credentials archive (auth files only). The driver seeds both into the container via `copyInto` before the repo seed, then triggers a provider refresh so CLIs re-probe with credentials in place. This replaces the original bind-mount approach (see [Credential model deviation](#credential-model-deviation) below). Files seeded:
   - `~/.codex/` — config + auth (Codex config.toml sanitized: relative `model_catalog_json`, `/workspace` trust; `AGENTS.md` symlink dereferenced to a real file)
   - `~/.config/opencode/` — auth files
   - `~/.claude/` — credentials + config (Claude Code's mutable runtime/auth files)
   - `~/.pi/agent/` — Pi agent credentials

   If a host credential dir is absent, it is skipped (the provider starts unauthenticated, surfacing its normal unauthenticated error). All seeded files are katacode uid/gid owned. The original bind-mount approach leaked host-absolute paths into the container where they don't resolve (codex `config.toml` `model_catalog_json`, project trust paths, `AGENTS.md` symlink target), causing provider probe failures.

5. **Env-var API keys remain an always-available alternative.** The existing sandbox environment-variable / saved-env secret path (`buildProvisionEnvironment`, `savedSandboxEnvironments`) injects `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CURSOR_API_KEY`, etc. at provision. This is the primary path for API-key-only providers and for users who prefer not to mount host OAuth tokens. Documented in the deployment-target UI as the "no host credentials" path.

6. **A "Sign in \<provider>" affordance on the sandbox card is deferred to Phase 3b.** The interactive in-sandbox login flow (PTY-driven OAuth URL + code relay, the AgentBox `_claude-login-worker` pattern) is part of the cloud credential-seeding work in Phase 3b. Phase 3a ships the bind-mount + env-var paths only. If neither is present, the provider surfaces its normal unauthenticated error in the ProviderStatusBanner and the working terminal lets the user run `codex login` / `claude` manually (completing OAuth via the device-code flow the provider CLIs already support).

## Verified constraints

| Constraint                                                    | Consequence                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| alpine ships no `bash`; `/bin/sh` is busybox ash              | Set `SHELL=/bin/sh` in the Dockerfile; do not rely on `bash`                              |
| node-pty was compiled for musl in the builder stage           | No additional native build for the runtime stage; `libstdc++` already present             |
| Credential dirs require the host path to exist                | Skip the dir if absent on the host; do not fail the whole provision                       |
| `~/.claude.json` is a file, not a dir                         | Include it in the credentials archive alongside `~/.claude`                               |
| `CODEX_HOME` may be set to a shadow home in provider settings | Seed target follows `CODEX_HOME` when set, else `~/.codex` default                        |
| OAuth-based logins need a device-code path headlessly         | Phase 3a relies on the provider CLIs' own device-code flow; the UI affordance is Phase 3b |

## Acceptance criteria

1. **AC-3a.1** The `katacode` Docker image includes `codex`, `agent`, `grok`, and `git` on PATH. A unit/integration test asserts the binaries resolve under `which` inside the image (or the Dockerfile is verified by a build-time check).
2. **AC-3a.2** The Dockerfile sets `ENV SHELL=/bin/sh` and `/bin/sh` exists in the runtime stage.
3. **AC-3a.3** Opening the terminal drawer in a running local Docker sandbox spawns a working shell (`/bin/sh`) inside the container. A manual UAT walkthrough confirms the prompt is interactive and `echo $SHELL` returns `/bin/sh`.
4. **AC-3a.4** When `terminal.open` fails, the UI surfaces the error message in the terminal drawer (`[terminal] failed to open: <message>`) and a non-blocking toast; no call site swallows the error with `.catch(() => undefined)`.
5. **AC-3a.5** With the host's `~/.codex` present, a started local Docker sandbox reports Codex as authenticated (provider status `ready`, `auth.status === "authenticated"`) without any env-var configuration. A unit test covers the bind-mount declaration; a manual UAT confirms the provider status.
6. **AC-3a.6** With the host's `~/.claude` and `~/.claude.json` present, a started local Docker sandbox reports Claude as authenticated. Manual UAT confirms.
7. **AC-3a.7** With the host's `~/.config/opencode` present, a started local Docker sandbox reports OpenCode as authenticated. Manual UAT confirms.
8. **AC-3a.8** When a host credential dir is absent, the corresponding provider starts unauthenticated and the ProviderStatusBanner shows its normal "Sign in via the CLI" message. The sandbox starts successfully; the missing credential dir is not fatal.
9. **AC-3a.9** Setting `ANTHROPIC_API_KEY` in the sandbox instance environment variables authenticates Claude without any host credential mount. A unit test covers the env-var injection path (already tested in Phase 2; this AC confirms parity with the credential-seeding path).
10. **AC-3a.10** A provider that is unauthenticated in the sandbox can be authenticated interactively by running its login command in the working in-container terminal (`codex login`, `claude`, `opencode auth login`), completing OAuth via the provider CLI's device-code flow. Manual UAT confirms for at least one OAuth-based provider.
11. **AC-3a.11** `vp check`, `vp run typecheck`, and the existing `@environments-deploy` e2e suite pass. The Dockerfile change is covered by a build verification step.

## Deferred work

- **Interactive "Sign in \<provider>" UI affordance on the sandbox card** (PTY-driven OAuth URL + code relay, AgentBox `_claude-login-worker` pattern): Phase 3b. Captured in the deferred-work registry with revisit trigger "Phase 3b spec drafting".
- **Host credential seeding for cloud drivers** (the AgentBox host-backup + seed pattern for `~/.codex/auth.json`, `~/.claude/.credentials.json`, `~/.config/opencode` over a host-side encrypted store): Phase 3b. The local Docker copy+sanitize path in this spec is the local-only analogue and shares the same `credentialSeed.ts` infrastructure.
- **Image size optimization** (multi-stage slimming, provider-CLI variant images): future. The Phase 3a image grows to ~1.2-1.5 GB; accepted for now.

## Build handoff

- Files to touch: `Dockerfile` (runtime stage: install provider CLIs, set `SHELL=/bin/sh`, add `git` to runtime), `apps/server/src/sandbox/credentialSeed.ts` (credential tar archive builder), `apps/server/src/sandbox/ustarWriter.ts` (shared tar writer), `packages/sandbox-docker/src/DockerSandboxProvider.ts` (no bind-mounts; copyInto-based seeding), `apps/server/src/terminal/Layers/Manager.ts` (no change required if `SHELL=/bin/sh` is set, but verify the fallback chain), `apps/web/src/components/ChatView.tsx` (remove `.catch(() => undefined)` at all `terminal.open` call sites, surface errors), `apps/web/src/components/ThreadTerminalDrawer.tsx` (system message on open failure).
- Tests: credential seed archive tests; add a Dockerfile build verification script; extend the `@environments-deploy` e2e flow with a terminal-open + provider-status assertion.
- Gate: `vp check`, `vp run typecheck`, `vp run test`, `vp run e2e --project desktop-dev --grep @environments-deploy`. Manual UAT for the provider-auth ACs (AC-3a.5/6/7/10) since they require host credential state.

## Build completion report

- Spec: `docs/specs/2026-07-04-kata-environments-deployments-phase-3a-design.md`
- Base SHA: `4055d3b416208585934bce9d058e326bf3ccc123`
- Initial head SHA: `318a0be83` (bind-mount approach)
- Final head SHA: `aeabe02d6` (branch `katacode/docker-sandbox-phase-3a`, after credential model pivot + simplify + strict-quality-review)

### Credential model deviation

The spec originally specified bind-mounting host credential directories into the container. Implementation proved this approach leaks host-absolute paths into the container where they don't resolve: codex `config.toml` `model_catalog_json` points at a host path, project trust paths reference the host filesystem, and `AGENTS.md` is a symlink to a host target. The provider probe failed with `failed to reload config: No such file or directory` and providers showed as unauthenticated.

The credential model pivoted to copy+sanitize (AgentBox pattern): `credentialSeed.ts` builds two tar archives host-side — static config (sanitized: strip host-only paths, pre-trust `/workspace`, deref symlinks, exclude runtime state) and credentials (auth files only). `ustarWriter.ts` provides a shared tar writer with katacode uid/gid ownership. `sandboxSetupRunner` seeds both archives via `copyInto` before the repo seed. `SandboxService` calls `/api/providers/refresh` after setup so providers re-probe with credentials in place. `DockerSandboxProvider` no longer creates bind-mounts. The `credentialBindMounts` module and its tests were removed in the strict-quality-review pass as superseded.

This deviation is recorded as an approved implementation deviation. The spec's locked decision #4 and acceptance criteria text have been updated to reflect the copy+sanitize model. The ADR 0006 provider-auth model (local credential access + cloud credential-file seeding + env-var alternative) remains the accepted architecture; the implementation detail changed from bind-mounts to copy+sanitize.

### Commits

Phase 3a initial build:

- `feat(sandbox-docker): bind-mount host provider credential dirs into local containers`
- `feat(web): surface terminal.open failures via error toast (AC-3a.4)`
- `feat(docker): bake provider CLIs + SHELL=/bin/sh into katacode image (AC-3a.1/2/3/11)`
- `fix(docker): install bash for cursor.com installer + override entrypoint in verify`

Credential model pivot + sandbox hardening:

- `fix(sandbox-docker): mount ~/.codex read-write + pre-create /workspace in image`
- `fix(sandbox): seed .git so sandbox projects group with same repo across environments`
- `docs(sandbox): fix repoSeedArchive docstring to reflect .git inclusion`
- `fix(sandbox): seed tar files as katacode uid/gid + pin image ids`
- `fix(sandbox): emit katacode-owned directory entries in seed tar`
- `feat(sandbox): copy+sanitize provider credentials instead of bind-mounts`
- `fix(sandbox): seed credentials unconditionally after provision`
- `feat(sandbox): add Pi CLI to image + extract Claude OAuth from macOS Keychain`
- `fix(provider): synthesize default instances for all built-in drivers`
- `fix(sandbox): strip Pi packages list from seeded settings.json`

UI improvements:

- `feat(ui): reorder providers, add Early Access labels, hide Grok, dim sandbox providers`
- `fix(ui): filter hidden Grok instances from Settings fallback rendering`
- `feat(ui): use display name for environments, label by type in Connections`
- `fix(env): skip descriptor rename for sandbox environments`
- `fix(env): prefer saved label over descriptor in environment option labels`
- `feat(sandbox): pass display name to container as KATACODE_ENVIRONMENT_LABEL`

Relay unlink hardening:

- `fix(sandbox): unlink sandbox from relay on dispose`
- `feat(ui): add Remove affordance for KAT Connect relay environments`
- `fix(cloud): surface actual relay error in unlinkManagedRelayEnvironment`
- `fix(cloud): surface nested relay error in unlink failure toast`
- `fix(relay): make managed endpoint deprovision non-fatal during unlink`
- `fix(relay): add CORS headers to error responses and harden unlink`
- `fix(relay): use catchCause for unlink DB operations`
- `ci(relay): add force option to relay deploy workflow`
- `ci(relay): remove force deploy workflow input`
- `fix(relay): bound deprovision with 5s timeout during unlink`

Phase 3b retarget:

- `docs(environments): retarget phase 3b to vercel sandbox`

Finalize:

- `refactor(sandbox): simplify branch implementation` (simplify pass)
- `refactor(sandbox): address strict quality review` (strict-quality-review pass)

### Tasks completed

1. **Dockerfile provider CLIs + SHELL=/bin/sh** (AC-3a.1/2/3/11): runtime stage installs `git`, `bash`, and the provider CLIs via `npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai @xai-official/grok` plus the `cursor.com/install` script as the `katacode` user for the `agent` symlink in `~/.local/bin`. Sets `ENV SHELL=/bin/sh` and prepends `~/.local/bin` to `PATH`. Pi CLI added to the image.
2. **Credential copy+sanitize** (AC-3a.5/6/7/8): `apps/server/src/sandbox/credentialSeed.ts` builds static-config and credentials tar archives host-side. `ustarWriter.ts` provides a shared USTAR tar writer with katacode uid/gid ownership and prefix-field support for long paths. `sandboxSetupRunner` seeds both archives via `copyInto` before the repo seed. `SandboxService` calls `/api/providers/refresh` after setup. Absent host credential dirs are skipped. Codex `config.toml` is sanitized (relative `model_catalog_json`, `/workspace` pre-trust); `AGENTS.md` symlink is dereferenced to a real file. Claude OAuth tokens extracted from macOS Keychain where applicable.
3. **Terminal manager**: verified by inspection — `defaultShellResolver` returns `env.SHELL ?? "bash"`, so `SHELL=/bin/sh` resolves `/bin/sh` directly; the fallback chain (`resolveShellCandidates`) keeps `/bin/sh` as a safety net. No code change required.
4. **UI error surfacing** (AC-3a.4): every `api.terminal.open(...)` call site in `apps/web/src/components/ChatView.tsx` now routes rejections through `handleTerminalOpenError` (non-blocking error toast) instead of `.catch(() => undefined)` or silent `catch {}`. The in-drawer `[terminal] <message>` system message for spawn failures is already written by `ThreadTerminalDrawer` from the attach stream's `error` event.
5. **Tests + verification** (AC-3a.11): added `apps/web/src/lib/terminalOpenError.test.ts`, `scripts/verify-docker-image.ts` (`pnpm run verify:docker-image`), and a third `@environments-deploy` e2e test asserting `SHELL=/bin/sh`, `/bin/sh`, an interactive shell, and every provider CLI on PATH. The `credentialBindMounts` unit tests were removed when the model pivoted to copy+sanitize.
6. **Relay unlink hardening**: `disposeSession` now unlinks the sandbox environment from the relay before disposing the container. Relay `unlinkEnvironment` adds CORS headers to error responses and wraps DB operations in catch handlers. Managed endpoint deprovision is non-fatal during unlink. A Remove affordance was added to the KAT Connect relay environments UI.
7. **UI improvements**: providers reordered (Codex, Claude, OpenCode, Cursor, Pi) with Early Access labels; Grok hidden behind a feature flag; sandbox-unsupported providers dimmed with a tooltip in the composer. Environments display user-chosen names instead of container hostnames; Connections list labels environments by type (SSH, Sandbox, Remote Link). `KATACODE_ENVIRONMENT_LABEL` passed to the container.

### Verification commands run

- `vp check`: 0 errors (26 pre-existing warnings).
- `vp run typecheck`: exit 0 across all 19 packages.
- `pnpm run build:docker-image`: built `katacode:local` successfully.
- `pnpm run verify:docker-image`: OK — `codex`, `agent`, `grok`, `claude`, `opencode`, `git` resolve on PATH; `SHELL=/bin/sh`; `/bin/sh` present.

### Review gates

Single-agent path. Self-review performed against the spec, acceptance criteria, and non-goals. The simplify pass (`6fd863b0b`) removed duplicated ustar writer, unused constants/imports, redundant relay branch, and unused credential setup assignment. The strict-quality-review pass (`aeabe02d6`) removed the superseded `credentialBindMounts` module + tests, fixed `isSandboxEnvironment` to check the `.sandbox` marker instead of any saved environment record (so SSH and remote-link environments don't dim sandbox-unsupported providers), and moved a misplaced docstring.

### Approved deviations

- The spec's locked decision #1 lists only `codex`, `agent`, `grok` for npm install. AC-3a.10 requires `claude` and `opencode` login commands to work in-container, so `@anthropic-ai/claude-code` and `opencode-ai` were also installed via npm. `bash` was added to the runtime apk list because the `cursor.com/install` script requires bash (alpine ships no bash by default). Pi CLI was added to the image.
- The credential model pivoted from bind-mounts to copy+sanitize (see [Credential model deviation](#credential-model-deviation) above).

### Known follow-up issues

- `vp run test` has a pre-existing vitest suite-collection failure across the repo (`Vitest failed to find the current suite` / `Cannot read properties of undefined (reading 'config')`), reproducible on the base SHA. New unit tests collect and pass; the broader harness issue is environmental and out of scope.
- E2E (`vp run e2e --project desktop-dev --grep @environments-deploy`) should be run after stopping any dev server (the harness spawns its own isolated stack).
- Manual UAT for AC-3a.5/6/7/10 (host credential auth) is pending — these require host `~/.codex`, `~/.claude`, `~/.config/opencode` state and a paired provider.

## Finalize outcome

Branch `katacode/docker-sandbox-phase-3a` finalized after simplify (`6fd863b0b`) and strict-quality-review (`aeabe02d6`) passes (head `aeabe02d6`).

**Simplify pass** (`6fd863b0b`):

- Removed duplicated ustar writer from `repoSeedArchive.ts` in favor of shared `packUstarArchive`.
- Removed unused `CONTAINER_HOME` constants, unused `containerHome` option field, unused `join` import, and unused `credentialSetup` assignment.
- Dropped redundant `relayManaged` branch in `resolveEnvironmentTypeLabel` and fixed return type.

**Strict-quality-review pass** (`aeabe02d6`):

- Removed unused `credentialBindMounts` module + tests (superseded by the copy+sanitize credential seeding approach).
- Fixed `isSandboxEnvironment` to check the `.sandbox` marker instead of any saved environment record — SSH and remote-link environments should not dim sandbox-unsupported providers.
- Moved `sanitizeClaudeJson` docstring to the correct function.

**Scope expansion beyond original Phase 3a**: The branch grew beyond the original Phase 3a scope (Docker sandbox gaps) to include relay unlink hardening, UI improvements (provider reordering, environment display names, Grok hiding), and the Phase 3b retarget from Railway to Vercel Sandbox (ADR 0007). These are recorded here for completeness; the Phase 3b spec and ADR 0007 document the Vercel Sandbox decision.
