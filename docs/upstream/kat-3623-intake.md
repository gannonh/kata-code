# KAT-3623 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `d07eb7f6a2d0f62aaae423661c23037d6c05efa2` (`origin/main` 2026-10-02T07:01Z) |
| Previous upstream pin  | `71a90ae70e3ff880396363809bd9bfcfd520f30c`                                   |
| Frozen upstream target | `54084ae1e6c32809db040e4fa571c80fdf2d8ae4` (frozen 2026-10-02T07:01:04Z)     |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20261002T070056Z-claude-mini` froze 30 commits that change 192 paths: 148 modified, 22 added, 16 deleted, and 6 renamed. The previous pin is an ancestor of the target. Most of the range is the mobile move to Expo SDK 58 and React Native 0.88.0-rc.3. The range adds two pnpm patches and renames six, touches one parked workflow, adds one binary asset (skipped), and adds no migrations.

## Ancestry

KAT-3604 landed the previous pin through PR #334 as squash `d07eb7f6a2d0f62aaae423661c23037d6c05efa2`, with single parent `0bd2f8d76`. Its tree equals the reviewed candidate `f0378e5657`, but `71a90ae70` is not an ancestor of `origin/main`. `FORK.md` and `docs/upstream/kat-3604-intake.md` at the base account for exactly that pin, including its SKIPs, so the run recorded it with the guarded anchor:

```bash
git merge --strategy=ours --no-ff 71a90ae70e3ff880396363809bd9bfcfd520f30c
```

The anchor is `c08ff98d956306e15a747dd79a82b9b3a1cb3d81`, with parents `d07eb7f6a2` and `71a90ae70` and the base's tree. `git merge-base --all c08ff98d95 54084ae1e6` returns exactly `71a90ae70`.

The three-way merge of `54084ae1e6` is `a1cee9f21288ccfd193add4b6602c4940bc27f0c`, with parents the anchor and `54084ae1e6`. The Kata base, the previous pin, the target, and the original root are all ancestors of the candidate.

## TAKE

| Upstream            | Change                                                                 | Kata note                                                          |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `8dc07f199c` #12045 | Expo SDK 58 and React Native 0.88.0-rc.3                               | Adapted; see "Expo SDK 58"                                         |
| `54084ae1e6` #14734 | Update Expo 58 to restore widgets and Live Activities                  | Patch versions and `expo-widgets@58.0.11.patch` as upstream        |
| `1e9c36023c` #12051 | Expo Modules 2.0 for function-only native members                      |                                                                    |
| `9962e6986d` #12050 | Read display scale and width from the view's scene                     |                                                                    |
| `ce920f2ac8` #12049 | Dev-menu suppression from the dev-client launch URL                    | `test-t3-mobile` skill gains the query hint                        |
| `09388bf2da` #12047 | Degrade the agent Live Activity once its content goes stale            | `remoteRegistration.ts` title stays `Kata Code`                    |
| `438af295fe` #12048 | Stack agent alerts by thread                                           | Relay APNs `thread-id`; the `t3-agent-alerts` fallback is internal |
| `e41755cf8a` #12046 | Android subscription widget through `expo-widgets`                     | Unsupported platform                                               |
| `bed69f6ea4` #12052 | Suppress only the on-screen thread's alert on Android                  | Unsupported platform; adapted to `nativeLoader()`                  |
| `148e6deea0` #14527 | Start a new project from just a name                                   | Adapted; see "Identity mapping"                                    |
| `10ac2f2ba4` #14673 | Background GitHub polling batches pull-request lookups through GraphQL | Adapted; see "Conflict resolutions"                                |
| `5cc99e1c23` #14573 | Agent clicks in the browser no longer pop Save dialogs                 | `Manager.test.ts` keeps `persist:katacode-preview-*`               |
| `41a8239849` #14553 | CLI smoke cleanup retries                                              | Scratch prefix stays `katacode-cli-smoke-`                         |
| `5a574a77d1` #14558 | Remove duplicate sidebar ordering tests                                | Takes upstream's re-export; see "Post-merge adaptation"            |
| `0a04cc50de` #14678 | Update providers on every machine with one click                       |                                                                    |
| `b33eda1399` #13926 | Beta Working section                                                   |                                                                    |
| `6ea01f8d24` #14635 | Cloned projects show their favicon                                     |                                                                    |
| `67f640093f` #14675 | Docker icon on dockerfile code blocks                                  |                                                                    |
| `ced865c224` #14700 | PR checks status collapses to its icon                                 |                                                                    |
| `fa6262db31` #14710 | Remove outdated restart setting update advice                          |                                                                    |
| `20012ebd80` #13426 | Terminal toggle clears the last header action                          |                                                                    |
| `2731929610` #14674 | Composer undo groups the way the Lexical composer did                  |                                                                    |
| `3e60fecf39` #14601 | Markdown pages render in the dark-mode browser                         |                                                                    |
| `39405f1992` #14532 | One No project row at the top of the mobile project picker             |                                                                    |
| `99e08526e5` #14367 | Remove unused `isCloudDebugEnabled` and `isTerminalDebugEnabled`       |                                                                    |
| `094fb230e9` #14613 | Server features are services, and handlers stay thin                   | `docs/internals/effect-services.md` only                           |
| `a3abb52660` #14659 | Pin eas-cli for mobile PR previews                                     | Parked `.github/disabled/mobile-eas-preview.yml`                   |
| `a97a4a9d18`        | Marketing stats                                                        | `apps/marketing` stays T3-shaped (FORK.md)                         |

## SKIP

- `b91e4668fa` #13487, the marketing social card: `apps/marketing/src/assets/social-card.webp` and the `Layout.astro` change that imports it. The card is upstream T3 artwork, which the carried-forward artwork SKIP excludes, and Kata does not deploy marketing.
- `a3fb5392e3` #11413 and the `AGENTS.md` and `.macroscope/check-run-agents/effect-service-conventions.md` edits in `094fb230e9`. Kata deleted those files.
- The Android widget copy in `docs/user/usage.md`. Kata's iOS-only Kata Code copy stays.
- Carried forward from KAT-3604: upstream `AGENTS.md`; user-visible T3 names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations; upstream artwork and unlicensed binary assets; parked or deleted infrastructure; and the vite-plus 1.0 bump, which KAT-3607 adopts after a two-PR unfreeze. The `-s ours` anchor records `35be904f2f` as accounted for, so this merge does not bring it back.

## Expo SDK 58

`8dc07f199c` and its follow-ups move the mobile app to Expo SDK 58, React 19.3, and React Native **0.88.0-rc.3**, a release candidate. Every later mobile commit in the range builds on it, so a partial take is not practical. Kata ships iOS through `mobile-testflight.yml`, so this intake flags the release candidate for Human Review and builds the iOS development client on a simulator before review.

- **Dependencies.** `apps/mobile/package.json` takes upstream's versions and keeps Kata's `@kata-sh/code-*` workspace names. `pnpm-workspace.yaml` merged cleanly: new `minimumReleaseAgeExclude` entries, overrides, and patched dependencies. Kata then re-registers two patches upstream dropped, `expo-modules-core@58.0.11` and `expo-notifications@58.0.11`, and adds `expo@58.0.2`; see "Post-merge adaptation".
- **Lockfile.** `pnpm-lock.yaml` is regenerated by `vp install` from Kata's base lockfile. All 124 Expo, React Native, React, and React Navigation package versions equal upstream's lockfile at `54084ae1e6`. vite-plus stays 0.3.3.
- **Patches.** The renamed and added patches merged cleanly. `patches/expo-widgets@58.0.11.patch` conflicted only because Kata's 57 copy had whitespace-only edits; the candidate takes upstream's bytes.
- **Config.** `apps/mobile/app.config.ts` takes Expo 58's `expo-widgets` shape: iOS settings move under `ios:`, and the plugin gains `enableAndroid` and inert Android widget fields. Widget descriptions stay Kata Code. `platforms: ["ios"]` stays, and no `withAndroid*` plugin is applied. `withIosSceneLifecycle.cjs` and its test are gone with SDK 58, so the plugin list drops it.
- **Android.** The `t3-subscription-widget` Android module is replaced by an `expo-widgets` Android widget and a `t3-widget-expiry` module. These are unsupported-platform paths, taken as they are. Their copy names T3 and no Kata build ships it.

## Identity mapping

- **Package scope.** New imports of `@t3tools/*` become `@kata-sh/code-*`, in `NewProject.ts`, `ProviderUpdatesAction.tsx`, `useNewProject.ts`, `CommandPalette.tsx`, `GitHubCli.ts`, `GitHubSourceControlProvider.ts`, `projects.ts`, `NewTaskContextPickerScreens.tsx`, `new-task-flow-provider.tsx`, and both `T3ComposerEditor` files.
- **New projects.** The server creates projects under `projects` in its `baseDir`, which is `~/.katacode` for Kata. The starter README says `Created in [Kata Code](https://github.com/gannonh/kata-code).` instead of linking T3 Code at `t3.codes`. `docs/user/source-control.md` names `~/.katacode/projects` and "your Kata Code data directory". The comment in `useNewProject.ts` names Kata Code's data directory.
- **Copy.** Widget descriptions in `app.config.ts`, the Live Activity title in `remoteRegistration.ts`, and the Connect onboarding comment in `Stack.tsx` stay Kata Code.
- **Retained.** The `t3-agent-alerts` notification thread fallback, the `t3-file:` and `t3-link:` icon URIs, the `font-t3-*` classes, temporary prefixes such as `t3-new-project-` and `t3-projects-`, and test fixtures stay under FORK.md's identifier policy.
- The added lines name no `T3CODE_` variable, `t3code://` scheme, or `~/.t3` path in shipped code or user docs.

## Preservation gate

The range changes three inventory owner paths and no trusted test file:

| Check                                  | Owner path                                                       | Disposition                                                                      |
| -------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `mobile-android-asset-config-identity` | `apps/mobile/app.config.ts`                                      | TAKE: Expo 58 widget shape; Kata identity, iOS-only platforms, no Android plugin |
| `connect-early-access-waitlist`        | `apps/mobile/src/Stack.tsx`                                      | TAKE: notification suppression follows the thread under overlay sheets           |
| `mobile-agent-awareness-teardown`      | `apps/mobile/src/features/agent-awareness/remoteRegistration.ts` | TAKE: Live Activity stale date; title stays `Kata Code`                          |

On the merge, the trusted `remoteRegistration.test.ts`, `cloudWaitlistJoin.test.ts`, `earlyAccess.test.tsx`, the mobile theme tests, and `projectThreadStartTurn.test.ts` pass at base bytes (6 files, 83 tests).

## Conflict resolutions

- **`apps/server/src/sourceControl/GitHubCli.ts`**. Kata's `executeSafe` stays: it replaces `gh` output with "GitHub CLI output omitted." for the Kata-only `listRepositories`, `listBranches`, and `assertAuthenticated`. Upstream's batched `listPullRequestsByHead` resolver follows it unchanged.
- **`apps/server/src/git/GitManager.test.ts`**. The fake keeps Kata's `listRepositories`, `listBranches`, and `assertAuthenticated` and adds upstream's `listPullRequestsByHead`.
- **`apps/server/src/sourceControl/GitHubSourceControlProvider.ts`**, **`CommandPalette.tsx`**, **`projects.ts`**, and the mobile import conflicts. Upstream's imports with Kata's package scope.
- **`apps/web/src/components/Sidebar.logic.ts`**. The merge kept Kata's re-export, which also carried `planPinnedReorder`; see "Post-merge adaptation".
- **`apps/mobile/app.config.ts`**, **`apps/mobile/package.json`**, **`pnpm-lock.yaml`**, **`patches/expo-widgets@58.0.11.patch`**. See "Expo SDK 58".
- **`apps/mobile/src/Stack.tsx`**, **`remoteRegistration.ts`**. Upstream's behavior with Kata copy.
- **`apps/desktop/src/preview/Manager.test.ts`**. Upstream's preview session stub with Kata's `persist:katacode-preview-*` partitions.
- **`scripts/smoke-cli-archive.ts`**. Upstream's retrying cleanup with the `katacode-cli-smoke-` prefix and the `katacode.exe` comment.
- **`.agents/skills/test-t3-mobile/SKILL.md`**. Kata's native-client paragraph stays; upstream's SDK 58 dev-client query hint joins Kata's Metro step.
- **`docs/user/usage.md`**. Kata's iOS-only copy.
- **`AGENTS.md`**, **`.macroscope/check-run-agents/effect-service-conventions.md`** (modify/delete). Stay deleted.
- **Two `t3-subscription-widget` Android files** (delete/modify). Deleted, as upstream did. Kata's edits were branding in a module upstream removed.

## Post-merge adaptation

- **`expo-modules-core` permissions registry.** Kata's base and upstream's previous pin patch `expo-modules-core@57.0.14` so `EXPermissionsService` guards its requester dictionaries with `@synchronized`. Upstream's SDK 58 move drops that `patchedDependencies` entry and the `expo-modules-core: 57.0.14` override, and 58.0.11 has the same unguarded code. Upstream's `apps/mobile/scripts/permissions-service.test.ts` compiles that file with ThreadSanitizer and is skipped off macOS, so Linux CI never runs it. It passes on the base and failed twice on the merge with a race on `NSMutableDictionary`. `f724b0460e` ports the unchanged patch as `patches/expo-modules-core@58.0.11.patch` and registers it in `pnpm-workspace.yaml`; the test passes.
- **`expo-notifications` pending responses.** Kata's base and upstream's previous pin patch `expo-notifications@57.0.15` so `NotificationCenterManager` locks its state, offers a response to a delegate that registers during delivery, and keeps responses that arrive during a replay. SDK 58 drops that patch. Expo 58.0.11 brings its own `Mutex` registry, which fixes the races, but it appends a response only after delivery and clears every pending response after a replay. Upstream's `apps/mobile/scripts/notification-center-manager.test.ts` is skipped off macOS and no longer compiled against the 58 source: it strips the `ExpoModulesCore` import that provides `Mutex`, and its delegate stub had no optional methods. The fixture now defines an `NSLock`-backed `Mutex` and an `@objc` delegate stub. Against unpatched 58.0.11, `reentrant` and `concurrent` pass and `handoff` and `pending` fail. `patches/expo-notifications@58.0.11.patch` carries the 57 patch's delivery and replay behavior onto Expo's registry, and the unused 57 patch file is removed. All four scenarios pass, and all 202 mobile test files pass.
- **`expo/tsconfig.base` for the historical baseline.** `scripts/check-upstream-preservation.test.ts` runs today's checker on historical commit `d62d138f6a` with today's `node_modules`. That tree's `apps/mobile/tsconfig.json` extends `expo/tsconfig.base`. Expo 58 adds an `exports` map whose `./*` entry does not resolve that extensionless path; upstream moved its own config to `expo/tsconfig.base.json` in this range. PR CI run 36978167134 failed its Test job there: every historical mobile test failed with `TSCONFIG_ERROR`, and 8 checks reported FAIL. No commit on `main` uses the `.json` form, so the baseline cannot move forward in this PR. `patches/expo@58.0.2.patch` adds one `exports` entry, `./tsconfig.base` to `./tsconfig.base.json`, and changes no other resolution. The checker test file passes 36 of 36. The patch can go once the baseline candidate moves to a commit with Expo 58.
- **`apps/web/src/components/Sidebar.logic.ts`**. Upstream #14558 removed the duplicate ordering tests, including the `planPinnedReorder` cases in `Sidebar.logic.test.ts` that imported Kata's re-export; `threadSort.test.ts` keeps that coverage. `vp run knip:check` then reported the re-export unused, so `f724b0460e` takes upstream's re-export.
- **`apps/mobile/src/features/agent-awareness/androidNotifications.ts`**. Kata loads the native module through `nativeLoader()` instead of a module-level `native`. Upstream's new `setAndroidThreadOnScreen` referenced `native`, which failed the mobile typecheck with TS2304. It now calls `nativeLoader()?.setThreadOnScreen?.(path)`.

## Clean merges and new files

- **Server.** `projects.createNew` requires `AuthOrchestrationOperateScope` in `RpcAuthorization.ts`. `NewProject.ts` claims a fresh folder under the projects root, writes a README and an icon, and makes a first commit; an optional private GitHub repository goes through the existing `createRepository` call. `AssetAccess.ts` skips favicon lookups while a clone is pending. New `server.test.ts` cases post no relay configuration, so they need no `manualRelayEndpoint`.
- **Relay.** `ApnsClient.ts` adds an APNs `thread-id`, and `FcmDeliveries.ts` adds Android grouping. No relay migration changes.
- **Contracts.** `ServerConfig.newProjectsRoot`, the `sidebarWorkingShelfEnabled` client setting (default off), and new RPC and pull-request schemas.
- **New files.** `NewProject.ts` and its test, `useNewProject.ts`, `ProviderUpdatesAction.tsx`, `composer-undo-grouping.ts` and its test, `AddProjectNewRoute.tsx`, `foregroundNotificationBehavior.ts` and its test, `SubscriptionUsage.android.tsx` and its test, the `t3-widget-expiry` Android module, `docs/internals/effect-services.md`, and the `expo-blur`, `expo-glass-effect`, and `react-native-gesture-handler@3.2.1` patches. The skipped new file is `social-card.webp`.
- **Workflows.** Only the parked `.github/disabled/mobile-eas-preview.yml` changes. No active workflow changes apart from the `ci.yml` pin literals.

## Pin consumers

These advance to `54084ae1e6`:

- `FORK.md`: the Current T3 pin row, the intake and decisions links, the previous accounted-for pin (`71a90ae70`), and the next-scan comment.
- `.github/workflows/ci.yml`: `UPSTREAM_TIP` and `UPSTREAM_SHA`. `UPSTREAM_BASE` and `UPSTREAM_BASE_SHA` stay `6a687ee43`.
- `docs/upstream/kat-3307-runbook.md`: the live pin and both command examples.
- `scripts/check-upstream-preservation.test.ts`: `currentUpstreamSha`. The historical `baselineUpstreamSha` is unchanged.

## Verification

Local gates on merge `a1cee9f212` and on candidate `7c399ee6038d31087b65a82d94411ace859b0b9a`:

| Gate                                                         | Result                                                                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp check`, `vpr typecheck`                                  | Pass on both                                                                                                                                                                           |
| `vp run knip:check`                                          | Failed on the merge (unused `planPinnedReorder` re-export); pass on the candidate                                                                                                      |
| Branding (product and agent-facing), workflow references     | Pass                                                                                                                                                                                   |
| Nightly release test, preview artifact test, release smoke   | Pass                                                                                                                                                                                   |
| Non-server test partition                                    | Merge: Electron install race, then the two macOS-only Expo regressions; candidate: all pass                                                                                            |
| Server shards 1, 2, 3                                        | Pass on the merge; later commits change mobile patches, the lockfile, a Swift fixture, one web re-export, and docs, and PR CI run 36980139156 passes all three shards on the candidate |
| `vp run build:desktop`, preload bundle, `vp run lint:mobile` | Pass                                                                                                                                                                                   |

- **Trusted checker** archived from `d07eb7f6a2`, on a clean checkout of the candidate: `--mode ci` exit 0, inventory and 28 checks PASS. `--mode human-review` with exact-ref records: CHANGED_RETAINED_OUTCOMES PASS for the six checks in "Preservation gate" (`FORK.md` for the first three) and INTEGRATION_RECORD PASS. It prints `HUMAN_REVIEW_ACCEPTANCE status=FAIL detail=Missing mandatory manual evidence for icon-composer-live-evidence.` `icon-composer-live-evidence` and `human-device-provider-evidence` are NOT RUN under the standing waiver.
- **PR CI** run 36980139156 passes all 10 checks on the candidate. Run 36978167134 on `2a0aa12952` failed its Test job on the historical baseline; see "Post-merge adaptation".
- **iOS Simulator.** `node scripts/mobile-native-client.ts ensure ios <udid>` rebuilt the development client on a new iOS 27 simulator: `** BUILD SUCCEEDED **`, including the widget extension. The app loaded its bundle from Metro and paired to a disposable backend through the one-shot route. The project picker shows one No project row above the seeded project, and Add project offers New project.
- **Web.** The `verify-katacode` stack on `2a0aa12952` passed 9 of 10 scenarios. Pairing and the empty landing match `main`. New project creates `<home>/projects/pinball-stats` with the Kata README, an icon, and a first commit. The Working section toggle persists. Connections, Usage, and Routines render with Kata copy, and the routine picker still omits the scratch project. One-click provider updates were not reached, because no provider was outdated. No visited page shows T3 product copy.

## Independent review

An independent Opus review covered the complete delta in two passes. It examined all 192 upstream paths, all 194 paths the merge changes relative to the base, and the 197 relevant paths in the candidate-to-upstream diff, including clean merges and new files. Both passes returned PASS+NOTES with no blocking finding.

- **Merge `a1cee9f212` through `2a0aa12952`.** Every divergence from upstream is a recorded Kata retention or adaptation. `executeSafe` and its redaction survive beside upstream's batched resolver, `projects.createNew` requires the operate scope, the range has no migrations, and no active workflow changes apart from the pin literals. Its two notes on stale intake wording are fixed.
- **`2a0aa12952..7c399ee603`.** The reviewer compiled the stock Expo 58.0.11 `NotificationCenterManager.swift` with the new fixture: `handoff` and `pending` fail, and with the patch all four pass. Delivery and registration each run as one locked step, and delegate callbacks run outside the lock, so responses are neither lost nor duplicated. The fixture's `Mutex` matches ExpoModulesCore's. The `expo` exports entry is an exact key that changes only the `expo/tsconfig.base` specifier, and no less invasive fix exists, because the checker rejects a dirty baseline checkout.

Notes for Human Review:

- A delegate that registers during a delivery receives that response even when another delegate already handled it. The base shipped the same behavior under the 57 patch.
- Changing or removing the `expo` patch may change the Expo fingerprint, and with it `runtimeVersion`. Drop it together with a native build.
- React Native 0.88.0-rc.3 is a release candidate.
