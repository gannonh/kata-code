# Providers log

## 2026-06-27

Updated [Pi provider guide](/providers/pi.md) to reflect completed adapter parity: tool lifecycle, image attachments, resume cursor, rollback, compaction (`thread.state.changed`), extension UI bridge, runtime-mode warnings, project-trust surfacing, and Pi-backed git text generation are now supported. Rewrote the Limitations section to document the real remaining limits (no enforceable approval/sandbox gate, compaction has no UI surface yet, TUI-only extension APIs warn-and-no-op, AC 15 manual validation outstanding). Linked the [Build completion report](/specs/2026-06-25-pi-coding-agent-support-design.md#build-completion-report).

## 2026-06-26

- Strict quality review fixes for Pi adapter: single `settleTurn` settlement owner (no duplicate `turn.completed`), item closure on all exit paths, centralized abort-then-dispose in `teardownSession`, `stopped` flag guards stale events, `makeEvent` generic type safety, model list resolved once at construction, dead `turns` state removed.
- Extracted shared `stampProviderInstanceIdentity` to `providerSnapshot.ts`, replacing identical `withInstanceIdentity` copies in all 6 drivers.
- Hidden `projectTrustPolicy` from Pi settings UI until the adapter enforces it.
- Added [Pi provider guide](/providers/pi.md) (early access): prerequisites, settings reference (binary path, agent directory, project trust policy), multi-instance isolation, and current limitations. Linked it from the [providers index](/providers/index.md).

## 2026-06-16

- Added providers section index.
