# Scheduled routines

Scheduled routines save an instruction with a project, provider, permission mode, workspace, and schedule. The routine runs in its owning environment, so the environment must be connected when you create or change it.

Open **Routines** from the sidebar and choose **New routine → Set up manually** or **Create in chat**. Chat creation uses a separately selected generation model to turn an explicit schedule request into a draft. The chat can refine the name, instruction, project, routine model, and schedule; review those fields in the editor before saving. Permission mode and workspace stay under manual control. Choose a project, provider and model, permission mode, workspace, and schedule when setting up manually. Git projects default to an isolated worktree; shared folders are available when the routine must work in the project directory. The schedule preview shows the next three occurrences in the selected IANA timezone, including daylight saving changes.

Save the routine to enable it. The editor shows its revision and recent runs. **Test run** admits one immediate run using the saved revision and the same durable workspace and provider settings. Open a confirmed run to continue in its conversation. A test request is idempotent when the same request identifier is retried.

Chat requests need a clear schedule such as “every weekday at 9 AM.” If the schedule or project is ambiguous, the assistant asks for clarification and leaves the editor unchanged. Canceling a chat creation aborts the request and discards the unsaved draft; retrying a request keeps the current draft. If you edit the editor while a response is pending, the response becomes a review offer and cannot overwrite those edits automatically. The conversation keeps its latest ten turns.

Pause a routine to stop future admissions and cancel queued work. Resume recalculates the next occurrence from the current time. Deleting a routine keeps its run history available to the server while removing it from the library. If a server restarts after a provider submission cannot be confirmed, the run remains active and is marked **Needs attention** until matching provider evidence arrives.

Routine changes use the saved revision. If another browser or environment changes the routine first, reload the editor and resolve the conflict before saving again. Offline environments keep their saved routines visible and disable mutations until they reconnect.
