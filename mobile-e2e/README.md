# Mobile E2E (iOS Simulator, Maestro)

Local-only end-to-end suite for the Kata Code mobile app. It automates the loop proven in the
[mobile local dev runbook](../docs/guides/mobile-local-dev-ios-simulator.md): launch the dev client
on the iOS Simulator, pair to a local `katacode` server over loopback, and exercise a real agent
thread. Design: [mobile E2E testing foundation](../docs/specs/2026-06-24-mobile-e2e-testing-foundation-design.md).

This suite is **local-only and not run in CI**. It uses real services (real loopback server, real
provider, real Clerk infra with test keys) and never mocks them.

## Layout

| Path                                    | Role                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/harness/`                          | Generic TS orchestrator: simulator, server stack, isolation, Maestro runner, artifacts, prereqs |
| `src/flows/`                            | Kata-specific TS: pairing inputs, Clerk prereqs, agent expected-text + normalization            |
| `maestro/`                              | On-device UI flows (YAML), the only layer that references screen elements                       |
| `src/cli/run.ts`                        | Entry point invoked by `vp run e2e:mobile`                                                      |
| `.auth/`, `test-results/`, `artifacts/` | Gitignored local secrets, manifests/reports, and Maestro output                                 |

## Prerequisites

1. **macOS + Xcode + an iOS Simulator runtime.** See the runbook for `xcodebuild -downloadPlatform iOS`.
2. **Maestro CLI** (pinned). Install:
   ```bash
   curl -fsSL "https://get.maestro.mobile.dev" | bash
   # or, if added to the mobile Brewfile:
   brew bundle --file apps/mobile/Brewfile
   ```
3. **Built server CLI** (`apps/server/dist/bin.mjs`) — produced by the standard repo build.
4. **An installed dev client.** Build it once; the suite does not rebuild per run:
   ```bash
   vp run e2e:mobile:build            # = vp run --filter @kata-sh/code-mobile ios:dev
   ```
5. **At least one configured agent provider** on the host (same setup as desktop/web dev).
6. For `@auth` / `@agent`: the documented credentials below.

## Commands

```bash
vp run e2e:mobile -- --include-tags @smoke      # launch smoke
vp run e2e:mobile -- --include-tags @pairing    # bearer loopback pairing
vp run e2e:mobile -- --include-tags @auth       # Clerk Connect sign-in (maintainer, creds required)
vp run e2e:mobile -- --include-tags @agent      # deterministic agent reply (maintainer, provider required)
vp run e2e:mobile -- --list                     # list flows without running
vp run e2e:mobile:studio                         # boot sim + ensure app, then launch `maestro studio`
```

`maestro studio` is the recommended way to discover stable accessibility ids and draft flows against
the live app. When authoring new flows, follow the
[mobile-e2e-test-author skill](../.agents/skills/mobile-e2e-test-author/SKILL.md).

## Tags

`@smoke`, `@pairing`, `@auth`, `@agent`. Each maps to `tags:` in a Maestro flow and is selected with
`--include-tags`. New surfaces get new tags.

## Environment variables

| Variable                                    | Used by       | Purpose                                                                 |
| ------------------------------------------- | ------------- | ----------------------------------------------------------------------- |
| `KATACODE_E2E_SIMULATOR`                    | all           | Optional simulator name/UDID; otherwise a booted sim is used            |
| `KATACODE_E2E_PROJECT_PATH`                 | pairing/agent | Repo path registered via `project add` (defaults to a seeded workspace) |
| `KATACODE_E2E_AGENT_PROVIDER`               | `@agent`      | Provider id (e.g. `openai`)                                             |
| `KATACODE_E2E_AGENT_MODEL`                  | `@agent`      | Model slug for deterministic replies                                    |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`      | `@agent`      | Provider key matching the selected provider                             |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `@auth`       | Clerk test instance keys                                                |
| `KATACODE_E2E_GOOGLE_EMAIL`                 | `@auth`       | Google test-user email for Connect sign-in                              |
| `KATACODE_E2E_VIDEO=1`                      | all           | Record video of the flow                                                |

Secrets stay in local-only files (`.env.local`, `.auth/`) and are never committed.

## Real-service boundary

No mocked server, provider, or Clerk; no HAR/route stubs; no fake agent responses. Native simulator
control (`xcrun simctl`) is allowed only for determinism and is documented at the call site.

## `@auth` / `@agent` status

These flows plus their fail-loud prerequisite gates ship in the suite, but their **green runtime pass
is a maintainer responsibility** (credentials + consent). Without credentials they exit non-zero
naming the exact missing item. Mobile Clerk sign-in is a native auth modal (`NativeClerk.presentAuth`)
and may not be drivable by Maestro; if blocked, bearer pairing remains the proven path.
