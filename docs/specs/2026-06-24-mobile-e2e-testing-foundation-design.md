---
type: Spec
title: "Mobile E2E testing foundation — iOS Simulator (Maestro)"
description: "Design for a local-only Maestro + TS-orchestrator E2E foundation that automates the proven Kata Code mobile loop (launch, pair, sign-in, agent response) on the iOS Simulator."
tags: [testing, e2e, mobile, ios, simulator, maestro]
timestamp: 2026-06-24T00:00:00Z
status: Implemented
approved_at: 2026-06-24T00:00:00Z
implemented_at: 2026-06-24T00:00:00Z
---

# Mobile E2E testing foundation — iOS Simulator (Maestro)

## Status

Implemented

## Goal

Create a local-only end-to-end testing foundation for the Kata Code mobile app that automates the manual loop proven in the [mobile local dev slice](/specs/2026-06-22-mobile-local-dev-slice-design.md): launch the dev client on the iOS Simulator, pair to a local `katacode` server over loopback, and exercise a real agent thread. The foundation is the mobile analog of the [Electron E2E testing foundation](/specs/2026-06-21-e2e-testing-foundation-design.md): a reusable harness separated from Kata-specific flows, real services with no mocks, local-only with no CI, fail-loud prerequisite gates, 4 tagged starter flows, and an authoring skill. V1 covers both the bearer loopback path and Kata Code Connect (Clerk) sign-in.

## Source of truth

- Electron foundation precedent: [/specs/2026-06-21-e2e-testing-foundation-design.md](/specs/2026-06-21-e2e-testing-foundation-design.md) — harness/flows split, real-service boundary, tags, fail-loud gates, authoring skill, artifact policy.
- Proven manual loop + commands: [/guides/mobile-local-dev-ios-simulator.md](/guides/mobile-local-dev-ios-simulator.md) — two-step server startup, dev-client build, manual host+token pairing, thread loop.
- Mobile slice design (boundaries, verified current state): [/specs/2026-06-22-mobile-local-dev-slice-design.md](/specs/2026-06-22-mobile-local-dev-slice-design.md).
- Connection model: [/architecture/remote.md](/architecture/remote.md).

## Decisions (from Plan alignment)

- **V1 scope:** mirror the Electron foundation (reusable harness/flows, real services, local-only/no-CI, tagged starter flows, fail-loud gates, authoring skill).
- **Platform:** iOS Simulator only. Android deferred.
- **Auth/connection paths:** both bearer loopback **and** Clerk Connect sign-in. Clerk-on-simulator is unproven and is the top risk; it sits behind a fail-loud prereq gate.
- **Driver:** Maestro CLI (free, local) for on-device UI, with a TypeScript orchestrator for server lifecycle, token plumbing, isolation, prereq gating, and artifacts.
- **Build/install boundary:** the suite drives an **already-installed** dev client (built once via `vp run ios:dev`); it does not rebuild per run. Missing app fails loud with build instructions.
- **`@agent` and `@auth` runtime pass is deferred to a maintainer** with credentials/consent. Build lands the flows plus fail-loud prereq gates; the green runtime pass is not a Build gate (parity with the Electron foundation).

## Verified current state

- Mobile app `apps/mobile` (`@kata-sh/code-mobile`), Expo SDK 56, expo-router, dev variant scheme `katacode-dev`, bundle id `com.katacode.dev`. Dev build via `vp run ios:dev` (`expo prebuild --clean --platform ios && expo run:ios`); Metro via `vp run dev:client`. `ios/` is gitignored (prebuild-generated).
- Mobile has unit tests under `apps/mobile/src/**/*.test.ts` run by `vp test run`. No mobile UI E2E framework exists (no Detox/Maestro/Appium anywhere in the repo).
- Add-Environment screen has manual Host + Pairing-code text fields plus an optional QR toggle — `apps/mobile/src/app/connections/new.tsx`. Manual fields are the Simulator pairing path (no camera).
- Pairing/bootstrap path proven over loopback bearer: `apps/mobile/src/features/connection/pairing.ts`, `apps/mobile/src/lib/connection.ts`; connection state in `apps/mobile/src/state/use-remote-environment-registry`. Cleartext to loopback allowed (`apps/mobile/app.config.ts` `NSAllowsArbitraryLoads: true`).
- Server: `katacode serve --port 3773 --host 127.0.0.1` prints `Connection string`, `Token`, `Pairing URL` (`apps/server/src/startupAccess.ts`, `serverRuntimeStartup.ts`). `serve` does not auto-register a project; `katacode project add <path>` registers a runnable one (`apps/server/src/cli/project.ts`). One-time tokens (`PairingGrantStore.ts`).
- The Electron E2E foundation lives at root `e2e/` (Playwright) with `src/harness/`, `src/flows/`, tagged starter tests, and a `e2e-test-author` skill. It is left untouched by this work.
- Mobile Connect (Clerk) sign-in is presented through a **native auth modal**: `NativeClerk.presentAuth({ mode: "signInOrUp" })` (module `ClerkExpo`, `apps/mobile/src/features/cloud/useNativeClerkAuthModal.ts`), not an in-app webview. It was never exercised on the Simulator (the slice scoped Clerk out and used bearer-only).
- The server CLI is a package bin (`apps/server/package.json` → `"katacode": "./dist/bin.mjs"`); it is not a global binary. The proven runbook invokes it as `node apps/server/dist/bin.mjs serve …` / `… project add …` against a built `apps/server/dist/bin.mjs`. The harness shells out to the built CLI (or a PATH-linked `katacode`); a missing build fails loud.

