# AGENTS.md

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
  - For CI parity before push, also run `vp run test` and `vp run release:smoke` (matches GitHub Actions **Test** and **Release Smoke** jobs).
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Feature Validation

Prove each acceptance criterion for user-facing features before marking work complete.

1. **Manual validation with `playwright-cli`:** Launch the running app, walk through each
   acceptance criterion interactively, and capture snapshots that confirm the expected behavior.

   ```bash
   playwright-cli open http://localhost:5733   # web
   playwright-cli snapshot                     # capture state at each step
   ```

   For Electron flows, use `playwright-cli attach --cdp=chrome` against the dev app.

2. **Author E2E tests:** After manual validation, encode each proven criterion as a Playwright
   test under `e2e/tests/`. Follow the local `kata-code-e2e-testing` skill when installed — compose from `e2e/src/harness/`
   and `e2e/src/flows/`, tag with the relevant feature tag, and verify with:

   ```bash
   vp run e2e --project desktop-dev --grep @your-tag
   ```

3. **Coverage gate:** Every acceptance criterion in the spec must have a corresponding assertion
   in at least one E2E test. If a criterion cannot be automated (e.g., subjective visual quality),
   document the manual verification in the PR description.

## Git Workflow

- **Commit proactively:** After each meaningful, complete change, commit immediately. Do not ask whether to commit—just commit and keep moving.
- **Atomic commits:** One logical change per commit. Stage only related files; never batch unrelated work into one commit.
- **Clean worktree:** End each scoped task with `git status` clean. Commit or revert before starting unrelated work.
- **Never commit secrets:** Exclude `.env`, credentials, and other local-only files.

## Quick Start

```bash
vp i
vp run --filter @kata-sh/code-desktop ensure:electron   # first time / fresh worktree
pnpm run dev              # web (contracts + web + server)
pnpm run dev:desktop      # Electron desktop
```

Default dev ports: web `5733`, server `13773`. Offset with `KATACODE_DEV_INSTANCE` or `KATACODE_PORT_OFFSET`.

## Project Snapshot

