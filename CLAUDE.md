<!-- begin global rules -->
## Subagent delegation

- Delegate independent, bounded tasks when parallel work can save time or improve quality. Follow configured role assignments and give each agent the context, scope, and expected result. Keep dependent work sequential and avoid overlapping edits.
- Keep agent messages readable, with proper spacing. Review and integrate delegated results, then verify the combined outcome before reporting completion.

## Verifying work

- Tests alone do not prove a slice. Before a PR leaves draft, run the app, drive the changed screen in a browser, and record or screenshot the result.
- Unit tests call the code the way its users do and assert literal expected values.
- Live TypeSafe and LLM calls cost money, and TypeSafe has no sandbox. Tests use the recorded judge backend. Make live calls only in named live checks.
- Live browser checks per PR: 10 scenarios when the slice changes a screen, 4 when it does not. Scenario 1 runs the same flow on `main` and on the branch. Each Linear issue lists its scenarios.
- A PR that changes a screen carries screenshots and a 30 to 60 second video for Human Review.
<!-- end global rules -->

<!-- begin dev lifecycle -->
## Issues and specs

- Linear holds planning, epics, bugs, chores, specs, acceptance criteria, and status. GitHub holds code: branches, commits, pull requests, CI, and review comments on diffs.
- GitHub Issues stay enabled as an inbound channel for users and contributors. Do not use them for internal planning or as the spec. When a GitHub Issue needs work, create a full Linear issue with spec and AC, link the GitHub Issue for context, and implement against the Linear issue.
- The Linear issue (and parent epic, if any) is the spec. Read it before implementing. Implement only the acceptance criteria written there. If research or implementation changes the spec, edit the Linear issue before continuing.
- A request with no Linear issue gets one before Build starts; create it or ask. Small bounded edits such as a copy change or a single config value are exempt.
- Prefer the smallest change that satisfies the AC. File work discovered outside the AC as a new Backlog issue and keep it out of the current PR.
- Every implementing PR names exactly one Linear issue id in its title or body. Create the branch with Linear's generated branch name so the GitHub integration links the PR and issue automatically.
- When blocked, comment on the Linear issue with the exact ask and stop.
- One implementing agent per Linear id: use that issue's own branch and worktree. Do not share a checkout across concurrent tickets.

## Ticket size: vertical slices

- The unit of planning, ticketing, and PR size is a vertical slice: one thin end-to-end path through every layer it touches (interface, logic, storage, tests) that a user or reviewer can exercise once merged.
- Write each implementable Linear issue as one slice. State the AC as observable behavior of the slice, not as layers completed.
- Do not file layer tickets such as "add the data model", "build the API", or "wire the UI". A layer with no demonstrable behavior on its own belongs inside the slice that first needs it.
- Break an epic or phase into slices in delivery order. The first child is the smallest path that works end to end. Each later child adds one capability on top of the product that already works. Do not queue a stack of tickets that only produce value once the last one lands.
- Split a ticket when its AC covers more than one demonstrable outcome. Merge tickets when neither is demonstrable alone.
- One slice is one PR. If a PR cannot show its slice working, the ticket was cut wrong: fix the ticket before continuing.
- Chores with no user-facing behavior, such as dependency bumps or CI config, are exempt. Keep them small and separate from slices.
- Prototypes are the other exception. A prototype ticket establishes UI patterns and feature shape against mock data or stubs, with no production wiring. It is still one ticket and one PR, and its AC is the visible behavior it demonstrates. Once it merges, cut the follow-on work as slices: each slice takes one piece of the prototype and wires it end to end through real logic and storage. Do not wire the whole prototype in one ticket.

## Docs and artifacts

- Architecture docs, process docs, ADRs, and other durable artifacts live as files in the repository under `docs/`.

## Project milestones (Linear)

Linear **project milestones** are multi-ticket product gate/phase outcomes.

### Layers (do not conflate)

