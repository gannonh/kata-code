# OKF bundle log

## 2026-07-01 (Cursor filesystem skills + invocation — OKF update)

Recorded the `feat/cursor-skills` feature across the bundle after the simplify and strict-quality-review passes. Added a [Cursor provider guide](/providers/cursor.md) (early access: Cursor Agent CLI over ACP, settings reference, API-key auth via `CURSOR_API_KEY`, and a Provider skills section covering discovery dirs, `$skillname` / path-qualified `$skill:name:hash` tokens, and server-side `<skill>` block prompt expansion). Added a [Provider skills](/architecture/providers.md#provider-skills) section to the [provider architecture](/architecture/providers.md) (shared `@kata-sh/code-shared/providerSkills` token model, FNV-1a path hash, `filesystemSkills.ts` discovery, Cursor-adapter prompt expansion, cross-provider-compatible scan dirs) plus a code-map row. Added the Cursor row to the [providers index](/providers/index.md) and a Completed row to the [specs roadmap](/specs/index.md). Corrected the [E2E test catalog](/guides/e2e-test-catalog.md#cursor-e2e-gates) Cursor gates to include the required `KATACODE_E2E_CURSOR_API_KEY` env var (the `@cursor` flow authenticates via API key). Logged in [specs log](/specs/log.md), [architecture log](/architecture/log.md), [providers log](/providers/log.md), and [guides log](/guides/log.md). Validation: `vp run check:okf`.

## 2026-06-29 (Environments / Deployments Phase 1 — Part B built, strict-quality-review OKF update)

Updated the OKF bundle after the strict-quality-review fix pass on `feat/kata-cloud`. Flipped the [Phase 1 deep-dive](/specs/2026-06-27-kata-environments-deployments-phase-1-design.md) from Draft (blocked) to **Implemented** and appended a [Build completion report](/specs/2026-06-27-kata-environments-deployments-phase-1-design.md#build-completion-report-2026-06-29) recording the delivered sandbox packages, the review fix pass (driver-routing, idempotency, fail-loud, `req.image` contract, dispose logging, settings UI `withBusy` dedupe, release-smoke manifest fix), deferred work filed ([#18](https://github.com/gannonh/kata-code/issues/18), [#19](https://github.com/gannonh/kata-code/issues/19)), and verification (`vp run typecheck` / `vp check` / `vp run test` / `vp run release:smoke` all green). Updated the [specs roadmap](/specs/index.md) Environments/Deployments row and the [deferred-work registry](/specs/deferred-work.md). A dedicated architecture note for the sandbox SPI / deployment-target layer is not yet in `docs/architecture/` (future OKF pass). Updated [specs log](/specs/log.md). Validation: `vp run check:okf`.

## 2026-06-28 (Pi provider — spec closed, roadmap consolidated to index)

Corrected the prior pass's roadmap duplication. Marked the [Pi spec](/specs/2026-06-25-pi-coding-agent-support-design.md) `status: Verified` and removed its inline "Resume here — what's next" block so the spec reads as a closed record (evidence stays in the Build completion report and Finalize outcome). Removed the duplicate [Roadmap — what's next for Pi](/providers/pi.md) section from the provider guide. Established [docs/specs/index.md](/specs/index.md) as the single roadmap source of truth and new-session entry point: the Pi Completed row now states Verified and points deferred follow-ups at the [deferred-work registry](/specs/deferred-work.md), where compaction UI ([#16](https://github.com/gannonh/kata-code/issues/16)) and strict-review polish ([#14](https://github.com/gannonh/kata-code/issues/14)) remain captured with tracking-issue links. Validation: `vp run check:okf` pass.

## 2026-06-27 (Pi provider — roadmap consolidation + issue capture)

Made "what's next for Pi" answerable from one place. Added a [Roadmap — what's next for Pi](/providers/pi.md#roadmap--whats-next-for-pi) section to the provider guide: spec complete (17/17 ACs verified), next increments in priority order are compaction UI ([#16](https://github.com/gannonh/kata-code/issues/16)) then strict-review polish ([#14](https://github.com/gannonh/kata-code/issues/14)). Filed the previously-unfiled compaction deferral as GitHub issue #16 (created the `deferred` label) and added a branch-correction comment to #14 (carried into `feat/pi-phase2`). Wired tracking-issue links into both [deferred-work](/specs/deferred-work.md) entries, the spec [Known follow-ups](/specs/2026-06-25-pi-coding-agent-support-design.md#known-follow-ups), and the [specs roadmap](/specs/index.md) Pi row. Validation: `vp run check:okf` pass.

## 2026-06-27 (Pi provider — AC 15 reclassification correction)

Corrected a stale, self-contradictory classification left by the prior finalize OKF pass (`428bacf48`): **AC 15** was marked "Outstanding"/"deferred" while the credentialed `@pi` E2E and verify-evidence screenshots already covered every AC 15 surface. Verified coverage against `e2e/tests/agent/pi-smoke.spec.ts`, `e2e/tests/settings/pi-provider.spec.ts`, and [`e2e/verify-evidence/README.md`](../../e2e/verify-evidence/README.md), then reclassified AC 15 as **Implemented and verified** in the [Pi spec](/specs/2026-06-25-pi-coding-agent-support-design.md) (acceptance status, build/finalize outcomes), [specs roadmap](/specs/index.md), and [Pi provider guide](/providers/pi.md). Removed the "Pi provider manual-authenticated validation (AC 15)" [deferred-work](/specs/deferred-work.md) entry as resolved; kept the compaction transport + UI and strict-quality-review (issue #14) entries. Validation: `vp run check:okf` pass.

## 2026-06-27 (Pi provider — Finalize: simplify, strict-quality-review, OKF update)

Finalized `feat/pi-phase2` after simplify (`fc240c85c`) and strict-quality-review (`f8c2b5f5f`) passes (head `f8c2b5f5f`). Appended a [Finalize outcome](/specs/2026-06-25-pi-coding-agent-support-design.md#finalize-outcome) to the Pi spec (credentialed `@pi` E2E + [`e2e/verify-evidence/`](../../e2e/verify-evidence/README.md) walkthrough screenshots, amber `runtime.warning` timeline UX, E2E harness per-file session + cleanup scripts, `piRuntimeWarning` helper). Moved the Pi roadmap row from Active to [Completed](/specs/index.md#completed) with links to the finalize outcome, [Pi provider guide](/providers/pi.md), and verification evidence. Updated [E2E test catalog](/guides/e2e-test-catalog.md) (session model, Pi gates, `e2e:clean`). Refreshed [deferred-work](/specs/deferred-work.md#pi-provider-strict-quality-review-follow-ups) strict-review notes. Superseded stale "Remaining acceptance work" in the spec [Build progress](/specs/2026-06-25-pi-coding-agent-support-design.md#build-progress) section. Validation: `validate_okf.py` pass, `vp run check:okf` pass.

## 2026-06-27 (Pi provider — full adapter parity Build complete)

Completed the Pi coding-agent provider Build on `feat/pi-phase2` (base `7bfe7d769`, head `3fbeb0209`): tool lifecycle events, image attachments, resume cursor, `readThread`, `rollbackThread`, `compactThread` (canonical `thread.state.changed` compaction lifecycle), extension UI bridge (`select`/`confirm`/`input`/`notify`/status/progress + one-warning-per-TUI-only-method), runtime-mode warnings for unenforceable modes, project-trust surfacing, and real `PiTextGeneration` parity for all four git operations. Added a provider compact contract (`ProviderCompactThreadInput`, `ProviderAdapterShape.compactThread`, `ProviderService.compactConversation`) with typed `thread/compact` stubs in all six adapters. New modules: `piToolLifecycle.ts`, `piThreadHistory.ts`, `piExtensionUi.ts`, `PiDriver.test.ts`, `PiTextGeneration.test.ts`. Flipped the [Pi spec](/specs/2026-06-25-pi-coding-agent-support-design.md) status Approved → Implemented with a [Build completion report](/specs/2026-06-25-pi-coding-agent-support-design.md#build-completion-report); updated the [specs roadmap](/specs/index.md) Pi entry to Implemented. Closed the [Pi provider full adapter parity](/specs/deferred-work.md#pi-provider-full-adapter-parity) deferred-work entry and added two new entries ([AC 15 manual validation](/specs/deferred-work.md#pi-provider-manual-authenticated-validation-ac-15), [compaction transport + UI](/specs/deferred-work.md#pi-compaction-transport-and-ui-surface)). Verification: 111 Pi-suite tests pass, `vp run typecheck` 0 errors, `vp run test` repo-green, `vp run release:smoke` passed. AC 15 manual Pi-authenticated validation remains outstanding. Updated [specs log](/specs/log.md).

## 2026-06-26 (E2E web test authentication + Pi provider locator fix)

Updated the [E2E test catalog](/guides/e2e-test-catalog.md) web section: the `web-dev` Playwright project now uses a [`webSetup.ts`](../../e2e/src/harness/webSetup.ts) fixture that starts the dev server, captures the `pairingUrl` from stdout, and authenticates via the pairing URL auto-submit flow. The template test verifies the authenticated app shell. Fixed the Pi provider settings E2E test radio locator to match the "Pi Early Access" accessible name. Updated [specs log](/specs/log.md) and [guides log](/guides/log.md).

## 2026-06-26 (Pi provider — strict quality review fixes + vertical slice doc sweep)

Recorded the Pi coding-agent provider vertical slice across the bundle. Flipped the [specs roadmap](/specs/index.md) Pi entry from Draft to In progress and appended the post-slice [build progress](/specs/2026-06-25-pi-coding-agent-support-design.md#build-progress) (pi.dev logo, provider ordering, Early Access badge, model-switch session restart, error-banner layout, credentialed `@pi` e2e green). Added a [Pi provider full adapter parity](/specs/deferred-work.md#pi-provider-full-adapter-parity) deferred-work entry. Documented the provider end-to-end: new [Pi provider guide](/providers/pi.md), [providers index](/providers/index.md) row, and the `pi` driver in [provider architecture](/architecture/providers.md), [architecture overview](/architecture/overview.md), and [architecture index](/architecture/index.md). Logged in [specs log](/specs/log.md), [architecture log](/architecture/log.md), and [providers log](/providers/log.md).

## 2026-06-25 (mobile E2E — Verify outcome: pairing + agent green)

Recorded the on-device Verify outcome for the mobile E2E suite (iPhone 17 Pro). `@smoke`, `@pairing`, and `@agent` now pass on the Simulator via Maestro Studio; `@auth` (native `NativeClerk.presentAuth` modal) and the AC-4 distinct-ports clause remain open. Captured durable learnings: the `connection-status` accessibility-id test contract on `ConnectionStatusDot`, the `shared/` subflow pattern (excluded from discovery), and model-picker label derivation in `flows/agent.ts` (provider→`Codex`/`Claude`, slug→display label). Added a [Verify outcome](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md#verify-outcome-2026-06-25) section to the design spec, updated the [specs roadmap](/specs/index.md), refreshed the [mobile-e2e-test-author skill](../.agents/skills/mobile-e2e-test-author/SKILL.md), and logged in [specs log](/specs/log.md).

## 2026-06-25 (mobile E2E Maestro Studio authoring guide)

Added [Mobile E2E authoring (Maestro Studio)](/guides/e2e-mobile-authoring-maestro-studio.md) as the canonical OKF guide for Maestro Studio workflow, locator conventions, and flow authoring. Cross-linked from guides index, E2E test catalog, mobile local dev guide, mobile E2E design spec, `mobile-e2e/README.md`, and the mobile-e2e-test-author skill. Updated [guides log](/guides/log.md).

## 2026-06-24 (mobile E2E — harness fixes, guide corrections, smoke test passing)

Fixed three harness bugs and corrected all guide/spec command syntax after live UAT revealed the suite couldn't run as documented.

- **Server bin path bug:** `resolveMobileE2eRoot()` returned `mobile-e2e/` but was passed as `repoRoot` to `requirePrereqs`, so the server bin check looked for `mobile-e2e/apps/server/dist/bin.mjs` (wrong). Added `resolveRepoRoot()` in `artifacts.ts` and used it in `run.ts`.
- **Maestro flow discovery:** `maestro test` with a directory doesn't recurse subdirectories. Changed `MaestroRunOptions.flowPath` to `flowPaths: readonly string[]` and added `resolveFlowPaths()` in `run.ts` to pass individual flow file paths filtered by tag.
- **Smoke flow locator:** `clearState: true` launched the Expo Dev Launcher (server picker) instead of the app. Changed to `clearState: false` and asserted on "Kata Code" (app header, always visible). Added `extendedWaitUntil` with 90s timeout for Metro bundle loading.
- **Command syntax:** Removed `-- --` arg-passing from all `vp run e2e:mobile` commands in guides, specs, README, and skill (vp run passes args directly).
- **Guide fixes:** `katacode serve` prose replaced with `node apps/server/dist/bin.mjs`; e2e commands annotated as repo-root; mapping table uses `--filter` form for mobile package scripts.
- Smoke test verified: 1/1 Flow Passed in 4s on iPhone 17 Pro, JUnit report 0 failures.
- Updated [guides log](/guides/log.md) and [specs log](/specs/log.md).

## 2026-06-24 (mobile E2E — dev guide cross-links + spec reciprocal links)

Connected the [mobile local dev guide](/guides/mobile-local-dev-ios-simulator.md) to the [mobile E2E testing foundation](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md) with bidirectional OKF cross-links so the relationship between the manual dev loop and the automated suite is traversable.

- [Mobile local dev guide](/guides/mobile-local-dev-ios-simulator.md): added "Automated E2E" section mapping the three manual terminals (server, Metro, build) to what the harness automates vs checks; expanded "Related docs" with the design spec and operator reference.
- [Mobile E2E design spec](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md): added "Related docs" section with reciprocal links to the dev guide, operator reference, authoring skill, Electron E2E foundation, and mobile local dev slice design.
- Updated [guides log](/guides/log.md) and [specs log](/specs/log.md).

## 2026-06-24 (upstream sync docs reconciliation — ADR 0004)

Reconciled the OKF bundle and [FORK.md](../../FORK.md) to the accepted [ADR 0004 — Selective vendor-pull](/adrs/0004-selective-vendor-pull.md), after the first episodic bulk-merge attempt ([ADR 0003](/adrs/0003-episodic-upstream-sync.md), branch `upstream-sync-2026-06-20`) stalled without landing.

- [ADR index](/adrs/index.md): ADR 0004 promoted to Accepted; ADR 0003 moved to Superseded.
- Retired the ADR 0003 specs — [closure spec](/specs/2026-06-20-upstream-sync-closure.md) and [resume handoff](/specs/2026-06-20-upstream-sync-handoff.md) marked Superseded; [strategy analysis](/specs/2026-06-21-upstream-sync-strategy-analysis.md) (Option D) marked Accepted as ADR 0004's rationale.
- [specs roadmap](/specs/index.md) Active item → "Upstream sync (first scan)"; bundle [index](/index.md) fork-status summary updated to vendor-pull.
- [FORK.md](../../FORK.md): "Last upstream sync" → "Last upstream scan" block; Phase 3 runbook rewritten for vendor-pull; post-port checklist; Watched clusters (Effect migration) + Ported changes log; agent instructions point at ADR 0004.
- Docs-only change. Next action (separate): re-add the local `upstream` remote and run the first scan (Step 0 of the [guide](/guides/upstream-sync.md)).

## 2026-06-23 (mobile local dev slice — OKF update for PR #9)

- Updated [build completion report](/specs/2026-06-22-mobile-local-dev-slice-build-report.md) with all post-build hardening: kanji brand rebrand (icon composer JSON, rasters, `generate-prod-brand-rasters.mjs`), splash screen gate (`splashScreen.ts`, `_layout.tsx`, cache-clearing script), iOS widget build-settings plugin (`withIosWidgetTargetBuildSettings.cjs`), Metro resolver fix, and PR #9 review fixes (5 comments from CodeRabbit, Greptile, Codex — all resolved).
- Added `PRODUCT_ABBREVIATION = "KC"` to [branding.ts](../../packages/shared/src/branding.ts); replaced hardcoded "KC" in `AgentActivity.tsx`.
- Added mobile local dev slice to [specs roadmap](/specs/index.md) Completed section.
- Updated [mobile local dev guide](/guides/mobile-local-dev-ios-simulator.md) to document cache-clearing script and env var scoping in `ios:dev`.

## 2026-06-21 (local Electron E2E — implementation verification)

- Updated [Local Electron E2E testing foundation design](/specs/2026-06-21-e2e-testing-foundation-design.md): implementation notes (Clerk ticket auth, hash navigation, model picker, toast dismissal, Vite-only dev launch), corrected starter-test scope (`@smoke` = app shell only), and build completion report with headed verification evidence for `@smoke`, `@settings`, and `@agent`.
- Refreshed [specs roadmap](/specs/index.md) completed row with e2e-test-author skill link and verification note.
- Added deferred-work entries for CI E2E gating and release-target validation from the E2E spec.

## 2026-06-21 (local Electron E2E testing foundation design)

- Added [Local Electron E2E testing foundation design](/specs/2026-06-21-e2e-testing-foundation-design.md): local-only Playwright Electron suite, dev/release launch targets, real Clerk/LLM services, isolation, seeding, deterministic agent helper, starter tests, reporting, and reusable harness boundaries.
- Added the draft to [specs roadmap](/specs/index.md) under Active / next.

## 2026-06-21 (upstream-sync branch OKF finalize — pre-merge)

Documented finalized pre-merge state on `upstream-sync-2026-06-20` after simplify and strict-quality-review passes.

- Updated [closure spec](/specs/2026-06-20-upstream-sync-closure.md) **Current state** and added [branch progress table](/specs/2026-06-20-upstream-sync-closure.md#branch-progress-pre-merge-landed-on-integration-branch): helpers, rebrand rules, classifier `review` bucket, hard-fork branding drop, and desktop dev fixes are landed; bulk merge and post-merge closure Tasks 2, 3, 5 remain blocked.
- Recorded Closure Task 4 pre-merge audit (no additional classifier rules beyond `review` bucket).
- Refreshed [resume handoff](/specs/2026-06-20-upstream-sync-handoff.md) to `774da08bc`; marked last-mile `rebrand-fork.ts` work as committed; fixed resume sequence.
- Updated [fork-setup spec](/specs/fork-setup.md) and [bundle index](/index.md): Phase 2 merged; first upstream sync active on integration branch.
- Fixed OTLP default service name in [observability runbook](/operations/observability.md) (`kata-server`, matching source).

**Intentionally unchanged:** FORK.md "Last upstream sync" block (merge not landed). Closure Task 3 (Effect conventions OKF synthesis) — blocked until `.macroscope/check-run-agents/effect-service-conventions.md` arrives with the bulk merge.

## 2026-06-20 (upstream-sync skill: rerun audit fixes)

Reran the updated skill from Step 0 against the real 80-commit diff as if for the first time; fixed seven gaps the rerun surfaced.

- **Classifier vocabulary end-to-end:** added `review` to `rules.ts` `Classification` type. The "no rule matched" and "conflicting take+reject" cases now emit `review` instead of `defer`, so the script output (four buckets) matches the runbook vocabulary. Validated against the real diff: 63 take / 2 reject / 11 defer / 4 review (was 63/2/15/0 — the 4 mis-bucketed defers were the unrelated mobile/ssh/TTL/typography commits, not project-phase deferrals). Breaks the prior circularity where the fix was scoped to "closure work" during the very sync that needed it pre-merge.
- **Step 1 hard human gate:** made the classification checkpoint an explicit pause for agent-driven execution ("present to human, do not auto-proceed to Step 3").
- **Step 1 decisions-where:** documented that Rejects go to FORK.md (pre-merge), take+defer plans go to a scratch note carried into the Step 6 closure spec, and new deferrals go to `docs/specs/deferred-work.md`. Resolves the Step-3-make / Step-6-record tension.
- **Step 0 resume path:** resume branch now re-fetches upstream (`git fetch upstream --tags`) so a resumed sync sees commits landed since the pause.
- **Step 6 trivial bar:** "trivial sync may skip closure" now has a concrete test (zero `@t3tools` regressions, zero new build constants/env, zero absorbed upstream-internal docs).
- **Cherry-pick path:** now follows clean-main-first discipline and runs the same Step 6 closure check under the same concrete trivial bar.
- Mirrored all fixes in [docs/guides/upstream-sync.md](/guides/upstream-sync.md).

## 2026-06-20 (upstream-sync skill: post-merge closure phase + vocabulary fix)

- Added **Step 6 — Post-merge closure** to the [upstream-sync skill](../../.agents/skills/upstream-sync/SKILL.md) and [guide](/guides/upstream-sync.md): a sync-scoped follow-up phase (branding re-application, build-injection verification, OKF integration of absorbed internal docs, classifier rule updates, vendored-repo follow-up) that lands on the integration branch before it merges to `main`. Routed through the `plan-build-verify` skill, producing a `docs/specs/YYYY-MM-DD-upstream-sync-closure.md` spec with acceptance criteria. Old Step 6 (land) renumbered to Step 7, gated on closure completion.
- Added `plan-build-verify` install fallback (`npx skills add https://github.com/gannonh/skills --skill plan-build-verify -y`) for environments missing the skill.
- Fixed the classification vocabulary in the runbook: split the single `defer` into `Take` / `Reject` / `Defer` (project-phase-tied, cross-sync, see [deferred-work registry](/specs/deferred-work.md)) / `Review` (unclassified, pending human verdict). Documented that `rules.ts` still emits only `take|cherry-pick|reject|defer`; aligning the code's `Classification` type with this vocabulary is tracked closure work for the 2026-06-20 sync.
- Gitignored `sync-plan.md` / `conflict-zones.md` (script scratch artifacts) at the repo root so they no longer pollute `git status` or trip `vp check`.

## 2026-06-20 (upstream-sync scripts moved into the skill)

- Moved the three upstream-sync helper scripts from `scripts/upstream-sync/` into the skill bundle at `.agents/skills/upstream-sync/scripts/` (`rules.ts`, `classify-upstream.ts`, `conflict-zones.ts`) so the skill is self-contained and portable, matching how other tracked skills (babysit-pr, fix-github-ci, okf) bundle their scripts.
- Updated [upstream-sync guide](/guides/upstream-sync.md) and [`.agents/skills/upstream-sync/SKILL.md`](../../.agents/skills/upstream-sync/SKILL.md) command examples and references to point at the new in-skill paths.
- Scripts no longer typecheck under `vp run typecheck` (they left the `@kata-sh/code-scripts` workspace); they remain linted by `vp check`. Run via `node .agents/skills/upstream-sync/scripts/<name>.ts` from the repo root.

## 2026-06-20 (upstream-sync runbook + skill + classifier scripts)

- Rewrote [upstream-sync guide](/guides/upstream-sync.md) as the canonical selective-sync runbook: bulk-merge default, integrated inventory+classify and conflict-zone scripts, fork-policy resolution rules, verify gates, land+record steps.
- Added `.agents/skills/upstream-sync/SKILL.md` — the agent-facing runbook that IS the sync process (mirrors the guide, points at the scripts and ADRs). Helper scripts are bundled inside the skill at `.agents/skills/upstream-sync/scripts/`:
  - `rules.ts` — Take/Cherry-pick/Reject/Defer classification rules (source of truth the classifier runs against).
  - `classify-upstream.ts` — inventories upstream commits since baseline and emits a draft classification table.
  - `conflict-zones.ts` — intersects upstream-changed and fork-changed paths with the FORK.md high-conflict zone catalog; zone-level rollup.
- Validated against the real 80-commit upstream diff since baseline `708d5383`: 63 take / 2 reject / 15 defer; conflict-zones predicts 649 intersecting paths (450 in high-blast zones, heaviest in apps/server and apps/web).
- Did **not** perform the merge in this change; scripts are read-only runbook tooling. Baseline in [FORK.md](../../FORK.md) unchanged.

## 2026-06-19 (stable v0.0.29 released + full UAT pass)

- Stable `v0.0.29` released ([run 27854360066](https://github.com/gannonh/kata-code/actions/runs/27854360066)); `@kata-sh/code-cli@0.0.29` published to npm.
- Full UAT passed on stable (`app.kata.sh`): chat completion, Files panel, Connect sign-in, relay link/tunnel, network access toggle, manual environment add via `npx @kata-sh/code-cli serve`.
- Deferred: Connect stale relay link on account switch; Connect open signups (waitlist off). See [deferred work registry](/specs/deferred-work.md).

## 2026-06-19 (Relay Deploy completed + Nightly UAT)

- Marked [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) **Completed**: production relay deployed ([run 27798366259](https://github.com/gannonh/kata-code/actions/runs/27798366259)), Nightly runtime regressions fixed, Connect UAT passed.
- Moved Phase 2 infra split to **Completed** on [specs roadmap](/specs/index.md); updated Active to upstream sync planning.
- Closed "Production Relay Deploy" deferred item; added "Connect: stale relay link on account switch" deferred item to [deferred work registry](/specs/deferred-work.md).
- Documented relay deploy and Connect polish commits: `11c8a75c6` (fff native asar fix), `628d982de` (rejected cloud session recovery), `1cfb69697` (x64 cross-arch native bindings).

## 2026-06-18 (Relay Deploy infra setup)

- Documented one-time Alchemy Cloudflare bootstrap, credential smoke validation, and `CLOUDFLARE_ACCOUNT_ID` verification in [Relay deploy setup](/operations/relay-deploy-setup.md) and [Relay credentials playbook](/guides/relay-credentials-playbook.md).
- Updated [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) build handoff with credential smoke + local dry-run progress; [specs roadmap](/specs/index.md) links [PR #4](https://github.com/gannonh/kata-code/pull/4).

## 2026-06-18 (Relay Deploy design)

- Added [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) and updated [specs roadmap](/specs/index.md) plus [deferred work registry](/specs/deferred-work.md).

## 2026-06-18 (deferred work registry)

- Added [deferred work registry](/specs/deferred-work.md) and roadmap links so spec out-of-scope items have a durable review queue.
- Updated [AGENTS.md](../../AGENTS.md) with deferred-work maintenance guidance.

## 2026-06-17 (episodic upstream sync)

- Added [ADR 0003 — Episodic upstream sync](/adrs/0003-episodic-upstream-sync.md) and [upstream sync guide](/guides/upstream-sync.md).
- Updated [FORK.md — Phase 3](../../FORK.md#phase-3--upstream-sync-runbook), [fork-setup spec](/specs/fork-setup.md), and [specs roadmap](/specs/index.md).

## 2026-06-17 (Kata brand icons + desktop packaging)

- Shipped Kata kanji icons across web, server, mobile, and desktop releases; removed upstream blueprint/T3 artwork from dev and nightly channels ([FORK.md — brand marks](../../FORK.md#brand-logo-marks), `scripts/lib/brand-assets.ts`).
- Desktop releases use `apps/desktop/resources/` assets, macOS Liquid Glass `Assets.car`, and `scripts/electron-after-pack.cjs` (`afterPack` path must be relative to `apps/desktop`).
- [Release runbook](/operations/release.md): nightly rerun after `afterPack` path fix (`19f05374d`).

## 2026-06-17 (Phase 2 pre-merge)

- Finalized OKF and [AGENTS.md](../../AGENTS.md) for [PR #2](https://github.com/gannonh/kata-code/pull/2): active [release workflow](../../.github/workflows/release.yml), `app.kata.sh` hosted web, branch-protection guidance in [CI runbook](/operations/ci.md).
- Documented `apps/web/vercel.ts` compile-time branding constants (must stay in sync with [branding.ts](../../packages/shared/src/branding.ts)).
- Post-merge operator steps: merge PR #2, configure branch protection, run `release.yml` `dry_run`, then nightly test release.

## 2026-06-17

- Added [diagrams](/diagrams/index.md) section with interactive [hosted web & remote stack](/diagrams/hosted-remote-stack.html) map (`app.kata.sh`, `katacode serve`, Connect vs manual pairing).
- Updated bundle [index](/index.md) and [architecture index](/architecture/index.md) cross-links.
- Rewrote [provider architecture](/architecture/providers.md) for multi-driver server design (no longer Codex-only).
- Updated [architecture overview](/architecture/overview.md) for provider-agnostic stack diagram and turn flow.

## 2026-06-16 (Phase 1 CI)

- Documented Phase 1 PR [#1](https://github.com/gannonh/kata-code/pull/1) CI green and review hardening in [fork-setup spec](/specs/fork-setup.md).
- Expanded [CI runbook](/operations/ci.md) with active vs disabled workflows and fork rebrand test-fixture guidance.
- Updated [specs roadmap](/specs/index.md): Phase 1 PR & CI complete; Phase 2 next.
- Refreshed [ADR 0002](/adrs/0002-katacode-product-identity.md) consequences (migration warning, hosted pairing, disabled release workflows).

## 2026-06-16

- Initialized OKF v0.1 bundle at `./docs`.
- Created required sections: `specs/`, `adrs/`, root `index.md` and `log.md`.
- Moved `.plans/` → `docs/specs/plans/` and `docs/project/todo.md` → `docs/specs/product-backlog.md`.
- Added section indexes for `architecture/`, `guides/`, `runbooks/`, `reference/`, `cloud/`, `providers/`, `integrations/`.
- Seeded ADRs for connected-fork strategy and Kata Code product identity.
- Added OKF frontmatter to existing concept documents.
- Updated [AGENTS.md](../../AGENTS.md) with OKF consumption and maintenance instructions.
