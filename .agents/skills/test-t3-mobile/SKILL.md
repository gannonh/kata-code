---
name: test-t3-mobile
description: Launch and test Kata Code Mobile on an iOS Simulator against disposable local T3 environments, including Metro and dev-client reuse, native rebuild decisions, per-client pairing, seeded projects, semantic UI control, and screenshots. Use after mobile UI or native changes, when reproducing phone or tablet behavior, pairing a simulator to isolated state, or verifying mobile behavior on macOS.
---

# Test T3 Mobile

Run one focused, end-to-end mobile verification pass against disposable T3 state. Use the sibling [`test-t3-app`](../test-t3-app/SKILL.md) skill as the detailed reference for pairing-token semantics and SQLite fixtures.

Command examples use POSIX shell syntax.

## Select a viable platform

Kata Code Mobile ships on iOS only. Android is parked (see `docs/operations/supported-platforms.md`), so do not build or verify on an Android Emulator.

Use one representative iOS Simulator on macOS with Xcode. When iOS tooling is unavailable, report the missing Xcode or simulator prerequisite rather than claiming verification. A missing development client is a build step, not a blocker.

## Ensure a compatible native client

Authorized mobile verification includes building and installing a development client. A missing, stale, or unknown native client is not a reason to skip verification or leave a PR in draft. Build and install it, then continue. Respect an explicit user instruction not to rebuild; otherwise do not ask for separate permission.

Run this from the checkout being tested, on the machine that hosts the selected simulator. Select and boot one explicit iOS UDID first:

- App: `Kata Code Dev`
- Bundle identifier: `com.katacode.dev`
- URL scheme: `katacode-dev`

```bash
node scripts/mobile-native-client.ts ensure ios <simulator-udid>
```

`ensure` compares the checkout's local Expo development fingerprint and the installed app's binary contents against the last successful build record. It reuses a matching client; otherwise it runs a clean prebuild, builds and installs the development app, and records the successful result. It does not start Metro. Start Metro below after it succeeds. On hosts with an `agent-job` requirement, run the entire `ensure` command through that queue.

For a read-only decision, use `check` in place of `ensure`. Exit 0 means compatible, 2 means build required, and 1 means an operational error. An app installed outside this helper is initially unknown and gets rebuilt once. Records are local to the simulator host under `~/.cache/katacode/native-clients` and work across checkouts. Do not copy records between machines or write them manually.

A JavaScript-only diff, bundle identifier, app version, or recent install date does not prove native compatibility. Always check the whole checkout. Expo fingerprints are computed locally with `APP_VARIANT=development`; no EAS credentials or cloud build are required. Generated `ios/` directories are excluded by `.fingerprintignore`, so edit native source modules or config plugins rather than generated output.

The development identity is `Kata Code Dev`, bundle `com.katacode.dev`, scheme `katacode-dev`. If a build fails, investigate the build error and fix the local prerequisites. Report the concrete failure if it cannot be resolved, not “no compatible client.”

## Start one disposable T3 environment

Run backend commands from the repository root. Use the ignored, worktree-local `.katacode` directory or create a fresh directory with the host OS's temporary-directory mechanism. An explicit base directory stores state in `<base-dir>/userdata`; never point testing at shared `~/.katacode` state.

Seed a small number of meaningful Git projects before starting the backend:

```bash
node apps/server/src/bin.ts project add <git-workspace> \
  --base-dir <base-dir> \
  --title <project-title>
```

Running `project add` before the backend starts gives it exclusive offline database access. If a backend is already running, wait until it is ready so the CLI dispatches through the live server; never run offline mutations concurrently with the server.

Use direct SQLite mutation only for disposable projection fixtures. Follow `test-t3-app` and stop the backend before writing.

Start a headless backend after seeding:

```bash
node apps/server/src/bin.ts serve \
  --host 127.0.0.1 \
  --port <server-port> \
  --base-dir <base-dir> \
  --no-browser
```

Use these client origins:

- iOS Simulator: `http://127.0.0.1:<server-port>`
- Physical device: bind the backend to `0.0.0.0` and use the host's reachable LAN origin

Enter the complete `http://` origin to make the test transport explicit. Bare IP addresses default to HTTP, while bare hostnames default to HTTPS. When testing web and mobile together, run `vp run dev --home-dir <base-dir> --host 127.0.0.1` instead and do not launch a second backend over the same base directory.

## Start or reuse Metro safely