Kata Code is a hard fork of [T3 Code](https://github.com/pingdotgg/t3code) — a minimal
web GUI for using coding agents like Codex and Claude.

- **Repo:** `gannonh/kata-code` · **npm scope:** `@kata-sh/code-*` · **CLI:** `katacode` (`@kata-sh/code-cli`)
- **Env prefix:** `KATACODE_*` · **State dir:** `~/.katacode` (override with `KATACODE_HOME`)
- **Protocols:** `katacode://` / `katacode-dev://` · **Desktop bundle:** `com.katacode.app`

Read [FORK.md](./FORK.md) before upstream merges, branding changes, or release/CI work.
This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term
maintainability is encouraged.

## Fork Gotchas

- Do not reintroduce `@t3tools/*`, `T3CODE_*`, or upstream product strings without an explicit decision in `FORK.md`.
- Kata Code is a hard fork: no migration from upstream `~/.t3` state. Do not add legacy-T3 detection or migration affordances.
- User-facing identity constants (protocols, hosted pairing, worktree prefix) live in `packages/shared/src/branding.ts` — do not hardcode upstream `app.t3.codes` or `t3code://` for product surfaces.
- Electron `path.txt missing` after fresh install → run `ensure:electron` (see Quick Start).
- **Brand icons:** master raster is `apps/desktop/resources/source.png`. Run `pnpm run generate:brand-rasters` after icon changes — syncs `assets/prod/*`, `apps/web/public/*`, and desktop platform icons via `generate-icons.sh`. Icon paths live in `scripts/lib/brand-assets.ts`; all channels (dev, nightly, production) use production Kata artwork (no upstream blueprint icons).
- **Desktop release packaging:** `electron-builder` `afterPack` hooks resolve relative to `apps/desktop`, not the staged `--projectDir`. Use `scripts/electron-after-pack.cjs` in build config; macOS Liquid Glass `Assets.car` is copied from `apps/desktop/resources/liquid-glass/`.
- **Desktop dev launcher:** cached `Kata Code (Dev).app` can keep a stale `VITE_DEV_SERVER_URL` if ports shift — `electron-launcher.mjs` refreshes the launcher script on each dev start.
- **CI:** PR checks run from [`.github/workflows/ci.yml`](./.github/workflows/ci.yml). Require **Check**, **Test**, **Test Browser**, **Release Smoke**, and **Mobile Native Static Analysis** on `main` — see [branch protection](./docs/operations/ci.md#branch-protection-main). **Release** ([`release.yml`](./.github/workflows/release.yml)) runs on tags/`workflow_dispatch`, not PRs. Relay deploy and mobile EAS remain in [`.github/disabled/`](./.github/disabled/README.md).
- **Hosted web:** `apps/web` deploys to Vercel (`katacode-web`, root `apps/web`). Domains: `app.kata.sh`, `latest.app.kata.sh`, `nightly.app.kata.sh`. `apps/web/vercel.ts` inlines branding constants — Vercel compiles config before the monorepo build; keep in sync with `packages/shared/src/branding.ts`.
- **Release secrets:** see [release setup](./docs/operations/release-setup.md). Day-to-day releases: [release runbook](./docs/operations/release.md).
- **Upstream sync:** episodic merges only — no parity with `upstream/main`. Read [FORK.md](./FORK.md) and [upstream sync guide](./docs/guides/upstream-sync.md) before merging `upstream`; log rejects in the divergence log. Keep fork-only code in extension modules ([FORK.md — Phase 4](./FORK.md#phase-4--divergence-boundaries)).
- **Fork tests:** rename product surfaces (`katacode`, `KATACODE_*`, worktree prefix `katacode/`) but keep upstream-shaped repo names in fixtures (`octocat/t3code` → clone dir `t3code`). See [fork rebrand test fixtures](./docs/operations/ci.md#fork-rebrand-test-fixtures).

## Open Knowledge Format docs

This repository maintains an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle at `./docs`.

- Use `/okf read` when available, or read [`./docs/index.md`](./docs/index.md) directly before substantial work, to understand the current documentation map.
- Follow cross-links into relevant specs, ADRs, runbooks, guides, architecture notes, reference docs, and domain docs before changing related code.
- Keep [`./docs/specs/index.md`](./docs/specs/index.md) current as the roadmap for active, planned, blocked, completed, and deferred work.
- When specs defer work that should survive beyond the spec, record or update it in [`./docs/specs/deferred-work.md`](./docs/specs/deferred-work.md) with a source link and revisit trigger.
- Add or update ADRs in [`./docs/adrs`](./docs/adrs) for durable architecture decisions.
- After substantial work, PRs, behavior changes, architecture decisions, migrations, or documentation moves, update the OKF bundle and add concise entries to the relevant `log.md` files; during `/okf update`, review deferred-work entries related to changed areas.
- Maintain Markdown cross-links between related OKF concepts so future agents can traverse decisions, specs, architecture, runbooks, guides, and references.
- Every non-reserved Markdown file under `./docs` should have OKF frontmatter with at least a non-empty `type` field. `index.md` and `log.md` are reserved navigation/history files.

## Communication

- **Answer first.** Lead with the direct answer in the fewest words that are still correct.
- **Match depth to the question.** Procedural questions ("what's next?", "what order?") get a short numbered list. Do not add architecture, diagrams, caveats, or doc links unless asked or the answer would be wrong without them.
- **Say it once.** Do not restate the same point in prose, bullets, and a summary.
- **Do not say what not to do.** State the answer or the recommended path only. Avoid negation lists, "don't" sections, and ruling out alternatives the user did not ask about.
- **Expand on request.** Add rationale, tradeoffs, or links only when the user asks why, or when ambiguity would cause a wrong action.
- **One path by default.** Prefer a single recommended sequence over multiple options with long comparisons.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions. CLI entry: `katacode`.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `apps/desktop`: Electron shell; spawns embedded server in dev. Branding constants in `packages/shared/src/branding.ts`.
- `apps/mobile`: Expo/React Native client (shares `packages/client-runtime`).
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@kata-sh/code-shared/git`, `@kata-sh/code-shared/branding`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.
- `oxlint-plugin-kata-code`: Custom oxlint rules (`kata-code/*`); referenced from root `vite.config.ts`.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.
