# Empty landing and add project

With no projects, Kata Code asks what to work on. Adding a local folder creates a project and opens a draft thread with a composer.

## Sub-features

- `landing-empty` shows the no-project hero after pairing a fresh home.
- `landing-add-button` opens the add-project flow from the hero button.
- `landing-add-palette` opens the same flow from the command palette item `Add project`.
- `landing-local-folder` adds a directory from disk and leaves the empty hero.

## How to get to it (user POV)

- Land on `/` after pairing a home that has no projects.
- Choose `Add project` on that page.
- Press `mod+k` and choose `Add project`.

## Driving it with agent-browser

Preconditions:

- Pairing has succeeded on a disposable home with no projects.
- A directory exists at `$VERIFY_ROOT/sample-project` (create it empty if needed). `$VERIFY_ROOT` is `${TMPDIR:-/tmp}/katacode-verify-<RUN_ID>`.
- `bin/doctor` still passes.

- **Empty hero.** Load `/`. Run `agent-browser --session katacode-verify snapshot`. Heading `What should we work on?`, description `Add a project to start your first thread.`, button `Add project`.
- **Hero entry.** Choose `Add project`. Run `agent-browser --session katacode-verify click` on the button named `Add project`. A dialog named `Command palette` appears. Either the sources list includes `Local folder`, or the input placeholder is `Enter project path (e.g. ~/projects/my-app)`.
- **Palette entry.** Close the dialog, press `mod+k`, and choose `Add project`. Run `agent-browser --session katacode-verify keyboard` with `Meta+k` on macOS or `Control+k` elsewhere, then click `Add project`. The same add-project dialog appears.
- **Local folder.** If you see `Local folder`, choose it. The placeholder becomes `Enter project path (e.g. ~/projects/my-app)`.
- **Add the sample directory.** Fill the path with `$VERIFY_ROOT/sample-project` and submit `Add` or `Create & Add` (Enter). The dialog closes. The empty hero is gone. A composer is visible. Its placeholder is `Ask anything, @tag files/folders, $use skills, or / for commands`, or `Enable a provider in Settings to send a message` if no provider CLI is installed. Either is a pass for this feature. A remaining `What should we work on?` heading is a fail.
- **Proof.** Screenshot `uat-evidence/<RUN_ID>/screenshots/landing-after-add.png` and snapshot `snapshots/landing-after-add.aria.txt`. The snapshot names the new project (the sample directory's basename) or shows the composer. Confirm `projection_projects` in the disposable database only as a side check, with `node apps/server/scripts/t3-sqlite-state.ts query --base-dir "$HOME_DIR" --sql "SELECT title, cwd FROM projection_projects"`.

## Gotchas

- A launch that omitted `--home-dir` and reused the worktree `.katacode` will skip this hero if that database already has projects. Doctor must have accepted the disposable home.
- `Create & Add` appears when the path does not exist yet. `Add` appears when it does. Both are valid.
- Relative paths need an active project. Use the absolute sample-project path.
- Adding this repo as the project is allowed but noisy. Prefer the empty sample directory under the verify root.
- Sending a prompt after this is a different feature and needs an authenticated provider CLI on PATH. Do not fail landing because send is disabled.
