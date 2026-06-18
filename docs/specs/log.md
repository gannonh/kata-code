# Specs log

## 2026-06-18 (Relay Deploy infra setup)

- Updated [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) with credential smoke + local dry-run progress and remaining GitHub/UAT gates.
- Expanded [Relay deploy setup](/operations/relay-deploy-setup.md) and [Relay credentials playbook](/guides/relay-credentials-playbook.md) with Alchemy bootstrap and Cloudflare account ID troubleshooting.

## 2026-06-18 (Relay Deploy design)

- Added and approved [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) for manual production relay deploy, strict release config, smoke checks, and UAT evidence.
- Updated [specs roadmap](/specs/index.md) and [deferred work registry](/specs/deferred-work.md) for relay follow-ups.

## 2026-06-18 (deferred work registry)

- Added [deferred work registry](/specs/deferred-work.md) and linked it from the [specs roadmap](/specs/index.md) so deferred scope has a durable review queue.

## 2026-06-17 (episodic upstream sync)

- Documented episodic upstream policy in [ADR 0003](/adrs/0003-episodic-upstream-sync.md) and [upstream sync guide](/guides/upstream-sync.md); updated [roadmap](/specs/index.md) and [fork-setup spec](/specs/fork-setup.md).

## 2026-06-17 (Kata brand icons)

- Completed fork icon rebrand on `main`: `apps/desktop/resources/source.png` drives `pnpm run generate:brand-rasters`; production icons used for dev, nightly, and hosted web ([FORK.md — brand marks](../../FORK.md#brand-logo-marks)).
- Fixed desktop release `afterPack` hook path (`scripts/electron-after-pack.cjs` relative to `apps/desktop`).

## 2026-06-17 (Phase 2 pre-merge)

- [PR #2](https://github.com/gannonh/kata-code/pull/2) ready to merge: Codex review fixes (`dry_run` default version, prerelease npm `next` dist-tag), `vercel.ts` compile fix, Vercel project + `app.kata.sh` domains.
- Moved Phase 2 desktop/web release to **Completed** on [roadmap](/specs/index.md); post-merge validation tracked as **Next**.

## 2026-06-16 (Phase 2 desktop/web release build)

- Implemented [Phase 2 desktop/web release split](/specs/2026-06-16-phase-2-desktop-web-release-design.md): activated [release workflow](../../.github/workflows/release.yml), macOS Apple ID notarization gate, Kata Code hosted web domains, and [release runbook](/operations/release.md).

## 2026-06-16 (Phase 2 desktop/web release design)

- Added [Phase 2 desktop/web release split design](/specs/2026-06-16-phase-2-desktop-web-release-design.md) focused on desktop CI signing/notarization and hosted `apps/web`; explicitly deferred mobile, marketing, and relay/cloud VM deploys.
- Updated the specs roadmap to track the Phase 2 desktop/web release design separately from remaining infrastructure split work.

## 2026-06-16 (Phase 1 delivery)

- Marked Phase 1 PR & CI complete on [roadmap](/specs/index.md); [PR #1](https://github.com/gannonh/kata-code/pull/1) passes GitHub Actions.
- Added Phase 1 delivery notes and test-fixture guidance to [fork-setup spec](/specs/fork-setup.md).

## 2026-06-16

- Initialized specs section; moved `.plans/` to `docs/specs/plans/`.
- Added [fork-setup spec](/specs/fork-setup.md) (canonical fork plan lives in [FORK.md](../../FORK.md)).
- Moved [product backlog](/specs/product-backlog.md) from `docs/project/todo.md`.
