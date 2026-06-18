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
  committing-changes
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
npx skills add https://github.com/mattpocock/skills --skill tdd -y
npx skills add plannotator/effective-html -y
# vercel skills: https://www.skills.sh/vercel-labs/agent-skills
# Dev Ops
npx skills add https://github.com/vercel-labs/agent-skills --skill deploy-to-vercel -y
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-cli-with-tokens -y
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-optimize -y
# React
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices -y
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-composition-patterns -y
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-native-skills -y
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-view-transitions -y
# cloudflare skills: https://www.skills.sh/cloudflare/skills
npx skills add https://github.com/cloudflare/skills --skill cloudflare -y
npx skills add https://github.com/cloudflare/skills --skill wrangler -y
npx skills add https://github.com/cloudflare/skills --skill workers-best-practices -y
# clerk
npx skills add clerk/skills -y

echo "==> Done. Installed skills:"
npx skills ls --json 2>/dev/null || npx skills ls
