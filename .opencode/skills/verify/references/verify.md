# Verify Workflow

Use this workflow to validate merged implementation against the spec issue's acceptance criteria and publish the evidence on the Linear issue.

Verify starts after Done. Read `references/conventions.md` before starting.

## Autonomy contract

**Verify runs autonomously from entry until the result comment is posted.** Do not pause between steps to request permission.

Run without asking:

- Confirming the relevant PR merged.
- Checking out or fetching the merged default branch.
- Capturing evidence and recording the matrix.
- Opening or reusing Backlog follow-up issues for failed criteria.

Stop after the Linear result comment. Failed follow-ups require human Todo approval before Build.

## Step 1: Gather inputs

```
get_issue({
  "id": "<id>",
  "includeRelations": true
})
list_comments({
  "issueId": "<id>"
})
```

```bash
gh pr list --search "<issue-id>" --state merged --json number,title,state,mergedAt,mergeCommit,url
gh pr view <N> --json number,state,mergedAt,mergeCommit,url,title,body
```

Collect:

- The spec issue in Done, or a parent that auto-closed after its last child closed.
- The acceptance criteria checkbox list from the issue description.
- The Build matrix comment, if present.
- The merged PR and merge commit.

Run the phase-entry hygiene check from `references/conventions.md` and report findings. If acceptance criteria are missing or ambiguous, stop and return to Plan via a Backlog follow-up. Leave the original issue Done.

If the issue is not Done, stop. Verify does not run against In Progress, Agent Review, Human Review, or Merging.

For an automatically closed parent, collect its children with `list_issues` using `parentId` and follow Step 7. The parent does not need its own implementing PR. For a leaf issue with no merged PR naming it, record that failure in the result comment and open a Backlog follow-up. Auto-close of a parent is not merge evidence.

## Step 2: Work from merged state

Fetch the default branch and inspect the worktree first. Use a separate worktree at the merge commit when local work must be preserved. Confirm the commit belongs to the fetched default branch. Do not verify the pre-merge feature branch.

```bash
git fetch origin <default-branch>
git merge-base --is-ancestor <merge-commit> origin/<default-branch>
git switch --detach <merge-commit>
```

## Step 3: Verify against acceptance criteria

**Look for a project-local `verify-*` skill first** (slash form `/verify-<app>`).

1. Search for a skill named `verify-*`. Typical locations: `.cursor/skills/verify-*/SKILL.md`, then any installed skills path that matches `verify-*`.
2. If several match, pick the one whose description matches the app under test; if still ambiguous, ask once.
3. If found: read that `SKILL.md` completely. Use its Launch, Doctor, Drive, Evidence, and Cleanup sections against the merged code.
4. Reuse Build's evidence contract. Resolve paths against the sibling `build` skill directory:

```text
<plugin-root>/skills/build/references/user-acceptance/workflow.md
<plugin-root>/skills/build/scripts/user-acceptance/
```

Read that workflow completely. Use `init-evidence.mjs`, `run-capture-command.mjs`, `write-report.mjs`, and `verify-evidence.mjs` from the Build skill. Map verify-* artifacts into that layout when practical.

5. If none found: drive the app with those bundled playbooks only. Do not generate a verification skill during Verify.

- Use an explicit **acceptance-criteria matrix** in the final Linear comment.
- Each criterion shows the verification method, result (`Pass`, `Fail`, `Blocked`, or `Not tested`), and evidence path or note.

Evidence artifacts land under `uat-evidence/<target>-<timestamp>/`. Reference their paths in the comment.

## Step 4: Adversarial evidence review

- Task a subagent to verify the `uat-evidence` and tests against the issue's acceptance criteria.
- Give the subagent the issue identifier so it can read the criteria with `get_issue`.
- The subagent must not have produced the evidence it reviews.
- Fill in any gaps before posting the report.

## Step 5: Post the acceptance evidence

Create or locate failed-AC follow-ups using Step 6 before posting, so the result comment includes their links. Then post once and stop.

```
save_comment({
  "issueId": "<id>",
  "body": "## Verify: acceptance criteria matrix\n..."
})
```

Start the comment with `## Verify: acceptance criteria matrix` and include:

- Scope line naming the merged PR, merge commit, and default branch.
- The matrix: criterion, method, result, evidence path.
- Totals (`6 Pass / 0 Fail / 1 Blocked`).
- Failures and blocked items with what would unblock them.
- Links to follow-up Backlog issues for each failed criterion.
- Unrelated validation failures, separated from in-scope failures.
- Manual run instructions a human can follow.

Leave the original issue in Done.

## Step 6: Follow-up issues for failed criteria

For each failed AC, create or reuse a linked Backlog issue containing the failure, scoped spec, AC, and evidence:

```
list_issues({
  "team": "<team>",
  "project": "<project>",
  "query": "<failure keywords>",
  "state": "Backlog"
})
```

Reuse an existing follow-up when it already covers the same failure. Otherwise:

```
save_issue({
  "title": "<failed criterion>",
  "team": "<team>",
  "project": "<project>",
  "state": "Backlog",
  "relatedTo": ["<original-id>"],
  "description": "<failure, scoped spec, AC, and evidence>"
})
```

Link every follow-up identifier in the original issue's result comment. The follow-up requires human Todo approval before Build.

## Step 7: Automatically closed parents

When a parent auto-closed because its last child closed:

1. Confirm each child's relevant PR actually merged. Identify one merged default-branch revision containing all child merges and use it for aggregate proof.
2. Confirm each child's AC matrix, or verify the parent's top-level criteria directly against merged code.
3. Post an aggregate `## Verify: acceptance criteria matrix` on the parent.
4. Open Backlog follow-ups for any parent criterion that failed.

Auto-close is not evidence that code merged or AC landed.

## Stop and ask

Stop and hand back to the user when:

- The spec issue cannot be found or is not Done and is not an auto-closed parent.
- Acceptance criteria are missing or ambiguous.
- Required credentials, services, or devices are unavailable.
- Verification would run destructive commands.
- The worktree has unrelated changes that make evidence unreliable.

When an authorized search finds no merged PR for a Done leaf issue, use the failure-comment and Backlog-follow-up path in Step 1. If GitHub access prevents that search, comment with the exact access request and stop.

## Never

- Merge a pull request.
- Open a pull request.
- Move the original issue out of Done because AC failed.
- Check off a criterion without evidence in the matrix.
- Edit the wording of an acceptance criterion to make it pass.
- Treat parent auto-close as merge proof.
- Start Verify from Agent Review, Human Review, or Merging.
