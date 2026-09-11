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

Before publishing, prove that base and upstream are both ancestors of candidate. Compare `base..candidate` and `upstream..candidate`. Retain the previous pin in the intake after FORK.md advances. A deliberate SKIP is part of the accounted-for intake, not a claim that every upstream file was copied.

## Repeat and resume

Prefer GitHub's merge-commit method when permitted. Verify actual landed parents. If policy requires squash, record that result; the next run must re-establish the documented previous pin using the guarded procedure.

On retry, inspect the existing worktree's HEAD, Git operation, PR head, and intake. Continue its merge only if frozen refs and ownership match. Preserve work and report a mismatch. Do not hard-reset a partially resolved integration or create another PR for the same target.

If origin main advances, merge it into the issue branch, resolve retained behavior, update `base`, and repeat candidate-bound verification. Keep the frozen upstream tip. Push only the issue branch to origin. Merge commits permit normal pushes; a rewritten branch needs its own explicit lease and authorization.

After an uncertain remote write, read the remote branch or PR before retrying. If the merge landed, continue verification and learning. Retain failed worktrees and useful evidence until recovery is recorded. Remove only disposable work owned by this run.
