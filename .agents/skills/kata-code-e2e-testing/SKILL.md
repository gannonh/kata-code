---
name: kata-code-e2e-testing
description: Author, debug, and run local Playwright Electron E2E tests for Kata Code using the reusable harness and Kata-specific flows. Use whenever working with anything under e2e/ — adding or updating specs, fixing a flaky or hanging Electron test, discovering locators, composing harness/flow helpers, choosing a feature tag (@smoke, @auth, @settings, @agent), or running e2e:dev/headed/ui/release. Also use when the request implies Electron desktop UI verification ("add a smoke check for X", "why does my test stall at pairing", "the theme spec is failing") even if E2E is not named explicitly. For mobile Maestro iOS-Simulator E2E, see the Mobile section and the dedicated mobile-e2e-test-author skill.
---

# E2E test author

## Before writing code

1. Read `e2e/README.md` and the relevant product spec (`docs/specs/2026-06-21-e2e-testing-foundation-design.md`).
2. Skim the [E2E test catalog](../../docs/guides/e2e-test-catalog.md) for the current inventory of specs and tags across both suites.
3. Inspect existing tests under `e2e/tests/` and reusable blocks in `e2e/src/harness/` and `e2e/src/flows/`.
4. **Explore the UI on the real harness first**, then codify locators in `flows/` — do not guess selectors from product code alone.

Feature tags live in `e2e/src/config/tags.ts` (`E2E_TAGS`); treat that file as the source of truth rather than memorizing the list. `@agent` env vars and timeouts are documented in `e2e/README.md`.

## How to explore a new flow (preferred)

**Default: Playwright UI / debug on the spec**, not `playwright-cli`.

Electron E2E runs through an isolated dev stack (Vite + Playwright-launched Electron). Playwright UI/debug uses the same launch, pairing, auth, and ports as the real test. `playwright-cli attach --cdp=…` is optional and brittle here (port conflicts, short-lived test processes).

```bash
# Pick the smallest existing spec closest to your flow, then:
vp run e2e:ui --project desktop-dev --grep '@settings'

# Step-through with inspector:
PWDEBUG=1 vp run e2e:headed --project desktop-dev --grep '@agent'
```

Workflow:

1. Run UI/debug on the nearest starter spec (`@smoke`, `@settings`, `@agent`).
2. Walk the user-visible steps; note stable locators (role, label, deliberate `data-*` contracts).
3. Add or extend a helper in `e2e/src/flows/` — keep specs thin.
4. Re-run headed on the tag; confirm pass before moving to the next spec.

Roll out starter specs **one at a time** in headed mode; give the maintainer the exact verify command after each passes.

Optional CDP (only if you need `playwright-cli` against a running Electron):

```bash
KATACODE_DESKTOP_REMOTE_DEBUGGING_PORT=9333 vp run e2e:headed --project desktop-dev --grep '@smoke'
# use a free port; 9222 is often taken
```

The harness forwards `KATACODE_DESKTOP_REMOTE_DEBUGGING_PORT` as `--remote-debugging-port` on the raw Electron launch.

## Rules

- Compose tests from `e2e/src/harness/` and `e2e/src/flows/` — do not duplicate launch, auth, isolation, or navigation logic in spec files.
- Keep generic Electron/process concerns in `harness/` and Kata UI/product language in `flows/`.
- Do **not** mock application services: no Playwright `route().fulfill()`, HAR replay, MSW, or fake provider backends.
- Store secrets and auth state only under ignored paths (`e2e/.auth/`, Playwright output dirs, local `.env.local`).
- Tag every spec with at least one feature tag, e.g., `@smoke`, `@auth`, `@settings`, `@agent`.
- For new features, create new tags.
- Fail loudly with the missing env var or prerequisite when credentials are absent — never skip assertions silently.
- Prefer user-visible locators (role, label, text). Add `data-testid` in product code only when no durable accessible locator exists and the attribute is a deliberate test contract.
- Default to one worker for authenticated mutable flows unless additional isolated test accounts exist.
- Use reasonable timeouts from `e2e/src/config/timeouts.ts` — tests should fail fast, not hang.

## Architecture (do not fight this)

| Layer                                | Role                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `dev-runner` + Vite (`dev:web` only) | Serves the renderer; Playwright owns Electron                                        |
| `appLaunch.ts`                       | Technical Electron launch (renderer window + fatal-error tracking)                   |
| `pairing.ts` / `shell.ts`            | Embedded API + app shell readiness (`appWindow` fixture)                             |
| `testFixtures.ts`                    | `appWindow`, `authenticatedAppWindow`, `runContext`, isolated `KATACODE_HOME`, ports |

Do not run `dev:desktop` inside E2E — it would spawn a second Electron and cause EPIPE / duplicate backends.

