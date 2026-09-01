# Empty landing and add project

With no projects, Kata Code asks what to work on. Adding a local folder creates a project and opens a draft thread with a composer.

## Sub-features

- `landing-empty` shows the no-project hero after pairing a fresh home.
- `landing-add-button` opens the add-project flow from the hero button.
- `landing-add-palette` opens the same flow from the command palette item `Add project`.
- `landing-local-folder` adds a directory from disk, removes the empty hero, and opens the project composer.

## How to get to it (user POV)

- Land on `/` after pairing a home that has no projects.
- Choose `Add project` on that page.
- Press `mod+k` and choose `Add project`.

## Driving it with agent-browser

Preconditions:

- Pairing has succeeded on a disposable home with no projects.
- A directory exists at `$VERIFY_ROOT/sample-project` (create it empty if needed). `$VERIFY_ROOT` is `${TMPDIR:-/tmp}/katacode-verify-<RUN_ID>`.
- `bin/doctor` still passes.

- **Empty hero.** Load `/`. Run `agent-browser --session katacode-verify snapshot`. Text `What should we work on?` (a styled div, not a heading role), description `Add a project to start your first thread.`, button `Add project`. Save `screenshots/landing-before-add.png` and `snapshots/landing-before-add.aria.txt` while that empty hero is visible (token-free).
- **Hero entry.** Choose `Add project`. Run `agent-browser --session katacode-verify click` on the button named `Add project`. A dialog named `Command palette` appears with `data-palette-mode="command"`. The listbox under group `Sources` starts with `Local folder`, then `Git URL` and `GitHub repository`; provider sources that are not configured show a `Setup Required` button instead of an option. On a single environment this is the first step.
- **Palette entry.** Close the dialog, press `mod+k`, and choose `Add project`. Run `agent-browser --session katacode-verify press` with `Meta+k` on macOS or `Control+k` elsewhere, then click `Add project`. The same add-project dialog appears.
- **Local folder.** Choose `Local folder`. The combobox is now named `Enter path (e.g. ~/projects/my-app)`, is prefilled with `~/`, and a `Directories` group lists folders. The placeholder attribute is set but never visible while the field holds a path, so `find placeholder` fails; target the input inside `[data-testid=command-palette]` or its snapshot ref.
- **Add the sample directory.** Fill (replace, do not append) the path with `$VERIFY_ROOT/sample-project` and press Enter. The submit button is named `Add (Enter)` when the path exists or `Create & Add (Enter)` when it does not; with a directory row highlighted its name ends in `⌘ Enter` / `Ctrl Enter` and plain Enter selects the row instead. The dialog closes. The empty hero is gone. The URL is `/draft/...`. The heading starts with `What should we build in` and names the sample directory. A remaining `What should we work on?` heading is a fail. The composer textbox is named by its placeholder: `Ask anything, @tag files/folders, $use skills, or / for commands`, `Ask for follow-up changes or attach images` (seen on a fresh draft), or `Enable a provider in Settings to send a message` if no provider CLI is installed. That is extra proof, not required.
- **Proof.** Screenshot `uat-evidence/<RUN_ID>/screenshots/landing-after-add.png` and snapshot `snapshots/landing-after-add.aria.txt`. Keep the before-add artifacts from the empty-hero step. The after snapshot names `sample-project` or shows the draft heading. Confirm `projection_projects` in the disposable database only as a side check, with `node apps/server/scripts/t3-sqlite-state.ts query --base-dir "$HOME_DIR" --sql "SELECT title, workspace_root FROM projection_projects"`.

## Gotchas

- A launch that omitted `--home-dir` and reused the worktree `.katacode` will skip this hero if that database already has projects. Doctor must have accepted the disposable home.
- `Create & Add (Enter)` appears once the directory listing settles on a path that does not exist; `Add (Enter)` when it does. The label can read `Add` for a moment while the listing is pending, so do not gate on it.
- With more than one environment, or none connected, an `Environments` group comes before `Sources`. The isolated stack has one, so `Sources` is first.
- Re-adding a path that is already a project opens that project's latest thread instead of creating a duplicate. A rerun against the same home proves nothing about creation.
- Relative paths need an active project. Use the absolute sample-project path.
- Adding this repo as the project is allowed but noisy. Prefer the empty sample directory under the verify root.
- Sending a prompt after this is a different feature and needs an authenticated provider CLI on PATH. Do not fail landing because send is disabled.
