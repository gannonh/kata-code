# Kata Code fork setup plan

Hard fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) maintained at
[gannonh/kata-code](https://github.com/gannonh/kata-code).

This document is the source of truth for fork operations: identity, upstream sync,
release split, and intentional divergence. Update it whenever sync policy or branding
decisions change.

## Current status

| Item                                       | Status                 | Notes                                                                                 |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------- |
| Fork remote (`origin`)                     | Done                   | `https://github.com/gannonh/kata-code.git`                                            |
| Upstream remote (`upstream`)               | Done                   | `https://github.com/pingdotgg/t3code.git`                                             |
| Baseline sync point                        | `708d5383`             | Last merged upstream SHA — update after each sync                                     |
| Product rename (`@t3tools/*` → fork scope) | **Done**               | Phase 1.1                                                                             |
| Env prefix rename (`KATACODE_*`)           | **Done**               | `~/.katacode`, protocols, storage keys                                                |
| User-facing docs rebrand                   | **Done**               | README, CONTRIBUTING, quick-start                                                     |
| Phase 1 verification gate                  | **Done**               | `vp check && vp run typecheck`                                                        |
| CI / release split from upstream           | **Done** (desktop/web) | [PR #2](https://github.com/gannonh/kata-code/pull/2); relay/mobile EAS still disabled |
| `FORK.md` divergence log                   | Started                | This file                                                                             |

Record the last successful upstream merge here:

```text
Last upstream sync: (none yet)
Upstream SHA:       708d5383
Fork SHA after merge:
Conflicts resolved in:
Verification:       vp check && vp run typecheck
```

---

## Goals

1. **Ship an independent product** (Kata Code) without waiting on upstream contribution policy.
2. **Keep pulling upstream fixes and features** via merge-based sync, not ad-hoc cherry-picks.
3. **Minimize merge pain** by isolating fork-only code and completing branding renames early.
4. **Preserve MIT attribution** for upstream code and vendored dependencies.

## Non-goals (for now)

- Contributing changes back upstream (upstream is not actively accepting large PRs).
- Staying wire-compatible with upstream desktop auto-update channels or npm `t3` package.
- Maintaining feature parity with upstream cloud/Kata Code Connect unless explicitly chosen.

---

## Identity map

Decide these once, then execute Phase 1 in a single focused branch.

| Upstream                 | Kata Code                      | Status   |
| ------------------------ | ------------------------------ | -------- |
| Product name             | Kata Code                      | **Done** |
| GitHub repo              | `gannonh/kata-code`            | **Done** |
| npm scope                | `@kata-sh/code`                | **Done** |
| CLI binary               | `katacode`                     | **Done** |
| Monorepo root package    | `@kata-sh/code-monorepo`       | **Done** |
| Env prefix               | `KATACODE_*`                   | **Done** |
| State dir default        | `~/.katacode` (was `~/.t3`)    | **Done** |
| Desktop display name     | Kata Code (Dev) / Kata Code    | **Done** |
| Desktop bundle id (prod) | `com.katacode.app`             | **Done** |
| Desktop bundle id (dev)  | `com.katacode.dev.<suffix>`    | **Done** |
| URL protocol             | `katacode` / `katacode-dev`    | **Done** |
| Published npm package    | `@kata-sh/code-cli` (not `t3`) | **Done** |

> **CLI split:** `@kata-sh/cli` owns the `kata` binary (platform/harness). This fork
> ships `@kata-sh/code-cli` with binary `katacode` — do not reuse `kata`.

### npm package naming (`@kata-sh/code`)

Scope is `@kata-sh`; workspace packages use the `code-*` suffix:

| Current (`@t3tools/*`)               | Target (`@kata-sh/*`)                     |
| ------------------------------------ | ----------------------------------------- |
| `@t3tools/monorepo`                  | `@kata-sh/code-monorepo`                  |
| `@t3tools/web`                       | `@kata-sh/code-web`                       |
| `@t3tools/desktop`                   | `@kata-sh/code-desktop`                   |
| `@t3tools/marketing`                 | `@kata-sh/code-marketing`                 |
| `@t3tools/mobile`                    | `@kata-sh/code-mobile`                    |
| `@t3tools/contracts`                 | `@kata-sh/code-contracts`                 |
| `@t3tools/shared`                    | `@kata-sh/code-shared`                    |
| `@t3tools/client-runtime`            | `@kata-sh/code-client-runtime`            |
| `@t3tools/ssh`                       | `@kata-sh/code-ssh`                       |
| `@t3tools/tailscale`                 | `@kata-sh/code-tailscale`                 |
| `@t3tools/scripts`                   | `@kata-sh/code-scripts`                   |
| `@t3tools/oxlint-plugin-t3code`      | `@kata-sh/code-oxlint-plugin`             |
| `t3` (server, `apps/server`)         | `@kata-sh/code-cli` (`bin`: `katacode`)   |
| `@t3tools/mobile-terminal-native`    | `@kata-sh/code-mobile-terminal-native`    |
| `@t3tools/mobile-review-diff-native` | `@kata-sh/code-mobile-review-diff-native` |

### Brand logo marks

Canonical icon source and desktop packaging assets live under `apps/desktop/resources/`:

| Asset                    | Path                                | Use                                                                          |
| ------------------------ | ----------------------------------- | ---------------------------------------------------------------------------- |
| Master raster            | `apps/desktop/resources/source.png` | Source for all production rasters and platform icons                         |
| Vector mark              | `apps/desktop/resources/icon.svg`   | Web `logo-mark.svg`, `assets/prod/logo.svg`                                  |
| macOS icons              | `AppIcon.icns`, `icon.icns`         | Desktop releases (`CFBundleIconName: AppIcon`)                               |
| Windows / Linux          | `icon.ico`, `icon.png`, `icons/`    | Desktop release targets                                                      |
| Liquid Glass (macOS 26+) | `liquid-glass/Assets.car`           | Copied into release `.app` by `apps/desktop/scripts/electron-after-pack.cjs` |

Legacy SVG tiles (`assets/logo-square-dark.svg`, `assets/logo-square-light.svg`) remain for marketing/light backgrounds only.

Regenerate production outputs from the master raster:

```bash
pnpm run generate:brand-rasters
```

This runs `scripts/generate-prod-brand-rasters.mjs` (uses `sips` + ImageMagick) and `apps/desktop/resources/generate-icons.sh` for platform icon sets. Outputs land in `assets/prod/*` and `apps/web/public/*`. Paths are declared in `scripts/lib/brand-assets.ts`.

**Channels:** dev server builds, hosted nightly, and production all ship the same production Kata icons (blueprint/T3 dev artwork removed).

**Desktop packaging gotcha:** staged release builds invoke `electron-builder` via `@kata-sh/code-desktop`. The `afterPack` path in `scripts/build-desktop-artifact.ts` must be relative to `apps/desktop` (e.g. `scripts/electron-after-pack.cjs`), not `apps/desktop/scripts/...` — otherwise electron-builder doubles the path and all platform builds fail.

Mobile production icon composer uses `apps/mobile/assets/icon-composer-prod.icon/Assets/logo-mark.svg` (sync from `icon.svg` when the mark changes).

> Dev desktop bundle IDs derive from the repo folder name (`katacode`) in
> `apps/desktop/scripts/electron-launcher.mjs`. Production bundle id, display names,
> and URL protocols use Kata Code branding.

---

## Phase 0 — Git remotes (complete)

```bash
cd /Volumes/EVO/dev/katacode
git remote -v
# origin   → gannonh/kata-code
# upstream → pingdotgg/t3code
```

Clone convention for new machines:

```bash
git clone https://github.com/gannonh/kata-code.git
cd katacode
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream --tags
```

---

## Phase 1 — Branding and rename (do this first)

Complete before large feature work. One branch, one merge to `main`, then tag
`v0.1.0-katacode` (or similar) as the first fork-native release.

### 1.1 Package and import renames

Search targets (approximate counts will drop after renames):

```bash
# from repo root
rg -l '@t3tools/' --glob '!node_modules' --glob '!.git' --glob '!.repos'
rg -l 't3code' --glob '!node_modules' --glob '!.git' --glob '!.repos'
rg -l 'KATACODE_' --glob '!node_modules' --glob '!.git' --glob '!.repos'
```

Primary files and directories:

| Area          | Paths                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Workspace     | `package.json`, `pnpm-workspace.yaml`, all `apps/*/package.json`, all `packages/*/package.json` |
| Server CLI    | `apps/server/package.json` (`name`, `bin`, `repository`)                                        |
| Oxlint plugin | `oxlint-plugin-kata-code/` → rename dir + package to `oxlint-plugin-kata-code`                  |
| Relay infra   | `infra/relay/package.json`, `infra/relay/README.md`                                             |
| Import paths  | Every `from "@t3tools/..."` across `apps/`, `packages/`, `scripts/`                             |
| VP filters    | Root `package.json` scripts using `--filter @t3tools/...`                                       |

Suggested approach:

1. Rename package `name` fields and `pnpm-workspace.yaml` entries.
2. Run `vp i` and fix broken workspace links.
3. Bulk-replace import specifiers (`@t3tools/` → `@kata-sh/code-*` per table above).
4. Rename `oxlint-plugin-kata-code` directory and update lint config references.
5. `vp check && vp run typecheck`

### 1.2 Runtime env and state dirs

High-touch paths:

| File / area                                  | What changes                                          |
| -------------------------------------------- | ----------------------------------------------------- |
| `scripts/dev-runner.ts`                      | `KATACODE_*` env wiring, dev ports, mode flags        |
| `scripts/lib/public-config.ts`               | Public config env keys                                |
| `apps/server/src/cli/`                       | CLI flags, help text, default paths                   |
| `apps/desktop/scripts/electron-launcher.mjs` | `APP_DISPLAY_NAME`, `APP_BUNDLE_ID`, protocol schemes |
| `apps/desktop/package.json`                  | `productName`                                         |
| `packages/shared/`                           | Any hard-coded `~/.t3` or `KATACODE_` references      |

Prefer a short compatibility shim during transition (read both `T3CODE_*` and
`KATACODE_*`) only if you need parallel installs. Remove shims once stable.

### 1.3 User-facing docs

| File                                  | Action                                              |
| ------------------------------------- | --------------------------------------------------- |
| `README.md`                           | Rewrite for Kata Code; link to upstream attribution |
| `AGENTS.md`                           | Update project snapshot; link to this file          |
| `docs/index.md` (OKF bundle)          | Fork docs map; see `docs/specs/fork-setup.md`       |
| `docs/getting-started/quick-start.md` | Update install/run commands                         |
| `CONTRIBUTING.md`                     | Replace with fork contribution policy               |

Keep a short **Attribution** section in `README.md` crediting T3 Code (MIT).

### 1.4 Verification gate

```bash
vp i
vp run --filter @kata-sh/code-desktop ensure:electron   # update filter after rename
vp check
vp run typecheck
pnpm run dev          # web
pnpm run dev:desktop  # electron
```

---

## Phase 2 — Infrastructure split

Decouple fork CI/CD and distribution from upstream.

**Workflow policy:** inactive workflows live in `.github/disabled/` (GitHub does not run them). Active workflows are in `.github/workflows/` with no branch-name skip gates. See [`.github/disabled/README.md`](../.github/disabled/README.md).

### 2.1 GitHub Actions

Review and fork-customize:

| Workflow                                  | Purpose               | Action                                                                |
| ----------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                | PR checks             | Keep; remove upstream-only secrets                                    |
| `.github/workflows/release.yml`           | Desktop/npm releases  | **Active** — fork signing, GitHub Release, hosted web deploy          |
| `.github/disabled/deploy-relay.yml`       | Relay deploy          | **Disabled** — re-point to fork infra in Phase 2                      |
| `.github/disabled/mobile-eas-preview.yml` | Mobile                | **Disabled** — requires fork Expo project (`KATACODE_EAS_PROJECT_ID`) |
| `.github/workflows/pr-vouch.yml`          | Upstream trust labels | Remove or replace                                                     |
| `.github/workflows/pr-size.yml`           | Size labels           | Optional keep                                                         |
| `.github/workflows/issue-labels.yml`      | Automation            | Review                                                                |

### 2.2 Secrets and cloud config

Upstream-specific — do **not** reuse without explicit intent:

- Clerk / Kata Code Connect (`KATACODE_CLERK_*`, `docs/cloud/`)
- Relay OTLP endpoints (`KATACODE_RELAY_*`)
- Discord release webhooks (`scripts/notify-discord-release.ts`)
- Desktop code signing / notarization certificates
- npm publish tokens for `t3` package

Document fork equivalents in a private runbook (1Password / GitHub env secrets), not
in this repo.

### 2.3 Release channels

- Tag format: `v0.1.0` on `gannonh/kata-code` only.
- Do not push tags to `upstream`.
- Disable or rewrite nightly cron in `release.yml` until fork release process is ready.
- Desktop auto-update feed must point at fork release URLs, not `pingdotgg/t3code`.

---

## Phase 3 — Upstream sync runbook

**Policy:** [ADR 0003 — Episodic upstream sync](docs/adrs/0003-episodic-upstream-sync.md). **Operator guide:** [docs/guides/upstream-sync.md](docs/guides/upstream-sync.md).

**Default strategy: merge `upstream/main` (or a pinned upstream SHA) on a sync branch.** Use cherry-pick only for individual hotfixes when a full merge is not ready. Kata Code does **not** target upstream parity.

### When to sync

- When there is a **concrete reason** (security, reliability, provider/protocol change, or a bounded upstream feature set worth absorbing), or
- Before starting large fork features that touch `contracts`, `server`, or `web` (optional prep sync), or
- When you need a specific upstream fix (prefer cherry-pick if a full merge is not ready).

Do **not** sync on a fixed weekly schedule solely because upstream is active.

### Step-by-step

```bash
cd /Volumes/EVO/dev/katacode

# 1. Update local upstream refs
git fetch upstream --tags

# 2. Create sync branch from your main
git checkout main
git pull origin main
git checkout -b upstream-sync-$(date +%Y-%m-%d)

# 3. Merge upstream (prefer merge over rebase for hard forks)
git merge upstream/main
# resolve conflicts — see "High-conflict zones" below

# 4. Sync vendored reference repos if deps changed
vp run sync:repos
# or: node scripts/sync-reference-repos.ts

# 5. Reinstall and verify
vp i
vp run --filter @kata-sh/code-desktop ensure:electron
vp check
vp run typecheck
vp test

# 6. Merge sync branch to main
git checkout main
git merge upstream-sync-$(date +%Y-%m-%d)
git push origin main

# 7. Update this file's "Last upstream sync" block
```

### High-conflict zones

Expect conflicts where both fork and upstream edit the same surfaces:

| Zone                         | Why                                       |
| ---------------------------- | ----------------------------------------- |
| `packages/contracts/`        | Protocol/schema changes ripple everywhere |
| `packages/shared/`           | Shared runtime utilities                  |
| `apps/server/`               | Provider wiring, CLI, session lifecycle   |
| `apps/web/`                  | UI state, WebSocket client, session UX    |
| `apps/desktop/`              | Electron main, backend manager, branding  |
| `scripts/dev-runner.ts`      | Dev env and ports                         |
| `pnpm-lock.yaml`             | Always regenerate with `vp i` after merge |
| `package.json` (root + apps) | Scripts, filters, version bumps           |

**Low-conflict strategy:** keep fork-only features in new modules/packages where
possible instead of editing upstream core files.

### Selective cherry-pick (exception path)

```bash
git fetch upstream
git cherry-pick <upstream-commit-sha>
```

Use when:

- You need one bugfix between scheduled merges.
- A merge is blocked but a security/reliability fix is urgent.

Always record cherry-picked SHAs in the divergence log below.

### Rejecting upstream changes

If you intentionally skip an upstream feature, log it:

```markdown
### Rejected upstream

- `<sha>` — <reason> — <date>
```

---

## Phase 4 — Divergence boundaries

Structure fork-specific work to reduce merge cost.

### Put fork-only code here

| Prefer                              | Avoid                                             |
| ----------------------------------- | ------------------------------------------------- |
| New package under `packages/kata-*` | Sprinkling `if (katacode)` in upstream core       |
| New app under `apps/kata-*`         | Editing `packages/contracts` for fork-only fields |
| Adapter layer at provider boundary  | Renaming upstream types in place                  |
| `docs/specs/` for fork specs/ADRs   | Rewriting upstream architecture docs in place     |

### Vendored reference repos (`.repos/`)

Separate from git upstream sync. When upstream bumps Effect/Alchemy deps:

```bash
vp run sync:repos
# or sync one repo:
node scripts/sync-reference-repos.ts --repo <id>
```

Do not edit `.repos/` except via sync tooling (see `AGENTS.md`).

---

## Phase 5 — Ongoing maintenance

### Pre-merge checklist (fork PRs)

- [ ] `vp check`
- [ ] `vp run typecheck`
- [ ] Tests for touched packages
- [ ] No accidental upstream secret/config commits
- [ ] `FORK.md` updated if sync policy or divergence changed

### Post-upstream-sync checklist

- [ ] Conflict resolutions reviewed (not just accepted ours/theirs blindly)
- [ ] Branding rename intact (no `@t3tools` regression)
- [ ] `pnpm run dev` and `pnpm run dev:desktop` smoke-tested
- [ ] Desktop `ensure:electron` still passes on CI
- [ ] Last sync SHA recorded in this file

### Agent instructions

Coding agents working in this repo should:

1. Read `FORK.md` before large refactors or upstream merges.
2. Read [`docs/index.md`](docs/index.md) (OKF bundle) for specs, ADRs, and architecture context.
3. Prefer merge-based upstream sync over cherry-pick unless asked otherwise.
4. Never push to `upstream` remote.
5. Keep MIT notices in files with substantial upstream-derived code.

---

## Divergence log

Record intentional permanent differences from upstream.

### Rejected upstream

_(none yet)_

### Deferred upstream wire compatibility (Phase 2)

Until relay/mobile hosted infra splits, these wire identifiers stay upstream-shaped. See `packages/contracts/src/wireIdentity.ts`:

- Relay provider kind `kata_relay`
- OAuth client IDs `kata-mobile`, `kata-web`
- Environment well-known path `/.well-known/kata/environment`
- Connect API prefix `/api/kata-connect`

### Internal Electron static protocol

The packaged desktop app still registers an internal `t3://` scheme for bundled static assets (`apps/desktop/src/electron/ElectronProtocol.ts`). User-facing deep links use `katacode://` / `katacode-dev://`. Renaming the internal scheme is deferred to Phase 2 to avoid breaking bundled asset resolution.

### Fork-only features

_(none yet)_

### Cherry-picks (outside full merges)

_(none yet)_

---

## Quick reference

```bash
# remotes
git remote -v
git fetch upstream

# dev
vp i
pnpm run dev
pnpm run dev:desktop

# upstream sync
git checkout -b upstream-sync-$(date +%Y-%m-%d)
git merge upstream/main

# verify
vp check && vp run typecheck
```

## License

Upstream `apps/server` is MIT. This fork must retain copyright notices and add
attribution for derived work. See upstream license files and `THIRD_PARTY_NOTICES.md`
in app packages.
