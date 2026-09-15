# Release Checklist

> For maintainers. Using Kata Code? See [docs/user](../user/).

This document covers the unified release workflow for stable and nightly desktop releases.

## What the workflow does

- Workflow: `.github/workflows/release.yml`
- Triggers:
  - manual `workflow_dispatch` with `channel=stable`, the normal way to ship stable
  - push tag matching `v*.*.*` for a stable release of an explicit commit
  - scheduled nightly check every 30 minutes
  - manual `workflow_dispatch` with `channel=nightly`
  - manual `workflow_dispatch` with `channel=preview`, the maintainers' test train. It builds, signs, notarizes, tests, and publishes a commit that users must select explicitly. Preview uses nightly versioning under the `preview` prerelease identifier (`0.0.41-preview.<date>.<run>`) and publishes a GitHub prerelease plus npm packages under the `preview` dist-tag. No schedule or default npm dist-tag selects preview. Preview desktop builds have no update feed, and the GitHub release omits updater manifests and blockmaps. Install one by downloading the release, running `npx @kata-sh/code-cli@preview`, setting `KATACODE_CHANNEL=preview` for an install script, or running `katacode update --channel preview`. The CLI warns before entering the channel. The release body also warns that the build is for testing. The hosted web app is skipped.
  - manual `workflow_dispatch` with `dry_run=true` builds and tests the release matrix without trusted signing, notarization, publishing, deployment, or finalization.
- A manual stable release builds the commit of the latest published nightly, not `main` HEAD.
  Nightly is the release candidate: verify the nightly, then promote it. Merges to `main` keep
  landing while you verify and never leak into the stable build.
  - The version defaults to the one the nightly previewed (`0.0.39-nightly.*` ships as `0.0.39`).
    Pass the `version` input to override it, for example for a minor bump.
  - The stable tag is created on the nightly's commit when the GitHub Release is published.
  - Pushing a `vX.Y.Z` tag by hand still works and builds exactly the tagged commit. Use it when
    the commit to ship is not the latest nightly, such as a cherry-picked fix on a release branch.
- Runs lint, typecheck, and tests alongside artifact builds. Publishing waits for every check.
- Reads the shared production Kata Code Connect relay URL and Clerk client configuration before packaging clients.
- Builds the platform-independent JS (server bundle, web client, Electron main) once in the `build_bundle` job and hands it to every platform job as the `js-bundle` artifact; the platform jobs only package it, so no runner rebuilds it.
- Builds six desktop artifacts in parallel for both channels, each as its own job (`desktop_<platform>_<arch>`, one call of `release-desktop.yml`) on hardware of its own architecture, gated only on the bundle (the Windows jobs also wait for the same-arch Linux job, whose CLI archive they embed as the WSL runtime):
  - macOS `arm64` DMG
  - macOS `x64` DMG
  - Linux `x64` and `arm64` AppImage
  - Windows `x64` and `arm64` NSIS installer
- Publishes one GitHub Release with all produced files.
  - Renames desktop installers to stable platform and architecture names, rewrites updater
    manifests to reference those names, and adds a platform download table to the release body.
  - Stable tags with a suffix after `X.Y.Z` (for example `1.2.3-alpha.1`) are published as GitHub prereleases.
  - Only plain stable `X.Y.Z` releases are marked as the repository's latest release.
  - Nightly runs are always GitHub prereleases and never marked latest.
  - Automatically generated release notes are pinned to the previous tag in the same channel, so stable compares to the previous stable tag and nightly compares to the previous nightly tag.
