# Kata Code

Kata Code is an "agent harness control surface". It enables control of the agents on your machine with a [web app](https://app.kata.sh) and an Electron desktop app.

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, Kata Code can control them.

## Installation

> [!WARNING]
> Kata Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Command line

```bash
curl -fsSL https://raw.githubusercontent.com/gannonh/kata-code/main/scripts/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/gannonh/kata-code/main/scripts/install.ps1 | iex
```

Then run `katacode` to start the server and open the local web app. `katacode service install` keeps it running in the background, `katacode update` moves to a newer release, and `katacode --help` has the full reference.

To try it once without installing, run `npx @kata-sh/code-cli@latest` instead.

### Desktop app

Download the desktop app from [GitHub Releases](https://github.com/gannonh/kata-code/releases),
or run it from source with `vp run dev:desktop`.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run Kata Code as a background service](./docs/user/background-service.md)

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

Secrets come from 1Password. See [environment variables](./docs/operations/environment-variables.md).
Export `OP_SERVICE_ACCOUNT_TOKEN`, then:

```bash
vp i
```

Have a feature request? Open a GitHub issue on [gannonh/kata-code](https://github.com/gannonh/kata-code).
