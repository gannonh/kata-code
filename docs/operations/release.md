---
type: Runbook
title: "Release Checklist"
description: "Fork release workflow for KataCode desktop, hosted web, and CLI packages."
tags: [operations, runbook]
timestamp: 2026-06-16T23:30:00Z
---

# Release Checklist

This runbook describes the **KataCode fork** release workflow. Upstream T3 release docs are obsolete for this repository.

## Active workflow

- Workflow: [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
- Triggers:
  - push tag matching `v*.*.*` for stable releases
  - manual `workflow_dispatch` for stable or nightly channels
  - manual `workflow_dispatch` with `dry_run: true` to validate signing inputs without publishing

## Quality gates

Preflight runs before any publish step:

```bash
vp check
vp run typecheck
vp run test
vp run release:smoke
```

## macOS signing and notarization secrets

CI release builds require all five GitHub Actions secrets. Missing values fail macOS build jobs before artifact collection.

| Secret                        | Purpose                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `CSC_LINK`                    | Base64-encoded `.p12` export of the **Developer ID Application** certificate |
| `CSC_KEY_PASSWORD`            | Password used when exporting the `.p12`                                      |
| `APPLE_ID`                    | Apple ID email used for notarization                                         |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID                                      |
| `APPLE_TEAM_ID`               | Apple Developer team ID                                                      |

`APPLE_SIGNING_IDENTITY` can stay in local `.env` for Keychain documentation. CI imports the certificate from `CSC_LINK` / `CSC_KEY_PASSWORD` non-interactively.

### Export the Developer ID Application certificate

1. Open **Keychain Access** on macOS.
2. Select **login** → **My Certificates**.
3. Export the **Developer ID Application: …** certificate as a `.p12` with a strong export password.
4. Base64-encode the `.p12` for `CSC_LINK` (do not commit the `.p12` or encoded file):

```bash
base64 -i path/to/DeveloperIDApplication.p12 -o /tmp/katacode-csc-link.txt
```

5. Store secrets with `gh secret set` (never print secret values in logs or commits):

```bash
gh secret set CSC_LINK < /tmp/katacode-csc-link.txt
gh secret set CSC_KEY_PASSWORD

set -a
source .env
set +a

gh secret set APPLE_ID --body "$APPLE_ID"
gh secret set APPLE_APP_SPECIFIC_PASSWORD --body "$APPLE_APP_SPECIFIC_PASSWORD"
gh secret set APPLE_TEAM_ID --body "$APPLE_TEAM_ID"

gh secret list
```

6. Remove temporary files: `rm /tmp/katacode-csc-link.txt`.

### Dry-run signing validation

Use workflow dispatch with `dry_run: true` to run preflight quality gates and the macOS signing gate without building or publishing:

1. GitHub → Actions → **Release** → **Run workflow**
2. Choose channel (stable/nightly is ignored for dry-run publish steps)
3. Enable **Validate signing inputs and quality gates without publishing**
4. Leave **version** blank for dry runs (stable channel uses a synthetic `0.0.0-dryrun.<run>` version for preflight only)
5. Confirm the **Validate macOS signing inputs** job reports required secret names are present (values are never printed)

Stable-channel prerelease versions (for example `1.2.3-rc.1`) publish `@kata-sh/code-cli` with npm dist-tag `next`, not `latest`.

## What the workflow publishes

- macOS (`arm64`, `x64`), Linux (`x64`), and Windows (`x64`) desktop artifacts to GitHub Releases
- CLI package **`@kata-sh/code-cli`** (`katacode`) with OIDC trusted publishing:
  - stable releases → npm dist-tag `latest`
  - nightly releases → npm dist-tag `nightly`
- Hosted web deploy for `apps/web` on fork domains (`app.kata.sh`, `latest.app.kata.sh`, `nightly.app.kata.sh`)

Optional KataCode Connect public config (`CLERK_*`, `RELAY_*` repository variables) is read when present but does not require relay/cloud VM deploy jobs.

## Hosted web domains

Release deploy defaults to KataCode domains only. Override with repository variables when needed:

| Variable                      | Default               |
| ----------------------------- | --------------------- |
| `KATACODE_WEB_ROUTER_URL`     | `https://app.kata.sh` |
| `KATACODE_WEB_LATEST_DOMAIN`  | `latest.app.kata.sh`  |
| `KATACODE_WEB_NIGHTLY_DOMAIN` | `nightly.app.kata.sh` |

Vercel deploy still requires `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`.

## Local verification before tagging

```bash
vp check
vp run typecheck
vp run test
vp run release:smoke
vp run build:desktop
```

## Post-release macOS verification

After a release build on macOS runners, verify artifacts locally when downloaded:

```bash
codesign --verify --deep --strict --verbose=2 KataCode.app
spctl --assess --type execute --verbose KataCode.app
```

## Troubleshooting

| Symptom                                     | Likely cause                                                      | Fix                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| macOS build fails at signing gate           | Missing one of the five required secrets                          | `gh secret list`; set missing names with `gh secret set`                                               |
| Notarization fails in electron-builder logs | Wrong `APPLE_ID`, expired app-specific password, or team mismatch | Regenerate app-specific password; confirm `APPLE_TEAM_ID` matches the Developer ID cert                |
| `CSC_LINK` import fails                     | Wrong export password or non–Developer ID cert                    | Re-export **Developer ID Application** `.p12`; update `CSC_KEY_PASSWORD`                               |
| Hosted web deploy uses wrong domain         | Missing fork repository variables                                 | Set `KATACODE_WEB_*` vars; defaults never fall back to upstream `app.t3.codes`                         |
| Relay/Clerk features empty in release build | Optional vars unset                                               | Expected for desktop/web-only releases; set `CLERK_*` / `RELAY_*` vars when cloud features are enabled |

## Related

- [CI quality gates](./ci.md)
- [Phase 2 desktop/web release spec](../specs/2026-06-16-phase-2-desktop-web-release-design.md)
- [FORK.md — Phase 2](../../FORK.md#phase-2--infrastructure-split)
