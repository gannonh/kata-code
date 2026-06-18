---
type: Architecture Note
title: "Provider architecture"
description: "How Kata Code routes one WebSocket API to multiple agent provider drivers through adapters and canonical runtime events."
tags: [architecture, providers, codex, claude, cursor, grok, opencode]
timestamp: 2026-06-17T02:30:00Z
---

# Provider architecture

Clients talk to **`apps/server`** over one WebSocket API. The server is **provider-agnostic** at the transport and orchestration layers: each chat thread binds to a **provider instance**, and that instance's **adapter** talks to a concrete agent runtime (Codex app-server, Claude Agent SDK, ACP CLI, OpenCode, …).

See also [architecture overview](/architecture/overview.md) for startup and turn lifecycle, [provider guides](/providers/index.md) for per-provider setup, and the [hosted web diagram](/diagrams/hosted-remote-stack.html) for where the server runs relative to clients.

## Client transport

The web app communicates with the server via WebSocket using a JSON-RPC-style protocol:

- **Request/response**: `{ id, method, params }` → `{ id, result }` or `{ id, error }`
- **Push events**: typed envelopes with `channel`, `sequence` (monotonic per connection), and channel-specific `data`

Push channels include `server.welcome`, `server.configUpdated`, `terminal.event`, and `orchestration.domainEvent`. Payloads are schema-validated at the transport boundary (`apps/web/src/wsTransport.ts`). Decode failures produce structured `WsDecodeDiagnostic` with `code`, `reason`, and path info.

`wsTransport.ts` manages connection state: `connecting` → `open` → `reconnecting` → `closed` → `disposed`. Outbound requests are queued while disconnected and flushed on reconnect. Inbound pushes are decoded and validated at the boundary, then cached per channel. Subscribers can opt into `replayLatest` to receive the last push on subscribe.

## Provider-facing API

Methods mirror the `NativeApi` interface in `@kata-sh/code-contracts`, including:

- `providers.startSession`, `providers.sendTurn`, `providers.interruptTurn`
- `providers.respondToRequest`, `providers.respondToUserInput`, `providers.stopSession`
- `shell.openInEditor`, `server.getConfig`

The UI does **not** call Codex or Claude protocols directly. It always goes through these server methods.

## Server layering

```text
WebSocket / NativeApi
        │
        ▼
ProviderService              ← cross-provider orchestration (start/send/interrupt/…)
        │
ProviderAdapterRegistry      ← resolve adapter by providerInstanceId
        │
ProviderInstanceRegistry   ← materialized instances from settings
        │
ProviderDriver (per kind)  ← codex, claudeAgent, cursor, grok, opencode
        │
Concrete runtime             ← app-server, SDK, ACP subprocess, OpenCode server
```

### ProviderService

`ProviderService` (`apps/server/src/provider/Layers/ProviderService.ts`) routes validated requests to the correct adapter via `ProviderAdapterRegistry` and `ProviderSessionDirectory`. It owns the unified provider event stream subscribers see after normalization.

It does **not** implement provider-native protocols — that is each adapter's job.

### Drivers, instances, adapters

Built-in drivers are registered in `apps/server/src/provider/builtInDrivers.ts`:

| Driver kind (`ProviderDriverKind`) | Runtime                          | Integration                                     |
| ---------------------------------- | -------------------------------- | ----------------------------------------------- |
| `codex`                            | `codex app-server` child process | JSON-RPC over stdio (`effect-codex-app-server`) |
| `claudeAgent`                      | Claude Code / Agent SDK          | In-process `@anthropic-ai/claude-agent-sdk`     |
| `cursor`                           | Cursor `agent` CLI               | ACP (Agent Client Protocol) over subprocess     |
| `grok`                             | Grok agent CLI                   | ACP over subprocess                             |
| `opencode`                         | OpenCode server                  | Local child process or configured `serverUrl`   |

Each **driver** is a factory. Settings can define multiple **instances** of the same driver (for example separate Codex or Claude homes). Every instance bundles three closures:

1. **`snapshot`** — model catalog, install/auth status, version, maintenance metadata (`ServerProvider`)
2. **`adapter`** — session lifecycle (`startSession`, `sendTurn`, approvals, …)
3. **`textGeneration`** — auxiliary generation (commit messages, branch names, titles)

Instance materialization lives in `ProviderInstanceRegistry`. Tearing down an instance releases child processes and refresh fibers for that instance only.

### Canonical runtime events

Adapters translate provider-native output into **`ProviderRuntimeEvent`** (`packages/contracts/src/providerRuntime.ts`): turn items, tool calls, approval prompts, errors, and related metadata in one schema.

Orchestration, git checkpoints, and the React UI consume these **canonical** events. That is how one conversation UX spans Codex, Claude, Cursor, Grok, and OpenCode without provider-specific rendering paths in the client.

## Models: two meanings

**Within one provider** — each instance's snapshot exposes the models that runtime supports. `sendTurn` carries a `ModelSelection` the adapter passes to the underlying agent.

**Across providers** — the user picks a **provider instance** (and model) when starting or continuing a thread. Codex and Claude are separate stacks: separate binaries/SDKs, auth, homes, and session continuity keys.

## Orchestration workers

Provider runtime events flow through queue-based workers shared by all drivers:

1. **ProviderRuntimeIngestion** — consumes provider runtime streams, emits orchestration commands
2. **ProviderCommandReactor** — reacts to orchestration intent events, dispatches provider calls
3. **CheckpointReactor** — captures git checkpoints on turn start/complete, publishes runtime receipts

All three use `DrainableWorker` internally and expose `drain()` for deterministic test synchronization.

## What this is not

- **Not** “Codex app-server is the universal model router.” Other providers are separate agent runtimes, not API calls inside Codex.
- **Not** hosted agent execution via [Kata Code Connect](/cloud/index.md). Providers run on the same machine as `katacode serve` (child processes or SDKs), whether that server is local desktop, a VM, or a tailnet host.
- **Not** the same as **remote environments** ([remote architecture](/architecture/remote.md)): remoteness is _where `katacode serve` runs_; providers are _which agent runtime that server uses_.

## Code map

| Area                 | Path                                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| Built-in driver list | `apps/server/src/provider/builtInDrivers.ts`                                    |
| Driver SPI           | `apps/server/src/provider/ProviderDriver.ts`                                    |
| Per-driver factories | `apps/server/src/provider/Drivers/*Driver.ts`                                   |
| Adapter contract     | `apps/server/src/provider/Services/ProviderAdapter.ts`                          |
| Routing layer        | `apps/server/src/provider/Layers/ProviderService.ts`                            |
| Instance registry    | `apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts`               |
| Contracts            | `packages/contracts/src/providerInstance.ts`, `providerRuntime.ts`              |
| Settings schema      | `packages/contracts/src/settings.ts` (`providerInstances`, per-driver settings) |

## Related

- [Provider guides — Codex & Claude setup](/providers/index.md)
- [Architecture overview](/architecture/overview.md)
- [Remote architecture](/architecture/remote.md)
- [Hosted web & remote stack diagram](/diagrams/hosted-remote-stack.html)
