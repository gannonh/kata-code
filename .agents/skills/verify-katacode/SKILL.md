---
name: verify-katacode
description: Drive the Kata Code web app on an isolated local stack, pair a browser, click through chat, settings, and usage, and capture screenshots plus accessibility snapshots. Use when proving a user-facing web change, running UAT, or checking that the app still boots and pairs.
---

# Verify Kata Code (web)

This skill is for a cold agent that has never seen the app. It launches a disposable Kata Code web stack, pairs a browser the way a user does, drives one mapped feature, and leaves proof on disk.

The primary surface is the **web client** at `apps/web`, served with the local server. Desktop wraps the same routes in Electron. Mobile is a separate React Native app. Marketing is a separate site. Do not claim those other clients are verified because the web app worked.

Iterative human testing against a kept-alive worktree stack is the sibling `test-t3-app` skill. This skill is stricter: dedicated `--home-dir`, never attach to a stack you did not start, always capture evidence, always tear down what you started.

## Launch

From the repository root, load the printed values into the current shell:

```bash
eval "$(.agents/skills/verify-katacode/bin/launch)"
```

`launch` writes progress on stderr and only `KEY=value` lines on stdout, so `eval` exports `RUN_ID`, `RUNNER_PID`, `HOME_DIR`, `VERIFY_ROOT`, `WEB_ORIGIN`, `SERVER_PORT`, `WEB_PORT`, `EVIDENCE_DIR`, `ENV_FILE`, and `PAIRING_URL`. The same exports are also written to `$ENV_FILE` (`${TMPDIR:-/tmp}/katacode-verify-<RUN_ID>/run.env`) for a later `source "$ENV_FILE"`.

That starts `node scripts/dev-runner.ts dev --home-dir <disposable>` with no `--browser`, no `--share`, and with `VITE_HTTP_URL` / `VITE_WS_URL` unset. Dev is single-origin. Vite proxies `/api`, `/oauth`, `/.well-known`, and `/ws`. Baking a localhost origin into the bundle breaks every remote browser.

Ready means all of these are true:

- the shell has `RUN_ID`, `WEB_ORIGIN`, `HOME_DIR`, and `PAIRING_URL` set (from `eval` or `source "$ENV_FILE"`)
- the log contains a `[dev-runner] ... serverPort=... webPort=... baseDir=...` line whose `baseDir` is the disposable home
- the server log contains a `/pair#token=...` URL (Effect logs it as `pairingUrl:`; `katacode pair` prints `Pairing URL:`)
- `GET $WEB_ORIGIN/.well-known/kata/environment` returns JSON with `environmentId`, `label`, and `serverVersion`

Ports hash from the worktree path and move when occupied. A developer `vp run dev` may already be sitting on this worktree's default ports. Read the values launch printed. Do not assume 5733 / 13773. Vite often binds IPv6-only (`[::1]`). `bin/launch` and `bin/doctor` probe `::1`, then `127.0.0.1`, then `localhost`, and print the host that actually returned descriptor JSON as `WEB_ORIGIN`. Pairing URLs still print `localhost`. On IPv4-only `localhost` that hangs; open `PAIRING_OPEN_URL="${WEB_ORIGIN}/pair#${PAIRING_URL#*#}"`, not `$PAIRING_URL`. Do not assume 5733 / 13773.

The disposable home is `${TMPDIR:-/tmp}/katacode-verify-<RUN_ID>/home`. Runtime state is `<home>/userdata`. Never launch against `~/.katacode` or the worktree `.katacode`. Those are the user's live (or worktree) databases.

`bin/launch` starts the runner in a new process session and then exits. That is intentional: the stack must outlive the helper. `bin/cleanup` is what stops it, using the pid in `run.json`.

Do not pass `--auto-bootstrap-project-from-cwd`. A fresh home has no projects. After pairing you should see the empty landing, not a thread in this repo.