- Includes Electron auto-update metadata (for example `latest*.yml`, `nightly*.yml`, and `*.blockmap`) in release assets.
- Builds a self-contained CLI archive per platform (`katacode-<version>-<platform>-<arch>.tar.gz`, `.zip` on Windows) in the same job as that target's desktop artifact and attaches them to the GitHub Release with a `SHA256SUMS` file, on every channel, for five targets: macOS arm64, Linux x64 and arm64, Windows x64 and arm64. Every archive is built, signed, and smoke-tested on hardware of its own architecture. There is no macOS x64 archive: Node single-executables are unsupported on x64 macOS (the SEA docs list macOS as arm64 only) and the binary segfaults on start; the x64 desktop app is Electron and unaffected.
  - The archive holds the server as a Node single-executable (`scripts/build-cli-archive.ts`), so unpacking it needs neither Node, npm, nor a compiler. It is the only form in which Kata Code manages a runtime: the desktop's SSH environments, the boot service, `katacode update`, and the install scripts all download and verify this archive against `SHA256SUMS`. The npm packages exist for people who run `npx @kata-sh/code-cli` or `npm install -g @kata-sh/code-cli` and carry the same archive contents. Product-managed runtimes do not install from npm. The `curl | sh` installers are `scripts/install.sh` and `scripts/install.ps1`; invoke their published copies through the raw URLs in [Install Kata Code](../user/install.md).
  - The executable is built with a Node that supports `--build-sea` (`VP_NODE_VERSION=26.8.2`, kept in step with `SEA_NODE_VERSION` in `apps/server/vite.config.ts`), while the repo stays on `engines.node`.
  - macOS archives are signed with the Developer ID certificate and notarized when the Apple secrets are present (ad hoc otherwise, which still runs from `curl`/`tar` installs). Windows executables use the same Azure Trusted Signing setup as the installer. Every native addon in the macOS archive is signed too, since the hardened runtime refuses unsigned libraries.
  - Each archive is extracted and executed on its build runner (`scripts/smoke-cli-archive.ts`) before it is uploaded.
- Publishes the CLI to npm with OIDC trusted publishing from the same workflow file, as the same bytes the GitHub Release carries: `scripts/build-npm-platform-packages.ts` unpacks the five CLI archives into `@kata-sh/code-cli-<platform>-<arch>` packages. Each package sets `os` and `cpu`, so npm installs only the matching package. The script also generates the `@kata-sh/code-cli` launcher, whose `bin/katacode.js` lists the platform packages as `optionalDependencies` and runs the installed executable. `npx @kata-sh/code-cli` needs Node only to run the launcher. `node apps/server/scripts/cli.ts publish` publishes the platform packages first and the launcher last, after a `--dry-run` pass over all packages.
  - stable releases publish npm dist-tag `latest`
  - nightly releases publish npm dist-tag `nightly`
  - preview releases publish npm dist-tag `preview`, which nothing resolves unless asked for by name
  - one-time setup: the `@kata-sh` npm scope must exist, and `@kata-sh/code-cli` plus each `@kata-sh/code-cli-<platform>-<arch>` package needs a trusted publisher registered for this workflow file (see below).
- Deploys the hosted web app to Vercel only after a release is published:
  - stable releases are aliased to the `latest` hosted app channel
  - nightly releases are aliased to the `nightly` hosted app channel
- Signing is optional and auto-detected per platform from secrets.

## Required release credentials

Stable releases require these GitHub Actions secrets in addition to the platform and deployment
credentials documented below:

- `RELEASE_APP_ID`
- `RELEASE_APP_PRIVATE_KEY`

The finalize job uses them to commit and push aligned package versions to `main` as the Release App.
GitHub Release publication uses the repository-scoped workflow token so it has a rate-limit quota
independent from the shared Release App installation.

## Kata Code Connect relay deployment

The relay is a shared control plane versioned separately from client releases. Stable and nightly
client builds must point at the same relay so users see the same linked environments when switching
release channels.

`.github/workflows/deploy-relay.yml` deploys Alchemy stage `prod` on every push to `main`. The
release workflow reads the relay URL and Clerk client configuration from the existing `production`
GitHub Actions environment before building desktop, CLI, or hosted web artifacts.

Required repository variables shared by relay deployments:

- `CLOUDFLARE_ACCOUNT_ID`
- `PLANETSCALE_ORGANIZATION`
- `AXIOM_ORG_ID`

Required repository secrets shared by relay deployments:

- `CLOUDFLARE_API_TOKEN`
- `PLANETSCALE_API_TOKEN_ID`
- `PLANETSCALE_API_TOKEN`
- `AXIOM_TOKEN`

Required `production` environment variables:

