#!/usr/bin/env bash
# take-upstream.sh
#
# Resolve merge conflicts by taking upstream's side (theirs, MERGE_HEAD's
# version) for every conflicted file, then staging them. Safe to call with
# zero arguments (takes upstream for ALL unmerged paths) or with explicit
# path filters (take upstream for files matching a pattern, e.g. by zone).
#
# MUST be called while files are still UNMERGED (during a `git merge` in
# progress, before `git add`). Calling this AFTER files are staged has no
# effect: `git checkout --theirs` only operates on conflicted entries, and
# `git show :3:<path>` returns empty for already-resolved stages.
#
# This is the operation that's easy to get wrong by hand: a naive loop of
# `git show :3:$f > $f` will TRUNCATE files to empty when the :3 stage is
# unavailable (e.g. after partial staging). This helper uses `git checkout
# --theirs` which fails loudly instead of silently emptying files.
#
# Usage:
#   .agents/skills/upstream-sync/scripts/take-upstream.sh                 # all conflicts
#   .agents/skills/upstream-sync/scripts/take-upstream.sh apps/mobile     # one zone
#   .agents/skills/upstream-sync/scripts/take-upstream.sh apps/mobile infra/relay
#
# After this: run `rebrand-fork.ts --apply` to restore @kata-sh/* branding
# upstream's pre-rename code reintroduces, then `vp i` to regen the lockfile.
#
# Exit codes:
#   0  all matched conflicts resolved and staged
#   1  no merge in progress (MERGE_HEAD missing)
#   2  no unmerged paths matched the filter

set -euo pipefail

if ! git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  echo "error: no merge in progress (MERGE_HEAD missing)." >&2
  echo "       Run \`git merge upstream/main\` first." >&2
  exit 1
fi

# Gather unmerged paths. git diff --name-only --diff-filter=U lists paths with
# unresolved conflicts. If filters passed, prefix-match against them.
unmerged=()
while IFS= read -r path; do
  [ -n "$path" ] && unmerged+=("$path")
done < <(git diff --name-only --diff-filter=U)

if [ "${#unmerged[@]}" -eq 0 ]; then
  echo "no unmerged paths to resolve." >&2
  exit 2
fi

filters=("$@")
matched=()
for f in "${unmerged[@]}"; do
  if [ "${#filters[@]}" -eq 0 ]; then
    matched+=("$f")
  else
    for pat in "${filters[@]}"; do
      if [[ "$f" == "$pat"* ]]; then
        matched+=("$f")
        break
      fi
    done
  fi
done

if [ "${#matched[@]}" -eq 0 ]; then
  echo "no unmerged paths matched filter(s): ${filters[*]:-<none>}" >&2
  echo "available unmerged:" >&2
  for f in "${unmerged[@]:0:20}"; do echo "  $f" >&2; done
  exit 2
fi

echo "taking upstream (theirs) for ${#matched[@]} file(s)..."
# git checkout --theirs operates on unmerged entries and fails loudly if a
# stage is unavailable — the safe equivalent of the truncate-prone
# `git show :3:$f > $f` loop.
git checkout --theirs -- "${matched[@]}"
git add -- "${matched[@]}"

echo "done. ${#matched[@]} file(s) resolved against upstream and staged."
echo ""
echo "next: node .agents/skills/upstream-sync/scripts/rebrand-fork.ts --apply"
echo "then: vp i"
