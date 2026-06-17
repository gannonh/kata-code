#!/usr/bin/env bash
set -euo pipefail

# Install project-local skills into <repo>/.agents/skills
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

GANNONH_SKILLS=(
  address-pr-comments
  agents-md-improver
  babysit-pr
  finalize
  fix-github-ci
  okf
  plan-build-verify
  simplify
  strict-quality-review
  user-acceptance
)

for skill in "${GANNONH_SKILLS[@]}"; do
  echo "==> Installing gannonh/skills:${skill}"
  npx skills add gannonh/skills --skill "${skill}" -y
done

echo "==> Installing sother skills"
# npx skills add https://github.com/shadcn/ui --skill shadcn -y

echo "==> Done. Installed skills:"
npx skills ls --json 2>/dev/null || npx skills ls
