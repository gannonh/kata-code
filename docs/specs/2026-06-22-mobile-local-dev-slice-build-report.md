---
type: Spec
title: "Mobile local dev slice — build completion report"
description: "Build phase output for the iOS Simulator local dev slice; records code changes, branding rebrand, widget plugin, splash screen, PR review fixes, and UAT gaps."
tags: [mobile, ios, build-report]
timestamp: 2026-06-22T19:15:00Z
---

# Build completion report — mobile local dev slice

**Spec:** [2026-06-22-mobile-local-dev-slice-design.md](./2026-06-22-mobile-local-dev-slice-design.md)

**Branch:** `mobile-local-dev-slice`

**Base SHA:** `87ddc53b36099455ef111338305b5ab8b4d37eef`

**Head SHA:** `3f1056efc`

**PR:** [#9](https://github.com/gannonh/kata-code/pull/9)

## Tasks completed

| Phase                            | Status                        | Notes                                                                                                                                                                                                                     |
| -------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Build feasibility      | **Partial**                   | Prebuild + CocoaPods succeed; native compile progressed through custom modules (`t3-terminal`, `t3-review-diff`, nitro-markdown, expo-widgets). Full install/launch blocked in agent sandbox (CoreSimulator unavailable). |
| Phase 1 — Local server + pairing | **Verified (API)**            | `katacode serve --port 3773 --host 127.0.0.1` prints pairing output; OAuth bearer bootstrap at `/oauth/token` returns `token_type: Bearer`. Loopback host default fix in `pairing.ts`.                                    |
| Phase 2 — Full thread loop       | **Not verified in Simulator** | Requires successful dev client launch + manual UAT outside sandbox.                                                                                                                                                       |
| Phase 3 — Runbook + checks       | **Done**                      | [Runbook](/guides/mobile-local-dev-ios-simulator.md) committed; mobile typecheck + test pass.                                                                                                                             |
| Post-build hardening             | **Done**                      | Brand rebrand (kanji icons), splash screen gate, iOS widget build-settings plugin, Metro resolver fix, PR review fixes — all CI checks pass.                                                                              |

## Files changed

### Initial slice (commit `66a91bcf4`)

| File                                                  | Change                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/mobile/app.config.ts`                           | Development `iosIcon` → `./assets/icon.png` (fixes `actool` crash on broken `icon-composer-dev.icon`) |
| `apps/mobile/src/features/connection/pairing.ts`      | Loopback hosts (`localhost`, `127.0.0.1`) default to `http://` in `buildPairingUrl`                   |
| `apps/mobile/src/features/connection/pairing.test.ts` | Tests for loopback pairing URL construction                                                           |
| `apps/mobile/src/lib/appVariantAssets.test.ts`        | Asserts dev iOS icon raster exists; asserts legacy T3 assets absent                                   |
| `apps/mobile/README.md`                               | Links runbook; documents dev icon choice                                                              |
| `docs/guides/mobile-local-dev-ios-simulator.md`       | **New** — full local dev runbook                                                                      |
| `docs/guides/index.md`                                | Cross-link                                                                                            |
| `docs/guides/log.md`                                  | Entry                                                                                                 |

### Brand rebrand and icon hardening (commits `ddd1f265d`, `f488e384d`)

| File                                                   | Change                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `apps/mobile/assets/icon-composer-dev.icon/icon.json`  | Replaced T3/logo-mark layers with `kanji.png`; disabled translucency/specular; adjusted scale     |
| `apps/mobile/assets/icon-composer-prod.icon/icon.json` | Same kanji rebrand for prod icon composer                                                         |
| `apps/mobile/assets/icon-composer-*.icon/Assets/`      | Removed `T3.svg`, `logo-mark.svg`, paper texture; added `kanji.png` (desktop Liquid Glass raster) |
| `apps/mobile/assets/icon.png`                          | Synced to kanji brand raster (was T3 logo)                                                        |
| `apps/mobile/assets/splash-icon.png`                   | Synced to kanji brand raster                                                                      |
| `apps/mobile/assets/android-icon-*.png`                | Synced to kanji brand rasters                                                                     |
| `apps/mobile/assets/favicon.png`                       | Synced to kanji brand raster                                                                      |
| `apps/mobile/app.config.ts`                            | Pinned `iosHomeScreenIcon` to `icon-composer-prod.icon`; added `deploymentTarget: "18.0"`         |
| `scripts/generate-prod-brand-rasters.mjs`              | Added `mobileAssetsDir` and `desktopLiquidGlassKanji` targets; copies kanji into composer bundles |
| `apps/desktop/resources/logo-mark-layer.svg`           | Updated desktop Liquid Glass layer                                                                |

### Splash screen and startup (commits `f488e384d`, `49479fc02`)

| File                                             | Change                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/lib/splashScreen.ts`            | **New** — `preventAutoHideAsync()` at import; `hideSplashScreenWhenReady()` with one-shot flag + try/catch |
| `apps/mobile/src/app/_layout.tsx`                | Extracted `RootLayoutShell` that gates `AppNavigator` on `isAppReady`; calls `hideSplashScreenWhenReady()` |
| `apps/mobile/scripts/clear-expo-image-cache.mjs` | **New** — removes stale `.expo/web/cache` image directories                                                |
| `apps/mobile/package.json`                       | `dev:client` and `ios:dev` invoke cache-clearing script before Expo commands                               |

### iOS widget build-settings plugin (commits `49479fc02`, `218974f72`, `f801c49b3`, `7f8d2324a`)

| File                                                       | Change                                                                                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/plugins/withIosWidgetTargetBuildSettings.cjs` | **New** — syncs `MARKETING_VERSION` and `IPHONEOS_DEPLOYMENT_TARGET` for widget target; matches main app by bundle id; warns on missing target or unset bundle id |
| `apps/mobile/app.config.ts`                                | Wired `devClientPlugin` and `withIosWidgetTargetBuildSettings` into plugins array                                                                                 |

### Metro resolver fix

| File                          | Change                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/mobile/metro.config.js` | Added `resolveRequest` hook to redirect `@noble/hashes/crypto.js` to `@noble/hashes/crypto` |

### PR #9 review fixes (commit `3f1056efc`)

| File                                                       | Change                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/lib/splashScreen.ts`                      | Reset idempotency flag on `hideAsync()` rejection (prevents permanently stuck splash)                 |
| `apps/mobile/src/app/_layout.tsx`                          | Removed dead `isLoadingSavedConnection` guard in `AppNavigator` (parent already gates)                |
| `apps/mobile/plugins/withIosWidgetTargetBuildSettings.cjs` | Added `widgetTargetFound` tracking; warns when widget target not found instead of silent no-op        |
| `apps/mobile/package.json`                                 | Moved `APP_VARIANT`/`EXPO_NO_GIT_STATUS` from cache-clearing command to `expo prebuild` (env scoping) |
| `apps/mobile/src/widgets/AgentActivity.tsx`                | Replaced hardcoded "KC" with `PRODUCT_ABBREVIATION` from `@kata-sh/code-shared/branding`              |
| `packages/shared/src/branding.ts`                          | Added `PRODUCT_ABBREVIATION = "KC"` constant                                                          |

### Other

| File                                        | Change                                |
| ------------------------------------------- | ------------------------------------- |
| `e2e/src/harness/cleanupStaleDesktopDev.ts` | Minor adjustment to stale dev cleanup |

## Verification commands

| Command                                                  | Result                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `vp run --filter @kata-sh/code-mobile typecheck`         | **Pass**                                                                      |
| `vp run --filter @kata-sh/code-mobile test`              | **Pass** (151 tests after new pairing & asset tests)                          |
| `vp run typecheck`                                       | **Pass** (all 15 workspaces, 0 errors)                                        |
| `vp run lint:mobile`                                     | **Pass** (SwiftLint 0 violations; ktlint/detekt skipped locally)              |
| `vp run test`                                            | **1 pre-existing failure** (`service.addSavedEnvironment.test.ts`, unrelated) |
| `vp run ios:dev`                                         | **Not completed** in agent environment — see blockers                         |
| Bearer pairing `POST /oauth/token` against local `serve` | **Pass** (`token_type: Bearer`)                                               |

## Review gates

- **TDD:** New tests added before/with `buildPairingUrl` loopback fix and dev icon asset assertion.
- **Spec compliance:** Runbook documents two-step server startup (AC 7); loopback bearer path verified at HTTP layer (AC 4 partial).
- **Code quality:** Self-review; independent subagent review unavailable due to sandbox.
- **Subagent path:** Phase 0 implementer subagent dispatched; blocked on simulator sandbox.
- **PR review:** All 5 review comments from CodeRabbit, Greptile, and Codex addressed and threads resolved (commit `3f1056efc`).

## Approved deviations

1. **Dev iOS icon:** Use `icon.png` instead of `icon-composer-dev.icon` for development variant — Icon Composer bundle crashed `actool` (`nil object`); dev `.icon` referenced missing raster assets.
2. **UAT evidence:** Simulator screenshots/screen recording not captured in Build — agent shell cannot access `CoreSimulatorService`. Re-run steps in [runbook](/guides/mobile-local-dev-ios-simulator.md) locally for AC 1–3 evidence.

## Known follow-up

- Capture AC 1–3 UAT evidence (home screenshot, connected environment, prompt → response recording) in Verify phase from a non-sandboxed terminal.
- Preview/production variants still use `.icon` bundles; revisit Icon Composer assets separately.
- The pre-existing `service.addSavedEnvironment.test.ts` failure is unrelated to this branch.

## Transition to Verify

Build is **not fully complete** against AC 1–3 until Simulator UAT is run locally. Proceed to Verify when dev client build + pairing + thread loop are demonstrated with cited evidence. All post-build hardening (branding, splash, widget plugin, PR review fixes) is complete with CI green.
