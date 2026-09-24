# KAT-3454 upstream intake

## Frozen refs

| Value                  | Commit                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| Kata base              | `c699005eb5b8beae930afba9c662ec3728edfb05` (`origin/main` 2026-09-24) |
| Previous upstream pin  | `f5ef0ddb90a8c36584e181b1913e7b8a5df30ffc`                            |
| Frozen upstream target | `e67abcf798f8c4d8458755e3b4dde02c2c1f628b` (frozen 2026-09-24T07:00Z) |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                            |

Run `kat-upstream-20260924T070041Z-claude-mini` froze a range of 15 commits and 124 changed paths. The previous pin is an ancestor of the target. The range has no migration, `.repos/`, or `.plans/` paths. It touches three workflow files and `.github/VOUCHED.td`.

KAT-3441 landed the previous pin through PR #256 as merge commit `ee596604f92ac088fa8e3ece1b516736ba50a831`, the first integration since PR #212 to land as a merge instead of a squash. `f5ef0ddb9` is an ancestor of the Kata base, and `git merge-base --all HEAD e67abcf79` returned exactly the previous pin, so this run records no ancestry anchor.

## TAKE

- Merge frozen tip `e67abcf79` with a normal three-way merge.
- Take the upstream product changes: the interactive 3D device workspace and its `three` 0.180.0 dependency, mobile environment and provider update management, provider compatibility ranges for every harness, preview automation routing to the visible browser tab, suppression of replayed agent alerts after a server restart, the previous-worktree branch second line, the effort brain icon, composer chip ring clipping, switch accessibility state, the final quoted empty CSV record fix, the SnapShot shortcut helper Dock fix, mobile showcase agent-activity capture, model manifest updates, and related tests. Map `@t3tools/*` imports to `@kata-sh/code-*`.
- Take the OpenTelemetry kill switch with a Kata operator variable. `FORK.md` sets the environment prefix to `KATACODE_*`, so upstream's `T3CODE_OTEL_SDK_DISABLED` is `KATACODE_OTEL_SDK_DISABLED` in code, tests, the WSL environment forward list, and `docs/operations/observability.md`. The specification variable `OTEL_SDK_DISABLED` is unchanged. Private symbols such as `T3CODE_TRUE` stay under the identifier policy.
- Take release-test sharding in `.github/workflows/release.yml` on Kata's terms: `test` and `test_server` jobs on `ubuntu-24.04` with `@kata-sh/code-*` filters, no `setup-apt-mirrors` step, and no Blacksmith mirror edit. `publish_cli` keeps Kata's `build_sandbox_image` gate and adds the two test jobs. The quality job keeps its 45-minute budget.
- Take upstream's edits to the parked `mobile-eas-preview.yml` and `mobile-showcase-screenshots.yml`. Git applied them by rename to `.github/disabled/`, where they stay inactive. The new Google services step reads `KATACODE_ANDROID_GOOGLE_SERVICES_FILE`, the name `apps/mobile/app.config.ts` reads.

## SKIP

- Skip `.github/VOUCHED.td`. Kata deleted it; KAT-3411 recorded the same SKIP.
- Skip the four Apple device models in `apps/web/src/components/device/models/`, their `sources.json`, and `scripts/convert-device-model.py`. Upstream's `sources.json` records `"author": "Apple Inc."` and `"assetLicense": "No open-source or redistribution license has been established."` The hosted web and desktop bundles would redistribute them. `deviceModels.ts` returns no model, so the workspace renders upstream's procedural device body (`createPhoneScene`) and offers no iPad keyboard accessory. KAT-3455 holds the decision on licensed models.
- Skip upstream's `blob:` addition to the desktop Content Security Policy `connect-src`. Upstream added it only so GLTFLoader can fetch textures embedded in the skipped models. Without the models the directive has no consumer, so the policy stays as narrow as the Kata base. KAT-3455 restores it together with any licensed models.
- Skip upstream `AGENTS.md`, user-visible T3 product names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations.
- Skip changes that remove Kata Docker and Sprite behavior, the disabled-by-default sandbox preview, process byte APIs, credential cleanup, provider isolation, mixed-fleet adapters, or GitHubCli discovery APIs. None in this range does.
- Keep deliberate cleanup: deleted `.repos`, `.plans`, and parked workflows.

## Conflict resolutions

19 paths conflicted: 18 content conflicts and one Kata deletion of an upstream-modified file (`.github/VOUCHED.td`). Twelve content conflicts were `@t3tools` versus `@kata-sh/code-*` imports next to upstream's new `OtelEnvironment` or device imports. They take Kata's import lines plus upstream's added imports with the scope mapped. Behavior resolutions:

