#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# gannonh/skills
npx skills add gannonh/skills --skill plan-build-verify -y --copy --agent claude-code cursor
npx skills add gannonh/skills --skill thermo-run -y --copy --agent claude-code cursor
npx skills add gannonh/skills --skill readme -y --copy --agent claude-code cursor

# cursor/plugins
npx skills add https://github.com/cursor/plugins --skill thermo-nuclear-code-quality-review -y --copy --agent claude-code cursor
npx skills add https://github.com/cursor/plugins --skill thermo-nuclear-review -y --copy --agent claude-code cursor
npx skills add https://github.com/cursor/plugins --skill unslop -y --copy --agent claude-code cursor

npx skills add anthropics/claude-plugins-community --skill eli5 -y --copy --agent claude-code cursor
npx skills add humanlayer/skills --skill show-me -y --copy --agent claude-code cursor
npx skills add warpdotdev/common-skills --skill skill-doctor -y --copy --agent claude-code cursor
