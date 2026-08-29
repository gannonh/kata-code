# Kata Code web verification map

This directory is the maintained source for verifying user-facing behavior of the Kata Code web app. Read the index, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `eval "$(.agents/skills/verify-katacode/bin/launch)"` so the stack has a disposable `--home-dir` and `RUN_ID` / `WEB_ORIGIN` / `HOME_DIR` / `PAIRING_URL` are set in the shell (or `source` the printed `ENV_FILE`).
- Run `.agents/skills/verify-katacode/bin/doctor` and require the printed `WEB_ORIGIN` and home dir to match that run.
- Pair the `katacode-verify` agent-browser session by opening `PAIRING_OPEN_URL="${WEB_ORIGIN}/pair#${PAIRING_URL#*#}"` exactly once as the first navigation.
- Never drive an instance doctor did not accept. A `vp run dev` already running in this worktree is someone else's session.

## Driving conventions

- Start every recipe from the paired empty landing unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names. The command palette also has `data-testid="command-palette"`.
- Treat every command as literal. Keep quoted names and the pairing URL fragment unchanged.
- Run browser actions through `agent-browser --session katacode-verify`. Load `agent-browser skills get core` first so flags match the installed CLI.
- Restore nothing on a disposable home. Do not remove `uat-evidence/<RUN_ID>/` during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an accessibility snapshot and a screenshot that shows Kata Code chrome (sidebar or heading), not a blank tab.
- Mutation proof includes a second user-facing view of the stored value.
- Record the feature ID and entry point used in `uat-evidence/<RUN_ID>/evidence.json`.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with agent-browser` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Pair with this environment](./pairing.md) covers the one-time pairing URL, the token form, and landing on the empty home.
- [Empty landing and add project](./landing.md) covers the no-project hero, command palette add flow, and the first draft thread.
- [Usage](./usage.md) covers the usage page windows, cost/token metric, and empty-window copy.
- [Settings](./settings.md) covers opening settings, searching, and switching General / Appearance.
- [Command palette](./command-palette.md) covers `mod+k`, the root search, and jumping to settings.
