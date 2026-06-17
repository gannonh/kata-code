---
type: Runbook
title: "Release runbook"
description: "How to cut a KataCode stable or nightly release."
tags: [operations, runbook, release]
timestamp: 2026-06-17T15:00:00Z
---

# Release runbook

Merging to `main` runs CI only — **not** a release. Releases are triggered explicitly.

**Prerequisite:** [Release setup](./release-setup.md) completed (secrets present). If a dry run fails on signing, fix setup first.

## 1. Local checks

On `main`, with the ship candidate merged:

```bash
git checkout main && git pull

vp check
vp run typecheck
vp run test
vp run release:smoke
```

## 2. Dry run

Confirms CI gates + macOS signing secrets. Does not build or publish.

```bash
gh workflow run release.yml -R gannonh/katacode \
  -f dry_run=true \
  -f channel=stable

gh run watch -R gannonh/katacode --workflow=release.yml
```

Pass criteria: **Validate macOS signing inputs** succeeds.

## 3. Choosing the version

| Channel     | Who picks the version? | How                            |
| ----------- | ---------------------- | ------------------------------ |
| **Stable**  | **You**                | See below                      |
| **Nightly** | **Workflow**           | Automatic — no `version` input |

### Stable — pick the next semver

1. Check what is already shipped:

```bash
gh release list -R gannonh/katacode --limit 5
node -p "require('./apps/desktop/package.json').version"
```

2. Choose the next **semver** (`MAJOR.MINOR.PATCH`):
   - **Patch** (`0.0.27` → `0.0.28`) — bugfixes, small changes (most releases)
   - **Minor** (`0.0.27` → `0.1.0`) — new features, backward compatible
   - **Major** (`0.0.27` → `1.0.0`) — breaking changes

3. Use that number in the stable command (step 4) or tag (`v0.0.28`).

`apps/desktop/package.json` on `main` is the source of truth **between** releases. After a successful stable release, the workflow bumps it to match the version you released. Your chosen stable version should normally be **≥ package.json** and **> last stable GitHub Release** (unless you intentionally ship a prerelease).

**Prerelease** (`1.2.3-rc.1`): same flow; npm publishes dist-tag **`next`**, not `latest`.

### Nightly — automatic

No version to choose. The workflow reads `apps/desktop/package.json`, bumps patch by 1, and appends date + run number:

```text
{patch+1}-nightly.{YYYYMMDD}.{run}
```

Example: package.json `0.0.27` → tag `v0.0.28-nightly.20260617.578`.

## 4. Stable release

Release current `main` HEAD:

```bash
gh workflow run release.yml -R gannonh/katacode \
  -f channel=stable \
  -f version=0.0.28
```

Alternative — tag a specific commit (version comes from the tag name):

```bash
git tag v0.0.28 && git push origin v0.0.28
```

### Verify stable

```bash
gh run watch -R gannonh/katacode --workflow=release.yml
gh release view v0.0.28 -R gannonh/katacode
```

| Check                | What to confirm                                                            |
| -------------------- | -------------------------------------------------------------------------- |
| **Workflow**         | Build, Publish release, Deploy, Finalize all green                         |
| **GitHub Release**   | `.dmg`, `.AppImage`, `.exe` attached                                       |
| **Web**              | https://app.kata.sh and https://latest.app.kata.sh load                    |
| **npm**              | `npm view @kata-sh/code-cli version` and `dist-tags.latest` match `0.0.28` |
| **macOS** (optional) | Download `.dmg`; `codesign --verify` + `spctl --assess` on the app         |

## 5. Nightly release

Release current `main` HEAD (version computed automatically — step 3):

```bash
gh workflow run release.yml -R gannonh/katacode \
  -f channel=nightly
```

### Verify nightly

```bash
gh run watch -R gannonh/katacode --workflow=release.yml
gh release list -R gannonh/katacode --limit 3   # newest tag ends with -nightly.*
```

| Check              | What to confirm                                        |
| ------------------ | ------------------------------------------------------ |
| **Workflow**       | Build, Publish release, Deploy green (no Finalize job) |
| **GitHub Release** | New `v*-nightly.*` tag with desktop artifacts          |
| **Web**            | https://nightly.app.kata.sh loads                      |
| **npm**            | `npm view @kata-sh/code-cli dist-tags.nightly` updated |

## Quick reference

```bash
# Last shipped + current package.json version
gh release list -R gannonh/katacode --limit 5
node -p "require('./apps/desktop/package.json').version"

# Local gates
vp check && vp run typecheck && vp run test && vp run release:smoke

# Dry run
gh workflow run release.yml -R gannonh/katacode -f dry_run=true -f channel=stable

# Stable (you supply version)
gh workflow run release.yml -R gannonh/katacode -f channel=stable -f version=0.0.28

# Nightly (version automatic)
gh workflow run release.yml -R gannonh/katacode -f channel=nightly

# Watch any release run
gh run watch -R gannonh/katacode --workflow=release.yml
```

## Related

- [Release setup](./release-setup.md) — secrets and infrastructure
- [CI](./ci.md)
- [Phase 2 release spec](../specs/2026-06-16-phase-2-desktop-web-release-design.md)
