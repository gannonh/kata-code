---
type: Guide
title: "Mobile local dev — iOS Simulator"
description: "Build the Kata Code mobile dev client on the iOS Simulator, pair to a local katacode server over loopback, and run a thread end-to-end without Kata Code Connect."
tags: [mobile, ios, simulator, dev-build, pairing, local-dev]
timestamp: 2026-06-22T19:10:00Z
---

# Mobile local dev — iOS Simulator

This runbook proves the first local mobile slice: **Kata Code Dev** on the iOS Simulator, paired to a loopback `katacode` server via bearer token (no Clerk, no relay). Design spec: [mobile local dev slice](/specs/2026-06-22-mobile-local-dev-slice-design.md).

## Prerequisites

- macOS with **Xcode** installed (`xcodebuild -version`).
- **iOS Simulator runtime** matching the installed Xcode SDK. If `expo run:ios` reports no eligible destinations, install the platform:

  ```bash
  xcodebuild -downloadPlatform iOS
  ```

  Then pick a simulator from the matching runtime:

  ```bash
  xcrun simctl list devices available
  ```

- **CocoaPods** (installed automatically by `expo prebuild` on first build).
- A built server CLI (`apps/server/dist/bin.mjs` exists after `pnpm run build` or routine dev setup).
- At least one **agent provider** configured on the host (same setup used for desktop/web dev).
- Optional: raise file-descriptor limits if native builds fail with `EMFILE` / `Too many open files` (common during first full Xcode compile).

## 1. Start the local server (pairing + runnable project)

The server CLI is `node apps/server/dist/bin.mjs` (the `katacode` bin, not a global command). It prints headless pairing output but does **not** auto-register a project. Use both steps:

**Terminal A — headless server with pairing output**

```bash
cd /path/to/kata-code
node apps/server/dist/bin.mjs serve --port 3773 --host 127.0.0.1
```

Wait for:

```text
Connection string: http://127.0.0.1:3773
Token: <ONE_TIME_TOKEN>
Pairing URL: http://127.0.0.1:3773/pair#token=<ONE_TIME_TOKEN>
```

Use the printed **Connection string** host (`127.0.0.1:3773` or `localhost:3773`) and **Token** in the Simulator pairing form. The token is one-time; restart `serve` if it expires before pairing.

**Terminal A (continued) — register a runnable project**

In a second shell against the same `KATACODE_HOME` (default `~/.katacode`):

```bash
node apps/server/dist/bin.mjs project add /path/to/your/repo
```

Replace `/path/to/your/repo` with a git repo the provider can run against. Confirm the project appears in the web/desktop client or server logs.

> **Local-only:** You do not need Kata Code Connect sign-in. Relay errors in server logs are expected when offline; pairing and threads still use the bearer path on loopback.

## 2. Build and launch the dev client

From `apps/mobile`:

```bash
cd apps/mobile
vp run dev:client    # Terminal B — Metro for the dev client (keep running)
vp run ios:dev       # Terminal C — prebuild (first time) + compile + install
```

First `ios:dev` clears stale Expo image cache (`node ./scripts/clear-expo-image-cache.mjs`), then runs `expo prebuild --clean --platform ios` with `APP_VARIANT=development EXPO_NO_GIT_STATUS=1` and generates `ios/` (gitignored). Subsequent runs reuse the native project unless you pass a clean prebuild.

**Development variant notes**

- App name: **Kata Code Dev** (`com.katacode.dev`).
- Icons and splash use Kata brand rasters synced from `apps/desktop/resources/source.png` (`pnpm run generate:brand-rasters`). Splash and dev menu use `assets/icon.png`; the iOS home screen uses `icon-composer-prod.icon` (desktop Liquid Glass `kanji.png`).
- The Expo dev tools floating button is disabled (`toolsButton: false`) so it does not cover the app settings icon. Open the dev menu with **⌘D** in Simulator when needed.
- If the build targets an outdated simulator runtime, pass an explicit device id:

  ```bash
  xcrun simctl list devices available
  APP_VARIANT=development npx expo run:ios --device <SIMULATOR_UDID>
  ```

Success criteria: the app installs, launches to the home screen, and shows no redbox.

## 3. Pair from the Simulator (manual host + token)

1. Stay signed out of **Kata Code Connect** (no Clerk session required).
2. Open **Add Environment** (connections flow).
3. Enter:
   - **Host:** `127.0.0.1:3773` or `localhost:3773` (from the printed connection string, without `http://` is fine — loopback hosts default to HTTP).
   - **Pairing code:** the **Token** printed by `serve`.
