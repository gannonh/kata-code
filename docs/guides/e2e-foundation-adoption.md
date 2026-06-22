---
type: Guide
title: "Adopting the local Electron E2E foundation"
description: "Implementation guide for Kata Agents and Skillr App (and future Electron repos) to adopt the Kata Code Playwright E2E pattern."
tags: [testing, e2e, electron, playwright, adoption, kata-agents, skiller]
timestamp: 2026-06-22T12:00:00Z
---

# Adopting the local Electron E2E foundation

This guide helps **Kata Agents** (`/Volumes/EVO/dev/kata-agents`) and **Skillr App** (`/Volumes/EVO/dev/skiller-app`) adopt the same local Playwright Electron E2E foundation proven on **Kata Code** (`feat/e2e-testing-foundation`).

**Reference implementation (copy from here):**

| Artifact                          | Path in Kata Code                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Operator README                   | [`e2e/README.md`](../../e2e/README.md)                                                                           |
| Design spec + acceptance criteria | [`docs/specs/2026-06-21-e2e-testing-foundation-design.md`](../specs/2026-06-21-e2e-testing-foundation-design.md) |
| Agent authoring skill             | [`.agents/skills/e2e-test-author/SKILL.md`](../../.agents/skills/e2e-test-author/SKILL.md)                       |
| Shared port contract              | [`scripts/lib/dev-ports.ts`](../../scripts/lib/dev-ports.ts)                                                     |
| Harness + flows + starter specs   | [`e2e/`](../../e2e/)                                                                                             |

---

## What you are adopting

A **local-only**, **macOS-first** Playwright suite that:

1. Launches the **real Electron app** (dev build or packaged `.app`).
2. Uses **real services** — no Playwright `route().fulfill()`, MSW, or fake backends in E2E specs.
3. Keeps **run isolation** — temp app home, unique ports, artifact manifest per run.
4. Separates **harness** (process/launch/ports) from **flows** (product UI steps).
5. Stays **out of CI in V1** — maintainer/nightly validation on a macOS GUI machine.

Skillr already has Playwright **renderer CI tests** (`playwright.config.ts` + `e2e/skiller.spec.ts`). That pattern stays valuable for fast CI. This foundation adds a **second layer**: full Electron + real IPC/filesystem for pre-release confidence.

---

## Architecture (do not fight this)

```text
e2e/
  playwright.config.ts
  README.md
  src/
    harness/          # Generic Electron/process/isolation — no product selectors
    flows/              # Product UI workflows (auth, settings, library, chat, …)
    assertions/         # Launch health only (fatal bootstrap errors)
    config/             # Timeouts, tags, env loading
  tests/
    setup/              # Playwright project dependencies (Clerk setup, dirs, …)
    smoke/              # @smoke — launch + shell
    …                   # @settings, @agent, etc.
```

### Fixture layers (critical)

| Fixture                  | Responsibility                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `launchedApp`            | Technical launch: dev stack (if needed), Electron boot, renderer window, fatal-error listeners |
| `appWindow`              | Shell readiness (pairing/onboarding cleared, main UI marker visible)                           |
| `authenticatedAppWindow` | Opt-in Clerk sign-in + signed-in assertion (or product equivalent)                             |

**Do not** fold shell/auth waits into `launchApp`. Specs choose the fixture depth they need.

### Dependency direction

```text
tests → fixtures → harness
tests → flows
flows → harness (readiness, env helpers)
assertions → (launch health only; never re-export flows)
```

Never: `harness → flows` or `flows → assertions`.

---

## Learnings from Kata Code (read before copying)

These came from the first adoption and a strict quality review. Skipping them causes subtle, painful failures.

### 1. Port offset must be the **allocated** offset

When probing for free ports, store the **found** offset in env — not the probe start offset.

```typescript
// ✅ Correct
const { offset: startOffset } = resolveStartOffsetFromEnv();
const { offset, serverPort, webPort } = await findAvailablePortOffset(startOffset);
devEnv.KATACODE_PORT_OFFSET = String(offset); // allocated

// ❌ Wrong — dev-runner binds default web port while harness waits on allocated port
const { offset: startOffset } = resolveStartOffsetFromEnv();
const { serverPort, webPort } = await findAvailablePortOffset(startOffset);
devEnv.KATACODE_PORT_OFFSET = String(startOffset);
```

