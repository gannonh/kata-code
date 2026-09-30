# KAT-3307 upstream preservation gate

Run this gate after preparing an upstream integration and before the pull request
advances to Human Review. The gate compares the complete fork delta and then
checks the retained Kata outcomes listed in
[retained-behavior.v1.json](./retained-behavior.v1.json).

## Frozen refs

The current integration is frozen to these refs from [FORK.md](../../FORK.md):

```text
upstream       0fcd5f90611451cca842689faea53b5450c022da
upstream-base  6a687ee43bf222672ab8d3f4c0bab3d8d174f79f
```

Resolve candidate and base to full lowercase commit IDs before review. Keep the
same four IDs in the report, the integration record, and any manual evidence.
Create those records after the candidate commit under the ignored
`uat-evidence/<run-id>/` directory. This keeps the final candidate SHA stable
while the records bind to it, and ignored evidence does not dirty the checkout.
The public command requires every ref explicitly:

```bash
vp run check:upstream-preservation -- \
  --mode human-review \
  --candidate <candidate-ref> \
  --base <base-ref> \
  --upstream 0fcd5f90611451cca842689faea53b5450c022da \
  --upstream-base 6a687ee43bf222672ab8d3f4c0bab3d8d174f79f \
  --integration-record uat-evidence/<run-id>/integration-record.json \
  --manual-evidence uat-evidence/<run-id>/manual-evidence.json
```

The command resolves each ref with `git rev-parse --verify --end-of-options
<ref>^{commit}`. It rejects a different upstream tip or root. It has no skip,
allow-missing, or disabled mode.

CI fetches both frozen upstream objects from the authoritative URL in `FORK.md`
(`https://github.com/pingdotgg/t3code.git`) with `--no-tags --depth=1`, then
verifies `FETCH_HEAD` against each full SHA before running the gate.

CI runs the checker and its `scripts/lib/upstream-preservation-*.ts` modules from
the trusted base commit in a temporary directory, with the candidate checkout
as the command working tree. If the base predates this gate, the first
introduction uses the candidate checker as an explicit bootstrap; every later
change is evaluated by the archived base checker. A candidate cannot change its
own contract and decide its result.

The checker also requires `HEAD` to resolve to `candidate` and rejects every
non-ignored working-tree change. Run it from a clean checkout of the exact
candidate commit.

## Retire a check or path

Because CI runs the base checker, a PR cannot remove a check, remove an owner
path, or edit a trusted assertion and still pass: the base contract still
requires it. Change the contract in two PRs instead. Both are tracked on a
Linear issue. The issue owner records the decision there, and each PR merges
only from Merging.

1. Add the entry to `RETIREMENTS` in
   `scripts/lib/upstream-preservation/checks.ts`. Each entry names its issue
   and reason. There are three kinds:
   - a retired check (`checks`), which no longer runs;
   - a retired path (`paths`), which leaves every check's owner, required, and
     trusted paths and its command arguments;
   - an unfrozen trusted path (`unfrozenTrustedPaths`), which is still
     required and still run, but whose bytes may change. Unfreezing a path
     lifts its byte check in every active check that trusts it.

   Leave the code and the inventory unchanged. The base checker accepts this
   PR because the inventory still matches its contract. After it lands, the
   new checker applies the entries and accepts an inventory that still lists
   the retired checks and paths.

2. Once step 1 is on `main`, change the code and the inventory in a second PR.
   Its base checker already applies the entries.

`applyRetirements` rejects tables that do not fit the contract:

- a retired ID or path that is not in the contract;
- an unfrozen path that is not an active trusted path;
- a retirement that would leave a check without owner paths, or a command
  without required paths or without its path arguments.

An active inventory entry may list only the retired paths its own contract
entry had.

Clean up in the step 2 PR:

- Remove each retired check or path from both the contract and `RETIREMENTS`.
  Removing only one of them either fails at load or turns the check back on.
- Remove each unfrozen entry from `RETIREMENTS` only, and keep the path in the
  contract. That freezes the file again at its new bytes. While a path is
  unfrozen, any PR can rewrite it without a changed-outcome report, so the
  unfrozen window must end with the PR that needed it. KAT-3543 retired the sandbox checks
  this way before KAT-3544 removed the sandbox feature.

## Add a check

The base checker also rejects an inventory entry it does not know, so a new
check lands in two PRs:

1. Add the check to `CONTRACT_CHECKS` and its ID to `PENDING_INVENTORY_CHECKS`
   in `scripts/lib/upstream-preservation/checks.ts`. Leave the inventory
   unchanged. The base checker accepts the unchanged inventory, and once the PR
   lands the new check runs on every candidate.