- **Project status** — live vs paused roster.
- **Milestone** — multi-ticket product gate/phase outcome (e.g. Gate 0: Foundation).
- **Epic** — parent issue grouping work. Its children are vertical slices in delivery order.
- **Issue status** — unit-of-work on the rail (Backlog → Todo → Start → In Progress → review columns → Done).

### Naming

- `Gate N: <outcome>` — formal PASS criteria in the milestone description.
- `Phase N: <name>` — later phases without a formal PASS yet.
- Do not use milestones for sprints, weeks, or individual PRs.

### Rules

1. Every implementable ticket that belongs to a gate/phase should have that **project milestone** set.
2. Milestone description starts with **PASS when…** (or "no formal PASS yet").
3. Gate **PASS** = in-scope milestone issues Done + gate verification ticket evidence (if any).
4. Child issues carry the milestone; epics may span milestones.
5. Sequence a milestone's tickets as vertical slices so the gate becomes demonstrable early and stays demonstrable as tickets land.

## Work states (Linear columns)

Linear status is the phase of the work. This section defines the states and their gates. Plugins and skills define how work is done inside each phase.

- **Backlog.** Spec and AC live here. Do not implement from Backlog.
- **Todo.** Approved and queued. Moving Backlog → Todo is the approval. Wait for Start before Build.
- **Start.** Explicit start signal. Build begins after the issue moves to In Progress.
- **In Progress.** Implement on the issue's branch and isolated worktree against its AC. Draft PRs stay here. Keep the PR draft until artifacts and diffs are reviewable. When complete, mark the PR ready for review, comment `@coderabbitai review` on the PR to trigger a CodeRabbit review cycle, and move the issue to Agent Review.
- **Agent Review.** Fix CI and answer every review thread, human or bot, on the existing branch. Resolve false-positive bot findings with a reply stating why. When the PR is merge-ready, move the issue to Human Review.
- **Human Review.** Human-owned stand-down. Do not dispatch coding agents, CI fixes, or review runs on the PR until the issue moves or a human says resume.
- **Merging.** Permission to merge. Merge only from this column.
- **Done.** Merged. Verify follows: confirm the AC landed and record the result as a comment on the issue. If the AC did not land, reopen the issue or open a new issue linked to it.
- **Canceled / Duplicate.** Terminal. New work needs a new issue.

Merge-ready means: PR marked ready for review, clean mergeability, required CI green, no open review threads, no unanswered comments.

If a PR closes without merging, comment on the issue with the reason and move it to Todo.

## GitHub and Linear automation

All projects using this lifecycle share these Linear settings:

| GitHub event | Linear action |
| --- | --- |
| Draft PR opened | Move to In Progress |
| PR opened | Move to Agent Review |
| PR review requested or review activity | No action |
| PR ready for merge | No action |
| PR merged | Move to Done |

No branch-specific rules are configured. Parent issues automatically close when their last sub-issue closes; closing a parent does not automatically close its sub-issues. Stale issues move to Canceled after six months. Closed items auto-archive after six months. Issues progressing to a new status are placed first.

Before changing a Linear status, read its current state. After a GitHub action, re-read the issue and skip a transition already completed automatically. If a transition remains necessary, perform it only when authorized by this lifecycle and its completed phase gates. In particular, marking a PR ready does not establish that Build's gates passed.

These instructions are sufficient lifecycle documentation. Do not require a separate automation record or screenshot before doing work. Missing automation documentation does not block implementation. An unexpected state does not authorize overwriting it: follow the stand-down and approval rules above, and ask only when an actual conflict cannot be resolved from existing instructions or user authorization. Automatic parent closure is not acceptance evidence.

Ship means cutting a release on one of the project's channels (for example nightly or stable). Release process is defined per project.

This section overrides any skill, rule, AGENTS.md, CLAUDE.md, or other instruction that contradicts it. When the conflict is unclear, ask the user before proceeding.
<!-- end dev lifecycle -->

