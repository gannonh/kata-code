---
name: review
description: Use this skill when landing an open pull request in Agent Review. Owns settled-red CI and unanswered review comments from humans and bots. Calls npx agent-reviews to list, filter, reply, and watch. Moves merge-ready work to Human Review. Merges only after a fresh Merging-state check.
---

# Review

Land an open pull request during Agent Review. Handle the PR regardless of author.

This skill owns two landing surfaces:

- Settled-red CI. Checks that have finished and failed. Pending or queued checks are not red yet. Wait until they settle.
- Unanswered review comments and general PR conversation comments from humans and bots.

After merge-ready gates pass, move the issue to Human Review and stop. Merge only after a human moves the issue to Merging and a fresh revalidation succeeds.

## Runtime dependency

Review comments go through [agent-reviews](https://github.com/pbakaus/agent-reviews) at runtime.

```bash
npx agent-reviews --pr <N>
```

Do not vendor `agent-reviews` into this repository. Do not add it to a package.json. Do not npm-pack it. `npx` fetches the published CLI when the skill runs. Node.js 18+ is required. If the project prefers another runner, use that runner's equivalent (`pnpm dlx agent-reviews`, `yarn dlx agent-reviews`, or `bunx agent-reviews`).

Auth is the CLI's job. It reads `GITHUB_TOKEN`, then `GH_TOKEN`, then `.env.local`, then `gh auth token`. Run `gh auth status` before the first write if the session has not already.

The CLI inventories three GitHub comment types: inline review comments (`CODE`), general PR conversation comments (`COMMENT`), and review summaries (`REVIEW`). Use it as the list, filter, reply, and watch interface.

Do not paginate review comments with raw `gh`. Do not use `gh api graphql` review-thread queries or `gh api` review-comment list endpoints to inventory or reply.

`gh` remains correct for PR metadata, checks, run logs, mergeability, and merge. Reply to non-inline comments and review summaries through `gh pr comment <N> --repo <owner/repo>`, linking the original comment. Keep their inventory in `agent-reviews`.

## When to use

- The issue is in Agent Review, or Build just marked the PR ready.
- The user asks to land, review, or drive the current PR to merge-ready.
- CI has settled red, or unanswered review comments are blocking Human Review.
- A PR closed without merge and the issue needs Todo reconciliation.

Read `references/conventions.md` before any write.

## Preconditions

- An open PR exists for the current branch, or the caller named a PR number. Exception: closed-without-merge reconciliation.
- `gh` is authenticated.
- Node.js is available so `npx agent-reviews` can run.
- The Linear issue is in Agent Review, or a human explicitly resumed agent review from Human Review. For an issue in Merging, go directly to Merge and revalidate without dispatching coding agents.

If there is no PR and this is not closed-PR reconciliation, stop and say so. Opening a PR is Build's job.

If the issue is Human Review and the user did not explicitly resume work, stop. Coding, CI-fix, and review loops stay paused.

If the issue is Canceled or Duplicate, stop and leave it there.

Resolve the target repository and PR number once from the caller's input or the current branch. Every `<N>` and `<owner/repo>` below refers to that same target. Run `agent-reviews` from the target repository's checkout. Confirm the checkout's remote matches the target repository before inventory or replies; the CLI has no repository flag.

Before editing, confirm the checkout uses the target PR's `headRefName` and matches its current `headRefOid`. Switch to its existing head branch only after checking worktree safety and the Linear state. Stop on unrelated local changes or an unverified head. Keep the resolved PR target through every wait, push, revalidation, and merge.

## Landing loop

Re-read the Linear issue before each iteration, before dispatching any coding, CI-fix, or review agent, and after a wait. Stop immediately on Human Review without an explicit resume, an unexpected state, or a terminal state. Work on the PR's existing head branch, including PRs authored by others.

Review comments first. A review fix produces a new commit that retriggers CI. Fixing flakes on a SHA you are about to replace is wasted work.

### 1. Inventory comments and open asks

```bash
npx agent-reviews --pr <N> --expanded --json
```

Always pass the resolved PR number, including when it was initially discovered from the current branch.

Build a ledger before editing. For each comment record `id`, author, human or bot, type (`CODE`, `COMMENT`, or `REVIEW`), path, ask, classification, evidence, action, and disposition. Inspect follow-up replies for new asks even when a thread already has an agent or human reply.

The CLI's `--unanswered` and `--unresolved` filters are not closure evidence. They use reply heuristics, and list output does not populate live inline resolution state. Keep the full inventory and an explicit resolution receipt for every inline thread.

If the JSON list is empty, continue to settled CI.

### 2. Classify against current code

Classify each unanswered comment against the code on HEAD, not the diff the reviewer saw.

- `fix`. Still valid. Patch it. Add a regression test when the comment describes recurring behavior.
- `already-addressed`. Current code already satisfies the ask.
- `false-positive`. The finding is wrong, outdated, or not a defect. Reply with the reason.
- `question`. Answer it from the code.
- `unsafe-to-change`. The ask contradicts approved acceptance criteria or would be destructive.

Every classification needs evidence. Never silently drop a comment.

Stop and return to Plan when a reviewer asks for a change that contradicts approved acceptance criteria.

### 3. Apply fixes, then reply through agent-reviews

Validate locally after fixes. Commit and push when code changed. Capture the head SHA.

Reply to every processed comment. Prefix the body with `[agent]` so authorship is unambiguous.

```bash
npx agent-reviews --pr <N> --reply <id> "[agent] Fixed in <sha>. <what changed>"
```

```bash
npx agent-reviews --pr <N> --reply <id> "[agent] <disposition>. <evidence-backed rationale>" --resolve
```

Use `--resolve` after a tested fix or an evidence-backed disposition completes the ask. If a reviewer must confirm, leave the thread open and keep the issue in Agent Review. For `unsafe-to-change`, post the exact ask on Linear and stop. Ignore unpublished GitHub `PENDING` reviews.

Inspect the textual result of each resolution command. Require `Thread resolved` or `Thread already resolved`; exit code zero alone is insufficient because resolution errors can follow successful replies. A warning, missing receipt, or renewed ask leaves the thread open. Do not add `--json` to resolution commands because its output omits this result.

For a general PR comment or review summary, post the `[agent]` response with `gh pr comment <N> --repo <owner/repo> --body-file <reply-file>`, include a link to the original comment, and record the outcome. The CLI skips replies to these non-inline items. Do not invent extra `agent-reviews` flags. Do not retry review-thread inventory with raw `gh`.

### 4. Watch for new comments

After replies are posted:

```bash
npx agent-reviews --pr <N> --expanded --json
```

Compare with the ledger after every push and before handoff. Process new comments and follow-up asks through step 1. A watcher may signal activity, but the full inventory determines what remains.

### 5. Wait for CI to settle

```bash
gh pr view <N> --repo <owner/repo> --json number,isDraft,headRefName,headRefOid,mergeable,mergeStateStatus,statusCheckRollup
gh pr checks <N> --repo <owner/repo> --required --watch --fail-fast
```

Drop `--required` when the repo marks nothing as required. Keep consuming the watch output in the same turn. A pending or queued check is not settled. A cancelled skip is not green.

### 6. Act on settled-red CI

When checks have finished and failed:

```bash
gh run view <run-id> --repo <owner/repo> --log-failed
```

If a single job failed while the run is still going, pull that job's logs. Do not wait for the whole run when the failure is already visible.

Classify:

- Branch-related. Compile, test, lint, typecheck, or snapshot failures in code this branch touched. Fix, validate locally, commit, push.
- Flaky or infrastructural. Timeouts, runner provisioning, registry or network outages. Rerun up to 3 times with `gh run rerun <run-id> --repo <owner/repo> --failed`.

Do not edit tests, CI configuration, or dependency pins to hide an unrelated failure. If classification is ambiguous, diagnose once before rerunning.

### 7. Mergeability

Resolve merge conflicts against the base branch by rebasing or merging, per repo convention. Do not force-push over commits you did not create.

### 8. Re-enter

After any push or rerun, return to step 1 on the new SHA in the same turn.

## Human Review

Exit the landing loop only when all of these hold on the current head SHA:

- The PR is not a draft (`isDraft` is false).
- Mergeability is clean.
- Every required check is green. Not pending, not queued, not skipped-because-cancelled.
- The full expanded inventory and ledger contain no unanswered comments or follow-up asks.
- Every inline thread has explicit successful resolution output recorded after its last addressed ask. Never infer closure from filtered list output.

A green snapshot while checks are still running is not an exit.

Then move the issue to Human Review using the state-write protocol and **stop**:

```
get_issue({ "id": "<id>", "includeRelations": true })
save_issue({ "id": "<id>", "state": "Human Review" })
```

Skip the write when the issue is already Human Review. Stop if the issue is Canceled or Duplicate. Present the ledger, final SHA, and CI state.

Do not merge from Human Review.

## Merge

Merge is permitted only after a fresh Merging-state check and revalidation of merge readiness.

1. Re-read `get_issue({ "id": "<id>", "includeRelations": true })`.
2. Stop unless the state is Merging.
3. Re-run the merge-ready gates on the current head SHA.
4. Re-read Linear immediately before merging and stop unless it is still Merging. Merge with `gh pr merge <N> --repo <owner/repo> --match-head-commit <validated-sha>` using the repo's merge method.
5. Re-read the issue. Integration should move it to Done. Confirm Done. Skip a duplicate Done write.

Do not merge from Agent Review or Human Review.

## Closed PR without merge

When a PR closes without merge, this is lifecycle reconciliation:

1. Record the reason:

```
save_comment({
  "issueId": "<id>",
  "body": "## PR closed without merge\n<reason>"
})
```

2. Move the issue to Todo, including from Human Review, using the state-write protocol.
3. Leave Canceled and Duplicate unchanged.
4. Stop. Do not code, fix CI, or run the landing loop. A fresh explicit start is required to build again.

## Abort

Stop and report when:

- There is no open PR and this is not closed-PR reconciliation.
- `npx agent-reviews` cannot authenticate or cannot see the PR.
- The flaky-retry budget (3) is exhausted on the same check.
- CI fails for reasons outside the branch that you cannot fix.
- A reviewer asks for a change that contradicts approved acceptance criteria.
- The same check fails 3 times after 3 distinct fix attempts.
- A fix would require force-pushing over commits you did not create.
- The issue is Human Review without an explicit resume.
- The issue is Canceled or Duplicate.

Post the exact blocking ask as a Linear comment before stopping, unless MCP is unavailable.

## Never

- Merge from Agent Review or Human Review.
- Paginate or reply to review threads with raw `gh`.
- Vendor or npm-pack `agent-reviews`.
- Drop a review comment without a posted disposition.
- Treat pending CI as red.
- Invent `agent-reviews` flags that the CLI does not provide.
- End the turn with the landing loop unfinished and no abort condition reached.
