---
type: Guide
title: "E2E test catalog (desktop + mobile)"
description: "Single index of every Kata Code end-to-end test — desktop/web Playwright Electron specs and mobile Maestro iOS-Simulator flows — with tags and run commands."
tags: [testing, e2e, playwright, maestro, electron, mobile, catalog]
timestamp: 2026-06-25T12:00:00Z
---

# E2E test catalog

Every end-to-end test in the repo, across both suites, in one place. Tests live in two trees: desktop/web under [`e2e/`](../../e2e/) and mobile under [`mobile-e2e/`](../../mobile-e2e/).

Tag selection differs by suite: desktop uses Playwright `--grep @tag`; mobile uses `--include-tags @tag`.

## Desktop / web E2E — Playwright Electron

Specs under [`e2e/tests/`](../../e2e/tests/). Runs in CI.

| Test                                                                                   | Tag         | Covers                                                                               |
| -------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| [`smoke/app-launch.spec.ts`](../../e2e/tests/smoke/app-launch.spec.ts)                 | `@smoke`    | Launches Electron past pairing, reaches the app shell                                |
| [`agent/deterministic-chat.spec.ts`](../../e2e/tests/agent/deterministic-chat.spec.ts) | `@agent`    | Exact assistant reply from a real provider                                           |
| [`agent/cursor-skills.spec.ts`](../../e2e/tests/agent/cursor-skills.spec.ts)           | `@cursor`   | Cursor filesystem skills in the Composer menu and path-qualified token insertion     |
| [`agent/pi-smoke.spec.ts`](../../e2e/tests/agent/pi-smoke.spec.ts)                     | `@pi`       | Pi streaming, interrupt/stop, tool-call work row, runtime-mode warning (creds-gated) |
| [`settings/theme.spec.ts`](../../e2e/tests/settings/theme.spec.ts)                     | `@settings` | Dark theme persists after reload                                                     |
| [`settings/pi-provider.spec.ts`](../../e2e/tests/settings/pi-provider.spec.ts)         | `@settings` | Pi first in providers, add Pi instance, Pi rail in model picker                      |

Harness and flows (shared building blocks, not tests): [`e2e/src/harness/`](../../e2e/src/harness/), [`e2e/src/flows/`](../../e2e/src/flows/).

