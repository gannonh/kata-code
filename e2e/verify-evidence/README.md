# E2E verification evidence

## Pi provider

Manual walkthrough screenshots captured via agent_browser against the running
web app (default `~/.katacode` home, Pi agent dir `KATACODE_E2E_PI_AGENT_DIR`)
on 2026-06-27. These complement the automated `@pi` E2E suite under
`e2e/tests/agent/pi-smoke.spec.ts` and `e2e/tests/settings/pi-provider.spec.ts`.

| File                                      | Acceptance criterion | What it shows                                                                   |
| ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `pi-01-settings-providers.png`            | AC 1                 | Pi listed first under PROVIDERS, "Enable Pi" switch checked                     |
| `pi-02-model-picker-pi-rail.png`          | AC 4                 | Pi provider rail in the composer model picker with runtime-discovered models    |
| `pi-03-runtime-mode-warning-and-stop.png` | AC 5, AC 9           | approval-required runtime warning rendered in the timeline; Stop button visible |
| `pi-04-interrupted.png`                   | AC 5                 | Interrupted state after Stop generation — Send button back, working row cleared |
| `pi-05-extension-ui-and-tool-work.png`    | AC 5, AC 8, AC 9     | Tool calls executing (+2 previous); extension UI TUI-only warnings rendered     |

## Automated E2E (credentialed, `@pi`)

`vp run e2e --project desktop-dev --grep @pi` — 6 passed (4 credentialed + 2 setup),
gated by `KATACODE_E2E_ENABLE_PI=1`, `KATACODE_E2E_PI_AGENT_DIR`,
`KATACODE_E2E_PI_MODEL`:

- streams a deterministic response from a configured Pi model (AC 5 streaming, AC 15)
- interrupts an in-flight Pi turn and returns to the composer (AC 5 interrupt/stop)
- renders a tool-call work row when the Pi agent reads a file (AC 5 tool lifecycle)
- surfaces a runtime warning when the Pi session starts in approval-required mode (AC 9)

## Settings E2E (`@settings`)

- adds Pi as an enabled first-party provider instance (Pi first heading, Enable checked, add-instance flow)
- surfaces a Pi rail in the composer model picker (AC 4)

## Branch toolbar environment

`branch-toolbar-environment-single-local.png` was captured via `playwright-cli`
on 2026-07-18. It shows the single local environment as `This device` beside the
separate `Local checkout` workspace control. Docker and Vercel icon mappings
are covered by `BranchToolbarEnvironmentSelector.browser.tsx`.

## Gotcha captured

E2E tests fail if a dev server is already running — documented in
`e2e/README.md` (Commands) and `AGENTS.md` (Quick Start). The Electron
`dist-electron/main.cjs` bundle the harness launches must be rebuilt
(`vp run --filter @kata-sh/code-desktop --filter @kata-sh/code-cli build`)
after server/provider changes, or the Pi driver is reported unregistered.
