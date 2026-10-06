# Integrate from the recorded pin

Use a branch from fresh origin main in a dedicated issue worktree. For rehearsals, use a disposable clone and disable every remote push URL. Never resolve conflicts in the user's main checkout.

Freeze these values in the intake before changing files:

| Value | Meaning |
| --- | --- |
| `base` | Fresh origin main SHA for the retained-outcome comparison |
| `previous_pin` | Current T3 pin read from `base:FORK.md` |
| `upstream` | Newly fetched, frozen upstream main SHA |
| `root_pin` | Original T3 fork root from FORK.md |

Verify full commit IDs, trusted remote URLs, a clean issue worktree, no unfinished Git operation, and `previous_pin` ancestry of `upstream`. Fetch missing objects from authoritative upstream. An object-fetch failure does not prove divergence or no change. The new tip stays frozen throughout the run unless a human decision recorded in the issue refreezes it.

## Stop at intake for an outcome-changing rewrite

Census the range before resolving anything:

```bash
git merge-tree --write-tree --no-messages --name-only \
  --merge-base="$previous_pin" "$base" "$upstream" | tail -n +2 | wc -l
```

The command writes only objects, moves no ref, and touches no worktree. `git merge-tree` exits 1 when files conflict, so the pipeline's status is `wc`'s. Its first output line is the result tree, which `tail` skips. Pass `--merge-base`. Without it, a base that lacks the previous pin's ancestry overcounts (461 instead of 420 on [KAT-3635 / PR #345](https://github.com/gannonh/kata-code/pull/345)'s base). Read the dominant commits against the retained-behavior inventory, not just the count.

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

Define the identity transform `tf` as `@t3tools/` → `@kata-sh/code-`, `T3 Code` → `Kata Code`, and `T3CODE_` → `KATACODE_`. A conflict where Kata's only change since the previous pin is that rename needs no manual merge. For each file, require `tf(previous_pin blob)` to equal Kata's blob byte for byte. Only then take `tf(upstream blob)`, or accept upstream's deletion. A file that fails the byte check carries Kata behavior and gets a normal resolution.

The byte check proves only the previous-pin side. It says nothing about upstream's new content, so the per-file check alone does not separate this from the blanket renaming forbidden above. For each transformed file, read `diff <(git show "$upstream:$path") <(git show "$upstream:$path" | tf)` against the keep-list in [history](history.md#branding-repair-exposed-missing-coverage): private symbols, storage keys, wire identifiers, OAuth destinations, and FORK.md exceptions. `T3CODE_` also matches non-environment identifiers; `packages/shared/src/otelEnvironment.ts` keeps `T3CODE_TRUE` and `T3CODE_FALSE`. After the transform, grep the file for `t3code` and `~/.t3`, which `tf` does not touch. Never apply `tf` to a trusted frozen path. Those files stay at base bytes, and new upstream coverage goes to a companion suite.

For the remaining both-modified files, run `git merge-file --diff3 <kata copy> <tf(previous_pin)> <tf(upstream)>`. Pure renames stop conflicting and semantic hunks remain. Transform all three inputs. With only the previous pin renamed, upstream arrives raw, and wherever upstream changed a line near an identity token, Kata's side equals the base and git takes upstream's raw line without a conflict. On #345's 111 both-modified files that were not identity-only, that form merged 20 cleanly with tokens Kata's blob does not have (for example `T3CODE_TELEMETRY_ENABLED` in `apps/server/src/telemetry/AnalyticsService.ts`, where Kata has `KATACODE_TELEMETRY_ENABLED`), and `check:branding` does not flag environment prefixes. With all three inputs, 33 merged cleanly and none leaked.

Then run the scope rename. Upstream-added and cleanly merged files arrive with `@t3tools/` imports. Apply the `@t3tools/` rule to them (555 files in #345, 22 in KAT-3648), grep their added lines for `T3CODE_` and `t3code`, and review each remaining hit against the keep-list.

Give the leftover conflicts to lanes under the ownership and sequencing rules in [SKILL.md](../SKILL.md#prepare-and-integrate), step 3.

[KAT-3635 / PR #345](https://github.com/gannonh/kata-code/pull/345) resolved 243 of its 420 conflicts by the identity transform (150 transformed, 93 deletions accepted), and its renamed-base step cleared 26 more.

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