## Research summary

- Maestro is a free, local, black-box UI driver. Flows are YAML; it provides built-in auto-waits/retries, `--include-tags`/`--exclude-tags` filtering, JUnit report output, screenshots, and `maestro record` for video.
- `maestro studio` is an interactive element inspector + flow authoring tool that runs against the live app on the Simulator. It is the mobile analog of the Playwright inspector (`vp run e2e:ui` / `PWDEBUG=1`) the Electron foundation used for new-flow exploration. It needs the dev client installed and the Simulator booted, no server orchestration.
- Maestro selects elements by accessibility id, text, or label. Stable accessibility ids on key surfaces (home, `ConnectionStatusDot`, Add-Environment fields, composer, model picker) are test contracts to add only where no durable accessible locator exists, matching the Electron `data-testid` policy.
- Maestro reads variables from the environment (`maestro test -e KEY=VALUE` / `${KEY}` interpolation), which is how the TS orchestrator injects the dynamic host, one-time token, expected agent text, model, and Clerk env into flows. The exact `-e` / `--include-tags` flag syntax is verified against the pinned Maestro version in Phase 1.

References:

- Maestro docs: https://docs.maestro.dev/
- Maestro Studio: https://docs.maestro.dev/getting-started/maestro-studio
- Maestro tags: https://docs.maestro.dev/advanced/tags
- Expo E2E with Maestro: https://docs.expo.dev/build-reference/e2e-tests/

## Constraints

- Local-only; must not be added to `.github/workflows/ci.yml`.
- macOS + iOS Simulator only. No physical device, no Android, no signing/distribution.
- Real services only: real loopback `katacode` server, real provider, real Clerk infra with test credentials. No mocked server/provider/Clerk, no HAR/route stubs, no fake agent responses.
- Test secrets, Clerk/auth state, and generated artifacts stay in ignored local paths.
- The suite drives an already-installed dev client; it does not build the app per run.
- Authenticated mutable flows default to a single concurrent run in V1 (one Google test user, parity with the Electron foundation).
- Fix-forward only what blocks the loop. No adjacent refactors, no native-module renames.
- First implementation stays focused on a foundation plus 4 starter flows (one per required tag; a flow may carry more than one tag), not broad feature coverage.

## Out of scope

