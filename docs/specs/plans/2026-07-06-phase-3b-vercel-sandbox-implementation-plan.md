---
type: Plan
title: "Phase 3b: Vercel Sandbox cloud driver implementation"
tags: [plan, phase-3b, sandbox, vercel]
timestamp: 2026-07-06T00:00:00Z
---

# Phase 3b Implementation Plan: Vercel Sandbox cloud driver

## Context

The approved spec `docs/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md` (ADR 0007) defines Phase 3b: the first BYOC cloud sandbox driver on Vercel Sandbox. A user configures a Vercel deployment target in Settings -> Environments with a token trio, runtime/source, and timeout. Starting a session provisions a Firecracker microVM via `@vercel/sandbox`, seeds repo and provider credentials, starts `katacode serve`, exposes it publicly via `sandbox.domain(port)`, and auto-registers with Connect. The spec adds keepalive/lapse/resume lifecycle, first-class snapshots, credential seeding from `ServerSecretStore`, and an interactive "Sign in <provider>" flow. 13 acceptance criteria (AC-3b.1..13).

This plan is written for prescriptive execution by a less capable model. Follow it literally; where a detail is marked VERIFY, confirm against the named file before coding.

**First implementation step (step 0):** copy this plan into the worktree at `docs/specs/plans/2026-07-06-phase-3b-vercel-sandbox-implementation-plan.md` with frontmatter (`type: Plan`, `title: "Phase 3b: Vercel Sandbox cloud driver implementation"`, `tags: [plan, phase-3b, sandbox, vercel]`, `timestamp: 2026-07-06T00:00:00Z`), then commit it: `docs(specs): add phase 3b vercel sandbox implementation plan`.

## Ground rules

- Branch: `feat/deployments-phase-3b.md` (current). Commit per milestone using Conventional Commits. Do not push without user request.
- Gates after every milestone: `vp run typecheck`, `vp run test`, and `vp check` from repo root. e2e gate at M6: `vp run e2e --project desktop-dev --grep @environments-deploy`.
- Package naming: `@kata-sh/code-*`. Compiler is `tsgo` (not tsc). Tests import `{ describe, expect, it }` from `vite-plus/test` and `{ it as vitIt }` from `@effect/vitest` (use `vitIt.effect` for Effect-returning tests).
- Effect v4 beta (`effect: catalog:`). Schemas use `effect/Schema` (`Schema.Literals`, `Schema.optionalKey`, `Schema.Struct`). Hoist compiled decoders to module scope (lint rule `kata-code/no-inline-schema-compile`). Follow `@effect-diagnostics` suppression comment patterns from `packages/sandbox-docker/src/dockerEngine.ts` when using `node:*` imports or global `fetch`/`Date`.
- SDK guidance: read `.agents/skills/vercel-sandbox/SKILL.md` before writing the SDK wrapper. Prior art (pattern reference only, do not copy code): AgentBox at `/Volumes/EVO/repos/agentbox`, especially `packages/sandbox-vercel/src/backend.ts` and `apps/cli/src/commands/_claude-login-worker.ts`.
- The spec text says Phase 3a used "host credential bind-mounts". The code has already migrated to tar-archive seeding via `driver.copyInto` (`apps/server/src/sandbox/credentialSeed.ts`, `buildCredentialSeedArchives`). Base all credential work on that module, not bind-mounts.

## Key existing code (verified)

| What                                                                                  | Where                                                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Frozen SPI (`SandboxProvider`, `SandboxProviderError`, capabilities)                  | `packages/sandbox/src/SandboxProviderDriver.ts`                                                              |
| Registry (decoder gets ONLY `config.config` payload)                                  | `packages/sandbox/src/SandboxProviderRegistry.ts`                                                            |
| Descriptor schema                                                                     | `packages/sandbox/src/descriptor.ts`                                                                         |
| Reference driver to mirror                                                            | `packages/sandbox-docker/src/DockerSandboxProvider.ts`, `config.ts`                                          |
| Conformance stub                                                                      | `packages/sandbox/src/testing/stubDriver.ts`                                                                 |
| Server orchestration (`buildRegistry` line ~90, `startSession` lines ~708-929)        | `apps/server/src/sandbox/SandboxService.ts`                                                                  |
| Credential seed archives (`PROVIDER_SPECS`: codex, claude, pi)                        | `apps/server/src/sandbox/credentialSeed.ts`                                                                  |
| Setup runner (repo seed, install, detached start)                                     | `apps/server/src/sandbox/sandboxSetupRunner.ts`                                                              |
| Environment config loader (`build.dockerfile` field is the Docker-needed signal)      | `apps/server/src/sandbox/environmentConfigLoader.ts`, `packages/sandbox-contracts` `environmentConfig`       |
| Secret store (`get/set/create/remove`, files under secretsDir)                        | `apps/server/src/auth/ServerSecretStore.ts`                                                                  |
| Instance env secret materialization (`sandbox-env-*` prefix, already generic)         | `apps/server/src/serverSettings.ts` (`materializeSandboxProviderEnvironmentSecrets` ~line 435)               |
| RPC method names (4 sandbox methods today)                                            | `packages/contracts/src/rpc.ts` `WS_METHODS` lines ~245-249, Rpc defs ~302-325                               |
| Sandbox RPC schemas (`SandboxInstanceSummary`, `SandboxRpcError`)                     | `packages/contracts/src/sandboxRpc.ts`                                                                       |
| Relay endpoint providerKind literals (`"manual"` fits public URLs)                    | `packages/contracts/src/relay.ts` ~line 129                                                                  |
| Client RPC namespace                                                                  | `packages/client-runtime/src/wsRpcClient.ts` ~lines 183-190, 425-437                                         |
| WS routing + auth scopes                                                              | `apps/server/src/ws.ts` ~lines 210-213, 1076-1112                                                            |
| Settings UI card (DOCKER_KIND line 54, add dialog line ~877, DockerConfigFields ~808) | `apps/web/src/components/settings/SandboxDeploymentSettings.tsx`                                             |
| Write-only secret env editor (reuse for the Vercel trio)                              | `ProviderEnvironmentSection` in `apps/web/src/components/settings/ProviderInstanceCard.tsx`                  |
| Provider banner                                                                       | `apps/web/src/components/chat/ProviderStatusBanner.tsx`                                                      |
| Saved env registration after start (`sandbox: { providerKind }` is free-form string)  | `apps/web/src/environments/runtime/service.ts` `addSavedEnvironment` ~line 1874                              |
| e2e suite + tags + harness                                                            | `e2e/tests/environments-deploy/container-deploy.spec.ts`, `e2e/src/config/tags.ts`, `e2e/src/harness/env.ts` |

Facts about Vercel Sandbox (verified against SDK v2 usage in AgentBox and Vercel docs):

