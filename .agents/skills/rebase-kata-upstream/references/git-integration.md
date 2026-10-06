# Integrate from the recorded pin

Use a branch from fresh origin main in a dedicated issue worktree. For rehearsals, use a disposable clone and disable every remote push URL. Never resolve conflicts in the user's main checkout.

Freeze these values in the intake before changing files:

| Value | Meaning |
| --- | --- |
| `base` | Fresh origin main SHA for the retained-outcome comparison |
| `previous_pin` | Current T3 pin read from `base:FORK.md` |
| `upstream` | Newly fetched, frozen upstream main SHA, replaced only by a human-authorized refreeze |
| `root_pin` | Original T3 fork root from FORK.md |

Verify full commit IDs, trusted remote URLs, a clean issue worktree, no unfinished Git operation, and `previous_pin` ancestry of `upstream`. Fetch missing objects from authoritative upstream. An object-fetch failure does not prove divergence or no change. The new tip stays frozen throughout the run unless a human decision recorded in the issue refreezes it.

## Stop at intake for an outcome-changing rewrite

Census the range before resolving anything:

```bash
census=$(git merge-tree --write-tree --no-messages --name-only \
  --merge-base="$previous_pin" "$base" "$upstream"); rc=$?
[ "$rc" -le 1 ] || { echo "git merge-tree failed ($rc)" >&2; exit "$rc"; }
printf '%s\n' "$census" | tail -n +2 | wc -l
```

`git merge-tree` exits 0 for a clean merge and 1 for conflicts. Any other status means a missing ref or an object error, and the run stops there. A pipe straight into `wc -l` would report `0` conflicts for a fatal error. The command writes only objects, moves no ref, and touches no worktree. Its first output line is the result tree, which `tail` skips. Pass `--merge-base`. Without it, a base that lacks the previous pin's ancestry overcounts (461 instead of 420 on [KAT-3635 / PR #345](https://github.com/gannonh/kata-code/pull/345)'s base). Read the dominant commits against the retained-behavior inventory, not just the count. To census the range before a commit, run the same command with `upstream` set to that commit's parent.

Stop at intake when a commit changes an accepted outcome in a way that needs a human product decision and no existing disposition rule covers it. Examples are ending compatibility with deployed clients or servers, moving or copying user data, and changing what a feature means. A routine changed retained outcome still gets a disposition from its legitimate approver under [verification](verification.md). When you stop, report `NEEDS_ACTION` with the census and explicit options, including the census for the range before that commit.

Resume against the target the recorded decision names. Adopting the commit keeps the frozen tip. Refreezing to an earlier commit needs the human's explicit authorization in the issue and a new intake for the refrozen range. #345 stopped this way on `de34391427` (upstream #2829, Orchestration V2); see [history](history.md#an-outcome-changing-rewrite-is-an-intake-decision).

