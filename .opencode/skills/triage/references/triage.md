# Triage Workflow

Use this workflow to groom the Linear backlog and to turn inbound GitHub Issues into full Linear specs.

Triage is on-demand. It never runs automatically. Read `references/conventions.md` before starting.

## Scope

Ask which scope to groom if the user did not say:

- **Full backlog:** every issue in the Linear project.
- **Spec backlog:** Linear project issues. Default when the user says "groom the roadmap".
- **One epic:** a parent and its children.
- **Inbound GitHub:** open GitHub Issues that are not yet linked to Linear.
- **Untriaged:** issues missing required spec sections or carrying optional hygiene labels such as `needs-triage`.

## Step 1: Load the backlog

```
list_issues({
  "team": "<team>",
  "project": "<project>",
  "includeArchived": false
})
list_issues({
  "team": "<team>",
  "project": "<project>",
  "state": "Todo"
})
list_issues({
  "team": "<team>",
  "project": "<project>",
  "state": "Canceled",
  "includeArchived": true
})
```

Page with `cursor` when a result set continues. Read issue descriptions for the specs in scope. Do not judge an issue from its title.

For inbound GitHub Issues only:

```bash
gh issue list --state open --limit 200 --json number,title,body,labels,updatedAt,url
gh issue view <N> --json number,title,body,labels,state,url,comments
```

## Step 2: Detect defects

Check every Linear issue in scope against these rules.

**State integrity**

- Missing workflow state, or a state name outside the required nine.
- Todo with incomplete spec sections.
- In Progress with no branch (`gitBranchName` missing) and no recent comment.
- Agent Review with no open PR.
- Human Review that has been paused with new commits still requested in comments.
- Done with no merged PR naming the issue.
- Canceled or Duplicate with active coding still requested.

**Body integrity**

- Missing `## Acceptance criteria` heading.
- Acceptance criteria present but not checkbox-formatted, empty, or written with vague language and no observable threshold.
- Missing `## Build handoff` on a Todo issue.
- A standalone spec or child missing `## Demonstration`, or whose demonstration depends on unfinished sibling issues.
- A Status section in the body. Linear state is the status; flag the mirror for removal.
- `Blocking open questions` that is not `None` on a Todo issue.
- Placeholder text: `TBD`, `TODO`, `<...>`, unfilled template sections.

**Hierarchy integrity**

- Parent with no children when its delivery slices require them.
- Child with no parent.
- A child whose acceptance criteria do not roll up to any parent criterion.
- A parent whose acceptance criteria are not covered by any child.
- Children cut primarily by architecture layer when none delivers a consumer/action → observable result.
- Sub-issues nested more than one level deep.
- A Done parent whose children were never verified against merged code. Auto-close is not AC evidence.

**Dependency integrity**

Read the graph with `get_issue({ "id": "<id>", "includeRelations": true })`.

- A Canceled or Duplicate blocker with an undelivered prerequisite or an unlinked replacement. A Done blocker is satisfied; retain its edge for traceability.
- A parent listed as blocked by its own children. Confirm whether this encodes a real dependency before proposing removal with `removeBlockedBy`.
- A dependency cycle.
- A child whose `## Context` states a dependency with no matching `blockedBy` edge.
- An issue blocked by something in a workspace the user cannot access.

**Scope integrity**

- A spec whose acceptance criteria span more than one independently deliverable user outcome.
- Duplicate or overlapping specs. Check with `list_issues` `query`.
- An inbound GitHub Issue that was implemented without a Linear spec.

**Terminal hygiene**

- Canceled or Duplicate issues that still have open implementing PRs.
- Duplicate issues that do not `relatedTo` the surviving spec.

## Step 3: Report before acting

Present findings grouped by severity. Do not mutate anything yet.

```text
Blocking (Build, Review, or Verify cannot run)
  KAT-150  no acceptance criteria
  KAT-147  Todo with Blocking open questions: 2
  KAT-142  Human Review without explicit resume

Integrity (state is misleading)
  KAT-139  Done, no merged PR
  KAT-155  parent with no children
  KAT-140  body still has a Status section

Hygiene (safe corrections)
  KAT-161  missing needs-triage on an inbound stub
  KAT-158  incorrect dependency confirmed safe to remove

Inbound GitHub
  #12  no linked Linear issue
  #18  already linked to KAT-144

Stale (needs a decision)
  KAT-133  Backlog, 74 days untouched
```