- `Sandbox.create({ runtime: "node24" | source: { type: "snapshot", snapshotId }, resources: { vcpus }, ports: number[] (max 4, each >= 1024), timeout, env, token, teamId, projectId, ... })`. Create is billable and non-idempotent: never retry it.
- `sb.domain(port)` returns a public HTTPS URL. `sb.runCommand({ cmd, args, sudo?, detached? })` (no PTY, no interactive stdin). `sb.writeFiles([{ path, content: Buffer }])`. `sb.extendTimeout(deltaMs)` is ADDITIVE and remaining lifetime is not readable: track deadlines host-side. `sb.snapshot({ expiration })` STOPS the sandbox and returns `{ snapshotId }`. `sb.stop()`, `sb.delete()`. `Sandbox.get({ sandboxId, resume: true })` resumes from the auto-snapshot. `Snapshot.get({ snapshotId })` has `.status` (`"created"` = usable) and `.delete()`.
- Runtime `node24` is Amazon Linux 2023 with node/npm. `katacode` is published as `@kata-sh/code-cli@0.0.30` (bin `katacode`). Provider CLIs install: `npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai @xai-official/grok @earendil-works/pi-coding-agent` (same list as Dockerfile line ~139).
- Hobby plan timeout max 45 min; default target `timeoutMs` = 2_700_000.

## Design decisions locked for this implementation

1. **Auth trio placement.** `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` are stored as sensitive instance `environment` variables (existing `sandbox-env-*` secret path; zero new secret infra; `apps/server/src/serverSettings.ts` needs no change). Because `driver.validate(config)` receives only the decoded config payload, the server merges the materialized trio into the raw config blob before `materializeOne` via a driver-exported helper (`mergeVercelAuthIntoConfig`). The driver excludes these three names from env passed into the sandbox.
2. **Optional SPI `resume` capability.** The SPI header explicitly permits adding optional capabilities ("later phases may add optional capabilities but must not change required signatures"). AC-3b.6 requires resume; an optional `resume` capability plus `supportsResume` descriptor flag is the mechanism. No required member changes.
3. **Deadline arithmetic lives server-side** (`extendTimeout` is additive, remaining time unreadable). New `sessionKeepalive.ts` owns the loop.
4. **Public endpoint via relay `providerKind: "manual"`.** `registerSandboxWithConnect` grows explicit `endpointProviderKind` and `origin` inputs; loopback callers keep today's values, public callers derive host/443 from the URL.
5. **Snapshot on a live session lapses it** (Vercel stops the VM). UI copy and the Resume path make this coherent.
6. **Sign-in V1 targets Claude only** (AC-3b.11 requires "at least one OAuth-based provider"). No host PTY is possible against Vercel; the login command runs inside the sandbox under `script(1)` with a FIFO for stdin. M5 begins with a mandatory spike UAT.

---

## M1: SPI resume capability + `packages/sandbox-vercel`

Commit: `feat(sandbox-vercel): vercel sandbox driver package with SPI resume capability`

### 1.1 SPI additions (optional capability only)

- `packages/sandbox/src/SandboxProviderDriver.ts`:
  ```ts
  /** Optional capability: reattach/restart a lapsed sandbox (Phase 3b). */
  export interface SandboxResumeCapability {
    resume(
      handle: SandboxHandle,
      req: { readonly config: unknown; readonly env?: ReadonlyArray<readonly [string, string]> },
    ): Effect.Effect<SandboxHandle, SandboxProviderError>;
  }
  ```
  Add `readonly resume?: SandboxResumeCapability;` to `SandboxProvider` with a JSDoc line mirroring the other optional members.
- `packages/sandbox/src/descriptor.ts`: add `supportsResume: Schema.Boolean` to `SandboxProviderDescriptor`.
- `packages/sandbox/src/testing/stubDriver.ts`: add `supportsResume: false` to the stub descriptor.
- `packages/sandbox-docker/src/DockerSandboxProvider.ts` `describe()`: add `supportsResume: false`.
- Fix any other `SandboxProviderDescriptor` construction sites typecheck reveals.

### 1.2 Package scaffold

Create `packages/sandbox-vercel/`:

- `package.json`: name `@kata-sh/code-sandbox-vercel`, `private: true`, `type: "module"`, exports `"."` -> `{ types: "./src/index.ts", import: "./src/index.ts" }`, scripts `typecheck: "tsgo --noEmit"`, `test: "vp test run"`. Deps: `@kata-sh/code-contracts: workspace:*`, `@kata-sh/code-sandbox: workspace:*`, `@kata-sh/code-sandbox-contracts: workspace:*`, `effect: catalog:`, `@vercel/sandbox: catalog:`. DevDeps: `@effect/vitest: catalog:`, `vite-plus: catalog:`. Mirror `packages/sandbox-docker/package.json` field for field.
- `tsconfig.json`: copy from `packages/sandbox-docker/tsconfig.json`.
- Add `"@vercel/sandbox": "2.0.1"` (or latest 2.x) to the `catalog:` block in `pnpm-workspace.yaml`. Run `pnpm install`. VERIFY whether `@vercel/sandbox` has postinstall builds; if pnpm warns, add it to the workspace `onlyBuiltDependencies`/`allowBuilds` list.

Files and exports:

| File                                                      | Exports                                                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                            | barrel re-export of the below                                                                                                                                       |
| `src/config.ts`                                           | `VercelSandboxConfig`, `DEFAULT_VERCEL_CONFIG`, `VERCEL_AUTH_ENV_VARS`, `mergeVercelAuthIntoConfig`                                                                 |
| `src/sdk.ts`                                              | `VercelSdk`, `VercelSandboxInstance`, `VercelAuthParams`, `liveVercelSdk`                                                                                           |
| `src/bootstrap.ts`                                        | `SANDBOX_HOME` (`"/home/katacode"`), `KATA_CLI_PACKAGE` (`"@kata-sh/code-cli"`), `buildBootstrapScript`, `buildServeCommand`                                        |
| `src/VercelSandboxProvider.ts`                            | `VERCEL_KIND`, `vercelConfigDecoder`, `makeVercelSandboxProvider(sdk: VercelSdk)`, `VercelSandboxProvider` (built with `liveVercelSdk`), `VercelSandboxHandleState` |
| `src/config.test.ts`, `src/VercelSandboxProvider.test.ts` | unit tests                                                                                                                                                          |

### 1.3 `src/config.ts`

Use `makeProviderSettingsSchema` from `@kata-sh/code-contracts/settings` with `providerSettingsForm` annotations exactly like `packages/sandbox-docker/src/config.ts` (`TrimmedNonEmptyString`, `PortSchema` from `@kata-sh/code-contracts/baseSchemas`):