- `RELAY_API_ZONE_NAME`
- `RELAY_TUNNEL_ZONE_NAME`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_JWT_AUDIENCE`
- `CLERK_JWT_TEMPLATE`
- `CLERK_CLI_OAUTH_CLIENT_ID`
- `APNS_ENVIRONMENT`
- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_BUNDLE_ID`

Optional `production` environment variables:

- `RELAY_DOMAIN` when overriding the derived `relay.<RELAY_API_ZONE_NAME>` domain

Required `production` environment secrets:

- `CLERK_SECRET_KEY`
- `APNS_PRIVATE_KEY`

The account-scoped repository credentials are consumed by Alchemy while provisioning relay stages; they
are not bound into the relay Worker. The production deployment uses an Axiom personal access token,
so `AXIOM_ORG_ID` must accompany `AXIOM_TOKEN`. The `prod` stage owns the retained PlanetScale
database. To raise its replica count without replacing the database, follow
[Scale production relay Postgres to HA](relay-planetscale-ha.md). Local personal stages provision
isolated branches from it and are never deployed by CI.
Production adopts the configured relay API and tunnel DNS zones as retained Cloudflare resources.
Personal stages reference the production-owned zones.

Developers deploy personal stages locally rather than through pull-request automation:

```sh
vp run --filter kata-code-relay deploy -- --stage "$USER"
```

## Vercel release projects

The release workflow uses two Vercel projects in the same team:

- The hosted web project, currently `katacode-web`, builds and deploys `apps/web`. `VERCEL_ORG_ID` and
  `VERCEL_PROJECT_ID` identify this project. The Sandbox image job also uses these secrets for
  `Sandbox.create`.
- The Sandbox registry project, currently `kata-code`, owns the VCR repository. `VCR_ORG_ID` and
  `VCR_PROJECT_ID` identify this project.

GitHub Actions secrets are the release source of truth. A local `.vercel/project.json` link does not
configure either release job. Local `E2E_VERCEL_*` variables are also outside the release workflow.
The release smoke test authenticates `Sandbox.create` with the hosted web project. It does not assign
`VCR_ORG_ID` or `VCR_PROJECT_ID` onto `VERCEL_ORG_ID` or `VERCEL_PROJECT_ID`.

Both jobs use `VERCEL_TOKEN`. The token must have access to both projects in the configured team.

## Hosted web app release deployment

The hosted app is intentionally not deployed by Vercel's Git integration. The
web project disables automatic Git deployments in `apps/web/vercel.ts` via
`git.deploymentEnabled: false`, and `.github/workflows/release.yml` deploys the
web app with Vercel CLI after the GitHub Release succeeds. Vite emits
`apps/web/dist`; `apps/web/vercel.ts` sets `outputDirectory` to `dist` so Vercel
does not fall back to `public`.

`VERCEL_PROJECT_ID` must be the hosted web project (`katacode-web`). A CLI
deploy that retrieves the repo-named `kata-code` project runs the repo-root
`pnpm run build` and fails with `No Output Directory named "public"`.
`deploy_web` writes `.vercel/project.json` from `VERCEL_ORG_ID` /
`VERCEL_PROJECT_ID` and refuses a `kata-code` target.

Required GitHub Actions secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`: hosted web app team ID.
- `VERCEL_PROJECT_ID`: hosted web app project ID.

Optional GitHub Actions variables:

- `VERCEL_TEAM_SLUG`: overrides the Vercel CLI scope when the team slug is preferred over the `VERCEL_ORG_ID` secret.
- `KATACODE_WEB_ROUTER_URL`: defaults to `https://app.kata.sh`.
- `KATACODE_WEB_LATEST_DOMAIN`: defaults to `latest.app.kata.sh`.
- `KATACODE_WEB_NIGHTLY_DOMAIN`: defaults to `nightly.app.kata.sh`.

Required Vercel domains:

- `app.kata.sh`: the router domain users open, updated by stable releases.
- `latest.app.kata.sh`: channel alias updated by stable releases.
- `nightly.app.kata.sh`: channel alias updated by nightly releases.