**Symptom:** `Port 5733 is already in use` while logs show `web=5736`.

**Fix:** Reuse one port module shared with your dev runner ([`scripts/lib/dev-ports.ts`](../../scripts/lib/dev-ports.ts)) so E2E and dev scripts agree on probe hosts and offset semantics.

### 2. One owner for dev-stack env vars

`PORT`, `VITE_*`, and server port env must be built in **one** helper (Kata Code: `devStackEnv.ts`) and consumed by both dev-runner spawn and Electron launch env. Duplicating keys in two files drifts quickly.

### 3. Playwright owns Electron — do not run full `dev:desktop`

Spawning your normal desktop dev script often **also** launches Electron. E2E should start **Vite (or renderer) only**, then `_electron.launch()` once. Otherwise: duplicate backends, EPIPE, token races.

### 4. Release launches must strip dev-only env

Packaged apps load from an **embedded server**, not Vite. Strip `VITE_DEV_SERVER_URL`, dev `PORT`, etc. for the `desktop-release` project (see [`launchEnv.ts`](../../e2e/src/harness/launchEnv.ts)).

### 5. Use raw Electron binary in dev, not the macOS `.app` shim

Kata Code uses `electron-launcher.mjs` → raw binary when Playwright passes `main.cjs`. The `.app` dev wrapper can exit early on auth-callback shims.

### 6. Default npm script targets one Playwright project

Bare `pnpm run e2e` / `vp run e2e` should default to `--project desktop-dev`. A second `desktop-release` project matching all specs doubles every test.

### 7. Explore UI on the real harness before codifying selectors

Use `e2e:ui` / `PWDEBUG=1` + headed runs. Prefer role/label locators; add `data-testid` in product code only as a deliberate contract.

### 8. Fail loudly on missing prerequisites

Missing API keys, auth env, or release app path → throw with the variable name and a pointer to `e2e/README.md`. Never skip assertions silently.

### 9. Authenticated mutable tests → `workers: 1`

Until you have isolated test accounts per worker, keep one worker for flows that mutate shared server state.

### 10. Keep CI renderer tests separate (Skillr)

Do not delete fast Chromium + preview-API tests. Add Electron E2E as **local/nightly** validation, not a replacement for CI unless you later invest in macOS CI runners.

---

## Adoption checklist (both projects)

Work in order. Each phase should leave the repo in a runnable state.

### Phase 0 — Decision record (½ day)

- [ ] Add an OKF spec under `docs/specs/` (copy structure from Kata Code design spec).
- [ ] Record V1 constraints: local-only, macOS, no service mocks, 2–3 starter tests.
- [ ] List product-specific env vars (prefix table below).
- [ ] Choose starter tags: at minimum `@smoke`; add `@settings` or product equivalent.

### Phase 1 — Scaffold (1 day)

- [ ] Copy `e2e/` tree from Kata Code; rename env prefix (`KATACODE_*` → `CRAFT_*` / `SKILLER_*`).
- [ ] Add `@playwright/test` devDependency and root scripts: `e2e`, `e2e:headed`, `e2e:ui`, `e2e:release`.
- [ ] Gitignore: `e2e/.auth/`, `e2e/test-results/`, `e2e/playwright-report/`.
- [ ] Add `.env.example` entries for E2E-only vars.
- [ ] Wire `e2e/src/config/loadEnv.ts` to load root `.env` / `.env.local`.

### Phase 2 — Harness adaptation (2–3 days)

