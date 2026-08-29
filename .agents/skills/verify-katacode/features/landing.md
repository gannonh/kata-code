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

- **Empty hero.** Load `/`. Run `agent-browser --session katacode-verify snapshot`. Heading `What should we work on?`, description `Add a project to start your first thread.`, button `Add project`. Save `screenshots/landing-before-add.png` and `snapshots/landing-before-add.aria.txt` while that empty hero is visible (token-free).
- **Hero entry.** Choose `Add project`. Run `agent-browser --session katacode-verify click` on the button named `Add project`. A dialog named `Command palette` appears. The sources list includes `Local folder` (and other clone sources). On a single environment this is the first step.
- **Palette entry.** Close the dialog, press `mod+k`, and choose `Add project`. Run `agent-browser --session katacode-verify press` with `Meta+k` on macOS or `Control+k` elsewhere, then click `Add project`. The same add-project dialog appears.
- **Local folder.** Choose `Local folder`. The input placeholder becomes `Enter path (e.g. ~/projects/my-app)`.
- **Add the sample directory.** Fill the path with `$VERIFY_ROOT/sample-project` and submit `Add (Enter)` or `Create & Add`. The dialog closes. The empty hero is gone. The URL is `/draft/...`. The heading starts with `What should we build in` and names the sample directory. A remaining `What should we work on?` heading is a fail. Composer placeholder `Ask anything, @tag files/folders, $use skills, or / for commands`, or `Enable a provider in Settings to send a message` if no provider CLI is installed, is extra proof, not required.
- **Proof.** Screenshot `uat-evidence/<RUN_ID>/screenshots/landing-after-add.png` and snapshot `snapshots/landing-after-add.aria.txt`. Keep the before-add artifacts from the empty-hero step. The after snapshot names `sample-project` or shows the draft heading. Confirm `projection_projects` in the disposable database only as a side check, with `node apps/server/scripts/t3-sqlite-state.ts query --base-dir "$HOME_DIR" --sql "SELECT title, workspace_root FROM projection_projects"`.

## Gotchas

- A launch that omitted `--home-dir` and reused the worktree `.katacode` will skip this hero if that database already has projects. Doctor must have accepted the disposable home.
- `Create & Add` appears when the path does not exist yet. `Add (Enter)` appears when it does. Both are valid.
- Relative paths need an active project. Use the absolute sample-project path.
- Adding this repo as the project is allowed but noisy. Prefer the empty sample directory under the verify root.
- Sending a prompt after this is a different feature and needs an authenticated provider CLI on PATH. Do not fail landing because send is disabled.
