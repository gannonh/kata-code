# ADR log

## 2026-06-20 (drop upstream-T3 migration)

- Updated [ADR 0002](/adrs/0002-katacode-product-identity.md) consequences: removed the `~/.t3` startup warning and migration affordance. Kata Code is a hard fork with no upstream-state migration; the legacy-T3 branding constants and `warnLegacyHomeDirectoryIfNeeded` were deleted.

## 2026-06-17 (episodic upstream sync)

- Added [ADR 0003 — Episodic upstream sync and fork independence](/adrs/0003-episodic-upstream-sync.md); cross-linked from [ADR 0001](/adrs/0001-connected-fork-upstream-merge.md).

## 2026-06-17 (release + brand icons)

- Updated [ADR 0002](/adrs/0002-katacode-product-identity.md) consequences: active `release.yml` and hosted web; production icons on all channels; relay/EAS still disabled.

## 2026-06-16 (Phase 1 consequences)

- Updated [ADR 0002](/adrs/0002-katacode-product-identity.md) consequences: `~/.t3` migration warning, hosted pairing domains, disabled release workflows vs active PR CI.

## 2026-06-16

- Added [ADR 0001 — Connected fork with upstream merge](/adrs/0001-connected-fork-upstream-merge.md).
- Added [ADR 0002 — Kata Code product identity](/adrs/0002-katacode-product-identity.md).