- `apps/server/src/config.ts`: keep Kata's `OtlpProtocol` import and add `OtelEnvironment`.
- `apps/desktop/src/backend/DesktopBackendConfiguration.ts`: forward `KATACODE_OTEL_SDK_DISABLED` and `OTEL_SDK_DISABLED` to the WSL server with Kata's `KATACODE_OTLP_*` names.
- `apps/mobile/src/features/agent-awareness/androidNotifications.ts`: keep Kata's injectable `nativeLoader` and test hook. Take upstream's `appScheme()` helper with Kata's `katacode` fallback and route `showAndroidShowcaseAgentActivity` through `nativeLoader()`.
- `apps/web/src/components/device/DevicePanel.tsx`: take upstream's move of stream state into `DeviceWorkspace`. Kata's `hostId` argument to `useDeviceHubAccess` survives there as `props.device.hostId`.
- `.github/workflows/release.yml`: as described under TAKE.
- `pnpm-lock.yaml`: regenerated from the merged manifests with `vp install`. The change adds `three`, `@types/three`, and their transitive type packages.

## Clean merges and new files

Clean merges and new files received the same review as conflicts. Fifteen cleanly merged or new files arrived with `@t3tools` imports and were remapped. New user-visible copy was rebranded: the mobile environment detail screen (`Install ${APP_BASE_NAME}`, the section title, and the restart hint) and the showcase Live Activity title use `APP_BASE_NAME`. A SnapShot helper comment now says Kata Code. The Android native module's existing `t3code` scheme fallback predates this range and stays; JavaScript always passes the configured scheme.

The optional `liveTabs` field on preview automation host focus is additive on the wire, so mixed-version clients keep working.

## Trusted assertions

The preservation gate requires each check's trusted test files to match the Kata base byte for byte. Upstream edited two of them. PR CI run 35968423338 on the first candidate `c0742c00e9a3312189c60e87bc5bb484390ca47e` failed `desktop-protocol-bundle-identity` (`ElectronProtocol.test.ts`, the `blob:` source) and `desktop-window-behavior` (`DesktopWindow.test.ts`, a new trackpad test). The next candidate restores both files to the base. The CSP change is skipped, as described above. Upstream's `forwards native trackpad release to the renderer` test moves unchanged in substance to the Kata companion suite `DesktopWindow.upstream.test.ts`, which reads the `input-event` listener from the `webContents.on` mock. The test fails when `DesktopWindow.ts` stops forwarding `gestureScrollEnd`. No waiver was added to `ci.yml`.

Retained owners changed against the Kata base: `FORK.md` (pin and intake links), `docs/upstream/kat-3307-runbook.md` (pin literals), and `.github/workflows/release.yml` (test sharding). Live pin consumers are `FORK.md`, both `ci.yml` literals, the runbook, and live-tree `currentUpstreamSha` in `scripts/check-upstream-preservation.test.ts`. Each now names `e67abcf79`. `withHistoricalBaselineWorktree` keeps its historical commit's own pin.

## Previous run

KAT-3441's landed merge `ee596604f` had no recorded post-merge acceptance or lesson. This run ran the checker archived from pre-merge parent `dde7d73422d4f8e065ee4ccb53e48f8ebdc4aa08` against it and recorded the result on KAT-3441. Its lesson follows a separate maintenance issue.

## Independent review

An independent Opus reviewer read the complete fork delta, including clean merges and new files, and compared every Kata change on upstream-touched paths before and after the merge. Identity, the OpenTelemetry rename, `release.yml`, the device-model skip, retained Kata behavior, wire compatibility, and parked infrastructure were clean. It found two defects, both fixed: the moved trackpad test failed `vpr typecheck` because the `webContents.on` mock types its calls from the last overload, and the parked EAS preview workflow read `T3CODE_ANDROID_GOOGLE_SERVICES_FILE`. It also noted that the release `test` job keeps CI's 10-minute limit, and that `docs/operations/release.md` still mentions the deleted `VOUCHED.td`, which predates this range.

## Host limits

Local verification ran on a macOS arm64 Mac mini inside a Kata Code agent shell, which inherits `ELECTRON_RUN_AS_NODE=1` from the desktop backend (KAT-3452). With it set, `build-desktop-artifact.test.ts` fails the cross-architecture Windows case and the preservation checker reports `desktop-packaging-asset-identity` FAIL. Local gates therefore run with the variable unset.