### Release (`desktop-release`)

- Packaged apps load the renderer from the **embedded server** (`http://127.0.0.1:<KATACODE_PORT>/`), not Vite.
- **Do not** pass `VITE_DEV_SERVER_URL` — inherited dev env makes the app enter dev mode, open DevTools, and show a blank window trying to reach a Vite port that is not running. `launchEnv.ts` strips dev-only vars for release (same rule as `apps/desktop/scripts/start-electron.mjs`).
- Renderer window detection uses `serverPort`, not `webPort`. No `dev:web` stack is started for release.
- **`vp run e2e:release` is headed on macOS** — Playwright Electron opens a visible packaged app window; no need to add `e2e:headed`.

## Known Electron / UI gotchas

### Auth

- **Do not** drive Google OAuth in the Electron page. Desktop OAuth opens an **external browser** via `desktopBridge`; in-page email/password locators will not work.
- Use `@clerk/testing` `**clerk.signIn({ page, emailAddress })**` (ticket flow) in `signInWithClerkGoogleTestUser`. Requires `CLERK_SECRET_KEY` + a Clerk user for `KATACODE_E2E_GOOGLE_EMAIL`.
- Clerk loads on the app shell once cloud config is present; wait for `command-palette-trigger`, then `clerk.loaded`.
- **Sign in to Kata Code Connect** appears only in the **Settings sidebar footer**, not on the main chat sidebar.

### Navigation

- Electron uses **hash history** (`#/settings/general`). Bare `page.goto("/settings/…")` is invalid.
- Prefer **in-app clicks** (`openSettings` in `settings.ts` clicks the sidebar Settings `data-sidebar="menu-button"`).
- Settings title on Electron is a `<span>`, not a heading — wait on a panel control (e.g. `getByLabel("Theme preference")`).

### Toasts and overlays

- Provider update toasts can **block clicks** on settings controls and model picker options.
- Call `dismissBlockingToasts(page)` (toast close: `[data-slot="toast-close"]`) before theme or model selection when needed.

### Agent / model picker

- Before `sendAgentInstruction`, call `**selectComposerModel(page, turn.model)**` so the test uses the `KATACODE_E2E_AGENT_MODEL` slug, not whatever default the composer had.
- Flow: click `[data-chat-provider-model-picker="true"]` → fill `Search models…` with slug tokens (hyphens → spaces) → click matching `[role="option"]`.
- `@agent` tests need `KATACODE_E2E_AGENT_PROVIDER`, `KATACODE_E2E_AGENT_MODEL`, and the matching provider API key.

## Reusable building blocks

### Harness (`e2e/src/harness/`)

- `testFixtures.ts` — `test`, `appWindow`, `authenticatedAppWindow`, `runContext`, `launchTarget`
- `appLaunch.ts` — dev stack + Electron launch (technical readiness only)
- `isolatedRun.ts` — temp `KATACODE_HOME`, shared dev-runner port allocation, cleanup
- `readiness.ts` — TCP / Vite readiness probes
- `env.ts` — prerequisite checks (`readClerkPrerequisites`, `readAgentProviderPrerequisites`, …)

### Flows (`e2e/src/flows/`)

| Module          | Key exports                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `shell.ts`      | `waitForAppShell`                                                                                 |
| `pairing.ts`    | `waitForAppEnvironmentReady` (used by `appWindow` fixture)                                        |
| `auth.ts`       | `signInWithClerkGoogleTestUser`, `expectSignedInClerkState`, `assertAuthPrerequisites`            |
| `navigation.ts` | `openCommandPalette`, `dismissBlockingToasts`                                                     |
| `settings.ts`   | `openSettings`, `setTheme`, `expectResolvedTheme`                                                 |
| `workspace.ts`  | `createSeededWorkspace`, `createOrOpenProject`                                                    |
| `agentChat.ts`  | `assertAgentPrerequisites`, `selectComposerModel`, `sendAgentInstruction`, `expectAssistantReply` |

### Assertions (`e2e/src/assertions/`)

Launch health checks only (`assertNoFatalLaunchErrors`). Import flows directly for actions and UI waits.

## Typical test shapes

### Smoke (`@smoke`) — no auth

```ts
import { assertNoFatalLaunchErrors } from "../../src/assertions/appAssertions.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { test, expect } from "../../src/harness/testFixtures.ts";

test.describe(`App launch ${E2E_TAGS.smoke}`, () => {
  test("launches Electron past pairing and reaches the app shell", async ({
    launchedApp,
    appWindow,
  }) => {
    await expect(appWindow.getByTestId("command-palette-trigger")).toBeVisible();
    assertNoFatalLaunchErrors(launchedApp.readFatalErrors());
  });
});
```

