# AUR packaging

This directory maintains the [`t3code-bin`](https://aur.archlinux.org/packages/t3code-bin) and
[`t3code-nightly-bin`](https://aur.archlinux.org/packages/t3code-nightly-bin) packages. Both
repackage the official x86_64 AppImage from GitHub Releases.

## Publishing

AUR publishing is parked at `.github/disabled/publish-aur.yml` until a later phase.
GitHub only runs workflows under `.github/workflows/`; move the file there before any manual
dispatch. Until then, use the release script below to validate a release on Arch Linux.

When enabled, the workflow selects the stable or nightly package, updates its version and
checksums, builds it, regenerates `.SRCINFO`, and pushes it to the AUR.

To validate a release on Arch Linux:

```bash
sudo pacman -Syu --needed base-devel github-cli jq namcap
GH_TOKEN=$(gh auth token) RELEASE_TAG=v0.0.33 \
  packaging/aur/scripts/release.sh
```
