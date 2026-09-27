# KAT-3532 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `22e495d981760351797a789d934a049b9efbbb64` (`origin/main` 2026-09-27T07:00Z) |
| Previous upstream pin  | `a21b42cec478b093cdc50cc2105b5368ea8b3546`                                   |
| Frozen upstream target | `ab099178a7b7f9728843e90fc95ed90bb61d710d` (frozen 2026-09-27T07:01Z)        |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20260927T070048Z-claude-mini` froze a range of 31 commits and 118 changed paths (107 modified, 11 added). The previous pin is an ancestor of the target. The range adds no server or relay migrations, edits no workflow files, and adds no binary assets. It adds one pnpm patch, `patches/react-native-nitro-markdown@0.5.8.patch`.

KAT-3496 landed the previous pin through PR #286 as squash `da55762e861f3a3f03618749e6b7193c545cbe83` (single parent `50f52dae6320049b933ade4f19f74d207ece78b4`), so `a21b42cec` is not an ancestor of the Kata base. `docs/upstream/kat-3496-intake.md` accounts for that exact pin, including its SKIPs. The branch records it with `git merge --strategy=ours --no-ff` as `811f184b956e95d3e2b0a1b58f081ae96d0fe0b3`; the tree equals the base and `git merge-base --all HEAD ab099178a` returns exactly `a21b42cec`. The three-way merge of `ab099178a` follows as `e908ffdea637abd534e0c2d361beab6b8406d92e`. This run also recorded KAT-3496's post-merge acceptance on that issue and filed its lesson as KAT-3531.

## TAKE

Every commit in the range is taken. Adaptations are listed after the table.

| Upstream            | Change                                                                 | Kata note                                                    |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| `8bc9b78f82` #13408 | Terminal links drop a trailing colon                                   |                                                              |
| `4923ff417f` #13748 | node-pty 1.2.0-beta.15 for linux-arm64 prebuilds                       | Sandbox runtime lock follows                                 |
| `92f0af24a3` #13344 | Focus ring on sidebar thread and draft rows                            |                                                              |
| `dab9561cae` #13310 | Mobile composer stays within a folded screen after resume              |                                                              |
| `2679d279ce` #13368 | OpenCode generates session titles                                      | Kata's `workspaceRoot` kept                                  |
| `def34c28b8` #13339 | Antigravity inspects unsupported files by path                         |                                                              |
| `fe6388f01d` #13795 | Mobile links URLs with ports and single-label hosts                    | Adds the nitro-markdown patch                                |
| `daafcc4a97` #10158 | Usage keyboard navigation                                              |                                                              |
| `99efaeab58` #13756 | No empty spans on spawns, projected events, and idle polls             | `ProcessRunner.collectText` is untraced; byte APIs unchanged |
| `8b873eab0d` #13763 | Diagnostics no longer loads the whole trace ring                       |                                                              |
| `6f97b0f66a` #13759 | Project and settled-thread sorting without per-comparison date parsing |                                                              |
| `294dd12341` #13761 | The renderer trace proxy stops tracing itself                          | Only `TracerDisabledWhen` provider in the server             |
| `1d6f23b519` #13765 | Background sweeps read only threads that can still settle              |                                                              |
| `9151ea407a` #13767 | Saving the thread list cache no longer freezes the UI                  |                                                              |
| `8872666957` #13774 | Fewer idle wakeups from the Connect relay and session reaper           | Catch-up request inside Kata's rollback wrapper              |
| `81e0491d2b` #13807 | Mobile keeps trailing underscores and tildes in autolinked URLs        |                                                              |
| `295d7cba09` #13764 | Queued messages send while their thread is not open                    |                                                              |
| `95030dc674` #13812 | Background git status fetches pass `--no-auto-gc`                      |                                                              |
| `75d63d64c5` #13742 | Mobile thread list shows the pull request icon                         |                                                              |
| `393d595984` #13491 | Control announcements and sidebar traversal                            |                                                              |
| `10bb59bf06` #10076 | Usage tolerates newer provider variants                                |                                                              |
| `d6802b4acf` #13820 | No Cursor warning when no login is saved                               | Kata's custom-endpoint guard kept                            |
| `3dae78f33b` #8208  | Usage identifies client version mismatches                             |                                                              |
| `dd582dee36` #13083 | Offline servers are no longer mistaken for updates                     |                                                              |
| `d110f98670` #13861 | Contract mismatch test details                                         |                                                              |
| `ea7d46ac10` #13867 | Windows artifacts accept the Linux node-pty prebuild                   | Applied to Kata's release-archive branch only                |
| `679c34c096` #13870 | Duplicate Cursor Keychain prompts hidden; 30 s Keychain timeout        |                                                              |
| `74ee5153e0` #13736 | `OTEL_<SIGNAL>_EXPORTER=none` turns a signal off                       | Warning copy says Kata Code                                  |
| `c9a0e8a119` #13850 | Reasoning arrows align with tool calls                                 |                                                              |
| `cb97415948` #13908 | Agents may use `simctl` and `adb` beside device tools                  |                                                              |
| `ab099178a7` #13845 | Environment status tooltip resizes when the status changes             |                                                              |

## SKIP

- Skip upstream `AGENTS.md`, user-visible T3 names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations. The range touches none of these except through the identity mapping below.
- Keep deliberate cleanup: deleted `.repos`, `.plans`, `.macroscope`, and parked workflows. The range touches none of them.
- Skip upstream's edit to the trusted `scripts/build-desktop-artifact.test.ts`. See the trusted assertions section.

## Identity mapping

Identity mapping applies only to lines this merge adds. Ten auto-merged or new files imported `@t3tools/*` and now import `@kata-sh/code-*` (`QueuedMessageSender.tsx` and its test, `sendQueuedMessage.ts`, `usageShortcuts.ts` and its test, `UsagePage.test.tsx`, `UsagePage.refresh.test.tsx`, `queuedMessageStore.test.ts`, the mobile `UsageRouteScreen.tsx`, and `persistence.test.ts`). New copy names Kata Code:

- `cursorUsageReader.ts`: "Allow Keychain access on the Mac running Kata Code, then refresh."
- `otelEnvironment.ts`: the ignored-exporter warning, "which Kata Code does not export to", and its doc comment.
- `docs/operations/observability.md`: a `KATACODE_OTLP_*_URL` still wins over `OTEL_<SIGNAL>_EXPORTER=none` for its signal.
- `AgentAwarenessRelay.ts` and its test: comments name `katacode connect publish`, the Kata command.

Existing test fixtures that use "T3 Code" as a project name stay, as they did before this range.

## Conflict resolutions

17 paths conflicted, all content conflicts.

- Scope-only conflicts: `environment-cache-store.ts`, `threadListV2.ts`, `Sidebar.tsx`, `Sidebar.logic.test.ts`, `queuedMessageStore.ts`, `UsagePage.tsx`, `threadSort.test.ts`, and `usageMerge.test.ts` take upstream's imports under Kata scope.
- `apps/server/package.json`: upstream's node-pty `^1.2.0-beta.15` beside Kata's `oauth4webapi`.
- `apps/server/src/cloud/http.ts`: Kata's relay-config writes stay inside the `Effect.gen` whose failure rolls back the managed endpoint. Upstream's `awarenessRelay.requestCatchUp()` runs inside it, after the cloud mint key, in upstream's order. It only offers to a queue and cannot fail. Both the `AgentAwarenessRelay` and `LinearOAuth` imports stay.
- `ProviderCommandReactor.ts`: Kata's `workspaceRoot` beside upstream's `sessionTitle`. The provider session title is now omitted unless the thread was renamed by hand. Routine threads keep their Kata thread title; only the OpenCode or ACP session title changes, as upstream intends for every thread.
- `server.test.ts`: upstream's merged layer with the `AgentAwarenessRelay` mock, plus Kata's `getStatus` on the managed endpoint runtime mock.
  Upstream's new test "wakes the agent awareness relay when this server links or changes publishing" merged cleanly but posted a relay config without the manual relay endpoint Kata requires, so it received 400. It now sends `manualRelayEndpoint`, like every other Kata relay-config test.
- `UsageService.ts`: Kata's custom-endpoint guard, then upstream's early return when no Cursor login is saved. The guard's result carries an error, so it is still reported.
- `AppSidebarLayout.tsx`: Kata's `SidebarControl`, which has no sidebar visibility or stage backdrop hooks, with upstream's `usagePageOpen` shortcut context.
- `scripts/build-desktop-artifact.ts`: Kata keeps two WSL archive shapes, the retained source tree and the Linux CLI release archive (KAT-3297). Upstream's rule that node-pty may load either `build/Release/pty.node` or `prebuilds/linux-<arch>/pty.node` applies to the release archive branch, which now requires `katacode`, `client`, `node_modules`, and one of the two node-pty binaries.
- `pnpm-lock.yaml`: regenerated from the merged manifests with `vp install`. It adds node-pty 1.2.0-beta.15, jsdom 30.1.1 for web tests, the `@exodus/bytes>@noble/hashes` override, and the nitro-markdown patch hash.

## Clean merges and new files

Clean merges and new files received the same review as conflicts. All 11 new files fit Kata once remapped. The retained owners that changed without conflicts are `processRunner.ts` (`collectText` untraced; `runBytes`, replacement environments, and credential cleanup unchanged) and `server.ts` (`untracedRequestsLayer` provided last; no other `TracerDisabledWhen` exists in Kata). `GitVcsDriverCore.ts` adds `--no-auto-gc` to the background status fetch and keeps Kata's repository-binding stripping. The Cursor Keychain read keeps the `cursorKeychainUsageEnabled` opt-in and gains a 30 s timeout. Docker/Sprite behavior, the disabled-by-default sandbox preview, the Linear OAuth broker, relay wire identity, the `SettingsScopeContext.tsx` optimistic-file fix, migrations, and desktop identity are untouched by the range.

The Kata-only `apps/server/src/cloud/linearOAuthDelivery.test.ts` builds its own cloud HTTP layer. Upstream's cloud handlers now require `AgentAwarenessRelay`, so the test provides an empty mock, as it already does for the other cloud services it does not use.

## Sandbox runtime lock

`packages/kata-sandbox-docker/runtime-package-lock.json` must match the server's CLI dependencies (KAT-3496). It now pins node-pty 1.2.0-beta.15, with the tarball and integrity that `pnpm-lock.yaml` resolves. npm resolves the same `node-addon-api` 7.1.1 dependency, so no other entry changes.

## Trusted assertions

The preservation gate requires each check's trusted test files to match the Kata base byte for byte. Upstream edited two:

| Trusted file                             | Upstream change                                                             | Resolution                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `scripts/build-desktop-artifact.test.ts` | node-pty prebuild cases for x64 and arm64, and the extra missing-file entry | Restored to base; the cases live in `scripts/build-desktop-artifact.upstream.test.ts` |
| `apps/server/src/server.test.ts`         | `AgentAwarenessRelay` mock, untraced OTLP proxy requests                    | Taken; its FAIL line is already in the `ci.yml` allowlist (KAT-3411)                  |

The base `server.test.ts` does not provide `AgentAwarenessRelay`, which the cloud routes now require, so its base bytes would not run. No new `ci.yml` allowlist line is needed.

## Changed retained outcomes

| Check                                  | Changed owner                       | Disposition                                                        |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| `product-identity-release-ownership`   | `FORK.md`                           | TAKE: pin advances to `ab099178a`; identity tables unchanged       |
| `connect-wire-identity`                | `FORK.md`                           | TAKE: same pin-only edit                                           |
| `state-isolation`                      | `FORK.md`                           | TAKE: same pin-only edit                                           |
| `sandbox-route-driver-registration`    | `apps/server/src/server.ts`         | TAKE: untraced request layer; sandbox routes and drivers unchanged |
| `retained-process-credential-behavior` | `apps/server/src/processRunner.ts`  | TAKE: `collectText` untraced; byte APIs and cleanup unchanged      |
| `desktop-packaging-asset-identity`     | `scripts/build-desktop-artifact.ts` | TAKE: WSL release archive accepts the node-pty Linux prebuild      |

## Host limits

Local verification runs on a macOS arm64 Mac mini inside a Kata Code agent shell with `ELECTRON_RUN_AS_NODE` unset (KAT-3452). The Xcode license is accepted on this host (KAT-3496 comment 95c2f41b), so the mobile native regression tests compile. Windows and Android are parked (KAT-3513), so the Windows WSL packaging change is verified by the portable tests only.
