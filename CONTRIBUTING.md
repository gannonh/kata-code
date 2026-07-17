# Contributing to Kata Code

Kata Code is a hard fork of [T3 Code](https://github.com/pingdotgg/t3code), maintained at [gannonh/kata-code](https://github.com/gannonh/kata-code). Read [FORK.md](./FORK.md) before large refactors or upstream merges.

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
vp run knip          # unused/dead code report (soft-fail in CI)
# optional: vp run test:coverage  # coverage with low floor thresholds
```

For desktop changes, also run:

```bash
vp run --filter @kata-sh/code-desktop ensure:electron
```

## Naming conventions

Follow the conventions in [AGENTS.md](./AGENTS.md#naming-conventions): `camelCase` for values/functions, `PascalCase` for types/components, `UPPER_SNAKE_CASE` for constants, and product env prefix `KATACODE_*`.

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
