---
type: Spec
title: "Kata Environments / Deployments Phase 3a — Docker sandbox gaps (provider-ready image, terminal, host auth)"
description: "Deep-dive for Phase 3a: close the Docker sandbox gaps surfaced while wiring the session flow — bake provider CLIs and a working shell into the katacode image, fix the in-container terminal and surface terminal.open errors in the UI, bind-mount host provider credential directories for the local Docker driver, and document the env-var API-key auth path. Local-only prerequisite for Phase 3b (Railway cloud driver)."
status: Draft
tags: [specs, phase-3a, environments, deployments, sandbox, docker, auth, terminal]
timestamp: 2026-07-04T00:00:00Z
---

# Kata Environments / Deployments Phase 3a — Docker sandbox gaps

## Status

Draft. Implements roadmap Phase 3a per [ADR 0006](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md). This is the prerequisite for [Phase 3b — Railway cloud driver](/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md). The cloud sandbox cannot ship until the image is provider-ready and the terminal works in-container.

## Goal

A user starts a local Docker sandbox session, opens the terminal drawer, and gets a working shell inside the container. Provider CLIs (`codex`, `agent`, `grok` where available) are present on the container PATH. Providers authenticate via the host credential bind-mounts (the same `~/.codex`, `~/.claude`, `~/.config/opencode` the user already has on their laptop) or via env-var API keys injected at provision. A provider that is unauthenticated surfaces a real error, not a silent dead drawer. The sandbox is usable end-to-end as a development environment, parity with a remote VPS the user provisioned by hand.

## Source of truth

- Decision: [ADR 0006 — Sandbox provider auth model and Railway as the first cloud driver](/adrs/0006-sandbox-provider-auth-and-railway-first-cloud-driver.md)
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

