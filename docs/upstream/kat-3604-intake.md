# KAT-3604 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `0bd2f8d76eb214b9ab21e30d2f18d13224b4b68b` (`origin/main` 2026-10-01T07:00Z) |
| Previous upstream pin  | `0fcd5f90611451cca842689faea53b5450c022da`                                   |
| Frozen upstream target | `71a90ae70e3ff880396363809bd9bfcfd520f30c` (frozen 2026-10-01T07:00:58Z)     |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20261001T070054Z-claude-mini` froze 21 commits that change 89 paths: 79 modified and 10 added. The previous pin is an ancestor of the target. The range adds one pnpm patch (`patches/alchemy@2.0.0-beta.79.patch`, a path Kata already uses), touches four workflow files, and adds no migrations or binary assets.

## Ancestry

KAT-3578 landed the previous pin through PR #332 as merge commit `0bd2f8d76eb214b9ab21e30d2f18d13224b4b68b`. `0fcd5f906` is an ancestor of the Kata base, and `git merge-base --all 0bd2f8d76 71a90ae70` returns exactly `0fcd5f906`. The run needs no recovery anchor.

The three-way merge of `71a90ae70` is `96e1b9b145c09a0c7e145760b114e764b8d2bebe`, with parents `0bd2f8d76` and `71a90ae70`. The Kata base, the previous pin, the target, and the original root are all ancestors of the candidate.

## TAKE

| Upstream            | Change                                                              | Kata note                                                               |
| ------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `6b286ae8a2` #13612 | Start threads without a project                                     | Adapted; see "Identity mapping"                                         |
| `67b175a4c9` #14028 | Build and publish npm platform packages concurrently                | Adapted into Kata's `npmPublish.ts`; see "Conflict resolutions"         |
| `6f8e2534f2` #14025 | Balance server test shards by recorded duration                     | Sequencer, weights, update script, `vite.config.ts` hook, and knip only |
| `8630e1ac7a` #14037 | Trim Windows packaging setup                                        | `release-desktop.yml`; unsupported platform, plus `checkout.workers=0`  |
| `c57a04b722` #14027 | Start Windows builds without waiting for the Linux job              | `release-desktop.yml` and the parked `release-windows.yml` only         |
| `38969148a2` #14351 | Keep WSL busy-runtime fixtures visible when sh is bash              | Unsupported platform; the holder names Kata's `katacode` runtime        |
| `c2fa9fc911` #10963 | Name the step that registers a mobile client                        | Header alignment taken; Kata copy kept                                  |
| `921cb3c8bc` #14542 | Restart the agent session from cmd+k to load new skills and plugins | `docs/user/composer.md` keeps "Kata Code commands"                      |
| `c18e5ea6ed` #14375 | Diff file names no longer clip                                      |                                                                         |
| `792c7dd127` #14479 | Double bolts for Codex Ultrafast                                    |                                                                         |
| `bd89c13020` #14486 | Grok CLIs older than 1.0.13 are marked broken                       | `model-manifest.json` equals upstream's                                 |
| `7c67876983` #14490 | Hide disconnected environments when adding projects                 |                                                                         |
| `9da066dbe9` #14497 | Claude `/compact` no longer ends early                              |                                                                         |
| `1905846e03` #14499 | Dark+ and Light+ themes import without colliding with built-in ids  |                                                                         |
| `0cf482b08b` #10154 | Composer suggestions work with screen readers                       |                                                                         |
| `7ab800a43c` #14540 | Claude subagents with their own model show that model               |                                                                         |
| `71a90ae70e` #14548 | Hotkey settings record plain keys and Tab                           |                                                                         |

## SKIP

- `35be904f2f` #14462, vite-plus 0.3.3 to 1.0.0. See "Trusted assertions". `pnpm-workspace.yaml`, `pnpm-lock.yaml`, the alchemy patch, the package test scripts, and the test and bench edits stay at the Kata base. KAT-3607 owns adoption.
- `0d9468fea9` #14480 and `d5980a0ff1` #14485, the upstream contribution triage policy: `CONTRIBUTING.md`, `.github/pull_request_template.md`, `.agents/skills/contribution-triage/SKILL.md`, and `.github/TRIAGE_EXEMPTIONS.td`. They direct contributors to pingdotgg/t3code discussions and maintainers. Kata keeps its own contribution guide and template.
- `6f8e2534f2` #14025, the `ci.yml` restructure: Lint, Typecheck, Build, and Test Web jobs, a gate job named `Check`, Blacksmith runners, and 6 server shards. Kata's `Check` job holds the frozen-tip fetch, branding, workflow-reference, trusted preservation, and knip steps on GitHub-hosted runners. `ci.yml` changes only its two pin literals. KAT-3606 evaluates the split.
- `783ccf0fdd` #14029, early Vercel builds with aliasing after publish, and marketing build and deploy jobs. Kata's `deploy_web` pins its Vercel project and rejects any project other than `katacode-web`, and Kata does not deploy marketing. Only a real release can prove the restructure, and this run cuts none. `release.yml` and `docs/operations/release.md` stay at the Kata base. KAT-3605 owns it.
- `c57a04b722` #14027's Windows jobs in `release.yml` (parked by KAT-3514) and its edit to `desktop-macos-preview-publish.yml`, which Kata deleted (KAT-3411 SKIP).
- Upstream `AGENTS.md`, user-visible T3 names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations.
- Deliberate cleanup stays in place: the deleted `.repos`, `.plans`, and `.macroscope` directories and the parked workflows.

## Identity mapping

- **Package scope.** The range's new imports of `@t3tools/client-runtime` and `@t3tools/contracts` become `@kata-sh/code-client-runtime` and `@kata-sh/code-contracts` in `DraftHeroHeadline.tsx`, `CommandPalette.tsx`, `useScratchProject.ts`, `useThreadActions.ts`, `NewTaskRouteScreen.tsx`, and `new-task-flow-provider.tsx`. `ws.ts` imports `normalizeProjectPathForComparison` from `@kata-sh/code-shared/path`.
- **State directory.** Scratch threads use `scratch` under the server's `baseDir`, which is `~/.katacode` for Kata. `docs/user/thread-sidebar.md` names `~/.katacode/scratch` and "your Kata Code data directory" instead of `~/.t3/scratch` and "your T3 data directory".
- **Copy.** `MobileClientsUserProfilePage.tsx` keeps Kata's "Sign in to Kata Code on your iPhone to register it for push notifications and Live Activities." Upstream's replacement names T3 Code and T3 Connect. `docs/user/composer.md` keeps "Kata Code commands".
- **Retained.** The `font-t3-bold` class, the comment naming a dev worktree's `.t3`, the `t3-server-test-report-` temporary prefix, and the `t3.tgz` test fixture stay under FORK.md's identifier policy.
- The added lines name no `T3CODE_` variable, `t3code:` protocol, or `t3.codes` host. `check:branding` passes.

## Trusted assertions

`mobile-agent-awareness-teardown` trusts `apps/mobile/src/features/agent-awareness/remoteRegistration.test.ts` byte for byte, and `35be904f2f` edits it. The added line mocks preferences inside an Android FCM case that Kata removed when Android was parked (KAT-3515), so the edit has no Kata target.

The same commit moves vite-plus to 1.0.0, which ships Vitest 5 and drops `describe.sequential`. The trusted file calls `describe.sequential` at line 240. On merge `96e1b9b145`:

- `vpr typecheck` failed with TS2339 in `remoteRegistration.test.ts` and in the Kata-only `remoteRegistration.android.test.ts`.
- `vp test run apps/mobile/src/features/agent-awareness/remoteRegistration.test.ts --reporter=dot`, the checker's own command, reported 1 failed file and no tests.

The base bytes no longer load under 1.0, so keeping the bump means changing a trusted file. The runbook's two-PR `unfrozenTrustedPaths` procedure is the way to do that, and it is outside this run. `ci.yml` already allowlists this file's `trusted assertion changed` line (KAT-3411), but taking that route still needs a per-run human decision, which this issue does not carry. The run therefore skipped `35be904f2f` in full (`8686041a0a`) and filed KAT-3607. No other range commit touches its files. After the revert, `vp install --frozen-lockfile` accepts the base lockfile, the trusted file passes 31 of 31 tests, and `vpr typecheck` passes. No `ci.yml` allowlist line is added.

`release.yml`, an owner path of `product-identity-release-ownership` and `release-package-ownership`, stays at base bytes. No other trusted file or owner path is in the range.

## Conflict resolutions

- **`patches/alchemy@2.0.0-beta.79.patch`** (add/add). Kata's PlanetScale patch and upstream's Vitest import patch touch different files. The merge combined them, then the vite-plus SKIP restored Kata's patch.
- **`pnpm-lock.yaml`**. Regenerated at the merge, then restored to the base by the vite-plus SKIP. `vp install --frozen-lockfile` accepts it with every other TAKE.
- **`apps/server/scripts/cli.ts`**. Kata moved npm publishing into `npmPublish.ts` (scope `@kata-sh/code-cli`, a skip for versions already on the registry, and three attempts per tarball), so `cli.ts` stays at base. `npmPublish.ts` now publishes each tarball through upstream's `publishPlatformsThenLauncher`. Platform tarballs publish at once and the launcher publishes last. When a platform fails, the other uploads finish, the launcher is skipped, and the first failure is returned. The existing `npmPublish.test.ts` cases cover the rerun skip, the retries, and the skipped launcher.
- **`apps/server/src/ws.ts`**. Kata's `RelayClient` import plus upstream's `normalizeProjectPathForComparison`.
- **`DraftHeroHeadline.tsx`, `NewTaskRouteScreen.tsx`, `new-task-flow-provider.tsx`**. Upstream's imports with Kata's package scope.
- **`MobileClientsUserProfilePage.tsx`**. Kata copy; see "Identity mapping".
- **`DesktopWslEnvironment.test.ts`**. Upstream's `holdRuntimeBusy` and `holdInstallLock` helpers, with Kata's `katacode` runtime path.
- **`performance.bench.ts`**, **`docs/user/composer.md`**. Upstream's restart paragraph with "Kata Code commands". The bench file returned to base with the vite-plus SKIP.
- **`CONTRIBUTING.md`**. Kata base, with the PR template; see SKIP.
- **`.github/workflows/ci.yml`, `release.yml`, `docs/operations/release.md`**. Kata base, apart from the two `ci.yml` pin literals.
- **`.github/workflows/release-desktop.yml`**. The single conflict was a permissions comment. Kata already needs `actions: read` for its JS bundle download, so its line stays. The clean merge brings `checkout.workers=0`, removes the Windows package cache, and moves the Windows WSL archive download behind a wait step. `.github/disabled/release-windows.yml` drops the Windows jobs' `desktop_linux_*` needs and describes the wait, as upstream's `release.yml` does.
- **`.github/workflows/desktop-macos-preview-publish.yml`** (modify/delete). Stays deleted.

## Clean merges and new files

- **New files.** `apps/web/src/hooks/useScratchProject.ts` (scope renamed), `apps/server/scripts/publishOrder.ts` and its test, and `apps/server/scripts/update-test-shard-weights.ts`, `apps/server/src/testUtils/shardWeights.json`, and `weightedShardSequencer.ts` with its test. The skipped new files are `.agents/skills/contribution-triage/SKILL.md`, `.github/TRIAGE_EXEMPTIONS.td`, and the alchemy patch body.
- **Server.** `projects.ensureScratch` requires `AuthOrchestrationOperateScope` in `RpcAuthorization.ts`. Scratch folders are created only for threads whose project root is the scratch root, and they are offered only when the data directory is outside a Git work tree. New `server.test.ts` cases post no relay configuration, so they need no `manualRelayEndpoint`.
- **Shard sequencer.** `apps/server/vite.config.ts` uses `WeightedShardSequencer` for Kata's three CI shards. Files without a recorded time, including Kata-only suites, count as fast files.
- **Model manifest.** `model-manifest.json` equals upstream's at `71a90ae70`.

## Pin consumers

These advance to `71a90ae70`:

- `FORK.md`: the Current T3 pin row, the intake and decisions links, the previous accounted-for pin (`0fcd5f906`), and the next-scan comment.
- `.github/workflows/ci.yml`: `UPSTREAM_TIP` and `UPSTREAM_SHA`. `UPSTREAM_BASE` and `UPSTREAM_BASE_SHA` stay `6a687ee43`.
- `docs/upstream/kat-3307-runbook.md`: the live pin and both command examples.
- `scripts/check-upstream-preservation.test.ts`: `currentUpstreamSha`. The historical `baselineUpstreamSha` is unchanged.

## Independent review

An independent Opus review of `8686041a0a` covered all 89 upstream paths and every path the candidate changes relative to the base. It returned PASS+NOTES:

- 51 paths carry upstream's patch exactly, 10 match after Kata renames or adaptations, and 28 are skipped per this intake. None diverge without an explanation.
- Outside upstream's paths, the candidate changes only `.github/disabled/release-windows.yml`, `FORK.md`, `apps/server/scripts/npmPublish.ts`, the runbook, this intake and its TSV, and `scripts/check-upstream-preservation.test.ts`.
- All 41 trusted test files equal the base, and the base, previous pin, target, and root are ancestors of the candidate.
- `ClaudeAdapter.ts` equals upstream's patch, and Kata's `sendTurn` stop and queue checks are intact. `CommandPalette.tsx` and the `ProviderRegistry` restart change equal the target apart from imports.
- The adapted `npmPublish.ts` publishes the launcher strictly last, skips it after any platform failure, and keeps the registry skip and three attempts per tarball.

Notes and their dispositions:

- Kata's routine editor lists the new scratch project, and `RoutineDispatcher` creates threads without the scratch folder step. Routines on ordinary projects are unaffected. KAT-3608 hides the scratch project from routines.
- The skipped commits are ancestors of the candidate, so later upstream merges will not reintroduce them. KAT-3605, KAT-3606, and KAT-3607 port them by hand.
- This intake was not yet committed at the reviewed head; the candidate adds it.

## Verification

Local gates ran on `8686041a0ae907b4f0f2bfdb74277183e0469761`. The candidate adds only this intake and its TSV on top of that commit.

| Gate                                                       | Result                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `vp check`, `vp run knip:check`, `vpr typecheck`           | Pass                                                                 |
| Branding (product and agent-facing), workflow references   | Pass (5 workflows)                                                   |
| Nightly release test, preview artifact test, release smoke | Pass                                                                 |
| Non-server test partition                                  | Pass after `ensure:electron`; the first run raced Electron's install |
| Server shards 1, 2, 3                                      | 2035, 2274, and 1652 passed; 6, 4, and 0 skipped                     |
| `vp run build:desktop`, preload bundle verification        | Pass                                                                 |

The trusted checker results and the web check are recorded on KAT-3604 against the exact candidate.

## Accepted review repair

Codex reviewed candidate `5e47151ffe` and raised one P2 on `ProviderRegistry.ts` ([thread](https://github.com/gannonh/kata-code/pull/334#discussion_r4152972923)), in code taken unchanged from upstream #14542. When an ordinary workspace scan was already running for a cwd with no snapshot, a fresh scan from Restart agent session ran beside it with the same starting snapshot. If the older scan finished first, its write changed the snapshot, so the fresh result failed the "snapshot unchanged" guard. The session then kept the pre-restart skills.

The repair adds a per-cwd scan generation. Each fresh scan bumps it, and a scan writes only while its generation is still current. The check runs in the same synchronous update as the write. Upstream's case, where a slow fresh scan must not overwrite a newer one, still holds. A new case in `ProviderRegistry.test.ts` failed before the repair, because the stale skills won, and passes after it. `vpr typecheck`, `vp check`, and the 91 provider test files pass.

## Review round on `b66f11e639`

- **Routines and the scratch project** (Codex P2, [thread](https://github.com/gannonh/kata-code/pull/334#discussion_r4153050359), also noted by the independent review). Kata's `RoutineDispatcher` creates threads through the orchestration engine, so a routine aimed at "No project" would get no per-thread scratch folder. `RoutinesPage.tsx` now filters the scratch project out of the routine targets with upstream's `isScratchProject`. A `RoutinesPage.test.tsx` case failed before the change (it offered `project-scratch`) and passes after. KAT-3608 keeps the dispatcher-side guard.
- **Compact test** (CodeRabbit). `ClaudeAdapter.test.ts` now asserts that the compact turn ends `completed`. Stream teardown would end it as `interrupted`, which the old assertions accepted.
- **Declined.** CodeRabbit asked for `--experimental-strip-types` in the `update-test-shard-weights.ts` command for Node 22.16. The repository's `package.json` requires Node `^24.13.1`, and CI installs that version. Node 24 strips types by default, which every `node scripts/*.ts` command here relies on.
- **Deferred.** CodeRabbit noted that Antigravity can republish a workspace snapshot that a fresh scan dropped. This is upstream #14542 code, taken unchanged, and it needs Antigravity and another provider on one cwd. KAT-3609 owns it.
