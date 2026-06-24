---
type: Spec
title: "Upstream sync strategy analysis"
description: "Analysis of why the bulk upstream merge strategy failed and alternative approaches for absorbing upstream changes into the Kata Code fork."
tags: [fork, upstream-sync, strategy, spec]
timestamp: 2026-06-21T00:00:00Z
status: Accepted
outcome: /adrs/0004-selective-vendor-pull.md
---

# Upstream Sync Strategy Analysis

> **Adopted 2026-06-21.** Recommendation Option D (selective vendor-pull) was
> accepted as [ADR 0004 — Selective vendor-pull upstream sync](/adrs/0004-selective-vendor-pull.md).
> This analysis is the rationale for that decision; the runbook lives in the
> [upstream sync guide](/guides/upstream-sync.md).

## The Problem

The first upstream sync attempt was scoped to 80 commits. It consumed an entire agent session building tooling (17 commits of pre-merge infrastructure), never completed the actual merge, and wrote a 154-line handoff document as a checkpoint.

Since then, upstream has added **173 more commits**. The total gap is now **253 commits** (205 `[codex]` + 48 non-codex), touching **1,408 files** with **107K insertions / 79K deletions**.

The current strategy — "bulk merge all upstream commits at once on an integration branch" — produced a scope that was too large to complete in a single session and grows larger every day it remains unfinished.

## Root Cause: The Bulk Merge Strategy Doesn't Scale

ADR 0003 says sync should happen "when there's a concrete reason" with no fixed schedule. The first sync was triggered after upstream had accumulated 80 commits. By the time tooling was built and the merge was ready to execute, the gap had grown to 253. This is a compounding problem:

1. **Larger gaps = more conflicts.** 649 intersecting paths at 80 commits. At 253 it will be worse.
2. **Larger gaps = more classification work.** Every commit needs Take/Reject/Defer/Review classification. At 80 commits this produced a 10-decision approval process.
3. **Larger gaps = more closure tasks.** Each merge surfaces branding regressions, build-injection changes, new Effect conventions to synthesize, vendored repo syncs.
4. **The `[codex]` Effect refactor commits are coupled.** 205 of 253 commits are `[codex]`-tagged Effect service restructuring. They can't be cherry-picked individually. This forces a bulk merge.
5. **Session context exhaustion.** The merge requires understanding 80+ conflict resolutions, fork-policy rules, branding constraints, and closure tasks simultaneously. A single agent session can't hold all of this.

## Options

### Option A: Push through the current bulk merge (status quo)

Reset to `774da08bc`, re-fetch upstream, re-classify the now-253 commits, re-run conflict prediction, and attempt the merge again.

**Pros:** Tooling is built. Runbook exists. Decisions 1-9 still apply for the original 80 commits.
**Cons:** Scope has tripled. The same problems that stalled the first attempt are worse. Classification needs re-running. The 173 new commits need review. High probability of another stall.

### Option B: Targeted cherry-pick of non-codex changes only

Cherry-pick the ~48 non-codex commits (UI fixes, mobile dep bumps, preview ownership hardening, diff scope switching, etc.) and defer the 205 `[codex]` Effect refactor commits until upstream stabilizes that effort.

**Pros:** Dramatically smaller scope. Non-codex commits are more likely to be independent. Gets real user-facing improvements (UI fixes, settings, security hardening) without the massive Effect refactor risk.
**Cons:** The `[codex]` commits touch shared files that the non-codex commits may also touch, creating dependency issues. Some non-codex commits may depend on Effect changes. Leaves 80% of the gap unresolved.

### Option C: Rebase fork onto upstream (destructive, clean slate)

Abandon the merge-based strategy. Rebase the fork's divergent commits onto upstream's current tip, resolving conflicts once per fork commit.

**Pros:** Clean linear history. Each conflict resolution is scoped to a single fork commit (branding, desktop auth, etc.), which is much easier to reason about. The fork has relatively few original commits — the bulk of divergence is branding renames and configuration, not new features.
**Cons:** Rewrites fork history. Invalidates any open PRs or branches. Requires force-push. If anyone else has cloned the fork, their history breaks. One-time cost but it's real.

