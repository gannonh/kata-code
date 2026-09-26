---
name: release-testflight
description: Ship a Kata Code iOS build to TestFlight. Dispatches the Mobile TestFlight GitHub workflow, watches it, triages failures, and reports the uploaded version and build number. Falls back to building on this Mac with the signed-in Xcode account. Use when asked to cut, ship, upload, or deploy a TestFlight or iOS beta build of Kata Code.
---

# Release TestFlight

The Mobile TestFlight workflow (`.github/workflows/mobile-testflight.yml`) and a local run both call `scripts/mobile-testflight.ts`. It prebuilds the production app (`com.katacode.app`) with OTA off, archives with automatic signing for team `ZBZKKWF95G`, and uploads to App Store Connect. The build number is the UTC upload minute (`YYYYMMDDHHmm`). Setup and background are in `docs/operations/release.md#mobile-testflight`.

Bare `gh` in this repo targets upstream. Pass `-R gannonh/kata-code` on every call.

## 1. Check prerequisites

```bash
gh secret list -R gannonh/kata-code | grep -E '^APPLE_API_(KEY|KEY_ID|ISSUER)\b'
gh workflow view mobile-testflight.yml -R gannonh/kata-code >/dev/null
```

All three secrets must be listed. If any is missing, stop and tell the user which ones, and point to the one-time setup in the release doc. Creating the App Store Connect app record and the API key needs a human. If the workflow is not on `main` yet, only the local path (step 4) works.

## 2. Dispatch and watch

Build from `main` unless the user names another ref. Pass `-f upload=false` when they want a signed build without an upload.

```bash
gh workflow run mobile-testflight.yml -R gannonh/kata-code --ref main
sleep 5
run_id="$(gh run list -R gannonh/kata-code --workflow mobile-testflight.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id" -R gannonh/kata-code --exit-status --interval 60
```

A run takes roughly 30 to 60 minutes. Run the watch in the background and wait for it to exit instead of polling.

## 3. Report or triage

On success, read the result line from the log:

```bash
gh run view "$run_id" -R gannonh/kata-code --log | grep -E 'Uploaded Kata Code|Exported Kata Code'
```

Report the version, build number, commit, and run URL. Say that App Store Connect processes the build before TestFlight lists it. Do not claim the build is installable until the user confirms it appears.

On failure, find the first error with `gh run view "$run_id" -R gannonh/kata-code --log-failed`, then match it:

| Symptom | Cause and action |
| --- | --- |
| `Missing TestFlight configuration: ...` | A secret or `production` environment variable is unset. Report the names. |
| `No profiles for 'com.katacode.app...'`, or a certificate can't be created | The API key lacks the Admin role, or the Apple account has a pending agreement. Ask the user to check in App Store Connect. |
| `No suitable application records were found` | The App Store Connect app record for `com.katacode.app` doesn't exist. Ask the user to create it. |
| `The train version ... is closed` or `must be higher than the previously approved version` | App Store approval closed the current `version`. Ask the user which version to bump to. Don't pick one. |
| Compile or `pod install` errors | A real build break. Reproduce it locally with `node scripts/mobile-testflight.ts --no-upload` and fix it on a branch with its own Linear issue. |

## 4. Local fallback

Use this path when CI can't run, for example when the workflow isn't on `main` yet or the API key isn't set up. It needs macOS with Xcode, CocoaPods, the repo installed (`vp i`), and Xcode > Settings > Accounts signed in to team `ZBZKKWF95G`. If `xcodebuild` reports `Unable to log in with account`, the Xcode session expired. Only the user can fix that, by signing in again.

```bash
export OP_SERVICE_ACCOUNT_TOKEN=...   # the Expo config loads Clerk and relay settings from 1Password
node scripts/mobile-testflight.ts               # add --no-upload to stop after export
```

Without Clerk and relay config the script refuses to upload and names the missing variables. `--no-upload` still builds, for checking that the app compiles and signs.
