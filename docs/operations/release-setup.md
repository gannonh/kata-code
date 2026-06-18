---
type: Guide
title: "Release setup"
description: "One-time GitHub secrets and repository configuration for Kata Code releases."
tags: [operations, release, setup]
timestamp: 2026-06-17T14:00:00Z
---

# Release setup

Configure this **once** (or when rotating credentials). Day-to-day releases use [Release runbook](./release.md) only.

Workflow: [`.github/workflows/release.yml`](../../.github/workflows/release.yml)

## Required GitHub secrets

| Secret                        | Used for                                            |
| ----------------------------- | --------------------------------------------------- |
| `CSC_LINK`                    | macOS — base64 `.p12` (Developer ID Application)    |
| `CSC_KEY_PASSWORD`            | macOS — `.p12` export password                      |
| `APPLE_ID`                    | macOS notarization                                  |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS notarization                                  |
| `APPLE_TEAM_ID`               | macOS notarization                                  |
| `VERCEL_TOKEN`                | Hosted web deploy                                   |
| `VERCEL_ORG_ID`               | Hosted web deploy                                   |
| `VERCEL_PROJECT_ID`           | Hosted web deploy (`katacode-web`, root `apps/web`) |
| `RELEASE_APP_ID`              | GitHub Release + version bump on `main`             |
| `RELEASE_APP_PRIVATE_KEY`     | GitHub Release + version bump on `main`             |

Verify names (not values):

```bash
gh secret list -R gannonh/kata-code
```

## macOS signing certificate

1. Keychain Access → **login** → **My Certificates**
2. Export **Developer ID Application: …** as `.p12`
3. Base64-encode (do not commit the file):

```bash
base64 -i path/to/DeveloperIDApplication.p12 -o /tmp/katacode-csc-link.txt
```

4. Store secrets:

```bash
gh secret set CSC_LINK -R gannonh/kata-code < /tmp/katacode-csc-link.txt
gh secret set CSC_KEY_PASSWORD -R gannonh/kata-code

set -a && source .env && set +a

gh secret set APPLE_ID -R gannonh/kata-code --body "$APPLE_ID"
gh secret set APPLE_APP_SPECIFIC_PASSWORD -R gannonh/kata-code --body "$APPLE_APP_SPECIFIC_PASSWORD"
gh secret set APPLE_TEAM_ID -R gannonh/kata-code --body "$APPLE_TEAM_ID"

rm /tmp/katacode-csc-link.txt
```

`APPLE_SIGNING_IDENTITY` in local `.env` is for Keychain docs only; CI uses `CSC_LINK`.

## Hosted web (Vercel)

Project: **katacode-web** under team **astro-labs**. Deploy runs from repo root with `rootDirectory: apps/web`.

Repository variable (optional): `VERCEL_TEAM_SLUG=astro-labs`

Domain defaults (override with repository variables if needed):

| Variable                      | Default               |
| ----------------------------- | --------------------- |
| `KATACODE_WEB_ROUTER_URL`     | `https://app.kata.sh` |
| `KATACODE_WEB_LATEST_DOMAIN`  | `latest.app.kata.sh`  |
| `KATACODE_WEB_NIGHTLY_DOMAIN` | `nightly.app.kata.sh` |

`apps/web/vercel.ts` inlines branding constants — Vercel compiles config before the monorepo build. Keep in sync with `packages/shared/src/branding.ts`.

## npm (`@kata-sh/code-cli`)

Stable releases publish with dist-tag `latest`; nightlies use `nightly`; stable prereleases (`1.2.3-rc.1`) use `next`.

1. Publish once from your machine (`npm login`, then `node apps/server/scripts/cli.ts publish ...`) to create the package.
2. On npmjs.com: **Packages → `@kata-sh/code-cli` → Settings → Trusted publishing → GitHub Actions** — org `gannonh`, kata-code, workflow `release.yml`, action `npm publish`.
3. CI uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC); no `NPM_TOKEN` secret.

## Kata Code Connect / relay

Stable and nightly releases require production Connect public config. Relay URL and client tracing values come from deployed Alchemy `prod` state; Clerk public values come from the GitHub `production` environment.

One-time relay infrastructure setup: [Relay deploy setup](./relay-deploy-setup.md)

Legacy note: repository `RELAY_*` vars alone are no longer the release source of truth for relay URL or tracing config after the first production deploy.

## Troubleshooting

| Symptom                                         | Fix                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Dry run fails **Validate macOS signing inputs** | `gh secret list`; set missing `CSC_*` / `APPLE_*` names above                  |
| Notarization fails in build logs                | Regenerate app-specific password; confirm `APPLE_TEAM_ID` matches cert         |
| `CSC_LINK` import fails                         | Re-export Developer ID Application `.p12`; fix `CSC_KEY_PASSWORD`              |
| Web deploy fails                                | Check `VERCEL_*` secrets; confirm Vercel project `rootDirectory` is `apps/web` |
| Wrong web domain                                | Set `KATACODE_WEB_*` vars; defaults never use upstream `app.t3.codes`          |
| `finalize` cannot push to `main`                | Release GitHub App needs bypass or allowlisted push on protected `main`        |

## Related

- [Release runbook](./release.md) — how to cut a release
- [Phase 2 release spec](../specs/2026-06-16-phase-2-desktop-web-release-design.md)