- CI integration for mobile E2E.
- Android (emulator or device); physical iOS device; QR camera-scan pairing.
- EAS builds, Expo project ownership, App Store Connect identity, code signing, distribution.
- Rebuilding the dev client inside the suite as a required step (an optional convenience script may chain `ios:dev`, but the green build is the existing runbook's responsibility).
- Per-worker Clerk/Google account provisioning; parallel multi-simulator execution.
- Mock servers, HAR replay, deterministic fake providers.
- A reusable cross-repo package; V1 only keeps clean boundaries that make later extraction practical.

## Acceptance criteria

1. **Local-only, no CI:** `vp run e2e:mobile --include-tags @smoke` runs Maestro flows from a root `mobile-e2e/` suite, and `.github/workflows/ci.yml` invokes no mobile-e2e script or Maestro command.
2. **Fail-loud prereq gates:** With a required item absent (Maestro CLI, booted simulator, installed `com.katacode.dev` dev client, loopback server, provider creds, or Clerk creds for the selected tag set), the command exits non-zero with a message naming the exact missing item. No mock or skip fallback is used in place of a real prerequisite.
3. **Installed-build target:** The harness drives an already-installed `com.katacode.dev` dev client on a booted simulator; when the app is not installed it fails with instructions to build it. The build is a mobile-package script (`vp run --filter @kata-sh/code-mobile ios:dev`, or from `apps/mobile`); the new root `e2e:mobile:build` convenience script chains it. The suite does not rebuild the app as part of a normal run.
4. **Run isolation + manifest:** Each run writes a manifest under `mobile-e2e/test-results/` recording run id, `KATACODE_HOME`, server port, simulator UDID, app bundle id, artifact root, and seeded/registered project path. Two sequential runs use different app homes and server ports.
5. **Real-service boundary:** Source review of `mobile-e2e/` shows no mocked server, provider, or Clerk, and no HAR/route stubs or fake agent responses; flows exercise the real loopback server and real provider. Native simulator/OS control (e.g. `xcrun simctl`) is allowed only for determinism and is documented at the call site.
6. **Smoke launch (@smoke):** The `@smoke` flow launches the installed dev client to the home screen with no redbox and asserts a known home-screen surface. Evidence: Maestro screenshot under the run's artifact path.
7. **Bearer pairing (@pairing):** With a loopback server running (`katacode serve --port 3773 --host 127.0.0.1` + `katacode project add <path>`) and ≥1 provider configured, the flow injects the server-printed host and one-time token into Add Environment and the saved environment reaches "ready" (green `ConnectionStatusDot`). The connection uses `authenticationMethod: "bearer"` (not `relayManaged`/`dpop`). Evidence: Maestro screenshot of the connected environment.
8. **Clerk Connect sign-in (@auth):** With documented Clerk + Google test-user environment variables present, the mobile Kata Code Connect sign-in flow reaches a signed-in session; auth state and secrets stay under ignored paths (`mobile-e2e/.auth/` or the Maestro/output dirs). If the Simulator OAuth/consent/ticket flow is blocked, the command fails at the consent/prereq gate naming the exact missing item — it never passes via mock or skipped assertion. Green runtime pass is a maintainer responsibility (deferred), but the flow and gate must exist and fail loudly without credentials.
9. **Deterministic agent (@agent):** With provider credentials present, the flow opens a seeded/registered thread, selects the configured model in the composer, sends `Reply to this message with exactly: E2E_AGENT_OK_<run-id>`, and asserts the settled assistant text matches the expected value after documented whitespace normalization. Failure output includes provider, model, expected text, and captured response. Green runtime pass is deferred to a maintainer; the flow and provider-prereq gate must exist and fail loudly without credentials.
10. **Tag filtering:** `vp run e2e:mobile --include-tags @smoke` and `vp run e2e:mobile --include-tags @pairing` each run only the matching flows.
11. **Reporting artifacts:** A failing flow produces terminal output plus artifacts under ignored paths: the Maestro output directory, at least one screenshot, a JUnit/JSON report, and the run manifest. Video is produced when `KATACODE_E2E_VIDEO=1`.
12. **Reusable boundary:** Code review can identify generic harness utilities under `mobile-e2e/src/harness/` (simulator control, server stack, isolated run, Maestro runner, artifacts, prereq gates), Kata-specific TS under `mobile-e2e/src/flows/`, and on-device YAML under `mobile-e2e/maestro/`. Starter flows compose shared launch/pair/auth/navigation building blocks rather than duplicating them.
13. **Starter coverage:** V1 includes 4 starter flows (one per required tag; a flow may carry more than one tag) across at least two distinct surfaces, with required tags `@smoke`, `@pairing`, `@auth`, and `@agent`; the `@auth` and `@agent` flows have explicit prerequisite checks.
14. **Authoring skill + runbook + static quality:** `.agents/skills/mobile-e2e-test-author/SKILL.md` exists and instructs agents to compose flows from `src/harness/`, `src/flows/`, and `maestro/`, avoid service mocks, use tags, keep secrets in ignored paths, use `maestro studio` for locator discovery, and run the smallest relevant command. `mobile-e2e/README.md` documents prerequisites, the build-once step, env vars, run modes, Studio, and tag filters, and is cross-linked from `docs/guides/index.md`. `vp run --filter @kata-sh/code-mobile typecheck` and `vp run --filter @kata-sh/code-mobile test` pass, or any pre-existing failure is recorded explicitly (failing assertion + cause + resolution path).

## Acceptance evidence matrix

| Area                | Primary evidence                                              | Pass condition                                             | Allowed blocked state                                                                 |
| ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Smoke launch        | `vp run e2e:mobile --include-tags @smoke`                     | exit 0, home-screen screenshot, no redbox                  | Missing installed dev client fails with build instructions                            |
| Bearer pairing      | `vp run e2e:mobile --include-tags @pairing`                   | environment reaches "ready" (green dot), bearer auth       | Missing server/provider fails at prereq gate with a clear message                     |
| Clerk Connect       | `vp run e2e:mobile --include-tags @auth`                      | signed-in Connect session (maintainer-run)                 | Missing Clerk/Google env, or blocked Simulator OAuth/consent, fails at the named gate |
| Deterministic agent | `vp run e2e:mobile --include-tags @agent`                     | real provider returns exact expected text (maintainer-run) | Missing provider env fails at the named gate                                          |
| Tooling/isolation   | source review + run manifest                                  | harness/flows/maestro boundary present; manifest per run   | none                                                                                  |
| Static quality      | `vp run --filter @kata-sh/code-mobile typecheck` + `... test` | both pass or pre-existing failures recorded                | none                                                                                  |

## Architecture

```text
mobile-e2e/
  README.md
  package.json or root scripts          # e2e:mobile, e2e:mobile:build, e2e:mobile:studio, tag variants
  src/
    harness/                            # generic, reusable (no Kata UI knowledge)
      isolatedRun.ts                    # run id, KATACODE_HOME, ports, artifact root, manifest
      serverStack.ts                    # katacode serve --port + project add; parse printed host/token
      simulator.ts                      # boot/select simulator, verify dev client installed, launch/terminate
      maestroRunner.ts                  # invoke `maestro test`, inject env vars, capture artifacts + exit code
      prereqs.ts                        # fail-loud gates (maestro CLI, sim, app, creds)
      artifacts.ts                      # collect Maestro output + screenshots + reports under ignored paths
    flows/                              # Kata-specific TS orchestration
      pairing.ts                        # host + token -> Maestro env for the pairing flow
      auth.ts                           # Clerk Connect prereq checks + env
      agent.ts                          # expected-text generation + whitespace normalization + match
  maestro/                              # on-device UI flows (YAML)
    smoke/launch.yaml                   # @smoke
    pairing/bearer-pair.yaml            # @pairing
    auth/clerk-connect.yaml             # @auth
    agent/deterministic-chat.yaml       # @agent
  .auth/  test-results/  artifacts/     # gitignored
```

Boundaries (parallel to `e2e/`):

- **`src/harness/`** owns simulators, processes, ports, isolation, Maestro invocation, and artifacts. It knows nothing about Kata UI.
- **`src/flows/`** owns Kata-specific orchestration: deriving pairing inputs, gating Clerk prerequisites, generating the deterministic agent prompt and normalizing/matching the reply.
- **`maestro/`** owns on-device interaction in YAML and is the only layer that references screen elements.

The TS layer is the test driver/orchestrator; Maestro is the on-device actuator. This keeps real-service orchestration and dynamic values (one-time token, expected text) in TS while flows stay declarative.

```mermaid
flowchart LR
  subgraph host[Mac host]
    O["TS orchestrator\n(harness + flows)"]
    S["katacode serve --port 3773\n+ project add\nprovider configured"]
  end
  subgraph sim[iOS Simulator]
    A["Kata Code Dev\n(installed dev client)"]
  end
  O -- "prereq gates, start, parse token" --> S
  O -- "boot + verify install" --> A
  O -- "maestro test -e host/token/expected/model" --> M["Maestro"]
  M -- "drive UI: launch, pair, thread, prompt" --> A
  A -- "POST /pair (bearer) + WS over loopback" --> S
  S -- "streamed agent response + tool activity" --> A
  M -- "screenshots, JUnit, hierarchy" --> O
```

## Run lifecycle (data flow)

1. **Prereq gate** (`prereqs`): verify Maestro CLI, a booted simulator, the installed `com.katacode.dev` dev client, and the credentials required by the selected tag set. Missing → exit non-zero naming the exact item.
2. **Isolate** (`isolatedRun`): allocate run id, unique `KATACODE_HOME`, server port, artifact root; open the manifest.
3. **Server stack** (`serverStack`): shell out to the built CLI (`node apps/server/dist/bin.mjs serve --port <p> --host 127.0.0.1`, or a PATH-linked `katacode`), parse the printed connection string and one-time token, then `… project add <seeded-or-given path>`. A missing build, token-parse failure, or `project add` failure → fail loud.
4. **Simulator** (`simulator`): boot/select the target simulator and confirm the dev client is installed (no rebuild). Record the UDID.
5. **Maestro run** (`maestroRunner`): run the tag-filtered flow(s), injecting `host`, `token`, `expectedText`, model, and Clerk env as Maestro variables.
6. **On-device** (Maestro): launch → Add Environment → pair → open thread → send prompt → assert.
7. **Artifacts** (`artifacts`): collect Maestro output, screenshots, JUnit/JSON, and video (if enabled); finalize the manifest.

## Authentication

- **Bearer (proven):** host + one-time token from `serve`, entered into Add Environment; saved connection is `authenticationMethod: "bearer"`. This path is the same one the slice verified.
- **Clerk Connect (unproven on Simulator):** mobile presents sign-in through a **native auth modal** — `NativeClerk.presentAuth({ mode: "signInOrUp" })` (module `ClerkExpo`), not an in-app webview. The `@auth` flow signs in to Kata Code Connect with documented Clerk + Google test-user credentials. Maestro is a black-box driver over the app's accessibility tree; driving a **native system auth presentation** is materially harder than driving in-app UI and may be out of reach. The Electron precedent's `clerk.signIn({ page })` ticket flow is a Playwright/web API with **no mobile analog here**. This flow is behind a fail-loud prereq gate; if the native modal cannot be driven or consent/bot protection blocks it, it fails at the gate with the exact missing item. Whether and how Maestro can drive `presentAuth` (e.g. accessibility ids on the native modal, a Clerk testing-token bypass, or a deep-link/session-injection path) is a Phase 4 discovery item to resolve with `maestro studio` against the live app. The spec requires the flow and gate to exist and fail loudly; the green runtime pass is deferred to a maintainer, and Phase 4 may conclude `@auth` cannot be automated, in which case bearer-only remains the proven path.

Auth state and secrets stay under ignored `mobile-e2e/.auth/` or Maestro/output directories.

## Deterministic LLM-agent testing

1. Open or register an isolated seeded project (`project add`).
2. Start a new thread.
3. Select the configured model in the composer (the default model is not reliable for deterministic replies; the exact model-picker path is a Phase 4 discovery item via Studio).
4. Send `Reply to this message with exactly: E2E_AGENT_OK_<run-id>`.
5. Wait for the assistant response to settle (Maestro auto-wait + explicit assertion).
6. Assert the visible assistant text matches `E2E_AGENT_OK_<run-id>` after documented whitespace normalization. The TS `flows/agent.ts` generates the expected text and owns the normalization contract; the Maestro flow asserts via text/regex match.

Failure output surfaces provider, model, expected text, timeout, and captured response. No provider responses are stubbed.

## Maestro Studio (authoring affordance)

`vp run e2e:mobile:studio` boots/selects the simulator and verifies the dev client is installed (reusing `simulator` + `prereqs`, no server orchestration), then launches `maestro studio`. Studio is the recommended way to discover stable accessibility ids and draft flows. Canonical authoring guidance lives in [Mobile E2E authoring (Maestro Studio)](/guides/e2e-mobile-authoring-maestro-studio.md); the operator reference and authoring skill link there. Studio directly mitigates the locator-stability and model-picker-path risks.

## Reusable building blocks

Harness (generic): `withIsolatedRun()`, `startServerStack()` (serve + project add + token parse), `ensureSimulator()`, `ensureDevClientInstalled()`, `runMaestro(flow, env)`, `requirePrereqs(tagSet)`, `collectArtifacts()`, `writeManifest()`.

Flows (Kata-specific TS): `pairingEnv(host, token)`, `clerkConnectPrereqs()`, `expectedAgentText(runId)` + `normalizeReply(text)`.

Maestro (YAML, on-device): launch/home assertion, Add-Environment pairing, Connect sign-in, new-thread + prompt + assert. Shared sub-flows (e.g. launch, open Add Environment) are extracted as reusable Maestro subflows where more than one flow needs them.

## Reporting and artifacts

Artifacts are written under ignored paths:

```text
mobile-e2e/test-results/     # run manifest, JUnit/JSON reports
mobile-e2e/artifacts/        # Maestro output, screenshots, video
mobile-e2e/.auth/            # Clerk/auth state
```

Includes: terminal output, Maestro output directory, JUnit/JSON report, screenshots, optional video (`KATACODE_E2E_VIDEO=1`), server logs when startup/runtime errors occur, and the run manifest.

## Error handling

Fail loud at every boundary (no obfuscating fallbacks): missing Maestro CLI, no booted simulator, dev client not installed, missing creds for the selected tags, server-start failure, token-parse failure, `project add` failure, pairing never reaching "ready", Clerk consent/OAuth block, model-select failure, agent text mismatch. Each failure names the failing phase, the required env var or command, and the artifact path when available. A blocked prerequisite never resolves to a mock or skipped assertion.

## Implementation phases

### Phase 1 — suite skeleton, scripts, ignored paths

Create the `mobile-e2e/` tree; add root scripts (`e2e:mobile`, `e2e:mobile:build`, `e2e:mobile:studio`, tag-filtered variants); add gitignore entries for `.auth/`, `test-results/`, `artifacts/`; document Maestro install (Brewfile / `curl`-based, pinned version) and the build-once prerequisite in a README skeleton; verify the exact Maestro `-e` / `--include-tags` flag syntax. Acceptance coverage: 1.

### Phase 2 — TS harness

Implement `isolatedRun`, `serverStack` (serve + project add + token parse), `simulator`, `maestroRunner`, `prereqs`, `artifacts`, and the manifest. Add harness unit tests (token parsing, isolation, prereq gating). Acceptance coverage: 2, 3, 4, 5, 11, 12.

### Phase 3 — smoke + bearer pairing flows

Add `maestro/smoke/launch.yaml`, `maestro/pairing/bearer-pair.yaml`, and `flows/pairing.ts`. Wire host+token injection and tag-filtered invocation. Acceptance coverage: 6, 7, 10.

### Phase 4 — Clerk Connect + deterministic agent

Add `maestro/auth/clerk-connect.yaml` + `flows/auth.ts` (fail-loud Clerk gate; sign-in mechanism resolved via Studio), and `maestro/agent/deterministic-chat.yaml` + `flows/agent.ts` (model select, normalized exact-match). Green runtime pass deferred to a maintainer; gates must fail loudly without creds. Acceptance coverage: 8, 9, 13.

### Phase 5 — authoring skill, runbook, closeout

Add `.agents/skills/mobile-e2e-test-author/SKILL.md`, `mobile-e2e/README.md`, the `docs/guides/index.md` cross-link, and run static checks. Acceptance coverage: 14.

## Sequencing

- Phases are ordered by dependency: skeleton → harness → on-device flows → auth/agent → docs. Phase 2 unblocks all on-device phases.
- Phase 4 carries the only deep unknowns (Clerk-on-Simulator, composer model-picker path); front-load Studio exploration once Phase 3 proves the launch/pair flow.
- The desktop `e2e/` suite is untouched; the two suites are independent.

## Verification

Build should run the standard repository checks:

```bash
vp run --filter @kata-sh/code-mobile typecheck
vp run --filter @kata-sh/code-mobile test
vp test run mobile-e2e/src/harness   # harness unit tests
```

For runtime acceptance, Build runs the smallest safe local checks available:

```bash
vp run e2e:mobile --include-tags @smoke      # exit 0 with home screenshot, or fail-loud on missing install
vp run e2e:mobile --include-tags @pairing    # ready environment, or fail-loud on missing server/provider
```

`@auth` and `@agent` runtime green is a maintainer responsibility; Build verifies they exist and fail loudly at the prereq gate when credentials are absent:

```bash
vp run e2e:mobile --include-tags @agent      # fails naming the missing provider env when unset
vp run e2e:mobile --include-tags @auth       # fails naming the missing Clerk/Google env when unset
```

A maintainer with credentials and a built dev client runs the full tag set locally before relying on the suite for signoff.

## Risks and mitigations

- **Clerk Connect on the Simulator is unproven (highest risk).** Sign-in is a **native auth modal** (`NativeClerk.presentAuth`), and Maestro (black-box accessibility-tree driver) may be unable to drive a native system auth presentation at all. Mitigation: fail-loud prereq gate; Phase 4 discovery via `maestro studio` to determine whether the native modal exposes drivable accessibility ids or whether a Clerk testing-token / session-injection bypass is viable; defer green runtime pass to a maintainer; if the Simulator flow cannot be automated, record exactly what blocks it and keep bearer-only as the proven path. Phase 4 is permitted to conclude `@auth` is non-automatable.
- **Composer model selection may differ from desktop.** The `@agent` flow needs a reliable model-picker path. Mitigation: discover via Studio in Phase 4; allow setting the model through env (`KATACODE_E2E_AGENT_MODEL`).
- **Locator stability.** Maestro depends on accessibility ids/labels. Mitigation: prefer durable accessible locators; add stable accessibility ids only where none exists, treated as a test contract (parallel to the Electron `data-testid` policy); use Studio to verify.
- **One-time token expiry before pairing completes.** Mitigation: harness restarts `serve` for a fresh token on retry; token lifetime documented.
- **Dev-client build drift.** `expo prebuild --clean` regenerates `ios/`; an app installed from a stale build may not match source. Mitigation: the build-once step and `e2e:mobile:build` are documented; the manifest records the installed bundle id, and the README instructs rebuilding when source changes.
- **Maestro not installed / version drift.** Mitigation: prereq gate names the exact install command; pin a known-good Maestro version in the README/Brewfile.

## Key files

- New suite: `mobile-e2e/src/harness/*`, `mobile-e2e/src/flows/*`, `mobile-e2e/maestro/**/*.yaml`, `mobile-e2e/README.md`.
- Root scripts: `package.json` (`e2e:mobile`, `e2e:mobile:build`, `e2e:mobile:studio`, tag variants), `.gitignore`.
- Authoring skill: `.agents/skills/mobile-e2e-test-author/SKILL.md`.
- Docs: `docs/guides/index.md` (cross-link), `docs/specs/index.md` (spec index).
- Referenced (not modified): `apps/mobile/src/app/connections/new.tsx`, `apps/mobile/src/features/connection/pairing.ts`, `apps/mobile/src/lib/connection.ts`, `apps/server/src/cli/server.ts`, `apps/server/src/startupAccess.ts`, `apps/server/src/cli/project.ts`.

## Explicitly deferred work

- CI integration for mobile E2E.
- Android, physical iOS device, QR-scan pairing.
- EAS / Expo project ownership / App Store Connect identity / signing / distribution.
- Per-worker account pools and parallel multi-simulator execution.
- A reusable cross-repo mobile E2E package.
- Broad product-surface coverage beyond the 3-4 starter flows.
- The green runtime pass for `@auth` and `@agent` (maintainer responsibility, not a Build gate).

## Build handoff

**Approved scope:** Phases 1-5. Root `mobile-e2e/` suite; iOS Simulator only; Maestro on-device + TS orchestrator; real services; local-only/no-CI; bearer **and** Clerk Connect paths; already-installed dev client target; 3-4 tagged starter flows; fail-loud gates; authoring skill + runbook.

**Non-goals:** CI, Android, physical device, QR pairing, EAS/distribution, per-run app rebuild as a required step, parallel multi-simulator, cross-repo package, broad coverage.

**Required verification before done:** AC 1-7 and 10-14 pass with cited evidence (smoke + bearer pairing green locally, or fail-loud where the dev client/server/provider is absent). AC 8 and 9 are intentionally excluded from required runtime verification: only their flow + fail-loud prereq gate must exist and fail loudly without credentials; the green runtime pass is deferred to a maintainer. Harness unit tests pass; mobile typecheck + test recorded; README and authoring skill committed and cross-linked.

**Blocking questions for Build:** none at spec time. If Phase 4 finds that Clerk Connect cannot be automated on the Simulator without removing functionality or mocking, Build stops and asks; bearer-only remains the proven fallback path and the `@auth` gate must still fail loudly.

## Build completion report

- **Spec:** [Mobile E2E testing foundation design](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md)
- **Branch:** `feat/mobile-e2e-testing-foundation`
- **Base SHA:** `f8a838813` → **Head SHA:** `1283ccfa3`
- **Execution path:** single-agent with the `tdd` discipline (tests-first for all pure logic). Independent subagent review was **not** used for Build; reviews were written self-reviews (spec compliance + code quality).

### Tasks completed (phases)

1. **Skeleton/scripts/ignored paths** (`5b8bb013d`) — `mobile-e2e/` tree, tsconfig, tag/timeout config, README, root scripts (`e2e:mobile`, `:build`, `:studio`), gitignore.
2. **TS harness** (`69d12e8f6`) — isolated run, artifacts/manifest, process helpers, server stack (serve + token parse + `project add`), simulator control (select/boot + dev-client gate + screen recording), Maestro runner, seeded workspace, fail-loud prereqs.
3. **Smoke + bearer pairing** (`5b7a5a9ed`) — CLI orchestrator (run/list/studio/help), `@smoke` and `@pairing` flows, `flows/pairing.ts`, tag-filtered runs.
4. **Clerk Connect + agent** (`a99e0bf34`) — `@auth` flow + `flows/auth.ts` gate (native `presentAuth` modal documented), `@agent` flow + `flows/agent.ts` (run-id token, normalization), tag-based env injection.
5. **Authoring skill + closeout** (`1283ccfa3`) — `mobile-e2e-test-author` skill, README cross-link, guides + specs index entries.

### Files changed

New: `mobile-e2e/**` (tsconfig, README, `src/config/*`, `src/harness/*`, `src/flows/*`, `src/cli/*`, `maestro/**/*.yaml`), `.agents/skills/mobile-e2e-test-author/SKILL.md`. Edited: root `package.json` (scripts), `.gitignore`, `docs/guides/index.md`, `docs/specs/index.md`.

### Verification

| Check                                                       | Result                                                                                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp test run mobile-e2e/src`                                | **35 passed** (8 files) — pure logic: serve-output parse, Maestro args, simulator select, tag→credential gating, server-need, CLI args, flow-tag parse, agent text/normalization |
| `vp check mobile-e2e`                                       | format + lint **clean** (28 files)                                                                                                                                               |
| `mobile-e2e` typecheck (`apps/mobile` tsc, production code) | **clean** (test files only show a `vitest` module-resolution artifact under ad-hoc tsc, resolved at vitest runtime)                                                              |
| `vp run e2e:mobile --list`                                  | lists all 4 flows by tag                                                                                                                                                         |
| `vp run e2e:mobile --help`                                  | exit 0                                                                                                                                                                           |
| `node mobile-e2e/src/cli/run.ts --include-tags @agent`      | **exit 1**, fail-loud naming the missing prerequisite (AC 2)                                                                                                                     |
| `vp run --filter @kata-sh/code-mobile typecheck`            | **exit 0** (AC 14)                                                                                                                                                               |
| `vp run --filter @kata-sh/code-mobile test`                 | **154 passed** (AC 14)                                                                                                                                                           |
| `vp run check:okf`                                          | passed                                                                                                                                                                           |
| CI references mobile-e2e/Maestro                            | none (AC 1)                                                                                                                                                                      |
| Mocks/HAR/route stubs in suite                              | none (AC 5)                                                                                                                                                                      |

### Acceptance criteria status

- **Verified now (1-5, 10-14):** local-only/no-CI, fail-loud gates, installed-build gate, run isolation + manifest, real-service boundary, tag filtering, reporting/artifact wiring under ignored paths, harness/flows/maestro boundary, 4 tagged starter flows, authoring skill + runbook + static quality.
- **Deferred to maintainer runtime (6-9):** `@smoke`, `@pairing`, `@auth`, `@agent` flows and gates exist and are wired; their **green on-device pass requires a booted Simulator with an installed dev client** (and creds for `@auth`/`@agent`). Per the approved decision, the green runtime pass is a maintainer responsibility, performed during Verify with `maestro studio` for locator confirmation. **Outcome below:** see [Verify outcome (2026-06-25)](#verify-outcome-2026-06-25) — `@smoke`/`@pairing`/`@agent` are green; `@auth` and the AC-4 distinct-ports clause remain open.

### Known follow-ups

- On-device locators in the Maestro flows are best-effort anchors from source; the ready-state assertion (`@pairing`), settings/sign-in entry and native-modal drivability (`@auth`), and the composer model-picker + send control (`@agent`) need `maestro studio` confirmation, and may require deliberate `accessibilityLabel` test contracts in product code.
- `@auth` may prove non-automatable if Maestro cannot drive the native `presentAuth` modal; bearer pairing remains the proven path.
- The harness is not covered by the recursive `vp run typecheck` (it is not a workspace package — same as `e2e/`); it is typechecked directly and linted via `vp check`.

## Verify outcome (2026-06-25)

On-device verification on the iOS Simulator (iPhone 17 Pro), driving the real dev client with `maestro studio` to confirm locators. Recorded as evidence; a formal merge sign-off is still pending while the open items below stand.

- **`@smoke` — green.** App launches past the Expo Dev Launcher (`clearState: false` preserves the saved Metro URL) and the "Kata Code" header renders; `extendedWaitUntil` covers Metro bundling (`466bc77f5`, `ff47aeff6`).
- **`@pairing` — green.** Bearer loopback pairing reaches a ready environment. Required a deliberate test contract: the `connection-status` accessibility id on `ConnectionStatusDot` (`ac8b8d371`), asserted as `connection-status-ready`. Navigation to Add Environment was factored into a reusable `maestro/shared/open-add-environment.yaml` subflow; `shared/` is excluded from flow discovery (`SUBFLOW_DIRS` in `cli/flows.ts`) (`609790fe2`, `760a60ef8`).
- **`@agent` — green.** Real-provider deterministic reply passes. The flow composes `@pairing` via `runFlow`, opens the native composer, selects the model through the native pull-down picker, and asserts the run-id token. Model-picker rows show display labels, not raw slugs, so `flows/agent.ts` derives them (`providerMenuLabel`: `openai`→`Codex`, `anthropic`→`Claude`; `modelMenuLabel`: `gpt-5.4-mini`→`GPT-5.4-Mini`) mirroring the server's `toDisplayName` (`609790fe2`, `760a60ef8`).
- **`@auth` — open.** Mobile Connect sign-in is the native `NativeClerk.presentAuth` modal; driving it through Maestro remains unproven. The flow + fail-loud gate exist; bearer pairing stays the proven path.
- **AC 4 distinct ports — open.** `createIsolatedRun` still allocates the server port via `findAvailablePortOffset` from a fixed offset, so two _sequential_ runs reuse the freed port (distinct `KATACODE_HOME` holds; distinct ports does not). No collision in practice; the literal AC-4 port clause is unmet. Suggested fix: jitter the per-run start offset. Same pattern exists in the Electron `e2e/` harness.

Canonical authoring workflow and the full verified locator set live in [Mobile E2E authoring (Maestro Studio)](/guides/e2e-mobile-authoring-maestro-studio.md); every flow is indexed in the [E2E test catalog](/guides/e2e-test-catalog.md).

## Related docs

- [Mobile E2E authoring (Maestro Studio)](/guides/e2e-mobile-authoring-maestro-studio.md) — canonical guide for locator discovery, editing flows, and creating new Maestro tests.
- [Mobile local dev (iOS Simulator)](/guides/mobile-local-dev-ios-simulator.md) — the manual loop this suite automates; includes a mapping table from manual steps to harness behavior.
- [Mobile E2E operator reference](../../mobile-e2e/README.md) — commands, env vars, tags, prerequisites.
- [mobile-e2e-test-author skill](../../.agents/skills/mobile-e2e-test-author/SKILL.md) — agent authoring checklist (Studio detail in the guide above).
- [Electron E2E testing foundation](/specs/2026-06-21-e2e-testing-foundation-design.md) — the parallel Playwright/Electron foundation this suite mirrors.
- [Mobile local dev slice design](/specs/2026-06-22-mobile-local-dev-slice-design.md) — the preceding slice that proved the loopback bearer path.