The router domain uses the hosted-web `vercel.ts` routes. Users opt into a
channel by visiting `/__katacode/channel?channel=latest` or
`/__katacode/channel?channel=nightly`; the router stores the
`katacode_web_channel` cookie and rewrites future requests on `app.kata.sh` to
the matching channel alias.

The release deploy job rewrites release package versions before upload so the
hosted app's About panel renders the release version. Stable deploys alias the
same deployment to both the `latest` channel and the router domain so the router
rules stay current. Nightly deploys only alias the `nightly` channel. The job
also passes `VITE_HOSTED_APP_CHANNEL=latest|nightly`, which renders the hosted
update track selector in the About panel. Changing the selector navigates
through `/__katacode/channel` on the router domain so the user's channel cookie is
updated before redirecting to the hosted app root.

One-time Vercel dashboard setup:

1. Confirm the web project root directory remains `apps/web` and the project
   slug is `katacode-web`. Do not set Output Directory to `public`.
2. Add the three domains above to the web project.
3. Disable automatic Git deployments in the dashboard if desired; the committed
   `vercel.ts` setting is the source-of-truth, but disconnecting Git in the
   dashboard is also safe.
4. Run one stable release deployment, or manually alias the current stable
   deployment, so `app.kata.sh` points at a deployment containing the router
   rules in `apps/web/vercel.ts`. Future stable releases keep this alias current.

## Sandbox image release

Required GitHub Actions secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`: hosted web app team ID, used by `Sandbox.create`.
- `VERCEL_PROJECT_ID`: hosted web app project ID, used by `Sandbox.create`.
- `VCR_ORG_ID`: Sandbox registry team ID.
- `VCR_PROJECT_ID`: Sandbox registry project ID.

Optional GitHub Actions variables:

- `VERCEL_TEAM_SLUG`: overrides the Vercel CLI scope when the team slug is preferred over the
  `VCR_ORG_ID` secret.
- `VERCEL_PROJECT_SLUG`: VCR project slug when it differs from `kata-code`.
- `KATACODE_SANDBOX_IMAGE_REPOSITORY`: VCR repository used by Vercel workloads. The default is
  `vcr.vercel.com/astro-labs/kata-code/kata-sandbox`.

The Sandbox image job publishes each exact release tag to VCR and
`ghcr.io/gannonh/kata-sandbox`. VCR serves authenticated Vercel workloads. GHCR serves anonymous
Docker pulls. The job injects hosted `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` for `Sandbox.create`.
Registry login, `vcr config`, and readiness polling use `VCR_*`.
A second `docker pull` of the same index digest fails with `cannot overwrite digest`.

The first GHCR publish creates a private package. Open the package settings, change its visibility
to public, and rerun the failed release. The anonymous manifest check must pass before the workflow
publishes `sandbox-image.json`.

To inspect the release configuration without printing secret values, run:

```sh
gh secret list -R gannonh/kata-code | rg '^(VERCEL|VCR)_'
```

To verify a published tag without Docker credentials, run:

```sh
anonymous_config="$(mktemp -d)"
docker --config "$anonymous_config" manifest inspect \
  "ghcr.io/gannonh/kata-sandbox:<version>"
