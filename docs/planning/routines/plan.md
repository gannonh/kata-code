# Kata Code routines plan

Deliver the accepted routine library with manual and chat creation, scheduled prompts, and GitHub and Linear event triggers.
The owning Kata Code server executes each admitted occurrence through an ordinary conversation.
[KAT-3318](https://linear.app/kata-sh/issue/KAT-3318/deliver-scheduled-and-event-triggered-routines) owns the program. KAT-3319, KAT-3320, KAT-3321, and KAT-3322 each own one implementation PR. KAT-3323 owns acceptance on merged main.
This September 9, 2026 plan records the design approved in KAT-3317. All issues remain Backlog. No production Build has started.
The code inventory uses main at `96f28603fe9fa9d919767f7877a43618f4e94e39`. New file names below are proposed paths.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists in a file, log, screenshot, test result, or SHA. The body is a how-to. Appendices explain the product rules, evidence, alternatives, and limits. Linear child acceptance criteria are the Build authority. Update Linear first if the plan changes.

Use `skills/poteto-mode/playbooks/autopilot-stack.md` from the installed pstack plugin when execution is authorized. The operator retains landing authority. Every implementation PR stops for operator review. Repository lifecycle rules take precedence over the playbook. A request for this plan does not authorize its execution, a recurring audit, or a release.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

| Work     | Deliverable                              | Depends on                     | Review before merge |
| -------- | ---------------------------------------- | ------------------------------ | ------------------- |
| KAT-3319 | Manual schedules, execution, and history | None                           | Yes                 |
| KAT-3320 | Chat drafting and refinement             | KAT-3319                       | Yes                 |
| KAT-3321 | GitHub events and connection setup       | KAT-3319                       | Yes                 |
| KAT-3322 | Linear events and connection setup       | KAT-3321                       | Yes                 |
| KAT-3323 | Combined acceptance on merged main       | All four implementation issues | Acceptance record   |

KAT-3320 and KAT-3321 have independent product dependencies. They still share schema and editor integration files. Keep those edits sequential. The default review order is KAT-3319, KAT-3320, KAT-3321, KAT-3322. A missing GitHub credential does not block the schedule or chat slices.

## Program checklist

### Arm the program

- [ ] State this plan and its lifecycle gates, then stop. Execute only after the operator requests Build and each selected issue reaches Start, followed by In Progress. Read the current issue before every transition. Planning and dependency completion alone do not grant Start.
- [ ] On the operator's go, put this exact objective in the standing orders and todolist. "Execute docs/planning/routines/plan.md for KAT-3319, KAT-3320, KAT-3321, and KAT-3322 under their live Linear acceptance criteria. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. The operator reviews and retains merge authority. Finish with KAT-3323 acceptance on merged main. Human Review stops agent work. Merging is required for landing."
- [ ] Read `skills/poteto-mode/playbooks/autopilot-stack.md`, `skills/swarm/SKILL.md`, `skills/poteto-mode/references/provider-dispatch.md`, `skills/poteto-mode/playbooks/opening-a-pr.md`, `skills/how/SKILL.md`, `skills/architect/SKILL.md`, `skills/typescript-best-practices/SKILL.md`, and `skills/principle-make-operations-idempotent/SKILL.md` from the installed plugin. Read `.agents/skills/test-t3-app/SKILL.md` and `.agents/skills/verify-katacode/SKILL.md` from the checkout. Re-read the execution playbook and standing orders at every audit tick.
- [ ] If the operator commissions the continuing execution program, arm its 30-minute audit as a real Codex thread heartbeat through the automation tool. Do not arm it during planning. The cadence is an observation interval, never an owner deadline.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from the installed plugin and the standing orders. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a lane only on affirmative failure evidence, and dispatch its replacement in the same tick. Then send the operator a status message, whether or not anything changed, with the queue table of PR, owner, state, and head SHA, the verdicts since the last tick, what merged, open operator gates, and blockers."
- [ ] On hold, stand-down, or Human Review, give the affected owners a zero-writes order. Do not dispatch replacements or continue CI fixes against a held issue. Read any runtime, model, and effort labels before Build. Resolve missing or conflicting routes rather than inventing a descriptor.

### Spawn owners

- [ ] Assign one owner and one isolated worktree per authorized Linear issue. Use that issue's generated branch name. Each owner reads its full spec, the parent product rules, and the source paths below.
- [ ] Branch KAT-3319 from current main. KAT-3320 and KAT-3321 depend on KAT-3319. KAT-3322 depends on KAT-3321. Prefer merged prerequisites. When the operator requests a stack, record each exact parent tip and patch base. Same-repository children target parent branches. Fork children target main and retain local parent ancestry.
- [ ] Keep feature files within each section's boundaries. Serialize edits to `packages/contracts/src/routines.ts`, RPC exports, migrations, the shared save editor, and server layer assembly. Parallelize provider adapters and independent verification only after those contracts settle.
- [ ] Review-gate KAT-3319, KAT-3320, KAT-3321, and KAT-3322 with screenshots and a video. KAT-3323 verifies the landed combination and owns no product implementation PR.

### PR mechanics, for every PR

- [ ] Resolve the forge against `gannonh/kata-code`. Default to `gh`. If the installed Origin CLI can resolve this repository, use its PR commands consistently. Record the chosen tool. Validate base repository, head repository, URLs, branch, and SHA separately. Set `base_repo=gannonh/kata-code` and pass `--repo "$base_repo"` on every `gh pr` command. Never infer identity from a remote name.
- [ ] Open one draft PR per implementation issue and include exactly that issue ID in its title or body. Keep it draft until the artifacts and diff are reviewable. Pass multiline descriptions with a structured tool argument or `--body-file`. Use current parent-branch bases only for an approved stack.
- [ ] Run `vp run lint`, `vp run typecheck`, and the relevant package tests before the review push. Keep hooks enabled. Require the existing CI Check, Test, and server shard jobs, including branding, unused-code checks, and desktop build, as configured at execution time.
- [ ] Run deslop before commit and no-comments before review. Triage every human, Bugbot, and security-review comment with a fix, a supported dismissal, or an exact question. Re-read Linear after GitHub events before making any state transition.
- [ ] Rebase a root on current main and a child on its recorded parent tip before review. Preserve unrelated working changes. The planning checkout already had an unrelated AGENTS.md modification. Never include it in this feature.

### Verdict and merge, for every PR

- [ ] At the reviewable head, run one gates lane, the ten live lanes below, one performance lane, and an independent receipt/diff audit using the swarm skill. Resolve `swarm workers` from the current model sheet and record provider, model, effort, head SHA, commands, and evidence. At the current four-agent capacity, run at most three child lanes at once.
- [ ] Require PASS for every required lane. BLOCKED and NOT RUN are not PASS. A changed patch invalidates affected evidence. Retest unchanged behavior only when changed code, a failure, or an unresolved concern warrants it. CI remains required on the final published head.
- [ ] Record verdict SHA, patch base, stable patch ID, and current landing SHA. On a topology-only rebase, an unchanged patch ID may preserve the code verdict, but rerun CI and mergeability. A changed patch requires renewed relevant verification. Never force-push shared history without the user approval required by the active instructions.
- [ ] Stop at Human Review with all comments answered and review threads resolved. Append verified PRs in the frozen review order. The operator lands them in Merging, one at a time. Do not enable automatic merge or treat a clean verdict as permission to merge. After landing, verify the accepted criteria and record the result in the issue.

### Boot recipe, for every live lane

Each live lane is one configured swarm worker at the PR head, in its own worktree and disposable home. Use the repository verification skill to start the stack. Use the installed in-app browser driver for web and a supported Electron driver for desktop. Web screenshots do not establish Electron or native mobile acceptance.

- [ ] In the lane worktree, fetch the validated head URL and branch, then check out the exact recorded head SHA. Verify `git rev-parse HEAD` before launch. Retain the worktree and environment identity in the receipt.
- [ ] Run `.agents/skills/verify-katacode/bin/launch` and `.agents/skills/verify-katacode/bin/doctor`. Read the actual ports and disposable home from the output. Pair once using that lane's token. For Electron, start `vp run dev:desktop --home-dir` with a separate absolute temporary directory and wait for its connected environment. Confirm provider availability before an execution claim.
- [ ] Drive creation, editing, saving, and run actions through the UI. Use server logs, authenticated read APIs, provider delivery history, and `node apps/server/scripts/t3-sqlite-state.ts query` only for diagnostics. Use unit-level crash injection for every transaction seam, then demonstrate representative process restarts on the isolated live server. Never seed shared databases or change the host clock.
- [ ] Save screenshots to `uat-evidence/routines/swarm-ISSUE/worker-N/` with the filenames specified below. Replace ISSUE and N with the actual issue and lane number. Store the receipt and measurements alongside them. Exclude credentials, pairing tokens, and raw private webhook bodies.
- [ ] Use authorized disposable provider resources for webhook tests. Remove only owned webhooks, secrets, projects, worktrees, and processes. Keep redacted evidence. Follow the verification skill's cleanup helper with the recorded run identity. Keep a review stack alive only when the operator is still inspecting it under test-t3-app.

## Create scheduled routines with durable runs and conversation history (KAT-3319)

**Depends on.** None.

**Files.**

- [ ] Create `packages/contracts/src/routines.ts` and its tests. Edit `packages/contracts/src/rpc.ts` and package exports for routine queries, commands, and subscriptions.
- [ ] Create `apps/server/src/routines/RoutineStore.ts`, `RoutineScheduler.ts`, `RoutineDispatcher.ts`, and their behavior tests. Add the next available numbered routine migration under `apps/server/src/persistence/Migrations/` and register it in `Migrations.ts`.
- [ ] Edit `apps/server/src/serverRuntimeStartup.ts`, `apps/server/src/server.ts`, `apps/server/src/ws.ts`, and RPC composition, `apps/server/src/auth/RpcAuthorization.ts`, and only the orchestration hooks needed for durable run reconciliation. Reuse `OrchestrationEngine.dispatch` and `ProviderCommandReactor`.
- [ ] Create routine operations and subscribed state under `packages/client-runtime/src/`. Create `apps/web/src/features/routines/` and `apps/web/src/routes/_chat.routines.tsx`. Regenerate `routeTree.gen.ts` through its route generator. Edit `SidebarChrome.tsx` and `AppSidebarLayout.tsx` only for utility navigation and layout.
- [ ] Create `docs/user/routines.md` and `.agents/skills/verify-katacode/features/routines.md`. No production path is deleted by this first addition.

**Build.**

- [ ] Preserve the accepted library layout and add Routines to global utility navigation. Add empty, selected, editing, loading, offline, conflict, and error states. Manual creation uses a separate unsaved draft. Keep the New routine menu's manual route operational. The chat entry is visibly unavailable until its dependent slice lands.
- [ ] Create Effect schemas for RoutineDraft, Routine, ScheduleTrigger, RoutineRun, and typed statuses. Key records by environment and routine identity. Store an explicit project, model selection, permission mode, workspace policy, instruction, trigger, and revision. Reject stale saves. The saved runtime settings remain stable when project defaults change.
- [ ] Support weekdays, daily, weekly, and five-field cron with an explicit IANA timezone and the next three run dates. Reuse the installed Effect Cron API. Validate cron and timezone at the server boundary. Minimum frequency is one minute. Adopt the checked DST behavior and show actual dates and offsets.
- [ ] Persist routines, run admission, unique occurrence keys, immutable configuration snapshots, and deterministic orchestration command IDs in the environment database. Start each accepted run through the existing orchestration and worktree path. Capture one thread identity before dispatch and reconcile it on restart. Do not add a separate provider runner.
- [ ] Make run claims atomic in SQLite with a unique occurrence key, one active slot per routine, and a fenced owner generation. Two server processes sharing the same database must not submit the same run. Lease expiry alone never authorizes repeating a potentially started provider turn. Separate queued recovery from ambiguous in-flight recovery.
- [ ] Start the scheduler as a scoped server worker. Skip unadmitted elapsed schedules at startup and record a skipped interval. Recover already admitted runs. Never replay an uncertain provider submission blindly. Skip new occurrences while the same routine is active or waiting for approval.
- [ ] Represent uncertain provider submission as an explicit needs-attention run state that keeps its active slot until resolved. Track the initial prompt turn through normalized orchestration correlation. Later manual follow-ups in the linked conversation do not reopen a completed routine run. Show a conversation link only after its creation is confirmed.
- [ ] Compose the worker through serverRuntimeStartup and the activation-safe forkParked pattern. Routine schedules must remain active with no connected client and must not depend on BackgroundPolicy client-demand checks. Recover persisted pending intent explicitly because ProviderCommandReactor subscribes to a hot stream and exact command receipt deduplication does not replay a lost event.
- [ ] Pause blocks future starts and cancels unstarted queued work. Resume chooses the next future occurrence. Delete disables future work while preserving conversations and their source metadata. An active conversation continues until stopped through its normal controls. Keep run history paginated.
- [ ] Test run uses the saved revision and the same dispatch path. Require Save before testing edited or new drafts. Repeated transmission of one Test run request produces one run. Test run is a real prompt execution, including its ordinary approvals and costs.
- [ ] Use existing Supervised as the new-routine permission default and expose the existing mode control before activation. Respect provider capabilities and show waiting-for-approval in recent runs. Default Git runs to an isolated worktree. Non-Git projects expose their selected shared directory. Missing resources or credentials produce a clear blocked result.
- [ ] Aggregate routines across connected environments through the shared client runtime without moving execution to the browser. Every row identifies its owning machine and project. Offline rows remain distinguishable and cannot submit changes to another server. Scope routine reads, edits, and execution at RPC authorization boundaries.

**You see.**

- [ ] A user creates a routine manually, saves it, sees its next scheduled runs, and returns to a new conversation after the owning server executes the saved prompt. Test run exercises the same dispatcher immediately.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Create `packages/contracts/src/routines.test.ts` and server tests under `apps/server/src/routines/` for schedule normalization, DST, invalid schedules, stale revisions, authorization, overlap, and each dispatch crash seam. Test with Effect TestClock and the actual SQLite layers. Run `vp run --filter @kata-sh/code-contracts test`, `vp run --filter @kata-sh/code-cli test`, and `vp run --filter @kata-sh/code-client-runtime test`. Run focused web state tests with `vp run --filter @kata-sh/code-web test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` role at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Send an ordinary prompt on trunk and head. On head, Test run a saved routine. Record that trunk lacks routines. Save `regression.png`. Pass when ordinary chat remains usable and the new path creates one linked run with a real provider response.
- [ ] Lane 2. Create a blank manual draft, cancel it, then create and save another. Reload and edit it from a second client. Save `manual-persistence.png`. Pass when cancel changes no saved record and stale edits produce a conflict instead of silent overwrite.
- [ ] Lane 3. Save a minute-based schedule, close the browser, leave the server active, and reconnect after the next occurrence. Save `unattended.png`. Pass when one occurrence produced one conversation using the saved configuration.
- [ ] Lane 4. Restart the isolated server after run admission and again during a provider turn. Pair again when needed. Save `restart.png`. Pass when the existing run and conversation are reconciled or marked uncertain without a second provider submission.
- [ ] Lane 5. Run a prompt that requires approval, then test an unavailable provider and a removed project. Save `needs-attention.png`. Pass when history shows the actual waiting or blocked state and the server changes no model or target.
- [ ] Lane 6. Trigger overlap, pause during an active run, resume, and delete the routine after it settles. Save `pause-overlap.png`. Pass when new starts stop, skips have reasons, and existing conversation history remains accessible.
- [ ] Lane 7. Enter invalid cron and timezone values, then select each schedule mode and inspect the next three dates. Save `schedule-preview.png`. Pass when invalid values cannot save and valid previews include actual dates and timezone offsets.
- [ ] Lane 8. At 539 by 1607, open New routine with the keyboard, edit the form, cancel, and return focus. Save `narrow-keyboard.png`. Pass when controls fit without horizontal overflow and focus stays predictable.
- [ ] Lane 9. Open Routines in Electron and create, Test run, pause, and reopen a saved routine. Save `electron.png`. Pass when the desktop route preserves the accepted library and opens the run conversation.
- [ ] Lane 10. Connect two environments with similarly named projects and disconnect one while viewing all routines. Save `environment-ownership.png`. Pass when each row retains its owner and no write or run moves to the other machine.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure environment-descriptor HTTP latency on both trunk and head with the same client and host. Also measure the added routine list latency for 1,000 routines, due-occurrence admission delay, dispatch bookkeeping, and first visible provider activity. Provider time and local processing time are separate columns.
- [ ] Probe. Run an interleaved trunk/head procedure for the common metric, with 30 warm samples on each revision and the same disposable dataset. Record five fixed live provider requests for the added end-to-end metric. Save raw timings, machine identity, source revision, and the exact command or UI sequence in `perf.json`. A baseline without this feature is not a comparable feature scenario.
- [ ] Baseline. Measure and record trunk first. Every value is UNMEASURED in this plan. Pin the deployed provider/model for comparisons and report network/provider variance separately.
- [ ] Rule. Fail if common head latency exceeds both trunk by 20 percent and trunk plus 20 ms. For added work, fail if list p95 exceeds 250 ms, local dispatch bookkeeping p95 exceeds 500 ms, due admission exceeds 10 seconds on an awake idle server, or a fixed trivial prompt fails to show provider activity within 60 seconds. These are proposed acceptance budgets, not measured claims. Record any justified budget change on the owning Linear issue before Build continues.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, lane 8, and the Electron lane screenshots into `uat-evidence/routines/review/KAT-3319/`.
- [ ] Record a 30 to 60 second video of creation, execution, and the resulting conversation. Save it as `uat-evidence/routines/review/KAT-3319/review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready and Human Review. Wait for the operator's review and Merging state.

**Merge.**

- [ ] Record the root verdict at the exact head SHA and all required CI results.
- [ ] Finish review-comment triage and resolve supported false positives with an explanation.
- [ ] Compare the recorded patch-base-to-head patch ID before any landing rebase. Record the new landing SHA and rerun CI. If the patch changes, repeat the relevant verification and obtain a new verdict.
- [ ] Append this verified PR to the operator's review order. Same-repository stack children target their parent branch. Fork children retain ancestry and target main. The operator lands only the current bottom PR in Merging. Verify the landed AC in Linear afterward.

## Create and refine routine drafts in chat (KAT-3320)

**Depends on.** KAT-3319

**Files.**

- [ ] Create `apps/web/src/features/routines/RoutineChat.tsx` and draft state tests. Extend the shared routine editor and menu wiring.
- [ ] Create `apps/server/src/routines/RoutineDraftGeneration.ts` and tests. Edit `apps/server/src/textGeneration/TextGeneration.ts`, `TextGenerationPrompts.ts`, provider text-generation adapters, and `apps/server/src/provider/ProviderDriver.ts` as required by their common contract.
- [ ] Extend the routine generation schemas and RPC methods in `packages/contracts/src/` and client operations in `packages/client-runtime/src/`. Update routine user and verification docs.
- [ ] Remove the temporary unavailable-chat state introduced by KAT-3319. Do not retain the prototype generator or preset-only drafting behavior.

**Build.**

- [ ] Add the accepted chat view with example requests, pending/error/cancel states, a conversation, and the shared review editor. Preserve both menu labels exactly. At narrow widths, stack the review editor below the conversation.
- [ ] Add a provider-neutral routine-draft generation operation through the existing text generation adapters. Constrain output with the shared RoutineDraft schema. Keep drafting free of workspace mutation and routine activation tools. Use the selected provider instance and report unavailable capability explicitly.
- [ ] Pass the current draft, bounded conversation history, allowed trigger capabilities, target project metadata, and available model identities into generation. Validate returned identities and trigger fields server-side. Ask for missing schedule or resource information in chat. Never invent a connection or silently treat every request as a weekday schedule.
- [ ] Keep user edits authoritative. Apply a generation result only to the draft revision it was requested against. A stale response offers review and cannot overwrite intervening manual edits. Cancel discards the draft and stops an active generation request.
- [ ] Use the same save command, validation, revision handling, execution settings, and persisted record as manual creation. Chat cannot start a scheduler or create an agent-run conversation before save. Schedule drafting must work now. Event draft fields become available as the GitHub and Linear capabilities land, through shared trigger schemas.
- [ ] Implement the new operation for existing eligible text-generation providers through their current adapter contracts. Add explicit capability failures where constrained generation is unsupported. Never change the selected provider behind the user's back.

**You see.**

- [ ] New routine offers Set up manually and Create in chat. Chat turns a user's request into an editable routine draft and supports follow-up changes. The user saves it into the same library only after reviewing it.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Create `RoutineDraftGeneration.test.ts` and web draft-revision tests. Cover valid structured output, missing fields, unauthorized IDs, stale responses, cancellation, and provider errors. Extend adapter contract tests. Run `vp run --filter @kata-sh/code-cli test`, `vp run --filter @kata-sh/code-contracts test`, and `vp run --filter @kata-sh/code-web test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` role at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Create a routine manually on trunk and head, then create one in chat on head. Save `regression.png`. Pass when manual creation remains intact and real generation reaches the shared editable draft on head.
- [ ] Lane 2. Ask a real provider for a weekday brief at an explicit time and timezone, review it, and save. Save `chat-schedule.png`. Pass when the saved fields match the request and reload unchanged.
- [ ] Lane 3. Request a follow-up that changes both the time and instruction, then edit the name manually. Save `chat-refine.png`. Pass when the final saved record contains the reviewed changes exactly.
- [ ] Lane 4. Cancel generation and discard its draft, then wait for a late response. Save `chat-cancel.png`. Pass when no saved routine or scheduled work appears.
- [ ] Lane 5. Edit the draft while refinement is in flight. Save `chat-conflict.png`. Pass when a stale generation result cannot overwrite newer edits.
- [ ] Lane 6. Use an ambiguous schedule and a nonexistent project name. Save `chat-clarify.png`. Pass when the flow requests missing information and cannot activate guessed settings.
- [ ] Lane 7. Use a disconnected or unsupported generation provider and retry after a valid selection. Save `chat-error.png`. Pass when the error names the unavailable capability and retry preserves the user draft.
- [ ] Lane 8. At 539 by 1607, enter the chat path and navigate the conversation and review editor by keyboard. Save `chat-narrow.png`. Pass when the review stacks below the conversation with accessible controls and focus.
- [ ] Lane 9. In Electron, create and refine a routine using a second eligible real provider. Save `chat-electron.png`. Pass when the same draft schema and saved result work through that provider adapter.
- [ ] Lane 10. At the chat PR head, request a trigger the server does not support and inspect the draft response. Save `chat-capabilities.png`. Pass when unsupported triggers cannot activate and the flow explains the missing capability. KAT-3323 separately verifies real GitHub and Linear drafting after both event slices land.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure environment-descriptor HTTP latency on both trunk and head with the same client and host. Also measure the added draft rendering latency and time from request submission to a validated editable draft. Provider time and local processing time are separate columns.
- [ ] Probe. Run an interleaved trunk/head procedure for the common metric, with 30 warm samples on each revision and the same disposable dataset. Record five fixed live provider requests for the added end-to-end metric. Save raw timings, machine identity, source revision, and the exact command or UI sequence in `perf.json`. A baseline without this feature is not a comparable feature scenario.
- [ ] Baseline. Measure and record trunk first. Every value is UNMEASURED in this plan. Pin the deployed provider/model for comparisons and report network/provider variance separately.
- [ ] Rule. Fail if common head latency exceeds both trunk by 20 percent and trunk plus 20 ms. For added work, fail if post-response draft rendering p95 exceeds 200 ms or a fixed explicit schedule request fails to produce a validated draft within 60 seconds. These are proposed acceptance budgets, not measured claims. Record any justified budget change on the owning Linear issue before Build continues.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, lane 8, and the Electron lane screenshots into `uat-evidence/routines/review/KAT-3320/`.
- [ ] Record a 30 to 60 second video of creation, execution, and the resulting conversation. Save it as `uat-evidence/routines/review/KAT-3320/review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready and Human Review. Wait for the operator's review and Merging state.

**Merge.**

- [ ] Record the root verdict at the exact head SHA and all required CI results.
- [ ] Finish review-comment triage and resolve supported false positives with an explanation.
- [ ] Compare the recorded patch-base-to-head patch ID before any landing rebase. Record the new landing SHA and rerun CI. If the patch changes, repeat the relevant verification and obtain a new verdict.
- [ ] Append this verified PR to the operator's review order. Same-repository stack children target their parent branch. Fork children retain ancestry and target main. The operator lands only the current bottom PR in Merging. Verify the landed AC in Linear afterward.

## Run routines from verified GitHub webhook events (KAT-3321)

**Depends on.** KAT-3319

**Files.**

- [ ] Create `apps/server/src/routines/RoutineConnections.ts`, `RoutineWebhooks.ts`, `GitHubRoutineEvents.ts`, and their tests. Extend the routine store with durable deliveries and connection metadata using the next numbered migration.
- [ ] Edit `apps/server/src/server.ts`, `apps/server/src/http.ts`, `apps/server/src/ws.ts`, and routine RPC authorization. Reuse `apps/server/src/auth/ServerSecretStore.ts` and existing GitHub metadata services. Do not expose normal RPC endpoints without their session scopes.
- [ ] Extend `packages/contracts/src/routines.ts`, routine client operations, and `apps/web/src/features/routines/` with GitHub connection setup and filters. Update user, internals, and verification docs. No relay ingress queue or GitHub App service is added.

**Build.**

- [ ] Add an environment-owned connection record with provider, stable repository ID, webhook identity, secret reference, health, and last delivery. Reuse the server secret store and existing GitHub metadata client. Guided setup lets a repository administrator create the webhook on GitHub with the displayed HTTPS callback and a signing secret. No new hosted GitHub App or central relay queue.
- [ ] Extend GitHub metadata reads with stable repository and label IDs. Existing nameWithOwner values are display labels, not stable filter identities. Reuse GitHubCli for authenticated metadata calls and validate repository webhook authority in guided setup.
- [ ] Expose a narrow public callback route on the existing environment HTTP server. Reuse managed tunnel exposure when configured. Verify the selected stable public URL with a real provider ping before activation. A private-only host gets an actionable setup state.
- [ ] Mount the callback outside unbounded command-readiness waits. If the database is not ready, return a prompt failure response and retain provider failure diagnostics rather than waiting through startup or acknowledging unpersisted data. Read raw request bytes before JSON parsing.
- [ ] Verify the raw-body HMAC, event/action, size bounds, connection status, repository identity, delivery ID, and signed-content digest before admission. Use a narrow signature-authenticated boundary rather than opening normal application RPCs. Never accept a client bearer token as webhook authenticity.
- [ ] Commit accepted delivery and matching run intent before returning 2xx. Deduplicate repeated delivery IDs and replay of the same signed content with a changed unsigned header. Process prompt execution outside the HTTP handler through the existing routine dispatcher.
- [ ] Map PR opened to pull_request/opened. Map PR updated to pull_request/synchronize, edited, reopened, and ready_for_review and document that label. Map issue opened to issues/opened. Map workflow failed to workflow_run/completed with conclusion failure, timed_out, or action_required. Filter by exact repository ID, optional branch, draft inclusion, and issue label where applicable. For PRs, branch means base branch. For workflows, branch means head_branch.
- [ ] Capture bounded event context and source URLs under the saved prompt. A matching resource may contain arbitrary external text but cannot change settings or permissions. Prevent paused routines and disabled connections from starting new runs.
- [ ] Show connection setup, last delivery, ignored or rejected counts, and failure recovery. Describe GitHub's lack of automatic failed redelivery and link to provider delivery history. Manual redelivery retains one routine run per occurrence. Disconnect revokes local acceptance immediately and explains provider-side removal.
- [ ] Expose GitHub schemas and metadata to the manual and chat editors through shared capabilities. Chat can draft a GitHub trigger only when chat creation has landed and the connection is available.

**You see.**

- [ ] A user connects a repository webhook, selects a GitHub event and filters, then receives a linked routine conversation when a matching event reaches the owning environment.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Create `RoutineWebhooks.test.ts` and `GitHubRoutineEvents.test.ts`. Use real HTTP handlers and SQLite for signatures, digest replay, ID uniqueness, filters, acknowledgement-before-dispatch, and crash recovery. Extend RPC authorization tests. Run `vp run --filter @kata-sh/code-cli test` and `vp run --filter @kata-sh/code-contracts test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` role at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Test run a scheduled routine on trunk and head. Then deliver a real GitHub PR-open event on head. Save `regression.png`. Pass when the schedule path still works and the new event produces one linked conversation.
- [ ] Lane 2. Complete guided setup in an authorized repository through the real HTTPS tunnel and GitHub ping. Save `github-setup.png`. Pass when connection readiness reflects the successful provider callback.
- [ ] Lane 3. Open a draft PR and a normal PR against two base branches. Save `github-pr-filters.png`. Pass when only the saved repository, base-branch, and draft filters admit work.
- [ ] Lane 4. Exercise the documented PR-updated actions and redeliver one accepted update. Save `github-updated.png`. Pass when new intended updates run and redelivery does not create a second run.
- [ ] Lane 5. Open issues with matching and nonmatching labels. Save `github-issues.png`. Pass when only matching issue-open events admit a run.
- [ ] Lane 6. Complete a failed workflow and a successful workflow on different branches. Save `github-workflows.png`. Pass when only configured failure conclusions and branch filters match.
- [ ] Lane 7. Send signed-body replays with altered delivery headers, tampered bodies, and wrong-resource payloads to the isolated callback. Save `github-rejections.png`. Pass when replays add no run and invalid requests fail before admission.
- [ ] Lane 8. Restart after a durable receipt, then inspect delivery and run history after reconnect. Save `github-recovery.png`. Pass when one receipt maps to one recovered run or an explicit uncertain state.
- [ ] Lane 9. Pause the routine, disable its connection, and replace the signing secret while inspecting web diagnostics. Save `github-controls.png`. Pass when paused or disconnected routes admit no new run and the old secret loses authority.
- [ ] Lane 10. In Electron, inspect setup, filters, last delivery, and a source-linked conversation. Save `github-electron.png`. Pass when the accepted layout and run navigation work on desktop.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure environment-descriptor HTTP latency on both trunk and head with the same client and host. Also measure the added durable webhook acknowledgement, receipt-to-run admission, and event-to-visible provider activity. Provider time and local processing time are separate columns.
- [ ] Probe. Run an interleaved trunk/head procedure for the common metric, with 30 warm samples on each revision and the same disposable dataset. Record five fixed live provider requests for the added end-to-end metric. Save raw timings, machine identity, source revision, and the exact command or UI sequence in `perf.json`. A baseline without this feature is not a comparable feature scenario.
- [ ] Baseline. Measure and record trunk first. Every value is UNMEASURED in this plan. Pin the deployed provider/model for comparisons and report network/provider variance separately.
- [ ] Rule. Fail if common head latency exceeds both trunk by 20 percent and trunk plus 20 ms. For added work, fail if acknowledgement p95 exceeds 500 ms or any acknowledgement exceeds 5 seconds, local admission exceeds 1 second, or a fixed event prompt shows no provider activity within 60 seconds. These are proposed acceptance budgets, not measured claims. Record any justified budget change on the owning Linear issue before Build continues.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, lane 8, and the Electron lane screenshots into `uat-evidence/routines/review/KAT-3321/`.
- [ ] Record a 30 to 60 second video of creation, execution, and the resulting conversation. Save it as `uat-evidence/routines/review/KAT-3321/review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready and Human Review. Wait for the operator's review and Merging state.

**Merge.**

- [ ] Record the root verdict at the exact head SHA and all required CI results.
- [ ] Finish review-comment triage and resolve supported false positives with an explanation.
- [ ] Compare the recorded patch-base-to-head patch ID before any landing rebase. Record the new landing SHA and rerun CI. If the patch changes, repeat the relevant verification and obtain a new verdict.
- [ ] Append this verified PR to the operator's review order. Same-repository stack children target their parent branch. Fork children retain ancestry and target main. The operator lands only the current bottom PR in Merging. Verify the landed AC in Linear afterward.

## Run routines from verified Linear issue events (KAT-3322)

**Depends on.** KAT-3321

**Files.**

- [ ] Create `apps/server/src/routines/LinearRoutineEvents.ts`, `LinearRoutineMetadata.ts`, and their tests. Extend the shared connection and webhook schemas without copying their admission or secret-storage logic.
- [ ] Extend `packages/contracts/src/routines.ts`, routine client operations, and `apps/web/src/features/routines/` with Linear metadata pickers and connection setup.
- [ ] Update the routine guide and verification recipe. Remove temporary unavailable-Linear states. Keep Slack, Teams, Sentry, PagerDuty, and generic webhooks outside the implemented trigger union.

**Build.**

- [ ] Extend the typed connection and callback system with a Linear adapter. Guided setup uses an authorized workspace administrator's webhook settings. Store the webhook signing secret and a least-privilege metadata read credential only in ServerSecretStore. Build a small Linear GraphQL metadata client for workspace, teams, projects, workflow states, and labels. Require valid metadata access for the pickers, and show setup or revoked-access errors rather than invented resources or raw-ID substitutes.
- [ ] Verify raw-body Linear-Signature, signed body webhookTimestamp freshness within 60 seconds, organization identity, delivery ID, and signed-content replay digest. Check headers against the verified payload. Deduplicate retry deliveries and commit before returning HTTP 200. Perform prompt work asynchronously.
- [ ] Map Issue/create to issue created. Detect status changed and label added from Issue/update and updatedFrom. Require an actual transition, not merely a matching final state. Missing transition evidence is ignored with a diagnostic. Multiple labels added in one update create one occurrence per matching routine.
- [ ] Filter with stable workspace, team, project, workflow-state, and label IDs. All projects and All teams mean all resources within this connection's authorized webhook scope. Team-specific webhook access cannot silently expand to every team. Resource renames preserve identity.
- [ ] Expose connection health, received and ignored changes, lost metadata access, and source links in the shared library/editor. Preserve provider payload context under the saved instruction. Reuse the same draft capability in chat when available.
- [ ] Document the provider retry window and disabled webhook recovery. Verify signature freshness against real retry behavior instead of removing the timestamp check to make a fixture pass. Disconnect revokes local acceptance and explains provider-side removal.

**You see.**

- [ ] A user connects a Linear workspace webhook and scopes issue triggers by team, project, state, or label. Matching issue changes create linked routine conversations through the same dispatcher and history.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Create `LinearRoutineEvents.test.ts` and metadata tests. Cover raw-body verification, signed timestamp, transition evidence, stable IDs, scope, retries, and secret redaction. Run `vp run --filter @kata-sh/code-cli test`, `vp run --filter @kata-sh/code-contracts test`, and focused web filter tests.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` role at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Deliver a matching GitHub event on trunk and head. Deliver a real Linear issue-create event on head. Save `regression.png`. Pass when GitHub remains functional and Linear produces one new linked run.
- [ ] Lane 2. Configure an authorized Linear workspace webhook and metadata access through the real HTTPS endpoint. Save `linear-setup.png`. Pass when the correct workspace and teams appear and a real delivery confirms readiness.
- [ ] Lane 3. Create issues in matching and nonmatching teams and projects. Save `linear-scope.png`. Pass when all-project and all-team filters stay inside the connection scope.
- [ ] Lane 4. Move an issue into the target status, then send another update without a status transition. Save `linear-state.png`. Pass when only the actual selected status transition admits work.
- [ ] Lane 5. Add one matching label, add several labels together, then rename a selected label. Save `linear-labels.png`. Pass when one update admits at most one run per routine and stable-ID filtering survives renames.
- [ ] Lane 6. Deliver an update without transition evidence and an event from a different workspace. Save `linear-filter-errors.png`. Pass when neither event creates an unjustified run and diagnostics explain the ignored change.
- [ ] Lane 7. Exercise stale timestamps, invalid signatures, altered delivery headers, and duplicate accepted content. Save `linear-rejections.png`. Pass when every invalid or duplicate request is rejected or deduplicated before admission.
- [ ] Lane 8. Exercise a real provider retry and restart after a durable receipt. Save `linear-retry.png`. Pass when freshness validation accepts legitimate retries and no second routine run starts.
- [ ] Lane 9. Revoke metadata access, disconnect the webhook, and pause a routine before another event. Save `linear-controls.png`. Pass when the UI names each unavailable state and no disabled route admits work.
- [ ] Lane 10. In Electron, create a Linear routine, inspect its source-linked result, and return to the library. Save `linear-electron.png`. Pass when desktop setup, filters, saved settings, and conversation links agree.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure environment-descriptor HTTP latency on both trunk and head with the same client and host. Also measure the added durable webhook acknowledgement, receipt-to-run admission, and event-to-visible provider activity. Provider time and local processing time are separate columns.
- [ ] Probe. Run an interleaved trunk/head procedure for the common metric, with 30 warm samples on each revision and the same disposable dataset. Record five fixed live provider requests for the added end-to-end metric. Save raw timings, machine identity, source revision, and the exact command or UI sequence in `perf.json`. A baseline without this feature is not a comparable feature scenario.
- [ ] Baseline. Measure and record trunk first. Every value is UNMEASURED in this plan. Pin the deployed provider/model for comparisons and report network/provider variance separately.
- [ ] Rule. Fail if common head latency exceeds both trunk by 20 percent and trunk plus 20 ms. For added work, fail if acknowledgement p95 exceeds 500 ms or any acknowledgement reaches 5 seconds, local admission exceeds 1 second, or a fixed event prompt shows no provider activity within 60 seconds. These are proposed acceptance budgets, not measured claims. Record any justified budget change on the owning Linear issue before Build continues.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, lane 8, and the Electron lane screenshots into `uat-evidence/routines/review/KAT-3322/`.
- [ ] Record a 30 to 60 second video of creation, execution, and the resulting conversation. Save it as `uat-evidence/routines/review/KAT-3322/review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready and Human Review. Wait for the operator's review and Merging state.

**Merge.**

- [ ] Record the root verdict at the exact head SHA and all required CI results.
- [ ] Finish review-comment triage and resolve supported false positives with an explanation.
- [ ] Compare the recorded patch-base-to-head patch ID before any landing rebase. Record the new landing SHA and rerun CI. If the patch changes, repeat the relevant verification and obtain a new verdict.
- [ ] Append this verified PR to the operator's review order. Same-repository stack children target their parent branch. Fork children retain ancestry and target main. The operator lands only the current bottom PR in Merging. Verify the landed AC in Linear afterward.

## Close the program

- [ ] Complete [KAT-3323](https://linear.app/kata-sh/issue/KAT-3323/verify-the-complete-routines-journey-on-merged-main) on merged main after the four implementation issues are Done. Execute the combined manual, chat, schedule, GitHub, and Linear journeys with actual providers and both web and Electron.
- [ ] Record source delivery ID, routine ID, run ID, thread ID, server SHA, provider instance, screenshots, timing results, and outcome for each required path. Complete chat creation of both event types here. BLOCKED or NOT RUN prevents milestone PASS.
- [ ] Check every applicable box against its evidence. File any discovered product defect as a linked issue with its own AC. Reopen failed acceptance where required. Do not treat parent auto-closure as proof.
- [ ] Record cleanup of owned provider test resources and isolated servers. Preserve redacted evidence and the final user guide. Retain no secret values in this plan or its media.
- [ ] Report the verified PR order, individual verdicts, accepted main SHA, and remaining exclusions. Disable any program-specific audit cadence after the commissioned program ends. A release requires its own authorization and release runbook.

## Appendix A. Prototype evidence

The user selected A's library layout and appearance and C's chat creation. The accepted revision has one New routine menu with Set up manually and Create in chat, one review editor, and one saved-library result. Cancel leaves saved routines unchanged.

The [private prototype](https://kata-code-routines-exploration.gannonhall.chatgpt.site/) comes from the isolated prototype repository's main branch at `7eabf825f4283bcd360ef8b7ceb209456783ac0e`. The earlier three-way comparison is `8bfe8e643bc2af2ab063e6dceebccbe56916b2fa`. KAT-3317 records selection and browser verification. These SHAs belong to the prototype repository, not Kata Code.

- [New routine menu](assets/new-routine-menu.png) records the two entry paths.
- [Create in chat](assets/create-in-chat.png) records the chat layout.
- [Review the draft](assets/chat-draft-review.png) records the shared editor.

The walkthrough checked the supplied 539 by 1607 viewport, a 1440 by 1000 viewport, keyboard menu behavior, save/cancel, and simulated run output. The prototype does not prove model inference, persistence, next-run calculation, cron execution, webhook delivery, provider turns, or native-device behavior.

The installed dependency is Effect `4.0.0-rc.112`. Run `node docs/planning/routines/cron-probe.mjs` to repeat the planning experiment. It reads the installed dependency and does not change application state.

| Expression and start in America/Los_Angeles    | First observed result                                       | Product interpretation                                |
| ---------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `30 2 * * *`, March 14, 2027 at midnight PST   | `2027-03-14T10:30:00.000Z`                                  | The missing 02.30 occurs at 03.30 PDT that day.       |
| `30 1 * * *`, November 1, 2026 at midnight PDT | `2026-11-01T08:30:00.000Z`, then `2026-11-02T09:30:00.000Z` | The repeated 01.30 runs at its first occurrence only. |

This probe establishes these dependency examples. It does not establish scheduler reliability or all cron semantics. KAT-3319 owns broader schedule tests and live execution.

The planned product rules follow. They are implementation requirements, not claims about the current app.

Keep the accepted A library and the two creation routes. A RoutineDraft has no active scheduler identity. Saving creates or revises a Routine. The server records the environment, concrete project, provider instance, model, permission mode, workspace policy, instruction, and one typed trigger. UI labels are separate from stable IDs. A revision number rejects stale edits.

Use the owning environment's SQLite database. Run admission records the occurrence key, configuration revision snapshot, deterministic command IDs, thread ID, and initial status before orchestration side effects. A durable dispatcher reconciles this state with existing command receipts and thread/turn state. Do not equate a committed command with completed provider work. Ambiguous provider starts require attention and are never blindly retried. Restart before submission may resume the same command identity. Explicit Test run uses a request id so double clicks do not duplicate it.

Run states distinguish queued, starting, running, waiting for approval, succeeded, failed, interrupted, uncertain, and skipped. An uncertain run keeps its active slot until an operator resolves it. Track the initial prompt turn by its normalized correlation, so later manual follow-ups do not reopen a completed routine run. Only admitted runs receive a conversation link, once thread creation is confirmed. A skipped occurrence records its reason without creating an empty conversation. Keep the instruction snapshot and trigger source with history. Render output through the linked conversation rather than copying its transcript into routine records.

Scheduling supports weekdays, daily, weekly, and custom five-field cron at minute granularity with an explicit IANA timezone. Reuse the installed Effect Cron parser. The preview shows the next three actual dates with timezone offsets. A missing spring local time shifts forward with the parser, and an autumn repeated local time fires once at its first occurrence, as checked against the installed dependency. Reject invalid or impossible schedules before save. Browser timezone changes do not rewrite the saved zone.

Run only while the owning server is available. A live server admits the next due occurrence. Startup skips unadmitted elapsed occurrences and records one skipped interval, then advances to the next future occurrence. Already admitted runs follow recovery rules. Skip new occurrences while the same routine has an active or approval-waiting run. Pause prevents new admission and cancels queued work that has not started. It leaves a running conversation intact. Deleting a routine prevents future admission and retains existing conversations and their source metadata. Failed provider turns require an explicit retry through a new Test run or the conversation. No automatic retry of a potentially mutating prompt.

Default new routines to Supervised. Show the existing permission-mode and workspace controls in the review editor. Save the chosen values and never escalate a run automatically. Use existing project workspace preferences and worktree creation. Give each automatic Git run an isolated worktree. Non-Git projects use the chosen project directory, shown before save. Per-routine serialization does not imply filesystem isolation for non-Git projects. Missing projects, repositories, credentials, or models block starts with actionable status and never fall back to another host or model.

Webhook endpoints belong to the environment. Guided setup gives the operator the stable HTTPS callback and secret or secret-entry control and provider setup steps. Event activation requires a verified provider handshake or delivery and exact resource scope. Prefer existing Connect managed tunnel exposure. A private-only environment must establish supported public HTTPS exposure before activation. Do not add a central ingress service or an offline queue to the relay. Persist acknowledged incoming events before returning success. Reject malformed bodies, invalid signatures, replay, wrong resource identity, or disabled connections before routine admission. Deduplicate each connection delivery and each routine occurrence. Preserve a digest of signed content as well as the provider delivery ID because delivery headers may be outside the signature. Do not log raw payloads or secrets.

Apply event filters to the delivered event, using its stable resource IDs and transition fields. Event text is untrusted context below the saved instruction. Limit and label excerpts, retain source links, and never let an event modify the saved prompt, execution permissions, or connection settings. Show connection health and the last accepted delivery. Provider retries and server outages are explicit. No claim of lossless delivery while the server is unavailable.

The scope is web and Electron. Native mobile gets shared contract compatibility and the resulting ordinary conversations, but a native routines management screen is outside this phase. Additional triggers, multi-trigger boolean logic, multi-step jobs, arbitrary webhook actions, notifications outside the app, cloud execution, and automatic server wake are deferred.

## Appendix B. Alternatives rejected

The separate B builder lost to the user's accepted A library plus C chat. Both creation paths therefore share a draft model, validation, save command, and library.

Browser timers and operating-system cron entries would separate schedules from environment state and recovery. The server already owns provider execution, persistent state, and background service lifetime, so a scoped server scheduler fits the current architecture.

A schema-only first PR would produce no user-visible routine. KAT-3319 includes the smallest complete schedule-to-conversation product, with reliability required before that slice passes.

A new job platform, hosted scheduler, GitHub App, Linear OAuth service, or central relay event queue would add deployment and identity systems to the first release. Guided provider-side webhook setup reuses the existing environment HTTPS endpoint and local secret storage. Richer managed installation can be a separately scoped follow-up.

Polling GitHub or Linear as a hidden fallback would create different trigger and outage semantics. This phase uses explicit webhooks and names provider delivery limits. Automatic replay of uncertain prompt execution was also rejected because a prompt can cause external changes.

Model the Domain led to distinct draft, saved routine, delivery, and run records. Sequence Work into Verifiable Units led to complete scheduled, chat, GitHub, and Linear slices. Make Operations Idempotent led to persisted occurrence identity before dispatch. Experience First preserved the selected library and shared review editor. Foundational Thinking kept environment ownership and workspace isolation in the initial slice. Prove It Works separates prototype, dependency probes, and live acceptance. Guard the Context Window kept source exploration in bounded reports. The plan checker applies Encode Lessons in Structure to the checklist itself.

## Appendix C. Risks

| Risk                                                              | Owner                      | Required resolution or evidence                                                                                                                                   |
| ----------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command receipt differs from provider side-effect completion      | KAT-3319                   | Persist the run before dispatch. Reconcile the same command and thread IDs. Expose uncertainty across the provider boundary.                                      |
| Server or host is unavailable                                     | KAT-3319                   | Show owner and service state. Skip unadmitted elapsed slots. Verify Linux and macOS background-service limits from the current guide. No automatic wake.          |
| Two runs touch the same checkout                                  | KAT-3319                   | Give Git runs isolated worktrees through the current path. Show the shared-directory limitation for non-Git targets.                                              |
| Full access could be selected without review                      | KAT-3319                   | Start new routines in Supervised, display the mode, and retain the saved choice. Approval waits remain visible.                                                   |
| Large or impossible cron expressions cause expensive preview work | KAT-3319                   | Bound input and preview computation. Fail with a field error. Test clock changes and DST independently of the current machine clock.                              |
| Model output is incomplete or stale                               | KAT-3320                   | Validate one shared schema, keep the draft revision, request clarification, and require Save.                                                                     |
| Some text-generation adapters lack a safe constrained operation   | KAT-3320                   | Establish adapter capability and live eligibility before exposing it. Keep failures visible without provider substitution.                                        |
| Public callbacks bypass normal session login                      | KAT-3321                   | Isolate the raw-body signature route, enforce resource identity, bound requests, persist before acknowledgement, and test replay.                                 |
| Header delivery IDs are not necessarily signed                    | KAT-3321                   | Bind accepted IDs to the signed-content digest and reject replay under a changed header.                                                                          |
| Offline events are lost after provider delivery limits            | KAT-3321 and KAT-3322      | Show outage and delivery health. Document manual recovery. Do not claim an offline relay queue exists.                                                            |
| Linear retries interact with signed timestamp freshness           | KAT-3322                   | Keep the freshness check and prove a real retry. Capture provider behavior before changing the contract.                                                          |
| Event content attempts to change agent instructions               | KAT-3321 and KAT-3322      | Pass bounded labeled context beneath the saved prompt and preserve the chosen permissions. A model test alone does not prove perfect prompt-injection resistance. |
| Performance budgets lack measurements                             | Every implementation issue | Measure trunk first on identified hardware. Record results separately from proposed thresholds. Revise the owning spec before accepting a different budget.       |
| Shared contracts affect native mobile                             | KAT-3319 through KAT-3322  | Run shared contract/client tests. Existing conversations must continue to open. Do not claim a native routines screen is delivered.                               |
| Prototype differs from real Electron integration                  | Every implementation issue | Capture actual desktop evidence independently. A missing Electron driver leaves that lane BLOCKED.                                                                |
| Run records grow without pruning                                  | KAT-3319                   | Paginate history and bound stored context. Keep summaries and replay identities durable for this phase. Define pruning later with its own replay semantics.       |
| Routing configuration changes before execution                    | Program owner              | Resolve current descriptors and issue labels at dispatch. The present sheet's `hard` panel efforts are not assumed valid. Do not replace them silently.           |

## Appendix D. Links and reading list

Read [AGENTS.md](../../../AGENTS.md), the [architecture overview](../../internals/overview.md), [environment authentication](../../internals/environment-auth.md), [connection runtime](../../internals/connection-runtime.md), [background service guide](../../user/background-service.md), [permission modes](../../user/permission-modes.md), and [development runbook](../../operations/development.md) before editing. These describe the current architecture. Proposed routines behavior lives in Linear and this checklist.

The planning explorers returned source reports for execution, UI/chat, and event ingress through the configured `codex:gpt-5.6-luna@max` role. All three completed read-only. No live provider or webhook test ran during that exploration.

The code inventory starts at `packages/contracts/src/orchestration.ts`, `packages/contracts/src/rpc.ts`, `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`, `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`, and `apps/server/src/persistence/Migrations.ts`. Read `apps/server/src/textGeneration/TextGeneration.ts` for the existing provider-dispatched generation operations and `apps/server/src/auth/ServerSecretStore.ts` for owner-only server secrets. The current generation service has commit, PR, branch-name, and thread-title operations. Routine drafting is a new operation.

The UI entry points are `apps/web/src/components/sidebar/SidebarChrome.tsx` and `apps/web/src/components/AppSidebarLayout.tsx`. Shared environment behavior belongs in `packages/client-runtime`. Avoid putting scheduler state in the browser or copying the prototype's in-memory store.

[GitHub webhook guidance](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) requires timely acknowledgement and identifies deliveries. [GitHub failed-delivery guidance](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries) states that failed deliveries are not automatically retried. Plan for explicit redelivery after outages.

[Linear webhook documentation](https://linear.app/developers/webhooks) describes public HTTPS callbacks, signing, signed timestamps, admin setup, transition payloads, and bounded retries. Keep provider-specific handling inside its adapter. [Linear's SDK webhook helper](https://linear.app/developers/sdk-webhooks) is a candidate if its installed cost and Effect HTTP compatibility reduce code. Check its current types before adding a dependency.

Source checks also found the exact command receipt lookup at `OrchestrationEngine.ts` line 144, the hot-stream limitation at `ProviderCommandReactor.ts` line 1804, the provider call before durable metadata at `provider/Layers/ProviderService.ts` line 1631, and the startup worker scope at `serverRuntimeStartup.ts` line 806. `BackgroundPolicy.ts` line 296 requires client demand for ordinary background work, which is unsuitable as the routine admission gate. `server.ts` line 540 applies global readiness middleware. KAT-3321 must avoid holding webhook acknowledgements behind it.

Kata Code Connect's [trust and endpoint model](../../internals/t3-connect.md) exposes the environment through a tunnel. The relay is a broker and does not store routine events. Provider callbacks must reach the environment endpoint.

Use how before each implementation slice and architect before changing cross-function contracts. Use interrogate if the implementation introduces contested execution, authorization, or webhook decisions, after resolving its current configured model descriptors. Do not claim a panel ran during this planning pass. Keep `decisions.tsv` and lane receipts under ignored execution evidence following the installed show-me-your-work skill. Preserve the reason and evidence when a design choice changes.

Validate this plan with `node /Users/gannonhall/.codex/plugins/cache/open-pstack/pstack/1.6.4/skills/poteto-mode/scripts/check-plan.mjs docs/planning/routines/plan.md`. The checker proves checklist structure and punctuation, not feature correctness.
