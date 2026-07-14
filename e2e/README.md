# Kata Code web and Electron E2E

Playwright end-to-end tests for the Kata Code web and Electron desktop apps. Shared specs run against either target using the same page-oriented fixture contract and real services.

## Prerequisites

- macOS with a GUI session (Electron requires a desktop session even in unattended mode)
- Node.js and `pnpm` per the repo root
- Desktop build artifacts:
  ```bash
  vp run --filter @kata-sh/code-desktop ensure:electron
  vp run --filter @kata-sh/code-desktop --filter @kata-sh/code-cli build
  ```
- Playwright browsers (first run):
  ```bash
  pnpm exec playwright install
  ```

## Environment variables

Set these in `.env.local` (gitignored; recommended) or export them in your shell. The E2E runner loads `.env` and `.env.local` from the repo root automatically.

### Clerk (required for authenticated specs such as `@settings` and `@agent`)

| Variable                       | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `CLERK_PUBLISHABLE_KEY`        | Clerk publishable key (`pk_test_…` or `pk_live_…`)   |
| `CLERK_SECRET_KEY`             | Clerk secret key for `@clerk/testing` setup          |
| `KATACODE_E2E_GOOGLE_EMAIL`    | Dedicated Google test user email                     |
| `KATACODE_E2E_GOOGLE_PASSWORD` | Google test user password for UI OAuth when required |

Canonical `KATACODE_CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` are also accepted for the publishable key.

### Deterministic agent tests (`@agent`)

| Variable                      | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `KATACODE_E2E_AGENT_PROVIDER` | Provider driver id configured in the app (for example `openai`) |
| `KATACODE_E2E_AGENT_MODEL`    | Model id to select in the UI                                    |
| `OPENAI_API_KEY`              | Required when provider is OpenAI                                |
| `ANTHROPIC_API_KEY`           | Required when provider is Anthropic                             |

### Cursor skill tests (`@cursor`)

| Variable                          | Purpose                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `KATACODE_E2E_ENABLE_CURSOR`      | Set to `1` to opt in to Cursor-specific E2E tests                                                                        |
| `KATACODE_E2E_CURSOR_MODEL`       | Cursor model id to add/select in the Composer model picker                                                               |
| `KATACODE_E2E_CURSOR_API_KEY`     | Cursor API key forwarded to `CURSOR_API_KEY` for headless Cursor auth in E2E                                             |
| `KATACODE_E2E_CURSOR_BINARY_PATH` | Required Cursor CLI executable path or command, for example `cursor-agent`; explicit to avoid another tool named `agent` |

### Vercel deployment tests (`@environments-deploy`)

| Variable                       | Purpose                                                          |
| ------------------------------ | ---------------------------------------------------------------- |
| `E2E_VERCEL_TOKEN`             | Vercel Sandbox access token                                      |
| `E2E_VERCEL_TEAM_ID`           | Vercel team that owns the test project                           |
| `E2E_VERCEL_PROJECT_ID`        | Vercel project used by the sandbox test                          |
| `E2E_VERCEL_SOURCE_REPOSITORY` | Dedicated minimal GitHub fixture repository in `owner/name` form |
| `E2E_VERCEL_SOURCE_BRANCH`     | Optional fixture branch; defaults to the repository default      |

Before provisioning, the test reads the selected branch's recursive Git tree through `gh` and fails if its checked-out blobs exceed 256 KiB. Vercel receives a depth-one native clone. Keep package caches, generated files, binaries, and large lockfiles out of the fixture repository. The lifecycle runs only under `desktop-dev`, so cross-platform and release selections do not duplicate billable provisioning. It creates one sandbox and does not run the disposable **Test connection** provision first because that would duplicate the cold-bootstrap package ingress.

### Release target (`desktop-release` project)

| Variable                   | Purpose                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `KATACODE_E2E_RELEASE_APP` | Absolute path to a built `.app` bundle, for example `/Applications/Kata Code.app` |

Release launches use isolated `KATACODE_HOME` and `KATACODE_PORT` only. The harness strips dev-only env such as `VITE_DEV_SERVER_URL` so the packaged app loads from its embedded server instead of a non-running Vite dev server.

### Runner controls

| Variable               | Default | Purpose                                                                                                                                                                                                                                                      |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `KATACODE_E2E_WORKERS` | `1`     | Playwright workers. `1` (default, recommended) runs one session per spec file serially. `>1` runs files in parallel; each worker gets isolated ports, a per-worker dev app bundle id, a per-worker `.electron-runtime`, and a bypassed single-instance lock. |
| `KATACODE_E2E_VIDEO`   | off     | Set to `1` to retain failure video artifacts                                                                                                                                                                                                                 |
| `KATACODE_PORT_OFFSET` | auto    | Optional fixed port offset for isolated dev stacks                                                                                                                                                                                                           |

### Session model

Each spec file shares one isolated session with its own `KATACODE_HOME`, ports, workspace root, and artifact manifest. Tests run serially within the file and should call `resetAppToHome` in `beforeEach` when they mutate navigation or shared UI state. Desktop projects launch Electron with the Vite renderer; `web-dev` launches the full server and web stack and pairs a browser context. The harness cleans up after the file. Clerk sign-in runs lazily when a test requests `authenticatedAppPage` or its compatibility alias `authenticatedAppWindow`.