- [ ] **Port module:** extract or import shared `dev-ports` logic; wire isolated run to set **allocated** offset in env.
- [ ] **Isolated app home:** temp dir via product config env (`CRAFT_CONFIG_DIR`, `SKILLER_HOME`, etc.).
- [ ] **Dev stack spawn:** script that starts renderer/Vite only with `--port` / `--dev-url` matching allocated ports.
- [ ] **Electron launch:** `executablePath` + `args` for dev; `KATACODE_E2E_RELEASE_APP`-style var for release `.app`.
- [ ] **Build gate:** assert desktop main/preload artifacts exist before launch (Kata Code: `desktopArtifacts.ts`).
- [ ] **Artifacts:** run manifest with run id, ports, home dir, workspace seed path.
- [ ] **Fixtures:** `launchedApp`, `appWindow`, optional `authenticatedAppWindow`.

### Phase 3 — Product flows (2–3 days)

- [ ] Implement `shell.ts` — one canonical “main UI visible” wait (product-specific marker).
- [ ] Implement auth/onboarding flow if needed (Clerk ticket, token, or skip for offline products).
- [ ] Add 2–3 starter specs with tags; keep spec bodies thin.
- [ ] Add `.agents/skills/e2e-test-author/SKILL.md` (adapt from Kata Code).
- [ ] Document commands in `e2e/README.md` and link from `AGENTS.md`.

### Phase 4 — Verification (1 day)

- [ ] Two sequential `@smoke` runs → different ports/homes in manifests.
- [ ] Release smoke against a locally built `.app` (when packaging exists).
- [ ] `vp check` / `pnpm typecheck` + unit tests on harness modules (`vitest` in `e2e/src/**/*.test.ts`).
- [ ] Headed walkthrough recorded in spec build report.

**Do not** add E2E to CI until macOS runner strategy is explicit.

---

## Project-specific: Kata Agents

**Repo:** `/Volumes/EVO/dev/kata-agents` · **Runtime:** Bun · **Desktop:** `apps/electron` · **Config:** `~/.craft-agent` (`CRAFT_CONFIG_DIR`)

### Current testing landscape

| Layer         | Today                      |
| ------------- | -------------------------- |
| Unit          | `bun test` across packages |
| Desktop smoke | Manual / `electron:start`  |
| E2E           | **None**                   |

### Recommended env mapping

| Kata Code                  | Kata Agents (proposed)                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `KATACODE_HOME`            | `CRAFT_CONFIG_DIR` (temp dir per run)                                                                   |
| `KATACODE_PORT_OFFSET`     | `CRAFT_PORT_OFFSET` or reuse existing instance scheme                                                   |
| Vite web port              | `CRAFT_VITE_PORT` (already used in `electron-dev.ts`)                                                   |
| Server/API port            | RPC default `9100` — allocate offset pair if colliding                                                  |
| `KATACODE_E2E_RELEASE_APP` | `CRAFT_E2E_RELEASE_APP` → path to built `.app` / `.dmg` mount                                           |
| Clerk Google test user     | **N/A V1** — auth is credentials/API keys in `~/.craft-agent`; use onboarding skip or pre-seeded config |
| `@agent` LLM test          | Real provider key in env (`CRAFT_ANTHROPIC_API_KEY`, etc.)                                              |

### Dev launch adaptation

`bun run electron:dev` (`scripts/electron-dev.ts`) spawns **Vite + Electron + subprocess servers** together. For E2E:

1. Add `scripts/electron-e2e-dev.ts` (or harness module) that mirrors **Vite-only** startup from `electron-dev.ts` (port from allocated `CRAFT_VITE_PORT`).
2. Playwright launches Electron with the same env `electron-dev` would use, but as the **only** Electron instance.
3. Set `CRAFT_CONFIG_DIR` to a temp directory under `mkdtemp` for each run (pattern already used in `packages/shared` config tests).

### Existing multi-instance logic

`electron-dev.ts` already supports instance suffixes (`CRAFT_VITE_PORT`, `CRAFT_CONFIG_DIR`). **Reuse this scheme** inside E2E rather than inventing a second port story.

### Suggested starter tests

| Tag         | Flow                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------- |
| `@smoke`    | Launch → main window → session list or empty state visible                                |
| `@settings` | Open settings → change appearance or language → persist after reload                      |
| `@agent`    | Create session → send deterministic prompt → assert exact assistant reply (real provider) |

