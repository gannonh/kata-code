# Scheduled routines

The Routines page lists routines from every connected environment, lets a user configure a saved scheduled prompt, and shows durable run history and conversation links. The manual setup menu is available; Create in chat is visibly disabled for this slice.

## Sub-features

- `routines-open` opens Routines from the sidebar and `/routines`.
- `routines-create` creates a manual routine with a project, model, permission mode, workspace, and schedule.
- `routines-preview` shows the next three schedule occurrences in the selected timezone.
- `routines-test` starts one idempotent test run and exposes its conversation when the provider confirms it.
- `routines-history` refreshes recent runs after a run changes state.
- `routines-conflict` reports a stale revision instead of overwriting a newer edit.

## How to get to it (user POV)

- Choose the sidebar button named `Routines`.
- Open `$WEB_ORIGIN/routines` after pairing and completing onboarding.
- Choose `New routine`, then `Set up manually`.

## Driving it with agent-browser

Preconditions:

- Pairing and onboarding have succeeded.
- At least one connected environment has one imported project and one enabled provider with a model.
- Use a disposable environment because Save, Test run, Pause, Resume, and Delete write durable state.

- **Open.** Run `agent-browser --session katacode-verify open "$WEB_ORIGIN/routines"`. The heading `Routines`, button `New routine`, and sidebar button `Routines` are visible.
- **Menu.** Click `New routine`, then inspect the menu. `Set up manually` is enabled and `Create in chat` is disabled.
- **Create.** Click `Set up manually`, fill `Name` and `Instruction`, choose `Project`, `Provider and model`, and `Permission mode`, then choose `Daily` and set an IANA timezone. Click `Save`. The routine card shows the saved name and schedule.
- **Preview.** In the editor, change `IANA timezone` to `America/Los_Angeles`. Three `Next runs` rows remain visible and include a local offset.
- **Model options.** Choose a model with options, then choose its effort (for example `Max`). Save and reopen the editor. The selected option remains visible.
- **Test.** Click `Test run`. The message `Test run admitted` appears. Wait for `Recent runs` to show `Succeeded`; a link named `open the conversation` opens the confirmed thread.
- **History refresh.** Keep the editor open while the test completes. `Recent runs` updates without reopening the editor.
- **Conflict.** Open the same routine in two paired clients, save from the first, then save the stale second draft. The second editor shows a conflict message and the first saved configuration remains intact.
- **Pause and resume.** Click `Pause`, verify the card says `Paused`, then click `Resume` and verify it says `Active`.
- **Proof.** Save `screenshots/routines-library.png` with the cards and editor visible, `screenshots/routines-preview-history.png` with the timezone preview and completed run, and `snapshots/routines.aria.txt` with the accessibility snapshot. Record the route and actions in `evidence.json`.

## Gotchas

- Run every command with `--session katacode-verify` after pairing; an unpaired session can appear to load the route while mutations fail.
- A disconnected environment still appears in the library. Its cards remain readable, while Save, Test run, Pause, Resume, and Delete are disabled.
- The preview is server-validated. Invalid IANA zones and malformed cron expressions show an error and cannot be saved.
- A provider response may take time. Keep the editor open so the durable history subscription can show the terminal state.
