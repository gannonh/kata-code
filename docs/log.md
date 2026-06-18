# OKF bundle log

## 2026-06-17 (Kata brand icons + desktop packaging)

- Shipped Kata kanji icons across web, server, mobile, and desktop releases; removed upstream blueprint/T3 artwork from dev and nightly channels ([FORK.md — brand marks](../../FORK.md#brand-logo-marks), `scripts/lib/brand-assets.ts`).
- Desktop releases use `apps/desktop/resources/` assets, macOS Liquid Glass `Assets.car`, and `scripts/electron-after-pack.cjs` (`afterPack` path must be relative to `apps/desktop`).
- [Release runbook](/operations/release.md): nightly rerun after `afterPack` path fix (`19f05374d`).

## 2026-06-17 (Phase 2 pre-merge)

- Finalized OKF and [AGENTS.md](../../AGENTS.md) for [PR #2](https://github.com/gannonh/katacode/pull/2): active [release workflow](../../.github/workflows/release.yml), `app.kata.sh` hosted web, branch-protection guidance in [CI runbook](/operations/ci.md).
- Documented `apps/web/vercel.ts` compile-time branding constants (must stay in sync with [branding.ts](../../packages/shared/src/branding.ts)).
- Post-merge operator steps: merge PR #2, configure branch protection, run `release.yml` `dry_run`, then nightly test release.

## 2026-06-17

- Added [diagrams](/diagrams/index.md) section with interactive [hosted web & remote stack](/diagrams/hosted-remote-stack.html) map (`app.kata.sh`, `katacode serve`, Connect vs manual pairing).
- Updated bundle [index](/index.md) and [architecture index](/architecture/index.md) cross-links.
- Rewrote [provider architecture](/architecture/providers.md) for multi-driver server design (no longer Codex-only).
- Updated [architecture overview](/architecture/overview.md) for provider-agnostic stack diagram and turn flow.

## 2026-06-16 (Phase 1 CI)

- Documented Phase 1 PR [#1](https://github.com/gannonh/katacode/pull/1) CI green and review hardening in [fork-setup spec](/specs/fork-setup.md).
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