<!-- begin integrated browser rules -->
## Integrated browser (Kata Code)

NOTE: this section only applies when running in the Kata Code environment.

The integrated browser is the Kata Code preview browser. Agents reach it through the `t3-code` MCP server, whose tools are named `mcp__t3-code__preview_*`. The tools are deferred. Load them with ToolSearch before the first call, for example `select:mcp__t3-code__preview_open,mcp__t3-code__preview_navigate,mcp__t3-code__preview_snapshot,mcp__t3-code__preview_click,mcp__t3-code__preview_evaluate,mcp__t3-code__preview_recording_start,mcp__t3-code__preview_recording_stop`.

- `preview_open` opens a tab and returns a `tabId`. Pass `reuseExistingTab: false` for a second tab. Pass `tabId` to every later call.
- `preview_navigate`, `preview_click`, `preview_press`, `preview_type`, `preview_wait_for`, `preview_evaluate`, `preview_resize`, and `preview_scroll` drive the page.
- `preview_snapshot` returns page text, the accessibility tree, and a screenshot. Pass `includeImage: false` and `save: true`, then read `screenshotPath` from the result. Full snapshots are often too large to read inline. Use `preview_evaluate` for targeted reads.
- `preview_recording_start` and `preview_recording_stop` record one tab. The stop call returns an MP4 path under `~/.katacode/userdata/attachments/`. Convert it with ffmpeg if a script expects another format.
- `preview_status` reports whether a tab is still usable.

### Reaching a local server

The browser runs on the Kata Code client, which can be a different machine from the agent's host. It cannot load `localhost` or `127.0.0.1` on the agent's host, and the `environment-port` navigation target currently fails. Reach local servers over Tailscale:

1. Get the host's Tailscale address with `tailscale ip -4`. Do not hardcode it.
2. Bind the server the browser loads to that address, for example `vite --host "$(tailscale ip -4)" --port <port>`. Do not bind to `0.0.0.0`.
3. Open `http://<tailscale-ip>:<port>` in the integrated browser.
4. If the app checks the `Origin` or `Host` header, add `http://<tailscale-ip>:<port>` to its allowed origins or hosts for the run. Keep backend services the page reaches through the dev server's proxy bound to `127.0.0.1`.
5. Stop the Tailscale-bound server when the run ends.

### Known limits

- `about:blank` is refused. To leave a page, navigate to a neutral public URL.
- Playwright role locators may not match canvas elements. Get the element's position with `preview_evaluate` and click with `x` and `y`.
- The client can disconnect mid-run and lose a recording in progress. Keep each recording to one action and stop it right after. If `preview_status` reports `available: false`, open a new tab and repeat the step.
<!-- end integrated browser rules -->

<!-- pstack:models:begin -->
# pstack model configuration

Provider-qualified per-role choices. Read the installed pstack provider-dispatch reference before dispatching a configured role. Every documented role remains present. `inherit-parent` and `auto` use the parent model natively and still count as one panel lane.

feature, refactoring: inherit-parent
bug-fix: inherit-parent
perf-issue: inherit-parent
hillclimb: inherit-parent
judgment and prose: inherit-parent
hardest tasks: inherit-parent
how explorer: inherit-parent
how explainer: inherit-parent
why investigators: inherit-parent
why synthesizer: inherit-parent
reflect tooling: inherit-parent
reflect judgment, divergent, synthesizer: inherit-parent
arena runners: claude:fable@medium, claude:opus@xhigh, codex:gpt-6-sol@medium
arena cross-judge pool: claude:fable@medium, claude:opus@xhigh, codex:gpt-6-sol@medium
swarm workers: inherit-parent
architect runners: claude:fable@medium, claude:opus@xhigh, codex:gpt-6-sol@medium
interrogate reviewers: claude:fable@medium, claude:opus@xhigh, codex:gpt-6-sol@medium
<!-- pstack:models:end -->