4. Tap **Add environment**.
5. Confirm the saved environment shows a green **ConnectionStatusDot** (status **ready**).

Bearer bootstrap path: the saved connection uses `authenticationMethod: "bearer"` (not `relayManaged` / DPoP).

## 4. Run a thread end-to-end

1. Open the paired environment.
2. Start a **new thread**.
3. Send a prompt that triggers a real agent response. For tool/activity UI coverage, use a prompt that forces at least one tool call (for example: “List files in the project root using your tools”).
4. Confirm streamed assistant text appears on the Simulator.
5. Confirm the same thread is visible server-side (server logs, or web/desktop client against the same server).

## 5. Verification commands

```bash
# Mobile static checks (from repo root)
vp run --filter @kata-sh/code-mobile typecheck
vp run --filter @kata-sh/code-mobile test

# Optional: native static analysis
node scripts/mobile-native-static-check.ts
```

## Troubleshooting

| Symptom                                                               | Likely cause                                              | Fix                                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Unable to find a destination matching…` / `iOS X.Y is not installed` | Simulator runtime older than Xcode SDK                    | `xcodebuild -downloadPlatform iOS`; pick a simulator on the new runtime                                           |
| `actool` / `attempt to insert nil object` during compile              | Broken Icon Composer `.icon` asset references             | Run `pnpm run generate:brand-rasters`; ensure `icon-composer-*.icon/Assets/kanji.png` exists                      |
| Expo gear overlay blocks app settings                                 | Dev client tools button                                   | Rebuild after `toolsButton: false` in `app.config.ts`; use **⌘D** to open dev menu                                |
| T3 blueprint splash before Kata splash                                | Stale `.expo/web/cache` splash image from pre-Kata assets | Delete the app from Simulator, then `cd apps/mobile && vp run ios:dev` (clears Expo image cache + clean prebuild) |
| `Too many open files` during Xcode compile                            | Heavy parallel compile                                    | Retry build; close other Xcode/simulator processes; reduce `xcodebuild -jobs`                                     |
| Pairing fails / connection not ready                                  | Wrong host scheme, expired token, or no project           | Re-run `serve` for a fresh token; use loopback host; run `project add`                                            |
| HTTPS errors to localhost                                             | Bare host defaulted to HTTPS on non-loopback patterns     | Use `127.0.0.1:3773` / `localhost:3773` or full `http://127.0.0.1:3773`                                           |

## Automated E2E

The [mobile E2E testing foundation](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md) automates the manual loop above. The TS orchestrator (`vp run e2e:mobile`) reuses the same three services, automating some and checking others:

| Manual step (this guide)                                       | E2E harness                                                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal A — `node apps/server/dist/bin.mjs serve`             | Automated by `startServerStack` (isolated port + `project add`). Skipped for `@smoke`.                                                                                                |
| Terminal B — `vp run --filter @kata-sh/code-mobile dev:client` | Not automated; keep Metro running (dev client red-screens without it).                                                                                                                |
| Terminal C — `vp run --filter @kata-sh/code-mobile ios:dev`    | Not rebuilt per run; `assertDevClientInstalled` checks `com.katacode.dev` is present and fails loud if not. Build once with `vp run e2e:mobile:build` (alias for the same `ios:dev`). |

For `@smoke` alone: no server, no credentials. The harness boots the simulator and asserts the home screen. For `@pairing`/`@auth`/`@agent` the harness starts the server and requires the env vars documented in the [operator reference](../../mobile-e2e/README.md).

Run e2e commands from the **repo root** (not `apps/mobile`):

```bash
vp run e2e:mobile --include-tags @smoke     # launch + home-screen assert
vp run e2e:mobile --include-tags @pairing   # bearer loopback pairing
vp run e2e:mobile --list                    # list flows without running
vp run e2e:mobile:studio                        # maestro studio for locator discovery
```

See the [design spec](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md) for acceptance criteria and architecture. For Maestro Studio authoring (locators, new flows, editing existing YAML), see [Mobile E2E authoring (Maestro Studio)](/guides/e2e-mobile-authoring-maestro-studio.md).

## Related docs

- [Mobile E2E authoring (Maestro Studio)](/guides/e2e-mobile-authoring-maestro-studio.md)
- [Mobile E2E testing foundation design](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md)
- [Mobile E2E operator reference](../../mobile-e2e/README.md)
- [Mobile app README](../../apps/mobile/README.md)
- [Remote access architecture](/architecture/remote.md)
- [Quick start](/getting-started/quick-start.md)
