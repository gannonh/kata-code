# Specs log

## 2026-07-01 (Cursor filesystem skills + invocation — roadmap entry)

- Added a Completed row to the [specs roadmap](/specs/index.md) for the `feat/cursor-skills` feature: filesystem skill discovery (`.cursor`/`.agents`/`.claude`/`.codex` skills, project + user scope, first-match-wins), shared `@kata-sh/code-shared/providerSkills` token model (regex, FNV-1a path hash, `makeProviderSkillInvocationToken`/`isPathQualifiedProviderSkillToken`), path-qualified `$skill:name:hash` Composer tokens, server-side `<skill>` block prompt expansion wired into the Cursor adapter, Cursor API-key auth (`CURSOR_API_KEY`, skips ACP `authenticate`), and credentialed `@cursor` E2E. Links to the [Cursor provider guide](/providers/cursor.md#provider-skills), [provider architecture — Provider skills](/architecture/providers.md#provider-skills), and [E2E test catalog — Cursor gates](/guides/e2e-test-catalog.md#cursor-e2e-gates). No design spec was authored for this feature; durable technical knowledge lives in the architecture note and provider guide.

## 2026-06-29 (Environments / Deployments Phase 1 — Part B built, strict-quality-review fixes)

- Flipped the [Phase 1 deep-dive](/specs/2026-06-27-kata-environments-deployments-phase-1-design.md) status from Draft (blocked) to **Implemented** (frontmatter + `## Status`): Part A foundations approved and frozen, Part B container driver + Settings UI + `@environments-deploy` e2e built. Resolved the three Part B open questions in the status text (one `docker` kind; `validate` pulls a missing image; relay managed endpoint fronts loopback, no per-container tunnel).
- Appended a [Build completion report](/specs/2026-06-27-kata-environments-deployments-phase-1-design.md#build-completion-report-2026-06-29) covering delivered packages, the strict-quality-review fix pass (`b3b7f25bc` / `8af7d6bf9` / `5fa629c89`), deferred work filed ([#18](https://github.com/gannonh/kata-code/issues/18), [#19](https://github.com/gannonh/kata-code/issues/19)), and verification results.
- Updated the [specs roadmap](/specs/index.md) Environments/Deployments row to Implemented with a link to the build completion report.
- Recorded the two sandbox deferred-work items in the [deferred-work registry](/specs/deferred-work.md): reclaim orphaned containers on server restart, share the Docker config schema between web UI and driver.

## 2026-06-28 (Pi coding agent provider — spec closed as Verified)

- Marked the [Pi spec](/specs/2026-06-25-pi-coding-agent-support-design.md) `status: Verified` (frontmatter + `## Status`) and removed the inline "Resume here — what's next" roadmap block added the prior day. The spec is now a closed record; the Build completion report and Finalize outcome remain as evidence.
- [docs/specs/index.md](/specs/index.md) is the roadmap source of truth and new-session entry point. The Pi Completed row states Verified and redirects deferred follow-ups to the [deferred-work registry](/specs/deferred-work.md) instead of carrying a "next" tail. Compaction UI ([#16](https://github.com/gannonh/kata-code/issues/16)) and strict-review polish ([#14](https://github.com/gannonh/kata-code/issues/14)) remain captured in the registry with tracking-issue links.

## 2026-06-27 (Pi coding agent provider — roadmap + issue capture)

- Spec is complete; pointed all roadmap surfaces at a single "what's next" entry. Spec [Known follow-ups](/specs/2026-06-25-pi-coding-agent-support-design.md#known-follow-ups) and [specs roadmap](/specs/index.md) Pi row now link the [Pi roadmap section](/providers/pi.md#roadmap--whats-next-for-pi) and the two tracking issues: compaction UI [#16](https://github.com/gannonh/kata-code/issues/16), strict-review polish [#14](https://github.com/gannonh/kata-code/issues/14).
- Added `Tracking issue` fields to the [deferred-work](/specs/deferred-work.md) compaction and strict-review entries. Filed #16 for the compaction UI deferral (previously registry-only).

## 2026-06-27 (Pi coding agent provider — AC 15 reclassification)

- Reclassified **AC 15** from "Outstanding" to **Implemented and verified** across the [Pi spec](/specs/2026-06-25-pi-coding-agent-support-design.md) (acceptance-criteria status, build/finalize outcomes), [specs roadmap](/specs/index.md), [deferred-work registry](/specs/deferred-work.md), and [Pi provider guide](/providers/pi.md). Evidence: the credentialed `@pi` E2E (`e2e/tests/agent/pi-smoke.spec.ts`, `e2e/tests/settings/pi-provider.spec.ts`, gated by `KATACODE_E2E_ENABLE_PI`/`KATACODE_E2E_PI_AGENT_DIR`/`KATACODE_E2E_PI_MODEL`) configures Pi in settings, selects a runtime-discovered model, streams a response, and exercises interrupt/stop; the [`e2e/verify-evidence/README.md`](../../e2e/verify-evidence/README.md) screenshots map those surfaces to AC 15. The prior "AC 15 outstanding" classification was stale and self-contradictory.
- Removed the "Pi provider manual-authenticated validation (AC 15)" deferred entry; recorded it as closed/resolved. Kept the compaction transport + UI and strict-quality-review (issue #14) deferred entries intact.

## 2026-06-27 (Pi coding agent provider — Finalize outcome)

- Recorded [Finalize outcome](/specs/2026-06-25-pi-coding-agent-support-design.md#finalize-outcome) on `feat/pi-phase2` (build head `3fbeb0209`, final head `f8c2b5f5f`): simplify and strict-quality-review passes, credentialed `@pi` E2E + manual walkthrough evidence, runtime-warning amber UX, E2E harness improvements (`fileSession.ts`, `e2e:clean`, `kill-dev-ports`), `piRuntimeWarning` extraction.
- Moved Pi from Active to Completed on [specs roadmap](/specs/index.md); added links to finalize outcome, [Pi provider guide](/providers/pi.md), and [verification evidence](../../e2e/verify-evidence/README.md).
- Superseded stale slice "Remaining acceptance work" in the Pi spec [Build progress](/specs/2026-06-25-pi-coding-agent-support-design.md#build-progress) with a pointer to the build and finalize reports.
- Updated [deferred-work](/specs/deferred-work.md#pi-provider-strict-quality-review-follow-ups) strict-review notes for the finalize pass.

## 2026-06-27 (Pi coding agent provider — Build complete, status → Implemented)

- Completed the Pi provider Build (`feat/pi-phase2`, base `7bfe7d769`, head `3fbeb0209`): implemented AC 5 (tool lifecycle, image attachments, resume cursor, readThread, rollback), AC 6 (`compactThread` + `thread.state.changed` compaction lifecycle), AC 8 (extension UI bridge), AC 9 (runtime-mode warnings), AC 10 (project-trust surfacing), AC 11/12 (PiTextGeneration parity), AC 13 (instance isolation), AC 14 (existing-provider regression), AC 17 (`vp check`/`typecheck`/`test`/`release:smoke` all green).
- Added a provider compact contract: `ProviderCompactThreadInput` ([provider.ts](../../packages/contracts/src/provider.ts)), required `ProviderAdapterShape.compactThread`, `ProviderServiceShape.compactConversation` + live routing, and typed `thread/compact` stubs in Codex/Claude/Cursor/Grok/OpenCode/Pi adapters.
- Flipped the [Pi design spec](/specs/2026-06-25-pi-coding-agent-support-design.md) frontmatter and body status Approved → Implemented; appended a [Build completion report](/specs/2026-06-25-pi-coding-agent-support-design.md#build-completion-report) with task-by-task evidence, exact verification results, approved deviations, and known follow-ups.
- Updated the [specs roadmap](/specs/index.md) Pi entry from "In progress" to "Implemented".
- Closed the [Pi provider full adapter parity](/specs/deferred-work.md#pi-provider-full-adapter-parity) deferred-work entry; added [Pi provider manual-authenticated validation (AC 15)](/specs/deferred-work.md#pi-provider-manual-authenticated-validation-ac-15) and [Pi compaction transport + UI surface](/specs/deferred-work.md#pi-compaction-transport-and-ui-surface).
- Approved deviation R1: `compactConversation` mirrors `rollbackConversation`'s internal-caller transport pattern (no direct rpc.ts/ws.ts entry); a `thread.compact` orchestration command + reactor is deferred to a future UI task.
- Outstanding: AC 15 manual Pi-authenticated validation requires a maintainer-authenticated Pi environment; the credentialed `@pi` E2E smoke remains green.

## 2026-06-26 (E2E — web test authentication and Pi provider locator fix)

- Fixed Pi provider E2E test: updated radio locator from `name: "Pi", exact: true` to `name: "Pi Early Access"` to match the accessible name (badge included).
- Added `web-dev` project to [Playwright config](../../e2e/playwright.config.ts) with per-project `testIgnore` so Electron projects don't pick up web tests.
- Created [`webSetup.ts`](../../e2e/src/harness/webSetup.ts) fixture: starts dev server, captures `pairingUrl` from stdout, authenticates via pairing URL auto-submit.
- Updated [E2E test catalog](/guides/e2e-test-catalog.md) web section with fixture usage, `web-dev` project commands, and `webPage` authenticated fixture example.

## 2026-06-26 (Pi provider — strict quality review fixes)

- Fixed blockers from strict quality review: duplicate `turn.completed` emissions (single settlement owner in `settleTurn`), orphaned `item.started` on abort/fail (item closure on all exit paths).
- Fixed high-priority issues: `stopSession` abort-before-dispose asymmetry (centralized in `teardownSession`), unsupervised turn fiber (tracked on context, `stopped` flag guards stale events), `projectTrustPolicy` dead config hidden from settings UI, `withInstanceIdentity` duplication extracted to shared `stampProviderInstanceIdentity` across all 6 drivers.
- Fixed medium-priority issues: `makeEvent` generic type safety, `resolveModel` test-override branching eliminated, dead `turns` state removed from `readThread`.
- Added [Pi provider strict quality review follow-ups](/specs/deferred-work.md) deferred-work entry (issue [#14](https://github.com/gannonh/kata-code/issues/14)).

## 2026-06-26 (Pi provider — vertical slice + branch doc sweep)

- Recorded the [Pi provider build progress](/specs/2026-06-25-pi-coding-agent-support-design.md#build-progress): vertical slice landed (snapshot discovery, session start/send/stream/interrupt/stop, driver registration, gated `@pi` e2e green), plus post-slice fixes (pi.dev logo, provider ordering, Early Access badge, model-switch session restart, error banner layout).
- Flipped the [specs roadmap](/specs/index.md) Pi status from Draft to In progress.
- Added a [Pi provider full adapter parity](/specs/deferred-work.md) deferred-work entry covering acceptance criteria 5,6,8,9,10,11.
- Added the `pi` driver row to [provider architecture](/architecture/providers.md) and a [providers index](/providers/index.md) Pi entry.

## 2026-06-25 (mobile E2E — Verify outcome recorded)

- Added a [Verify outcome (2026-06-25)](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md#verify-outcome-2026-06-25) section to the [mobile E2E design spec](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md): `@smoke`/`@pairing`/`@agent` green on-device (iPhone 17 Pro) via Maestro Studio; `@auth` (native `presentAuth` modal) and the AC-4 distinct-ports clause recorded as open. Annotated the now-superseded "deferred to maintainer runtime" line in the Build report with a forward pointer.
- Updated the [specs roadmap](/specs/index.md) status cell to reflect the green flows and the two open items, with links to the Verify outcome, [Maestro Studio authoring guide](/guides/e2e-mobile-authoring-maestro-studio.md), and [E2E test catalog](/guides/e2e-test-catalog.md).

## 2026-06-24 (mobile E2E design spec — reciprocal cross-links)

- Added "Related docs" section to [Mobile E2E testing foundation design](/specs/2026-06-24-mobile-e2e-testing-foundation-design.md) with reciprocal links to the [mobile local dev guide](/guides/mobile-local-dev-ios-simulator.md), [operator reference](../../mobile-e2e/README.md), [authoring skill](../../.agents/skills/mobile-e2e-test-author/SKILL.md), [Electron E2E foundation](/specs/2026-06-21-e2e-testing-foundation-design.md), and [mobile local dev slice design](/specs/2026-06-22-mobile-local-dev-slice-design.md).
- Updated [mobile local dev guide](/guides/mobile-local-dev-ios-simulator.md) with an "Automated E2E" section that maps the manual dev loop to the harness behavior.

## 2026-06-24 (upstream sync strategy reconciliation)

- Retired the ADR 0003 bulk-merge plan: marked [closure spec](/specs/2026-06-20-upstream-sync-closure.md) and [resume handoff](/specs/2026-06-20-upstream-sync-handoff.md) **Superseded**; promoted [strategy analysis](/specs/2026-06-21-upstream-sync-strategy-analysis.md) (Option D) to **Accepted** with outcome [ADR 0004](/adrs/0004-selective-vendor-pull.md).
- Updated [specs roadmap](/specs/index.md): Active item is now "Upstream sync (first scan)" under selective vendor-pull; added a Retired note for the superseded ADR 0003 specs.
- Updated [FORK.md](../../FORK.md): sync block → "Last upstream scan"; Phase 3 runbook → vendor-pull process; added Watched clusters (the `[codex]` Effect migration) and a Ported upstream changes log; post-port checklist and agent instructions point at ADR 0004.
- Updated [fork-setup spec](/specs/fork-setup.md): status row, Phase 3 bullet, and Related now point at ADR 0004; retired the "Active bulk merge" row.

## 2026-06-23 (mobile local dev slice — build report updated with PR review fixes)

- Updated [build completion report](/specs/2026-06-22-mobile-local-dev-slice-build-report.md) with all post-build commits: kanji brand rebrand, splash screen gate, iOS widget build-settings plugin, Metro resolver fix, and [PR #9](https://github.com/gannonh/kata-code/pull/9) review fixes (splash idempotency, dead code removal, widget target warning, `ios:dev` env scoping, `PRODUCT_ABBREVIATION` centralization).
- Updated head SHA to `3f1056efc`; added PR #9 link.
- Added [mobile local dev slice](/specs/2026-06-22-mobile-local-dev-slice-design.md) to [specs roadmap](/specs/index.md) Completed section.

## 2026-06-21 (local Electron E2E — implementation verification)

- Updated [E2E foundation design](/specs/2026-06-21-e2e-testing-foundation-design.md) with implementation notes, Clerk ticket auth path, headed verification evidence, and build completion report refresh.
- Refreshed [specs roadmap](/specs/index.md) completed row.
- Registered CI E2E and release-target follow-ups in [deferred work](/specs/deferred-work.md).

## 2026-06-21 (upstream-sync branch OKF finalize — pre-merge)

- Refreshed [closure spec](/specs/2026-06-20-upstream-sync-closure.md) current state and branch-progress table; recorded Closure Task 4 audit (no new rules beyond `review` bucket).
- Updated [resume handoff](/specs/2026-06-20-upstream-sync-handoff.md) to handoff HEAD `774da08bc`; last-mile rebrand work marked committed; resume sequence corrected.
- Updated [fork-setup spec](/specs/fork-setup.md): Phase 2 merged; first upstream sync **Active** on `upstream-sync-2026-06-20` (bulk merge pending).

## 2026-06-20 (upstream sync handoff doc added)

Added [resume handoff](/specs/2026-06-20-upstream-sync-handoff.md) as the rollback target + sub-agent handoff contract for the paused merge. Distinct from the closure spec: the closure spec is the _what / acceptance_, the handoff is the _where-we-are / resume-from-here_ with the exact suggested sequence, the last-mile `rebrand-fork.ts` enhancements to bake in before re-running (PROPERTY_PATTERNS for `t3Home`/`t3-env:`/`~/.t3`, the `"t3/` and `"t3code-relay/` Context.Service key-prefix renames, the OTel brand fixes), the fork-file restorations after the bulk `take-upstream.sh` pass, and the one real code fix (`server.ts` `anyUnknownInErrorContext` from the Effect 4.0.0-beta.78 bump). Promoted the roadmap Active row to lead with the handoff doc.

## 2026-06-20 (upstream sync merge attempt — paused at clean checkpoint)

The first full merge of upstream (baseline `708d5383` -> tip `97e5cd3bf`, 80 commits) ran long and hit repeated git-state disruptions (SIGPIPE-truncated first attempt, index-lock race, stash/restore chain). The branch was hard-reset to the clean baseline `20ef549a7` to preserve the durable deliverables and discard the thrashed in-progress merge state.

**Durable deliverables (committed, safe):** full upstream-sync skill (Steps 0-7 with post-merge closure phase + Take/Reject/Defer/Review vocabulary + staging-order warning + helper references), the five helper scripts (`rules.ts`, `classify-upstream.ts`, `conflict-zones.ts`, `rebrand-fork.ts`, `take-upstream.sh`), the Approved [closure spec](/specs/2026-06-20-upstream-sync-closure.md), and the FORK.md divergence log (rejects + EAS ported improvement).

**The merge itself was not committed.** It was content-resolved at one point (1236 staged files, 0 conflict markers) but the merge commit was never made before git-state thrash destroyed the index state. Re-doing it with the committed helpers should be far faster and safer than the manual grind.

**Last-mile work lost to the thrash — redo on next attempt, then bake into the helpers as rules:**

- `rebrand-fork.ts` needs a `PROPERTY_PATTERNS` block (word-boundary regexes): `\bt3Home\b`->`katacodeHome`, `t3-env:`->`kata-env:` (16 occ), `~/\.t3\b`->`~/.katacode`, plus two more `IDENTITY_RENAMES`: `"t3/`->`"@kata-sh/code-cli/` (apps/server Context.Service keys, 56 occ) and `"t3code-relay/`->`"@kata-sh/code-relay/` (23 occ).
- `devRemoteT3ServerEntryPath`->`devRemoteServerEntryPath` normalization across apps/desktop (fork's canonical name).
- Restoring fork release scripts (`scripts/build-desktop-artifact.ts` + tests + `scripts/lib/*`) from `HEAD` after the bulk `take-upstream.sh scripts` pass — those are fork-divergent.
- Restoring `packages/shared/package.json` `./branding` + `./relayTracing` subpath exports after the bulk `take-upstream.sh packages` pass.
- `packages/shared/src/relayTracing.ts` OTel brand: `"t3.client.surface"`->`"kata.client.surface"`; `apps/server/src/cloud/relayTracing.ts` service names `"t3-headless-relay-client"`->`"kata-headless-relay-client"`, `"t3-server"`->`"kata-server"`.
- The one real code fix beyond rebrand: `apps/server/src/server.ts:481/494` `anyUnknownInErrorContext`. Root cause: the Effect `4.0.0-beta.78` bump + the `[codex]` refactor made `OtlpTracer.layer` return `Layer<never, never, OtlpSerialization | HttpClient.HttpClient>` (now also requires `HttpClient`); the fork's `makeRelayClientTracingLayer` in `packages/shared/src/relayTracing.ts` only provides `OtlpSerialization`, leaking `unknown` into the composing layer. The pre-merge HEAD does NOT have this error. Correct fix: provide HttpClient legitimately into `tracerLayer`, OR widen the declared `Layer.Layer<never, never, HttpClient.HttpClient>` return type. (Tried `FetchHttpClient.layer` from `@effect/platform-node` — wrong, returns `any`.)

**Suggested resume sequence:** with branch clean at `20ef549a7`, run `git fetch upstream --tags && git merge upstream/main --no-edit`, then resolve zone-by-zone with `take-upstream.sh` BEFORE staging (apps/mobile, apps/web, apps/server, apps/desktop, packages/client-runtime, packages, scripts, workflows, docs, then infra/relay by hand for kata-wire identity), then restore fork release scripts + shared exports, then bake the property-pattern + key-prefix rules into `rebrand-fork.ts` and run `rebrand-fork.ts --apply` + `--check`, then `rm -f pnpm-lock.yaml && vp i`, fix `pnpm-workspace.yaml` by hand, then `vp check && vp run typecheck` (expect only the `server.ts` OtlpTracer fix remaining), then `git commit --no-edit` to conclude the merge. Then Step 4 (vendored repos — Effect was bumped to `4.0.0-beta.78`, so `vp run sync:repos` runs), Step 5 (verify gates), Step 6 (closure via `plan-build-verify`), Step 7 (land + record in FORK.md).

## 2026-06-20 (upstream sync closure spec drafted)

- Added [2026-06-20 upstream sync closure spec](/specs/2026-06-20-upstream-sync-closure.md) capturing Decisions 1-10 (single bulk merge of 80 upstream commits since baseline `708d5383` → tip `97e5cd3bf`) plus five post-merge closure tasks: branding re-application, Clerk publishable-key build-injection verification, OKF Effect conventions synthesis, classifier rule gaps, vendored-repo convergence (Effect bumped to `4.0.0-beta.78`).
- Adversarial spec review by the `reviewer` sub-agent (separate from the author) found one blocker (Decision 8 mis-bucketed `b19fc1b87b`, which is `defer` not `review`) and seven actionable notes; all applied: split `b19fc1b87b` into Decision 9, fixed stale fork-divergence count (72→82), tightened the `t3://` scan exemption to the named path + literal, hardened the "blocked test" and "Build stops and asks" escape hatches, committed Phase 2 to definite action (Effect was bumped), listed the five docs-only SHAs in Decision 4, fixed the Task-2-below cross-ref to Task 3.
- Promoted the "Upstream sync (first merge)" roadmap row from Planned to Active. Spec status: Draft, awaiting user review before Build (the merge).

## 2026-06-19 (stable v0.0.29 UAT pass)

- Stable `v0.0.29` UAT passed on `app.kata.sh`: chat, Files, Connect relay, network access, manual environment add.
- `@kata-sh/code-cli@0.0.29` on npm; invoke with `npx @kata-sh/code-cli`.
- [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) fully closed with stable release evidence.

## 2026-06-19 (Relay Deploy completed)

- Marked [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) **Completed** with UAT evidence date 2026-06-19.
- Updated [specs roadmap](/specs/index.md): Phase 2 relay deploy moved to Completed; upstream sync remains Planned.
- Closed "Production Relay Deploy" in [deferred work registry](/specs/deferred-work.md); added "Connect: stale relay link on account switch" as deferred.

## 2026-06-18 (Relay Deploy infra setup)

- Updated [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) with credential smoke + local dry-run progress and remaining GitHub/UAT gates.
- Expanded [Relay deploy setup](/operations/relay-deploy-setup.md) and [Relay credentials playbook](/guides/relay-credentials-playbook.md) with Alchemy bootstrap and Cloudflare account ID troubleshooting.

## 2026-06-18 (Relay Deploy design)

- Added and approved [Relay Deploy design](/specs/2026-06-18-relay-deploy-design.md) for manual production relay deploy, strict release config, smoke checks, and UAT evidence.
- Updated [specs roadmap](/specs/index.md) and [deferred work registry](/specs/deferred-work.md) for relay follow-ups.

## 2026-06-18 (deferred work registry)

- Added [deferred work registry](/specs/deferred-work.md) and linked it from the [specs roadmap](/specs/index.md) so deferred scope has a durable review queue.

## 2026-06-17 (episodic upstream sync)

- Documented episodic upstream policy in [ADR 0003](/adrs/0003-episodic-upstream-sync.md) and [upstream sync guide](/guides/upstream-sync.md); updated [roadmap](/specs/index.md) and [fork-setup spec](/specs/fork-setup.md).

## 2026-06-17 (Kata brand icons)

- Completed fork icon rebrand on `main`: `apps/desktop/resources/source.png` drives `pnpm run generate:brand-rasters`; production icons used for dev, nightly, and hosted web ([FORK.md — brand marks](../../FORK.md#brand-logo-marks)).
- Fixed desktop release `afterPack` hook path (`scripts/electron-after-pack.cjs` relative to `apps/desktop`).

## 2026-06-17 (Phase 2 pre-merge)

- [PR #2](https://github.com/gannonh/kata-code/pull/2) ready to merge: Codex review fixes (`dry_run` default version, prerelease npm `next` dist-tag), `vercel.ts` compile fix, Vercel project + `app.kata.sh` domains.
- Moved Phase 2 desktop/web release to **Completed** on [roadmap](/specs/index.md); post-merge validation tracked as **Next**.

## 2026-06-16 (Phase 2 desktop/web release build)

- Implemented [Phase 2 desktop/web release split](/specs/2026-06-16-phase-2-desktop-web-release-design.md): activated [release workflow](../../.github/workflows/release.yml), macOS Apple ID notarization gate, Kata Code hosted web domains, and [release runbook](/operations/release.md).

## 2026-06-16 (Phase 2 desktop/web release design)

- Added [Phase 2 desktop/web release split design](/specs/2026-06-16-phase-2-desktop-web-release-design.md) focused on desktop CI signing/notarization and hosted `apps/web`; explicitly deferred mobile, marketing, and relay/cloud VM deploys.
- Updated the specs roadmap to track the Phase 2 desktop/web release design separately from remaining infrastructure split work.

## 2026-06-16 (Phase 1 delivery)

- Marked Phase 1 PR & CI complete on [roadmap](/specs/index.md); [PR #1](https://github.com/gannonh/kata-code/pull/1) passes GitHub Actions.
- Added Phase 1 delivery notes and test-fixture guidance to [fork-setup spec](/specs/fork-setup.md).

## 2026-06-16

- Initialized specs section; moved `.plans/` to `docs/specs/plans/`.
- Added [fork-setup spec](/specs/fork-setup.md) (canonical fork plan lives in [FORK.md](../../FORK.md)).
- Moved [product backlog](/specs/product-backlog.md) from `docs/project/todo.md`.
