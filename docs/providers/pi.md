---
type: Guide
title: "Pi"
description: "Use the Pi coding agent as a first-party Kata Code provider. Pi runs in-process through the Pi SDK with model, skill, and prompt discovery from your agent directory."
tags: [providers, pi, guide, early-access]
timestamp: 2026-06-26T00:00:00Z
status: early-access
---

# Pi

Pi is a first-party Kata Code provider backed by the in-process
[`@earendil-works/pi-coding-agent`](https://pi.dev) SDK. Sessions run inside the
`katacode serve` process; the Pi CLI binary is used only for optional version
and update checks.

> **Early access.** Session start, send, streaming assistant/reasoning output,
> tool lifecycle, image attachments, interrupt, stop, resume cursor,
> rollback, compaction, the extension UI bridge, runtime-mode warnings,
> project-trust surfacing, and Pi-backed git text generation are supported.
> Pi's SDK exposes no enforceable approval/sandbox gate, so `auto-accept-edits`
> and `approval-required` run as `full-access` with a visible runtime warning.
> See the [design spec](/specs/2026-06-25-pi-coding-agent-support-design.md) and
> the [Build completion report](/specs/2026-06-25-pi-coding-agent-support-design.md#build-completion-report).

## Prerequisites

- Authenticate Pi so the SDK can resolve at least one model. Pi reads auth,
  models, settings, skills, prompts, and extensions from its **agent
  directory** (default `~/.pi/agent`).
- Verify your authenticated models from a terminal:

  ```bash
  pi --version
  ```

If Pi has no authenticated model, the provider snapshot reports installed but
unauthenticated and the model picker shows no Pi models.

## Add Pi in Settings

1. Open **Settings → Providers**. Pi is listed first with an **Early Access**
   badge and is enabled by default.
2. Expand the Pi card.
3. Set **Agent directory** if you do not use the default `~/.pi/agent`.
4. Leave **Binary path** as `pi` unless your CLI lives elsewhere; it is only
   used for version/update probes.
5. Refresh provider status. Authenticated Pi models appear in the model picker
   with `provider/model` slugs (for example `anthropic/claude-opus-4-6`).

## Settings reference

| Field                    | Purpose                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Binary path**          | Path to the Pi CLI. Used only for version/update checks; sessions run through the in-process SDK.          |
| **Agent directory**      | Pi's global resource root (auth, models, settings, skills, prompts, extensions). Default `~/.pi/agent`.    |
| **Project trust policy** | `never` (default) ignores project-local `.pi` resources and project `.agents/skills`; `always` loads them. |

Custom models, display name, accent color, and per-instance environment
variables are configured through the generic provider-instance controls, the
same as other providers.

## Multiple Pi instances

Add a second Pi provider with a different **Agent directory** to isolate auth,
models, and sessions. Each instance gets its own SDK session manager, model
registry, auth storage, and event stream.

## Limitations

- Pi's SDK has no enforceable approval/sandbox gate (`ToolExecutionMode` is
  only `sequential`/`parallel`). `auto-accept-edits` and `approval-required`
  run as `full-access` and emit a `runtime.warning` at session start so the
  limitation is visible, not hidden.
- Compaction is wired through the adapter and `ProviderService.compactConversation`,
  but no web/desktop UI surface invokes it yet (mirrors `rollbackConversation`).
- Extension TUI-only APIs (`setWidget`/`setFooter`/`setHeader`/`custom`/
  `pasteToEditor`/`setEditorComponent`/`addAutocompleteProvider`/`onTerminalInput`)
  emit one `runtime.warning` per method per session and no-op; full custom TUI
  component rendering in the web UI is explicitly deferred.
- Manual Pi-authenticated validation (AC 15) requires a maintainer-authenticated
  Pi environment; the credentialed `@pi` E2E smoke covers the gated path.

## Related

- [Architecture — providers](/architecture/providers.md) — driver/instance model
- [Pi provider design spec](/specs/2026-06-25-pi-coding-agent-support-design.md)

## History

See [log.md](/providers/log.md).
