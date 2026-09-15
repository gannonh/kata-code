# Linear Conventions

Shared contract for every mode of this skill. Read this file completely before Plan, Build, Review, Verify, or Triage.

## Core rule

The Linear issue and any parent epic are the spec. GitHub Issues are inbound context only. GitHub holds code, pull requests, CI, and diff reviews. Durable architecture, process, ADR, and evidence documents live under `docs/`.

Read the issue and parent before implementing. Implement only the written AC, using the smallest change that satisfies them. Edit the Linear spec before continuing when research or implementation changes it. File work outside the AC as a separate Backlog issue and keep it out of the current PR.

A request without a Linear issue needs one before Build starts. Create it through Plan or ask. Small bounded edits such as a copy change or a single config value are exempt.

When blocked, post a Linear comment with the exact ask and stop. If MCP itself is unavailable, report the failed call and ask directly.

If a Linear MCP write fails, stop and report the failure. Do not save the spec as a repo file.

## Skills

This plugin provides `plan`, `build`, `review`, `verify`, and `triage`. Agents call the host Linear MCP directly. There is no tracker abstraction, Linear CLI wrapper, Linear shell script, or MCP credential helper.

`review` calls `npx agent-reviews` ([pbakaus/agent-reviews](https://github.com/pbakaus/agent-reviews)) at runtime to list, filter, reply, and watch PR comments. That CLI is a runtime dependency. Do not vendor it. Do not add it to a package.json. Do not paginate review comments with raw `gh`.

`gh` is for GitHub code workflows: PR metadata, checks, run logs, and merge. Triage may also run `gh issue list`, `gh issue view`, and `gh issue comment` when sweeping inbound GitHub Issues and writing backlinks. All other planning, status, hierarchy, and comment writes use Linear MCP.

Ship is reserved for project-defined releases after Verify. This plugin has no release skill.

### Install this plugin

**Cursor** (local plugin import):

```bash
cp -R plugins/cursor ~/.cursor/plugins/local/plan-build-verify
```

Enable Allow Local Plugin Imports, then enable `plan-build-verify`.

**Claude Code:**

```text
/plugin marketplace add gannonh/plan-build-verify
/plugin install plan-build-verify@plan-build-verify
```

**Codex:**

```text
codex plugin marketplace add gannonh/plan-build-verify
codex plugin add plan-build-verify@plan-build-verify
```

If a Codex sparse checkout is used, it must be `--sparse .agents/plugins --sparse plugins/codex`.

### AGENTS.md snippet

````markdown
## Skills

Product OS is the `plan-build-verify` plugin. Specs are Linear issues. GitHub Issues are inbound reports only.

Install the plugin for the host you use (Cursor local import, Claude Code marketplace, or Codex marketplace).
````

## Preflight

Run once per session before the first Linear write.

1. **GitHub repo.** `gh auth status` and `gh repo view --json nameWithOwner,defaultBranchRef`. Record `<owner>/<repo>` and the default branch.
2. **Linear MCP.** Confirm the host exposes `list_teams`, `get_team`, `list_projects`, `get_issue`, `save_issue`, `save_comment`, `list_comments`, `list_issues`, and `list_issue_statuses`. Stop if any of those are missing. Call `list_issue_labels` and `create_issue_label` only when applying optional hygiene labels.
3. **Team and project.** Resolve the team through `list_teams` / `get_team` and the project through `list_projects`. Scope discovery queries and issue creation to those resolved identifiers. Updates use the existing issue ID and preserve its team and project.
4. **Required states.** Call `list_issue_statuses` with `{ "team": "<team>" }`. Resolve IDs for Backlog, Todo, In Progress, Agent Review, Human Review, Merging, Done, Canceled, and Duplicate. Stop if any name is missing.
5. **Project lifecycle.** Read the target project's AGENTS.md or equivalent lifecycle instructions and follow its approval gates. Automation settings documented there are sufficient; no separate automation record or maintainer screenshot is required. Missing automation documentation does not block work. See Automation policy for handling actual state transitions.
6. **Issue graph.** For the issue in scope, call `get_issue` with `{ "id": "<id>", "includeRelations": true }`. Record parent, children, `blockedBy`, `blocks`, and `gitBranchName`.

## Linear MCP tools

Call tools with structured arguments. Use only these fields.

`get_issue`

```
get_issue({
  "id": "KAT-1234",
  "includeRelations": true
})
```

Returns `gitBranchName` plus relation data when `includeRelations` is true.

`save_issue` creates when `id` is omitted and updates when `id` is present:

```
save_issue({
  "title": "Export workflow for saved reports",
  "team": "<team>",
  "project": "<project>",
  "state": "Backlog",
  "description": "<spec body>",
  "parentId": "KAT-1000",
  "blockedBy": ["KAT-1100"],
  "blocks": ["KAT-1200"],
  "relatedTo": ["KAT-1300"],
  "labels": ["needs-triage"],
  "links": [{"title": "GitHub #12", "url": "https://github.com/owner/repo/issues/12"}]
})
```

Relation arrays add edges. Remove specific edges with `removeBlockedBy`, `removeBlocks`, or `removeRelatedTo`. Do not use an empty addition array to remove edges. Read the graph before changing it and preserve unrelated relations.

```
save_issue({ "id": "KAT-1234", "removeBlockedBy": ["KAT-1100"] })
```

`save_comment`

```
save_comment({
  "issueId": "KAT-1234",
  "body": "## Build completion report\n..."
})
```

`list_comments`

```
list_comments({
  "issueId": "KAT-1234"
})
```

`list_issue_statuses`

```
list_issue_statuses({
  "team": "<team>"
})
```

`list_issues`

```
list_issues({
  "team": "<team>",
  "project": "<project>",
  "state": "Todo",
  "query": "export workflow",
  "parentId": "KAT-1000",
  "includeArchived": false,
  "cursor": "<cursor>"
})
```

Optional hygiene labels:

```
list_issue_labels({ "team": "<team>" })
create_issue_label({ "team": "<team>", "name": "needs-triage" })
```

Create a missing hygiene label before passing its name in `save_issue.labels`.

For a label update, read the current labels and supply the complete intended label set, preserving unrelated labels. To remove a hygiene label, omit only that label from the intended set. Re-read the issue to confirm the result. If the host tool does not support replacing the set, report that removal is unsupported and stop that correction. Never assume a one-label payload preserves other labels.

## Automation policy

The target project's AGENTS.md or equivalent lifecycle instructions govern approval and phase transitions. Documented GitHub integration settings are useful context, not a prerequisite for Build or other work. Do not require a separate automation record, screenshot, or reconfirmation of settings. Do not assume this plugin repository's integration settings apply to another project.

Before every state write, read the current Linear issue. After a GitHub action, re-read the issue: if the authorized transition already happened, skip the write. Otherwise, perform only the transition authorized by the project lifecycle and the completed phase gates. For example, if marking a PR ready leaves the issue In Progress, Build may move it to Agent Review after its gates pass.

An unexpected transition is not permission to overwrite the current state. Follow the state-write protocol below and the project's stand-down rules. Pause the affected action only when the observed state conflicts with an authorized transition and existing instructions or user authorization cannot resolve it. Report the observed state, intended action, and exact decision needed. Missing automation documentation alone is never such a conflict.

Automatic closure of a parent does not prove its acceptance criteria passed. Preserve human approval gates regardless of integration behavior; never configure automation into Human Review or Merging.

## Workflow states

Linear state is the sole approval and phase signal.

| State | Meaning | Who moves it |
| ----- | ------- | ------------ |
| Backlog | Research and Plan. Specs are written here. | Plan creates here. Humans may return work here. |
| Todo | Approved and queued. | Humans only: Backlog to Todo. |
| In Progress | Build has an explicit start. | Agents start from Todo. Draft PR open may also land here via integration. |
| Agent Review | PR is ready for review landing. | Integration on PR open, or Build after readiness if still In Progress. |
| Human Review | Merge-ready. Coding, CI-fix, and review agents pause. | Review agents after merge-ready gates. |
| Merging | Human granted merge permission. | Humans only. |
| Done | Relevant PR merged. | Integration on merge. |
| Canceled | Terminal. New work needs a new issue. | Humans or stale automation. |
| Duplicate | Terminal. New work needs a new issue. | Humans. |

Build requires Todo plus an explicit start, then moves Todo to In Progress.

Human Review pauses all coding, CI-fix, and review agents until the issue moves to an applicable state or a human explicitly resumes them. Applicable states: In Progress for Build, Agent Review for Review, Merging for merge, Done for Verify.

## State writes

Before every `save_issue` state write:

1. Re-read with `get_issue({ "id": "<id>", "includeRelations": true })`.
2. Skip when the current state already equals the target.
3. Stop when the current state is Human Review, Canceled, or Duplicate, unless a human explicitly resumed the agent or the action is the documented closed-PR reconciliation to Todo.
4. Stop when the current state conflicts with the planned transition (for example Agent Review when Build still expects In Progress, or Done when Review still expects Agent Review).
5. Then write `save_issue({ "id": "<id>", "state": "<target>" })`.

Closed-PR reconciliation: when a PR closes without merge, the observing agent records the reason with `save_comment` and moves the issue to Todo, including from Human Review. That path does not authorize coding, CI fixes, or a review run. A fresh explicit start is required to build again. Leave Canceled and Duplicate unchanged.

## Spec issue body template

Use this shape. Scale each section to the work. Omit sections that do not apply. `## Acceptance criteria` and `## Delivery slices` are mandatory and must use these exact headings. `## Demonstration` is mandatory for every standalone spec or sub-issue that Build can execute; an epic parent delegates demonstrations to its children.

Do not include a Status section. Linear state is the status.

```markdown
## Goal

<the outcome, in one or two sentences>

## Context

<current state, verified facts about the repo, links to related issues, PRs, ADRs, or designs>

## Constraints

<explicit boundaries, governing rules, and what this spec will not do>

## Acceptance criteria

- [ ] <observable pass/fail outcome>
- [ ] <observable pass/fail outcome>

## Architecture

<component relationships, boundaries, data flow, Mermaid diagram when relationships matter>

## Delivery slices

1. <user-observable outcome>: end-to-end behavior, likely layers/files, acceptance tie-in, and demo
2. <next user-observable outcome>: end-to-end behavior, likely layers/files, acceptance tie-in, and demo

## Demonstration

- Consumer: <human, operator, or API/SDK client>
- Action or input: <what they do>
- Observable result: <what becomes visible or usable>
- Evidence: <how to exercise, inspect, or capture it>

<For an unavoidable technical-enablement exception, instead record the blocker, minimum scope, contract/integration evidence, and immediate user-facing slice unlocked.>

## Verification

<required public-boundary E2E command; additional unit/integration checks; required screenshot checkpoints for visual targets; preferred video recorder or expected environment limitation; manual UAT steps>

## Risks

<specific risks with practical mitigations>

## Build handoff

- Approved scope: <...>
- Non-goals: <...>
- Ordered slices: <...>
- Required verification commands: <...>
- Fixtures or credentials needed: <...>
- Blocking open questions: None
```

Write acceptance criteria as `- [ ]` checkboxes.

`## Delivery slices` describes increments of demonstrable behavior. A slice crosses whichever technical layers it needs to produce an observable outcome.

`## Demonstration` must name the consumer, action/input, observable result, and evidence that works without waiting for later siblings.

## Hierarchy and dependencies

Parent/sub-issue composition uses `parentId` on `save_issue`. Blocking order uses `blockedBy` and `blocks`.

- The parent issue keeps goal, context, constraints, architecture, risks, and top-level acceptance criteria.
- Each child gets its own scoped `## Acceptance criteria`, `## Demonstration`, and `## Build handoff`.
- Make the first child a walking skeleton when feasible.
- Children link back to the parent in `## Context`.
- Build, Review, and Verify run per child.
- An open `blockedBy` issue is a stop condition.

```
save_issue({
  "title": "<user-observable outcome>",
  "team": "<team>",
  "project": "<project>",
  "state": "Backlog",
  "parentId": "KAT-1000",
  "description": "<child spec body>"
})
```

```
save_issue({
  "id": "KAT-1002",
  "blockedBy": ["KAT-1001"]
})
```

Do not nest more than one level.

## Branches and pull requests

- Branch name is `gitBranchName` from `get_issue`. Resume that branch when it already exists.
- One branch and one implementing PR per Linear issue. Every implementing PR names exactly one distinct Linear issue ID in its title or body.
- Build opens a draft PR while the issue is In Progress.
- `review` lands CI and review comments. Merge happens only after a fresh Merging-state check.
- When a PR closes without merge, reconcile to Todo as specified above.

## Comments

Post reports as Linear comments:

```
save_comment({
  "issueId": "KAT-1234",
  "body": "## Build: acceptance criteria matrix\n..."
})
```

Conventions:

- Build evidence: comment starting with `## Build: acceptance criteria matrix`.
- Verify evidence: comment starting with `## Verify: acceptance criteria matrix`.
- Deviation approvals: comment starting with `## Approved deviation`.
- Blocking reasons: comment starting with `## Blocked`.
- Closed-PR reconciliation: comment starting with `## PR closed without merge`.

## Querying the roadmap

```
list_issues({ "team": "<team>", "project": "<project>", "state": "Todo" })
list_issues({ "team": "<team>", "project": "<project>", "state": "In Progress" })
list_issues({ "team": "<team>", "project": "<project>", "query": "<keywords>" })
get_issue({ "id": "KAT-1234", "includeRelations": true })
```

Search before Plan creates a new spec. Extend the existing issue when it already covers the work.

## Phase-entry hygiene

At the start of Plan, Build, Review, and Verify, read the issue and **report** problems without fixing them:

```
get_issue({ "id": "<id>", "includeRelations": true })
```

Report when:

- The state is missing from the required nine, or does not match the requested phase.
- `## Acceptance criteria` is missing, empty, or vague.
- A standalone spec or child has no independently exercisable `## Demonstration`, unless it documents a justified minimal technical-enablement exception.
- An epic has no children, a child has no parent, or the children are architecture-layer work packages.
- An open blocker remains.
- The issue is Canceled or Duplicate.
- The issue duplicates another open spec.

Missing acceptance criteria blocks Build, Review, and Verify. Unapproved work (still Backlog) blocks Build. Human Review without an explicit resume blocks coding, CI-fix, and review agents.

## Safety rules

- Never close, delete, or bulk-relabel Linear issues you did not open without user approval.
- Never edit an issue description you have not read in full in this session.
- Never force-push or amend commits on a branch linked to an issue another agent or person is working on.
- When a Linear MCP or `gh` write fails, report the exact tool or command and error. Do not retry silently and do not fall back to local spec files.
- Never overwrite Human Review, Canceled, or Duplicate to continue coding.
