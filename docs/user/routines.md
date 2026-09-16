# Routines

Scheduled routines save an instruction with a project, provider, permission mode, workspace, and schedule. The routine runs in its owning environment, so the environment must be connected when you create or change it.

Open **Routines** from the sidebar and choose **New routine → Set up manually** or **Create in chat**. Chat creation uses a separately selected generation model to turn an explicit schedule request into a draft. The chat can refine the name, instruction, project, routine model, and schedule; review those fields in the editor before saving. Permission mode and workspace stay under manual control. Choose a project, provider and model, permission mode, workspace, and schedule when setting up manually. Git projects default to an isolated worktree; shared folders are available when the routine must work in the project directory. The schedule preview shows the next three occurrences in the selected IANA timezone, including daylight saving changes.

Save the routine to enable it. The editor shows its revision and recent runs. **Test run** admits one immediate run using the saved revision and the same durable workspace and provider settings. Open a confirmed run to continue in its conversation. A test request is idempotent when the same request identifier is retried.

Chat requests need a clear schedule such as “every weekday at 9 AM.” If the schedule or project is ambiguous, the assistant asks for clarification and leaves the editor unchanged. Canceling a chat creation aborts the request and discards the unsaved draft; retrying a request keeps the current draft. If you edit the editor while a response is pending, the response becomes a review offer and cannot overwrite those edits automatically. The conversation keeps its latest ten turns.

Pause a routine to stop future admissions and cancel queued work. Resume recalculates the next occurrence from the current time. Deleting a routine keeps its run history available to the server while removing it from the library. If a server restarts after a provider submission cannot be confirmed, the run remains active and is marked **Needs attention** until matching provider evidence arrives.

Routine changes use the saved revision. If another browser or environment changes the routine first, reload the editor and resolve the conflict before saving again. Offline environments keep their saved routines visible and disable mutations until they reconnect.

## GitHub event routines

A routine can run when a GitHub event reaches its environment instead of on a schedule. In the editor, choose **GitHub event** under **When to run**.

**Connect a repository.** Choose **Connect a repository**, enter the repository as `owner/name`, and choose **Create webhook**. Kata creates the repository webhook with the GitHub CLI (`gh api`) on your behalf, so `gh` must be authenticated on the environment host and you must administer the repository. The callback URL is this environment's public address from Kata Code Connect's managed tunnel; without a managed tunnel the setup stops and explains what is missing. The signing secret is generated on the environment, sent to GitHub once, and never displayed. Setup waits for GitHub's ping and the connection shows **Verified** when it arrives.

**Choose the event and filters.** Supported events are pull request opened, pull request updated (new commits, reopened, or ready for review; title and body edits are excluded), issue opened, and workflow run failed (conclusions `failure`, `timed_out`, and `action_required`). Filters are the base branch for pull requests, the head branch for workflow runs, draft inclusion, and an issue label. Filters use GitHub's stable ids, so a renamed repository or label keeps matching.

**Runs and conversations.** A matching signed delivery is recorded and admits one run before Kata answers GitHub. The conversation's first turn is the saved instruction followed by bounded event context (title, number, URL, actor, branch, conclusion) marked as untrusted. Anyone who can open a pull request, issue, or workflow run in the connected repository writes part of that context, so treat event text as input, not instructions. **Recent runs** shows **Open on GitHub** beside the run. The active-slot rule still applies: a delivery that arrives while a previous run is active is recorded as skipped.

**Duplicates.** Redelivering the same delivery from GitHub or replaying the same signed body under a new delivery id admits nothing new. Identical bodies are suppressed for seven days per connection.

**Diagnostics and controls.** The connection panel shows the callback URL, hook id, last delivery, and accepted, ignored, and rejected counts. GitHub does not resend a delivery that failed on its own; use **Open delivery history** to redeliver it from the repository's webhook settings. **Check ping** asks GitHub to ping the hook again. **Rotate secret** issues a new signing secret; the old one stops verifying immediately. **Disable** removes the secret so new deliveries are rejected, then deletes the hook on GitHub. Pausing the routine stops new runs while the connection stays available. There is no lossless-delivery guarantee: a delivery that reaches an unavailable host is not queued anywhere.