2. Once step 1 is on `main`, add the inventory entry and remove the ID from
   `PENDING_INVENTORY_CHECKS` in a second PR. The base checker accepts the
   inventory with or without a pending entry. The checker tests run today's
   inventory against older commits, so the same PR moves `baselineCandidateSha`
   in `scripts/check-upstream-preservation.test.ts` to a commit that has the new
   owner paths.

KAT-3512 added `connect-early-access-waitlist` this way.

## Unsupported platform paths

Kata ships macOS, Linux, and iOS only
([supported platforms](../operations/supported-platforms.md)). Paths that exist
only for a parked platform carry no retained Kata outcome. Take upstream changes
to them as they are: record `TAKE` with the rationale `unsupported platform`,
without a Kata behavior review, a disposition beyond that line, or live
verification. When a conflict mixes a parked-platform branch with shared code,
review only the shared code. A path that an active check in
`scripts/lib/upstream-preservation/checks.ts` owns stays under that check.

Each parked platform has one entry below.

### Windows

Parked by KAT-3514.

- `scripts/install.ps1`
- `apps/desktop/src/wsl/**`, `apps/desktop/src/ipc/methods/wsl*.ts`
- `apps/desktop/src/electron/WindowsForeground*.ts`
- `apps/desktop/src/snapShot/WindowsCaptureFeedback*.ts`
- `apps/web/src/wslPaths*.ts`, `apps/web/src/state/desktopWslState*.ts`
- Steps in `.github/workflows/release-desktop.yml` gated on `inputs.platform == 'win'`
- `platform === "win"` / `win32` branches in `scripts/build-cli-archive.ts`,
  `scripts/build-desktop-artifact.ts`, and `scripts/build-npm-platform-packages.ts`
- Upstream Windows release jobs in `.github/workflows/release.yml`: keep them out
  and update `.github/disabled/release-windows.yml` instead
- `win32-*` keys in `CLI_ARCHIVE_PLATFORM_KEYS` (`packages/shared/src/cliRelease.ts`):
  keep them out while Windows is parked

### Android

Parked by KAT-3515. `RETIREMENTS` in `scripts/lib/upstream-preservation/checks.ts`
retires `mobile-android-asset-live-evidence`, `mobile-android-fab-inset`, and the
Material You theme paths, so no active check owns these paths.

- `apps/mobile/modules/*/android/**`, and `*.kt` / `*.kts` under `apps/mobile/`
- `apps/mobile/plugins/withAndroid*.cjs`
- `apps/mobile/src/**/*.android.ts`, `apps/mobile/src/**/*.android.tsx`
- `apps/mobile/src/features/home/android-home-fab-layout*.ts`
- `apps/mobile/src/lib/materialYouTheme.ts`, `apps/mobile/src/lib/materialYouTheme.test.ts`
- `apps/mobile/assets/android-*.png`
- `apps/mobile/detekt.yml`, `apps/mobile/.editorconfig`
- `docs/operations/android-notifications.md`
- Android hunks in `apps/mobile/app.config.ts`: keep `platforms: ["ios"]` and no
  `withAndroid*` plugin entries
- Android build scripts in `apps/mobile/package.json` and `android` fields in
  `apps/mobile/eas.json`: keep them out while Android is parked

## Review the full delta

Before running the command, review every path in the complete `base..candidate`
delta. Include files that merged cleanly; a clean merge does not prove that a
Kata outcome survived. For each removed or changed retained owner, record one
concrete `TAKE` or `SKIP` disposition in the integration record. The disposition
must contain the exact four refs, a `scopePaths` array equal to every changed
owner path for that check, rationale, approver, UTC approval time, and evidence.
`scopePaths` cannot contain duplicates, wildcards, `all`, or placeholders.
When both the base and candidate refs contain the inventory, edits to an
individual inventory entry are changed retained outcomes and require that
entry's disposition with the exact owner paths. The first introduction of the
inventory is compared as an absent snapshot and does not create a mass set of
dispositions; deleting the inventory from the working tree still fails the
inventory contract.