```

The inspection must return one OCI index containing `linux/amd64` and `linux/arm64`. A `401`
response means the GHCR package is not anonymously readable. `manifest unknown` means the requested
tag does not exist. Check the Sandbox image job before changing `VERCEL_TOKEN`.

## Nightly builds

- Workflow: `.github/workflows/release.yml`
- Triggers:
  - scheduled check every 30 minutes
  - manual `workflow_dispatch` with `channel=nightly`
- Runs the same desktop quality gates and artifact matrix as the tagged release flow.
- Publishes a GitHub prerelease only:
  - current tag format: `vX.Y.Z-nightly.YYYYMMDD.<run_number>`
  - `nightly-v...` is accepted only as a legacy previous-nightly tag
  - release name includes the short commit SHA
  - `make_latest` is always `false`
- Uses the next stable patch version as the nightly base. For example, `0.0.17` produces nightlies on `0.0.18-nightly.*`.
- Publishes Electron auto-update metadata to the dedicated `nightly` updater channel, so desktop users can opt into that track independently from stable.
- Publishes the CLI npm packages (`@kata-sh/code-cli` and `@kata-sh/code-cli-<platform>-<arch>`) to the `nightly` npm dist-tag using the same nightly version.
- Does not commit version bumps back to `main`.

## Server self-update release invariant

Connected servers update to the client's exact version, not to an npm dist-tag. Every released
desktop or hosted client version must therefore have a matching `@kata-sh/code-cli@<version>` package available on
npm before users can receive that client.

The workflow enforces this ordering:

1. `publish_cli` publishes the exact release version to npm, on every channel.
2. `release` depends on `publish_cli` before exposing desktop artifacts in GitHub Releases.
3. `deploy_web` depends on `release` before moving the hosted channel to the new client.

Preserve these dependencies when changing the release graph. Publishing a client first would leave
the **Update server** action targeting a package version that does not exist yet.

For a release smoke test, confirm `npm view @kata-sh/code-cli@<version> version` returns the expected version, then
connect the new client to a server on the previous version and verify that the update action
reconnects to the matching server. When the release adds database migrations, verify that the
remote update applies them and reconnects. A failed trial must restore the database snapshot and
restart the previous server. If the installed launcher does not support the target protocol,
verify that the update stops before restart and run `npx @kata-sh/code-cli@<version> service update`
once on the server machine. Also test manual and desktop-managed guidance when available.

## Desktop auto-update notes

- Updater runtime: `apps/desktop/src/updates/DesktopUpdates.ts`.
- `electron-updater` adapter: `apps/desktop/src/electron/ElectronUpdater.ts`.
- `apps/desktop/src/main.ts` only wires the updater layers into the desktop runtime.
- Update UX:
  - Background checks run on startup delay + interval.
  - No automatic download or install.
  - The desktop UI shows a rocket update button when an update is available; click once to download, click again after download to restart/install.
- Provider: GitHub Releases (`provider: github`) configured at build time.
- Repository slug source:
  - `KATACODE_DESKTOP_UPDATE_REPOSITORY` (format `owner/repo`), if set.
  - otherwise `GITHUB_REPOSITORY` from GitHub Actions.
- Required release assets for updater:
  - platform installers (`.exe`, `.dmg`, `.AppImage`, plus macOS `.zip` for Squirrel.Mac update payloads)
  - channel metadata: `latest*.yml` for stable releases, `nightly*.yml` for nightly releases
  - `*.blockmap` files (used for differential downloads)
- macOS metadata note:
  - `electron-updater` reads `latest-mac.yml` on stable and `nightly-mac.yml` on nightly, for both Intel and Apple Silicon.
  - The workflow merges the per-arch mac manifests into one channel-specific mac manifest before publishing the GitHub Release.

### Windows payload topology and update validation

Windows packages the bundled server and only its runtime-external/native
dependency closure in `resources/server.asar`. Native modules and helper
executables declared as unpacked by that archive must be present at the matching
paths below `resources/server.asar.unpacked`. The Windows-native backend reads
the archive in place through Electron. Packaged Windows builds also ship
`resources/wsl-runtime.tar.gz` plus its SHA-256 sidecar: the Linux CLI archive
(`katacode-<version>-linux-<arch>.tar.gz`, the same arch as the Windows host) built
by the Linux desktop job and handed to the Windows desktop build as
`--wsl-runtime`, copied in verbatim so WSL runs the exact bytes a Linux user
downloads. WSL verifies and extracts that archive
into `~/.katacode/wsl-runtime/sha256-<archive-digest>` inside the selected distro,
then reuses it for later launches of the same update.

Windows keeps JavaScript and package metadata inside `app.asar` and unpacks only
native libraries and helper executables. Avoid enabling whole-package smart
unpacking: each loose file adds work to NSIS installation and counts against
the payload limit.

The artifact builder rejects a Windows package when any of these invariants
break:

- `resources/server.asar` is absent or does not contain the server entry.
- Any file marked unpacked in the ASAR header is absent from
  `resources/server.asar.unpacked`.
- On same-architecture Windows builds, the packaged primary cannot load the fff
  native library from inside `server.asar` through its `.unpacked` sibling.
- The isolated, extracted sidecar cannot load the server entry with plain Node.
- A Windows build given `--wsl-runtime` omits the WSL archive or SHA-256
  sidecar, or the sidecar digest does not match the emitted archive.
- The emitted WSL archive is not a Linux CLI release archive: it must unpack to
  a single `katacode-<version>-linux-<arch>` directory holding `katacode`, `client/`, and
  `node_modules/` with the Linux node-pty binary, and must not carry a loose
  server bundle (`bin.mjs`).
- The external Windows resource monitor is absent.
- The unpacked Windows application contains more than 80 files.

Cross-architecture Windows builds retain every structural and extracted-sidecar
check, but skip executing the target Electron binary. A same-architecture build
for each release target must exercise the primary native-load probe.

NSIS differential packaging remains enabled. A sidecar layout transition can
produce a larger one-time download; subsequent small releases retain their
blockmaps, with a 60 MB maximum for a representative sidecar-to-sidecar update.

## 0) npm OIDC trusted publishing setup (CLI)

The workflow runs `node scripts/build-npm-platform-packages.ts` on the downloaded CLI archives, then
`node apps/server/scripts/cli.ts publish --packages-dir npm-packages`, which runs `npm publish` on
each `@kata-sh/code-cli-<platform>-<arch>.tgz` and finally on `@kata-sh/code-cli.tgz`, the launcher. The script publishes
tarballs it built itself rather than directories: `npm publish <dir>` strips `node_modules/` from the
tarball no matter what `files` says, and the executable loads its native addons from there. Six
packages are published per release: `@kata-sh/code-cli`, `@kata-sh/code-cli-darwin-arm64`,
`@kata-sh/code-cli-linux-arm64`, `@kata-sh/code-cli-linux-x64`,
`@kata-sh/code-cli-win32-arm64`, and `@kata-sh/code-cli-win32-x64`.

Checklist:

1. Confirm that the `@kata-sh` scope exists on npm and owns `@kata-sh/code-cli`.
2. For `@kata-sh/code-cli` and each `@kata-sh/code-cli-<platform>-<arch>` package, configure a Trusted Publisher in the
   npm package settings:
   - Provider: GitHub Actions
   - Repository: this repo
   - Workflow file: `.github/workflows/release.yml`
   - Environment (if used): match your npm trusted publishing config
   - Allowed actions: `npm publish`

   Trusted publishing cannot create a package: npm only offers the settings page once the name
   exists. Bootstrap a new name once from a logged-in account, for example
   `npx setup-trusted-publishing --access public` in a directory whose `package.json` names the
   package, which publishes a `0.0.0` stub; then configure its Trusted Publisher. `publish_cli`'s
   `--dry-run` step does not detect a missing publisher, because `npm publish --dry-run` only warns
   that it is unauthenticated and still exits zero. The real publish reports the problem as
   `ENEEDAUTH` or `404`. npm also processes a newly created package's first publishes
   asynchronously ("Your package is being processed and may take a few minutes to become
   available"), so before dispatching a release confirm each name resolves with
   `npm view <package> version`.

3. Ensure npm account and org policies allow trusted publishing for every package.
4. Create release tag `vX.Y.Z` and push; workflow will:
   - build and smoke-test the five CLI archives
   - build the npm packages from those archives
   - publish them with npm dist-tag `latest`
5. Nightly runs publish with npm dist-tag `nightly`; preview runs with `preview`.

## 1) Release validation and unsigned builds

Use `workflow_dispatch` with `dry_run=true` to run the quality gates, build the Sandbox image, and
build the full desktop and CLI matrix without publishing. If you omit the version, the workflow
uses `0.0.0-dryrun.<run>`. Dry runs skip trusted signing, notarization, npm publication, GitHub
Release publication, hosted deployment, and finalization.

A normal nightly dispatch publishes a real nightly npm package, GitHub prerelease, desktop updater
release, and hosted nightly alias. A preview dispatch also publishes artifacts, but only to the
explicit preview channel. A stable dispatch publishes to the stable channels.

Pushing any accepted non-nightly tag, including `v0.0.0-test.1`, starts a real stable release. Do
not push a test tag to validate the workflow.

## 2) Apple signing + notarization setup (macOS)

Required secrets used by the workflow:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`

