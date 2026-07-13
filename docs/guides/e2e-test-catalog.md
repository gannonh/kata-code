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

## Shared desktop / web E2E — Playwright

Specs under [`e2e/tests/`](../../e2e/tests/) use a project-aware fixture and can run against Electron (`desktop-dev`) or Chromium (`web-dev`). The browser recording template under `e2e/tests/web/` remains web-only.

| Test                                                                                   | Tag         | Covers                                                                               |
| -------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| [`smoke/app-launch.spec.ts`](../../e2e/tests/smoke/app-launch.spec.ts)                 | `@smoke`    | Launches either target past pairing and reaches the app shell                        |
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
vp run e2e --list                                  # list desktop tests
vp run e2e:desktop                                 # run shared specs on Electron
vp run e2e:web                                     # run shared specs + recording template on Chromium
vp run e2e:cross-platform --grep @smoke            # run a selection on both dev targets
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

The `web-dev` project runs shared specs in Chromium against an isolated full dev stack. The project-aware fixture allocates a temporary home, ports, workspace and artifacts, captures the startup pairing URL, and supplies `appPage` or `authenticatedAppPage`. [`webSetup.ts`](../../e2e/src/harness/webSetup.ts) remains available to the browser-only recording template.

Specs under [`e2e/tests/web/`](../../e2e/tests/web/). Template: [`recorded.spec.ts`](../../e2e/tests/web/recorded.spec.ts). Config: [`e2e/playwright.config.ts`](../../e2e/playwright.config.ts) (project `web-dev`), [`e2e/playwright.codegen.config.ts`](../../e2e/playwright.codegen.config.ts) (codegen).

| Test                                                           | Covers                                         |
| -------------------------------------------------------------- | ---------------------------------------------- |
| [`web/recorded.spec.ts`](../../e2e/tests/web/recorded.spec.ts) | Pairing auth flow, app shell (command palette) |

### Commands

```bash
# Run shared and recorded web tests (fixtures start isolated dev servers)
pnpm run e2e:web

# Open codegen — records interactions in the browser
pnpm run dev   # start the full dev stack
npx playwright codegen --config e2e/playwright.codegen.config.ts

# Run only browser-recorded tests with the codegen config
pnpm run e2e:recorded
```

`KATACODE_WEB_URL` overrides the URL for codegen and recorded-only runs (default `http://localhost:5733`). Shared `web-dev` specs use an isolated allocated URL.

### Writing web tests

Shared tests use `test` from `testFixtures.ts` and the portable `appPage` or `authenticatedAppPage` fixtures. Codegen output kept under `tests/web/` uses the `webTest` fixture from [`webSetup.ts`](../../e2e/src/harness/webSetup.ts); `webPage` provides a paired page:

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
