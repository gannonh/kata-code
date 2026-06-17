# Contributing to KataCode

KataCode is a hard fork of [T3 Code](https://github.com/pingdotgg/t3code), maintained at [gannonh/katacode](https://github.com/gannonh/katacode). Read [FORK.md](./FORK.md) before large refactors or upstream merges.

## Ground rules

1. **Performance and reliability first** — see [AGENTS.md](./AGENTS.md).
2. **Keep fork branding intact** — do not reintroduce `@t3tools/*`, `T3CODE_*`, or upstream product strings without an explicit decision recorded in `FORK.md`.
3. **Upstream sync is merge-based** — fetch `upstream`, merge on a sync branch, verify with `vp check && vp run typecheck`, then merge to `main`.
4. **Never push to the `upstream` remote.**

## Before opening a PR

```bash
vp i
vp check
vp run typecheck
vp test   # or targeted package tests for touched areas
```

For desktop changes, also run:

```bash
vp run --filter @kata-sh/code-desktop ensure:electron
```

## What we welcome

- Focused bug fixes and reliability improvements
- Performance improvements with measurable impact
- Fork maintenance (branding, CI split, docs, upstream sync)
- Small, well-scoped features aligned with the fork roadmap in `FORK.md`

## What to discuss first

- Large architectural changes
- New cloud/relay infrastructure (Phase 2+)
- Breaking changes to env vars, state dirs, or URL protocols

## PR hygiene

- Keep PRs reviewable — prefer several small PRs over one huge diff.
- Update `FORK.md` when sync policy or intentional divergence changes.
- Do not commit secrets, signing credentials, or `.env.local` files.
