---
type: Spec
title: "Local Electron E2E testing foundation"
description: "Design for a local-only Playwright E2E foundation for Kata Code desktop, dev, and release validation."
tags: [testing, e2e, electron, playwright, desktop]
timestamp: 2026-06-21T00:00:00Z
status: Draft
---

# Local Electron E2E testing foundation

## Goal

Create a local-only end-to-end testing foundation for Kata Code's Electron app that validates real user flows against real services. The foundation should cover development builds and release builds, support repeatable local nightly validation before stable promotion, and keep the reusable Electron harness separate from Kata-specific flows so the pattern can later be adopted by other Electron projects.

## Current state

- Automated UI coverage currently uses Vite+ browser tests in `apps/web/src/components/**/*.browser.tsx` with Playwright-backed Chromium rendering and mocked application APIs where needed.
- CI runs browser-component coverage in `.github/workflows/ci.yml` under `Test Browser`.
- Desktop has `apps/desktop/scripts/smoke-test.mjs`, which launches Electron and scans output for fatal errors, but current CI does not run it.
- There is no full-stack Playwright E2E suite that launches the Electron app, uses real Clerk and provider services, seeds real local workspace data, and validates user flows against dev and release builds.

## Research summary

- Playwright's Electron API is official and marked experimental. The supported path is `_electron.launch()`, `electronApp.firstWindow()`, `electronApp.evaluate()` for main-process hooks, `executablePath` for packaged app targets, and Playwright-managed artifact directories.
- Playwright recommends test isolation, user-facing locators, web-first assertions, traces for failures, and HTML reports.
- Playwright recommends project dependencies for setup and teardown rather than function-style `globalSetup`, because setup appears in reports, supports fixtures, captures traces, and composes with retries and filtering.
- Clerk's Playwright testing guidance uses `@clerk/testing`, `clerkSetup()`, and `setupClerkTestingToken()` so authenticated tests can bypass bot detection while still using real Clerk infrastructure and test keys.
- Playwright's auth guidance recommends single shared auth state only when parallel tests do not mutate shared server state. For state-mutating tests, it recommends one account per parallel worker. V1 will default authenticated mutable tests to one worker because only one Google test user is available.

References:

- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)
- [Playwright best practices](https://playwright.dev/docs/best-practices)
- [Playwright authentication](https://playwright.dev/docs/auth)
- [Playwright setup and teardown](https://playwright.dev/docs/test-global-setup-teardown)
- [Clerk Playwright testing](https://clerk.com/docs/guides/development/testing/playwright/overview)

## Constraints

- V1 is local-only and must not be added to CI.
- V1 targets macOS only.
- Tests must use real services, real backends, real Clerk, real LLM provider APIs, and real API keys.
- Tests must not mock application services, app backends, LLM responses, Clerk, relay APIs, or provider APIs.
- Test secrets, Clerk auth state, provider credentials, and generated artifacts must stay in ignored local paths.
- Authenticated tests that mutate shared state default to one worker in V1.
- The first implementation should stay focused on a foundation plus 2-3 starter tests, not broad feature coverage.

## Out of scope

- CI integration for E2E.
- Linux and Windows E2E support.
- Mobile E2E or emulator tests.
- Creating a reusable package consumed by other repositories. V1 should expose clean boundaries that make extraction practical later.
- Per-worker Clerk/Google test account provisioning. This can be added when more test accounts exist.
- Mock servers, HAR replay, or deterministic fake LLM providers.

## Acceptance criteria

1. **Local-only suite:** `vp run e2e -- --list` lists E2E tests from a root `e2e/` suite, and `.github/workflows/ci.yml` does not invoke any `e2e` script or Playwright E2E project.
2. **Dev and release launch targets:** On macOS with required local prerequisites, `vp run e2e -- --project desktop-dev --grep @smoke` launches the dev target and exits 0, and `KATACODE_E2E_RELEASE_APP=/path/to/Kata\ Code.app vp run e2e:release -- --grep @smoke` launches a release app and exits 0.
3. **Run isolation:** Each E2E run writes its run id, `KATACODE_HOME`, server port, web port, artifact root, and seeded workspace root to an artifact manifest under `e2e/test-results/`; two sequential smoke runs use different app homes, ports, and workspace roots.
4. **Real-service boundary:** Source review shows no Playwright `route().fulfill()`, HAR replay, service-worker mocks, MSW handlers, or fake backend/provider servers in the E2E suite. Native OS dialog control through Electron main-process hooks is allowed only for OS UI determinism and must be documented at the helper call site.
5. **Clerk Google test-user auth:** With the documented Clerk and Google test-user environment variables present, `vp run e2e -- --project desktop-dev --grep @auth` logs into Clerk through the Google test user, exits 0, and stores auth state only under ignored `e2e/.auth/` or Playwright output directories.
6. **Runner modes and workers:** The README documents headed and unattended/headless-style local runs, `KATACODE_E2E_WORKERS`, and the default `workers=1` for authenticated mutable tests. `vp run e2e:headed -- --grep @smoke` runs visibly, while `vp run e2e -- --grep @smoke` runs unattended in a macOS GUI session.
7. **Feature filtering:** `vp run e2e -- --list --grep @smoke` and `vp run e2e -- --list --grep @settings` each show only matching tests.
8. **Reporting artifacts:** A failing sample or real failure produces terminal list output plus artifacts under ignored paths: `e2e/playwright-report/`, `e2e/test-results/results.json`, a trace zip, and a screenshot. Video is produced when `KATACODE_E2E_VIDEO=1`.
9. **Deterministic agent helper:** With provider credentials present, `vp run e2e -- --project desktop-dev --grep @agent` sends `Reply to this message with exactly: <expected>` to a real configured LLM provider and asserts the settled assistant message equals `<expected>` after documented whitespace normalization.
10. **Data seeding:** At least one starter test uses the seeded workspace helper to create real files on disk, opens that workspace through the app, and records the seeded path in the artifact manifest.
11. **Reusable boundary:** Code review can identify generic Electron/process/isolation helpers under `e2e/src/harness/` and Kata-specific UI flows under `e2e/src/flows/`, with starter tests importing both rather than duplicating shared launch/auth/navigation logic.
12. **Test-author skill:** `.agents/skills/e2e-test-author/SKILL.md` exists and instructs agents to compose new tests from `e2e/src/harness/` and `e2e/src/flows/`, avoid service mocks, use tags, and run the smallest relevant E2E command.
13. **Starter coverage:** V1 includes 2-3 starter E2E tests across at least two distinct surfaces, with required tags for `@smoke`, `@settings`, and `@agent`; the `@agent` test has explicit provider-prerequisite checks.
14. **Composable building blocks:** Shared interactions used by more than one starter test, including authentication/session setup, app launch, seeded workspace creation, navigation, and common assertions, live in reusable helpers rather than duplicated test bodies.

## Acceptance evidence matrix

| Area           | Primary evidence                                                                       | Pass condition                                      | Allowed blocked state                                                                                       |
| -------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Dev smoke      | `vp run e2e -- --project desktop-dev --grep @smoke`                                    | exit 0 with HTML/JSON report and run manifest       | Missing local secrets may block auth assertions only if the command fails with a clear prerequisite message |
| Release smoke  | `KATACODE_E2E_RELEASE_APP=/path/to/Kata\ Code.app vp run e2e:release -- --grep @smoke` | exit 0 against supplied app                         | Missing release app path fails with a clear setup message                                                   |
| Auth           | `vp run e2e -- --project desktop-dev --grep @auth`                                     | Google test user reaches signed-in Clerk state      | Missing Clerk/Google env fails with a clear setup message                                                   |
| Settings       | `vp run e2e -- --project desktop-dev --grep @settings`                                 | theme change persists after reload or relaunch      | Missing auth env fails before UI assertions with a clear setup message                                      |
| Agent          | `vp run e2e -- --project desktop-dev --grep @agent`                                    | real provider returns exact expected assistant text | Missing provider env fails with a clear setup message                                                       |
| Static quality | `vp check` and `vp run typecheck`                                                      | both exit 0                                         | none                                                                                                        |

## Architecture

Add a root-level E2E suite with this logical structure:

```text
e2e/
  playwright.config.ts
  README.md
  .auth/                         # ignored local auth state
  src/
    harness/                     # reusable Electron E2E foundation
      appLaunch.ts
      artifacts.ts
      isolatedRun.ts
      ports.ts
      releaseTarget.ts
      seededWorkspace.ts
      testFixtures.ts
    flows/                       # Kata-specific reusable workflows
      agentChat.ts
      auth.ts
      navigation.ts
      settings.ts
      workspace.ts
    assertions/
      agentAssertions.ts
      appAssertions.ts
    config/
      env.ts
      tags.ts
  tests/
    smoke/app-launch.spec.ts
    settings/theme.spec.ts
    agent/deterministic-chat.spec.ts
```

`src/harness/` should avoid Kata-specific UI selectors and business language when practical. It should handle Electron launch, temporary directories, artifacts, ports, app target resolution, cleanup, and generic Playwright fixtures.

`src/flows/` should own Kata-specific steps such as signing in, opening settings, opening a workspace, sending a chat message, and finding a model/provider picker.

`tests/` should stay small and readable. Each test should compose reusable setup and interaction blocks, then include only the feature-specific interaction and assertion inline.

## Playwright configuration

Use Playwright's test runner with a dedicated config at `e2e/playwright.config.ts`. Add `@playwright/test` at the workspace root so `playwright test` is available to root scripts. Keep the existing `apps/web` Vitest Browser Playwright dependency separate from this E2E runner.

Initial projects:

- `setup`
  - Validates required env vars.
  - Prepares or refreshes Clerk auth state where supported.
  - Creates run-level directories for artifacts and ignored auth state.
- `desktop-dev`
  - Starts the local dev stack with isolated env.
  - Launches Electron against the dev renderer and server.
  - Depends on `setup`.
- `desktop-release`
  - Launches a built or supplied macOS app target.
  - Depends on `setup`.

Recommended defaults:

- `workers: Number(process.env.KATACODE_E2E_WORKERS ?? 1)`.
- `fullyParallel: false` for V1.
- `headless` defaults to Playwright's unattended runner mode; Electron still requires a macOS GUI session. `--headed` should make local debugging visible and inspector-friendly.
- `retries: 0` locally by default, with explicit opt-in for release validation if desired.
- `reporter: [['list'], ['html', { outputFolder: 'e2e/playwright-report', open: 'never' }], ['json', { outputFile: 'e2e/test-results/results.json' }]]`.
- `trace: 'retain-on-failure'`.
- `screenshot: 'only-on-failure'`.
- `video` controlled by `KATACODE_E2E_VIDEO=1`.

The root `package.json` should expose local-only scripts such as:

```json
{
  "e2e": "playwright test --config e2e/playwright.config.ts",
  "e2e:headed": "playwright test --config e2e/playwright.config.ts --headed",
  "e2e:ui": "playwright test --config e2e/playwright.config.ts --ui",
  "e2e:release": "playwright test --config e2e/playwright.config.ts --project desktop-release"
}
```

Exact script names may be adjusted to match repo conventions, but E2E must remain opt-in and outside `.github/workflows/ci.yml`. Build should verify the chosen command resolves from the repo root before considering Phase 1 complete.

## Launch model

### Dev target

The dev project should create an isolated run directory and launch the repo's development stack with env similar to the existing `scripts/dev-runner.ts` behavior:

- unique `KATACODE_HOME`
- unique `KATACODE_PORT`
- unique Vite `PORT`
- `VITE_DEV_SERVER_URL`
- `VITE_HTTP_URL`
- `VITE_WS_URL`
- seeded workspace root

The harness should prefer existing launcher/dev-runner utilities where they are easy to reuse. If direct import from TypeScript scripts creates friction, V1 can shell out to the repo's existing commands while keeping process lifecycle and logs inside the harness.

### Release target

The release project should accept a supplied target path through env, for example `KATACODE_E2E_RELEASE_APP=/Applications/Kata Code.app` or a path under local release artifacts. The harness resolves the executable path inside the `.app`, launches it through Playwright Electron, and applies isolated app state via env.

If no release target is supplied, `desktop-release` should fail loudly with a clear message that tells the tester how to build or point to a release app.

## Authentication

Authentication should use real Clerk and the configured Google test user.

Local-only env variables should be documented in `e2e/README.md`, for example:

- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_TESTING_TOKEN` or values required by `@clerk/testing`
- `KATACODE_E2E_GOOGLE_EMAIL`
- `KATACODE_E2E_GOOGLE_PASSWORD`, if UI login automation needs it
- provider API keys required for deterministic agent tests

The setup project should use Clerk's Playwright helpers where compatible with the Electron flow:

- `clerkSetup()` during setup.
- `setupClerkTestingToken()` before navigation to Clerk surfaces.
- Auth state saved under ignored `e2e/.auth/` or Playwright output directories.

If Google OAuth cannot be fully automated without user interaction in the first build, the auth setup project and `@auth` test should fail with an explicit blocked message and document the missing credential, consent, or Clerk testing-token requirement. Passing auth requires the real signed-in Clerk state.

## Isolation and seeding

Each Playwright worker/run should allocate an `E2ERunContext` containing:

- run id
- target project name
- temp app home
- temp workspace root
- artifact root
- server port
- web port
- cleanup callbacks

The seeded workspace helper should support creating small real project folders, for example:

```ts
await seedWorkspace({
  name: "agent-chat-basic",
  files: {
    "package.json": '{"scripts":{"test":"echo ok"}}',
    "README.md": "# E2E seeded workspace\n",
  },
});
```

Seeded directories are real files on disk. Tests can open them through the application instead of bypassing app behavior.

## Deterministic LLM-agent testing

The deterministic agent helper should test a real provider while constraining the prompt and assertion:

1. Create or open an isolated seeded workspace.
2. Select the configured provider/model if the UI requires it.
3. Send a prompt like:

   ```text
   Reply to this message with exactly: E2E_AGENT_OK_<run-id>
   ```

4. Wait for the assistant response to settle.
5. Assert the assistant response exactly matches the expected text, after agreed UI whitespace normalization.

The helper should surface provider, model, prompt, expected text, timeout, and captured response in failure output. It should not stub provider responses.

## Starter tests

### `tests/smoke/app-launch.spec.ts`

Tags: `@smoke`

Validates:

- Electron launches.
- The main window renders a known app surface.
- The app reaches a signed-in Clerk state through the configured Google test user.
- No fatal renderer or main-process errors are observed during launch.

### `tests/settings/theme.spec.ts`

Tags: `@settings`

Validates:

- A signed-in app session can open Settings.
- The test changes theme to dark mode through the UI.
- The visible app theme updates.
- The setting persists after reload or relaunch inside the same isolated app home.

### `tests/agent/deterministic-chat.spec.ts`

Tags: `@agent`

Validates:

- A seeded workspace can be opened.
- A real LLM-backed chat turn can be started.
- The deterministic prompt returns the expected exact assistant message.
- Failure output includes provider/model and captured response details.

If Build cannot execute one of these starter tests because the local machine lacks secrets, test-user consent, provider keys, or a release app path, it should still add the test and prerequisite checks. The command must fail with the exact missing prerequisite rather than passing via mocks or skipped assertions.

## Reusable building blocks

Initial building blocks should include:

- `launchApp(target)`
- `withIsolatedRun()`
- `seedWorkspace(files)`
- `signInWithClerkGoogleTestUser()`
- `openSettings()`
- `setTheme(theme)`
- `createOrOpenProject(path)`
- `sendAgentInstruction(text)`
- `expectAssistantReply(text)`
- `cleanupRunState()`

These should be implemented as Playwright fixtures, page objects, or small composable functions where appropriate. Prefer user-visible locators by role, label, or text. Add stable `data-testid` attributes only when the UI has no durable accessible locator and the attribute represents a test contract worth maintaining.

## Local agent skill

Add a local skill, for example `.agents/skills/e2e-test-author/SKILL.md`, that helps agents create new E2E tests.

The skill should instruct agents to:

- read `e2e/README.md` and the relevant existing spec first
- compose tests from `src/harness/` and `src/flows/` building blocks
- avoid service mocks and HAR replay
- keep secrets in ignored local env/auth paths
- use tags for feature/product surface filtering
- run the smallest relevant command, such as `vp run e2e -- --grep @settings`
- preserve the reusable harness/Kata-specific flow boundary

## Reporting and artifacts

The suite should write artifacts under ignored paths:

```text
e2e/test-results/
e2e/playwright-report/
e2e/.auth/
```

Artifacts should include:

- terminal list reporter output
- HTML report
- JSON report
- traces on failure
- screenshots on failure
- optional video when enabled
- app process logs when launch or runtime errors occur

Release validation should produce a concise command-level result suitable for manual nightly signoff.

## Error handling

The harness should fail loudly when required prerequisites are missing:

- missing Clerk test credentials
- missing Google test user credentials when required
- missing provider API keys for agent tests
- missing release app path for `desktop-release`
- port allocation failure
- app launch timeout
- auth flow blocked by consent or bot protection
- provider response mismatch

Failure messages should include the failing phase, required env var or command, and artifact path when available.

## Implementation phases

### Phase 1: dependencies, config, and ignored paths

- Add root `@playwright/test` dependency.
- Add root scripts for local E2E commands.
- Add `e2e/playwright.config.ts`.
- Add ignored paths for `e2e/.auth`, `e2e/test-results`, and `e2e/playwright-report`.
- Add `e2e/README.md` with prerequisites and commands.

Acceptance coverage: 1, 6, 7, 8.

### Phase 2: reusable harness

- Add isolated run context, artifact path, temp app home, and port allocation helpers.
- Add dev target launch support.
- Add release target resolution with explicit missing-target errors.
- Add generic Electron app launch and cleanup fixtures.

Acceptance coverage: 2, 3, 6, 8, 11, 14.

### Phase 3: auth and seeding flows

- Add Clerk setup/auth helper using official testing helpers where compatible.
- Add Google test-user flow or fail-loud blocked path with documented requirements.
- Add seeded workspace helper.
- Add Kata-specific navigation helpers.

Acceptance coverage: 4, 5, 10, 11, 14.

### Phase 4: starter tests and deterministic agent helper

- Add smoke launch/auth starter test.
- Add settings/theme starter test.
- Add deterministic agent chat starter test with fail-loud prerequisite checks for required provider credentials and provider path.
- Add common assertions and failure metadata.

Acceptance coverage: 7, 8, 9, 13, 14.

### Phase 5: local test-author skill and documentation closeout

- Add local E2E authoring skill.
- Update `docs/specs/index.md` and relevant OKF logs.
- Document local nightly validation commands.

Acceptance coverage: 1, 12.

## Verification plan

Build should run the standard repository checks required by AGENTS.md:

```bash
vp check
vp run typecheck
```

For the E2E foundation, Build should also run the smallest safe local E2E checks that available credentials support, for example:

```bash
vp run e2e -- --project desktop-dev --grep @smoke
vp run e2e -- --project desktop-dev --grep @settings
```

If credentials or local release app prerequisites are unavailable to the implementing agent, Build should still run the relevant E2E command and verify that it fails at the prerequisite gate with a clear message. Static structure alone is not enough to satisfy runtime acceptance criteria.

Before nightly promotion, a maintainer should run release-target checks locally against the built nightly app:

```bash
KATACODE_E2E_RELEASE_APP=/path/to/Kata\ Code.app vp run e2e:release -- --grep @smoke
KATACODE_E2E_RELEASE_APP=/path/to/Kata\ Code.app vp run e2e:release -- --grep @settings
```

## Risks and mitigations

- **Electron support is experimental.** Keep the Electron launch wrapper small, centralized, and easy to update.
- **Google auth can be brittle.** Use Clerk testing helpers, store auth state locally, and fail with clear prerequisite guidance when consent or bot protection blocks automation.
- **Real LLM responses can drift.** Use exact-output prompts, conservative timeouts, captured response details, and model/provider metadata in failures.
- **Shared test account limits parallelism.** Default mutable authenticated tests to one worker until per-worker accounts exist.
- **Release app path varies by machine.** Require explicit `KATACODE_E2E_RELEASE_APP` and fail loudly when absent.
- **Reusable harness can over-abstract too early.** Keep generic harness utilities limited to Electron/process/isolation concerns. Put Kata product behavior in `flows/`.

## Explicitly deferred work

- CI E2E gating.
- Linux and Windows support.
- Per-worker account pools.
- Remote hosted-browser validation.
- Cross-repository package extraction for the Electron E2E harness.
- Broad product-surface coverage beyond the starter tests.

## Build handoff

Implement the local-only Playwright E2E foundation in phases. Keep service mocking out of scope. Start with the root `e2e/` suite, ignored artifact/auth paths, local scripts, reusable Electron harness, Kata-specific flows, and 2-3 starter tests. Preserve single-worker defaults for authenticated mutable tests. Use real Clerk and provider credentials when available. If a runtime check is blocked by missing local secrets or release artifacts, fail loudly in code and document the exact command/env needed for a maintainer to run it.
