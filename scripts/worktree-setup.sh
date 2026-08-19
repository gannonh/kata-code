#!/usr/bin/env bash
# Worktree setup — run from the worktree root after `git worktree add`.
#
#   git worktree add ../kata-agents-feature main
#   cd ../kata-agents-feature
#   ./scripts/worktree-setup.sh
#
# Installs deps, ensures the Electron runtime, and symlinks .env from the central
# dotfiles store. Idempotent: safe to re-run.

set -euo pipefail

# Resolve the worktree root from the script location so it works regardless of
# the caller's CWD within the worktree.
worktree_root="$(cd "$(dirname "$0")/.." && pwd)"
env_source="$HOME/dotfiles/repos/kata-agents/.env"

bun install
bun run ensure:electron
bun run electron:build

if [[ -f "$env_source" ]]; then
  ln -sfn "$env_source" "$worktree_root/.env"
  echo "linked .env ← $env_source"
else
  echo "warn: central env not found at $env_source — .env not linked" >&2
fi
