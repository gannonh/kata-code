# Specs roadmap

Work map for Kata Code.

## Active / next

| Item                                  | Status                                                      | Document                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream sync (first merge)           | **Active** — pre-merge tooling complete; bulk merge pending | [Resume handoff](/specs/2026-06-20-upstream-sync-handoff.md) · [Closure spec](/specs/2026-06-20-upstream-sync-closure.md) · [upstream-sync guide](/guides/upstream-sync.md) · [ADR 0003](/adrs/0003-episodic-upstream-sync.md) · [FORK.md — Phase 3](../../FORK.md#phase-3--upstream-sync-runbook) |
| Local Electron E2E testing foundation | **Draft** — awaiting user review                            | [Design spec](/specs/2026-06-21-e2e-testing-foundation-design.md)                                                                                                                                                                                                                                  |

## Completed

| Item                                     | Document                                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 2 — production relay + Connect UAT | [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) · [PR #4](https://github.com/gannonh/kata-code/pull/4) · relay deployed, Nightly runtime fixes, Connect UAT passed 2026-06-19 |
| Kata brand icons (web + desktop)         | [FORK.md — brand marks](../../FORK.md#brand-logo-marks) · commits `ef18ae11e`, `19f05374d`                                                                                                    |
| Phase 2 — desktop/web release split      | [Design spec](/specs/2026-06-16-phase-2-desktop-web-release-design.md) · [Release runbook](/operations/release.md) · [PR #2](https://github.com/gannonh/kata-code/pull/2)                     |
| Phase 0 — Git remotes                    | [FORK.md — Phase 0](../../FORK.md#phase-0--git-remotes-complete)                                                                                                                              |
| Phase 1 — Branding & rename              | [FORK.md — Phase 1](../../FORK.md#phase-1--branding-and-rename-do-this-first) · [ADR 0002](/adrs/0002-katacode-product-identity.md)                                                           |
| Phase 1 — PR & CI                        | [PR #1](https://github.com/gannonh/kata-code/pull/1) · [fork-setup spec](/specs/fork-setup.md) · [CI runbook](/operations/ci.md)                                                              |

## Deferred / review queue

| Item                   | Status     | Document                                          |
| ---------------------- | ---------- | ------------------------------------------------- |
| Deferred work registry | **Active** | [Deferred work registry](/specs/deferred-work.md) |

## Backlog & historical plans

Upstream-era implementation plans live under [docs/specs/plans/](/specs/plans/). Treat them as archived context unless a spec explicitly revives one.