```ts
export const VercelSandboxConfig = makeProviderSettingsSchema({
  runtime: TrimmedNonEmptyString, // title "Runtime", placeholder "node24"
  sourceType: Schema.Literals(["runtime", "snapshot"]), // title "Boot source"
  snapshotId: Schema.optionalKey(TrimmedNonEmptyString), // title "Snapshot id"
  timeoutMs: Schema.Number, // title "Session timeout (ms)", placeholder "2700000"
  port: PortSchema, // title "Sandbox port", placeholder "13773"
  vcpus: Schema.optionalKey(Schema.Number), // title "vCPUs"
  auth: Schema.optionalKey(
    Schema.Struct({
      token: TrimmedNonEmptyString,
      teamId: TrimmedNonEmptyString,
      projectId: TrimmedNonEmptyString,
    }),
  ),
});
export type VercelSandboxConfig = typeof VercelSandboxConfig.Type;
export const DEFAULT_VERCEL_CONFIG: VercelSandboxConfig = {
  runtime: "node24",
  sourceType: "runtime",
  timeoutMs: 2_700_000,
  port: 13773,
};
export const VERCEL_AUTH_ENV_VARS = [
  "VERCEL_TOKEN",
  "VERCEL_TEAM_ID",
  "VERCEL_PROJECT_ID",
] as const;
```

Notes:

- `auth` is injected server-side and never rendered as a form field. Check how `makeProviderSettingsSchema`/`ProviderSettingsForm` treat un-annotated keys (VERIFY against `packages/contracts/src/settings*`); if every key renders, annotate `auth` so it is hidden, or move it out of the settings schema into an intersected plain `Schema.Struct`.
- Spec decision 3 mentions a VCR image source. The SDK v2 create shape for registry images is unconfirmed; V1 ships `runtime | snapshot` only and the plan records VCR as deferred (matches spec deferred work "VCR production image pipeline").

`mergeVercelAuthIntoConfig(envelope: SandboxProviderInstanceConfig): SandboxProviderInstanceConfig`:

- Read `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` from `envelope.environment` (array of `{ name, value, sensitive }`; values are already materialized by the server).
- If all three present and non-empty: return `{ ...envelope, config: { ...(envelope.config as object ?? {}), auth: { token, teamId, projectId } } }`.
- Otherwise return the envelope unchanged (validate then fails loudly).

### 1.4 `src/sdk.ts`

Thin injectable wrapper so unit tests use a fake (no network, no billable creates):

```ts
export interface VercelAuthParams { readonly token: string; readonly teamId: string; readonly projectId: string }
export interface VercelSandboxInstance {
  readonly sandboxId: string;
  domain(port: number): string;
  runCommand(opts: { cmd: string; args?: string[]; sudo?: boolean; detached?: boolean }):
    Promise<{ exitCode: number; stdout(): Promise<string>; stderr(): Promise<string> }>;
  writeFiles(files: ReadonlyArray<{ path: string; content: Buffer }>): Promise<void>;
  extendTimeout(deltaMs: number): Promise<void>;
  snapshot(opts?: { expiration?: number }): Promise<{ snapshotId: string }>;
  stop(): Promise<void>;
  delete(): Promise<void>;
}
export interface VercelSdk {
  create(params: VercelAuthParams & {
    runtime?: string;
    source?: { type: "snapshot"; snapshotId: string };
    resources?: { vcpus: number };
    ports: ReadonlyArray<number>;
    timeout: number;
    env: Record<string, string>;
  }): Promise<VercelSandboxInstance>;
  get(params: VercelAuthParams & { sandboxId: string; resume?: boolean }): Promise<VercelSandboxInstance>;
  listProjectsProbe(params: VercelAuthParams): Promise<void>; // cheapest authenticated call; VERIFY best probe per SKILL.md (Sandbox.list works)
  getSnapshot(params: VercelAuthParams & { snapshotId: string }):
    Promise<{ status: string; delete(): Promise<void> } | null>; // null on not-found
}
export const liveVercelSdk: VercelSdk = /* wraps Sandbox/Snapshot from "@vercel/sandbox" */;
```

VERIFY exact SDK v2 parameter names (`sandboxId` vs `name` on `Sandbox.get`, detached runCommand support, create option names) against `.agents/skills/vercel-sandbox/SKILL.md` and the package's `.d.ts` before finalizing. Adjust the wrapper internals, not its interface.

### 1.5 `src/bootstrap.ts`

- `SANDBOX_HOME = "/home/katacode"`.
- `buildBootstrapScript(): string` returns a single `sh -c` script that: creates `SANDBOX_HOME` owned by the current user (`sudo mkdir -p /home/katacode && sudo chown "$(id -u):$(id -g)" /home/katacode` with a no-sudo fallback), then `npm install -g @kata-sh/code-cli @openai/codex @anthropic-ai/claude-code opencode-ai @xai-official/grok @earendil-works/pi-coding-agent`. Echo stage markers so failures are attributable.
- `buildServeCommand(input: { port: number; env: ReadonlyArray<readonly [string, string]> }): string` returns a detached launch command: `nohup env HOME=/home/katacode <K=V pairs> katacode serve --port <port> > /tmp/katacode-serve.log 2>&1 &`. Single-quote values, escaping embedded quotes. Env is inlined at launch (not baked at create) so resume can restart with a fresh bootstrap token.

### 1.6 `src/VercelSandboxProvider.ts`

```ts
export const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");
export interface VercelSandboxHandleState {
  readonly sandboxId: string;
  readonly port: number;
  readonly domainBase: string; // sandbox.domain(port) host URL captured at provision
  readonly timeoutMs: number;
  readonly auth: VercelAuthParams;
  readonly bootedFromSnapshotId?: string;
}
```

The handle state must be plain serializable data (no live SDK object); every method re-fetches the instance with `sdk.get({ sandboxId, resume: false, ...auth })` when it needs one.

