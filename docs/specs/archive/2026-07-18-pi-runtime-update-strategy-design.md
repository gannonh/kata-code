---
type: Spec
title: "Pi runtime updates and post-update validation"
description: "Design for migrating Kata Code to Pi ModelRuntime, tracking Pi releases daily, and validating each update across local, Docker, and Vercel runtimes."
tags: [pi, providers, dependencies, testing, e2e, docker, vercel]
timestamp: 2026-07-18T15:30:00Z
status: Approved
---

# Pi runtime updates and post-update validation

## Status

Approved for implementation on 2026-07-18.

## Problem

Kata Code currently resolves `@earendil-works/pi-*` at `0.80.2`. The host Pi CLI is `0.80.10`. The two runtimes expose different authenticated model catalogs:

- Kata Code / Pi `0.80.2`: 315 authenticated models and no GPT-5.6 entries.
- Host Pi CLI / Pi `0.80.10`: 325 authenticated models, including `openai-codex/gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`.

Pi `0.80.8` replaced the SDK's `AuthStorage` and session `modelRegistry` options with the async `ModelRuntime` API. The Vercel bootstrap pins `0.80.2` because an uncoordinated update to `0.80.8` made `katacode serve` fail during module loading. Local and Docker builds also use the repository lock, so all Kata-hosted Pi sessions have the older catalog.

Claude and Codex can update independently because Kata launches their external CLI processes. Pi runs in the Kata server process as an SDK. Updating a global `pi` binary cannot replace the already-loaded SDK and would misreport the runtime version. Production Pi updates therefore ship as Kata Code updates.

## Goals

1. Migrate Kata Code to the latest Pi SDK, `0.80.10` at approval time.
2. Expose the current Pi model catalog, including `openai-codex/gpt-5.6-sol`, wherever the seeded credentials authenticate that provider.
3. Keep the Pi coding-agent, AI, and agent-core packages on one tested version across local, Docker, and Vercel runtimes.
4. Notify maintainers of new Pi releases through one grouped daily dependency PR.
5. Provide one fail-loud post-update validation command covering static checks, Pi unit/integration tests, credentialed desktop E2E, and Docker runtime smoke.
6. Validate the published nightly artifact in a fresh Vercel sandbox before stable promotion.

## Non-goals

- Making Pi independently updatable inside a running Kata process.
- Converting the Pi provider to the CLI RPC protocol.
- Automatically merging Pi dependency updates.
- Running credentialed Pi E2E or billable Vercel provisioning in pull-request CI.
- Floating Pi dependencies to an untested version at runtime.

## Update policy

Kata tracks the newest Pi release through a daily tested-update workflow:

1. Dependabot checks npm daily.
2. It opens or updates one grouped PR for `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-agent-core`.
3. The three dependencies remain exact and version-aligned. The Vercel bootstrap Pi pin must match.
4. CI runs deterministic repository checks. A maintainer runs the credentialed `verify:pi-update` suite before merge.
5. The merged change enters the next Kata nightly.
6. A fresh Vercel sandbox validates the published nightly package.
7. The release is eligible for stable promotion after the pre-release and post-release gates pass.

This batches multiple same-day Pi releases into one actionable daily update while preserving compatibility review for Pi's evolving SDK surface.

## Runtime migration

### Canonical model runtime

Replace direct `AuthStorage` and `ModelRegistry` construction with `ModelRuntime.create()`.

The shared Pi runtime factory accepts an agent directory and creates a runtime using that directory's `auth.json` and `models.json`. Discovery awaits `modelRuntime.getAvailable()`. Session creation passes `modelRuntime` to `createAgentSession`.

The adapter creates a fresh `ModelRuntime` for every `startSession`. Docker and Vercel seed host credentials after `katacode serve` may already be running; per-session construction ensures the SDK reads the newly written credential files. Provider snapshot discovery also creates a fresh runtime for each check.

### Dependency alignment

