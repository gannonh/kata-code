# KAT-3471 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `f73921e6f321b4c47220d501a0f6b73baa97c7a3` (`origin/main` 2026-09-25T07:00Z) |
| Previous upstream pin  | `e67abcf798f8c4d8458755e3b4dde02c2c1f628b`                                   |
| Frozen upstream target | `b3de243d5ed44783c4e7990d8e63cb519d390a03` (frozen 2026-09-25T07:01Z)        |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20260925T070053Z-claude-mini` froze a range of 52 commits and 530 changed paths. The previous pin is an ancestor of the target. The range adds one server migration, one relay Postgres migration, and edits three workflow files. It has no `.repos/` or `.plans/` paths.

KAT-3454 landed the previous pin through PR #269 as squash `96e7d288e8a6cb3a878985670c680cca7228ef4f` (single parent `14469eaf6a1aa52a3943d12338dcf780f0596c30`), so `e67abcf79` is not an ancestor of the Kata base. `docs/upstream/kat-3454-intake.md` accounts for that exact pin, including its SKIPs. The branch records it with `git merge --strategy=ours --no-ff` as `9be8826c3525307c8b589897d72cd8f43085445c`; the tree equals the base and `git merge-base --all HEAD b3de243d5` returns exactly `e67abcf79`. The three-way merge of `b3de243d5` follows.

## TAKE

- Merge frozen tip `b3de243d5` with a normal three-way merge after the anchor.
- Take the upstream product changes with `@t3tools/*` imports mapped to `@kata-sh/code-*`: Android foldable Device panel controls and the procedural fold scene, the per-thread auto-settle switch, Claude banked resets and the shared reset-credit coordinator, Codex 0.156 and its regenerated protocol, Codex instructions moved into `turn/start.additionalContext`, shell commands from chat in the thread terminal, background sync for running threads, desktop update reconnect in seconds, the V8 compile cache, Grok one-click updates and account email, preview errors that tell agents what to do, preview snapshot sizing, the agents-working banner link, the usage page keybinding, sidebar Back to the main app, theme-token class cleanups, the Android usage widget scroll and titles, mobile branch search, the CSV and racy-diff fixes, OTEL resource attribute tolerance, and related tests.
- Take Connect managed tunnel recovery and idle tunnel cleanup (`8d7b5e998c`), with the new JWT type under Kata wire identity. See the relay section.
- Take upstream migration 54 `ProjectionThreadsAutoSettleDisabledAt` as Kata migration 58. Kata IDs 1–57 are shipped. `KataUpstreamUpgrade.test.ts` now expects 43–58 after the Kata repairs and checks the new column.
- Take the V8 compile cache with two adaptations. Kata registers three desktop schemes, and only the production scheme opts into `codeCache`, matching upstream's "dev stays off". The on-disk cache lives under `katacode/compile-cache` rather than `t3code/compile-cache`, so a side-by-side T3 Code install does not share it (state isolation). The packaged entry becomes `boot.cjs`.
- Take `scripts/setup-worktree.ts` as the one-command `t3.json` Setup Worktree action, without upstream's env-file linking. Kata keeps secrets in the 1Password Environment and documents no dotenv files. The script reads no `T3CODE_PROJECT_ROOT`.
- Take the tunnel cleanup rollout and canary docs in `docs/operations/release.md` and the idle cleanup paragraph in `docs/user/remote-access.md`, with Kata Code Connect, `katacode`, and the Kata relay workflow name.
- Take upstream's `DesktopUpdates.ts` support for a `deb` package type. It is inert until Kata ships a `.deb` (KAT-3473).

## SKIP

- Skip `.macroscope/check-run-agents/*` edits (Kata deleted them, KAT-3297) and `infra/relay/src/clientConfig.test.ts` (Kata deleted `clientConfig.ts`, KAT-3411).
- Skip the new Apple `iphone-duo.glb` and the `sources.json` edit. `sources.json` records `"author": "Apple Inc."` and no redistribution license; KAT-3454 made the same SKIP and KAT-3455 holds the decision. `deviceModels.ts` still returns no model, so upstream's iPhone Duo 3D viewport and hinge controls stay inactive in Kata (`DeviceStreamView` renders them only when a Duo model exists). Android foldables use a procedural scene and work.
- Skip the Linux `.deb` release: the electron-builder `deb` target and config (`maintainer: "T3 Tools <hello@t3.codes>"`, `homepage`, dependencies, `XZ_DEFAULTS`), the `*.deb` release globs, the Blacksmith 16-vCPU arm64 runner, and the `.deb` lines in the README, install guide, and release doc. A new release artifact and Debian package identity belongs to `release-package-ownership`; KAT-3473 (Backlog) asks whether Kata ships one. `release.yml` and `release-desktop.yml` stay at base.
- Skip the sidebar stage backdrop, wordmark, and brand in `SidebarChrome.tsx` and `AppSidebarLayout.tsx`. KAT-3423 restored the bare Kata header.
- Skip upstream's inline add-environment render helpers in `ConnectionsSettings.tsx`. Kata's `AddEnvironmentDialog` owns sandboxes, SSH targets, and pairing (KAT-3297 decision 42, KAT-3441).
- Skip the upstream `WelcomeWizard` T3 wordmark and the `SettingsPanels` Legacy features heading style. Kata's header and folded-section styling stay.
- Skip upstream's dotenv dev-token guidance in `docs/operations/development.md`, and the package-manager install lists in `README.md` and `docs/user/install.md`. Kata publishes no package-manager packages.
- Skip upstream `AGENTS.md`, user-visible T3 names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations.
- Keep deliberate cleanup: deleted `.repos`, `.plans`, `.macroscope`, and parked workflows.

## Conflict resolutions

57 paths conflicted: 53 content conflicts and 4 Kata deletions of upstream-modified files. Resolutions not covered above:

- Scope-only conflicts (`BranchToolbar.logic.ts`, `threads.ts`, `SnapShotSetupDialog.tsx`, `ClaudeProvider.ts`, `antigravityAuthSupport.ts`, `Observability.ts`, `new-task-flow-provider.tsx`, `ProviderInstanceRegistryLive.test.ts`): Kata scope plus upstream's added imports.
- `ProviderCommandReactor.ts`: upstream's `Effect.asSome` with Kata's `markRoutineSubmissionFailure` before `handleTurnStartFailure`.
- `resetCreditCoordinator.ts`: upstream renamed `codexResetCredit.ts`. The service key takes upstream's private `t3/provider/Layers/resetCreditCoordinator`, which the identifier policy retains.
- `CodexDeveloperInstructions.ts`: Kata's only divergence was branding, so the file takes upstream's restructure and reapplies Kata Code names. `CodexSessionRuntime.test.ts` takes upstream's tests and adds two Kata assertions: runtime info says `running in Kata Code`, and the tool entry names the `Kata Code collaborative browser`.
- `T3ConnectUserProfilePage.tsx`, `ResourceTelemetryDiagnostics.tsx`: upstream's theme-token classes around Kata copy.
- `strings.xml`, `subscriptionUsageSnapshot.ts`, `usage.md`: upstream's new widget titles and Android 12L note with Kata Code copy.
- `mainAppLocation.ts`: `/routines` counts as a sidebar utility page, so Back from Kata's Routines page returns to the main app.
- `knip.jsonc`: Kata's `verify-kata-sandbox-image-vercel.test.ts` entry plus upstream's `setup-worktree.ts`.

## Clean merges and new files

Clean merges and new files received the same review as conflicts. Eighteen cleanly merged or new files arrived with `@t3tools` imports and were remapped. New user-visible copy was rebranded: the preview automation host error in `packages/contracts/src/previewAutomation.ts` now names the Kata Code desktop app. New assets are provider logos (`apps/mobile/assets/antigravity.png`) and marketing files, which FORK.md keeps T3-shaped. No new upstream environment variable is operator-facing except `T3CODE_PROJECT_ROOT` in `setup-worktree.ts`, which the adaptation removed. Process byte APIs, credential cleanup, sandbox bootstrap-token stripping, Docker/Sprite behavior, and the disabled-by-default sandbox preview are untouched by the range.

## Trusted assertions

The preservation gate requires each check's trusted test files to match the Kata base byte for byte. Upstream edited six of them:

| Trusted file                                                           | Upstream change                                                                | Resolution                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `apps/desktop/src/app/DesktopAppIdentity.test.ts`                      | Effect language service suggestion (#13536)                                    | Restored to base                                                               |
| `apps/desktop/src/window/DesktopWindow.test.ts`                        | Effect language service suggestion (#13536)                                    | Restored to base                                                               |
| `apps/desktop/src/backend/DesktopBackendManager.test.ts`               | Effect language service suggestion in a case Kata keeps in its companion suite | Restored to base                                                               |
| `scripts/build-desktop-artifact.test.ts`                               | `.deb` target assertion                                                        | Restored to base (`.deb` SKIP)                                                 |
| `apps/desktop/src/updates/DesktopUpdates.test.ts`                      | New `.deb` and update-restart marker cases                                     | Restored to base; the four new cases live in `DesktopUpdates.upstream.test.ts` |
| `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.test.ts` | Imports `resetCreditCoordinator.ts`; new Claude and Codex reset cases          | Taken. See below.                                                              |

`ProviderInstanceRegistryLive.test.ts` is irreducible in the KAT-3411 sense. The base file imports `./codexResetCredit.ts` and provides `CodexResetCredit.layerTest`; upstream deleted that module when it generalized reset credits to Claude. Keeping the base bytes makes the check's test command fail to load, and making the command pass changes the bytes. The retained behavior it guards (sandbox route and driver registration) is unchanged and still asserted in the file. `sandbox-route-driver-registration` therefore reports `trusted assertion changed apps/server/src/provider/Layers/ProviderInstanceRegistryLive.test.ts`. This run does not extend the `ci.yml` allowlist on its own authority; that is the decision requested on KAT-3471.

## Relay and Connect

Upstream `8d7b5e998c` adds managed tunnel recovery and idle tunnel cleanup across the server, relay, and client runtime. The resolution keeps every Kata Connect addition beside it:

- Wire identity stays Kata-owned. The new recovery proof type is `WIRE_RELAY_ENV_MANAGED_TUNNEL_RECOVERY_JWT_TYP = "kata-env-managed-tunnel-recovery+jwt"` in `packages/contracts/src/wireIdentity.ts`, and `relayJwt.ts` binds `RELAY_MANAGED_TUNNEL_RECOVERY_TYP` to it. Cleanly merged `iss: \`t3-env:...\``literals in`cloud/http.ts`and the relay tests use`wireEnvironmentIssuer`. The reaper service key and test tunnel prefix follow the Kata relay name (`kata-code-relay`, `katacoderelay-managedendpoint-prod-`). `scripts/check-connect-wire-identity.ts` passes on 25 files.
- The Kata Linear OAuth broker survives in `Config.ts`, `worker.ts` (its three layers and `LinearOAuthStates.pruneExpired` in the cron next to the new reaper sweep), `Api.ts` (grant revoke after upstream's deprovision retry on unlink), and `schema.ts`.
- `ManagedEndpointRuntime` exposes Kata's `getStatus` (used by `RoutineConnections`) and upstream's `recoveryRequests`, `requestRecovery`, and `withLinkStateLock`. `CliState` removes both `CLOUD_MANAGED_ENDPOINT_URL` and `CLOUD_ENDPOINT_CONFIRMED_ORIGIN`. `recoverManagedCloudTunnel` rewrites the routine callback URL, because a recovered tunnel can return on a new hostname.
- Changed Kata behavior, accepted as an adaptation: when the connector fails to start on a relay config save, upstream keeps the stored config so startup can retry instead of unwinding it. Kata previously removed the runtime config and the routine callback URL. The callback URL and `managedTunnelActive` now stay after a failed start, and `managedCallbackReady` stays false until the connector confirms the origin, so routine webhook registration sees the same not-ready state as before. `server.test.ts` records the new sequence.
- `deploy-relay.yml` takes `RELAY_TUNNEL_CLEANUP_MODE` (default `off`, per the rollout doc). It skips upstream's `push` trigger, the Blacksmith runner, the job-level `main` guard (it would block Kata's branch dry runs), and the `force` input. Kata changes the Worker revision on every deploy (`RELAY_DEPLOYMENT_REVISION`), and `infra/relay/scripts/deploy.test.ts` asserts no `deploy --force`.
- The new relay migration `20260919015455_managed_endpoint_recovery` is taken as is. The relay snapshot chain now has two heads, upstream's `20260919015455` and Kata's `20260920023350`, as Kata main already had before this range. KAT-3474 tracks a merge snapshot before the next relay deploy.
- `RoutineConnections.test.ts` gains upstream's three new runtime stubs.

## Lint and type fixes

Upstream's range turns on `shadcn(no-arbitrary-values)` through its class cleanups, and it flags Kata-owned classes. They move to same-value scale tokens: `text-[11px]` to `text-2xs` and `text-[10px]` to `text-3xs` in `SandboxGitHubSourcePicker.tsx`, `RoutineChat.tsx`, and `AddEnvironmentDialog.tsx`, and `tracking-[-0.025em]` to `tracking-tight` in `SettingsPanels.tsx`. The Kata welcome title `text-[1.4rem]` becomes `text-2xl`, upstream's size at the same place. `compileCache.ts` uses the `kata-code/no-global-process-runtime` rule name.

`packages/client-runtime` re-adds the `./state/entities` export that KAT-3326 removed as unused, because upstream's `apps/web/src/state/threads.ts` now imports `arrayElementsEqual` from it. `apps/web/src/state/projects.ts` annotates `projectEnvironment` with `ReturnType<typeof createProjectEnvironmentAtoms>`; without it `tsc` reports TS2883 (non-portable inferred type through the unexported `operations/workspaceProject` module).

## Host limits

Local verification runs on a macOS arm64 Mac mini inside a Kata Code agent shell with `ELECTRON_RUN_AS_NODE` unset (KAT-3452). The 37 `storage cleanup` cases in `ThreadSettlementReactor.test.ts` fail on this host because the temporary base directory path contains a symlink (KAT-3453). They fail identically on landed main `96e7d288e`, and CI runs them on Linux.
