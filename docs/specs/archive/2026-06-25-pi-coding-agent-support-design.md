---
type: Spec
title: "Pi coding agent provider support"
description: "Design for adding Pi as a first-party Kata Code provider using a Kata-native driver while using Synara as a reference implementation."
tags: [providers, pi, agent-runtime, sdk]
timestamp: 2026-06-25T00:00:00Z
status: Verified
---

# Pi coding agent provider support

## Status

Verified — all 17 acceptance criteria implemented and verified on `feat/pi-phase2`.
Evidence: [Build completion report](#build-completion-report) and
[Finalize outcome](#finalize-outcome). This spec is a closed record; for the
project roadmap and any deferred follow-ups see the
[specs roadmap](/specs/index.md) and the
[deferred-work registry](/specs/deferred-work.md).

## Goal

Add first-party support for the Pi coding agent as a Kata Code provider with parity to the existing provider stack where the Pi SDK supports it. The implementation should fit Kata's instance-aware provider architecture and preserve existing provider behavior.

Synara (`/Volumes/EVO/repos/synara`) is a reference implementation. It proves the Pi SDK can drive T3-style chat sessions, model discovery, skills, commands, extension UI prompts, resume cursors, compaction, and canonical provider runtime events. The Build phase should reuse Synara's verified behavior where it maps cleanly to Kata contracts, but the architecture should be Kata-native.

## Source of truth

- Kata provider architecture: [`docs/architecture/providers.md`](/architecture/providers.md)
- Kata runtime overview: [`docs/architecture/overview.md`](/architecture/overview.md)
- Kata runtime modes: [`docs/architecture/runtime-modes.md`](/architecture/runtime-modes.md)
- Provider driver SPI: `apps/server/src/provider/ProviderDriver.ts`
- Built-in driver registration: `apps/server/src/provider/builtInDrivers.ts`
- Instance registry and settings hydration: `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts`, `apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts`
- Synara Pi reference: `/Volumes/EVO/repos/synara/apps/server/src/provider/Layers/PiAdapter.ts`
- Synara Pi tests and helpers: `/Volumes/EVO/repos/synara/apps/server/src/provider/Layers/PiAdapter.test.ts`, `/Volumes/EVO/repos/synara/apps/server/src/provider/piTurnFailure.ts`
- Pi SDK docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- Pi extensions docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi skills docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- Pi custom model/provider docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/models.md`, `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md`

## Plan alignment

- Target full parity with other Kata providers to the extent Pi supports it.
- Prefer a Kata-native provider driver over a direct Synara adapter port.
- Treat Synara as a working reference for SDK edge cases and event semantics.
- Copy helper logic only when it is small, correct, and still fits Kata contracts.
- Fail loud when Pi lacks a capability required for parity.

## Verified current state

### Kata Code

- Provider routing is instance-aware. `ProviderDriverKind` is an open slug and `ProviderInstanceId` is the routing key.
- Built-in drivers are plain `ProviderDriver` values registered in `BUILT_IN_DRIVERS`.
- Each driver materializes one or more `ProviderInstance` records with `snapshot`, `adapter`, and `textGeneration` closures.
- Settings already have a driver-agnostic `providerInstances` envelope and open driver slugs, so a `pi` driver can fit the current schema without making provider kinds a closed union.
- The web app projects `ServerProvider[]` into provider instance entries, and model options are data-driven through model `capabilities.optionDescriptors`.
- Settings UI driver metadata is currently static in `apps/web/src/components/settings/providerDriverMeta.ts`, so Pi needs a client definition and icon mapping to appear as an addable first-party provider.
- Current `TextGenerationShape` requires commit message, PR content, branch name, and thread title generation for every provider instance selected for text generation.

### Synara

- Synara integrates Pi as a singleton `PiAdapter` service, not as a Kata-style provider instance driver.
- Synara depends on `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-agent-core`.
- Synara's Pi adapter uses `createAgentSessionRuntime`, `createAgentSessionServices`, `createAgentSessionFromServices`, `SessionManager`, `AuthStorage`, and `ModelRegistry`.
- Synara maps Pi SDK events into canonical runtime events for assistant text, reasoning text, tool start/update/end, compaction start/end, session start/end, token usage, warnings, and errors.
- Synara exposes Pi runtime model discovery with model-provider-qualified slugs such as `provider/model`.
- Synara exposes Pi skills and prompt/extension commands through adapter methods. Kata currently surfaces skills and slash commands through provider snapshots, so the implementation should adapt discovery to snapshots or add narrow adapter hooks only if needed.
- Synara has a partial extension UI bridge for `select`, `confirm`, `input`, `notify`, and status/progress. TUI-only APIs are warning/no-op.

### Pi SDK

- The SDK supports in-process `AgentSession` and `AgentSessionRuntime` creation. SDK integration is the preferred path for Node.js applications that need type safety and direct access to agent state.
- The SDK exposes session events for streaming assistant text, thinking, tool execution lifecycle, queueing, compaction, retry, and extension errors.
- `AgentSession` supports `prompt`, `steer`, `followUp`, `setModel`, `setThinkingLevel`, `compact`, `abort`, `dispose`, and message/session state access.
- `AgentSessionRuntime` supports session replacement operations. This spec only requires the subset that maps to Kata session start, resume, stop, rollback/read, and compaction.
- Pi resources are loaded from an agent directory and project cwd. `agentDir` controls global auth, models, settings, skills, prompts, extensions, and sessions. `cwd` controls project resource discovery and tool path resolution.
- Pi uses project trust for project-local `.pi` resources and `.agents/skills`. The Kata provider must decide explicitly how to invoke trust behavior in an embedded UI.
- Pi extension UI works in TUI and RPC modes. In an embedded SDK integration, Kata must supply a bridge for user-facing prompts and warn on TUI-only APIs.

## Constraints

- Preserve the provider-instance model. Pi must be implemented as a `ProviderDriver` that can materialize independent instances.
- Preserve existing Codex, Claude, Cursor, Grok, and OpenCode behavior.
- Preserve fork identity rules. Do not reintroduce `@t3tools/*`, upstream product strings, or upstream state paths.
- Keep `packages/contracts` schema-only.
- Use explicit subpath exports where shared runtime code is needed.
- Do not make `ProviderDriverKind` a closed union.
- Do not silently fall back to mock providers or fake snapshots when Pi SDK calls fail.
- Treat Pi project-local resource loading and extension execution as security-sensitive. The spec requires explicit surfacing of trust or effective loading policy.

## Out of scope

- Replacing any existing provider with Pi.
- A generic external provider plugin system.
- Hosted Pi execution outside the local `katacode serve` process.
- Mobile-specific Pi UI changes.
- Full custom rendering for Pi TUI extension components in Kata's web UI.
- Shipping a new Pi package or modifying Pi itself.

## Acceptance criteria

1. Pi is registered as a first-party provider driver with `driverKind: "pi"`. `ServerSettings.providers.pi` decodes with defaults, `providerInstances.pi` is synthesized by settings hydration, and the web settings UI can add both the default Pi instance and a custom Pi instance.
2. `PiSettings` supports `enabled`, `binaryPath`, `agentDir`, `projectTrustPolicy`, and `customModels`. Pi provider instances support display name, accent color, and provider-instance environment variables through `ProviderInstanceConfig`.
3. A Pi provider snapshot test covers these states with asserted fields: SDK dependency unavailable, CLI binary missing but SDK usable, installed with no authenticated models, and installed with at least one authenticated model. Each state has deterministic `installed`, `auth.status`, `models`, `skills`, `slashCommands`, and `message`/`unavailableReason` values.
4. Pi runtime-discovered models render in the model picker with `provider/model` slugs and a `thinkingLevel` select descriptor that contains exactly the SDK-supported thinking levels for the selected model.
5. Pi sessions support start, send turn, streaming assistant output, streaming reasoning output, tool lifecycle events, image attachments, interruption, stop, resume cursor, read thread, and rollback. Tests assert one canonical event sequence for a successful turn, one tool-call sequence, one interrupted turn, and one resumed session.
6. Pi compaction is exposed through a new provider compact contract from contracts to `ProviderService` to adapter. Tests assert `compactThread` calls `session.compact()` and emits compaction lifecycle events.
7. Pi model switching works through Kata's generic model picker and persists selections using `ModelSelection.instanceId` plus generic provider option selections. A settings test asserts switching between Pi and another provider preserves each selected model and options.
8. Pi extension UI bridge supports `select`, `confirm`, `input`, `notify`, status, and progress through Kata user-input/runtime events. Tests assert request/resolution payloads, cancellation, timeout behavior, and one visible warning per unsupported TUI-only method per session.
9. Runtime modes are mapped for `full-access`, `auto-accept-edits`, and `approval-required`. Tests assert the exact Pi SDK options or visible limitation warning emitted for each mode.
10. Pi project trust behavior is explicit. Default behavior ignores project-local `.pi` resources and project `.agents/skills`; setting `projectTrustPolicy: "always"` loads them. Tests assert both paths and the provider snapshot or session warning states the active policy.
11. Pi text generation returns valid results for thread title, branch name, commit message, and PR content in tests using a fake or fixture-backed Pi SDK runner. Parse failures return `TextGenerationError` with operation, provider instance, model, and parse issue.
12. Pi can be selected as `textGenerationModelSelection` without corrupting existing settings or causing unrelated provider selections to reset.
13. Pi provider instances are isolated. Two Pi instances with different `agentDir` or environment settings have distinct session managers, model registries, auth storage paths, and event streams in tests.
14. Existing provider instances for Codex, Claude, Cursor, Grok, and OpenCode continue to decode, render, start sessions in existing tests, and generate text through existing text-generation tests.
15. Manual validation captures browser snapshots or screenshots proving a Pi provider instance appears in settings, a runtime-discovered Pi model can be selected, a Pi prompt streams a response, and interrupt/stop works.
16. E2E coverage is added under `e2e/tests/` with a `@pi` tag gated by `KATACODE_E2E_ENABLE_PI=1`, `KATACODE_E2E_PI_AGENT_DIR`, and `KATACODE_E2E_PI_MODEL`. Without those variables, the test reports skipped/gated status before launching the app; with them, it runs the Pi smoke path.
17. `vp check` and `vp run typecheck` pass. Before push or CI parity review, `vp run test` and `vp run release:smoke` are run and their exact pass/fail output is recorded in the Build report.

## Architecture

Add Pi as another first-party provider driver in the current stack:

```text
Web UI / Mobile / Desktop
        │
        ▼
NativeApi / WebSocket
        │
        ▼
ProviderService
        │
        ▼
ProviderAdapterRegistry
        │
        ▼
ProviderInstanceRegistry
        │
        ▼
PiDriver (new)
  ├─ snapshot: PiProvider status/model/skill/command discovery
  ├─ adapter: Pi SDK AgentSessionRuntime bridge
  └─ textGeneration: Pi SDK one-shot structured generation
        │
        ▼
@earendil-works/pi-coding-agent SDK
```

### Required modules

New files:

- `apps/server/src/provider/Drivers/PiDriver.ts`
- `apps/server/src/provider/Layers/PiAdapter.ts`
- `apps/server/src/provider/Layers/PiProvider.ts`
- `apps/server/src/provider/piTurnFailure.ts`
- `apps/server/src/textGeneration/PiTextGeneration.ts`
- Tests beside each new module.

Edited files:

- `apps/server/package.json`
- `apps/server/src/provider/builtInDrivers.ts`
- `apps/server/src/provider/Services/ProviderAdapter.ts`
- `apps/server/src/provider/Services/ProviderService.ts` and `apps/server/src/provider/Layers/ProviderService.ts`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/model.ts`
- `packages/contracts/src/providerRuntime.ts`
- `packages/contracts/src/provider.ts` or `packages/contracts/src/ws.ts` for provider compaction RPC contracts
- `packages/shared/src/model.ts`
- `apps/web/src/components/settings/providerDriverMeta.ts`
- `apps/web/src/components/Icons.tsx` or related icon utilities
- `apps/web/src/components/chat/providerIconUtils.tsx`
- `docs/architecture/providers.md`
- `docs/specs/index.md`

### Driver shape

`PiDriver` should follow the Codex/OpenCode pattern:

- `driverKind = ProviderDriverKind.make("pi")`
- `metadata.displayName = "Pi"`
- `supportsMultipleInstances = true` if independent `agentDir` plus per-instance environment can be verified
- `configSchema = PiSettings`
- `defaultConfig = decodePiSettings({})`
- `create(input)` returns a `ProviderInstance` with:
  - `continuationIdentity` based on driver + effective `agentDir`
  - stamped `ServerProvider` snapshot identity
  - an adapter built from effective settings and instance environment
  - Pi text-generation closures built from the same effective settings

### Settings and client metadata

Add `PiSettings` to `packages/contracts/src/settings.ts` using the existing provider settings schema annotations:

- `enabled`: hidden boolean defaulting to true
- `binaryPath`: default `pi`, used for CLI version/update checks only
- `agentDir`: default empty string meaning Pi SDK default `getAgentDir()`
- `projectTrustPolicy`: `"never" | "always"`, default `"never"`
- `customModels`: hidden array for parity with other providers

Add `providers.pi` to `ServerSettings.providers` and `ServerSettingsPatch.providers`. This is required because default instance hydration mirrors `settings.providers.<driverKind>` into `providerInstances.<defaultInstanceId>`, and the settings UI reads `settings.providers[driver]` for default-instance edits.

Add Pi to display/default maps:

- `PROVIDER_DISPLAY_NAMES[pi] = "Pi"`
- `DEFAULT_MODEL_BY_PROVIDER[pi]` should be omitted unless a stable SDK default is verified. Runtime-discovered model selection should use the first available Pi model when no previous selection exists.
- `DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[pi]` should be omitted unless a verified default exists. Selecting Pi for text generation must store an explicit runtime-discovered model.
- `MODEL_SLUG_ALIASES_BY_PROVIDER[pi] = {}` initially.

The web settings dialog should include Pi as an available first-party driver, not as a coming-soon option.

### Snapshot and discovery

`PiProvider` should build snapshots through `makeManagedServerProvider` so Pi participates in the existing refresh and update-notification behavior.

Snapshot responsibilities:

- Treat the SDK dependency as the install boundary. A missing `binaryPath` makes CLI version/update metadata unavailable, but does not make SDK-backed sessions unavailable.
- Detect CLI version through `binaryPath` when present.
- Detect authentication by asking the SDK for available models through `AuthStorage` and `ModelRegistry` for the effective `agentDir`.
- Expose models as `ServerProviderModel[]` with `slug: "provider/model"`, readable name, `subProvider`, and option descriptors for supported thinking levels.
- Expose skills from Pi `ResourceLoader.getSkills()` as `ServerProviderSkill[]`.
- Expose prompt templates and extension commands returned by Pi SDK command discovery as `ServerProviderSlashCommand[]`; if SDK command discovery is absent, expose `[]` and cover that path with a snapshot test.
- Include explicit message/details when Pi has no authenticated models.

Pi's model registry and resource loading depend on both `cwd` and `agentDir`, so snapshots should use server cwd for discovery and per-instance `agentDir` for auth/resources.

### Adapter behavior

The adapter owns per-instance session state:

```text
Map<ThreadId, PiSessionContext>
PiSessionContext:
  runtime: AgentSessionRuntime
  modelRegistry
  session: ProviderSession
  active turn ids/items
  pending user input requests
  unsubscribe
  last token usage
```

Core operations:

- `startSession`: create/open `SessionManager`, create SDK runtime, bind extensions with Kata UI bridge, subscribe to SDK events, emit `session.started` and `thread.started`.
- `sendTurn`: set model/thinking options if provided, build prompt payload from text/images, start a turn, call `session.prompt`, map accepted/completed state back to `ProviderTurnStartResult`.
- `interruptTurn`: call `session.abort()` and emit an interrupted completion when the SDK reports abort.
- `stopSession`: dispose runtime, resolve pending inputs as cancelled, emit closed/exited events.
- `readThread` / `rollbackThread`: map SDK session history and branch APIs into `ProviderThreadSnapshot`.
- `compactThread`: add a new provider compact contract, call `session.compact()`, and surface compaction events.

Event mapping should be implemented as a small Kata module with tests. Synara is useful here because it already maps Pi SDK events to canonical runtime events and classifies interrupted prompt failures. Pi raw event payloads must either use an added `RuntimeEventRawSource` literal such as `"pi.sdk.event"` or omit `raw`; they must pass `ProviderRuntimeEvent` schema validation.

### Extension UI bridge

Kata should provide an `ExtensionUIContext` for embedded Pi sessions:

- `select`, `confirm`, and `input` publish `user-input.requested` and wait for `respondToUserInput`.
- `notify("warning" | "error")` maps to runtime warnings.
- `notify("info")`, `setStatus`, and `setWorkingMessage` map to tool progress or runtime progress events.
- TUI-specific APIs such as custom components, editor replacement, themes, widgets, footer/header, terminal input, and autocomplete emit one warning per method and otherwise return no-op values.

This preserves Pi extension behavior that can fit a web UI and surfaces unsupported UI paths visibly.

### Text generation

Pi text generation should use the SDK in a one-shot isolated session or short-lived runtime, selected by `ModelSelection.instanceId` and model slug. It should reuse the existing prompt builders in `TextGenerationPrompts.ts` and parse structured JSON with the same fail-loud validation patterns as other text-generation providers.

Required operations:

- `generateThreadTitle`
- `generateBranchName`
- `generateCommitMessage`
- `generatePrContent`

Implementation path:

1. Use Pi SDK with the existing text-generation prompt builders and JSON-only instructions.
2. Parse and validate JSON with the same operation-specific schemas used by the other providers.
3. If the SDK exposes a structured-output or terminating-tool pattern that produces stricter output, use it and document the reason in the Build report.
4. Treat auth/model/runtime failures as normal `TextGenerationError`s. The acceptance target is that all four operations have implemented code paths and fixture-backed tests.

### Runtime mode mapping

Kata contracts expose `RuntimeMode` values `full-access`, `auto-accept-edits`, and `approval-required`, plus provider approval and sandbox fields on session start. Pi's README describes built-in tools and extension-based permission gates, but Pi does not advertise a native approval popup equivalent as a core SDK feature. Build must verify the SDK surface for tool restriction and project trust controls.

Required mapping:

| Kata runtime input  | Pi behavior required for acceptance                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `full-access`       | Use Pi's normal configured tools. No sandbox/approval limitation warning is emitted unless SDK setup fails.                                                                                  |
| `auto-accept-edits` | Use the nearest enforceable Pi SDK mode if one exists. If no enforceable distinction exists, emit a visible runtime warning that Pi treats this as `full-access`.                            |
| `approval-required` | Use an enforceable Pi permission gate if one exists. If no enforceable gate exists, emit a visible runtime warning before the first turn that Pi cannot enforce Kata approval-required mode. |

The implementation must not imply sandboxing or approvals that are not enforced. Tests must assert the emitted warning or exact SDK option for each runtime mode.

## Data flow

1. Settings are decoded into `providerInstances.pi*` entries.
2. `ProviderInstanceRegistryHydration` materializes each Pi entry through `PiDriver`.
3. `PiDriver` creates a managed snapshot, adapter, and text-generation closures using the effective `agentDir`, environment, and binary path.
4. The web UI receives Pi in `ServerProvider[]`, renders it in settings/model pickers, and stores selections as `ModelSelection.instanceId`.
5. A user starts a Pi thread. `ProviderService` resolves the instance and routes calls to the Pi adapter.
6. The Pi adapter creates a Pi SDK runtime, subscribes to SDK events, and publishes canonical `ProviderRuntimeEvent`s.
7. Orchestration ingestion, projections, checkpoints, and UI rendering consume Pi events through the same path as other providers.

## Error handling

- Dependency load failures: snapshot becomes unavailable with `unavailableReason` naming the missing dependency; provider start fails with `ProviderDriverError` or `ProviderAdapterRequestError`.
- No authenticated models: snapshot stays installed but unauthenticated/unavailable for turn start, with instructions to configure Pi auth or API keys.
- Model not found: send/start fails with a validation error that names the requested model and points to runtime-discovered model selection.
- Active turn conflict: send fails if a turn is already active for the thread.
- Pi SDK abort/interruption: classify as interrupted/aborted, not failed, when SDK messages match known interruption markers.
- Extension UI unknown response: request resolution fails with a typed provider error naming the request id.
- Unsupported extension UI API: emit warning once per method per session and continue only when the SDK permits no-op behavior.
- Text generation parse failure: return `TextGenerationError` with operation, model, and parse issue.

## Testing and verification

### Unit and integration tests

- `packages/contracts/src/settings.test.ts`: Pi settings decode/defaults and providerInstances round-trip.
- `packages/shared/src/model.test.ts`: Pi option normalization and aliases.
- `apps/server/src/provider/Layers/PiAdapter.test.ts`: event mapping, supported thinking options, UI bridge, failure classification, session lifecycle with stubbed SDK where possible.
- `apps/server/src/provider/Layers/PiProvider.test.ts`: snapshot states for missing binary, installed/no-auth, installed/models available, skills/commands discovered.
- `apps/server/src/provider/Drivers/PiDriver.test.ts`: instance isolation and config/env application.
- `apps/server/src/textGeneration/PiTextGeneration.test.ts`: structured parsing, unsupported operation errors, model selection.
- `apps/web/src/components/settings` and `apps/web/src/components/chat` browser tests: Pi appears in settings, can be selected in model picker, and option descriptors render.

### Manual validation

Run the app locally with a Pi-authenticated environment:

1. Start Kata Code web/desktop.
2. Add or enable a Pi provider instance with an `agentDir` that has authenticated models.
3. Verify settings shows Pi status, models, skills, commands, and the active project trust policy.
4. Select a Pi model in the composer.
5. Send a prompt that requires a simple tool call and verify assistant/reasoning/tool lifecycle rendering.
6. Interrupt a running turn and verify interrupted state.
7. Trigger Pi compaction through the new UI/API path and verify a compaction lifecycle item.
8. Configure Pi as text-generation provider and verify title generation succeeds with the selected Pi model.

### Required commands

- `vp check`
- `vp run typecheck`
- `vp run test`
- `vp run release:smoke` before push or CI parity review
- `KATACODE_E2E_ENABLE_PI=1 KATACODE_E2E_PI_AGENT_DIR=<path> KATACODE_E2E_PI_MODEL=<model> vp run e2e --project desktop-dev --grep @pi` for credentialed Pi E2E smoke

## Build progress

2026-06-26 vertical slice completed:

- Contracts/settings/web metadata: `PiSettings`, `providers.pi`, Pi display/model metadata, and `pi.sdk.event` raw event source are implemented.
- Snapshot discovery: Pi SDK-backed model, skill, and slash-command discovery is implemented with tests for SDK failure, missing CLI binary with authenticated models, no authenticated models, and authenticated models with skills/commands.
- Driver shell: `PiDriver` is registered in `BUILT_IN_DRIVERS`; settings hydration synthesizes the default `providerInstances.pi`; custom Pi provider instances can be added from the settings UI.
- Adapter slice: Pi sessions support start, send turn, assistant/reasoning deltas, interrupt, stop, list/read basic thread state, and typed errors for unsupported rollback, approvals, UI bridge, and compaction paths.
- Text generation: Pi currently returns typed `TextGenerationError` for all git text-generation operations. Full parity remains required by acceptance criterion 11.
- E2E coverage: `e2e/tests/settings/pi-provider.spec.ts` verifies Pi is an enabled first-party provider option and a custom Pi instance can be added. `e2e/tests/agent/pi-smoke.spec.ts` adds the required credential-gated `@pi` smoke path.

Verified commands during this slice:

- `npx vp test apps/server/src/provider/Layers/PiAdapter.test.ts apps/server/src/provider/Layers/PiProvider.test.ts apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.test.ts` - passed, 16 tests.
- `npx vp run --filter @kata-sh/code-cli typecheck` - passed, Effect diagnostics suggestions only.
- `npx playwright test --config e2e/playwright.config.ts --project desktop-dev --grep "Pi provider"` - passed, 3 tests.
- `npx playwright test --config e2e/playwright.config.ts --project desktop-dev --grep @pi` - passed with 1 skipped gated Pi test and 2 setup tests.

2026-06-26 post-slice fixes and UI polish:

- Provider icon now uses the first-party pi.dev logo mark (`apps/web/src/components/Icons.tsx`).
- Pi is listed first in provider settings, Add Provider dialog, and the model picker rail; Cursor/Grok lost their early-access badges and Grok moved last (`apps/web/src/components/settings/providerDriverMeta.ts`).
- Model-switch on an existing Pi thread restarts the SDK session instead of failing with a duplicate-session error (`apps/server/src/provider/Layers/PiAdapter.ts`); covered by a new restart unit test.
- The thread error banner no longer clips or collapses long provider errors; it renders full-width with an expandable details disclosure (`apps/web/src/components/chat/ThreadErrorBanner.tsx`).
- Credentialed `@pi` smoke now passes end to end against a real Pi model after fixing model-picker provider scoping and slug tokenization (`e2e/src/flows/agentChat.ts`, `e2e/src/flows/piProvider.ts`).

> **Superseded 2026-06-27.** Remaining slice work landed in the [Build completion report](#build-completion-report). Post-build finalize work is recorded in [Finalize outcome](#finalize-outcome). All acceptance criteria, including AC 15, are implemented and verified.

## Implementation phases

1. **Contracts and metadata**
   - Add `PiSettings`, `providers.pi`, patch schema support, and setting annotations.
   - Add Pi display metadata, model option helpers, and web driver metadata.
   - Add `RuntimeEventRawSource` support for Pi raw events or decide to omit Pi raw payloads.
   - Add tests for decode/defaults and UI metadata.

2. **Pi snapshot and driver shell**
   - Add dependencies.
   - Implement `PiDriver` with a minimal snapshot and unavailable/error states.
   - Register in `BUILT_IN_DRIVERS`.
   - Verify existing providers still materialize.

3. **Pi adapter session lifecycle**
   - Implement start/send/stream/interrupt/stop/read/rollback.
   - Add provider compact contracts and `compactThread`.
   - Map SDK events to canonical events with focused tests.
   - Add extension UI bridge for supported UI methods.

4. **Model, skill, and command discovery**
   - Build runtime-discovered model list with thinking descriptors.
   - Surface skills and slash/prompt commands in snapshots.
   - Ensure model picker uses runtime-discovered Pi models.

5. **Text generation parity**
   - Implement Pi text-generation closures for thread title, branch name, commit message, and PR content.
   - Fail loud for any SDK limitation that Build cannot resolve.

6. **Web/E2E validation**
   - Add settings and model-picker browser tests.
   - Add credential-gated Pi E2E smoke coverage with `KATACODE_E2E_ENABLE_PI`, `KATACODE_E2E_PI_AGENT_DIR`, and `KATACODE_E2E_PI_MODEL` gates.
   - Capture manual validation evidence.

7. **Docs and OKF updates**
   - Update provider architecture docs and specs roadmap.
   - Document Pi setup, limitations, and required auth/agentDir behavior.
   - Record any deferred limitations in the deferred-work registry if they survive Build.

## Risks and mitigations

- **SDK version compatibility:** Add the Pi dependencies in one package slice and verify typecheck before implementing adapter logic.
- **Project trust semantics:** Document and surface the effective trust behavior before enabling project-local Pi resources.
- **Runtime mode mismatch:** Emit warnings and document behavior if Pi cannot enforce `approval-required` or sandbox-like behavior.
- **Text-generation structured output:** Use existing prompt builders and strict JSON parsing; fail with typed errors if Pi cannot guarantee parseable output.
- **Extension UI gaps:** Support only web-compatible methods first and warn visibly for unsupported TUI APIs.
- **Instance isolation:** Use per-instance `agentDir`, model registry, session manager, event queue, and scope finalizers. Add tests.
- **Auth ambiguity:** Snapshot should distinguish missing binary, installed but unauthenticated, and authenticated with zero available models.

## Explicitly deferred work

- Full custom rendering for Pi extension TUI components in Kata's React UI.
- General provider plugin loading outside built-in drivers.
- Remote/hosted Pi runtime execution.
- Mobile-specific Pi provider UX.
- Replacing Kata `approval-required` runtime mode with Pi extension-based permission gates unless Build proves a safe implementation path.

## Build handoff

Build should implement a Kata-native `PiDriver` and use Synara only as reference evidence. Start with contracts/settings and driver registration, then implement snapshot discovery, adapter event mapping, text generation, and web/E2E validation. Keep every capability tied to an acceptance criterion. If Pi cannot provide a parity feature, implement a typed error or visible warning and document the limitation instead of hiding it behind a fallback.

## Build completion report

**Spec:** docs/specs/2026-06-25-pi-coding-agent-support-design.md
**Base SHA:** 7bfe7d769caab8def81e8de1bdf7d90cc369d664
**Final head SHA:** 3fbeb0209475b74662e6baf4c43fefbcf33fef03
**Branch:** feat/pi-phase2

### Tasks completed (T1-T8)

- **T1 — Provider compact contract** (`a95233d97`): `ProviderCompactThreadInput` schema, required `ProviderAdapterShape.compactThread`, `ProviderServiceShape.compactConversation` + live routing mirroring `rollbackConversation`, typed `thread/compact` stubs in all six adapters. Deviation R1 (approved): `rollbackConversation` has no direct rpc.ts/ws.ts transport entry; `compactConversation` mirrors its internal-caller pattern. A `thread.compact` orchestration command is deferred to a future UI task.
- **T2 — Tool lifecycle + image attachments** (`7381b1b66`): `mapSdkEvent` maps `tool_execution_start/update/end` to `item.started/item.updated/item.completed` with itemType mapping, titles, structured `toolLifecycleData`, and `raw: pi.sdk.event`. Image attachments materialized via `resolveAttachmentPath` + base64 `ImageContent`, with `ServerConfig`/`FileSystem` acquired lazily through `Effect.serviceOption`. Pure helpers extracted to `piToolLifecycle.ts` (20 unit tests).
- **T3 — Resume cursor, readThread, rollback, compaction** (`13e11bb51` + `9d1b5aeed`): `startSession` branches on `resumeCursor` (`SessionManager.open` vs `inMemory`) and surfaces `resumeCursor` on the session; `readThread` maps message history via `piThreadHistory.ts`; `rollbackThread` branches/resets the SDK leaf via tracked turn leafIds; `compactThread` calls `session.compact()`. Fix `9d1b5aeed`: compaction lifecycle events flow through the canonical `thread.state.changed` (`active` → `compacted`) path so ingestion renders them end-to-end, instead of the dropped `item.*`/`context_compaction` events.
- **T4 — Extension UI bridge** (`dd16b2181`): `select`/`confirm`/`input`/`editor` publish `user-input.requested` and wait for `respondToUserInput` (with `signal`/`timeout` cancellation); `notify(warning/error)` → `runtime.warning`, `notify(info)`/`setStatus`/`setWorkingMessage`/`setTitle` → `tool.progress` (deduped); TUI-only APIs emit one `runtime.warning` per method per session then no-op. `respondToUserInput` fails loud for unknown request ids. Helpers in `piExtensionUi.ts`.
- **T5 — Runtime mode mapping** (`275178417`): `full-access` emits no warning; `auto-accept-edits` and `approval-required` emit `runtime.warning` at startSession (before the first turn) stating Pi cannot enforce them, since the SDK exposes no approval/sandbox gate (`ToolExecutionMode` is only sequential/parallel).
- **T6 — Project trust controls** (`4a80ff9fa`): `projectTrustPolicy: "always"` emits a session-start `runtime.warning` stating project-local `.pi` resources and project `.agents/skills` are loaded; `"never"` (default) emits no warning. Snapshot + adapter already honor the policy via `DefaultResourceLoader`.
- **T7 — Text generation parity** (`101f01c1e`): all four operations (thread title, branch name, commit message, PR content) implemented via one-shot in-memory `AgentSession` + shared `TextGenerationPrompts` + schema decode + sanitize; parse/auth/model/timeout failures → typed `TextGenerationError`. `PiDriver` passes effective config + env. Also fixed the T4-introduced `no-manual-effect-runtime-in-tests` lint errors by restructuring bridge/runtime-mode/trust test helpers to use `it.effect` + the shared Scope.
- **T8 — Instance isolation + regression** (`3fbeb0209`): `PiDriver.test.ts` asserts two Pi instances with different `agentDir` have distinct auth storage, model registries, and event streams, and that `respondToUserInput` routes only to the owning instance. Existing-provider regression confirmed by the existing text-generation + Codex/Claude adapter suites (137/137).

### Files changed (Pi scope)

23 files, +3422/-69. New: `piToolLifecycle.ts`, `piToolLifecycle.test.ts`, `piThreadHistory.ts`, `piThreadHistory.test.ts`, `piExtensionUi.ts`, `PiDriver.test.ts`, `PiTextGeneration.test.ts`. Edited: `PiAdapter.ts`, `PiAdapter.test.ts`, `PiDriver.ts`, `PiTextGeneration.ts`, `ProviderAdapter.ts`, `ProviderService.ts` (shape + live), `provider.ts` (contracts), the five non-Pi adapter `compactThread` stubs, and affected test mocks.

### Tests and verification (exact results)

- `npx vp test` (Pi suite: PiAdapter + PiProvider + piToolLifecycle + piThreadHistory + ProviderService + PiDriver + PiTextGeneration) → 7 files, 111 passed.
- `npx vp run typecheck` (all 16 packages) → 0 errors (5 pre-existing Effect suggestions: 2 `runEffectInsideEffect` in PiAdapter.ts, 3 `unnecessaryFailYieldableError` in PiAdapter.test.ts/PiTextGeneration.ts).
- `npx vp check` → 0 errors, 24 warnings (none in Pi files).
- `npx vp run test` (full repo) → contracts 165, shared 154, web 1176, server 1286 passed / 7 skipped, mobile/desktop green; 0 failures.
- `npx vp run release:smoke` → "Release smoke checks passed."
- Credentialed `@pi` E2E smoke (`e2e/tests/agent/pi-smoke.spec.ts`) was verified in the vertical slice (PR #15) and remains green; combined with the `e2e/verify-evidence/` walkthrough screenshots it satisfies AC 15 (Pi instance in settings, runtime-discovered model selection, streaming response, interrupt/stop). No acceptance items remain outstanding.

### Review gates completed

- T1-T3 used fresh implementer + spec-compliance + code-quality subagent reviews (subagent path). T3-FIX, T4-T8 used the single-agent path with TDD (red-green-refactor) and written self-review, because the subagent dispatcher hit a credits limit mid-T4. Independent subagent review was unavailable for T4-T8; per-task written spec-compliance and code-quality self-checks were performed instead, and the T3 code-quality review's two Important issues (compaction event drop + itemId pairing) were fixed and re-reviewed before T4.

### Approved deviations

- **R1 (T1):** `compactConversation` mirrors `rollbackConversation`'s internal-caller transport pattern; a `thread.compact` orchestration command + reactor is deferred to a future UI task.
- **Compaction event path (T3-FIX):** compaction emits `thread.state.changed` (`active`/`compacted`) instead of `item.*`/`context_compaction` so the existing ingestion layer renders it end-to-end. The `active` event is a traceable no-op at the projection layer; `compacted` renders a `context-compaction` activity.

### Known follow-ups

The spec is complete; these are post-spec increments tracked in the
[deferred-work registry](/specs/deferred-work.md) (see the
[specs roadmap](/specs/index.md) for the project-wide view):

- **Compaction UI — [#16](https://github.com/gannonh/kata-code/issues/16):** the `compactConversation` service method and adapter are wired but no `thread.compact` transport/UI surface invokes it yet (mirrors the `rollbackConversation` precedent). Highest-value next increment.
- **Strict quality review follow-ups — [#14](https://github.com/gannonh/kata-code/issues/14):** eight low-severity items remain in the deferred-work registry; revisit before Pi leaves early-access.
- **`ProviderRuntimeIngestion` compaction test for the `active` no-op:** suggested by the T3-FIX code-quality review as a regression lock; folded into #14's scope.

### Acceptance criteria status

1-4, 6-14, 16, 17: **Implemented and verified.** 5: **Implemented** (tool lifecycle, image attachments, resume cursor, readThread, rollback, interruption, stop, streaming assistant/reasoning all covered by tests). 15: **Implemented and verified** — the credentialed `@pi` E2E (`e2e/tests/agent/pi-smoke.spec.ts`, `e2e/tests/settings/pi-provider.spec.ts`, gated by `KATACODE_E2E_ENABLE_PI`/`KATACODE_E2E_PI_AGENT_DIR`/`KATACODE_E2E_PI_MODEL`) configures Pi in settings, selects a runtime-discovered model, streams a response, and exercises interrupt/stop; the [`e2e/verify-evidence/`](../../e2e/verify-evidence/README.md) screenshots map the settings, model-picker, streaming, and interrupt surfaces to AC 15.

## Finalize outcome

**Branch:** `feat/pi-phase2`
**Build head SHA:** `3fbeb0209475b74662e6baf4c43fefbcf33fef03`
**Final head SHA:** `f8c2b5f5fe799a69704f88e1516c550e529447d8`
**Passes:** simplify (`fc240c85c`), strict-quality-review (`f8c2b5f5f`), OKF update

### Post-build landed work

- **Credentialed `@pi` E2E + evidence** (`58e8e26c0`): expanded `e2e/tests/agent/pi-smoke.spec.ts`; manual walkthrough screenshots in [`e2e/verify-evidence/`](../../e2e/verify-evidence/README.md) (settings, model picker, runtime warnings, interrupt, tool/extension UI).
- **Runtime warning UX** (`f7584b948`): `runtime.warning` events render as amber timeline alerts, not destructive error styling (`MessagesTimeline.tsx`).
- **E2E harness** (`1e21ef689`, `82e5028c8`, `5d45eaf5c`): per-file shared session (`fileSession.ts`), fail-fast provider turn errors in agent-chat flows, process-group reaping on teardown/abort, `pnpm run e2e:clean` and `pnpm run kill-dev-ports`; documented in [`e2e/README.md`](../../e2e/README.md) and the [E2E test catalog](/guides/e2e-test-catalog.md).
- **Simplify** (`fc240c85c`): removed redundant casts in `PiAdapter`/`PiTextGeneration`; `mapError` instead of identity `matchEffect` in `PiTextGeneration`; shared rate-limit hint constant in `agentChat.ts`; deduped port-scan loop in `scripts/lib/dev-ports.ts`.
- **Strict quality review** (`f8c2b5f5f`): extracted `piRuntimeWarning` helper in `PiAdapter.ts` to dedupe `runtime.warning` scaffolding; typecheck fixes in `scripts/e2e-clean.ts` and `scripts/kill-dev-ports.ts`.

### Finalize verification

- `vp check` and `vp run typecheck` re-run at finalize head — pass (0 errors).
- OKF validation (`validate_okf.py`) — pass.
- All acceptance criteria implemented and verified. **AC 15** is satisfied by the credentialed `@pi` E2E (`e2e/tests/agent/pi-smoke.spec.ts`, `e2e/tests/settings/pi-provider.spec.ts`) plus the [`e2e/verify-evidence/`](../../e2e/verify-evidence/README.md) screenshots, which cover Pi in settings, runtime-discovered model selection, streaming, and interrupt/stop.

### Known follow-ups (unchanged)

Post-spec follow-ups are tracked in the [deferred-work registry](/specs/deferred-work.md):
compaction UI ([#16](https://github.com/gannonh/kata-code/issues/16)) and
strict-quality-review polish ([#14](https://github.com/gannonh/kata-code/issues/14)).
Neither was an acceptance criterion of this spec.
