---
name: mobile-e2e-test-author
description: Author local Maestro iOS-Simulator E2E flows for the Kata Code mobile app using the reusable TS orchestrator and Kata-specific flows. Use when adding or updating flows under mobile-e2e/.
---

# Mobile E2E test author

Local-only Maestro suite for the Kata Code mobile app on the iOS Simulator. The TS
orchestrator owns server lifecycle, isolation, prereq gates, and artifacts; Maestro
YAML owns on-device interaction. Real services only — no mocks.

## Current status (2026-06-25)

Verified green on-device (iPhone 17 Pro): `@smoke`, `@pairing`, `@agent`. Open:
`@auth` (the native `NativeClerk.presentAuth` modal is not yet driven by Maestro).
Full verified locators and the run inventory live in the
[Maestro Studio authoring guide](../../../docs/guides/e2e-mobile-authoring-maestro-studio.md)
and the [E2E test catalog](../../../docs/guides/e2e-test-catalog.md).

Durable learnings to reuse, not relearn:

- **`clearState: false`** on `launchApp` keeps the saved Metro URL so the dev client
  loads past the Expo Dev Launcher; pair `extendedWaitUntil` for Metro bundling and
  real provider round-trips.
- **Accessibility-id test contracts** beat fragile text where the UI has no durable
  label — e.g. `connection-status` on `ConnectionStatusDot`, asserted as
  `connection-status-ready` for the pairing ready-state.
- **Subflows** live in `maestro/shared/` (e.g. `open-add-environment.yaml`), composed
  via `runFlow`. `shared/` is excluded from flow discovery (`SUBFLOW_DIRS` in
  `cli/flows.ts`) so subflows are never run standalone.
- **Model-picker labels are display labels, not raw slugs.** `flows/agent.ts` derives
  them (`providerMenuLabel`: `openai`→`Codex`, `anthropic`→`Claude`; `modelMenuLabel`:
  `gpt-5.4-mini`→`GPT-5.4-Mini`) mirroring the server's `toDisplayName`. Keep in sync.

## Before writing a flow

1. Read [mobile-e2e/README.md](../../../mobile-e2e/README.md) and the design spec
   (`docs/specs/2026-06-24-mobile-e2e-testing-foundation-design.md`).
2. Read [Mobile E2E authoring (Maestro Studio)](../../../docs/guides/e2e-mobile-authoring-maestro-studio.md) for the canonical Studio workflow.
3. Inspect existing flows under `mobile-e2e/maestro/` and the TS building blocks in
   `mobile-e2e/src/harness/` and `mobile-e2e/src/flows/`.
4. **Explore the live app with Maestro Studio first**, then codify locators — do
   not guess selectors from product code alone. Full workflow:
   [Mobile E2E authoring (Maestro Studio)](../../../docs/guides/e2e-mobile-authoring-maestro-studio.md).

   ```bash
   vp run e2e:mobile:studio    # boots the sim, verifies the dev client, opens Studio
   ```

## Architecture (do not fight this)

| Layer               | Role                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/harness/` (TS) | Generic: simulator control, server stack (serve + token + project add), isolated run, Maestro runner, artifacts, prereq gates |
| `src/flows/` (TS)   | Kata-specific: pairing inputs, Clerk Connect gate, agent expected-text + normalization                                        |
| `maestro/**/*.yaml` | On-device UI — the only layer that references screen elements                                                                 |
| `src/cli/run.ts`    | Orchestrates a run: gate → isolate → sim → server → Maestro → manifest → cleanup                                              |

The TS layer injects dynamic values (one-time token, expected agent text, model)
into flows as `-e KEY=VALUE` (`${KEY}` in YAML). Keep dynamic plumbing in TS; keep
flows declarative.

## Rules

- Compose flows from the harness/flows building blocks — do not duplicate launch,
  pairing, isolation, or server logic in YAML.
- Keep generic simulator/process/Maestro concerns in `src/harness/` and Kata UI/product
  language in `src/flows/` + `maestro/`.
- Do **not** mock services: no fake server/provider/Clerk, no HAR/route stubs.
- Store secrets and auth state only under ignored paths (`mobile-e2e/.auth/`,
  `mobile-e2e/test-results/`, `mobile-e2e/artifacts/`, local `.env.local`).
- Tag every flow with exactly one feature tag in its YAML header (`@smoke`, `@pairing`,
  `@auth`, `@agent`). New surfaces get new tags; register them in `src/config/tags.ts`.
- Fail loud with the missing prerequisite when tooling or credentials are absent —
  never skip an assertion silently.
- Prefer durable accessible locators (text, label). Add a stable `accessibilityLabel`
  in product code only when no durable locator exists and it is a deliberate test
  contract (e.g. a `ConnectionStatusDot` ready state).
- The suite drives an **already-installed** dev client. Do not rebuild per run; if the
  app is missing the run fails loud with build instructions (`vp run e2e:mobile:build`).

## Credentials and deferred flows

- `@smoke` and `@pairing` need no credentials (bearer loopback path).
- `@auth` needs `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `KATACODE_E2E_GOOGLE_EMAIL`.
  Mobile sign-in is a **native auth modal** (`NativeClerk.presentAuth`); Maestro may
  not be able to drive it. Its green runtime pass is a maintainer responsibility.
- `@agent` needs `KATACODE_E2E_AGENT_PROVIDER`, `KATACODE_E2E_AGENT_MODEL`, and the
  matching provider key. Select the model explicitly; the composer default is not
  reliable for deterministic replies. Green runtime pass is a maintainer responsibility.

## Verification commands

```bash
vp run e2e:mobile --list                        # list flows + tags
vp run e2e:mobile --include-tags @smoke         # smoke launch
vp run e2e:mobile --include-tags @pairing       # bearer pairing
vp run e2e:mobile:studio                            # explore / author locators
vp test run mobile-e2e/src                          # harness + flow unit tests
vp check mobile-e2e                                 # format + lint
```

Suggested rollout order: `@smoke` → `@pairing` → `@auth` → `@agent`, one at a time in
Studio, giving the maintainer the exact verify command after each passes.
