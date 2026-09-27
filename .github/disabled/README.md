# Disabled GitHub Actions workflows

GitHub only runs YAML under [`.github/workflows/`](../workflows/). Nothing here runs.

Phase 2 release publishing is active at [`workflows/release.yml`](../workflows/release.yml).

Active: `workflows/ci.yml`, `workflows/mobile-testflight.yml`, `workflows/release.yml`, and its called `workflows/release-desktop.yml` (`ubuntu-24.04`, `macos-15`).

Parked files are mobile EAS, AUR, PR size, issue labels, web preview, and the Windows release jobs (`release-windows.yml`, a fragment of `release.yml`; see [supported platforms](../../docs/operations/supported-platforms.md)).
