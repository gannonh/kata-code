# Supported platforms

Kata Code builds, ships, and verifies these platforms only. Any other platform
is parked: its code stays in the tree, but no release builds it, no CI job
tests it, and upstream intake takes changes to it without Kata review
([rebase-kata-upstream](../../.agents/skills/rebase-kata-upstream/SKILL.md),
[preservation runbook](../upstream/kat-3307-runbook.md#unsupported-platform-paths)).

## Supported platforms

| Platform | What ships                                                                     |
| -------- | ------------------------------------------------------------------------------ |
| macOS    | Desktop app (Apple Silicon and Intel DMG), CLI archive and npm package (arm64) |
| Linux    | Desktop app (x64 and arm64 AppImage), CLI archive and npm package (x64, arm64) |
| iOS      | Mobile app through TestFlight                                                  |

## Parked platforms

A parked platform keeps its source code. Kata does not delete upstream-owned
files for it, because upstream still edits them and a deleted file conflicts on
every sync. Kata stops building, testing, and shipping it instead.

### Windows

Parked by KAT-3514. Existing Windows installs keep their installed version:
no newer build appears on their update feed. Release notes carry a line that
says Windows builds are paused.

What was parked and where it lives:

| Piece                                                           | Where it is now                                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `desktop_win_x64`, `desktop_win_arm64`                          | `.github/disabled/release-windows.yml` (removed from `.github/workflows/release.yml`)                                                                                                      |
| Windows updater manifest merge step                             | `.github/disabled/release-windows.yml`, under `release_steps`                                                                                                                              |
| Windows package cache, WSL runtime embed, Azure Trusted Signing | Still in `.github/workflows/release-desktop.yml`, behind `inputs.platform == 'win'`. No caller passes `platform: win`, so these steps never run.                                           |
| Windows CLI archives and npm packages                           | `win32-arm64` and `win32-x64` removed from `CLI_ARCHIVE_PLATFORM_KEYS` in `packages/shared/src/cliRelease.ts`. The `@kata-sh/code-cli-win32-*` packages stay on npm at their last version. |
| Windows download table                                          | `renderReleaseBody` in `scripts/release-asset-names.ts` shows it again as soon as a release carries a Windows `.exe`                                                                       |
| PowerShell installer                                            | `scripts/install.ps1` stays in the tree, unadvertised                                                                                                                                      |
| Install docs                                                    | The PowerShell install and WSL sections were removed from `README.md` and `docs/user/install.md` (restore them from the KAT-3514 PR)                                                       |

#### Turn Windows back on

1. In `.github/workflows/release.yml`, restore the pieces in
   `.github/disabled/release-windows.yml` by following the steps in its header:
   the two jobs, their `needs` and `if` entries in `publish_cli` and `release`,
   the manifest merge step, and the `release-assets/*.exe` line in the asset
   list. Delete `.github/disabled/release-windows.yml` and remove it from
   `.github/disabled/README.md`.
2. Add `"win32-arm64"` and `"win32-x64"` back to `CLI_ARCHIVE_PLATFORM_KEYS` in
   `packages/shared/src/cliRelease.ts`, and restore the Windows cases in
   `cliRelease.test.ts` and `scripts/build-npm-platform-packages.test.ts`.
3. Restore the PowerShell install lines and the WSL section in `README.md` and
   `docs/user/install.md`, and the Windows lines in
   `docs/operations/release.md` sections 1 and 2.
4. Check these GitHub Actions secrets are set and current
   ([release runbook, section 3](./release.md#3-azure-trusted-signing-setup-windows)).
   Without them the Windows installer and CLI ship unsigned:
   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID`
   - `AZURE_CLIENT_SECRET`
   - `AZURE_TRUSTED_SIGNING_ENDPOINT`
   - `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
   - `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
   - `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`
5. Confirm the npm trusted publisher for `@kata-sh/code-cli-win32-arm64` and
   `@kata-sh/code-cli-win32-x64` still points at `.github/workflows/release.yml`.
6. Remove the Windows entry from the unsupported-path lists in the
   `rebase-kata-upstream` skill and the preservation runbook, and review the
   upstream Windows changes taken while it was parked.
7. Run the checks:
   - `node scripts/check-workflow-references.mjs`
   - `node --test scripts/check-workflow-references.node-test.mjs`
   - `actionlint .github/workflows/release.yml .github/workflows/release-desktop.yml`
   - `cd scripts && vp test run build-npm-platform-packages.test.ts release-asset-names.test.ts merge-update-manifests.test.ts`
   - `cd packages/shared && vp test run src/cliRelease.test.ts`
8. Dispatch the Release workflow with `channel=nightly` and `dry_run=true`, and
   confirm both Windows jobs build, sign, and smoke-test. Then run a real
   nightly and install it on Windows x64 and arm64.
9. Move this section from "Parked platforms" to "Supported platforms".

### Android

Parked by KAT-3515. The mobile app builds for iOS only. `expo prebuild`
generates no `android/` project, and CI runs no Kotlin checks.

What was parked and where it lives:

| Piece                                      | Where it is now                                                                                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expo platform list                         | `apps/mobile/app.config.ts` sets `platforms: ["ios"]`. The `android` block and the Android options inside plugin entries stay in place and do nothing.                                                            |
| `withAndroid*` config plugins              | The seven files stay in `apps/mobile/plugins/`, unlisted in the `plugins` array                                                                                                                                   |
| Kotlin native modules                      | `apps/mobile/modules/*/android/` and the `*.android.ts(x)` files under `apps/mobile/src/` stay in the tree, unbuilt                                                                                               |
| Build scripts                              | Removed from `apps/mobile/package.json`: `android*`, `eas:android:*`, `profile:android:hermes`, and the platform-less `eas:dev`, `eas:preview`, `eas:preview:dev`, `eas:prod`, which could start an Android build |
| EAS profiles                               | The `android` fields were removed from `apps/mobile/eas.json`                                                                                                                                                     |
| ktlint and detekt                          | Removed from `apps/mobile/Brewfile` and `scripts/mobile-native-static-check.ts`. `apps/mobile/detekt.yml` and `apps/mobile/.editorconfig` stay in the tree.                                                       |
| Mobile Native Changes pattern              | `.github/workflows/ci.yml` no longer matches `.kt`, `.kts`, `detekt.yml`, or `.editorconfig`, so a Kotlin-only change does not start native static analysis                                                       |
| Android notifications (FCM)                | The relay's FCM path (`infra/relay`, `FCM_SERVICE_ACCOUNT`) stays deployed and unused. [Android notifications](./android-notifications.md) keeps the Firebase setup.                                              |
| Preservation checks                        | `RETIREMENTS` in `scripts/lib/upstream-preservation/checks.ts` retires `mobile-android-asset-live-evidence`, `mobile-android-fab-inset`, and the Material You theme paths. The inventory still lists them.        |
| Mobile docs and the `test-t3-mobile` skill | Describe iOS only (restore the Android sections from the KAT-3515 PR)                                                                                                                                             |

#### Turn Android back on

1. In `apps/mobile/app.config.ts`, set `platforms: ["ios", "android"]` and add
   these entries back to `plugins`, after `./plugins/withIosSceneLifecycle.cjs`:

   ```ts
   "./plugins/withAndroidCleartextTraffic.cjs",
   "./plugins/withAndroidGradleHeap.cjs",
   "./plugins/withAndroidInputBackground.cjs",
   "./plugins/withAndroidModernPopupMenu.cjs",
   "./plugins/withAndroidModernAlertDialog.cjs",
   "./plugins/withAndroidPredictiveBackCompat.cjs",
   "./plugins/withAndroidTabletOrientation.cjs",
   ```

2. Add these scripts back to `apps/mobile/package.json`:

   ```json
   "android": "EXPO_NO_GIT_STATUS=1 expo prebuild --clean --platform android && expo run:android",
   "android:dev": "APP_VARIANT=development EXPO_NO_GIT_STATUS=1 expo prebuild --clean --platform android && REACT_NATIVE_PACKAGER_HOSTNAME=localhost expo run:android",
   "android:preview": "APP_VARIANT=preview EXPO_NO_GIT_STATUS=1 expo prebuild --clean --platform android && expo run:android",
   "android:prod": "APP_VARIANT=production EXPO_NO_GIT_STATUS=1 expo prebuild --clean --platform android && expo run:android",
   "eas:android:dev": "eas build --profile development -p android",
   "eas:android:preview": "eas build --profile preview -p android",
   "eas:android:preview:dev": "eas build --profile preview:dev -p android",
   "eas:android:prod": "eas build --profile production -p android",
   "eas:dev": "eas build --profile development",
   "eas:preview": "eas build --profile preview",
   "eas:preview:dev": "eas build --profile preview:dev",
   "eas:prod": "eas build --profile production",
   "profile:android:hermes": "mkdir -p profiles/review && react-native profile-hermes profiles/review",
   ```

3. In `apps/mobile/eas.json`, add `"android": { "buildType": "apk" }` to
   `build["preview:dev"]`, `"android": { "track": "alpha", "releaseStatus": "completed" }`
   to `submit["v2-preview"]`, and `"android": { "track": "internal" }` to
   `submit.production`.
4. Restore the CI checks:
   - Add `brew "ktlint"` and `brew "detekt"` to `apps/mobile/Brewfile`.
   - In `scripts/mobile-native-static-check.ts`, collect `.kt` and `.kts`
     sources again and run `ktlint <sources>` and
     `detekt --config detekt.yml --input <sources> --build-upon-default-config`
     from `apps/mobile`. The KAT-3515 PR shows the removed code.
   - In `.github/workflows/ci.yml`, set the Mobile Native Changes pattern back
     to match `^apps/mobile/.*\.(swift|kt|kts)$` and
     `^apps/mobile/(\.swiftlint\.yml|detekt\.yml|\.editorconfig|Brewfile)$`.
5. Set up Firebase and FCM by following
   [Android notifications](./android-notifications.md): register
   `com.katacode.dev`, `com.katacode.preview`, and `com.katacode.app` in a
   Firebase project, set `KATACODE_ANDROID_GOOGLE_SERVICES_FILE` for prebuild
   and EAS builds, and confirm the relay's `FCM_SERVICE_ACCOUNT` secret is
   still valid. Add the Clerk callbacks listed in
   [Android native sign-in redirects](./connect-setup.md#android-native-sign-in-redirects).
6. Remove the KAT-3515 entries from `RETIREMENTS` in
   `scripts/lib/upstream-preservation/checks.ts` and update the retirement test
   in `scripts/check-upstream-preservation.test.ts`. The live check
   `mobile-android-asset-live-evidence` returns to the human-review gate, and
   the standing waiver in the `rebase-kata-upstream` verification reference
   needs a decision. Remove the Android entry from the unsupported-path lists
   in the `rebase-kata-upstream` skill and the preservation runbook, and review
   the upstream Android changes taken while it was parked.
7. Restore the Android sections of `apps/mobile/README.md` and
   `.agents/skills/test-t3-mobile/SKILL.md` from the KAT-3515 PR.
8. Run the checks:
   - `cd apps/mobile && APP_VARIANT=development vp exec expo prebuild --platform android --no-install`,
     and confirm `android/` is generated
   - `node scripts/mobile-native-client.ts ensure android <emulator-serial>`
   - the native notification tests in [Android notifications](./android-notifications.md)
   - `vp run lint:mobile` with ktlint and detekt installed
9. Move this section from "Parked platforms" to "Supported platforms".