Teardown is `bin/cleanup`. It is required after a failed launch too, so a half-started runner is not left holding ports.

If `node_modules` is missing, run `vp i` and launch again. Do not invent a different start command.

## Doctor

Run this first whenever anything looks off, and before you drive:

```bash
.agents/skills/verify-katacode/bin/doctor
```

Pass the run id if `.last-run` is stale: `bin/doctor web-20260826-163000-a1b2c3d4`.

Doctor is read-only. It answers "is this instance worth driving?" by checking:

- the runner pid from `run.json` is alive and its start identity matches `runnerStart`
- `server-runtime.json` pid is alive and in that runner's process tree
- the recorded web and server ports are listened to by processes under that runner
- the home dir is the disposable one, not `~/.katacode` or the worktree `.katacode`
- the web origin serves the environment descriptor and the app shell

If doctor fails, stop. Do not click around in some other Kata Code tab "to save time." Attaching to the user's session is how you consume their pairing token, write into their database, or kill the wrong pid.

On Linux, Vite often binds IPv6-only (`[::1]`). `localhost` then times out on IPv4. `bin/doctor` probes `::1` first. If the descriptor probe fails in the first second after launch, run doctor once more against the same run id before treating the instance as dead.

A consumed pairing token is not a doctor failure. Mint a replacement against the same home:

```bash
node apps/server/src/bin.ts pair --base-dir "$HOME_DIR"
```

Use the new `Pairing URL:` exactly once. Tokens from `pair` have standard client scopes. The startup URL has admin scopes, which you need for Settings → Connections. For usage, settings general/appearance, the empty landing, and the command palette, a replacement token is enough.

## Drive

Install the browser CLI if needed (`npm i -g agent-browser && agent-browser install`), then load its current command list with `agent-browser skills get core` so you match the installed version.

Use one named session for the run. Do not pass `--session-name` (that persists cookies under `~/.agent-browser`).

```bash
PAIRING_OPEN_URL="${WEB_ORIGIN}/pair#${PAIRING_URL#*#}"
agent-browser --session katacode-verify open "$PAIRING_OPEN_URL"
agent-browser --session katacode-verify wait --text "What should we work on?"
agent-browser --session katacode-verify snapshot -i
# If `/pair` was already mounted (token-free before-shot), fill Pairing token and Continue instead.
```

`$PAIRING_URL` is the value from `eval "$(bin/launch)"` or `source "$ENV_FILE"`. It ends in `/pair#token=...` and still uses `localhost`. `$PAIRING_OPEN_URL` keeps that fragment on `$WEB_ORIGIN` (so `[::1]` when Vite is IPv6-only). Open `$PAIRING_OPEN_URL` exactly once as the first navigation that consumes the token (after any token-free `$WEB_ORIGIN/` before-shot in the pairing recipe). Opening it twice, or opening it in a second browser, burns the token. If the before-shot already mounted `/pair`, hash auto-submit will not run; use the form or reload.

After pairing, the app strips the token from the URL and redirects to `/`. Wait until you see either:

- heading **What should we work on?** and a button **Add project** (fresh home, no projects), or
- a chat composer whose placeholder starts with **Ask anything** (only if this home already has a project, which a correct launch should not)

Then follow the matching file under `features/`. Prefer ARIA names, `data-testid`, and route paths over coordinates.

Stable handles in this app:

| What | Handle |
| --- | --- |
| Pairing form | heading `Pair with this environment`, textbox `Pairing token`, button `Continue` |
| Empty landing | heading `What should we work on?`, button `Add project` |
| Sidebar settings | button `Settings` |
| Sidebar usage | button `Usage` |
| Command palette | `data-testid="command-palette"`, name `Command palette`, shortcut `mod+k` (⌘K on macOS, Ctrl+K elsewhere) |
| Usage page | heading `Usage`, groups `Usage metric` / `Usage period` / `Usage breakdown`, button `Refresh usage` |
| Settings | breadcrumb `Settings breadcrumb`, searchbox `Search settings`, nav labels `General`, `Appearance`, `Keybindings`, `Providers`, `Integrations`, `Source Control`, `Connections`, `Archive` |