### Option D: Selective vendor-pull (recommended)

Stop treating upstream as a git ancestor to merge from. Instead, treat upstream changes as patches to evaluate and apply selectively:

1. **Track upstream as a read-only reference** (keep the remote, keep `.repos/` vendored copy).
2. **When upstream ships something you want**, port it as a fork-original commit: read the upstream diff, understand the change, apply the relevant parts to your codebase with fork branding already in place. No merge commit. No conflict resolution. No branding re-application pass.
3. **For the `[codex]` Effect refactor specifically**, wait for it to stabilize upstream, then port the net result as a single structured migration on the fork. The individual intermediate commits don't matter — only the final API surface does.
4. **Automate detection**: keep `classify-upstream.ts` running periodically to flag interesting upstream changes, but don't batch them into mega-merges.

**Pros:**

- Each ported change is small, self-contained, and already branded.
- No conflict resolution cascades.
- No closure tasks (branding scans, build-injection verification) because the port is done correctly from the start.
- The fork's history stays clean and linear.
- Upstream can churn freely without creating pressure on the fork.
- You absorb value (bug fixes, features, security patches) without absorbing risk (intermediate refactor states, coupled commit chains).

**Cons:**

- More per-change effort than a clean merge (you're re-implementing rather than merging).
- Large structural changes (like the Effect refactor) require understanding the net diff rather than replaying commits.
- Diverges from the "connected history" principle in ADR 0003, though the upstream remote and vendored repo still provide full traceability.

### Option E: Squash-merge upstream, then fixup

`git merge --squash upstream/main` to collapse all 253 upstream commits into a single diff against the fork, then resolve conflicts on that single diff and apply branding fixes.

**Pros:** Simpler than a real merge — one conflict resolution pass, no merge commit ancestry complications. The diff itself shows exactly what upstream changed.
**Cons:** Loses individual commit attribution from upstream. Still a large diff (107K insertions / 79K deletions). Still requires branding re-application and closure tasks.

## Recommendation

**Option D (selective vendor-pull)** for ongoing sync. **Option E (squash-merge)** as a one-time catch-up if you want to close the current gap quickly.

The reasoning:

1. **The `[codex]` Effect refactor is the elephant in the room.** 205 of 253 commits are part of an ongoing upstream effort to restructure error handling across the entire codebase. This effort is still active (new `[codex]` commits are landing daily). Merging intermediate states of this refactor is wasted work — you'd be absorbing a moving target. Wait for it to stabilize, then port the net result.

2. **The fork's divergence surface is small.** Your actual fork changes are branding, desktop auth, release scripts, and configuration. The fork has no original features yet. This means the "re-implement upstream changes with fork branding" cost from Option D is low — most upstream changes apply cleanly because you haven't diverged functionally.

3. **The merge tooling you built isn't wasted.** `classify-upstream.ts` and `conflict-zones.ts` are valuable for Option D too — they tell you what upstream changed and where it intersects with your code. `rebrand-fork.ts` is useful for auditing. You just stop using them as part of a bulk merge ceremony.

4. **ADR 0003 already supports this.** The ADR says "merge when there's a concrete reason" and "cherry-pick is the escape hatch for single urgent fixes." Option D extends this to "port when there's a concrete reason, with the port scoped to the specific change you want."

## If You Choose Option D: Immediate Actions

1. **Abandon the `upstream-sync-2026-06-20` branch.** The pre-merge tooling commits can be cherry-picked onto `main` — the skill, scripts, and docs are independently valuable.
2. **Identify the 3-5 upstream changes you actually want right now** from the 48 non-codex commits (UI fixes, security hardening, etc.).
3. **Port each one as an independent PR** with fork branding applied during the port.
4. **Defer the `[codex]` Effect refactor** until upstream finishes it. Track progress with `classify-upstream.ts`.
5. **Update ADR 0003** to reflect the shift from "episodic bulk merge" to "selective vendor-pull with upstream tracking."

## If You Choose Option E: Immediate Actions

1. **Pin the upstream target SHA now.** Don't let scope creep further.
2. **Squash-merge, resolve conflicts, rebrand, verify.** One pass, one session.
3. **Then switch to Option D for all future syncs.**
