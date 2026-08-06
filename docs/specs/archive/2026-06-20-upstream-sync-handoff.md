---
type: Plan
title: "2026-06-20 upstream sync — resume handoff"
description: "Handoff and rollback checkpoint for the first episodic upstream sync. Pre-merge tooling and fork hardening are committed on upstream-sync-2026-06-20; the bulk merge is the next step. Read this before continuing the sync."
tags: [fork, upstream-sync, handoff, plan]
timestamp: 2026-06-20T00:00:00Z
status: Superseded
superseded_by: /adrs/0004-selective-vendor-pull.md
---

# 2026-06-20 upstream sync — resume handoff

> **Superseded 2026-06-21.** This handoff resumes the abandoned bulk-merge plan
> ([ADR 0003](/adrs/0003-episodic-upstream-sync.md)). It is not the active process.
> [ADR 0004 — Selective vendor-pull](/adrs/0004-selective-vendor-pull.md) replaces it.
> Do not resume the merge sequence below; use the [vendor-pull runbook](/guides/upstream-sync.md)
> instead. Retained as a rollback checkpoint and record of the pre-merge tooling that
> survived on `origin/upstream-sync-2026-06-20`.

Read this before continuing the upstream sync. It is the rollback target and the handoff contract for whoever (human or sub-agent) picks up the merge next.

Pairs with [the closure spec](/specs/2026-06-20-upstream-sync-closure.md) (the approved Decisions 1-10 + the 5 closure tasks with acceptance criteria) and [the upstream-sync skill](../../.agents/skills/upstream-sync/SKILL.md) (the runbook). This doc is the _where-we-are / resume-from-here_; the closure spec is the _what / acceptance_.

## Rollback target (clean baseline)

```text
branch:        upstream-sync-2026-06-20
handoff HEAD:  774da08bc37ae40c7e35b8fc55268914fbe624b0
local main:    8f7ae9600fe490430498324cbbaa2d9fb84b54f3
origin/main:   f5640f62a427605cc300472ada9bbdbb51bedaea
upstream/main: fetched locally; tip may have advanced since the session
FORK.md baseline: 708d5383a9c7415c3795890ca4f664c7b00f9a47
```

To roll back to this checkpoint: `git checkout upstream-sync-2026-06-20 && git reset --hard 774da08bc && git clean -fd`.

**None of the branch's commits are pushed to origin.** Local-only.

## What is committed and safe (the durable deliverables)

All on `upstream-sync-2026-06-20` at `774da08bc`. The skill, helpers, spec, and pre-merge fork hardening are committed.

- **upstream-sync skill** (`.agents/skills/upstream-sync/SKILL.md`): Steps 0-7 runbook with the post-merge closure phase, the Take/Reject/Defer/Review vocabulary, the resolve-before-stage warning, the hard human gate at Step 1, the plan-build-verify reference + install fallback.
- **five helper scripts** (`.agents/skills/upstream-sync/scripts/`):
  - `rules.ts` — classification rules, with the `review` bucket for unclassified commits
  - `classify-upstream.ts` — inventory + classify (produces `sync-plan.md`)
  - `conflict-zones.ts` — predicts conflicts from `git diff` intersection
  - `rebrand-fork.ts` — applies the FORK.md identity table; `--apply` writes, `--check` is the closure gate (includes `PROPERTY_PATTERNS`, Context.Service key prefixes, OTel renames; exempts `ElectronProtocol.ts` from `"t3"` package rename)
  - `take-upstream.sh` — resolves conflicts by taking upstream's side, safe (handles `UU` content + `UD` modify/delete, refuses after staging; macOS Bash 3.2 compatible)