### Build prerequisites

```bash
bun run ensure:electron
bun run electron:build
```

### Commands (after adoption)

```bash
bun run e2e --list
bun run e2e:headed --project desktop-dev --grep @smoke
CRAFT_E2E_RELEASE_APP="/Applications/Kata Agents.app" bun run e2e:release --grep @smoke
```

### Kata Agents pitfalls

- **i18n:** flow locators may need `t()`-backed visible strings; prefer test ids for shell markers if translations shift.
- **Bundled uv / MCP subprocesses:** ensure E2E env points at built `session-mcp-server` / `pi-agent-server` artifacts (same as dev).
- **Identity unchanged in Phase 1 rebrand:** keep `CRAFT_*`, `~/.craft-agent`, `craftagents://` — do not rename in E2E until a dedicated rebrand spec says so.

---

## Project-specific: Skillr App

**Repo:** `/Volumes/EVO/dev/skiller-app` · **Runtime:** pnpm · **Desktop:** `apps/desktop` · **Library:** `~/skiller` (configurable)

### Current testing landscape

| Layer             | Today                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------- |
| Unit              | Vitest in packages + desktop                                                          |
| CI E2E            | Playwright **Chromium** against Vite preview + **`window.skiller` preview API** mocks |
| Full Electron E2E | **None**                                                                              |

### Two-layer strategy (recommended)

```text
e2e/
  playwright.config.ts          # existing — keep as renderer-ci OR move to e2e/renderer/
  skiller.spec.ts               # fast CI — preview API, no Electron
  src/harness/ …                # NEW — Electron launch + isolation
  tests/smoke/ …                # NEW — local @smoke against real IPC
```

| Project (Playwright) | Purpose                                                                       | CI                       |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------ |
| `renderer-ci`        | Current `skiller.spec.ts` — mock `window.skiller`, Vite on `SKILLER_E2E_PORT` | ✅ Keep in `pnpm check`  |
| `desktop-dev`        | Electron + real `@skiller/core` + temp library dir                            | ❌ Local only V1         |
| `desktop-release`    | Packaged `.app`                                                               | ❌ Nightly / pre-release |

Refactor `playwright.config.ts` into **projects** rather than replacing existing tests.

### Recommended env mapping

| Kata Code       | Skillr (proposed)                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `KATACODE_HOME` | Temp library parent + config (override `libraryPath` in seeded config)                              |
| Vite port       | Reuse `SKILLER_E2E_PORT` / `SKILLER_DEV_PORT` — align with `apps/desktop/src/main/dev-server.ts`    |
| Release app     | `SKILLER_E2E_RELEASE_APP`                                                                           |
| Auth            | **None** — desktop is local-first; no Clerk in V1                                                   |
| `@agent`        | **Optional later** — registry/GitHub install flows use network; start with filesystem/library flows |

### Dev launch adaptation

- `pnpm dev` → builds core + launches Electron via `dev-server.js` (finds port, spawns Vite, opens window).
- E2E should either:
  - **Option A (preferred):** Playwright calls `_electron.launch()` with built `dist/main/main.js`, env pointing at an isolated Vite port (spawn Vite separately like Kata Code), **or**
  - **Option B:** Wrap existing `dev-server.js` but prevent double-Electron — harder to control.

Reuse `findAvailablePort` from `dev-server.ts` or extract to `scripts/lib/dev-ports.ts` for parity.

### Suggested starter tests

| Tag         | Flow                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `@smoke`    | Launch Electron → Library page → “Installed master skills” or empty library                      |
| `@library`  | Seed temp skill dir → rescan → row visible (real filesystem, real IPC)                           |
| `@settings` | Change library path in settings → save → persists (extends existing renderer test to full stack) |

Port existing renderer scenarios to Electron **incrementally** — only where IPC/integration risk justifies it.

### Build prerequisites

```bash
pnpm install
pnpm --filter @skiller/core --filter @skiller/desktop build
pnpm exec playwright install
```

### Commands (after adoption)

