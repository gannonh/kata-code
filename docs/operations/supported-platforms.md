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