- **closure spec** (`docs/specs/2026-06-20-upstream-sync-closure.md`): Approved. Decisions 1-10 and five closure tasks with acceptance criteria; [branch progress table](/specs/2026-06-20-upstream-sync-closure.md#branch-progress-pre-merge-landed-on-integration-branch) tracks pre-merge vs blocked work.
- **FORK.md divergence log** (committed at `cbe4b46e3`): 2 rejects (marketing `3bdaa6e1`, EAS non-ported portion of `9544e72d`) and the EAS label-gate ported improvement, recorded pre-merge.
- **guide** (`docs/guides/upstream-sync.md`): mirrors the skill.
- **Hard fork branding** (no `~/.t3` migration): `warnLegacyHomeDirectoryIfNeeded` removed; [ADR 0002](/adrs/0002-katacode-product-identity.md) updated.
- **Desktop dev fixes**: consolidated `electron-launcher.mjs`, loopback Vite bind, dev auth callback in running app; `electron-launcher.test.mjs` coverage.

Verify the baseline is healthy before resuming:

```bash
vp check
vp run typecheck
node .agents/skills/upstream-sync/scripts/classify-upstream.ts 2>&1 | grep "Draft classification"
```

## What is NOT done

**The bulk merge of upstream commits was never committed.** Pre-merge tooling and fork hardening are complete; `git merge upstream/main` is the next step.

## Last-mile work (committed — no longer blocking merge prep)

These were diagnosed during the first merge attempt and are now committed on the branch:

1. **`PROPERTY_PATTERNS`** in `rebrand-fork.ts` (`t3Home`, `t3-env:`, `~/.t3`)
2. **Context.Service key prefixes** (`"t3/` → `"@kata-sh/code-cli/`; `"t3code-relay/` → `"@kata-sh/code-relay/`)
3. **OTel brand renames** in source and `rebrand-fork.ts` rules
4. **`ElectronProtocol.ts` exemption** — internal `DESKTOP_SCHEME = "t3"` preserved per FORK.md; `rebrand-fork.ts` skips `"t3"` package rename on that path (tests use upstream-shaped scheme literals)

Still apply at merge time (merge has not run yet):

- **Fork-file restorations** after bulk `take-upstream.sh` (release scripts, `packages/shared/package.json` subpath exports) — see section below.
- **`server.ts` OtlpTracer / HttpClient** fix — expected after Effect `4.0.0-beta.78` lands with the merge.

## Fork-file restorations AFTER the bulk `take-upstream.sh` pass

These fork-divergent files get clobbered when `take-upstream.sh` runs on these zones; restore the fork's versions from pre-merge `HEAD` AFTER the bulk pass, BEFORE the rebrand:

- `scripts/build-desktop-artifact.ts` + `scripts/build-desktop-artifact.test.ts` + `scripts/lib/public-config.ts` + `scripts/lib/public-config.test.ts` + `scripts/lib/hosted-web-release-domains.ts` + `scripts/dev-runner.ts` — fork release scripts with nightly-icon props upstream doesn't have.
- `packages/shared/package.json` — re-add the `./branding` and `./relayTracing` subpath exports (the bulk pass takes upstream's version which lacks them).

```bash
git checkout HEAD -- scripts/build-desktop-artifact.ts scripts/build-desktop-artifact.test.ts \
  scripts/lib/public-config.ts scripts/lib/public-config.test.ts \
  scripts/lib/hosted-web-release-domains.ts scripts/dev-runner.ts
# then hand-edit packages/shared/package.json to re-add ./branding + ./relayTracing exports
```

## Expected code fix after merge

**`apps/server/src/server.ts` — `anyUnknownInErrorContext` error.** The Effect `4.0.0-beta.78` bump + the `[codex]` Effect refactor makes `OtlpTracer.layer` require `HttpClient`. Provide `HttpClient` legitimately into `tracerLayer`, or widen the declared return type on `makeRelayClientTracingLayer` in `packages/shared/src/relayTracing.ts`. Do not use `@effect/platform-node` `FetchHttpClient.layer` (returns `any`).

## Suggested resume sequence

Fresh session, starting from this checkpoint:

```bash
git checkout upstream-sync-2026-06-20
git status --short            # must be empty (clean baseline)
git fetch upstream --tags

# 1. start the merge (in-progress, MERGE_HEAD present)
git merge upstream/main --no-edit

# 2. resolve by zone, BEFORE staging (use take-upstream.sh; see the staging-order warning in SKILL.md Step 3)
.agents/skills/upstream-sync/scripts/take-upstream.sh apps/mobile
.agents/skills/upstream-sync/scripts/take-upstream.sh apps/web apps/server apps/desktop \
  packages/client-runtime packages oxlint-plugin .github .github/workflows \
  docs/operations docs/cloud docs/reference scripts vite.config.ts
# infra/relay: take-upstream.sh for structure, then hand-reconcile EnvironmentConnector.ts
# keeping .kataConnectMintCredential() and the @kata-sh/code-relay/ Context.Service key.
.agents/skills/upstream-sync/scripts/take-upstream.sh infra/relay

# 3. restore fork-divergent files clobbered by the bulk pass (see section above)
git checkout HEAD -- scripts/build-desktop-artifact.ts scripts/build-desktop-artifact.test.ts \
  scripts/lib/public-config.ts scripts/lib/public-config.test.ts \
  scripts/lib/hosted-web-release-domains.ts scripts/dev-runner.ts
# hand-edit packages/shared/package.json to re-add ./branding + ./relayTracing exports

# 4. rebrand (must run AFTER any file restoration from upstream, not just once)
node .agents/skills/upstream-sync/scripts/rebrand-fork.ts --apply
node .agents/skills/upstream-sync/scripts/rebrand-fork.ts --check    # gate; must exit 0

# 5. hand-merge pnpm-workspace.yaml (keep oxlint-plugin-kata-code + fork workspace entries + upstream catalog)
#    then regen the lockfile (AFTER the rebrand, so it references @kata-sh/code-* not @t3tools/*)
rm -f pnpm-lock.yaml && vp i

# 6. the one real code fix: apps/server/src/server.ts anyUnknownInErrorContext (see section above)

# 7. verify gates
vp check && vp run typecheck    # both must pass before concluding the merge

# 8. conclude the merge commit
git commit --no-edit
```

Then continue with the runbook's Steps 4-7: vendored repos (Effect was bumped to `4.0.0-beta.78`, so `vp run sync:repos` runs), verify gates (Step 5), post-merge closure via `plan-build-verify` against this branch's closure spec (Step 6 — branding scan evidence, Clerk build-injection verification, OKF Effect conventions synthesis, classifier rule gaps, vendored-repo convergence; the acceptance criteria are in the closure spec), then land + record in FORK.md + OKF (Step 7).

## How to use this as a sub-agent handoff

If delegating the resume to a sub-agent:

- Point it at this doc as the primary instruction, the closure spec for acceptance criteria, and the skill for the full runbook it is executing.
- Pre-load (via the sub-agent's `reads`) `.agents/skills/upstream-sync/SKILL.md`, `docs/specs/2026-06-20-upstream-sync-closure.md`, and this doc.
- The merge is gated: the sub-agent must not land on `main` (Step 7) until `vp check` + `vp run typecheck` pass AND the closure spec's acceptance criteria are met. The `rebrand-fork.ts --check` gate and the verify gates are the real signals.
- The fork-policy resolution rules in SKILL.md Step 3 are non-negotiable (never reintroduce `@t3tools/*` or `T3CODE_*` on product surfaces; keep kata wire identifiers; never push to `upstream`).

## Related

- [closure spec](/specs/2026-06-20-upstream-sync-closure.md) — Approved Decisions 1-10 + 5 closure tasks with acceptance criteria
- [upstream-sync skill](../../.agents/skills/upstream-sync/SKILL.md) — the full runbook
- [upstream-sync guide](/guides/upstream-sync.md) — human-facing mirror
- [FORK.md](../../FORK.md) — baseline, divergence log, identity map
- [ADR 0003 — episodic upstream sync](/adrs/0003-episodic-upstream-sync.md)