```bash
pnpm test:e2e                    # renderer-ci only (unchanged behavior)
pnpm run e2e:headed --grep @smoke   # new local Electron smoke
SKILLER_E2E_RELEASE_APP="/Applications/Skiller.app" pnpm run e2e:release --grep @smoke
```

### Skillr pitfalls

- **Preview API vs IPC:** renderer tests stub `window.skiller`; Electron E2E must use **real preload IPC**. Do not copy `addInitScript` mocks into Electron specs.
- **Strict port in CI renderer config:** `reuseExistingServer: false` is good; Electron harness needs the same strictness per run.
- **Pre-push hook:** `check:pre-push` intentionally skips e2e; keep Electron E2E out of pre-push until runtime is stable.

---

## File-by-file copy map (Kata Code → your repo)

Copy and rename prefixes/constants. Adjust import paths to your monorepo layout.

| Kata Code file                    | Adapt                                          |
| --------------------------------- | ---------------------------------------------- |
| `e2e/playwright.config.ts`        | Projects, timeouts, default `desktop-dev`      |
| `e2e/src/harness/isolatedRun.ts`  | App home env var, port allocation              |
| `e2e/src/harness/ports.ts`        | Re-export your shared `dev-ports` module       |
| `e2e/src/harness/devStack.ts`     | Dev runner args for **your** Vite-only command |
| `e2e/src/harness/devStackEnv.ts`  | Product env shape                              |
| `e2e/src/harness/appLaunch.ts`    | Electron entrypoint paths, launcher script     |
| `e2e/src/harness/launchEnv.ts`    | Release env stripping rules                    |
| `e2e/src/harness/testFixtures.ts` | Fixture chain                                  |
| `e2e/src/harness/readiness.ts`    | TCP/Vite wait helpers                          |
| `e2e/src/harness/processSpawn.ts` | Artifact logging                               |
| `e2e/src/harness/env.ts`          | Prerequisite readers                           |
| `e2e/src/flows/shell.ts`          | **Rewrite** — your shell marker                |
| `e2e/src/flows/pairing.ts`        | **Rewrite or delete** if no pairing gate       |
| `e2e/src/flows/auth.ts`           | **Rewrite or omit**                            |
| `e2e/tests/smoke/*.spec.ts`       | First green test                               |
| `scripts/lib/dev-ports.ts`        | Share with dev scripts                         |

---

## Verification matrix (copy into your spec)

| Area               | Command                                            | Pass                               |
| ------------------ | -------------------------------------------------- | ---------------------------------- |
| List tests         | `… e2e --list`                                     | Shows tagged starter tests         |
| Dev smoke          | `… e2e:headed --project desktop-dev --grep @smoke` | exit 0, manifest written           |
| Isolation          | Two sequential smokes                              | Different ports/homes in manifests |
| Release smoke      | `…_E2E_RELEASE_APP=… e2e:release --grep @smoke`    | exit 0 or clear missing-path error |
| Harness unit tests | `vitest e2e/src/harness` or `bun test`             | all pass                           |
| Static             | typecheck + lint                                   | no regressions                     |
| CI unchanged       | existing renderer/CI job                           | still green (Skillr)               |

---

## Rollout order for maintainers

1. **`@smoke`** headed — prove launch + shell marker.
2. **One authenticated or data-mutating flow** (if applicable) — prove fixtures + `workers: 1`.
3. **One real-service integration** (LLM, GitHub install, library scan) — prove env prerequisites.
4. **Release target** — validate packaged `.app` before promotion.
5. Document nightly commands in release runbook (mirror Kata Code [`e2e/README.md` — Nightly release validation](../../e2e/README.md)).

---

## When to extract a shared npm package

Stay copy-adapt until **three** repos share identical harness code with only config tables differing. Until then, duplicated `e2e/src/harness/` with clear boundaries is cheaper than premature `@kata-sh/e2e-electron`.

---

## Related docs

- [E2E foundation design spec](../specs/2026-06-21-e2e-testing-foundation-design.md)
- [e2e/README.md](../../e2e/README.md)
- [e2e-test-author skill](../../.agents/skills/e2e-test-author/SKILL.md)