4. **Local Docker driver bind-mounts host provider credential directories.** `packages/sandbox-docker` gains bind-mount declarations for:
   - `~/.codex` → `/home/katacode/.codex` (read-only; respects existing `CODEX_HOME` / shadow-home precedence — if the sandbox instance config sets `CODEX_HOME`, the bind-mount targets that path instead)
   - `~/.config/opencode` → `/home/katacode/.config/opencode` (read-only)
   - `~/.claude` → `/home/katacode/.claude` (read-write; Claude Code writes to this dir at runtime — skills, plugins, session state)
   - `~/.claude.json` → `/home/katacode/.claude.json` (read-write; Claude Code's mutable runtime/auth file)

   Bind-mounts are optional per-host-dir: if `~/.codex` does not exist on the host, the mount is skipped (the provider starts unauthenticated, surfacing its normal unauthenticated error). A host dir that exists but is empty is mounted normally. The driver does not copy credentials; it mounts them, matching AgentBox's local-Docker model.

5. **Env-var API keys remain an always-available alternative.** The existing sandbox environment-variable / saved-env secret path (`buildProvisionEnvironment`, `savedSandboxEnvironments`) injects `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CURSOR_API_KEY`, etc. at provision. This is the primary path for API-key-only providers and for users who prefer not to mount host OAuth tokens. Documented in the deployment-target UI as the "no host credentials" path.

6. **A "Sign in \<provider>" affordance on the sandbox card is deferred to Phase 3b.** The interactive in-sandbox login flow (PTY-driven OAuth URL + code relay, the AgentBox `_claude-login-worker` pattern) is part of the cloud credential-seeding work in Phase 3b. Phase 3a ships the bind-mount + env-var paths only. If neither is present, the provider surfaces its normal unauthenticated error in the ProviderStatusBanner and the working terminal lets the user run `codex login` / `claude` manually (completing OAuth via the device-code flow the provider CLIs already support).

## Verified constraints

| Constraint                                                    | Consequence                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| alpine ships no `bash`; `/bin/sh` is busybox ash              | Set `SHELL=/bin/sh` in the Dockerfile; do not rely on `bash`                              |
| node-pty was compiled for musl in the builder stage           | No additional native build for the runtime stage; `libstdc++` already present             |
| Bind-mounts require the host path to exist                    | Skip the mount if the host dir is absent; do not fail the whole provision                 |
| `~/.claude.json` is a file, not a dir                         | Mount it separately from `~/.claude` (AgentBox pattern)                                   |
| `CODEX_HOME` may be set to a shadow home in provider settings | Bind-mount target follows `CODEX_HOME` when set, else `~/.codex` default                  |
| OAuth-based logins need a device-code path headlessly         | Phase 3a relies on the provider CLIs' own device-code flow; the UI affordance is Phase 3b |

## Acceptance criteria

1. **AC-3a.1** The `katacode` Docker image includes `codex`, `agent`, `grok`, and `git` on PATH. A unit/integration test asserts the binaries resolve under `which` inside the image (or the Dockerfile is verified by a build-time check).
2. **AC-3a.2** The Dockerfile sets `ENV SHELL=/bin/sh` and `/bin/sh` exists in the runtime stage.
3. **AC-3a.3** Opening the terminal drawer in a running local Docker sandbox spawns a working shell (`/bin/sh`) inside the container. A manual UAT walkthrough confirms the prompt is interactive and `echo $SHELL` returns `/bin/sh`.
4. **AC-3a.4** When `terminal.open` fails, the UI surfaces the error message in the terminal drawer (`[terminal] failed to open: <message>`) and a non-blocking toast; no call site swallows the error with `.catch(() => undefined)`.
5. **AC-3a.5** With the host's `~/.codex` present, a started local Docker sandbox reports Codex as authenticated (provider status `ready`, `auth.status === "authenticated"`) without any env-var configuration. A unit test covers the bind-mount declaration; a manual UAT confirms the provider status.
6. **AC-3a.6** With the host's `~/.claude` and `~/.claude.json` present, a started local Docker sandbox reports Claude as authenticated. Manual UAT confirms.
7. **AC-3a.7** With the host's `~/.config/opencode` present, a started local Docker sandbox reports OpenCode as authenticated. Manual UAT confirms.
8. **AC-3a.8** When a host credential dir is absent, the corresponding provider starts unauthenticated and the ProviderStatusBanner shows its normal "Sign in via the CLI" message. The sandbox starts successfully; the missing mount is not fatal.
9. **AC-3a.9** Setting `ANTHROPIC_API_KEY` in the sandbox instance environment variables authenticates Claude without any host credential mount. A unit test covers the env-var injection path (already tested in Phase 2; this AC confirms parity with the bind-mount path).
10. **AC-3a.10** A provider that is unauthenticated in the sandbox can be authenticated interactively by running its login command in the working in-container terminal (`codex login`, `claude`, `opencode auth login`), completing OAuth via the provider CLI's device-code flow. Manual UAT confirms for at least one OAuth-based provider.
11. **AC-3a.11** `vp check`, `vp run typecheck`, and the existing `@environments-deploy` e2e suite pass. The Dockerfile change is covered by a build verification step.

## Deferred work

- **Interactive "Sign in \<provider>" UI affordance on the sandbox card** (PTY-driven OAuth URL + code relay, AgentBox `_claude-login-worker` pattern): Phase 3b. Captured in the deferred-work registry with revisit trigger "Phase 3b spec drafting".
- **Host credential seeding for cloud drivers** (the AgentBox host-backup + seed pattern for `~/.codex/auth.json`, `~/.claude/.credentials.json`, `~/.config/opencode` over a host-side encrypted store): Phase 3b. The local Docker bind-mount path in this spec is the local-only analogue.
- **Image size optimization** (multi-stage slimming, provider-CLI variant images): future. The Phase 3a image grows to ~1.2-1.5 GB; accepted for now.

## Build handoff

- Files to touch: `Dockerfile` (runtime stage: install provider CLIs, set `SHELL=/bin/sh`, add `git` to runtime), `packages/sandbox-docker/src/DockerSandboxProvider.ts` (bind-mount declarations, host-dir-existence checks), `apps/server/src/terminal/Layers/Manager.ts` (no change required if `SHELL=/bin/sh` is set, but verify the fallback chain), `apps/web/src/components/ChatView.tsx` (remove `.catch(() => undefined)` at all `terminal.open` call sites, surface errors), `apps/web/src/components/ThreadTerminalDrawer.tsx` (system message on open failure).
- Tests: extend `packages/sandbox-docker` with bind-mount declaration tests; add a Dockerfile build verification script; extend the `@environments-deploy` e2e flow with a terminal-open + provider-status assertion.
- Gate: `vp check`, `vp run typecheck`, `vp run test`, `vp run e2e --project desktop-dev --grep @environments-deploy`. Manual UAT for the provider-auth ACs (AC-3a.5/6/7/10) since they require host credential state.