SPI mapping (each method wraps SDK promises in `Effect.tryPromise` style helpers mapping errors per the table below; mirror the Docker driver's structure):

- `validate(config)`: decode via `vercelConfigDecoder` (module-scope `Schema.decodeUnknownSync(VercelSandboxConfig)`). Missing `auth` -> `invalid-config` with message `Set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID as sensitive environment variables on this deployment target.`. Probe credentials via `sdk.listProjectsProbe`. If `sourceType === "snapshot"`: require `snapshotId` and `sdk.getSnapshot(...).status === "created"`, else `invalid-config` (no silent fallback to base, spec decision 6).
- `provision(req)`:
  1. Decode `req.config`; require `auth` (invalid-config otherwise).
  2. `sdk.create({ ...(sourceType === "snapshot" ? { source: { type: "snapshot", snapshotId } } : { runtime }), resources: vcpus ? { vcpus } : undefined, ports: [config.port], timeout: config.timeoutMs, env: buildCreateEnv(req), ...auth })`. NEVER retry create.
  3. When `sourceType === "runtime"`: run `buildBootstrapScript()` blocking; non-zero exit -> `provision-failed` with stderr tail, after best-effort `delete()`.
  4. Launch serve detached with `buildServeCommand({ port, env: filteredEnv(req) })` where `filteredEnv` drops names in `VERCEL_AUTH_ENV_VARS` and adds `KATACODE_PORT`, `KATACODE_HOST=0.0.0.0`, `KATACODE_MODE=desktop`, `KATACODE_NO_BROWSER=true` (mirror `buildContainerEnv` in the Docker driver).
  5. Poll `https://<sb.domain(port)>/healthz` every 500 ms up to 240 attempts (120 s), each probe with `AbortSignal.timeout(3000)`; failure -> `timeout` + best-effort `delete()`.
  6. Return handle with `VercelSandboxHandleState`.
- `exec(handle, command, opts)`: `runCommand({ cmd: "sh", args: ["-c", "export HOME=/home/katacode; " + (opts?.cwd ? `cd '${opts.cwd}'; ` : "") + command] })`; map to `{ exitCode, stdout, stderr }`.
- `reachability(handle, port)`: pure. `{ reachabilityKind: "public", httpBaseUrl: "https://" + domainHost, wsBaseUrl: "wss://" + domainHost }` where domainHost comes from `sdk.get` + `domain(port)` (or the stored `domainBase` when `port === handle.port`).
- `dispose(handle)`: `sdk.get` then `delete()`; tolerate not-found (already gone) as success.
- `describe()`: `{ kind: VERCEL_KIND, reachabilityKind: "public", maxLifetimeMs: 86_400_000, supportsSnapshot: true, supportsRenewTimeout: true, supportsCopyInto: true, supportsResume: true }`.
- `snapshot.createSnapshot(handle, { name })`: `sb.snapshot({ expiration: 0 })` -> `{ snapshotId }`. JSDoc MUST state this stops the sandbox (caller treats the session as lapsed).
- `snapshot.deleteSnapshot(id)` / `snapshotExists(id)`: `sdk.getSnapshot`; exists = `status === "created"`; null -> false. Note: these take no handle, so they cannot reach per-instance auth. Implement them on the provider built by `makeVercelSandboxProvider` reading auth from a mutable last-used-auth captured at validate/provision time, OR simpler and preferred: have `makeVercelSandboxProvider` accept an optional `authResolver`; for V1 store the auth from the most recent successful `validate`/`provision` in the provider closure and fail with `invalid-config` ("validate the target first") when absent. Document this limitation in the module header.
- `renewTimeout.renewTimeout(handle, extendMs)`: `sdk.get` then `extendTimeout(extendMs)`.
- `copyInto.copyInto(handle, archive, destPath)`: `writeFiles([{ path: "/tmp/kata-seed-<randomhex>.tar", content: Buffer.from(archive) }])` then exec `mkdir -p '<destPath>' && tar -xf '<tmp>' -C '<destPath>' && rm -f '<tmp>'`.
- `resume.resume(handle, req)`: `sdk.get({ sandboxId, resume: true, ...auth })`; on not-found fail `provision-failed` with message `Sandbox is gone; recreate from its snapshot or start a new session.` (the server layer handles snapshot-fallback). On success: relaunch serve detached with the new env, healthz-poll as in provision, return the (unchanged-state) handle.

Error mapping table (implement one `mapSdkError(context, error)` helper):

| Condition                                                | reason             |
| -------------------------------------------------------- | ------------------ |
| decode failure / missing auth / missing or dead snapshot | `invalid-config`   |
| SDK 401/403/project-not-found                            | `invalid-config`   |
| create failure (429/5xx/network)                         | `provision-failed` |
| bootstrap script non-zero                                | `provision-failed` |
| healthz never 200                                        | `timeout`          |
| runCommand transport failure                             | `exec-failed`      |
| delete failure (non-404)                                 | `dispose-failed`   |
| anything else                                            | `unknown`          |

### 1.7 Unit tests

`src/config.test.ts`:

1. decodes a minimal config and applies no hidden defaults (decode of `DEFAULT_VERCEL_CONFIG` round-trips)
2. rejects malformed config (bad port, unknown sourceType)
3. `mergeVercelAuthIntoConfig` injects the trio from instance environment
4. `mergeVercelAuthIntoConfig` leaves config unchanged when any variable is missing

`src/VercelSandboxProvider.test.ts` (fake `VercelSdk` recording calls): 5. validate fails `invalid-config` without auth 6. validate fails `invalid-config` when configured snapshot is missing or not `created` 7. provision creates from runtime and runs the bootstrap script 8. provision creates from snapshot source and skips the bootstrap script 9. provision excludes VERCEL_TOKEN/VERCEL_TEAM_ID/VERCEL_PROJECT_ID from sandbox env 10. reachability maps domain to https/wss public URLs 11. renewTimeout forwards the delta to extendTimeout 12. dispose deletes and tolerates already-deleted 13. copyInto writes the tar and extracts at destPath 14. createSnapshot returns the snapshot id 15. resume calls get with `resume: true` and restarts serve 16. describe advertises public/snapshot/renewTimeout/copyInto/resume; plus a type-level `VercelSandboxProvider satisfies SandboxProvider` assertion (AC-3b.1)

---

## M2: Server integration

Commit: `feat(server): register vercel sandbox driver with public connect registration`

All in `apps/server` (add `@kata-sh/code-sandbox-vercel: workspace:*` to `apps/server/package.json`).

### 2.1 Registration + auth merge (`apps/server/src/sandbox/SandboxService.ts`)

- `buildRegistry()` (~line 90): `registry.register(VercelSandboxProvider, vercelConfigDecoder);`.
- New helper near the top:
  ```ts
  function resolveInstanceEnvelope(
    config: SandboxProviderInstanceConfig,
  ): SandboxProviderInstanceConfig {
    return (config.driver as string) === (VERCEL_KIND as string)
      ? mergeVercelAuthIntoConfig(config)
      : config;
  }
  ```
  Apply before every `materializeOne`/`materialize` call: `listInstances`, `testConnection`, `startSession` (and M3's resume). Settings reaching these methods already have secrets materialized, so the merge sees real values. `serverSettings.ts` needs no change (verify by reading `materializeSandboxProviderEnvironmentSecrets`; the trio flows through the generic `sandbox-env-*` path).

### 2.2 Port + public endpoint + Connect registration

- Add `resolveSandboxPort(config: unknown): number` (duck-typed `port` number, fallback 13773) next to `resolveProvisionImage`; use it at the `reachability(handle, 13773)` call (~line 836).
- Endpoint construction (~line 844): `reachability: reach.reachabilityKind` instead of hardcoded `"loopback"` (VERIFY `createAdvertisedEndpoint`'s accepted reachability values in `packages/shared/src/advertisedEndpoint.ts`; `SandboxReachabilityKind` values line up).
- `registerSandboxWithConnect` (~line 438): extend its input with `readonly endpointProviderKind: RelayManagedEndpointProviderKind` and `readonly origin: { localHttpHost: string; localHttpPort: number }`; replace the hardcoded `providerKind: "cloudflare_tunnel"` and `origin { localHttpHost: "127.0.0.1", ... }` with the inputs.
- In `startSession`, compute per reachability:
  ```ts
  const isLoopback = reach.reachabilityKind === "loopback";
  const connectBaseUrl = isLoopback
    ? reach.httpBaseUrl.replace("localhost", "127.0.0.1")
    : reach.httpBaseUrl;
  const connectUrl = new URL(connectBaseUrl);
  const origin = isLoopback
    ? { localHttpHost: "127.0.0.1", localHttpPort: Number(connectUrl.port || 80) }
    : { localHttpHost: connectUrl.hostname, localHttpPort: Number(connectUrl.port || 443) };
  const endpointProviderKind = isLoopback ? ("cloudflare_tunnel" as const) : ("manual" as const);
  ```
  Pass `connectBaseUrl` where `loopbackHttpBaseUrl` is used today (bootstrap exchange, pairing credential, provider refresh).
- Label: when the driver kind is vercel, use endpoint provider `{ id: "sandbox-vercel", label: "Vercel Sandbox", kind: "manual", isAddon: false }` instead of `SANDBOX_ENDPOINT_PROVIDER`; default card label `Vercel ${instanceId}`.

### 2.3 Docker-needed fail-loud (spec decision 10)

In `startSession` immediately after `loadEnvironmentConfig` succeeds:

```ts
if (loaded.resolved.build?.dockerfile !== undefined && (inst.driver.kind as string) !== "docker") {
  // disposeAfterFailure(...) then fail:
  return (
    yield *
    new SandboxRpcError({
      reason: "invalid-config",
      message: `.kata/environment.json requests a Dockerfile build, which the "${inst.driver.kind as string}" sandbox driver does not support. Use a local Docker deployment target for this repository.`,
    })
  );
}
```

VERIFY the exact shape of `loaded.resolved` (`ResolvedEnvironmentConfig` in `packages/sandbox/src/environmentResolver.ts`).

### 2.4 OpenCode credential seed spec

`apps/server/src/sandbox/credentialSeed.ts`: append to `PROVIDER_SPECS`:

```ts
{
  name: "opencode",
  hostDir: ".local/share/opencode",
  containerRelative: ".local/share/opencode",
  authFiles: ["auth.json"],
  excludes: OPENCODE_EXCLUDES, // new const: log, cache, storage, snapshot, tui, node_modules, .DS_Store
},
```

Note: spec decision 7 names `/home/katacode/.config/opencode/auth.json`; OpenCode actually reads auth from XDG data home (`~/.local/share/opencode/auth.json`). Seed the data-home path; record the spec-path discrepancy in the build log. VERIFY in-sandbox during M6 UAT with `opencode auth list`.

Add a unit test in the existing `credentialSeed` test file (VERIFY name; likely `credentialSeed.test.ts`): opencode auth.json lands in the credentials archive at `.local/share/opencode/auth.json`.

### 2.5 Milestone gate

`vp run typecheck && vp run test && vp check`, plus the existing Docker e2e still passes: `vp run e2e --project desktop-dev --grep @environments-deploy` (requires Docker + `katacode:local` image; if unavailable locally, state so explicitly in the completion report rather than claiming green).

---

## M3: Lifecycle (contracts, RPCs, keepalive, lapse, resume, snapshot)

Commit: `feat(sandbox): session keepalive, lapse, resume and snapshot lifecycle`

### 3.1 Contracts (`packages/contracts/src/sandboxRpc.ts`)

- Extend `SandboxRunningSession` with optional fields (optional keeps old clients decoding):
  `status: Schema.optional(Schema.Literals(["running", "lapsed"]))`, `deadlineEpochMs: Schema.optional(Schema.Number)`, `snapshotId: Schema.optional(TrimmedNonEmptyString)`, `lapsedReason: Schema.optional(Schema.String)`.
- Extend the `available` branch of `SandboxInstanceSummary` with `supportsResume: Schema.optional(Schema.Boolean)`.
- New schemas: `SandboxRenewSessionInput { instanceId, extendMs?: Schema.optional(Schema.Number) }`, `SandboxRenewSessionResult { instanceId, deadlineEpochMs: Schema.Number }`; `SandboxResumeSessionInput { instanceId, connectAuthToken?: (same shape as start) }`, `SandboxResumeSessionResult` (same fields as `SandboxStartSessionResult`); `SandboxCreateSnapshotInput { instanceId, name?: Schema.optional(TrimmedNonEmptyString) }`, `SandboxCreateSnapshotResult { instanceId, snapshotId: TrimmedNonEmptyString }`.
- `packages/sandbox-contracts/src/sessionState.ts`: add `"lapsed"` to `SandboxSessionState` literals (currently unused by runtime code; keeps the canonical vocabulary aligned).

### 3.2 RPC plumbing

- `packages/contracts/src/rpc.ts` `WS_METHODS`: `sandboxRenewSession: "sandbox.renewSession"`, `sandboxResumeSession: "sandbox.resumeSession"`, `sandboxCreateSnapshot: "sandbox.createSnapshot"`. Add `Rpc.make` definitions mirroring `WsSandboxStartSessionRpc` (same error union) and register them wherever `WsSandboxDisposeSessionRpc` is grouped.
- `packages/client-runtime/src/wsRpcClient.ts`: add `renewSession`, `resumeSession`, `createSnapshot` to the sandbox namespace (unary, mirror `startSession`).
- `apps/server/src/ws.ts`: scopes for all three -> `AuthOrchestrationOperateScope` (~line 210); handlers mirroring the existing four (~line 1076). `resumeSession` needs settings piped in like `startSession`.

### 3.3 Keepalive scheduler (`apps/server/src/sandbox/sessionKeepalive.ts`, new)

```ts
export interface KeepaliveHandle {
  stop(): void;
}
export function startSessionKeepalive(input: {
  readonly driver: SandboxProvider; // must have renewTimeout (caller guards)
  readonly handle: SandboxHandle;
  readonly timeoutMs: number;
  readonly onDeadline: (deadlineEpochMs: number) => void;
  readonly onLapse: (reason: string) => void;
}): KeepaliveHandle;
```

- Initial deadline: `Date.now() + timeoutMs`; call `onDeadline` immediately.
- Interval: `Math.max(60_000, Math.min(Math.floor(timeoutMs / 3), 600_000))`, `setInterval(...).unref()`.
- Each tick: `delta = Date.now() + timeoutMs - deadlineEpochMs`; skip if `delta <= 0`; run `driver.renewTimeout.renewTimeout(handle, delta)` via `Effect.runPromise`; on success `deadlineEpochMs += delta; onDeadline(deadlineEpochMs)`; on failure `stop()` then `onLapse(message)` (renew failure means plan cap reached or sandbox stopped, AC-3b.5).
- Unit tests in `sessionKeepalive.test.ts` with fake timers and a stub driver: extends by the elapsed delta; lapses and stops on renewal failure.

### 3.4 `SandboxService.ts` session-state extension

`RunningSession` gains mutable fields: `status: "running" | "lapsed"`, `deadlineEpochMs?: number`, `lapsedReason?: string`, `snapshotId?: string`, `keepalive?: KeepaliveHandle | null`, plus `readonly instanceConfig: SandboxProviderInstanceConfig` (the resolved envelope, cached for resume).

- `markSessionLapsed(sessionKey, reason)`: set status/reason, `keepalive?.stop()`, keep the relay link (resume re-registers over the same environment id). In-flight agent streams surface the endpoint-unreachable error the client already shows; note this in the UAT script (AC-3b.5's "explicit error").
- `toSummary` (~line 98): include the new `runningSession` fields and `supportsResume: descriptor.supportsResume`.
- `startSession`: after `runningSessions.set(...)`, when `inst.driver.renewTimeout` exists: `startSessionKeepalive({ driver, handle, timeoutMs: resolveSandboxTimeoutMs(inst.config), onDeadline: mutate record, onLapse: (r) => markSessionLapsed(sessionKey, r) })`. New helper `resolveSandboxTimeoutMs(config: unknown): number` (duck-typed `timeoutMs`, fallback 2_700_000).
- `disposeSession`: `record.keepalive?.stop()` before driver dispose; allow disposing lapsed sessions (driver dispose tolerates already-gone).

### 3.5 startSession refactor + resume/renew/snapshot methods

Extract from `startSession` (same file, private functions) so resume reuses them without duplicating the 200-line body:

- `resolveAvailableInstance(instanceId, settings)`: envelope lookup + `resolveInstanceEnvelope` + `materializeOne` + error mapping. Use in `startSession` and `resumeSession`.
- `registerAndFinalizeSession(input: { instanceId; displayName?; driverKind; inst; handle; bootstrapToken; connectAuthToken })`: reachability -> endpoint (2.2 logic) -> `registerSandboxWithConnect` -> `issueSandboxPairingCredential` -> `refreshSandboxProviders`. Returns `{ endpoint, environmentId, pairingToken, relay }`. Keep the existing `disposeAfterFailure` wrapping inside.

New service methods:

- `renewSession(instanceId, input?: { extendMs?: number })`: record must exist with `status === "running"` (else `not-running`); driver must have `renewTimeout` (else `not-running` with message); `extendMs` defaults to `resolveSandboxTimeoutMs`; call driver; on success bump `deadlineEpochMs`, return `{ instanceId, deadlineEpochMs }`; on failure `markSessionLapsed` when the error indicates a stopped sandbox, and map the driver error.
- `resumeSession(instanceId, settings, options?)`:
  1. `record = runningSessions.get(key)`; require `record?.status === "lapsed"` else `not-running` ("no lapsed session to resume").
  2. Require `record.driver.resume` else `not-running`.
  3. Fresh bootstrap token; rebuild env via `buildProvisionEnvironment` with the cached `record.instanceConfig.environment` and saved env unchanged.
  4. `record.driver.resume.resume(record.handle, { config: inst.config, env })`; if it fails AND `record.snapshotId` exists, fall back to `inst.driver.provision` with config overridden `{ ...inst.config, sourceType: "snapshot", snapshotId: record.snapshotId }` (build the override with a driver-agnostic spread; only the vercel driver reads those keys). Remaining failure surfaces visibly (AC-3b.6): map to `provision-failed` mentioning expired/missing snapshot.
  5. `registerAndFinalizeSession` with the new handle; mutate record (handle, endpoint, environmentId, status `"running"`, restart keepalive). Return the start-shaped result.
- `createSessionSnapshot(instanceId, input?: { name?: string })`: record must exist; driver must have `snapshot`; call `createSnapshot(handle, { name })`; set `record.snapshotId`; because the vercel snapshot stops the VM, when `(record.driver.kind as string) === "vercel"` call `markSessionLapsed(key, "snapshotted")` (comment why the gate is kind-based); return `{ instanceId, snapshotId }` (AC-3b.7; the UI offers persisting the id into target config).

Wire the three into `ws.ts` handlers.

---

## M4: Web UI

Commit: `feat(web): vercel deployment target with lifetime, resume and snapshot controls`

All in `apps/web/src/components/settings/SandboxDeploymentSettings.tsx` unless noted. Inline strings, manual `useState` validation, no form library (existing convention).

1. `const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");` next to `DOCKER_KIND` (line ~54).
2. `AddDeploymentTargetDialogBody` (~line 877): add a driver `<select>` with options `Local container (Docker)` and `Vercel Sandbox`. Instance id `${driver}_${slugifyLabel(label)}`. For vercel, on submit: `{ driver: VERCEL_KIND, enabled: true, displayName, config: { runtime: "node24", sourceType: "runtime", timeoutMs: 2_700_000, port: 13773 } }` and helper text: `After creating, add VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID as sensitive environment variables on the target.` Keep the Docker fields rendered only when driver === docker.
3. New `VercelConfigFields({ config, idPrefix, onChange })` beside `DockerConfigFields` (~line 808) using the existing `readConfigString`/`readConfigNumber`/`setConfigField` helpers: Runtime (text), Boot source (`<select>` runtime/snapshot), Snapshot id (text, shown when snapshot), Timeout minutes (number input converting to/from `timeoutMs`), Port (number, reuse `parseContainerPort`), vCPUs (optional number).
4. `DeploymentTargetCard` (~line 537): branch on `instance.driver` to render `VercelConfigFields`; the existing `ProviderEnvironmentSection` already gives the write-only secret editor for the trio; for vercel targets add a caption listing the three required names.
5. Running-session block additions (card already receives `SandboxInstanceSummary`):
   - `runningSession.status === "lapsed"`: amber `Lapsed` badge + `lapsedReason` + `Resume` button -> `client.sandbox.resumeSession({ instanceId, connectAuthToken })` (same Connect token acquisition as `handleStart`), then the same post-start bookkeeping as `handleStart` (re-`addSavedEnvironment` with returned pairingToken/endpoint) and `refreshList()`.
   - running with `deadlineEpochMs`: countdown label (`Expires in 42m`, recomputed on a 30 s interval effect) + `Extend` button -> `client.sandbox.renewSession({ instanceId })` then `refreshList()`.
   - `supportsSnapshot` and running: `Snapshot` button behind a confirm dialog whose copy states `Snapshotting pauses the sandbox; Resume to continue.` -> `client.sandbox.createSnapshot({ instanceId })`; on success show the snapshot id on the card and a `Use as boot source` action that writes `sourceType: "snapshot"` + `snapshotId` into the target config via the existing settings-update path (durable storage of the id, AC-3b.7).
6. `handleStart` (~line 236): pass `sandbox: { providerKind: instance.driver }` to `addSavedEnvironment` instead of hardcoded `"local"` (field is a free-form string; no contract change). Same for the resume path.
7. Gate `Start`/`Resume`/`Extend`/`Snapshot` with the existing `withBusy` mechanics.

Component test or existing settings test extension is optional here; the e2e in M6 covers the flow. `vp check` gate.

---

## M5: "Sign in <provider>" flow + stored credential seeding

Commit: `feat(sandbox): interactive provider sign-in with credential capture`

**Mandatory first task (spike UAT, maintainer-run):** in a real Vercel sandbox, run `claude setup-token` (and if unusable, `claude` login) under `script -qec "<cmd>" /tmp/out.log` with stdin from a FIFO. Confirm: it runs without a controlling terminal; the OAuth URL appears in the log; pasting the code via the FIFO completes; and whether the result is a written `~/.claude/.credentials.json` or a printed `sk-ant-oat...` token. Record findings in the build log. The `PROVIDER_LOGIN_SPECS` table below isolates every affected detail; adjust data, not architecture.

### 5.1 Stored-credential seeding (closes AC-3b.10/11 loop)

- `apps/server/src/sandbox/credentialSeed.ts`: extend `CredentialSeedInput` with `readonly storedCredentials?: ReadonlyArray<{ readonly relativePath: string; readonly content: Uint8Array; readonly mode?: number }>`. In `buildCredentialSeedArchives`, append each stored credential to the credentials archive UNLESS a host-collected file already produced the same `relativePath` (host wins; comment why: the host file is the live copy the user refreshes).
- New `apps/server/src/sandbox/storedSandboxCredentials.ts`:
  ```ts
  export const SANDBOX_CREDENTIAL_SECRETS = [
    {
      providerId: "claude",
      secretName: "sandbox-credential-claude",
      relativePath: ".claude/.credentials.json",
      mode: 0o600,
    },
    {
      providerId: "codex",
      secretName: "sandbox-credential-codex",
      relativePath: ".codex/auth.json",
      mode: 0o600,
    },
    {
      providerId: "opencode",
      secretName: "sandbox-credential-opencode",
      relativePath: ".local/share/opencode/auth.json",
      mode: 0o600,
    },
  ] as const;
  export function loadStoredSandboxCredentials(): Effect.Effect<
    ReadonlyArray<{ relativePath: string; content: Uint8Array; mode: number }>,
    never,
    ServerSecretStore
  >;
  ```
  `store.get` each secret, skip absent, never log contents.
- `SandboxService.runCredentialSeed`: load stored credentials and pass `storedCredentials` into `buildCredentialSeedArchives`. `ServerSecretStore` joins the effect context (it is a `Context.Service`; wire like `CliTokenManager` is wired; VERIFY how ws handlers provide layers in `apps/server/src/ws.ts`).
- Unit tests: stored credential lands in the archive; host file wins on collision.

### 5.2 Contracts + RPCs

`packages/contracts/src/sandboxRpc.ts`:

- `SandboxProviderLoginStartInput { instanceId, providerId: TrimmedNonEmptyString }`
- `SandboxProviderLoginEvent` union (tagged by `stage`): `started { loginSessionId }`, `url { loginSessionId, url }`, `awaiting-code { loginSessionId }`, `invalid-code { loginSessionId, detail?: Schema.optional(Schema.String) }`, `success { loginSessionId, credentialStored: Schema.Boolean }`, `error { loginSessionId, message }`
- `SandboxProviderLoginSubmitCodeInput { instanceId, loginSessionId, code: TrimmedNonEmptyString }` / `...Result { loginSessionId, accepted: Schema.Boolean }`

`rpc.ts` `WS_METHODS`: `sandboxProviderLoginStart: "sandbox.providerLoginStart"` (stream, mirror `WsSandboxTestConnectionRpc`), `sandboxProviderLoginSubmitCode: "sandbox.providerLoginSubmitCode"` (unary). Client methods in `wsRpcClient.ts`: `providerLoginStart(input, onEvent)` (mirror `testConnection`), `providerLoginSubmitCode(input)`. `ws.ts`: both -> `AuthOrchestrationOperateScope`.

### 5.3 Server login sessions (`apps/server/src/sandbox/providerLogin.ts`, new)

```ts
interface ProviderLoginSpec {
  readonly providerId: string;
  readonly loginCommand: string; // run under script(1) inside the sandbox
  readonly urlPattern: RegExp;
  readonly invalidCodePattern: RegExp;
  readonly credentialPath: string; // absolute in-sandbox path of the resulting auth file
  readonly secretName: string; // ServerSecretStore key
}
export const PROVIDER_LOGIN_SPECS: ReadonlyArray<ProviderLoginSpec> = [
  {
    providerId: "claude",
    loginCommand: "env HOME=/home/katacode claude setup-token", // adjust per spike findings
    urlPattern:
      /https:\/\/(?:claude\.ai|claude\.com|console\.anthropic\.com)\/[^\s"'<>)\]]*oauth[^\s"'<>)\]]*/iu,
    invalidCodePattern: /invalid|incorrect|expired|try again|rejected/iu,
    credentialPath: "/home/katacode/.claude/.credentials.json",
    secretName: "sandbox-credential-claude",
  },
];
```

- `startProviderLogin({ driver, handle, providerId })` returns an Effect stream of `SandboxProviderLoginEvent` (mirror how `testConnection` streams progress; VERIFY the stream helper used there):
  1. `loginSessionId = randomBytes(8).toString("hex")`; workdir `/tmp/kata-login/<id>`.
  2. `driver.exec`: `mkdir -p <dir> && mkfifo <dir>/stdin.fifo`.
  3. Detached launch (same `setsid sh -c '... &'` shape as `sandboxSetupRunner.ts`): `tail -f <dir>/stdin.fifo | script -qec "<loginCommand>" <dir>/output.log`. `script(1)` allocates the PTY the CLI needs; `tail -f` keeps stdin open across the URL-then-code sequence.
  4. Register in a module-level `activeLogins: Map<loginSessionId, { instanceId, spec, driver, handle, dir }>`.
  5. Poll loop (1 s tick, 180 s budget): `driver.exec("cat <dir>/output.log")`, strip ANSI (helper regex `/\[[0-9;?]*[ -\/]*[@-~]/g` plus OSC), match `urlPattern`; emit `url` once then `awaiting-code`; on budget exhaustion emit `error` and cleanup.
- `submitProviderLoginCode({ loginSessionId, code })`:
  1. Reject codes failing `/^[A-Za-z0-9#_-]{4,256}$/` (injection guard).
  2. `driver.exec`: `printf '%s\n' '<code>' > <dir>/stdin.fifo`.
  3. Poll (1 s tick, 90 s budget): success when `test -f <credentialPath>` exits 0; on success `driver.exec("cat <credentialPath>")` -> `ServerSecretStore.set(spec.secretName, bytes)` -> `{ accepted: true }`; when output matches `invalidCodePattern` -> `{ accepted: false }` (UI re-prompts, same login session stays alive); budget exhaustion -> error.
  4. Cleanup on terminal states: `driver.exec("pkill -f '<dir>' ; rm -rf <dir>")` best-effort; delete from `activeLogins`.
- Credential bytes are never logged; the RPC only reports `credentialStored: true`.
- `SandboxService` exposes `providerLoginStart` / `providerLoginSubmitCode` delegating to this module (record lookup by instanceId gives driver+handle; require a running session else `not-running`).

### 5.4 UI

- New `apps/web/src/components/settings/ProviderSignInDialog.tsx`: props `{ instanceId, providerId, onClose }`. States: starting -> url shown (copy button + open-in-browser link) -> code input -> submitting -> success (toast `Credential stored for future deployments`) | invalid-code (re-prompt with message) | error. Drives `client.sandbox.providerLoginStart` on mount and `providerLoginSubmitCode` on submit.
- `SandboxDeploymentSettings.tsx`: on a running vercel session card, render a `Sign in Claude` button opening the dialog (provider list = `PROVIDER_LOGIN_SPECS` ids; V1 hardcodes claude client-side).
- `apps/web/src/components/chat/ProviderStatusBanner.tsx`: when the provider is unauthenticated, extend the copy to mention sandbox sign-in: `Sign in via the CLI, or from the deployment target card in Settings -> Environments for sandbox sessions.` (The banner has no sandbox context prop today; a deep-link button is optional polish, not required by AC-3b.11.)

---

## M6: Tests, e2e, UAT

Commit: `test(sandbox-vercel): credentialed integration tests and environments-deploy e2e`

### 6.1 Credentialed integration tests (maintainer-local)

`packages/sandbox-vercel/src/VercelSandboxProvider.integration.test.ts`, guarded:

```ts
const creds = process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID;
describe.skipIf(!creds)("vercel driver (credentialed)", () => { ... });
```

Tests: validate with a bad token -> `invalid-config` (AC-3b.2); provision from runtime -> healthz 200 -> log time-to-ready -> dispose (AC-3b.3); reachability wss URL accepts a WebSocket connection (AC-3b.4); createSnapshot then provision-from-snapshot skips bootstrap and logs time-to-ready for comparison (AC-3b.7). Keep each test disposing its sandbox in a `finally`.

### 6.2 e2e

- `e2e/src/harness/env.ts`: add `readVercelCredentials(): { token, teamId, projectId } | null` (null unless all three env vars set). Unlike the Docker hard-fail helpers, Vercel tests SKIP when null (`test.skip(...)` with message `VERCEL_* credentials not set; credentialed Vercel checks are maintainer-local`).
- New `e2e/tests/environments-deploy/vercel-deploy.spec.ts` tagged `E2E_TAGS.environmentsDeploy`, skip-guarded: add a Vercel target via the settings UI (driver picker), enter the trio as sensitive env vars, Test connection, Start, assert card shows running + public endpoint + appears in the Add project picker (AC-3b.8), Dispose and assert removal (AC-3b.12).
- Uncredentialed CI: `container-deploy.spec.ts` stays green (AC-3b.13).

### 6.3 AC verification map

| AC    | Evidence                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------- |
| 3b.1  | M1 test 16 (conformance + describe)                                                                  |
| 3b.2  | M1 tests 3-6 + credentialed validate test                                                            |
| 3b.3  | Credentialed provision test                                                                          |
| 3b.4  | M1 test 10 + credentialed wss test                                                                   |
| 3b.5  | Keepalive unit tests + recorded UAT (countdown, lapse on cap)                                        |
| 3b.6  | Resume service test with stub driver + recorded UAT (lapse then Resume)                              |
| 3b.7  | M1 test 14 + credentialed snapshot/boot test with timings                                            |
| 3b.8  | `vercel-deploy.spec.ts` (credentialed)                                                               |
| 3b.9  | Manual UAT: second paired client reaches the sandbox via Connect                                     |
| 3b.10 | Credentialed/manual UAT: stored claude credential -> provider reports authenticated without env vars |
| 3b.11 | Manual UAT: Sign in Claude relays URL + code, credential stored, next provision authenticated        |
| 3b.12 | e2e dispose step + manual UAT second-client unreachability                                           |
| 3b.13 | All four gate commands green; record which credentialed items ran maintainer-local                   |

Record manual UAT evidence in the build report (screenshots or terminal transcripts), per repo plan-build-verify conventions.

## Verification (end-to-end)

1. `vp run typecheck && vp run test && vp check` at repo root.
2. `vp run e2e --project desktop-dev --grep @environments-deploy` (Docker suite always; Vercel spec when credentials exported).
3. Maintainer-local with `VERCEL_TOKEN`/`VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID` exported: run the credentialed integration tests, then a full manual pass: create target -> test -> start -> countdown visible -> extend -> snapshot (lapses) -> resume -> sign in claude -> dispose.
4. Fail-loud policy: report any skipped credentialed test or unavailable local prerequisite explicitly; do not claim an AC verified without its listed evidence.

## Risks / open questions

1. `claude setup-token` under `script(1)` is unverified (M5 spike resolves; spec table isolates the blast radius).
2. OpenCode auth path: spec says `~/.config/opencode/auth.json`, actual XDG data path is `~/.local/share/opencode/auth.json`; seeding targets the data path, discrepancy recorded for a spec erratum.
3. Vercel SDK v2 parameter names (get-by-id vs name, detached runCommand) must be confirmed against the installed `.d.ts`; the `VercelSdk` wrapper confines changes.
4. `snapshot.deleteSnapshot`/`snapshotExists` take no handle, so per-instance auth is unavailable; V1 uses last-validated auth captured in the provider closure and fails with guidance otherwise (documented limitation).
5. Keepalive renews indefinitely while the session record exists (billable on Pro up to 24 h); dispose-when-done is the documented control; idle-pause is deferred work.
6. `RunningSession` is not durable across server restarts (pre-existing Phase 1 limitation, more visible now that sandboxes outlive restarts); add to `docs/specs/deferred-work.md`.
7. `testConnection` for a Vercel target provisions a real, billed sandbox; card copy for Test should note it.
