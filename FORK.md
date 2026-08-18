# Kata Code fork

Hard fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) at
[gannonh/kata-code](https://github.com/gannonh/kata-code).

## Pins (Phase 1 cut)

| Ref | SHA | Notes |
| --- | --- | --- |
| Archive of pre-cut Kata `main` | `3bd3df5beebdc5546ab5b86e95b4746de131035f` | `archive/kata-2026-08` branch and annotated tag |
| T3 pin (new `main` root) | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f` | `pingdotgg/t3code` `main` at Build start |

Vendor-pull runs **forward from this T3 pin**. Do not chase newer T3 commits after the pin inside Phase 1. The previous Kata scan baseline `708d5383` is obsolete.

```bash
git fetch upstream
# next scan starts at 6a687ee43
```

## Remotes

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream --tags
```

`origin` is `gannonh/kata-code`. Never push to `upstream`.

## Identity

| Surface | Value |
| --- | --- |
| Product name | Kata Code |
| npm scope | `@kata-sh/code-*` |
| CLI | `katacode` (`@kata-sh/code-cli`) |
| Env prefix | `KATACODE_*` |
| State dir | `~/.katacode` / worktree `.katacode` |
| Protocols | `katacode` / `katacode-dev` / `katacode-preview` |
| Desktop bundle (prod) | `com.katacode.app` |
| Desktop bundle (dev) | `com.katacode.dev.<suffix>` |
| Hosted web | `app.kata.sh` / `latest.app.kata.sh` / `nightly.app.kata.sh` |

Single table: `packages/shared/src/branding.ts`. `apps/web/vercel.ts` inlines the same hosts (Vercel compiles it before the monorepo build).

No compatibility shims for the previous upstream env prefix, home directory, or URL schemes on product surfaces.

## Intentionally T3-shaped (later phases)

- User project format `t3.json`
- Connect wire IDs (`t3_relay`, `/api/t3-connect`, `t3-mobile` / `t3-web`)
- `apps/marketing/**` copy
- `packaging/aur/**`
- `.repos/**`

## Workflows

Active: `.github/workflows/ci.yml` (`ubuntu-24.04`, `@kata-sh/code-*` filters).

Parked under `.github/disabled/` until a later phase: release, relay deploy, mobile EAS, AUR, PR automation, web preview.
