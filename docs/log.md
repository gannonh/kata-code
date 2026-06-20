# OKF bundle log

## 2026-06-19 (stable v0.0.29 released + full UAT pass)

- Stable `v0.0.29` released ([run 27854360066](https://github.com/gannonh/kata-code/actions/runs/27854360066)); `@kata-sh/code-cli@0.0.29` published to npm.
- Full UAT passed on stable (`app.kata.sh`): chat completion, Files panel, Connect sign-in, relay link/tunnel, network access toggle, manual environment add via `npx @kata-sh/code-cli serve`.
- Deferred: Connect stale relay link on account switch; Connect open signups (waitlist off). See [deferred work registry](/specs/deferred-work.md).

## 2026-06-19 (Relay Deploy completed + Nightly UAT)

- Marked [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) **Completed**: production relay deployed ([run 27798366259](https://github.com/gannonh/kata-code/actions/runs/27798366259)), Nightly runtime regressions fixed, Connect UAT passed.
- Moved Phase 2 infra split to **Completed** on [specs roadmap](/specs/index.md); updated Active to upstream sync planning.
- Closed "Production Relay Deploy" deferred item; added "Connect: stale relay link on account switch" deferred item to [deferred work registry](/specs/deferred-work.md).
- Documented relay deploy and Connect polish commits: `11c8a75c6` (fff native asar fix), `628d982de` (rejected cloud session recovery), `1cfb69697` (x64 cross-arch native bindings).

## 2026-06-18 (Relay Deploy infra setup)

- Documented one-time Alchemy Cloudflare bootstrap, credential smoke validation, and `CLOUDFLARE_ACCOUNT_ID` verification in [Relay deploy setup](/operations/relay-deploy-setup.md) and [Relay credentials playbook](/guides/relay-credentials-playbook.md).
- Updated [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) build handoff with credential smoke + local dry-run progress; [specs roadmap](/specs/index.md) links [PR #4](https://github.com/gannonh/kata-code/pull/4).

## 2026-06-18 (Relay Deploy design)

- Added [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) and updated [specs roadmap](/specs/index.md) plus [deferred work registry](/specs/deferred-work.md).

## 2026-06-18 (deferred work registry)

- Added [deferred work registry](/specs/deferred-work.md) and roadmap links so spec out-of-scope items have a durable review queue.
- Updated [AGENTS.md](../../AGENTS.md) with deferred-work maintenance guidance.

## 2026-06-17 (episodic upstream sync)

- Added [ADR 0003 — Episodic upstream sync](/adrs/0003-episodic-upstream-sync.md) and [upstream sync guide](/guides/upstream-sync.md).
- Updated [FORK.md — Phase 3](../../FORK.md#phase-3--upstream-sync-runbook), [fork-setup spec](/specs/fork-setup.md), and [specs roadmap](/specs/index.md).

## 2026-06-17 (Kata brand icons + desktop packaging)

- Shipped Kata kanji icons across web, server, mobile, and desktop releases; removed upstream blueprint/T3 artwork from dev and nightly channels ([FORK.md — brand marks](../../FORK.md#brand-logo-marks), `scripts/lib/brand-assets.ts`).
- Desktop releases use `apps/desktop/resources/` assets, macOS Liquid Glass `Assets.car`, and `scripts/electron-after-pack.cjs` (`afterPack` path must be relative to `apps/desktop`).
- [Release runbook](/operations/release.md): nightly rerun after `afterPack` path fix (`19f05374d`).

## 2026-06-17 (Phase 2 pre-merge)

- Finalized OKF and [AGENTS.md](../../AGENTS.md) for [PR #2](https://github.com/gannonh/kata-code/pull/2): active [release workflow](../../.github/workflows/release.yml), `app.kata.sh` hosted web, branch-protection guidance in [CI runbook](/operations/ci.md).
- Documented `apps/web/vercel.ts` compile-time branding constants (must stay in sync with [branding.ts](../../packages/shared/src/branding.ts)).
- Post-merge operator steps: merge PR #2, configure branch protection, run `release.yml` `dry_run`, then nightly test release.

## 2026-06-17

- Added [diagrams](/diagrams/index.md) section with interactive [hosted web & remote stack](/diagrams/hosted-remote-stack.html) map (`app.kata.sh`, `katacode serve`, Connect vs manual pairing).
- Updated bundle [index](/index.md) and [architecture index](/architecture/index.md) cross-links.
- Rewrote [provider architecture](/architecture/providers.md) for multi-driver server design (no longer Codex-only).
- Updated [architecture overview](/architecture/overview.md) for provider-agnostic stack diagram and turn flow.

## 2026-06-16 (Phase 1 CI)

- Documented Phase 1 PR [#1](https://github.com/gannonh/kata-code/pull/1) CI green and review hardening in [fork-setup spec](/specs/fork-setup.md).
- Expanded [CI runbook](/operations/ci.md) with active vs disabled workflows and fork rebrand test-fixture guidance.
- Updated [specs roadmap](/specs/index.md): Phase 1 PR & CI complete; Phase 2 next.
- Refreshed [ADR 0002](/adrs/0002-katacode-product-identity.md) consequences (migration warning, hosted pairing, disabled release workflows).

## 2026-06-16

- Initialized OKF v0.1 bundle at `./docs`.
- Created required sections: `specs/`, `adrs/`, root `index.md` and `log.md`.
- Moved `.plans/` → `docs/specs/plans/` and `docs/project/todo.md` → `docs/specs/product-backlog.md`.
- Added section indexes for `architecture/`, `guides/`, `runbooks/`, `reference/`, `cloud/`, `providers/`, `integrations/`.
- Seeded ADRs for connected-fork strategy and Kata Code product identity.
- Added OKF frontmatter to existing concept documents.
- Updated [AGENTS.md](../../AGENTS.md) with OKF consumption and maintenance instructions.
