# KAT-3648 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `3b12b15c9699457cc558437ff68ec6be32d0dcba` (`origin/main` 2026-10-04T07:00Z) |
| Previous upstream pin  | `fed41fa88bb27cb4325cb208d571393850bc63c2`                                   |
| Frozen upstream target | `0fe4fa40fe65ac9545621a65633f08d9fa29fd0d` (frozen 2026-10-04T07:00:30Z)     |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20261004T070047Z-claude-mini` froze 75 commits that change 352 paths: 318 modified, 33 added, and 1 renamed. The previous pin is an ancestor of the target. The range is a day of upstream work on Orchestration V2: restart recovery, delegated tasks, a pull-request watch for agents, workspace-preparation retry, usage cost breakdowns, mermaid diagrams, morphing icons, and mobile dictation. It adds no migrations, changes no active workflow, and adds no binary asset.

## Ancestry

KAT-3635 landed the previous pin through PR #345 as merge commit `3b12b15c9699457cc558437ff68ec6be32d0dcba`, with parents `0e943f74bf` and the reviewed candidate `d9eb593e1f`. `fed41fa88b` is therefore an ancestor of the base, and the run recorded SKIP for the recovery anchor. `git merge-base --all 3b12b15c96 0fe4fa40fe` returns exactly `fed41fa88b`.

The three-way merge is `76c0c008c8b19db9f1bfedba1f57e784390e8d5f`, with parents the base and `0fe4fa40fe`.

## Resolution method

The merge census on the base gave 70 conflicted files: 67 content, 1 add/add, and 2 upstream additions under the renamed `oxlint-plugin-t3code/` directory.

1. **Identity-only files.** For 38 conflicts, Kata's change from the previous pin was only the identity transform (`@t3tools/` → `@kata-sh/code-`, `T3CODE_` → `KATACODE_`, `T3 Code` → `Kata Code`). The resolver checked that the transform maps the previous-pin blob exactly to Kata's blob, then took upstream's blob through the same transform.
2. **Renamed-base merge.** For the rest, `git merge-file --diff3` reran with the transformed previous-pin text as the base. 8 files merged cleanly.
3. **By hand.** The remaining 20 content conflicts, the add/add test, the two oxlint files, and the lockfile are listed under "Conflict resolutions".
4. **Scope rename.** 22 upstream-added or cleanly merged files imported `@t3tools/*`. They now import `@kata-sh/code-*`.

## TAKE

All 75 commits apart from the SKIPs below. Kata adaptations:

| Upstream                                 | Change                                                  | Kata adaptation                                                                                    |
| ---------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `18b21325c3` #15057                      | Agents can watch a pull request and get woken           | Tool descriptions, wake messages, and `RuntimeInstructions.ts` say Kata Code                       |
| `737993303d` #15326                      | Retry a failed workspace preparation                    | A routine's setup-script opt-out survives the retry; see "Post-merge adaptation"                   |
| `31a9da179e` #15115, `5108c978b1` #15323 | Delegated review rounds, restart-safe delegated tasks   | Orchestrator tool copy says Kata Code instead of standalone T3 (KAT-3540)                          |
| `8d846660ce` #15346                      | Mobile beta Working section                             | The shelf's expanded state uses Kata's key style: `threadListV2WorkingShelfExpanded`               |
| `bf5c146be9` #15502                      | Dictation keeps running across navigation               | `GlobalVoiceInputControl` wraps the app inside Kata's markdown-image race fixture branch           |
| `0cfa113be5` #15274                      | Lint rule against page-wide `:has()` variants           | Registered as `kata-code/no-unscoped-has` in `oxlint-plugin-kata-code`                             |
| `40596072eb` #15411                      | Connect links survive colliding prepared statements     | Upstream's Drizzle hunks join Kata's PlanetScale sections in `patches/alchemy@2.0.0-beta.79.patch` |
| `a78760e5e7` #15324                      | RPC scopes checked in group middleware                  | Kata's routine RPCs are already in the scope map; no handler change needed                         |
| `fe93a5dbdd` #15416                      | One-click provider updates for every install            | The rewritten `providerMaintenance.ts` comment says Kata Code; its stale branding exception goes   |
| `5e35272fda` #15067, `f2cc80a7a4` #14924 | Mermaid diagrams, morphing icons                        | New dependencies checked; see "Dependencies"                                                       |
| `8e39994439` #15142                      | Android usage widget proguard rule                      | Unsupported platform                                                                               |
| `c5a0c78b7c` #15391                      | Step a new thread to the next machine from the keyboard | The Android `T3KeyboardCommandsModule.kt` part is unsupported platform                             |
| Remaining fixes                          | Server recovery, usage, web, mobile, client-runtime     | Kata identity where user-visible                                                                   |

## SKIP

- `f1dcd93931` #15070, "Nightly tells you to get the beta mobile app": `NightlyMobileBeta.tsx`, its wiring in `SettingsPanels.tsx` and `__root.tsx`, and the `install.md` paragraph. It sends nightly users to T3's TestFlight, Google beta group, and `com.t3tools.t3code` Play listing, and its copy names T3 Code. Kata's mobile app already runs the V2 client (2.0.0, KAT-3635), so the notice's premise does not apply.
- `9efb016900` #12141, the sidebar brand width probe. It sizes the sidebar's minimum width around the T3 wordmark in the sidebar header. KAT-3423 restored a bare header with no brand, and Kata's header hides the environment pill below 15rem. `SidebarChrome.tsx`, `AppSidebarLayout.tsx`, `threadSidebarWidth.ts`, and its test stay at the base. No other range commit touches them.
- Carried forward from KAT-3635: upstream identity on product surfaces, artwork, unlicensed assets, the deleted `AGENTS.md` / contribution-triage / `.macroscope` files, the `t3code-v2` desktop profile, and parked infrastructure.

## Conflict resolutions

- **`apps/mobile/src/features/threads/use-thread-list-v2-shelf-preferences.ts`**, **`apps/mobile/src/persistence/mobile-preferences.ts`**, **`apps/mobile/src/lib/storage.test.ts`**. Kata's `threadListV2SettledShelfExpanded` / `threadListV2SnoozedShelfExpanded` keys and the settled-expanded default stay (`mobile-shelf-preferences`). Upstream's Working shelf joins as `workingShelfEnabled` and `threadListV2WorkingShelfExpanded`.
- **`apps/mobile/src/App.tsx`**. Kata's `MarkdownImageRaceFixture` branch stays; the normal branch uses upstream's `GlobalVoiceInputControl` in place of the plain `View`.
- **`apps/server/src/mcp/toolkits/orchestrator/tools.ts`**, **`apps/server/src/provider/T3OrchestrationInstructions.ts`**. Upstream's expanded descriptions with standalone `T3` replaced by Kata Code, matching the base's wording.
- **`apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.ts`**, **`ThreadSettlementService.ts`**. Kata's FORK.md diagnostics header and upstream's new imports.
- **`apps/web/src/state/projects.ts`**. Upstream's `environmentProjects` atoms; `projectEnvironment` keeps Kata's explicit `ReturnType` annotation.
- **`packages/client-runtime/src/errors/transport.ts`** and its test. Upstream's relay network-hint matcher; the server message stays "Unable to connect to the Kata server WebSocket."
- **`docs/user/composer.md`**. Upstream's filename-extension paragraph with Kata's iOS-only PDF line. **`docs/user/install.md`**. Kata has no store-app section, so the nightly beta paragraph has nowhere to go (SKIP).
- **`vite.config.ts`**. Kata's `kata-code/*` rule names plus `kata-code/no-unscoped-has`.
- **`patches/alchemy@2.0.0-beta.79.patch`**. Per-file union: Kata's PlanetScale replica sections (KAT-3411) and upstream's new Drizzle sections. Kata's patch has no `Test/Vitest` section, as at the base.
- **`apps/web/src/components/threadSidebarWidth.test.ts`** (add/add) and **`sidebar/SidebarChrome.tsx`**. Kata's files; see SKIP.
- **`pnpm-lock.yaml`**. See "Dependencies".
- **Usage, command palette, client-runtime project commands and thread execution**: upstream's code with Kata identity.

## Dependencies

- `pnpm-lock.yaml` is regenerated from Kata's base lockfile with `vp install`. All 111 packages new in upstream's lockfile resolve to the same versions. vite-plus stays 0.3.3; the range bumps no test toolchain.
- New web dependencies: `dompurify` 3.4.16 (MPL-2.0 OR Apache-2.0), `lucide` 0.564.0 (ISC), `mermaid` 11.17.2 (MIT), `morphicons` 1.7.1 (MIT). `third-party-licenses.config.json` takes upstream's notices for mermaid's `fastdom`, `strictdom`, and `khroma`.
- `react-native-keyboard-controller` 1.22.4 → 1.22.6, with upstream's renamed patch. `patchedDependencies` and `overrides` drop no entry.

## Post-merge adaptation

- **Routine setup-script opt-out on retry.** KAT-3635 kept routines' `runSetupScript: false` through `ThreadLaunchService.launch`. Upstream #15326 adds `retryPreparation`, which rebuilds the preparation input from the stored run, so a retried routine run would have run the project's setup script. Launch now passes the opt-out through the `defer_start` dispatch mode, the orchestrator records it as `OrchestrationV2Run.runSetupScript`, and the retry passes it back. The public `OrchestrationV2ThreadLaunchWorkspaceStrategy` stays identical to upstream, so `thread.launch`, scheduled tasks, and the agent-facing `t3_thread_launch` tool do not expose the flag. A new `ThreadLaunchService.test.ts` case fails without the retry change (the setup script runs once) and passes with it.
- **Seams upstream changed.** The Kata Claude stop-race test's fake query session gains `setPermissionMode` (#15224). The routine dispatcher test's launch wrapper forwards `retryPreparation`. The new `PullRequestWatchReactor.ts` keeps its upstream service key under the FORK.md `deterministicKeys:off` header.

## Preservation gate

The range changes three inventory owner paths and no trusted test file:

| Check                                  | Owner path                                                                 | Disposition                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `mobile-shelf-preferences`             | `apps/mobile/src/features/threads/use-thread-list-v2-shelf-preferences.ts` | TAKE: Working shelf added; Kata keys and settled-expanded default unchanged |
| `mobile-android-asset-config-identity` | `apps/mobile/app.config.ts`                                                | TAKE: Android-only proguard rule; `platforms: ["ios"]`, no Android plugin   |
| `connect-early-access-waitlist`        | `apps/web/src/components/onboarding/WelcomeWizard.tsx`                     | TAKE: copy button icon only                                                 |

`FORK.md` changes for the pin, which makes it a changed owner for the checks that list it.

## Pin consumers

`FORK.md`, both `Lint`-job literals in `.github/workflows/ci.yml` (`UPSTREAM_TIP`, `UPSTREAM_SHA`), the runbook's frozen refs and command examples, and `currentUpstreamSha` in `scripts/check-upstream-preservation.test.ts` all name `0fe4fa40fe`. The original root stays `6a687ee43b`.

## Open items

- **Mermaid Save and Copy on desktop (KAT-3649).** An expanded diagram's Save and Copy fetch a `blob:` URL. Kata's desktop CSP has no `blob:` in `connect-src` (KAT-3454), so on desktop both show "The file could not be fetched…". Diagrams render and expand on desktop, and web is unaffected. Adding `blob:` changes the trusted `ElectronProtocol.test.ts`, so the fix goes through its own issue.
- **Routine runs and preparation Retry (KAT-3650).** Upstream's Retry appears on routine threads too. The setup-script opt-out survives it, but the routine run stays failed and frees its concurrency slot.
- **Pull-request watches on a Sprite (KAT-3651).** An active watch does not hold the Sprite activity lease, so a Sprite with no connected client can sleep through it.

## Independent review

Two independent Opus reviews covered the complete delta, split by path with no overlap. The first covered the server, contracts, routines, relay, and the alchemy patch: 149 upstream paths, 120 with a Kata delta. The second covered clients, dependencies, docs, workflows, and pin consumers: 270 upstream paths. Each compared Kata's divergence from upstream before and after the merge, file by file, so cleanly merged files got the same check as conflicts. Both returned PASS+NOTES with no blocking finding.

- Accepted and fixed: the routine flag moved off the public launch strategy onto the run record, and `thread-sidebar.md` names iOS only.
- Routed to Backlog: KAT-3649, KAT-3650, KAT-3651 (see "Open items").
- Recorded: decision rows for the two Android-only changes. A pre-existing unmatched `ConnectionsSettings.tsx` branding exception is left alone.
- Confirmed: Kata's routine RPCs sit in the scope-middleware group with `RPC_REQUIRED_SCOPES` exhaustive over every method. No migrations. KAT-3551 stop handling, the Cursor usage guard, the Sprite lease, and the Cursor plugin ports are intact. The mermaid renderer runs mermaid in strict mode and sanitizes with DOMPurify before injecting the SVG. Both SKIPs leave no dangling reference.

## Verification

Pending.