## Step 4: Apply corrections

Apply in tiers, and get approval before anything in tier 2 or 3.

**Tier 1: safe, apply directly.** Report what you did.

- Add a missing optional hygiene label after `list_issue_labels` / `create_issue_label` when needed.
- Remove a hygiene label whose gap is fixed.
- Remove an incorrect dependency after confirming its prerequisite is satisfied or no longer applies, using `removeBlockedBy`.
- Add a `blockedBy` edge that the issue description already states in prose.
- Link an orphaned child with `save_issue` `parentId`.
- Remove a Status section from the description.

**Tier 2: ask first.** These change what the roadmap says.

- Move an issue between Backlog, Todo, In Progress, Agent Review, Human Review, or Merging.
- Mark an issue Canceled or Duplicate.
- Merge duplicates, which means pointing `relatedTo` at the survivor and moving the extra issue to Duplicate.
- Convert a spec into a parent and create children.
- Reopen work that is Canceled or Duplicate; that requires a new issue.

**Tier 3: never without explicit instruction.**

- Delete an issue.
- Bulk-update more than 10 issues in one action.
- Edit acceptance criteria on a Done issue.
- Close stale issues in bulk.

Use Linear MCP for these writes. Example:

```
save_issue({
  "id": "KAT-158",
  "removeBlockedBy": ["<incorrect-blocker-id>"]
})
save_issue({
  "id": "KAT-161",
  "labels": ["<existing-label>", "needs-triage"]
})
```

Build the label payload from a fresh issue read, retaining every unrelated label. Confirm the resulting set after the write as specified in conventions.

## Step 5: Sweep inbound GitHub Issues

For each open GitHub Issue in scope:

1. Read it with `gh issue view <N>`. Create a Linear spec only for reports that need implementation. Answer context-only questions or report insufficient information without inventing scope.
2. Search Linear for an existing linked spec before creating one:

```
list_issues({
  "team": "<team>",
  "project": "<project>",
  "query": "<github title or number>",
  "includeArchived": true
})
```

Also inspect `links` on nearby Linear issues.

3. If a Linear issue already covers it, add the GitHub URL with `save_issue` `links` if missing, and comment the Linear URL on the GitHub Issue:

```bash
gh issue comment <N> --body "Tracked as <linear-url>"
```

4. If none exists, create a full Backlog spec with AC using the template in `references/conventions.md`:

```
save_issue({
  "title": "<outcome-oriented title>",
  "team": "<team>",
  "project": "<project>",
  "state": "Backlog",
  "description": "<full spec with AC>",
  "links": [{"title": "GitHub #<N>", "url": "https://github.com/<owner>/<repo>/issues/<N>"}]
})
```

5. Comment the Linear URL on the GitHub Issue. Never implement from the GitHub Issue.

## Step 6: Order the backlog

After corrections, produce the ready-to-work ordering.

```
list_issues({
  "team": "<team>",
  "project": "<project>",
  "state": "Todo"
})
```

An issue is **ready** when:

- It is Todo.
- It has usable acceptance criteria.
- It has an independently exercisable `## Demonstration`, or a justified minimal technical-enablement exception directly blocking the next user-facing slice.
- `get_issue` `includeRelations` returns no open blockers.
- No open PR already implements it.

Rank ready issues by:

1. Earliest demonstrable value.
2. Unblocking value: how many other issues depend on it.
3. Explicit user priority.
4. Age, oldest first, among equals.

Present the top few with the reason each is ranked where it is.

## Step 7: Report

Summarize:

- Scope groomed and how many issues were read.
- Corrections applied, by tier.
- Corrections proposed and awaiting approval.
- Blocking defects that stop Build, Review, or Verify.
- Recommended next issue, with the reason.
- Inbound GitHub Issues linked or converted.
- Staleness decisions still owed by the user.

## Answering "what should we work on next?"

This is the short path through Triage. Run steps 1, 6, and 7 only. Skip the full defect scan, but still report any blocking defect on the issue you recommend, since it would stop Build immediately.
