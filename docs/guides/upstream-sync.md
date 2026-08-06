---
type: Guide
title: "Upstream sync"
description: "Selective vendor-pull runbook for Kata Code: scan upstream, analyze commits for effort and risk, port individual changes as fork-original commits. Mirrors the upstream-assess skill, which bundles the helper scripts."
tags: [fork, git, upstream, guide, runbook]
timestamp: 2026-06-21T00:00:00Z
---

# Upstream sync

Runbook for absorbing changes from [pingdotgg/t3code](https://github.com/pingdotgg/t3code) into [gannonh/kata-code](https://github.com/gannonh/kata-code).

**Policy:** [ADR 0004 — Selective vendor-pull](/adrs/0004-selective-vendor-pull.md). **Fork mechanics & divergence log:** [FORK.md](../../FORK.md). **Agent-facing process (canonical):** [.agents/skills/upstream-assess/SKILL.md](../../.agents/skills/upstream-assess/SKILL.md). This guide mirrors that skill; the skill is the source of truth and bundles the helper scripts.

Kata Code does **not** aim for parity with `upstream/main`. Absorb upstream changes when there is a concrete reason. Each change is ported as a fork-original commit with branding already in place.

## Why vendor-pull, not merge

The first upstream sync attempt used the bulk-merge strategy from ADR 0003. It scoped to 80 commits, consumed an entire agent session building tooling, and never completed the merge. The gap grew to 253 commits (205 `[codex]` Effect refactor + 48 others) before the attempt was abandoned.

Bulk merges compound: larger gaps produce more conflicts, more classification work, and more branding-regression closure tasks. The `[codex]` Effect refactor — 200+ coupled intermediate commits — made cherry-picking impossible and bulk-merging impractical.

Vendor-pull addresses this by porting individual upstream changes (or small clusters) as fork-original commits. Each port is small, self-contained, and correctly branded from the start. No merge conflicts, no branding re-application pass, no closure tasks. Coordinated upstream refactors are deferred until they stabilize, then the net result is ported once.

See [the strategy analysis](/specs/2026-06-21-upstream-sync-strategy-analysis.md) for the full evaluation.

## Prerequisites

- `origin` → `gannonh/kata-code`, `upstream` → `https://github.com/pingdotgg/t3code.git` (read-only; never push)
- Clean working tree on `main`
- The **Last upstream scan** block in [FORK.md](../../FORK.md) records the baseline SHA. The scanner reads it from there.

## Step 0 — Scan upstream

See what's new since the last scan.

```bash
git fetch upstream --tags
node .agents/skills/upstream-assess/scripts/scan-upstream.ts > /tmp/upstream-scan.md
```

`scan-upstream.ts` reads the last-scanned tip from `FORK.md` (or `--base <sha>`, else `git merge-base main upstream/main`), lists every non-merge upstream commit since that SHA, splits the `[codex]` Effect migration out as a Watch cluster, groups the rest by area, and writes a markdown triage report to stdout. Redirect to a scratch path (`/tmp/upstream-scan.md`); it is regenerated on each run.

The baseline SHA represents the last-scanned upstream tip, not the last-merged commit. Advance it in Step 3 after every scan.

## Step 1 — Analyze and recommend

Group related commits into clusters. For each cluster, assess:

- **What it does** — functional summary.
- **Fork intersection** — which fork-modified files it touches. Run the intersection script for per-commit overlap:

```bash
node .agents/skills/upstream-assess/scripts/intersection.ts <sha>
node .agents/skills/upstream-assess/scripts/intersection.ts <base>..<tip>
```

- **Effort** — Trivial (additive, non-divergent files) / Moderate (touches fork-modified files) / Significant (structural change across packages).
- **Risk** — Low (isolated) / Medium (touches shared types/contracts) / High (touches divergence surfaces: wire identifiers, branding, relay).
- **Recommendation** — Port / Defer / Skip / Watch.

**Verdict vocabulary.** Port (re-implement on the fork), Skip (permanently ignore; log in FORK.md), Defer (tied to a named fork project phase; cross-sync), Watch (active upstream refactor; defer until stable, then port the net result).

**Coordinated refactors.** When upstream ships a large coupled refactor, recommend **Watch**. The `[codex]` Effect migration is the archetype: port the net result once it stabilizes, not intermediate states of a moving target.

**Hard human gate.** Present the analysis and pause. The human decides which changes to port. Do not auto-proceed.

## Step 2 — Port (per approved change)

Re-implement the upstream change as a fork-original commit.

```bash
# Create feature branch
git checkout main && git pull origin main
git checkout -b port-upstream/<short-description>

# Read the upstream diff
git show <commit>                         # single commit
git diff <first-parent>..<last-commit>    # cluster
```

Apply the change to the fork codebase with fork branding already in place. This is a re-implementation, not a merge.

After applying, verify there is no `@t3tools/*`, `T3CODE_*`, `t3code://`, or `app.t3.codes` regression on product surfaces and run the gates:

```bash
vp check
vp run typecheck
```

Commit with conventional commit format. Reference upstream SHAs in the commit body:

```
feat(server): port upstream session timeout fix

Upstream: abc1234, def5678
```

If vendored reference repos (`.repos/`) need updating because the ported change bumps a dep:

```bash
vp run sync:repos --repo <id>
```

Merge to main (direct push or PR depending on scope).

### High-divergence zones

These areas require extra care when porting. Upstream changes here are more likely to intersect with fork-modified files.

| Zone                         | Why                                       |
| ---------------------------- | ----------------------------------------- |
| `apps/server/`               | Providers, CLI, session lifecycle         |
| `apps/web/`                  | UI state, WebSocket client, session UX    |
| `apps/desktop/`              | Electron main, backend manager, branding  |
| `packages/contracts/`        | Protocol/schema changes ripple everywhere |
| `packages/shared/`           | Shared runtime utilities                  |
| `scripts/dev-runner.ts`      | Dev env and ports                         |
| `package.json` (root + apps) | Scripts, filters, version bumps           |

## Step 3 — Record

Update [FORK.md](../../FORK.md):

- Advance the `Last upstream scan` date and tip SHA.
- Log ported changes under `Ported upstream changes` with upstream SHA, fork SHA, and date.
- Log new Skip decisions in the divergence log with rationale.
- Log Watch clusters with their stabilization trigger.

Update OKF logs (`docs/log.md`, relevant section logs) per the OKF workflow.

```text
Last upstream scan: YYYY-MM-DD
Upstream tip SHA:   <scanned-upstream-tip>
Ported:             <upstream-sha> → <fork-sha> (<description>)
Skipped:            <upstream-sha> — <rationale>
Watching:           <cluster> — stabilization trigger: <trigger>
```

## Hard rules

These are non-negotiable fork policy:

- Never push to the `upstream` remote.
- Never reintroduce `@t3tools/*`, `T3CODE_*`, or upstream product strings (`t3code://`, `app.t3.codes`) without an explicit [FORK.md](../../FORK.md) decision.
- Never sever the `upstream` remote or unlink the GitHub fork badge. Shared git history provides traceability. Independence is expressed through product identity, release pipeline, and the divergence log.
- Never commit secrets (`.env`, signing certs, Clerk/relay credentials).

## Developing fork features with future syncs in mind

Follow [FORK.md — Phase 4](../../FORK.md#phase-4--divergence-boundaries):

| Prefer                                  | Avoid                                               |
| --------------------------------------- | --------------------------------------------------- |
| New package under `packages/kata-*`     | `if (katacode)` branches in shared core             |
| Adapter at provider boundary            | Renaming upstream types in place                    |
| Fork specs and ADRs under `docs/specs/` | Rewriting upstream architecture docs in place       |
| Thin hooks into shared modules          | Large edits across `contracts` for fork-only fields |

Before a large fork-only feature, ask: _can this live in a new module upstream does not touch?_ If yes, put it there.

## Related

- [ADR 0001 — Connected fork](/adrs/0001-connected-fork-upstream-merge.md)
- [ADR 0004 — Selective vendor-pull](/adrs/0004-selective-vendor-pull.md) (supersedes [ADR 0003](/adrs/0003-episodic-upstream-sync.md))
- [Strategy analysis](/specs/2026-06-21-upstream-sync-strategy-analysis.md)
- [Fork setup spec](/specs/archive/fork-setup.md)
- [FORK.md](../../FORK.md)
- [upstream-assess skill](../../.agents/skills/upstream-assess/SKILL.md) (canonical runbook + bundled scripts)
