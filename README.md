# KataCode

KataCode is a hard fork of [T3 Code](https://github.com/pingdotgg/t3code) — a minimal web GUI for coding agents (Codex, Claude, Cursor, OpenCode, and more).

This repository is maintained independently at [gannonh/katacode](https://github.com/gannonh/katacode). See [FORK.md](./FORK.md) for fork operations, upstream sync, and intentional divergence.

## Installation

> [!WARNING]
> KataCode currently supports Codex, Claude, Cursor, and OpenCode.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `cursor-agent login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Run from source (development)

```bash
vp i
vp run --filter @kata-sh/code-desktop ensure:electron   # first time / fresh worktree
pnpm run dev              # web
pnpm run dev:desktop      # Electron desktop
```

### CLI (when published)

```bash
npx @kata-sh/code-cli@latest
# or, after global install:
katacode --help
```

Desktop releases will be published from [gannonh/katacode releases](https://github.com/gannonh/katacode/releases) once Phase 2 CI/release split is complete.

## Status

Very early WIP. Expect bugs. Contributions are welcome on the fork — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Documentation

- [OKF docs bundle](./docs/index.md)
- [Fork setup & upstream sync](./FORK.md)
- [Getting started](./docs/getting-started/quick-start.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Provider guides](./docs/providers/codex.md)
- [Operations](./docs/operations/ci.md)
- [Reference](./docs/reference/encyclopedia.md)

## Development

KataCode uses [Vite+](https://viteplus.dev/) (`vp`) for the monorepo toolchain.

```bash
# macOS / Linux
curl -fsSL https://vite.plus | bash

# verify
vp check
vp run typecheck
```

Agent instructions: [AGENTS.md](./AGENTS.md)

## Attribution

KataCode is derived from [T3 Code](https://github.com/pingdotgg/t3code) (MIT). Upstream copyright and license notices are retained in files with substantial derived code. See `THIRD_PARTY_NOTICES.md` in app packages.
