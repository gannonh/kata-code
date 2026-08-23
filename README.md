# Kata Code

Kata Code is an "agent harness control surface". It enables control of the agents on your machine with a [web app](https://app.kata.sh) and an Electron desktop app.

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, and OpenCode. If they're set up on your computer, Kata Code can control them.

## Installation

> [!WARNING]
> Kata Code currently supports Codex, Claude, Cursor, Grok Build and OpenCode. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Try it out (install-free)

The easiest way to test Kata Code is to run the server in your terminal (requires Node.js 22.16+, 23.11+, or 24.10+):

```bash
npx @kata-sh/code-cli@latest
```

This will launch Kata Code's backend on your machine as well as the local web app to control your agents.

Tip: Use `npx @kata-sh/code-cli@latest --help` for the full CLI reference.

### Test a headless remote environment

Run a second, isolated server on your machine:

```bash
npx @kata-sh/code-cli@latest serve \
  --port 53210 \
  --base-dir ~/.katacode-headless-test
```

In the desktop app, open **Settings** → **Connections** → **Add environment** → **Remote link**,
paste the printed pairing URL into **Host**, then click **Add environment**. Use `@nightly` instead
of `@latest` when testing with the Nightly app.

To expose a headless Linux server through Kata Code Connect:

```bash
npx @kata-sh/code-cli@latest connect link --headless
npx @kata-sh/code-cli@latest serve
```

Approve the managed relay-client installation when prompted. Then open the authorization URL on a
machine with a browser, paste the resulting code into the headless terminal, and sign in to the same
account in the desktop app. See
[Remote access](./docs/user/remote-access.md) for the complete flow and background-service options.

### Desktop app

Build the desktop app from this repository (`pnpm run dev:desktop`). Packaged releases are not part of Phase 1.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Customize a project icon](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- Linux: [run Kata Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## Development

### Install `vp`

Kata Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Have a feature request? Open a GitHub issue on [gannonh/kata-code](https://github.com/gannonh/kata-code).
