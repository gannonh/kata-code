# Providers log

## 2026-07-01 (Cursor provider guide)

- Added [Cursor provider guide](/providers/cursor.md) (early access): Cursor Agent CLI over ACP, prerequisites (`agent login` or `agent set-channel lab && agent update` for the parameterized model picker), settings reference (binary path, API endpoint), API-key auth via `CURSOR_API_KEY` (skips interactive ACP `authenticate`; `agent about` null email treated as authenticated), and a Provider skills section covering discovery directories, `$skillname` / path-qualified `$skill:name:hash` Composer tokens, and server-side `<skill>` block prompt expansion. Linked from the [providers index](/providers/index.md) and cross-linked to [provider architecture — Provider skills](/architecture/providers.md#provider-skills) and [E2E test catalog — Cursor gates](/guides/e2e-test-catalog.md#cursor-e2e-gates).

## 2026-06-28 (Pi provider — removed duplicate roadmap section)

- Removed the "Roadmap — what's next for Pi" section from the [Pi provider guide](/providers/pi.md) that was added the prior day. [docs/specs/index.md](/specs/index.md) is now the single roadmap source of truth; deferred follow-ups (compaction UI [#16](https://github.com/gannonh/kata-code/issues/16), strict-review polish [#14](https://github.com/gannonh/kata-code/issues/14)) live in the [deferred-work registry](/specs/deferred-work.md), not the provider guide.

## 2026-06-27 (Pi provider — roadmap section)

- Added a [Roadmap — what's next for Pi](/providers/pi.md#roadmap--whats-next-for-pi) section to the [Pi provider guide](/providers/pi.md): spec complete, next increments are compaction UI ([#16](https://github.com/gannonh/kata-code/issues/16)) then strict-review polish ([#14](https://github.com/gannonh/kata-code/issues/14)), in priority order with resume-cold context.

## 2026-06-27 (Pi provider — AC 15 reclassification)

- Replaced the "AC 15 manual validation outstanding" limitation in the [Pi provider guide](/providers/pi.md) with a statement that AC 15 is verified by the credentialed `@pi` E2E (`e2e/tests/agent/pi-smoke.spec.ts`, `e2e/tests/settings/pi-provider.spec.ts`) and the [`e2e/verify-evidence/`](../../e2e/verify-evidence/README.md) screenshots.

## 2026-06-27 (Pi provider — Finalize)

- [Pi provider guide](/providers/pi.md): documented amber timeline rendering for `runtime.warning` events; linked [verification evidence](../../e2e/verify-evidence/README.md) (manual walkthrough screenshots + `@pi` E2E matrix).

## 2026-06-27

Updated [Pi provider guide](/providers/pi.md) to reflect completed adapter parity: tool lifecycle, image attachments, resume cursor, rollback, compaction (`thread.state.changed`), extension UI bridge, runtime-mode warnings, project-trust surfacing, and Pi-backed git text generation are now supported. Rewrote the Limitations section to document the real remaining limits (no enforceable approval/sandbox gate, compaction has no UI surface yet, TUI-only extension APIs warn-and-no-op, AC 15 manual validation outstanding). Linked the [Build completion report](/specs/2026-06-25-pi-coding-agent-support-design.md#build-completion-report).

## 2026-06-26

- Strict quality review fixes for Pi adapter: single `settleTurn` settlement owner (no duplicate `turn.completed`), item closure on all exit paths, centralized abort-then-dispose in `teardownSession`, `stopped` flag guards stale events, `makeEvent` generic type safety, model list resolved once at construction, dead `turns` state removed.
- Extracted shared `stampProviderInstanceIdentity` to `providerSnapshot.ts`, replacing identical `withInstanceIdentity` copies in all 6 drivers.
- Hidden `projectTrustPolicy` from Pi settings UI until the adapter enforces it.
- Added [Pi provider guide](/providers/pi.md) (early access): prerequisites, settings reference (binary path, agent directory, project trust policy), multi-instance isolation, and current limitations. Linked it from the [providers index](/providers/index.md).

## 2026-06-16

- Added providers section index.
