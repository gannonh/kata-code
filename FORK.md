# Kata Code fork

Hard fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) at
[gannonh/kata-code](https://github.com/gannonh/kata-code).

## Pins (Phase 1 cut)

| Ref                            | SHA                                        | Notes                                           |
| ------------------------------ | ------------------------------------------ | ----------------------------------------------- |
| Archive of pre-cut Kata `main` | `3bd3df5beebdc5546ab5b86e95b4746de131035f` | `archive/kata-2026-08` branch and annotated tag |
| T3 pin (new `main` root)       | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f` | `pingdotgg/t3code` `main` at Build start        |

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

| Surface               | Value                                                        |
| --------------------- | ------------------------------------------------------------ |
| Product name          | Kata Code                                                    |
| npm scope             | `@kata-sh/code-*`                                            |
| CLI                   | `katacode` (`@kata-sh/code-cli`)                             |
| Env prefix            | `KATACODE_*`                                                 |
| State dir             | `~/.katacode` / worktree `.katacode`                         |
| Protocols             | `katacode` / `katacode-dev` / `katacode-preview`             |
| Desktop bundle (prod) | `com.katacode.app`                                           |
| Desktop bundle (dev)  | `com.katacode.dev.<suffix>`                                  |
| Hosted web            | `app.kata.sh` / `latest.app.kata.sh` / `nightly.app.kata.sh` |

Single table: `packages/shared/src/branding.ts`. `apps/web/vercel.ts` and the
repo-root `vercel.ts` inline the same hosts (Vercel compiles those files before
the monorepo build).

## Identifier policy

Kata Code retains upstream T3 identifiers when they are neither user-visible nor part of a supported operator interface. Explicit compatibility boundaries listed below remain retained even when users or supported operators encounter them. This limits vendor-pull conflicts and preserves durable and wire compatibility.

User-visible means text, labels, routes, examples, or identifiers shown in shipped web, desktop, mobile, CLI, or current user documentation. A supported operator interface is a documented file, environment variable, CLI option, URL scheme, or network contract that operators or external clients are expected to set or send.

Retain private or internal source symbols, private logs, comments, generated script locals, disabled workflows, internal binary paths, storage keys, and test fixtures. Explicit retained compatibility boundaries include `t3.json`, its schema URL, the OAuth token-type URN, checkpoint refs, browser storage keys, internal `T3_*` variables, binary names, CSS identifiers, and temporary names. These values remain retained even when they appear in a supported operator interface.

Rename a T3 identifier only when it appears in user-facing identity, forms a supported operator interface, or blocks a Kata-owned capability. A capability blocker is an identifier that prevents an approved Kata feature from working because that feature requires a Kata-owned route, option, protocol name, or external resource name. A naming preference alone is not a capability blocker. Route any user-visible rename to [#118](https://github.com/gannonh/kata-code/issues/118) and route other operator-interface or capability changes to a dedicated approved spec. Do not add compatibility aliases, dual reads, migrations, or fallback paths for this policy.

No compatibility shims for the previous upstream env prefix, home directory, or URL schemes on product surfaces.

## Intentionally T3-shaped (later phases)

- User project format `t3.json`
- `apps/marketing/**` copy
- `packaging/aur/**`
- `.repos/**`

## Workflows

Active: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `.github/workflows/deploy-relay.yml` (`ubuntu-24.04`, `macos-15`, `windows-2025`; `@kata-sh/code-*` filters).

Parked under `.github/disabled/` until a later phase: mobile EAS, AUR, PR automation, web preview.
