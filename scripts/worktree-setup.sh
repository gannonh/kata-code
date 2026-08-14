#!/usr/bin/env bash
# Worktree setup — run from the worktree root after `git worktree add`.
#
#   git worktree add ../kata-code-feature main
#   cd ../kata-code-feature
#   ./scripts/worktree-setup.sh
#
# Installs deps, ensures the Electron runtime, and copies .env from the central
# dotfiles store. Idempotent: safe to re-run.

set -euo pipefail

# Resolve the worktree root from the script location so it works regardless of
# the caller's CWD within the worktree.
worktree_root="$(cd "$(dirname "$0")/.." && pwd)"
env_source="$HOME/dotfiles/repos/kata-code/.env"

pnpm install
vp run --filter @kata-sh/code-desktop ensure:electron

if [[ -f "$env_source" ]]; then
  dest="$worktree_root/.env"
  # Drop a leftover symlink so we write a regular file, not through to the store.
  if [[ -L "$dest" ]]; then
    rm "$dest"
  fi
  cp "$env_source" "$dest"
  echo "copied .env from $env_source"
else
  echo "warn: central env not found at $env_source — .env not copied" >&2
fi
