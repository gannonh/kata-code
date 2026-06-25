---
type: Guide
title: "Mobile E2E authoring with Maestro Studio"
description: "Canonical guide for using Maestro Studio to discover locators, edit existing flows, and create new Maestro YAML tests for the Kata Code iOS Simulator suite."
tags: [testing, e2e, maestro, mobile, ios, authoring, studio]
timestamp: 2026-06-25T18:00:00Z
---

# Mobile E2E authoring with Maestro Studio

Use this guide when you need to **discover locators**, **fix an existing flow**, or **author a new Maestro test** for the local iOS Simulator suite under [`mobile-e2e/`](../../mobile-e2e/).

Maestro Studio is the mobile analog of the Playwright inspector (`vp run e2e:ui` / `PWDEBUG=1`) used by the [Electron E2E foundation](/specs/2026-06-21-e2e-testing-foundation-design.md). Studio runs against the **live dev client** on a booted Simulator. Flows are saved as YAML in git — Studio is for exploration and drafting, not the source of truth.

For the full test inventory and run commands, see the [E2E test catalog](/guides/e2e-test-catalog.md). For operator env vars and prerequisites, see the [mobile E2E operator reference](../../mobile-e2e/README.md). For the manual dev loop Studio assumes, see [Mobile local dev (iOS Simulator)](/guides/mobile-local-dev-ios-simulator.md).

## Architecture (do not fight this)

| Layer          | Path                                                       | Role                                                                                |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Harness (TS)   | [`mobile-e2e/src/harness/`](../../mobile-e2e/src/harness/) | Simulator control, server stack, isolation, Maestro runner, artifacts, prereq gates |
| Flows (TS)     | [`mobile-e2e/src/flows/`](../../mobile-e2e/src/flows/)     | Kata-specific: pairing inputs, Clerk prereqs, agent expected-text + normalization   |
| Maestro (YAML) | [`mobile-e2e/maestro/`](../../mobile-e2e/maestro/)         | On-device UI — **the only layer that references screen elements**                   |

The TS orchestrator injects dynamic values into flows as `maestro test -e KEY=VALUE`; YAML references them as `${KEY}`. Keep dynamic plumbing in TS; keep flows declarative.

Shared navigation lives in reusable subflows under [`mobile-e2e/maestro/shared/`](../../mobile-e2e/maestro/shared/) and is composed with `runFlow`. The harness does not discover `shared/` as standalone flows.

## Prerequisites

1. **macOS + Xcode + iOS Simulator runtime** — see the [mobile local dev guide](/guides/mobile-local-dev-ios-simulator.md).
2. **Maestro CLI** — install once:
   ```bash
   curl -fsSL "https://get.maestro.mobile.dev" | bash
   # or: brew bundle --file apps/mobile/Brewfile
   ```
3. **Built server CLI** — `apps/server/dist/bin.mjs` from the standard repo build.
4. **Installed dev client** — build once; the suite does not rebuild per run:
   ```bash
   vp run e2e:mobile:build    # = vp run --filter @kata-sh/code-mobile ios:dev
   ```
5. **Metro running** for interactive work — the dev client loads JS from Metro. Without it the app red-screens. Start from `apps/mobile`:
   ```bash
   vp run --filter @kata-sh/code-mobile dev:client
   ```