Do not call internal atoms, test-only endpoints, or `t3-sqlite-state.ts exec` to claim a user path works. SQLite inspection is a side-effect check after a real UI action, and only against the disposable home.

Provider CLIs (Codex, Claude, Cursor, Grok, OpenCode) live on the server machine. An empty isolated home will not have an authenticated provider. You can still prove pairing, navigation, settings, usage chrome, and adding a project. You cannot honestly prove "send a message and get a reply" without a provider. Record that skip.

## Evidence

Write proof under `uat-evidence/<RUN_ID>/` in the repo. Cleanup must not delete that directory.

Minimum for a pass:

- `logs/launch.txt` from `bin/launch` (already redacted)
- one screenshot **before** the action and one **after**, or a snapshot pair that shows the same delta
- an accessibility snapshot of the resulting screen (`agent-browser --session katacode-verify snapshot`) saved under `snapshots/`
- `evidence.json` naming the feature id, entry point used, `WEB_ORIGIN` (no token), and the observable end state

Proof standards:

- Exercise the real user path. Pairing in the browser counts. Posting to `/api/auth/browser-session` yourself does not.
- Capture the action and the resulting state, not only the final screen.
- Check a second view of any mutation. Adding a project means the landing heading is gone and the sidebar or composer shows that project. Toggling usage to Tokens means the big number is a token count, not `$0.00`.
- Do not put pairing URLs, `#token=` fragments, or `Token:` lines in evidence. `bin/launch` already redacts `logs/launch.txt`. If you copy more log, pipe it through the same `sed` in `bin/lib.sh` (`redact_secrets`).
- Mocks are not allowed for pairing, routing, or settings persistence. The only acceptable gap is an external provider CLI that is not installed; say so and stop at the UI that names the missing provider.

`uat-evidence/` is gitignored. Leave it on disk so a human can open the screenshots. Do not commit it.

## Cleanup

When the proof is captured, or as soon as a launch/drive attempt fails:

```bash
.agents/skills/verify-katacode/bin/cleanup
```

That verifies the runner pid in `run.json` still has the recorded `runnerStart` identity, then kills that pid and its descendants, then deletes `${TMPDIR:-/tmp}/katacode-verify-<RUN_ID>/`. If the pid is gone or the identity no longer matches, cleanup skips signals and only removes this run's state. It does not delete `uat-evidence/<RUN_ID>/`.

Never `pkill -f`, never `pgrep | kill`, never kill a pid you found by matching `katacode` or the worktree path. This machine runs other Kata Code servers. The worktree you are in may already have a `vp run dev` on different ports. Kill only the pid launch printed, and only after the start identity matches.

Do not remove `~/.katacode` or the worktree `.katacode`.

Close the `katacode-verify` agent-browser session after cleanup so the next run does not reuse cookies against a dead origin.

## Helpers

All three are executable. Run them from the repository root.

```bash
eval "$(.agents/skills/verify-katacode/bin/launch)"
.agents/skills/verify-katacode/bin/doctor
.agents/skills/verify-katacode/bin/doctor web-20260826-163000-a1b2c3d4
.agents/skills/verify-katacode/bin/cleanup
# later shell: source "$ENV_FILE"
```

`launch` writes `uat-evidence/<RUN_ID>/`, `${TMPDIR:-/tmp}/katacode-verify-<RUN_ID>/run.json`, and `run.env`. `doctor` and `cleanup` read `.agents/skills/verify-katacode/.last-run` when you omit the id. Run ids are `web-<UTC>-<8 hex>` and must stay filename-safe (no `/` or `..`).

Feature recipes live in [features/](features/README.md). Drive from that map. A proof that uses one convenient entry point is incomplete when the map lists others; report the ones you did not reach rather than silently skipping them.