### Settings (`@settings`) — Clerk ticket sign-in + theme

```ts
import { E2E_TAGS } from "../../src/config/tags.ts";
import { expectResolvedTheme, openSettings, setTheme } from "../../src/flows/settings.ts";
import { test } from "../../src/harness/testFixtures.ts";

test.describe(`Settings theme ${E2E_TAGS.settings}`, () => {
  test("persists dark theme after reload", async ({ authenticatedAppWindow }) => {
    await openSettings(authenticatedAppWindow);
    await setTheme(authenticatedAppWindow, "dark");
    await authenticatedAppWindow.reload();
    await openSettings(authenticatedAppWindow);
    await expectResolvedTheme(authenticatedAppWindow, "dark");
  });
});
```

### Agent (`@agent`) — model selection + real LLM reply

```ts
import {
  assertAgentPrerequisites,
  expectAssistantReply,
  selectComposerModel,
  sendAgentInstruction,
} from "../../src/flows/agentChat.ts";
import { createOrOpenProject, createSeededWorkspace } from "../../src/flows/workspace.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import { test } from "../../src/harness/testFixtures.ts";

test.describe(`Deterministic agent chat ${E2E_TAGS.agent}`, () => {
  test.describe.configure({ timeout: E2E_TIMEOUTS.agentTestMs });

  test("returns the exact expected assistant message from a real provider", async ({
    authenticatedAppWindow,
    runContext,
  }) => {
    const turn = assertAgentPrerequisites("deterministic agent chat");
    const seededPath = await createSeededWorkspace(runContext, "agent-chat-basic");
    await createOrOpenProject(authenticatedAppWindow, seededPath);
    await selectComposerModel(authenticatedAppWindow, turn.model);
    await sendAgentInstruction(authenticatedAppWindow, turn.prompt);
    await expectAssistantReply(authenticatedAppWindow, turn.expected, turn);
  });
});
```

## Verification commands

```bash
vp run e2e --list --grep @your-tag
vp run e2e:headed --project desktop-dev --grep @your-tag   # maintainer verify
vp run e2e:ui --project desktop-dev --grep @your-tag       # explore / debug
vp check
vp run typecheck
vp test e2e/src/**/*.test.ts
```

Suggested rollout order for the starter suite: `@smoke` → `@settings` → `@agent`.

For release-only coverage (headed on macOS — no `e2e:headed` needed):

```bash
KATACODE_E2E_RELEASE_APP="/path/to/Kata Code.app" vp run e2e:release --grep @smoke
```

## Mobile (Maestro, iOS Simulator)

Kata Code has a parallel E2E suite for the Expo/React Native mobile app at `mobile-e2e/`. It uses [Maestro](https://docs.maestro.dev/) for on-device UI flows and a TypeScript orchestrator for server lifecycle, isolation, and prerequisite gating. The architecture mirrors this Electron foundation: reusable harness separated from Kata-specific flows, real services with no mocks, local-only with no CI, fail-loud prerequisite gates, and tagged starter flows.

**Authoring mobile flows is owned by the dedicated [`mobile-e2e-test-author` skill](../mobile-e2e-test-author/SKILL.md).** Read it for layout, commands, prerequisites, and rules — they are intentionally not duplicated here so the two skills cannot drift. The one cross-suite map worth keeping local is how the drivers differ:

| Concern           | Electron (`e2e/`)                        | Mobile (`mobile-e2e/`)                           |
| ----------------- | ---------------------------------------- | ------------------------------------------------ |
| Driver            | Playwright (Node)                        | Maestro (YAML flows)                             |
| Target            | Electron desktop app                     | Expo dev client on iOS Simulator                 |
| App build         | Harness launches dev/release Electron    | Pre-built dev client must be installed           |
| Metro             | N/A                                      | Must be running (dev client loads JS from it)    |
| Server            | Harness starts embedded server           | Harness starts `katacode serve` on isolated port |
| Locator discovery | Playwright UI / `PWDEBUG=1`              | `vp run e2e:mobile:studio`                       |
| Tags              | `@smoke`, `@auth`, `@settings`, `@agent` | `@smoke`, `@pairing`, `@auth`, `@agent`          |

### Related docs

- [E2E test catalog](../../docs/guides/e2e-test-catalog.md) — full inventory of both suites with tags and commands
- [mobile-e2e-test-author skill](../mobile-e2e-test-author/SKILL.md) — authoring instructions for mobile flows
- [Mobile E2E design spec](../../docs/specs/2026-06-24-mobile-e2e-testing-foundation-design.md)
- [Mobile E2E operator reference](../../mobile-e2e/README.md)
- [Mobile local dev guide](../../docs/guides/mobile-local-dev-ios-simulator.md)