If a provider turn fails (out of credits, auth error, rate limit, model
unavailable), the agent-chat flows fail fast on the thread error banner with
the real server-side message and a hint to change `KATACODE_E2E_PI_MODEL` (or
the deterministic-chat model) in `.env`, instead of polling to a timeout.

## Commands

From the repo root:

> **Stop `pnpm run dev` / `dev:desktop` before running E2E.** The harness
> spawns its own isolated dev stack (dev-runner + Vite + Playwright-launched
> Electron). A separately-running dev server collides on ports and shared
> resources and causes every E2E test to fail with pairing/auth or model-picker
> errors that look unrelated to the real cause. If the full suite fails,
> run `pnpm run e2e:clean` and re-run.

### Cleaning up leaked dev servers

E2E dev stacks are reaped automatically on teardown (process-group kill) and on
abort (signal handlers + global teardown). If an aborted run still leaves
strays, two scripts clean them safely without touching unrelated node
processes:

```bash
pnpm run e2e:clean         # reap leaked E2E dev stacks + dev Electron apps
pnpm run kill-dev-ports    # kill Kata Code dev servers on the dev port ranges
pnpm run kill-dev-ports -- --all   # also kill the default foreground dev server (5733/13773)
```

Both match the kata-code repo command signature and dev port ranges, so a
foreground `pnpm run dev` (and unrelated system listeners) are spared unless you
pass `--all`.

```bash
# List tests
vp run e2e --list

# Desktop dev target
vp run e2e:desktop --grep @smoke

# Web dev target
vp run e2e:web --grep @smoke

# Run shared specs against both targets
vp run e2e:cross-platform --grep @smoke

# Desktop dev target with Playwright --headed (inspector / PWDEBUG workflows)
vp run e2e:headed --project desktop-dev --grep @smoke

# Interactive Playwright UI
vp run e2e:ui --grep @settings

# Release target (desktop-release) — visible packaged app window on macOS
KATACODE_E2E_RELEASE_APP="/path/to/Kata Code.app" vp run e2e:release --grep @smoke
```

On macOS, Playwright Electron launches always open a visible app window. **`e2e:release` is headed** — you do not need `e2e:headed` for release validation. Use `e2e:headed` on `desktop-dev` when you want Playwright's explicit headed flag (for example with `PWDEBUG=1`).

### Feature tags

| Tag         | Coverage                               |
| ----------- | -------------------------------------- |
| `@smoke`    | App launch, pairing, and shell surface |
| `@auth`     | Clerk Google test-user sign-in         |
| `@settings` | Settings theme persistence             |
| `@agent`    | Real LLM deterministic reply           |
| `@cursor`   | Cursor skill discovery and invocation  |

Filter with `--grep`, for example `vp run e2e --project desktop-dev --grep @settings`.

## Artifacts (ignored by git)

Each run writes a manifest under `e2e/test-results/<run-id>/manifest.json` with:

- run id
- `KATACODE_HOME`
- server and web ports
- artifact root
- seeded workspace root

Additional outputs:

- `e2e/playwright-report/` — HTML report
- `e2e/test-results/results.json` — JSON report
- traces and screenshots on failure
- video when `KATACODE_E2E_VIDEO=1`
- `e2e/.auth/` — local Clerk auth state

## Architecture

- `e2e/src/harness/` — reusable web/Electron process, browser, and isolation helpers (no Kata product selectors)
- `e2e/src/flows/` — Kata-specific UI workflows (auth, settings, workspace, agent chat)
- `e2e/src/assertions/` — launch health checks only (`assertNoFatalLaunchErrors`)
- `e2e/tests/` — small starter specs composing harness + flows

Default `vp run e2e` targets `desktop-dev`. Use `vp run e2e:web` for Chromium, `vp run e2e:cross-platform` for both development targets, and `vp run e2e:release` for a packaged app.

Service mocking (`route().fulfill()`, HAR replay, MSW, fake backends) is out of scope. Native OS dialog control through Electron main-process hooks is allowed only for OS UI determinism and must be documented at the call site.

## Nightly release validation

Before promoting a nightly desktop build:

```bash
KATACODE_E2E_RELEASE_APP="/path/to/Kata Code.app" vp run e2e:release --grep @smoke
KATACODE_E2E_RELEASE_APP="/path/to/Kata Code.app" vp run e2e:release --grep @settings
```

## Authoring new tests

See `.agents/skills/kata-code-e2e-testing/SKILL.md` for agent-oriented guidance when that local skill is installed.

## Web codegen (browser recording)

A separate Playwright config targets the web app at `http://localhost:5733` for recording tests with `playwright codegen`. This bypasses the Electron harness entirely.

```bash
# Start the web app
pnpm run dev:web

# Open codegen recorder
pnpm run e2e:codegen

# Run only recorded web tests with the codegen config
pnpm run e2e:recorded

# Run all shared and recorded specs against web-dev
pnpm run e2e:web
```

Config: [`e2e/playwright.codegen.config.ts`](e2e/playwright.codegen.config.ts). Recorded tests go in [`e2e/tests/web/`](e2e/tests/web/). `KATACODE_WEB_URL` overrides the URL for codegen and recorded-only runs; shared `web-dev` specs always use their isolated allocated URL.

## Adopting this foundation in other repos

See [docs/guides/e2e-foundation-adoption.md](../docs/guides/e2e-foundation-adoption.md) for Kata Agents and Skillr App rollout steps, env mapping, and lessons learned.
