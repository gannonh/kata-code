---
type: Report
title: Pi sandbox support — build report
description: Validation evidence and fix log for Pi in Docker and Vercel sandboxes.
---

# Pi sandbox support — build report

Spec: [Pi provider support in sandbox environments](./2026-07-17-pi-sandbox-support-design.md)

## Docker sandbox validation (2026-07-17)

Maintainer-attested manual UAT against a freshly rebuilt `katacode:local` container.

| #   | Check                              | Result | Evidence                                                                            |
| --- | ---------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| 1   | Pi selectable in picker            | PASS   | Maintainer manual UAT                                                               |
| 2   | Authenticated + model discovery    | PASS   | 315 authenticated models; selected `openai-codex/gpt-5.4-mini` present              |
| 3   | Turn streams to completion         | PASS   | Maintainer manual UAT; persisted thread `8c69b11b-3a25-4da1-ad30-5f6bfb1c3969`      |
| 4   | Tool calls execute in `/workspace` | PASS   | Maintainer manual UAT                                                               |
| 5   | Interrupt/stop mid-turn            | PASS   | Maintainer manual UAT                                                               |
| 6   | Thread resume + follow-up          | PASS   | Maintainer manual UAT; latest persisted turn `d66f91ad-6617-4235-91b7-86a8ff06e7a7` |

### Machine evidence

- Container: `d157aa04dbe0`, running image `sha256:e983ba2d00a52b4f4ce8508b97e1c42695c6741a54814b7d8c39bf7ad8e205c1`.
- Pi agent directory: `/home/katacode/.pi/agent`.
- Fresh `AuthStorage` + `ModelRegistry`: 315 authenticated models.
- Selected model `openai-codex/gpt-5.4-mini`: available.

### Defects surfaced and fixed

1. **Pi adapter cached pre-seed model availability.** Docker provision starts `katacode serve` before credential `copyInto` completes. The adapter initially captured zero authenticated models and continued using that stale state after discovery showed seeded models.
2. **Pi SDK registries cache their initial auth state.** Re-calling `getAvailable()` on the boot-time registry was insufficient. `AuthStorage` and `ModelRegistry` now recreate on every `startSession`, and those fresh instances are passed to `createAgentSession` (`55396d05d`).
3. A regression test reproduces late credential seed and verifies session creation receives the refreshed registries. `apps/server/src/provider/Layers/PiAdapter.test.ts`: 37/37 passing. `vp check` and `vp run typecheck` pass.

## ModelRuntime 0.80.10 pre-release validation (2026-07-18)

Maintainer-attested local + Docker evidence for the Pi `ModelRuntime` migration and exact `0.80.10` alignment. Spec: [Pi runtime update strategy](./2026-07-18-pi-runtime-update-strategy-design.md).

| #   | Check                                  | Result  | Evidence                                                                     |
| --- | -------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| 1   | `vp run verify:pi-update`              | PASS    | Exit code 0                                                                  |
| 2   | Focused Pi unit/integration tests      | PASS    | 77/77                                                                        |
| 3   | Credentialed desktop `@pi` E2E         | PASS    | 8/8 in 59.0s; includes built-in `openai-codex/gpt-5.6-sol`                   |
| 4   | Docker image baseline                  | PASS    | `verify:docker-image`                                                        |
| 5   | Docker Pi runtime probe                | PASS    | `cliVersion=0.80.10`, `sdkVersion=0.80.10`, model `openai-codex/gpt-5.6-sol` |
| 6   | Full unit suite                        | PASS    | 505 passed / 2 skipped files; 4083 passed / 11 skipped tests                 |
| 7   | Release smoke                          | PASS    | `vp run release:smoke`                                                       |
| 8   | Vercel sandbox                         | Pending | Post-nightly                                                                 |
| 9   | Degraded path — no host Pi credentials | Pending | Post-nightly                                                                 |

### Machine evidence

- Pi SDK / CLI pin: `0.80.10` (server deps, Vercel `PI_SDK_PIN`, Docker `ARG PI_SDK_VERSION`).
- Docker probe selected model: `openai-codex/gpt-5.6-sol`.
- Catalog E2E uses built-in discovery (`includeModels: false`); no custom model registration required.

## Vercel sandbox validation

Pending post-nightly.

## Degraded path — no host Pi credentials

Pending post-nightly.