The server package keeps exact, matching versions for:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`

The Vercel bootstrap installs the matching coding-agent version. Its transitive Pi packages are explicitly aligned with the server dependencies, preserving the existing npm deduplication safeguard. Docker installs the same Pi CLI version used by the Kata SDK build.

A deterministic test compares the server dependency versions and Vercel bootstrap pin. Version drift fails before release.

### Model behavior

Kata continues to show authenticated models from Pi's runtime rather than maintaining a separate model allowlist. `ModelRuntime` owns built-in model metadata, custom `models.json` entries, provider authentication, and supported catalog refresh behavior.

The existing provider-qualified slug remains unchanged, for example `openai-codex/gpt-5.6-sol`.

## Developer update notification

Add `.github/dependabot.yml` with a daily npm version-update entry restricted to `@earendil-works/pi-*`. Group all Pi packages into one PR and limit concurrent Pi update PRs to one.

The PR is the developer notification and update work surface. Compile failures, unit failures, or version-alignment failures show the required migration work. Credentialed and sandbox checks remain explicit maintainer gates because repository CI does not hold local Pi credentials and Vercel validation consumes a published Kata artifact.

## Post-update validation suite

Add a root `verify:pi-update` script backed by a small orchestration script. It fails before running tests unless these prerequisites exist:

- `KATACODE_E2E_PI_AGENT_DIR`
- `KATACODE_E2E_PI_MODEL`
- readable Pi credentials in the configured agent directory
- Docker available for the Docker phase

The suite runs in this order:

1. **Version and catalog regression tests**
   - Pi package versions and Vercel bootstrap pin match.
   - The installed Pi runtime resolves the configured provider-qualified model.
   - A regression fixture confirms the current migration target includes `openai-codex/gpt-5.6-sol`.
2. **Focused server tests**
   - Pi provider discovery and model mapping.
   - Pi adapter session start, late credential visibility, streaming, tools, interrupt, resume, and errors.
   - Pi text-generation behavior.
   - Vercel bootstrap package alignment.
3. **Repository gates**
   - `vp check`
   - `vp run typecheck`
4. **Credentialed desktop E2E**
   - Build the current CLI and desktop development artifacts.
   - Run `vp run e2e:desktop --grep @pi` with Pi explicitly enabled.
   - Assert the configured model appears in the Pi model picker before sending a turn.
   - Preserve the existing real-provider assertions for streaming, interrupt, tool lifecycle, and runtime warning behavior.
5. **Docker runtime smoke**
   - Build `katacode:local` from the current source.
   - Run the existing image verification.
   - Mount a staged copy of the configured Pi agent directory.
   - Assert the image's Pi CLI and Kata-loaded Pi runtime report the expected version and configured model.

The suite uses real credentials and provider traffic. It does not mock Pi or provider APIs. Generated credentials and artifacts remain in ignored temporary paths.

## Post-nightly Vercel validation

Vercel installs the published `@kata-sh/code-cli` package, so Vercel compatibility is validated after the nightly exists.

For each Pi update:

1. Set the Vercel deployment target to the new nightly tag or exact nightly version.
2. Delete any prior test sandbox so no old snapshot or package install is reused.
3. Provision a fresh sandbox and confirm the expected Kata CLI and Pi versions.
4. Verify the configured Pi model appears.
5. Verify streaming response, a tool call in `/workspace`, interrupt, and thread resume.
6. Record the nightly version and pass/fail evidence in the Pi sandbox build report.

A failed Vercel validation blocks stable promotion and keeps the Pi update task open.

## Testing architecture

- Unit tests remain colocated with `PiProvider`, `PiAdapter`, `PiTextGeneration`, and Vercel bootstrap code.
- Shared Playwright actions stay under `e2e/src/flows/`.
- `e2e/tests/agent/pi-smoke.spec.ts` remains the credentialed user-visible Pi smoke suite.
- The root verification script coordinates existing commands and prerequisite checks. It does not duplicate test logic.
- Vercel remains a post-publish acceptance gate because its bootstrap consumes npm artifacts.

## Error handling

- Runtime construction failures surface as provider discovery or session-start errors with the Pi version and operation context.
- Missing credentials or configured models fail the update suite with the exact missing path or model slug.
- Package-version drift reports every mismatched package and expected version.
- Docker and Vercel probes report the Kata CLI version, Pi CLI version, SDK version, and selected model before exiting.
- No phase silently skips because credentials, Docker, or a published nightly are unavailable.

## Acceptance criteria

1. Kata builds and runs against Pi `0.80.10` using `ModelRuntime`.
2. With the maintainer's seeded OpenAI Codex credentials, Pi exposes and starts `openai-codex/gpt-5.6-sol` locally.
3. A session started after sandbox credential seeding sees those credentials without restarting `katacode serve`.
4. The three direct Pi dependencies and Vercel bootstrap pin are exact and equal.
5. Dependabot opens at most one grouped daily Pi dependency update PR.
6. `vp run verify:pi-update` fails loudly without prerequisites and passes the focused tests, static gates, credentialed desktop `@pi` E2E, and Docker model/runtime smoke when prerequisites are present.
7. The Pi E2E smoke explicitly proves that the configured Pi model appears in the model picker before a real turn.
8. A fresh Vercel sandbox using the published nightly passes model discovery, streaming, `/workspace` tool execution, interrupt, and resume.
9. `vp check`, `vp run typecheck`, `vp run test`, and `vp run release:smoke` pass before completion.
10. The Pi sandbox build report records local, Docker, and Vercel evidence with the tested Kata and Pi versions.

## Rollout

1. Implement the `ModelRuntime` migration and dependency alignment.
2. Add regression tests and make focused tests green.
3. Add the grouped daily Dependabot configuration.
4. Add and run `verify:pi-update` locally.
5. Publish a new nightly from the branch.
6. Run fresh Vercel validation against that nightly.
7. Complete the existing Pi sandbox plan and remove the temporary client-side Pi gate.

## Related documents

- [Pi sandbox support design](/specs/2026-07-17-pi-sandbox-support-design.md)
- [Pi sandbox implementation plan](/specs/plans/2026-07-17-pi-sandbox-support-plan.md)
- [Pi sandbox build report](/specs/2026-07-17-pi-sandbox-support-build-report.md)
- [Pi provider design](/specs/2026-06-25-pi-coding-agent-support-design.md)
- [Pi provider guide](/providers/pi.md)
- [E2E test catalog](/guides/e2e-test-catalog.md)
