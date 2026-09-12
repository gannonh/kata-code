# KAT-3307 upstream preservation gate

Run this gate after preparing an upstream integration and before the pull request
advances to Human Review. The gate compares the complete fork delta and then
checks the retained Kata outcomes listed in
[retained-behavior.v1.json](./retained-behavior.v1.json).

## Frozen refs

The current integration is frozen to these refs from [FORK.md](../../FORK.md):

```text
upstream       12391bd0d38eef6655b7a9f8945d0cb5febadc2b
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
  --upstream 12391bd0d38eef6655b7a9f8945d0cb5febadc2b \
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
  --upstream 12391bd0d38eef6655b7a9f8945d0cb5febadc2b \
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
