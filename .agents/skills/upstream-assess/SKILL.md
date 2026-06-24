---
name: upstream-assess
description: Assess and selectively port changes from the upstream T3 Code fork (pingdotgg/t3code) into Kata Code. Use whenever the user wants to review what upstream has done, assess the diff, decide what to bring in, triage upstream commits, plan a vendor-pull, run an upstream scan, or figure out which upstream changes are worth porting. Covers scanning upstream since the last baseline, grouping commits by effort and risk, recommending Port/Skip/Watch per change, and re-implementing chosen changes as fork-original commits with Kata branding applied from the start.
---

# Upstream assess

Vendor-pull process for absorbing changes from [pingdotgg/t3code](https://github.com/pingdotgg/t3code) into [gannonh/kata-code](https://github.com/gannonh/kata-code).

This is the active upstream strategy per [ADR 0004 — Selective vendor-pull](/docs/adrs/0004-selective-vendor-pull.md). It replaced the abandoned episodic bulk-merge approach (ADR 0003). The unit of work is a single upstream change ported as a fork-original commit, not a merged range.

The docs live in the OKF bundle:

- Policy: [ADR 0004](/docs/adrs/0004-selective-vendor-pull.md) and the superseded [ADR 0003](/docs/adrs/0003-episodic-upstream-sync.md)
- Runbook mirror: [docs/guides/upstream-sync.md](/docs/guides/upstream-sync.md)
- Divergence log + last scan baseline: [FORK.md](/FORK.md)

## What this skill does

Walks the human from "what has upstream done?" to a concrete, per-change decision about what to bring in. Five phases:

1. **Scan** — list every upstream commit since the last scan baseline, grouped by area and kind.
2. **Triage** — for each change or cluster, assess effort, risk, and a recommendation (Port / Skip / Watch).
3. **Decide** — present the triage to the human; the human chooses what to port. Do not auto-proceed.
4. **Port** — re-implement each approved change as a fork-original commit with Kata branding already applied.
5. **Record** — update FORK.md (last scan tip, ported changes, watched clusters) and OKF logs.

## The two helper scripts

Self-contained TypeScript in `scripts/` (this directory). Run from the repo root with plain `node` — Node 24 strips types natively, no build step, no workspace imports.

- **`scan-upstream.ts`** — inventories upstream commits since the baseline and writes a markdown triage report grouped by `[codex]` tag and file area. This is the entry point for every assessment.
- **`intersection.ts`** — given an upstream SHA (or range), lists which files it touches that the fork has also modified. Use it during triage to size conflict risk before deciding to port.

They are read-only against git and the filesystem. They never push, never merge, never write to tracked files. The scan report is written to a gitignored scratch path.

## Phase 1 — Scan

Prerequisite: the `upstream` remote must exist and be fetched. If it is missing, the human decides whether to add it (`git remote add upstream https://github.com/pingdotgg/t3code.git`) — do not add it unprompted.

```bash
git fetch upstream --tags
node .agents/skills/upstream-assess/scripts/scan-upstream.ts > /tmp/upstream-scan.md
```

By default the scanner reads the last-scanned tip from FORK.md's `Last upstream scan` block (or `Upstream tip SHA:`). Override with `--base <sha>` or `--tip <sha>`. The scan report groups commits into:

- **`[codex]` cluster** — the coordinated Effect service migration upstream is still running. These are coupled and must not be ported individually. Default recommendation: **Watch**.
- **Area groups** — commits bucketed by top-level path (`apps/server`, `apps/web`, `apps/desktop`, `packages/*`, `infra/`, `.github/`, `docs/`, etc.).
- **Ungrouped** — anything that doesn't fit the above.

Hand the report to the human in Phase 3. Read it yourself to ground your triage in real data rather than guesses.

## Phase 2 — Triage

For each change or cluster the human might consider porting, produce an assessment:

- **What it does** — one or two sentences, from the upstream commit message and diff.
- **Fork intersection** — which fork-modified files it touches. Run the intersection script to get this precisely:

  ```bash
  node .agents/skills/upstream-assess/scripts/intersection.ts <sha>
  # or a range:
  node .agents/skills/upstream-assess/scripts/intersection.ts <base>..<tip>
  ```

- **Effort** — Trivial (additive, touches nothing the fork changed) / Moderate (touches fork-modified files, needs hand-merge of intent) / Significant (structural change across packages).
- **Risk** — Low (isolated) / Medium (touches shared types, contracts, or protocol) / High (touches a divergence surface: wire identifiers, branding, relay, desktop auth).
- **Recommendation** — one of:
  - **Port** — re-implement on the fork now.
  - **Skip** — permanently ignore; record rationale in FORK.md so it is not re-litigated next scan.
  - **Defer** — worth doing but tied to a named fork project phase (cross-sync); record in `docs/specs/deferred-work.md`.
  - **Watch** — part of an active upstream refactor (e.g. the `[codex]` Effect migration). Do not port intermediate states. Revisit when upstream stabilizes, then port the net result.

The `[codex]` Effect migration is the archetype for Watch. Porting intermediate states of a moving refactor is wasted work that later commits in the same effort overwrite.

## Phase 3 — Decide

Present the scan summary and per-change triage to the human. Pause. The human decides which changes to port. This gate exists because selective porting only works if each port is a deliberate choice — without it we drift back toward "absorb everything," which is the failure mode ADR 0004 was written to fix.

## Phase 4 — Port

For each approved change, re-implement it as a fork-original commit. This is not a merge or cherry-pick: read the upstream diff, understand the intent, apply the relevant parts to the fork with Kata branding already in place.

```bash
git checkout main && git pull origin main
git checkout -b port-upstream/<short-description>
git show <upstream-sha>            # or: git diff <base>..<tip> for a cluster
# apply the change with fork branding already in place
```

Then verify the port:

```bash
vp check
vp run typecheck
```

If the port bumps a dependency, sync the vendored subtree so `.repos/` matches installed versions:

```bash
vp run sync:repos --repo <id>
```

Reference the upstream SHA(s) in the commit body so the divergence log can trace the port:

```
feat(server): port upstream session timeout fix

Upstream: abc1234, def5678
```

Merge to `main` via a PR or direct push depending on scope.

## Phase 5 — Record

Update [FORK.md](/FORK.md):

- Advance `Last upstream scan` and `Upstream tip SHA` to the tip you scanned.
- Add a line under `Ported upstream changes (vendor-pull)` for each port: `upstream-sha → fork-sha (description)`.
- Log new Skip decisions in the divergence log with rationale.
- Add or update Watched clusters with their stabilization trigger.

Add a dated entry to `docs/log.md` and `docs/specs/log.md` per the OKF workflow.

## Hard rules

Non-negotiable fork policy, enforced on every port:

- Never push to the `upstream` remote.
- Never reintroduce `@t3tools/*`, `T3CODE_*`, `t3code://`, or `app.t3.codes` on product surfaces without an explicit FORK.md decision. Test fixtures may legitimately keep upstream-shaped repo names (e.g. `octocat/t3code`).
- Keep fork wire identifiers intact: `kata_relay`, `kata-mobile`, `kata-web`, `/.well-known/kata/environment`, `/api/kata-connect`.
- The internal `t3://` static-asset scheme in `apps/desktop/src/electron/ElectronProtocol.ts` is intentional divergence, not a regression — do not "fix" it during a port.
- Never commit secrets.

## High-divergence zones

Where a ported change most likely intersects fork-modified files (use the intersection script to confirm per-commit):

| Zone                         | Why                                            |
| ---------------------------- | ---------------------------------------------- |
| `packages/contracts/`        | Protocol/schema changes ripple everywhere      |
| `packages/shared/`           | Shared runtime utilities                       |
| `apps/server/`               | Provider wiring, CLI, session lifecycle        |
| `apps/web/`                  | UI state, WebSocket client, session UX         |
| `apps/desktop/`              | Electron main, backend manager, branding, auth |
| `scripts/dev-runner.ts`      | Dev env and ports                              |
| `pnpm-lock.yaml`             | Regenerate with `vp i` when a port bumps deps  |
| `package.json` (root + apps) | Scripts, filters, version bumps                |

## Developing fork features with future ports in mind

Prefer extension boundaries over editing upstream core. Put fork-only behavior in new modules, adapter boundaries, or `packages/kata-*` / `apps/kata-*` locations per [FORK.md — Phase 4](/FORK.md). The less we edit shared core files, the cheaper every future port is.
