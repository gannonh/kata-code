# Scheduled routines

The Routines page lists routines from every connected environment, lets a user configure a saved scheduled prompt, and shows durable run history and conversation links. The New routine menu offers manual setup and chat creation. Chat creation produces an editable draft; no routine or run exists until Save.

## Sub-features

- `routines-open` opens Routines from the sidebar and `/routines`.
- `routines-create` creates a manual routine with a project, model, permission mode, workspace, and schedule.
- `routines-chat` creates and refines a routine draft from an explicit schedule request while keeping the generation model separate from the routine execution model.
- `routines-preview` shows the next three schedule occurrences in the selected timezone.
- `routines-test` starts one idempotent test run and exposes its conversation when the provider confirms it.
- `routines-history` refreshes recent runs after a run changes state.
- `routines-conflict` reports a stale revision instead of overwriting a newer edit.
- `routines-github-setup` connects a GitHub repository through guided setup and shows the callback URL, ping status, and diagnostics.
- `routines-github-run` records a signed GitHub delivery, admits one run, and shows `Open on GitHub` beside the run.
- `routines-github-controls` pauses, rotates the secret, and disables a connection while diagnostics update.

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
- **Menu.** Click `New routine`, then inspect the menu. `Set up manually` and `Create in chat` are enabled.
- **Create.** Click `Set up manually`, fill `Name` and `Instruction`, choose `Project`, `Provider and model`, and `Permission mode`, then choose `Daily` and set an IANA timezone. Click `Save`. The routine card shows the saved name and schedule.
- **Chat create.** Click `New routine → Create in chat`. Select `Generation model`, enter “Every weekday at 9 AM, summarize the latest project changes,” and click `Generate draft`. The assistant response and editable Routine editor appear together. Change the routine permission mode or workspace manually, then refine the instruction in chat and confirm those manual values remain. Save only after reviewing the schedule preview.
- **Chat clarification.** Submit an ambiguous request such as “Summarize the project regularly.” The assistant asks for a schedule and the editor fields remain unchanged. Retry after adding a concrete schedule.
- **Chat cancel and stale response.** Start a request, click the chat `Cancel`, and verify the in-flight request is interrupted and the unsaved draft is discarded. Start another request, edit `Instruction` while it is pending, and verify the response shows `Review generated changes` instead of replacing the edit. Apply it only after reviewing.
- **Preview.** In the editor, change `IANA timezone` to `America/Los_Angeles`. Three `Next runs` rows remain visible and include a local offset.
- **Model options.** Choose a model with options, then choose its effort (for example `Max`). Save and reopen the editor. The selected option remains visible.
- **Test.** Click `Test run`. The message `Test run admitted` appears. Wait for `Recent runs` to show `Succeeded`; a link named `open the conversation` opens the confirmed thread.
- **History refresh.** Keep the editor open while the test completes. `Recent runs` updates without reopening the editor.
- **Conflict.** Open the same routine in two paired clients, save from the first, then save the stale second draft. The second editor shows a conflict message and the first saved configuration remains intact.
- **Pause and resume.** Click `Pause`, verify the card says `Paused`, then click `Resume` and verify it says `Active`.
- **GitHub trigger.** In the editor choose the `GitHub event` button under `When to run`. The `Repository connection` select and a `Connect a repository` button appear. With a Kata Code Connect managed tunnel and `gh` authenticated as a repository admin, choose `Connect a repository`, type `owner/name`, and choose `Create webhook`. The status line reports the created webhook and then `GitHub ping received.`; the diagnostics panel shows `Verified`, the callback URL, and the hook id. Without a managed tunnel the status line names the missing public callback URL and no webhook is created.
- **GitHub run.** Choose `Pull request opened`, keep the default base branch, and `Save`. Open a pull request in the repository (or send a signed delivery to the callback on an isolated host). `Recent runs` gains a row with `Open on GitHub` and, once confirmed, `Open conversation`. The diagnostics panel shows `Accepted 1` and the delivery id under `Last delivery`.
- **GitHub controls.** Choose `Rotate secret`; the status line reports the rotation. Choose `Disable`; the connection reads `Disabled` and a further delivery is rejected (`Rejected` count increases). Pausing the routine keeps the connection but admits no run.
- **Proof.** Save `screenshots/routines-library.png` with the cards and editor visible, `screenshots/routines-preview-history.png` with the timezone preview and completed run, and `snapshots/routines.aria.txt` with the accessibility snapshot. Record the route and actions in `evidence.json`.

## Gotchas

- Run every command with `--session katacode-verify` after pairing; an unpaired session can appear to load the route while mutations fail.
- A disconnected environment still appears in the library. Its cards remain readable, while Save, Test run, Pause, Resume, and Delete are disabled.
- The preview is server-validated. Invalid IANA zones and malformed cron expressions show an error and cannot be saved.
- A provider response may take time. Keep the editor open so the durable history subscription can show the terminal state.
- GitHub setup needs three fixtures: a managed tunnel link on the environment, `gh` authenticated on the environment host, and admin access to the repository. Missing fixtures block the GitHub sub-features; report them as blocked, not failed.
- Signed deliveries can be sent to the callback directly on an isolated host with `X-Hub-Signature-256` computed over the raw body using the secret stored under `<home>/userdata/secrets/routine-connection-<id>.bin`.
