---
type: Plan
title: "2026-06-20 upstream sync — resume handoff"
description: "Handoff and rollback checkpoint for the first episodic upstream sync merge attempt. The branch is clean at a known-good baseline; the durable deliverables (skill, helpers, closure spec) are committed. This doc captures where to resume, what to bake into the helpers before re-running, and the exact sequence. Read this before continuing the sync."
tags: [fork, upstream-sync, handoff, plan]
timestamp: 2026-06-20T00:00:00Z
status: Draft
---

# 2026-06-20 upstream sync — resume handoff

Read this before continuing the upstream sync. It is the rollback target and the handoff contract for whoever (human or sub-agent) picks up the merge next.

Pairs with [the closure spec](/specs/2026-06-20-upstream-sync-closure.md) (the approved Decisions 1-10 + the 5 closure tasks with acceptance criteria) and [the upstream-sync skill](../../.agents/skills/upstream-sync/SKILL.md) (the runbook). This doc is the _where-we-are / resume-from-here_; the closure spec is the _what / acceptance_.

## Rollback target (clean baseline)

```text
branch:        upstream-sync-2026-06-20
handoff HEAD:  5f8f30b4f8b0f3b25d09beccb403baaa43eea8c0
local main:    8f7ae9600fe490430498324cbbaa2d9fb84b54f3   (1 commit ahead of origin)
origin/main:   f5640f62a427605cc300472ada9bbdbb51bedaea
upstream/main: fetched locally; tip may have advanced since the session
FORK.md baseline: 708d5383a9c7415c3795890ca4f664c7b00f9a47
```

To roll back to this checkpoint: `git checkout upstream-sync-2026-06-20 && git reset --hard 5f8f30b4f && git clean -fd`.

**None of the branch's commits are pushed to origin.** Local-only. A sub-agent on the same machine has the baseline; one elsewhere would need the branch shared first (or to re-derive from this doc).

## What is committed and safe (the durable deliverables)

All on `upstream-sync-2026-06-20` at `5f8f30b4f`. The skill, helpers, and spec survived the merge thrash intact.

- **upstream-sync skill** (`.agents/skills/upstream-sync/SKILL.md`): Steps 0-7 runbook with the post-merge closure phase, the Take/Reject/Defer/Review vocabulary, the resolve-before-stage warning, the hard human gate at Step 1, the plan-build-verify reference + install fallback.
- **five helper scripts** (`.agents/skills/upstream-sync/scripts/`):
  - `rules.ts` — classification rules, with the `review` bucket for unclassified commits
  - `classify-upstream.ts` — inventory + classify (produces `sync-plan.md`)
  - `conflict-zones.ts` — predicts conflicts from `git diff` intersection
  - `rebrand-fork.ts` — applies the FORK.md identity table; `--apply` writes, `--check` is the closure gate
  - `take-upstream.sh` — resolves conflicts by taking upstream's side, safe (handles `UU` content + `UD` modify/delete, refuses after staging)
- **closure spec** (`docs/specs/2026-06-20-upstream-sync-closure.md`): Approved. Decisions 1-10 (single bulk merge of all 80 upstream commits, with the [codex] relay + Clerk migration + EAS port + marketing reject as the known hard resolutions) and the five closure tasks each with acceptance criteria.
- **FORK.md divergence log** (committed at `cbe4b46e3`): 2 rejects (marketing `3bdaa6e1`, EAS non-ported portion of `9544e72d`) and the EAS label-gate ported improvement, recorded pre-merge.
- **guide** (`docs/guides/upstream-sync.md`): mirrors the skill.

Verify the baseline is healthy before resuming:

```bash
vp check                                                  # passes (0 errors, 27 pre-existing warnings)
python3 ~/.agents/skills/skill-creator/scripts/quick_validate.py .agents/skills/upstream-sync   # "Skill is valid!"
node .agents/skills/upstream-sync/scripts/classify-upstream.ts 2>&1 | grep "Draft classification"  # runs
```

## What is NOT done

**The actual merge of the 80 upstream commits was never committed.** It was content-resolved to 0 conflict markers and 0 unmerged entries at one point, but the merge commit was never made before git-state thrash (a SIGPIPE-truncated first attempt, an index-lock race, then a stash/restore chain) destroyed the in-progress merge state. Rather than carry the thrash forward, the branch was hard-reset to clean baseline `5f8f30b4f`.

This is recoverable. The committed helpers make re-doing the merge substantially faster and safer than the manual grind: `take-upstream.sh` handles the bulk zones deterministically, `rebrand-fork.ts` handles branding, and the whole flow is documented in the skill's Step 3. Most of the original session's time was spent on diagnosis and helper-building, not on the resolution itself — that work is now captured.

## Last-mile work to bake into `rebrand-fork.ts` BEFORE the next merge run

These were diagnosed/implemented in-session but lost to the thrash because they were working-tree-only enhancements that never got committed. They are helper improvements (deterministic rules, not merge work) and should be added to `rebrand-fork.ts` first, then committed, then the merge run.

