# Guides log

## 2026-07-14 (Recorded web E2E isolation)

Updated the [E2E test catalog](/guides/e2e-test-catalog.md) so recorded web specs use the standard isolated `web-dev` fixture and authenticated app page.

## 2026-07-10 (Vercel worktree base ref)

Updated [Repository environment configuration](/user/repository-environment-config.md) to document that Kata attaches Vercel's selected source revision to a local branch, providing New worktree with its base ref.

## 2026-07-10 (Repository environment configuration)

Added [Repository environment configuration](/user/repository-environment-config.md), a user reference for `.kata/environment.json`: supported setup fields, an example, per-field precedence over saved Settings values, Vercel and Docker paths, lifecycle behavior, and secret handling. Linked it from the User section of the [guides index](/guides/index.md).

## 2026-07-01 (E2E test catalog — Cursor gates correction)

- Corrected the [E2E test catalog](/guides/e2e-test-catalog.md#cursor-e2e-gates) Cursor E2E gates section (added in `feat/cursor-skills`) to include the required `KATACODE_E2E_CURSOR_API_KEY` env var alongside `KATACODE_E2E_ENABLE_CURSOR` and `KATACODE_E2E_CURSOR_MODEL`. The `@cursor` flow (`e2e/src/flows/cursorSkills.ts`) authenticates the Cursor Agent CLI via API key, which skips interactive OAuth; the API key is a hard requirement in `readCursorSkillsConfig`.

## 2026-06-27 (E2E test catalog — Pi finalize harness notes)

- [E2E test catalog](/guides/e2e-test-catalog.md): documented per-file shared Electron session model, `pnpm run e2e:clean` for leaked dev servers, and credentialed `@pi` gate env vars with a link to [verification evidence](../../e2e/verify-evidence/README.md).

## 2026-06-26 (E2E test catalog — web test authentication update)

- Updated the web section of [E2E test catalog](/guides/e2e-test-catalog.md): replaced the "Web codegen" stub with a full "Web E2E" section documenting the `web-dev` Playwright project, authenticated browser fixture, run commands for both main and codegen configs, and a code example for writing new web tests.

## 2026-06-25 (mobile E2E Maestro Studio authoring guide)

- Added [Mobile E2E authoring (Maestro Studio)](/guides/e2e-mobile-authoring-maestro-studio.md) — canonical guide consolidating scattered Studio/locator/flow-authoring guidance from READMEs, design spec, local dev guide, test catalog, and authoring skill. Linked from [guides index](/guides/index.md) Testing section, [E2E test catalog](/guides/e2e-test-catalog.md), [mobile local dev guide](/guides/mobile-local-dev-ios-simulator.md), [mobile E2E design spec](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md), [mobile-e2e README](../../mobile-e2e/README.md), and [mobile-e2e-test-author skill](../../.agents/skills/mobile-e2e-test-author/SKILL.md).

## 2026-06-25 (E2E test catalog)

- Added [E2E test catalog](/guides/e2e-test-catalog.md) — single index of every desktop ([`e2e/tests/`](../../e2e/tests/)) and mobile ([`mobile-e2e/maestro/`](../../mobile-e2e/maestro/)) E2E test with tags and run commands; consolidates inventory that was scattered across READMEs and design specs. Linked from [guides index](/guides/index.md) Testing section.

## 2026-06-24 (mobile local dev guide — automated E2E cross-links + command fixes)

- Added "Automated E2E" section to [Mobile local dev (iOS Simulator)](/guides/mobile-local-dev-ios-simulator.md) mapping the three manual dev terminals to what the mobile E2E harness automates vs checks, with commands and cross-links to the [design spec](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md), [operator reference](../../mobile-e2e/README.md), and [authoring skill](../../.agents/skills/mobile-e2e-test-author/SKILL.md).
- Fixed `katacode serve` prose to use the actual command (`node apps/server/dist/bin.mjs`).
- Fixed `-- --` arg-passing syntax in all e2e:mobile commands (vp run doesn't use `--` for args).
- Added note that e2e commands run from the repo root, not `apps/mobile`.
- Expanded "Related docs" with the design spec and operator reference links.

## 2026-06-23 (mobile local dev guide — cache clearing and env scoping)

- Updated [Mobile local dev (iOS Simulator)](/guides/mobile-local-dev-ios-simulator.md) to document the cache-clearing script (`clear-expo-image-cache.mjs`) and correct `APP_VARIANT`/`EXPO_NO_GIT_STATUS` env var scoping in the `ios:dev` command (PR #9 review fix).

## 2026-06-22 (mobile local dev iOS Simulator)

- Added [Mobile local dev (iOS Simulator)](/guides/mobile-local-dev-ios-simulator.md) — dev client build, `katacode serve` + `project add`, manual loopback pairing, thread loop; linked from [guides index](/guides/index.md).

## 2026-06-22 (E2E adoption guide)

- Added [E2E foundation adoption](/guides/e2e-foundation-adoption.md) for Kata Agents and Skillr App rollouts (architecture, learnings, per-repo checklists).

## 2026-06-21 (local Electron E2E cross-links)

- Added Testing section to [guides index](/guides/index.md) linking [e2e/README](../../e2e/README.md) and the [E2E foundation design spec](/specs/2026-06-21-e2e-testing-foundation-design.md).

## 2026-06-20 (upstream-sync runbook rewrite)

- Rewrote [upstream-sync guide](/guides/upstream-sync.md) as the canonical selective-sync runbook (bulk-merge default, classifier + conflict-zone steps, fork-policy resolution rules, verify gates). Mirrors the new `.agents/skills/upstream-sync/SKILL.md`; helper scripts are bundled inside the skill at `.agents/skills/upstream-sync/scripts/`.

## 2026-06-17 (upstream sync)

- Added [upstream sync guide](/guides/upstream-sync.md) for selective T3 Code merges; links [ADR 0003](/adrs/0003-episodic-upstream-sync.md) and [FORK.md — Phase 3](../../FORK.md#phase-3--upstream-sync-runbook).

## 2026-06-16

- Added guides index linking `getting-started/`, `user/`, `providers/`, `cloud/`, and `integrations/`.