`evidence.path` must name an existing repository-relative JSON evidence binding.
Use `uat-evidence/<run-id>/` for live records and their artifacts. Do not write
post-commit records under tracked `docs/upstream/` files. The checked-in
`.example.json` files are templates only.
The binding uses schema version `1`, repeats the exact four refs, names the
`checkId`, includes a concrete `result`, and lists one or more concrete
`artifactPaths` under the repository root. Integration bindings additionally
repeat `decision`, exact `scopePaths`, `approvedBy`, and `approvedAt`; manual
bindings additionally repeat `status: PASS`, `observer`, and UTC
`observedAt`. The gate validates every underlying path, rejects absolute paths,
traversal, placeholders, stale refs, mismatched checks, mismatched outcomes,
and circular self-reference. A prose verification note cannot satisfy the
binding. The checked-in `.example.json` files, including
`kat-3307-evidence-binding.example.json`, are rejected as live evidence:
copy them to non-example paths and replace every placeholder and ref before use.

Every binding artifact path must contain a result artifact with schema version
`1`: exact candidate, base, upstream, and upstream-base refs; the exact
`checkId`; the concrete `result`; `producer`; `provenance`; and a lowercase
SHA-256 `digest` over those fields in schema order. The gate parses that JSON,
recomputes the digest, and compares every field to the binding. Arbitrary prose,
stale files, or unrelated existing files cannot satisfy evidence.

For a complete content and path review, including cleanly merged files, run:

```bash
git diff --stat <base-sha>..<candidate-sha>
git diff --find-renames --find-copies <base-sha>..<candidate-sha> -- .
```

For a rebase, inspect what changed between the old and new candidate ranges:

```bash
git range-diff <old-base-sha>..<old-candidate-sha> <new-base-sha>..<new-candidate-sha>
```

For a merge, compare both tree contents and commit ancestry:

```bash
git diff --find-renames <base-sha>..<candidate-sha> -- .
git diff-tree --no-commit-id --name-status -r -m <candidate-sha>
git diff-tree --no-commit-id --name-status -r <candidate-sha>^1 <candidate-sha>
git diff-tree --no-commit-id --name-status -r <candidate-sha>^2 <candidate-sha>
git rev-parse <candidate-sha>^{tree} <candidate-sha>^1^{tree} <candidate-sha>^2^{tree}
git diff --find-renames <candidate-sha>^1^{tree} <candidate-sha>^{tree} -- .
git diff --find-renames <candidate-sha>^2^{tree} <candidate-sha>^{tree} -- .
git log --graph --oneline --decorate <base-sha>..<candidate-sha>
```

Compare the final candidate tree with the frozen upstream tip as well as the
base range. This catches retained files that merge without conflicts:

```bash
git diff --find-renames <upstream-sha>..<candidate-sha> -- .
git diff-tree --no-commit-id --name-status -r -m <candidate-sha>
```

Review the dispositions for removed behavior, changed defaults, moved routes,
renamed assets, migration IDs, process or credential boundaries, and release
ownership. Do not resolve an upstream conflict automatically as ours or theirs.
If a retained outcome changes, update the explicit record before rerunning the
gate. The old TSV decision log remains source context; it does not replace the
machine-validated record.

## Profiles and review states

`ci` runs all portable automated checks. It reports live, device, provider, and
Icon Composer evidence as `NOT RUN`, prints
`HUMAN_REVIEW_ACCEPTANCE status=NOT RUN`, and can only accept the automated
contract. Static checks never claim live acceptance.

`baseline` is observational. When the checker was introduced after the recorded
main commit, run the trusted current checker from the current checkout against
a clean detached worktree at that exact historical candidate. Pass the current
inventory explicitly. The checker validates owner paths and executable commands
against the historical tree, while gate-introduced spec references may resolve
from the trusted inventory source tree. The external inventory is accepted only
in `baseline`; CI and `human-review` reject both `--repository-root` and
`--inventory` overrides.

The dependency links below are ignored by Git and let the historical tree run
the same installed test tooling as the trusted checker. The checker still
requires the detached worktree's `HEAD` to equal `--candidate` and its Git
status to be clean.

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
  --upstream 0fcd5f90611451cca842689faea53b5450c022da \
  --upstream-base 6a687ee43bf222672ab8d3f4c0bab3d8d174f79f
```

Save the output, including the exact refs and every `PASS`/`NOT RUN` line, as
the baseline artifact. A baseline is evidence of the recorded current state,
not CI acceptance for a future integration.

`human-review` requires every automated check to be `PASS`, an exact-ref manual
evidence record for each live check, and an exact-ref integration record when a
retained outcome changed. Any `FAIL` or mandatory `NOT RUN` blocks Human Review.
Manual evidence must point to an artifact describing the disposable
browser/device/provider run and the inspected result. It must not claim
unsupported providers or Linux Icon Composer output. Icon Composer evidence is
reported separately from device/provider evidence and is required on macOS.