1. **`PROPERTY_PATTERNS` block** in `rebrand-fork.ts`, wired into `applyToContent()` after `ENV_PREFIX_PATTERN`. Word-boundary regexes the plain-string `IDENTITY_RENAMES` rules cannot safely handle:
   - `\bt3Home\b` -> `katacodeHome` (state-dir config property; ~6 occurrences)
   - `t3-env:` -> `kata-env:` (JWT issuer prefix; ~16 occurrences)
   - `~/\.t3\b` -> `~/.katacode` (state-dir literal; anchored to leading `~` so `something.t3` is not matched)

2. **Two more `IDENTITY_RENAMES` entries** (exact-match string renames):
   - `"t3/` -> `"@kata-sh/code-cli/` (apps/server `Context.Service` deterministic-key prefix, ~56 occurrences; fork's server package is `@kata-sh/code-cli`)
   - `"t3code-relay/` -> `"@kata-sh/code-relay/` (infra/relay `Context.Service` keys, ~23 occurrences)

3. **OTel brand fixes in source** (these are real brand regressions upstream reintroduces; add as rebrand rules or hand-fix):
   - `packages/shared/src/relayTracing.ts`: `"t3.client.surface"` -> `"kata.client.surface"` (attribute key)
   - `apps/server/src/cloud/relayTracing.ts`: `"t3-headless-relay-client"` -> `"kata-headless-relay-client"`, `"t3-server"` -> `"kata-server"` (service names)

4. **`devRemote` property name normalization** (hand-fix in `apps/desktop`, not a rebrand rule — a real callsite mismatch): upstream's clerk migration and the fork's `DesktopEnvironment` type disagree on `devRemoteServerEntryPath` vs `devRemoteT3ServerEntryPath`. The fork's canonical name is `devRemoteServerEntryPath` (env var is `KATACODE_DEV_REMOTE_SERVER_ENTRY_PATH`); normalize all `apps/desktop` callsites to `devRemoteServerEntryPath`.

## Fork-file restorations AFTER the bulk `take-upstream.sh` pass

These fork-divergent files get clobbered when `take-upstream.sh` runs on these zones; restore the fork's versions from `HEAD` (`5f8f30b4f`) AFTER the bulk pass, BEFORE the rebrand:

- `scripts/build-desktop-artifact.ts` + `scripts/build-desktop-artifact.test.ts` + `scripts/lib/public-config.ts` + `scripts/lib/public-config.test.ts` + `scripts/lib/hosted-web-release-domains.ts` + `scripts/dev-runner.ts` — fork release scripts with nightly-icon props upstream doesn't have.
- `packages/shared/package.json` — re-add the `./branding` and `./relayTracing` subpath exports (the bulk pass takes upstream's version which lacks them).

```bash
git checkout HEAD -- scripts/build-desktop-artifact.ts scripts/build-desktop-artifact.test.ts \
  scripts/lib/public-config.ts scripts/lib/public-config.test.ts \
  scripts/lib/hosted-web-release-domains.ts scripts/dev-runner.ts
# then hand-edit packages/shared/package.json to re-add ./branding + ./relayTracing exports
```

## The one real code fix (beyond rebrand)

**`apps/server/src/server.ts:481/494` — `anyUnknownInErrorContext` error.** Diagnosed, NOT fixed in the lost session. Root cause: the Effect `4.0.0-beta.78` bump + the `[codex]` Effect refactor made `OtlpTracer.layer` return `Layer<never, never, OtlpSerialization | HttpClient.HttpClient>` (now also requires `HttpClient`). The fork's `makeRelayClientTracingLayer` in `packages/shared/src/relayTracing.ts` only provides `OtlpSerialization`, leaking `unknown` into the composing layer in `server.ts`.

- The pre-merge HEAD (`5f8f30b4f`) does NOT have this error — the Effect bump + refactor introduced it.
- Tried providing `FetchHttpClient.layer` from `@effect/platform-node` into `tracerLayer` — wrong, returns `any`. Do not repeat.
- Correct fix: provide HttpClient legitimately into `tracerLayer` (not via the `any`-typed `@effect/platform-node` FetchHttpClient), OR widen the declared `Layer.Layer<never, never, HttpClient.HttpClient>` return type on `makeRelayClientTracingLayer` to match the inferred requirements.

This is the only typecheck failure a fresh merge run should hit. Everything else should resolve via rebrand + the restorations above.

## Suggested resume sequence

Fresh session, starting from this checkpoint:

```bash
git checkout upstream-sync-2026-06-20
git status --short            # must be empty (clean baseline)
git fetch upstream --tags

# 0. (helper prep) bake the PROPERTY_PATTERNS + the "t3/ and "t3code-relay/ IDENTITY_RENAMES
#    + the OTel brand rules into .agents/skills/upstream-sync/scripts/rebrand-fork.ts.
#    Commit the helper enhancement on the clean baseline BEFORE the merge.

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
