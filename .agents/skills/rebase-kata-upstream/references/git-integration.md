# Integrate from the recorded pin

Use a branch from fresh origin main in a dedicated issue worktree. For rehearsals, use a disposable clone and disable every remote push URL. Never resolve conflicts in the user's main checkout.

Freeze these values in the intake before changing files:

| Value | Meaning |
| --- | --- |
| `base` | Fresh origin main SHA for the retained-outcome comparison |
| `previous_pin` | Current T3 pin read from `base:FORK.md` |
| `upstream` | Newly fetched, frozen upstream main SHA |
| `root_pin` | Original T3 fork root from FORK.md |

Verify full commit IDs, trusted remote URLs, a clean issue worktree, no unfinished Git operation, and `previous_pin` ancestry of `upstream`. Fetch missing objects from authoritative upstream. An object-fetch failure does not prove divergence or no change. The new tip stays frozen throughout the run.

## Stop at intake for an outcome-changing rewrite

Census the range before resolving anything. `git merge-tree --write-tree --name-only <anchor or base> "$upstream"` lists the conflicted files without touching the worktree. Read the dominant commits against the retained-behavior inventory, not just the count. When a commit changes accepted outcomes (protocol versions, state databases, routine semantics, desktop profiles), stop at intake. Report `NEEDS_ACTION` with the census and explicit options, including the census for the range before that commit. Resume against the same frozen tip once the decision is recorded in the issue. [KAT-3635 / PR #345](https://github.com/gannonh/kata-code/pull/345) stopped this way on `de34391427` (#2829, Orchestration V2); see [history](history.md#an-outcome-changing-rewrite-is-an-intake-decision).

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

A conflict where Kata's only change since the previous pin is the identity rename needs no manual merge. For each file, apply the identity transform (`@t3tools/` → `@kata-sh/code-`, `T3 Code` → `Kata Code`, `T3CODE_` → `KATACODE_`) to the previous-pin blob and require the result to equal Kata's blob byte for byte. Only then take upstream's blob through the same transform, or accept upstream's deletion. A file that fails the byte check carries Kata behavior and gets a normal resolution. The per-file check is what separates this from the blanket renaming forbidden above.

For the remaining both-modified files, rerun `git merge-file --diff3` with the renamed previous-pin text as the base. Pure renames stop conflicting and semantic hunks remain. Give the leftover conflicts to lanes with disjoint file ownership, and keep shared contracts, manifests, lockfiles, and migration numbering sequential.

[KAT-3635 / PR #345](https://github.com/gannonh/kata-code/pull/345) resolved 243 of its 420 conflicts this way (150 transformed, 93 deletions accepted), and the renamed base cleared 26 more.

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