Each spec file shares one Electron session (one dev stack, one Clerk sign-in) across its tests; see [session model](../../e2e/README.md#session-model) in the operator README. Stop `pnpm run dev` / `dev:desktop` before E2E; use `pnpm run e2e:clean` if a run leaves leaked dev servers.

### Pi E2E gates

Credentialed `@pi` tests require `KATACODE_E2E_ENABLE_PI=1`, `KATACODE_E2E_PI_AGENT_DIR`, and `KATACODE_E2E_PI_MODEL`. Manual walkthrough evidence lives in [`e2e/verify-evidence/`](../../e2e/verify-evidence/README.md).

### Cursor E2E gates

Credentialed `@cursor` tests require `KATACODE_E2E_ENABLE_CURSOR=1`, `KATACODE_E2E_CURSOR_MODEL`, and `KATACODE_E2E_CURSOR_API_KEY` (the flow authenticates the Cursor Agent CLI via API key, which skips interactive OAuth). Set `KATACODE_E2E_CURSOR_BINARY_PATH` when the Cursor `agent` binary is not available on `PATH`.

### Setup (first run)

```bash
vp run --filter @kata-sh/code-desktop ensure:electron
vp run --filter @kata-sh/code-desktop --filter @kata-sh/code-cli build
pnpm exec playwright install
```

### Commands

```bash
vp run e2e --list                                  # list tests
vp run e2e --project desktop-dev                   # run all (dev)
vp run e2e --project desktop-dev --grep @smoke     # by tag: @smoke | @agent | @settings
vp run e2e:headed --project desktop-dev --grep @smoke
vp run e2e:ui --grep @settings                     # Playwright UI mode

# packaged release app
KATACODE_E2E_RELEASE_APP="/path/to/Kata Code.app" vp run e2e:release --grep @smoke
```

## Mobile E2E — Maestro (iOS Simulator)

Flows under [`mobile-e2e/maestro/`](../../mobile-e2e/maestro/). Local-only, not run in CI. Uses real services. The green runtime pass for `@auth` and `@agent` is a maintainer responsibility (creds/provider required); see flow header comments and [deferred work](/specs/deferred-work.md).

| Flow                                                                                      | Tag        | Covers                                                                                    |
| ----------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| [`smoke/launch.yaml`](../../mobile-e2e/maestro/smoke/launch.yaml)                         | `@smoke`   | Dev client renders without a redbox                                                       |
| [`pairing/bearer-pair.yaml`](../../mobile-e2e/maestro/pairing/bearer-pair.yaml)           | `@pairing` | Bearer loopback pairing                                                                   |
| [`auth/clerk-connect.yaml`](../../mobile-e2e/maestro/auth/clerk-connect.yaml)             | `@auth`    | Kata Code Connect (Clerk) native sign-in — creds required, maintainer                     |
| [`agent/deterministic-chat.yaml`](../../mobile-e2e/maestro/agent/deterministic-chat.yaml) | `@agent`   | Deterministic real-provider reply — requires pairing first, provider required, maintainer |

Harness and flows: [`mobile-e2e/src/harness/`](../../mobile-e2e/src/harness/), [`mobile-e2e/src/flows/`](../../mobile-e2e/src/flows/). CLI entry: [`mobile-e2e/src/cli/run.ts`](../../mobile-e2e/src/cli/run.ts).

### Setup (first run)

```bash
curl -fsSL "https://get.maestro.mobile.dev" | bash
vp run e2e:mobile:build      # = vp run --filter @kata-sh/code-mobile ios:dev
```

### Commands

Run from the repo root.

```bash
vp run e2e:mobile --list                        # list flows
vp run e2e:mobile                               # Run all flows
vp run e2e:mobile --include-tags @smoke         # launch smoke
vp run e2e:mobile --include-tags @pairing       # bearer loopback pairing
vp run e2e:mobile --include-tags @auth          # Clerk Connect (creds required, maintainer)
vp run e2e:mobile --include-tags @agent         # deterministic agent reply (provider required, maintainer)
vp run e2e:mobile:studio                        # boot sim + launch maestro studio
```

For locator discovery, editing flows, and authoring new tests, see [Mobile E2E authoring (Maestro Studio)](/guides/e2e-mobile-authoring-maestro-studio.md).

## Web E2E — Playwright (browser)

Web tests run in a Chromium browser against the full dev stack (`pnpm run dev`). The [`webSetup.ts`](../../e2e/src/harness/webSetup.ts) fixture starts the dev server as a child process, captures the `pairingUrl` from server stdout, and authenticates by navigating to the pairing URL. Tests receive an authenticated `webPage` with the app shell ready.

Specs under [`e2e/tests/web/`](../../e2e/tests/web/). Template: [`recorded.spec.ts`](../../e2e/tests/web/recorded.spec.ts). Config: [`e2e/playwright.config.ts`](../../e2e/playwright.config.ts) (project `web-dev`), [`e2e/playwright.codegen.config.ts`](../../e2e/playwright.codegen.config.ts) (codegen).

| Test                                                           | Covers                                         |
| -------------------------------------------------------------- | ---------------------------------------------- |
| [`web/recorded.spec.ts`](../../e2e/tests/web/recorded.spec.ts) | Pairing auth flow, app shell (command palette) |

### Commands

```bash
# Run web tests (fixture starts the dev server automatically)
npx playwright test --config e2e/playwright.config.ts --project web-dev

# Open codegen — records interactions in the browser
pnpm run dev   # start the full dev stack
npx playwright codegen --config e2e/playwright.codegen.config.ts

# Run web tests with the codegen config
npx playwright test --config e2e/playwright.codegen.config.ts
```

Override the web URL with `KATACODE_WEB_URL` (default `http://localhost:5733`).

### Writing web tests

Use the `webTest` fixture from [`webSetup.ts`](../../e2e/src/harness/webSetup.ts) instead of `@playwright/test` directly. The `webPage` fixture provides an authenticated page:

```ts
import { webTest as test, expect } from "../../src/harness/webSetup.ts";

test("my web test", async ({ webPage }) => {
  // webPage is already authenticated and on "/" with the app shell visible.
  await expect(webPage.getByTestId("command-palette-trigger")).toBeVisible();
});
```

## Related docs

- [Mobile E2E authoring (Maestro Studio)](/guides/e2e-mobile-authoring-maestro-studio.md) — canonical Studio authoring guide
- [e2e/README](../../e2e/README.md) — desktop operator reference (env vars, artifact paths)
- [mobile-e2e/README](../../mobile-e2e/README.md) — mobile operator reference (env vars, tags)
- [E2E foundation design](/specs/2026-06-21-e2e-testing-foundation-design.md)
- [Mobile E2E foundation design](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md)
- [E2E foundation adoption](/guides/e2e-foundation-adoption.md)
- [Mobile local dev (iOS Simulator)](/guides/mobile-local-dev-ios-simulator.md)
- Authoring skills: `.agents/skills/kata-code-e2e-testing/` (desktop), `.agents/skills/mobile-e2e-test-author/` (mobile)