Set the `APPLE_TEAM_ID` repository secret to the 10-character Apple Developer Team ID.

Optional API-key notarization credentials (use these instead of Apple ID credentials when available):

- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Optional passkey entitlement secret:

- `MACOS_PROVISIONING_PROFILE` (base64-encoded provisioning profile with Associated Domains)

Optional repository variables:

- `CLERK_PASSKEY_RP_DOMAINS`: comma-separated RP-domain override. By default, the build derives the
  domain from the production Clerk publishable key.

Checklist:

1. Apple Developer account access:
   - Team has rights to create Developer ID certificates.
2. Create an explicit App ID for `com.katacode.app` and enable Associated Domains.
3. Create a `Developer ID Application` certificate. Create a compatible provisioning profile for
   that App ID with Associated Domains enabled only if desktop passkeys are enabled.
4. Export the certificate + private key as `.p12` from Keychain.
5. Base64-encode the `.p12` and store as `CSC_LINK`.
6. If using desktop passkeys, base64-encode the provisioning profile and store it as
   `MACOS_PROVISIONING_PROFILE`.
7. Store the `.p12` export password as `CSC_KEY_PASSWORD`, and set the `APPLE_TEAM_ID`
   repository secret to the 10-character Apple Developer Team ID. Set `APPLE_ID` and an
   app-specific password for notarization.