Run Metro from `apps/mobile`.

1. Inspect any process on the intended Metro port and its `/status` response. Reuse it only when it is healthy, belongs to this worktree, and matches `APP_VARIANT=development`, `--dev-client`, and scheme `katacode-dev`.
2. Never kill another worktree's Metro. Use a free explicit port when necessary.
3. Run `vp run dev:client` on the standard port. For another port, retain the complete development identity:

   ```bash
   APP_VARIANT=development vp exec expo start \
     --dev-client \
     --scheme katacode-dev \
     --clear \
     --lan \
     --port <metro-port>
   ```

4. Open the exact development-client URL for the selected device and confirm the loaded bundle belongs to this worktree and Metro port.

### iOS launch

Select one UDID and set these XcodeBuildMCP session defaults:

- Workspace: `<repo>/apps/mobile/ios/KataCodeDev.xcworkspace`
- Scheme: `KataCodeDev`
- Configuration: `Debug`
- Simulator ID: the selected UDID
- Bundle ID: `com.katacode.dev`

After `ensure` succeeds, open the Metro URL:

```bash
xcrun simctl get_app_container <simulator-udid> com.katacode.dev app
xcrun simctl openurl <simulator-udid> <printed-dev-client-url>
```

Accept the iOS confirmation prompt and dismiss the developer menu when it obscures the app.

Do not start, stop, erase, or reconfigure a simulator owned by another task. Track and later stop only processes owned by this test.

## Pair each client once

Use the bundled helper from the repository root. It issues a fresh credential against the running backend's exact base directory, opens the existing Add Environment route with the credential in an encoded query parameter, and asks that route to connect once:

```bash
.agents/skills/test-t3-mobile/scripts/pair-client.sh \
  ios <simulator-udid> <server-port> <base-dir>
```

The helper uses `http://127.0.0.1:<server-port>` for iOS. Pass a fifth argument only when testing a non-development URL scheme.

The helper opens this registered route:

```text
katacode-dev://connections/new?pairingUrl=<encoded-pairing-url>&autoConnect=1
```

The Add Environment route owns the behavior: `pairingUrl` prefills its normal host and token inputs, while `autoConnect=1` submits once in development builds and returns to Home after success. Without `autoConnect`, the same route only prefills the form for manual inspection.

Do not enter pairing hosts or tokens through simulator keyboard automation. Xcode's semantic typer sends HID-style key events through the simulator's active keyboard state, which can corrupt uppercase tokens and punctuation even when the host Mac uses a U.S. input source. The one-shot route is the deterministic pairing path. Use the visible form only as a fallback, and paste credentials rather than typing them character by character.

Verify the expected seeded projects appear before exercising the affected flow.

Pairing credentials are secret, short-lived, and single-use. Create a different credential for every simulator, physical device, or browser. If an attempt fails, issue a new credential rather than retrying the old one. Do not expose tokens in screenshots, commits, or final responses.

## Drive and observe the affected flow

Use `snapshot_ui` and current element references from XcodeBuildMCP for taps and typing.

## Verify and clean up

Exercise only the affected flow on one representative device unless the change specifically concerns platform, OS version, or screen size. Before finishing:

1. Confirm the app connected to the intended disposable environment instead of merely rendering an empty disconnected state.
2. Capture the relevant final state.
3. Remove the disposable environment from Kata Code Dev.
4. Stop only the Metro, backend, simulator, and log processes started by this test.
5. Remove only base directories and temporary Git repositories deliberately created for this test. Preserve them when they contain useful reproduction evidence.

Keep local verification focused. Do not turn this workflow into a full repository test run.

## Troubleshoot predictable failures

- **Old UI or an old error appears:** verify Metro's worktree, variant, URL, and port before diagnosing the app.
- **The environment remains empty:** verify the platform-specific HTTP origin, use a fresh token, and confirm project seeding used the identical base directory.
- **A second client cannot pair:** pairing tokens are single-use; issue another token.
- **The pairing form opens but does not connect:** confirm the deep link uses the existing `connections/new` route, includes `autoConnect=1`, and carries a freshly minted encoded `pairingUrl`.
- **Pairing text changes case or punctuation:** do not retry semantic typing. Use `scripts/pair-client.sh`; the simulator keyboard layout and HID input path are not reliable for credentials.
- **iOS semantic actions fail:** set explicit XcodeBuildMCP defaults and refresh with `snapshot_ui`.
