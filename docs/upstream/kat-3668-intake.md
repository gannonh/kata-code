# KAT-3668 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `f352d5a2ebf657352b319003c0822f3ef9fd4b65` (`origin/main` 2026-10-05T07:00Z) |
| Previous upstream pin  | `0fe4fa40fe65ac9545621a65633f08d9fa29fd0d`                                   |
| Frozen upstream target | `250e052f44dd313b658abebc707242a7b25be340` (frozen 2026-10-05T07:00:40Z)     |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20261005T070028Z-claude-mini` froze 50 commits that change 302 paths: 272 modified, 27 added, 2 deleted, and 1 renamed. The previous pin is an ancestor of the target. The range brings multi-route connections (LAN and tailnet addresses beside Kata Code Connect), MCP tools that take explicit thread and project targets, shell syntax highlighting, flatter tool-call rendering, a full-screen mobile simulator viewer, install-aware update commands, and fixes across the server, web, and mobile clients. It adds no migrations, no binary assets, and no active workflow job.

## Ancestry

KAT-3648 landed the previous pin through PR #346 as merge commit `5ba3b28aa6b1c2f68b30a60a20884a47e2014210`, with parents `3b12b15c96` and the reviewed candidate `ea4362d13c`. PR #347 (`f352d5a2eb`) then pinned `expo-modules-core` to its patched version. `0fe4fa40fe` is an ancestor of the base, so the run recorded SKIP for the recovery anchor. `git merge-base --all f352d5a2eb 250e052f44` returns exactly `0fe4fa40fe`.

## Resolution method

The merge census on the base gave 61 conflicted files: 59 content and 2 modify/delete.

1. **Identity-only files.** For 23 conflicts, Kata's change from the previous pin was only the identity transform (`@t3tools/` → `@kata-sh/code-`, `T3CODE_` → `KATACODE_`, `T3 Code` → `Kata Code`, and, new this run, `T3 Connect` → `Kata Code Connect`). The resolver checked that the transform maps the previous-pin blob exactly to Kata's blob, then took upstream's blob through the same transform.
2. **Renamed-base merge.** For the rest, `git merge-file --diff3` reran with the transformed previous-pin text as the base. 19 files merged cleanly.
3. **By hand.** The remaining 16 files, the two Discord scripts, and the lockfile are listed under "Conflict resolutions".
4. **Scope rename.** 18 upstream-added or cleanly merged files imported `@t3tools/*`. They now import `@kata-sh/code-*`.
5. **Added-line identity sweep.** User-visible and agent-facing copy on lines the range added, in files that merged cleanly, says Kata Code (see "TAKE"). Lines already in the Kata base are unchanged.

## TAKE

All 50 commits apart from the SKIPs below. Kata adaptations:

| Upstream                                 | Change                                                   | Kata adaptation                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3b0093d716` #15539                      | Update commands match how the CLI was installed          | Detection matches Kata's npm packages: `@kata-sh/code-cli` with bin `katacode`, and the native `@kata-sh/code-cli-<platform>/katacode`. Commands suggest `@kata-sh/code-cli@<version>`         |
| `fe417dff4c` #15795                      | Reject accidental server launches                        | Help path, unknown-command hint, already-running error, and `install.md` say `katacode` and Kata Code                                                                                          |
| `979ca66ced` #15467, `745c225f92` #15468 | One environment over several routes; learned LAN/tailnet | The relay route is labelled Kata Code Connect. The `t3-connect` route kind is an internal persisted value and stays. `DirectEndpoints` keeps its upstream service key under the FORK.md header |
| `06e627448b` #15219                      | MCP tools take explicit thread and project targets       | Agent-facing messages and tool descriptions say Kata Code (KAT-3540)                                                                                                                           |
| `d60a71ef6e` #15551                      | Full-screen simulator viewer                             | `expo-sensors` (MIT) for shake. The Android `blockedPermissions` entry is unsupported platform                                                                                                 |
| `2a778f7a6e` #15037                      | Shell syntax highlighting                                | `unbash` 5.0.0 (ISC)                                                                                                                                                                           |
| `250e052f44` #14597                      | Uniwind 1.12.1 drops the local patch                     | Kata's patch was byte-identical to upstream's; 1.12.1 ships the patched processor                                                                                                              |
| `e01e58916f` #15440                      | Desktop prints its version before initializing           | Runs before Kata's Clerk pre-ready initialization                                                                                                                                              |
| `836098543c` #15462                      | Claude commands discovered in each workspace             | Kata's workspace scan-generation guard stays                                                                                                                                                   |
| `1c6269326a` #15512                      | Azure DevOps mark                                        | Nominative provider mark, like the existing GitHub and GitLab marks                                                                                                                            |
| Remaining fixes                          | Server, web, mobile, client-runtime                      | Kata identity where user-visible                                                                                                                                                               |

## SKIP

- `c408737628` #15072, "V2 imports stashed prompts and drafts from the V1 profile": `DesktopLegacyLocalStorage.ts`, `chromiumLocalStorage.ts`, the `legacyLocalStorage` IPC method and channels, `legacyLocalStorageMerge.ts` and its test, the `DesktopApp.ts`, `main.ts`, and `preload.ts` wiring, and the `thread-migration.md` sentence. Kata kept one desktop profile across V1 and V2 and rejected `t3code-v2` (KAT-3635), so there is no Kata V1 profile to import from. The module reads T3's `T3 Code (Alpha)` and `t3code` profiles, which would copy another product's data into Kata.
- `b4381985db` #15754, nightly changelogs in Discord announcements. Kata deleted the `announce_discord` job and `scripts/notify-discord-release.ts` (KAT-3297). The modify/delete conflicts resolve as deletions.
- `f8a308fbc9` #15845 and `de09c7566c` #15865, worktree env-file links. KAT-3332 removed env-file linking from `scripts/setup-worktree.ts`, because secrets come from the repository's 1Password Environment. Both commits change only the removed block.
- Carried forward: upstream identity on product surfaces, artwork, unlicensed assets, the deleted `AGENTS.md` / contribution-triage / `.macroscope` files, the `t3code-v2` desktop profile, and parked infrastructure.

## Conflict resolutions

- **`apps/server/src/provider/Layers/ProviderRegistry.ts`**. Kata's scan-generation guard and `readProviders` stay. Upstream's `slashCommandsPending` condition joins the error branch (#15462).
- **`apps/web/src/components/settings/ConnectionsSettings.tsx`**. Kata's `<form>` (Enter submits) wraps upstream's new relay route offer.
- **`apps/desktop/src/main.ts`**. Upstream's `--version` exit, then Kata's Clerk pre-ready initialization. **`preload.ts`** stays at the base (SKIP).
- **`apps/server/src/mcp/toolkits/orchestrator/tools.ts`**. Upstream's descriptions with standalone `T3` replaced by Kata Code.
- **`apps/server/src/cli/app.test.ts`**. Upstream's command-safety tests, with the `katacode` command path and Kata Code copy.
- **`apps/web/src/versionSkew.ts`**, **`ServerUpdateAction.tsx`**. Upstream's install-aware commands with Kata's package; the dialog says `katacode`.
- **`docs/user/install.md`**. Upstream's paragraphs with `katacode`.
- **`.github/workflows/release.yml`**, **`scripts/notify-discord-release*`**, **`scripts/setup-worktree.ts`**. Kata's side (SKIP).
- **Import, header, and comment conflicts** in `AssetAccess.test.ts`, `OpenCode2AdapterV2.ts`, `ProviderSessionManager.ts`, `AcpAdapterV2.ts`, and `runtimeLayer.test.ts`: both sides, with Kata identity.
- **`pnpm-lock.yaml`**. See "Dependencies".

## Dependencies

- `pnpm-lock.yaml` is regenerated from Kata's base lockfile with `vp install`. `uniwind` 1.12.1 and `unbash` 5.0.0 match upstream's lockfile. `expo-sensors` resolves 58.0.2 where upstream locked 58.0.1; both are inside upstream's `~58.0.1` range. vite-plus stays 0.3.3; the range bumps no test toolchain.
- `patchedDependencies` drops only `uniwind@1.11.0`, together with the version. Kata's patch was byte-identical to upstream's, and `uniwind` 1.12.1's `processor.js` contains the patched `readSelectorVariants`. No `overrides` entry changes. `patches/effect@4.0.0-rc.115.patch` takes upstream's stream-close fix (#15563).
- `expo-sensors` adds a native module, so the next iOS build needs a native rebuild.

## Preservation gate

The range changes two inventory owner paths and no trusted test file:

| Check                                  | Owner path                  | Disposition                                                                                  |
| -------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `mobile-android-asset-config-identity` | `apps/mobile/app.config.ts` | TAKE: `expo-sensors` plugin and an Android-only permission block; `platforms: ["ios"]` stays |
| `connect-early-access-waitlist`        | `apps/mobile/src/Stack.tsx` | TAKE: device preview screen options only; the Connect early-access screens are unchanged     |

`FORK.md` changes for the pin, which makes it a changed owner for the checks that list it.

## Pin consumers

`FORK.md`, both `Lint`-job literals in `.github/workflows/ci.yml` (`UPSTREAM_TIP`, `UPSTREAM_SHA`), the runbook's frozen refs and command examples, and `currentUpstreamSha` in `scripts/check-upstream-preservation.test.ts` all name `250e052f44`. The original root stays `6a687ee43b`.