8. Optionally create an App Store Connect API key (Team key) and set `APPLE_API_KEY`,
   `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` instead of the Apple ID credentials.
9. Complete the Clerk Native API and AASA setup in [Kata Code Connect Clerk Setup](./connect-setup.md#desktop-passkeys).
10. Re-run a tag release and confirm macOS artifacts are signed/notarized. If a provisioning profile
    is configured, confirm the expected `com.apple.developer.associated-domains` entitlement.

Notes:

- `APPLE_API_KEY` is stored as raw key text in secrets.
- The workflow writes it to a temporary `AuthKey_<id>.p8` file at runtime.
- The workflow decodes `MACOS_PROVISIONING_PROFILE`, validates it with `security cms`, and passes it
  to the desktop packager when configured.

## 3) Azure Trusted Signing setup (Windows)

Required secrets used by the workflow:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

Checklist:

1. Create Azure Trusted Signing account and certificate profile.
2. Record ATS values:
   - Endpoint
   - Account name
   - Certificate profile name
   - Publisher name
3. Create/choose an Entra app registration (service principal).
4. Grant service principal permissions required by Trusted Signing.
5. Create a client secret for the service principal.
6. Add Azure secrets listed above in GitHub Actions secrets.
7. Re-run a tag release and confirm Windows installer is signed.

## 4) Ongoing release checklist

1. Pick the latest nightly and verify it: run the smoke test above against its artifacts and
   check the nightly channel for regressions.
2. Dispatch the Release workflow with `channel=stable`. Leave `version` empty unless the version
   should differ from the one the nightly previewed.
3. Confirm the `Resolve release commit` notice names the nightly tag and commit you verified. If a
   newer nightly published in between, the run builds that one instead.
4. Verify workflow steps:
   - preflight passes
   - release quality checks pass
   - `build_bundle` and all platform builds pass
   - `publish_cli` publishes the exact release version before the release job
   - release job uploads expected files
5. Smoke test downloaded artifacts.

## 5) Troubleshooting

- macOS build unsigned when expected signed:
  - Check all Apple secrets plus `APPLE_TEAM_ID` are populated and non-empty.
  - Confirm the provisioning profile belongs to `APPLE_TEAM_ID.com.katacode.app` and includes
    Associated Domains.
- Windows build unsigned when expected signed:
  - Check all Azure ATS and auth secrets are populated and non-empty.
- Build fails with signing error:
  - Retry with secrets removed to confirm unsigned path still works.
  - Re-check certificate/profile names and tenant/client credentials.
