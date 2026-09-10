# KAT-3307 current-main baseline

Recorded from current main (`251a6bcb5cfad04999a6bdd4c7dbb5bb4c983ff9`) with
base equal to candidate. The upstream refs are the frozen values in `FORK.md`.
The report is observational; live/device/provider evidence is intentionally
`NOT RUN` on this portable baseline.

The inventory contains 32 retained outcomes. Twenty-nine portable automated
checks pass. The Android artwork, macOS Icon Composer, and device/provider
checks remain `NOT RUN`; the Android artwork result does not claim acceptance
while [KAT-3301](https://linear.app/kata-sh/issue/KAT-3301/replace-pre-existing-android-monochrome-t3-artwork-with-kata-mark)
is Todo for the pre-existing monochrome asset defect.

Command (run from the trusted current checkout; the checker executes against a
clean detached worktree at the historical candidate):

```bash
set -euo pipefail
trusted_root="$(git rev-parse --show-toplevel)"
candidate="251a6bcb5cfad04999a6bdd4c7dbb5bb4c983ff9"
historical_root="$(mktemp -d "${TMPDIR:-/tmp}/kat-3307-baseline.XXXXXX")"
cleanup() {
  git -C "$trusted_root" worktree remove --force "$historical_root" >/dev/null
}
trap cleanup EXIT

git -C "$trusted_root" worktree add --detach "$historical_root" "$candidate"
ln -s "$trusted_root/node_modules" "$historical_root/node_modules"
for workspace in scripts apps/* packages/*; do
  if [ -d "$trusted_root/$workspace/node_modules" ] && [ -d "$historical_root/$workspace" ]; then
    ln -s "$trusted_root/$workspace/node_modules" "$historical_root/$workspace/node_modules"
  fi
done

node "$trusted_root/scripts/check-upstream-preservation.ts" \
  --mode baseline \
  --repository-root "$historical_root" \
  --inventory "$trusted_root/docs/upstream/retained-behavior.v1.json" \
  --candidate "$candidate" \
  --base "$candidate" \
  --upstream 12391bd0d38eef6655b7a9f8945d0cb5febadc2b \
  --upstream-base 6a687ee43bf222672ab8d3f4c0bab3d8d174f79f
```

Report:

```text
UPSTREAM_PRESERVATION mode=baseline candidate=251a6bcb5cfad04999a6bdd4c7dbb5bb4c983ff9 base=251a6bcb5cfad04999a6bdd4c7dbb5bb4c983ff9 upstream=12391bd0d38eef6655b7a9f8945d0cb5febadc2b upstream-base=6a687ee43bf222672ab8d3f4c0bab3d8d174f79f
INVENTORY status=PASS
CHECK id=product-identity-release-ownership status=PASS
CHECK id=portable-brand-assets status=PASS
CHECK id=connect-wire-identity status=PASS
CHECK id=state-isolation status=PASS
CHECK id=sandbox-preview-default status=PASS
CHECK id=sandbox-route-driver-registration status=PASS
CHECK id=provider-sandbox-environment-isolation status=PASS
CHECK id=migration-identity status=PASS
CHECK id=retained-process-credential-behavior status=PASS
CHECK id=retained-web-mobile-behavior status=PASS
CHECK id=mobile-shelf-preferences status=PASS
CHECK id=mobile-markdown-image-lifecycle status=PASS
CHECK id=mobile-pairing-redaction status=PASS
CHECK id=desktop-clerk-environment-identity status=PASS
CHECK id=desktop-protocol-bundle-identity status=PASS
CHECK id=desktop-url-handler-backend-routes status=PASS
CHECK id=desktop-browser-session-isolation status=PASS
CHECK id=desktop-update-recovery status=PASS
CHECK id=desktop-window-behavior status=PASS
CHECK id=desktop-packaging-asset-identity status=PASS
CHECK id=release-package-ownership status=PASS
CHECK id=desktop-launcher-identity status=PASS
CHECK id=desktop-assets-identity status=PASS
CHECK id=desktop-linux-keyring-behavior status=PASS
CHECK id=mobile-android-asset-config-identity status=PASS
CHECK id=mobile-android-asset-live-evidence status=NOT RUN detail=requires Android asset/device evidence; KAT-3301 remains open
CHECK id=mobile-android-fab-inset status=PASS
CHECK id=mobile-project-clone-url status=PASS
CHECK id=mobile-agent-awareness-teardown status=PASS
CHECK id=mobile-theme-native-identity status=PASS
CHECK id=icon-composer-live-evidence status=NOT RUN detail=requires macOS Icon Composer evidence
CHECK id=human-device-provider-evidence status=NOT RUN detail=requires device/provider evidence
CHANGED_RETAINED_OUTCOMES status=PASS ids=none
INTEGRATION_RECORD status=NOT RUN
HUMAN_REVIEW_ACCEPTANCE status=NOT RUN
```
