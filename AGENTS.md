# AGENTS.md

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
  - For CI parity before push, also run `vp run test` (matches the GitHub Actions Test job).
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Quick Start

```bash
vp i
vp run --filter @kata-sh/code-desktop ensure:electron   # first time / fresh worktree
pnpm run dev              # web (contracts + web + server)
pnpm run dev:desktop      # Electron desktop
```

Default dev ports: web `5733`, server `13773`. Offset with `KATACODE_DEV_INSTANCE` or `KATACODE_PORT_OFFSET`.

## Project Snapshot

KataCode is a hard fork of [T3 Code](https://github.com/pingdotgg/t3code) — a minimal
web GUI for using coding agents like Codex and Claude.

- **Repo:** `gannonh/katacode` · **npm scope:** `@kata-sh/code-*` · **CLI:** `katacode` (`@kata-sh/code-cli`)
- **Env prefix:** `KATACODE_*` · **State dir:** `~/.katacode` (override with `KATACODE_HOME`)
- **Protocols:** `katacode://` / `katacode-dev://` · **Desktop bundle:** `com.katacode.app`

Read [FORK.md](./FORK.md) before upstream merges, branding changes, or release/CI work.
This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term
maintainability is encouraged.

## Fork Gotchas

- Do not reintroduce `@t3tools/*`, `T3CODE_*`, or upstream product strings without an explicit decision in `FORK.md`.
- `~/.t3` data is not auto-migrated; server warns on startup. Use `KATACODE_HOME=~/.t3` temporarily if you need old state.
- User-facing identity constants (protocols, hosted pairing, worktree prefix) live in `packages/shared/src/branding.ts` — do not hardcode upstream `app.t3.codes` or `t3code://` for product surfaces.
- Electron `path.txt missing` after fresh install → run `ensure:electron` (see Quick Start).
- Brand icon rasters must use ImageMagick `-background none` — run `pnpm run generate:brand-rasters` after SVG changes.
- **CI:** PR checks run from `.github/workflows/ci.yml`. Release, relay deploy, and mobile EAS live in `.github/disabled/` until Phase 2 — do not gate with branch-name `if:` skips; move whole workflows instead. See [docs/operations/ci.md](./docs/operations/ci.md).
- **Fork tests:** rename product surfaces (`katacode`, `KATACODE_*`, worktree prefix `katacode/`) but keep upstream-shaped repo names in fixtures (`octocat/t3code` → clone dir `t3code`). See [fork rebrand test fixtures](./docs/operations/ci.md#fork-rebrand-test-fixtures).

## Open Knowledge Format docs

This repository maintains an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle at `./docs`.

- Use `/okf read` when available, or read [`./docs/index.md`](./docs/index.md) directly before substantial work, to understand the current documentation map.
- Follow cross-links into relevant specs, ADRs, runbooks, guides, architecture notes, reference docs, and domain docs before changing related code.
- Keep [`./docs/specs/index.md`](./docs/specs/index.md) current as the roadmap for active, planned, blocked, and completed work.
- Add or update ADRs in [`./docs/adrs`](./docs/adrs) for durable architecture decisions.
- After substantial work, PRs, behavior changes, architecture decisions, migrations, or documentation moves, update the OKF bundle and add concise entries to the relevant `log.md` files.
- Maintain Markdown cross-links between related OKF concepts so future agents can traverse decisions, specs, architecture, runbooks, guides, and references.
- Every non-reserved Markdown file under `./docs` should have OKF frontmatter with at least a non-empty `type` field. `index.md` and `log.md` are reserved navigation/history files.

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
