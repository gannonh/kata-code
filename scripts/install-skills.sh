#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# gannonh/skills
npx skills add gannonh/skills --skill plan-build-verify -y --copy --agent claude-code cursor
npx skills add gannonh/skills --skill thermo-run -y --copy --agent claude-code cursor
npx skills add gannonh/skills --skill readme -y --copy --agent claude-code cursor

# gannonh/skills/pstack-skills
npx skills add gannonh/skills/pstack-skills -y --agent codex

# cursor/plugins
npx skills add cursor/plugins --skill thermo-nuclear-code-quality-review -y --copy --agent claude-code cursor
npx skills add cursor/plugins --skill thermo-nuclear-review -y --copy --agent claude-code cursor
npx skills add cursor/plugins --skill unslop -y --copy --agent claude-code cursor

# misc
npx skills add anthropics/claude-plugins-community --skill eli5 -y --copy --agent claude-code cursor
npx skills add humanlayer/skills --skill show-me -y --copy --agent claude-code cursor
npx skills add warpdotdev/common-skills --skill skill-doctor -y --copy --agent claude-code cursor

# project specific third-party skills
npx skills add https://github.com/clerk/skills --skill clerk-cli -y --copy --agent claude-code cursor
npx skills add https://github.com/cloudflare/skills --skill cloudflare -y --copy --agent claude-code cursor
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-cli-with-tokens -y --copy --agent claude-code cursor
npx skills add https://github.com/tovimx/maestro-mobile-testing-skill --skill maestro-mobile-testing -y --copy --agent claude-code cursor
npx skills add https://github.com/vercel/sandbox --skill sandbox -y --copy --agent claude-code cursor