6. **Credentials** for `@auth` / `@agent` only — see [operator reference](../../mobile-e2e/README.md#environment-variables).

## Open Maestro Studio

Run from the **repo root**:

```bash
vp run e2e:mobile:studio
```

This command:

1. Asserts macOS host and Maestro CLI are present.
2. Boots or selects an iOS Simulator (`KATACODE_E2E_SIMULATOR` overrides the default).
3. Verifies `com.katacode.dev` is installed (fails loud with build instructions if not).
4. Launches `maestro studio` against the Simulator.

Studio does **not** start the loopback server, inject pairing tokens, or register projects. Use it for UI exploration and locator confirmation. For flows that need server state (`@pairing`, `@agent`), either navigate manually to the target screen first or run the harness for a partial/full flow after codifying steps.

Upstream Maestro docs: [Maestro Studio](https://docs.maestro.dev/getting-started/maestro-studio).

## Studio workflow

### 1. Explore before you codify

Do **not** guess selectors from product source alone. Launch Studio, navigate to the screen under test, and interact with elements to generate commands.

In Studio you can:

- **Right-click elements** on the Simulator to insert `tapOn`, `assertVisible`, and related commands.
- **Type `-` in the editor** to browse available Maestro commands with autocomplete.
- **Inspect the accessibility tree** for text, labels, and ids Maestro can match.

Copy verified commands into the YAML file in your editor. Document confirmed locators in the flow header comment (see [`deterministic-chat.yaml`](../../mobile-e2e/maestro/agent/deterministic-chat.yaml) for the pattern).

### 2. Edit an existing flow

1. List flows and tags:
   ```bash
   vp run e2e:mobile --list
   ```
2. Open the matching YAML under `mobile-e2e/maestro/`.
3. Launch Studio and reproduce the failing or changed screen.
4. Replace or add steps using locators Studio confirms.
5. Verify with the smallest tag filter:
   ```bash
   vp run e2e:mobile --include-tags @pairing   # example
   ```

Existing starter flows:

| Flow                                                                                      | Tag        | Studio focus                                                                       |
| ----------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| [`smoke/launch.yaml`](../../mobile-e2e/maestro/smoke/launch.yaml)                         | `@smoke`   | Home screen anchor (`"Kata Code"` header); `clearState: false` preserves Metro URL |
| [`pairing/bearer-pair.yaml`](../../mobile-e2e/maestro/pairing/bearer-pair.yaml)           | `@pairing` | Add Environment fields, submit, `connection-status-ready` id                       |
| [`auth/clerk-connect.yaml`](../../mobile-e2e/maestro/auth/clerk-connect.yaml)             | `@auth`    | Settings sign-in entry; native Clerk modal drivability (highest risk)              |
| [`agent/deterministic-chat.yaml`](../../mobile-e2e/maestro/agent/deterministic-chat.yaml) | `@agent`   | Compose button, project picker, model picker, send, reply assertion                |

### 3. Create a new flow

1. Explore the user journey in Studio first.
2. Create `mobile-e2e/maestro/<area>/<name>.yaml`:
   ```yaml
   # @your-tag — short description of what this proves.
   #
   # Locators verified with `maestro studio` against the live app:
   #  - ...
   appId: com.katacode.dev
   tags:
     - your-tag
   ---
   - launchApp:
       clearState: false
   # steps...
   ```
3. Reuse shared subflows where more than one flow needs the same navigation:
   ```yaml
   - runFlow: ../shared/open-add-environment.yaml
   ```
4. Register a new tag in [`mobile-e2e/src/config/tags.ts`](../../mobile-e2e/src/config/tags.ts) and add prereq gates in harness/flows TS if credentials or server state are required.
5. Verify:
   ```bash
   vp run e2e:mobile --include-tags @your-tag
   vp test run mobile-e2e/src
   vp check mobile-e2e
   ```

Suggested rollout order for new surfaces: `@smoke` → `@pairing` → `@auth` → `@agent`, one tag at a time.

## Locator conventions

Prefer durable accessible locators (visible text, label). Add a deliberate `accessibilityLabel` in product code only when no durable locator exists and it is an explicit test contract (e.g. `connection-status-ready` on `ConnectionStatusDot`).

Patterns already proven in this suite:

| UI surface                | How Maestro matches it                                                |
| ------------------------- | --------------------------------------------------------------------- |
| Native toolbar SF Symbols | Symbol name as text (`gearshape`, `add`, `compose`)                   |
| Settings sheet rows       | Combined accessibility element; substring/regex (`.*Environments.*`)  |
| Form placeholders         | Placeholder text (`192.168.1.100:8080`, `abc-123-xyz`)                |
| Submit actions            | Combined label (`add, ADD ENVIRONMENT`)                               |
| Connection ready state    | Accessibility id `connection-status-ready`                            |
| Model picker              | Display labels injected by TS (`KC_PROVIDER_LABEL`, `KC_MODEL_LABEL`) |

Use `extendedWaitUntil` with generous timeouts when Metro is bundling (smoke uses 90s for the home screen).

## Dynamic variables (TS → YAML)

Studio sessions do not have harness-injected env vars. At run time the orchestrator supplies them via `-e`. Reference them in YAML as `${KEY}`.

| Variable                                                                      | Injected by                                                 | Used in                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| `KC_HOST`, `KC_TOKEN`                                                         | [`flows/pairing.ts`](../../mobile-e2e/src/flows/pairing.ts) | `@pairing` — loopback host + one-time token |
| `KC_GOOGLE_EMAIL`                                                             | [`flows/auth.ts`](../../mobile-e2e/src/flows/auth.ts)       | `@auth` — Google test user                  |
| `KC_PROMPT`, `KC_EXPECTED`, `KC_MODEL`, `KC_PROVIDER_LABEL`, `KC_MODEL_LABEL` | [`flows/agent.ts`](../../mobile-e2e/src/flows/agent.ts)     | `@agent` — deterministic provider reply     |

When authoring in Studio, type literal placeholder values to reach the right screen; swap in `${KEY}` references before committing.

## Rules

- **Real services only** — no mocked server, provider, Clerk, HAR stubs, or fake agent responses.
- **Compose, don't duplicate** — launch, pairing, isolation, and server logic belong in harness/flows TS or shared Maestro subflows, not copy-pasted YAML.
- **One feature tag per flow** — `@smoke`, `@pairing`, `@auth`, `@agent`; register new tags in `tags.ts`.
- **Secrets in ignored paths** — `mobile-e2e/.auth/`, `mobile-e2e/test-results/`, `mobile-e2e/artifacts/`, local `.env.local`.
- **Fail loud** — missing Maestro, simulator, dev client, server, or credentials must exit non-zero naming the exact gap.
- **`clearState: false` on launch** — `clearState: true` drops the saved Metro URL and lands on the Expo Dev Launcher instead of the app.

## What Studio cannot solve alone

| Limitation                                          | Mitigation                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| No server orchestration                             | Run `vp run e2e:mobile --include-tags @pairing` (or start server manually per the [local dev guide](/guides/mobile-local-dev-ios-simulator.md))   |
| Native Clerk auth modal (`NativeClerk.presentAuth`) | Highest-risk surface; Studio discovery may show it is not drivable — see [design spec](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md) |
| Provider/model selection                            | Select model explicitly via env vars; composer default is not reliable for deterministic replies                                                  |
| Green `@auth` / `@agent` runtime pass               | Maintainer responsibility with creds; flows and gates must exist and fail loud without them                                                       |

## Verification commands

```bash
vp run e2e:mobile --list                        # flows + tags
vp run e2e:mobile --include-tags @smoke         # smallest smoke check
vp run e2e:mobile:studio                        # locator discovery / drafting
vp test run mobile-e2e/src                      # harness + flow unit tests
vp check mobile-e2e                             # format + lint
```

Optional video: `KATACODE_E2E_VIDEO=1 vp run e2e:mobile --include-tags @smoke`.

Artifacts land under ignored paths: `mobile-e2e/test-results/` (manifest, JUnit) and `mobile-e2e/artifacts/` (screenshots, Maestro output).

## Related docs

- [E2E test catalog](/guides/e2e-test-catalog.md) — full desktop + mobile inventory
- [Mobile E2E operator reference](../../mobile-e2e/README.md) — env vars, tags, prerequisites
- [Mobile E2E foundation design](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md) — acceptance criteria, phases, risks
- [Mobile local dev (iOS Simulator)](/guides/mobile-local-dev-ios-simulator.md) — manual loop Studio assumes
- [mobile-e2e-test-author skill](../../.agents/skills/mobile-e2e-test-author/SKILL.md) — agent authoring checklist (points here for Studio detail)
- [kata-code-e2e-testing skill](../../.agents/skills/kata-code-e2e-testing/SKILL.md) — desktop/mobile comparison table