When the range needs a trusted file to change, file the unfreeze issue at intake so it lands on `main` before the branch reaches the file; see the fifth case in [history](history.md#preservation-gate-replaced-weak-evidence).

## Recover ancestry lost to a squash

PR #194 was prepared as a merge, then squashed. Its upstream tip is absent from main's ancestry. Verify with `git merge-base --is-ancestor` and `git merge-base --all`; do not infer ancestry from the PR title.

If the previous pin is absent from base ancestry, verify that `base:FORK.md` and the prior landed intake account for that exact pin, including deliberate SKIPs. A pin string alone is insufficient. Stop for reconciliation if those records disagree.

Record the already-integrated previous pin as a parent without changing any files. This command is only for the documented **previous** pin:

```bash
git merge --strategy=ours --no-ff "$previous_pin" \
  -m "Record previously integrated upstream pin after squash"
git diff --exit-code "$base" HEAD -- .
git merge-base --is-ancestor "$base" HEAD
git merge-base --is-ancestor "$previous_pin" HEAD
git merge-base --all HEAD "$upstream"
```

The final command must yield exactly `previous_pin`. Multiple or unexpected bases need investigation. If previous-pin ancestry already exists, omit the anchor and verify the merge base directly. Do not add synthetic ancestry for a target never integrated.

Perform the actual upstream integration using a normal three-way merge:

```bash
git merge --no-ff --no-commit "$upstream"
git status --short
git diff --name-only --diff-filter=U
```

A conflict exit is expected when files overlap. Inspect it instead of retrying or accepting one side. `ours` denotes the Kata branch and `theirs` upstream in this merge. Ordinary rebasing changes those expectations.

Resolve each outcome, stage reviewed files, and commit the merge. Never use `-s ours`, `-X ours`, blanket checkout, or blanket renaming for new upstream content. Inspect reused rerere resolutions as carefully as new ones. Preserve approved deletions when upstream modifies or reintroduces deleted tooling.

## Resolve identity-only conflicts with a proven transform

Define the identity transform `tf` as the current identity rules. The base set is `@t3tools/` → `@kata-sh/code-`, `T3 Code` → `Kata Code`, and `T3CODE_` → `KATACODE_`. [KAT-3668 / PR #348](https://github.com/gannonh/kata-code/pull/348) added `T3 Connect` → `Kata Code Connect` (`docs/upstream/kat-3668-intake.md`, "Resolution method"). Start from the latest intake's rule list, and add a rule only for a rename that Kata's blobs at the previous pin already show.

```bash
tf() { sed -e 's#@t3tools/#@kata-sh/code-#g' -e 's/T3 Code/Kata Code/g' \
  -e 's/T3CODE_/KATACODE_/g' -e 's/T3 Connect/Kata Code Connect/g'; }
```

A conflict where Kata's only change since the previous pin is that rename needs no manual merge. For each file, require `tf(previous_pin blob)` to equal Kata's blob byte for byte. Only then take `tf(upstream blob)`, or accept upstream's deletion. A file that fails the byte check carries Kata behavior and gets a normal resolution. Trusted paths and inventory owner paths do not take this shortcut. List the trusted paths from the `trustedPaths` entries in `scripts/lib/upstream-preservation/checks.ts` (minus `unfrozenTrustedPaths`; see the [runbook](../../../../docs/upstream/kat-3307-runbook.md#retire-a-check-or-path)) and the owner paths from `docs/upstream/retained-behavior.v1.json`. Resolve a trusted path under the [trusted-assertion cases](history.md#preservation-gate-replaced-weak-evidence), which decide whether it stays at base bytes, takes upstream's file, or changes after an unfreeze.

The byte check proves only the previous-pin side. It says nothing about upstream's new content, so the per-file check alone does not separate this from the blanket renaming forbidden above. For each transformed file, read `diff <(git show "$upstream:$path") <(git show "$upstream:$path" | tf)` against the keep-list in [history](history.md#branding-repair-exposed-missing-coverage): private symbols, storage keys, wire identifiers, OAuth destinations, and FORK.md exceptions. `T3CODE_` also matches non-environment identifiers; `packages/shared/src/otelEnvironment.ts` keeps `T3CODE_TRUE` and `T3CODE_FALSE`. After the transform, grep the file for `t3code` and `~/.t3`, which `tf` does not touch.

For the remaining both-modified files, merge in three-way with the previous pin and upstream renamed and Kata's blob left raw. `git merge-file` edits its first file in place, so give it copies:

```bash
work=$(mktemp -d)
git show "$base:$path" > "$work/kata"
git show "$previous_pin:$path" | tf > "$work/prev"
git show "$upstream:$path" | tf > "$work/up"
git merge-file --diff3 "$work/kata" "$work/prev" "$work/up"; rc=$?
```

Exit 0 means the merge is clean, so copy `$work/kata` over `$path`. A status from 1 to 127 is that many conflicts left in `$work/kata`, and the file gets a normal resolution. Any status above 127 is an error and stops the run. Leave Kata's blob raw. Renaming it would change retained tokens such as `T3CODE_TRUE` before the merge sees them. With the previous pin and upstream both renamed, a retained Kata token differs from the base, so it survives where upstream left the line alone and surfaces as a conflict where upstream changed it. Renaming only the previous pin leaves upstream raw, and wherever upstream changed a line near an identity token, Kata's side equals the base and git takes upstream's raw line without a conflict. On #345's census, 111 files were both-modified and not identity-only. Renaming only the previous pin merged 20 of them cleanly, and all 20 carried identity tokens Kata's blob does not have (19 with `@t3tools/`, 4 with `T3CODE_`, 3 with `T3 Code`). One is `T3CODE_TELEMETRY_ENABLED` in `apps/server/src/telemetry/AnalyticsService.ts`, where Kata has `KATACODE_TELEMETRY_ENABLED`. `check:branding` does not flag environment prefixes. Renaming both merged 33 cleanly and leaked none.

Then run the scope rename. Upstream-added and cleanly merged files arrive with `@t3tools/` imports. Apply the `@t3tools/` rule to them, grep their added lines for `T3CODE_` and `t3code`, and review each remaining hit against the keep-list. The run records 555 such files in #345 and 22 in KAT-3648.

Give the leftover conflicts to lanes under the ownership and sequencing rules in [SKILL.md](../SKILL.md#prepare-and-integrate), step 3.

[KAT-3635 / PR #345](https://github.com/gannonh/kata-code/pull/345) resolved 243 of its 420 conflicts by the identity transform (150 transformed, 93 deletions accepted), and its renamed-base step cleared 26 more. Those figures come from `docs/upstream/kat-3635-intake.md`. A replay from git finds 149 identity-only content files and 93 identity-only upstream deletions.

## Dependency manifests and the lockfile

When the range changes dependencies, do these intake steps before resolving source conflicts:

1. Diff `patchedDependencies` and `overrides` in `pnpm-workspace.yaml` between `base` and the merge. For every patch the merge drops, port it to the new version or record a justification in the decisions file. A version bump that removes a patch entry does not mean the patch is obsolete.
2. Regenerate `pnpm-lock.yaml` from the base lockfile with `vp install`. Never take either side's lockfile. Then compare the resolved versions of the upgraded package family with upstream's lockfile at `upstream`, and explain every difference. This keeps Kata-only pins, such as the vite-plus version, that taking upstream's lockfile would overwrite.
3. When the range bumps the test toolchain (vite-plus, Vitest, or TypeScript), run every trusted test file at its base bytes under the new toolchain before taking the bump. See the fourth trusted-assertion case in [history](history.md#preservation-gate-replaced-weak-evidence).

Before publishing, prove that base and upstream are both ancestors of candidate. Compare `base..candidate` and `upstream..candidate`. Retain the previous pin in the intake after FORK.md advances. A deliberate SKIP is part of the accounted-for intake, not a claim that every upstream file was copied.

## Repeat and resume

Prefer GitHub's merge-commit method when permitted. The repository's squash setting has changed between runs (`allow_squash_merge` was `false` on 2026-10-02 and `true` on 2026-10-05), and rebase merges are allowed; a squash or a rebase drops the upstream tip as a parent. Verify actual landed parents. If the PR landed without the upstream tip as a parent, record that result; the next run must re-establish the documented previous pin using the guarded procedure. Do not write follow-up issues whose plan depends on the landing method.

On retry, inspect the existing worktree's HEAD, Git operation, PR head, and intake. Continue its merge only if frozen refs and ownership match. Preserve work and report a mismatch. Do not hard-reset a partially resolved integration or create another PR for the same target.

If origin main advances, merge it into the issue branch, resolve retained behavior, update `base`, and repeat candidate-bound verification. Keep the frozen upstream tip. Push only the issue branch to origin. Merge commits permit normal pushes; a rewritten branch needs its own explicit lease and authorization.

After an uncertain remote write, read the remote branch or PR before retrying. If the merge landed, continue verification and learning. Retain failed worktrees and useful evidence until recovery is recorded. Remove only disposable work owned by this run.
