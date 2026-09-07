# Kata Code roadmap audit, 2026-09-06

This is a dated inventory and decision record. The [Linear project](https://linear.app/kata-sh/project/kata-code-f2107c018151) owns the live roadmap, specifications, milestones and lifecycle. This file does not authorize Build.

## Scope and evidence

Read all 15 existing Linear project issues and their discussions/relations; all 94 GitHub issue bodies, including 81 closed issues; all 88 PR metadata records; and focused issue comments, closure reasons, merge records and current-main ancestry. Remote main was `f6d0ff0902e8fbdca8e93cd2ead38c6992fb4128`. No new runtime, device, provider or release acceptance was performed. Historical proof is identified as such.

GitHub had 13 open issues and 81 closed issues. Of the closed issues, 41 were Completed and 40 Not Planned. Nineteen Completed records belong to the archived tree. PRs comprised 79 merged, eight closed without merge and one open draft. Closed is not evidence that current product scope is delivered.

## Roadmap changes

Gannon selected Docker Sandboxes first. Five milestones now cover Docker preview, sandbox configuration, cloud environments, additional providers, and upkeep/upstream updates. All 20 Linear issues have a milestone. The 18 nonterminal issues have explicit acceptance criteria, delivery slices and demonstrations. Existing issue states were preserved; five new issues are Backlog. Project roster changed from Backlog to In Progress for assessment.

The 13 GitHub link stubs were expanded in place. Existing source links remain attached. The Docker epic has four direct implementation children; the old rebase epic has three direct planning/evidence children. No second nesting level or dependency cycle was introduced. The two Done historical records received milestone assignments without retrospective acceptance edits.

New records: KAT-3278 combined Docker verification, KAT-3279 vendor-program reconciliation, KAT-3280 current Pi planning, KAT-3281 cloud-provider choice, and KAT-3282 mobile evidence reconciliation.

The live order is KAT-3163 foundation, then independent KAT-3162 create and KAT-3159 provider work; KAT-3161 requires foundation and create because its full scope changes the create-time relay choice. KAT-3167 completes private-source acceptance after foundation. KAT-3278 follows all five prerequisite issues. Vercel KAT-3169 is blocked by KAT-3281 provider-choice planning.

## Decisions made during reconciliation

- Split overlapping placeholders: KAT-3166 owns variables/secrets, KAT-3168 owns managed-image selection. Secret storage and injection semantics remain explicit planning decisions.
- Preserve Vercel while KAT-3281 assesses the next cloud provider. Existing Sprite CLI functionality does not prove a sandbox driver.
- Clarify preview behavior: static service composition, request-time administrative 404 when disabled, client hiding, and the in-container bootstrap pairing exemption.
- Clarify creation recovery after both in-flight reload and completion while closed; require a visible choice among multiple authorized results and project uniqueness under concurrent attachment.
- Clarify retry: resume retained resources, use a linked attempt at the original SHA after confirmed compensation, and prevent allocation while cleanup remains unknown.
- Use visible-view management discovery every 30 seconds while idle and two seconds while active, plus focus refresh. Hidden views stop polling. This replaces the impossible promise of discovering another client’s work without polling or push.
- Limit first Docker provider scope to Codex and eligible Claude. Real-provider proof is distinct from ordinary PR control-plane CI and requires the appropriate credential classes.
- Remove obsolete active rebase/rename instructions from historical epics. Retain their original source records as evidence.
- Preserve canceled Task mode, Task CLI and Guided workspace history. No canceled issue was reopened.

## Material findings and readiness

[PR #181](https://github.com/gannonh/kata-code/pull/181) remains draft on `issue-177`, head `f6b39779b22ece618fe394e70eea3b4002b31439`. Five CI jobs passed. Its Docker HTTP harness uses a dummy provider credential, so it does not establish a real provider turn, client onboarding, a stock published install or UI acceptance. Eng should resume this branch, preserve its work and associate exactly KAT-3163 when implementation resumes.

The closed [vendor epic #124](https://github.com/gannonh/kata-code/issues/124) retains 19 slices; eleven merged child implementations account for slices 1–4. Slices 5–19 need current source comparison and explicit dispositions. KAT-3279 retains that work rather than interpreting closure as acceptance.

[PR #158](https://github.com/gannonh/kata-code/pull/158) delivered the identifier policy. [Direct commit fa2262bcb](https://github.com/gannonh/kata-code/commit/fa2262bcb8f74c6c1075f4b8d8d2084c0246ca4a) delivered private GitHub checkout. Their open Linear records are evidence/reconciliation work, not duplicate Build requests. [PR #150](https://github.com/gannonh/kata-code/pull/150) records accepted mobile launch/identity scope; the separate device gaps in PRs #151, #155 and #156 remain in KAT-3282.

The team’s required lifecycle states exist. Dispatch readiness is not yet confirmed: imported tickets lack runtime/model/model-effort selections, and no project-specific verified PR automation record exists in this checkout. Program Manager/Eng must confirm those settings, validate the selected route against canonical dispatch-runtimes and name the host/worker plus isolated worktree before Start. No model, effort or worker was guessed.

Vercel facts need current official/provider evidence before approval. Its proposed existing-row schema transformation must be reviewed against the prohibition on compatibility migrations; that rule is not a blanket ban on all schema changes. Claude fixture/proof arrangements and later configuration/product choices remain on their owning planning tickets.

Two independent read-only reviewers examined historical accounting and the published specs. Accepted findings were applied, including stale lower-section instructions, evidence claims, hierarchy and dependency corrections. Structural verification read back every issue and the project milestones.

## Linear inventory

| Issue | Title | State | Milestone | Parent |
| --- | --- | --- | --- | --- |
| [KAT-3159](https://linear.app/kata-sh/issue/KAT-3159/run-codex-and-eligible-claude-code-instances-in-docker) | Run Codex and eligible Claude Code instances in Docker | Backlog | Gate 0: Usable Docker Sandbox preview | KAT-3164 |
| [KAT-3161](https://linear.app/kata-sh/issue/KAT-3161/manage-docker-lifecycle-and-connect-from-remote-clients) | Manage Docker lifecycle and connect from remote clients | Backlog | Gate 0: Usable Docker Sandbox preview | KAT-3164 |
| [KAT-3162](https://linear.app/kata-sh/issue/KAT-3162/create-a-docker-sandbox-into-a-ready-project) | Create a Docker Sandbox into a ready project | Backlog | Gate 0: Usable Docker Sandbox preview | KAT-3164 |
| [KAT-3163](https://linear.app/kata-sh/issue/KAT-3163/enable-docker-preview-and-create-on-a-stock-install) | Enable Docker preview and create on a stock install | In Progress | Gate 0: Usable Docker Sandbox preview | KAT-3164 |
| [KAT-3164](https://linear.app/kata-sh/issue/KAT-3164/deliver-a-usable-docker-sandbox-preview) | Deliver a usable Docker Sandbox preview | Backlog | Gate 0: Usable Docker Sandbox preview | — |
| [KAT-3165](https://linear.app/kata-sh/issue/KAT-3165/explain-sprite-activity-status-during-release-and-wake) | Explain Sprite activity status during release and wake | Backlog | Phase 2: Cloud sandbox environments | — |
| [KAT-3166](https://linear.app/kata-sh/issue/KAT-3166/plan-sandbox-environment-variables-and-secrets) | Plan sandbox environment variables and secrets | Backlog | Phase 1: Configurable Docker Sandboxes | — |
| [KAT-3167](https://linear.app/kata-sh/issue/KAT-3167/verify-private-github-selection-and-docker-checkout) | Verify private GitHub selection and Docker checkout | Backlog | Gate 0: Usable Docker Sandbox preview | — |
| [KAT-3168](https://linear.app/kata-sh/issue/KAT-3168/plan-managed-sandbox-image-channel-selection) | Plan managed sandbox image channel selection | Backlog | Phase 1: Configurable Docker Sandboxes | — |
| [KAT-3169](https://linear.app/kata-sh/issue/KAT-3169/create-and-manage-vercel-sandbox-environments) | Create and manage Vercel Sandbox environments | Backlog | Phase 2: Cloud sandbox environments | — |
| [KAT-3170](https://linear.app/kata-sh/issue/KAT-3170/retain-upstream-identifiers-and-verify-the-fork-policy) | Retain upstream identifiers and verify the fork policy | Backlog | Phase 4: Product upkeep and upstream updates | — |
| [KAT-3171](https://linear.app/kata-sh/issue/KAT-3171/complete-remaining-user-visible-kata-identity-decisions) | Complete remaining user-visible Kata identity decisions | Backlog | Phase 4: Product upkeep and upstream updates | — |
| [KAT-3172](https://linear.app/kata-sh/issue/KAT-3172/175-docsverify-fix-stale-handles-in-the-verify-katacode-map) | #175 docs(verify): fix stale handles in the verify-katacode map | Done | Phase 4: Product upkeep and upstream updates | — |
| [KAT-3173](https://linear.app/kata-sh/issue/KAT-3173/reconcile-the-remaining-rebase-and-re-port-roadmap) | Reconcile the remaining rebase and re-port roadmap | Backlog | Phase 4: Product upkeep and upstream updates | — |
| [KAT-3206](https://linear.app/kata-sh/issue/KAT-3206/182-setup-script-pr) | #182 setup-script PR | Done | Phase 4: Product upkeep and upstream updates | — |
| [KAT-3278](https://linear.app/kata-sh/issue/KAT-3278/verify-the-complete-docker-sandbox-preview-journey) | Verify the complete Docker Sandbox preview journey | Backlog | Gate 0: Usable Docker Sandbox preview | — |
| [KAT-3279](https://linear.app/kata-sh/issue/KAT-3279/reconcile-the-unfinished-upstream-update-program) | Reconcile the unfinished upstream update program | Backlog | Phase 4: Product upkeep and upstream updates | KAT-3173 |
| [KAT-3280](https://linear.app/kata-sh/issue/KAT-3280/plan-the-first-pi-session-on-the-current-provider-api) | Plan the first Pi session on the current provider API | Backlog | Phase 3: Additional provider support | KAT-3173 |
| [KAT-3281](https://linear.app/kata-sh/issue/KAT-3281/choose-the-next-cloud-sandbox-provider-and-first-journey) | Choose the next cloud Sandbox provider and first journey | Backlog | Phase 2: Cloud sandbox environments | — |
| [KAT-3282](https://linear.app/kata-sh/issue/KAT-3282/reconcile-outstanding-mobile-acceptance-evidence) | Reconcile outstanding mobile acceptance evidence | Backlog | Phase 4: Product upkeep and upstream updates | KAT-3173 |

## Complete GitHub issue inventory

| Source | Title | Recorded state | Roadmap disposition |
| --- | --- | --- | --- |
| [#12](https://github.com/gannonh/kata-code/issues/12) | feat: add feature flagging system | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#13](https://github.com/gannonh/kata-code/issues/13) | feat: add feature flagging system | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#14](https://github.com/gannonh/kata-code/issues/14) | Pi provider strict quality review: deferred follow-up items | Closed / Not Planned | Canceled; Pi design evidence retained by KAT-3280. |
| [#16](https://github.com/gannonh/kata-code/issues/16) | Pi compaction: thread.compact orchestration command + UI surface | Closed / Not Planned | Canceled; Pi compaction candidate for KAT-3280 disposition. |
| [#18](https://github.com/gannonh/kata-code/issues/18) | Sandbox: reclaim orphaned containers on server restart | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#19](https://github.com/gannonh/kata-code/issues/19) | Sandbox: share Docker config schema between web UI and driver | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#21](https://github.com/gannonh/kata-code/issues/21) | deferred: sandbox Connect managed-tunnel origin must use container port, not host-published port | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#23](https://github.com/gannonh/kata-code/issues/23) | Sandbox: surface pairing URL and token in deployment target UI | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#24](https://github.com/gannonh/kata-code/issues/24) | Sandbox: HTTP pairing URL triggers browser security warning | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#26](https://github.com/gannonh/kata-code/issues/26) | Deferred: Validate repoRoot against authorized workspace roots in sandbox RPC | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#29](https://github.com/gannonh/kata-code/issues/29) | Defer GitHub remote-source seeding for Docker sandboxes | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#30](https://github.com/gannonh/kata-code/issues/30) | Add Vercel startSession orchestration tests for GitHub source path | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#31](https://github.com/gannonh/kata-code/issues/31) | Add VercelSourcePicker component tests (RPC, default branch, locked state) | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#32](https://github.com/gannonh/kata-code/issues/32) | Add @environments-deploy E2E for Vercel source and worktrees | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#35](https://github.com/gannonh/kata-code/issues/35) | Sidebar v2: add inline approval and review actions | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#36](https://github.com/gannonh/kata-code/issues/36) | Sidebar v2: adopt recency-first list on mobile | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#37](https://github.com/gannonh/kata-code/issues/37) | Sidebar v2: add message-snippet density mode | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#38](https://github.com/gannonh/kata-code/issues/38) | Sidebar v2: stream pull request state from server | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#39](https://github.com/gannonh/kata-code/issues/39) | deferred: live @agent Waiting chip E2E for sidebar state detection | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#40](https://github.com/gannonh/kata-code/issues/40) | Investigate speeding up server test suite | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#42](https://github.com/gannonh/kata-code/issues/42) | Connect: capability-gated lease enforcement for older clients | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#43](https://github.com/gannonh/kata-code/issues/43) | Connect: capability-gated lease enforcement for older clients | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#50](https://github.com/gannonh/kata-code/issues/50) | Defer: isolate Pi extension loading from server event loop | Closed / Not Planned | Canceled; Pi extension isolation evidence retained by KAT-3280. |
| [#52](https://github.com/gannonh/kata-code/issues/52) | Defer: Playwright e2e/tests coverage for task workspaces Slice 1 | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#53](https://github.com/gannonh/kata-code/issues/53) | Defer: crash-safe task-workspace NDJSON append (fsync / trailing truncate) | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#55](https://github.com/gannonh/kata-code/issues/55) | Defer: rich context-manifest fields for task workspaces (Slice 3+) | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#56](https://github.com/gannonh/kata-code/issues/56) | Defer: Build-debug UX for task workspace debugging session role | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#57](https://github.com/gannonh/kata-code/issues/57) | Defer: Playwright e2e/tests @task-workspaces for Slice 2 | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#64](https://github.com/gannonh/kata-code/issues/64) | test(task-workspace): complete provider-backed Guided acceptance | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#65](https://github.com/gannonh/kata-code/issues/65) | test(git): stabilize alias status test under full-suite load | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#67](https://github.com/gannonh/kata-code/issues/67) | feat(agent-runtime): add mobile Agents roster and controls | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#68](https://github.com/gannonh/kata-code/issues/68) | feat(agent-runtime): expand providers and fleet topology | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#70](https://github.com/gannonh/kata-code/issues/70) | [Bug]: Approve Plan appears inert when invalid manual check reaches review gate | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#72](https://github.com/gannonh/kata-code/issues/72) | Task mode and Agent Runtime — product-first workflows | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#73](https://github.com/gannonh/kata-code/issues/73) | Task mode Vertical Slice 1 — Guided planning | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#74](https://github.com/gannonh/kata-code/issues/74) | Task mode Vertical Slice 2 — Guided implementation | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#75](https://github.com/gannonh/kata-code/issues/75) | Provider-agnostic Task workflow through katacode CLI | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#76](https://github.com/gannonh/kata-code/issues/76) | Task mode conversation-plus-panel shell | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#77](https://github.com/gannonh/kata-code/issues/77) | Cover ChatView read-only mode with rendering tests | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#79](https://github.com/gannonh/kata-code/issues/79) | Test Task Workspaces E2E is red on main and unreproducible locally | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#80](https://github.com/gannonh/kata-code/issues/80) | Task permissions choice for coding agent runs | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#81](https://github.com/gannonh/kata-code/issues/81) | Task mode evals: measure and tune stage outcomes per model | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#82](https://github.com/gannonh/kata-code/issues/82) | Resizable Task panel and clearer Plan controls | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#85](https://github.com/gannonh/kata-code/issues/85) | Commit-bound evidence in a standalone Verify stage | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#86](https://github.com/gannonh/kata-code/issues/86) | Task mode - Slice 5 (placeholder) | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#87](https://github.com/gannonh/kata-code/issues/87) | Review pull requests through feedback and merge | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#89](https://github.com/gannonh/kata-code/issues/89) | Reliable and polished primary conversation panel | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#90](https://github.com/gannonh/kata-code/issues/90) | Mermaid architecture diagrams in every Guided Plan | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#91](https://github.com/gannonh/kata-code/issues/91) | Create Tasks from any accessible GitHub repository | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#92](https://github.com/gannonh/kata-code/issues/92) | Rename, archive, restore, and delete Tasks | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#94](https://github.com/gannonh/kata-code/issues/94) | Phase 1: Expose Task context through katacode CLI | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#95](https://github.com/gannonh/kata-code/issues/95) | Phase 2: Move Guided planning from MCP to Task CLI | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#96](https://github.com/gannonh/kata-code/issues/96) | Phase 3: Move Guided implementation to Task CLI | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#97](https://github.com/gannonh/kata-code/issues/97) | Phase 4: Cut over Task Mode and prove provider parity | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#98](https://github.com/gannonh/kata-code/issues/98) | Stabilize parallel full-suite Git and async test isolation | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#102](https://github.com/gannonh/kata-code/issues/102) | Claude task-stage completion proposals do not reconcile with provider terminal events | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#104](https://github.com/gannonh/kata-code/issues/104) | Bind Task CLI completion aliases to the active provider turn | Closed / Completed | Completed on archived tree; not current implementation proof. |
| [#105](https://github.com/gannonh/kata-code/issues/105) | Restructure guided-task provider E2E around a checked-in provider registry | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#106](https://github.com/gannonh/kata-code/issues/106) | Claude cannot drive the Task CLI in Guided Implement: phase never starts | Closed / Not Planned | Canceled historical scope; not reopened. |
| [#108](https://github.com/gannonh/kata-code/issues/108) | Re-base Kata Code on current T3 and re-port unique work | OPEN | Retained and expanded as KAT-3173. |
| [#109](https://github.com/gannonh/kata-code/issues/109) | Phase 1: Archive, cut, and Kata identity | Closed / Completed | Merged implementation in PR #110; acceptance is separate. |
| [#111](https://github.com/gannonh/kata-code/issues/111) | Phase 2: CI green and Kata desktop/web release | Closed / Completed | Merged implementation in PR #112; acceptance is separate. |
| [#113](https://github.com/gannonh/kata-code/issues/113) | Phase 3: Kata Connect wire and pair continuity | Closed / Completed | Merged implementation in PR #114; acceptance is separate. |
| [#118](https://github.com/gannonh/kata-code/issues/118) | Remaining T3 user-facing branding | OPEN | Retained and expanded as KAT-3171. |
| [#119](https://github.com/gannonh/kata-code/issues/119) | Retain upstream-compatible internal T3 identifiers | OPEN | Merged policy PR #158; existing evidence and board reconciliation in KAT-3170. |
| [#124](https://github.com/gannonh/kata-code/issues/124) | Vendor-pull T3 work since pin 6a687ee43 | Closed / Completed | Closed Completed, but slices 5–19 lack implementation/skip accounting; KAT-3279. |
| [#125](https://github.com/gannonh/kata-code/issues/125) | Vendor-pull slice 1: terminal Ghostty cluster | Closed / Completed | Merged implementation in PR #126; acceptance is separate. |
| [#127](https://github.com/gannonh/kata-code/issues/127) | Kata names in update copy, pairing labels, and install docs | Closed / Completed | Merged implementation in PR #128; acceptance is separate. |
| [#129](https://github.com/gannonh/kata-code/issues/129) | Vendor-pull slice 2: usage insights redesign plus follow-up fixes | Closed / Completed | Merged implementation in PR #130; acceptance is separate. |
| [#131](https://github.com/gannonh/kata-code/issues/131) | Vendor-pull slice 3d: default GitHub project clones to HTTPS | Closed / Completed | Merged implementation in PR #137; acceptance is separate. |
| [#132](https://github.com/gannonh/kata-code/issues/132) | Vendor-pull slice 3a: recover client queries across reconnects | Closed / Completed | Merged implementation in PR #135; acceptance is separate. |
| [#133](https://github.com/gannonh/kata-code/issues/133) | Vendor-pull slice 3c: prevent oversized thread search crashes | Closed / Completed | Merged implementation in PR #136; acceptance is separate. |
| [#134](https://github.com/gannonh/kata-code/issues/134) | Vendor-pull slice 3b: recover remote updates after credential rejection | Closed / Completed | Merged implementation in PR #138; acceptance is separate. |
| [#141](https://github.com/gannonh/kata-code/issues/141) | Vendor-pull slice 4a: preserve mobile Markdown image dimensions | Closed / Completed | Merged implementation in PR #152; acceptance is separate. |
| [#142](https://github.com/gannonh/kata-code/issues/142) | Vendor-pull slice 4b: persist mobile thread shelf state | Closed / Completed | Merged PR #151; remaining device evidence in KAT-3282. |
| [#143](https://github.com/gannonh/kata-code/issues/143) | Vendor-pull slice 4c: isolate mobile Markdown image requests | Closed / Completed | Merged implementation in PR #154; acceptance is separate. |
| [#144](https://github.com/gannonh/kata-code/issues/144) | Vendor-pull slice 4d: restore Android tablet thread controls | Closed / Completed | Merged PR #155; remaining Android tablet evidence in KAT-3282. |
| [#145](https://github.com/gannonh/kata-code/issues/145) | Vendor-pull slice 4e: keep first Android thread above composer | Closed / Completed | Merged PR #156; remaining Android cold-start/keyboard evidence in KAT-3282. |
| [#146](https://github.com/gannonh/kata-code/issues/146) | Route contributor feedback to Kata Code | Closed / Completed | Merged implementation in PR #157; acceptance is separate. |
| [#147](https://github.com/gannonh/kata-code/issues/147) | Phase 6: launch Kata Code Dev on iOS Simulator | Closed / Completed | Merged PR #150; recorded iOS Simulator launch/identity acceptance only. |
| [#148](https://github.com/gannonh/kata-code/issues/148) | [bug] Provider adapter process error (codex) | Closed / Completed | Merged implementation in PR #149; acceptance is separate. |
| [#159](https://github.com/gannonh/kata-code/issues/159) | Create and attach Docker Sandbox environments | Closed / Completed | Merged implementation in PR #162; acceptance is separate. |
| [#160](https://github.com/gannonh/kata-code/issues/160) | Resume Docker Sandboxes across clients and restarts | Closed / Completed | Merged implementation in PR #165; acceptance is separate. |
| [#161](https://github.com/gannonh/kata-code/issues/161) | Create and manage Vercel Sandbox environments | OPEN | Retained and expanded as KAT-3169. |
| [#163](https://github.com/gannonh/kata-code/issues/163) | Provision Docker Sandboxes from Add Environment | Closed / Completed | Merged implementation in PR #164; acceptance is separate. |
| [#170](https://github.com/gannonh/kata-code/issues/170) | Configure sandbox environment and managed image channels | OPEN | Retained and expanded as KAT-3168. |
| [#171](https://github.com/gannonh/kata-code/issues/171) | Select private GitHub repositories for Docker Sandboxes | OPEN | Direct-main fa2262bcb; integrated picker and credential proof remain in KAT-3167. |
| [#172](https://github.com/gannonh/kata-code/issues/172) | Configure environment variables and secrets for sandboxes | OPEN | Retained and expanded as KAT-3166. |
| [#174](https://github.com/gannonh/kata-code/issues/174) | Investigate transient inactive Sprite activity status | OPEN | Retained and expanded as KAT-3165. |
| [#176](https://github.com/gannonh/kata-code/issues/176) | Docker Sandboxes: preview flag and usable end to end | OPEN | Retained and expanded as KAT-3164. |
| [#177](https://github.com/gannonh/kata-code/issues/177) | Docker Sandboxes ship behind a preview flag and create on a stock install | OPEN | Existing draft PR #181, passing branch CI; unmerged and missing UI acceptance. |
| [#178](https://github.com/gannonh/kata-code/issues/178) | Create a Docker Sandbox from one form and land in a ready project | OPEN | Retained and expanded as KAT-3162. |
| [#179](https://github.com/gannonh/kata-code/issues/179) | Manage Docker Sandboxes with live plain-language state and relay reach | OPEN | Retained and expanded as KAT-3161. |
| [#180](https://github.com/gannonh/kata-code/issues/180) | Run Claude Code and other configured providers inside a Docker Sandbox | OPEN | Retained and expanded as KAT-3159. |

## Complete PR inventory

Merged means implementation history, not current runtime acceptance. No PR status, readiness or review threads were changed.

| PR | Title | State |
| --- | --- | --- |
| [#1](https://github.com/gannonh/kata-code/pull/1) | Complete Phase 1 KataCode fork identity and documentation | Merged |
| [#2](https://github.com/gannonh/kata-code/pull/2) | feat(release): Phase 2 desktop and web release path | Merged |
| [#3](https://github.com/gannonh/kata-code/pull/3) | fix(test): macOS AssetAccess path assertions | Merged |
| [#4](https://github.com/gannonh/kata-code/pull/4) | feat(relay): production deploy workflow, credential tooling, and kata wire renames | Merged |
| [#5](https://github.com/gannonh/kata-code/pull/5) | docs(agents): add Cursor Cloud dev environment instructions | Closed |
| [#6](https://github.com/gannonh/kata-code/pull/6) | Adopt selective vendor-pull upstream sync strategy | Merged |
| [#7](https://github.com/gannonh/kata-code/pull/7) | docs: add local Electron E2E foundation design | Merged |
| [#8](https://github.com/gannonh/kata-code/pull/8) | feat(e2e): local Electron E2E testing foundation | Merged |
| [#9](https://github.com/gannonh/kata-code/pull/9) | feat(mobile): iOS Simulator local dev slice | Merged |
| [#10](https://github.com/gannonh/kata-code/pull/10) | fix(ci): unblock nightly release preflight checks | Merged |
| [#11](https://github.com/gannonh/kata-code/pull/11) | Add mobile Maestro E2E testing foundation | Merged |
| [#15](https://github.com/gannonh/kata-code/pull/15) | Add Pi coding agent provider support | Merged |
| [#17](https://github.com/gannonh/kata-code/pull/17) | feat(pi): add Pi coding agent provider support | Merged |
| [#20](https://github.com/gannonh/kata-code/pull/20) | feat(sandbox): Kata Environments / Deployments Phase 1 — container driver + Settings UI | Merged |
| [#22](https://github.com/gannonh/kata-code/pull/22) | feat(cursor): filesystem skill discovery and path-qualified invocation | Merged |
| [#25](https://github.com/gannonh/kata-code/pull/25) | feat(sandbox): environments/deployments Phase 2 — saved sandbox environments + setup pipeline | Merged |
| [#27](https://github.com/gannonh/kata-code/pull/27) | Docker sandbox phase 3a: provider CLIs, terminal fix, credential seeding | Merged |
| [#28](https://github.com/gannonh/kata-code/pull/28) | Add Vercel Sandbox cloud driver with keepalive, resume, and provider sign-in | Merged |
| [#33](https://github.com/gannonh/kata-code/pull/33) | Vercel GitHub source seeding for sandbox environments | Merged |
| [#34](https://github.com/gannonh/kata-code/pull/34) | feat: connection recovery, sandbox adopt, and E2E harness hardening | Merged |
| [#41](https://github.com/gannonh/kata-code/pull/41) | feat(sidebar): v2 attention tiers, Active/Idle lifecycle, and sandbox start fixes | Merged |
| [#44](https://github.com/gannonh/kata-code/pull/44) | feat(sandbox): Pi sandbox support, ModelRuntime, and shared GitHub source | Merged |
| [#45](https://github.com/gannonh/kata-code/pull/45) | chore(deps): bump the github-actions group with 5 updates | Merged |
| [#46](https://github.com/gannonh/kata-code/pull/46) | feat(claude): add Opus 5 / Sonnet 5 and fix stale custom models | Merged |
| [#47](https://github.com/gannonh/kata-code/pull/47) | fix(cursor): retry and surface Cursor retriable transport failures | Merged |
| [#48](https://github.com/gannonh/kata-code/pull/48) | fix(pi): preserve qualified slugs when model names collide | Merged |
| [#49](https://github.com/gannonh/kata-code/pull/49) | fix: misc cloud, sandbox, sidebar, and Pi extension model discovery | Merged |
| [#51](https://github.com/gannonh/kata-code/pull/51) | feat(task-workspaces): implement slice 1 walking skeleton | Merged |
| [#54](https://github.com/gannonh/kata-code/pull/54) | docs(task-workspaces): draft Slice 2 artifact workspace child plan | Closed |
| [#58](https://github.com/gannonh/kata-code/pull/58) | feat(task-workspaces): implement slice 2 artifact workspace | Merged |
| [#59](https://github.com/gannonh/kata-code/pull/59) | chore(deps): bump the pi-runtime group across 1 directory with 3 updates | Closed |
| [#60](https://github.com/gannonh/kata-code/pull/60) | feat(task-workspaces): make the workflow engine data-driven (Slice 3a) | Merged |
| [#61](https://github.com/gannonh/kata-code/pull/61) | feat(task-workspaces): Guided and Freeform presets with context budgeting (Slice 3b) | Merged |
| [#62](https://github.com/gannonh/kata-code/pull/62) | fix(task-workspaces): stabilize Slice 3 workflow behavior | Merged |
| [#63](https://github.com/gannonh/kata-code/pull/63) | feat(task-workspaces): implement Slice 4 Build checkpoints and amendments | Merged |
| [#66](https://github.com/gannonh/kata-code/pull/66) | feat(task-workspace): implement Guided task execution | Merged |
| [#69](https://github.com/gannonh/kata-code/pull/69) | docs: converge Task mode with shared Agent Runtime | Merged |
| [#71](https://github.com/gannonh/kata-code/pull/71) | feat(task-mode): accept Prototype A and fix Plan approval | Merged |
| [#78](https://github.com/gannonh/kata-code/pull/78) | Task mode conversation-plus-panel shell | Merged |
| [#83](https://github.com/gannonh/kata-code/pull/83) | fix(task-workspace): keep implementation tooling working in the task sandbox | Closed |
| [#88](https://github.com/gannonh/kata-code/pull/88) | feat(task-workspaces): task permissions choice for coding agent runs | Merged |
| [#93](https://github.com/gannonh/kata-code/pull/93) | chore(deps): bump the production-dependencies group across 1 directory with 7 updates | Closed |
| [#99](https://github.com/gannonh/kata-code/pull/99) | feat(task-cli): expose Task context through katacode CLI | Merged |
| [#100](https://github.com/gannonh/kata-code/pull/100) | Phase 2: Move Guided planning from MCP to Task CLI | Merged |
| [#101](https://github.com/gannonh/kata-code/pull/101) | Phase 3: Move Guided implementation to Task CLI | Merged |
| [#103](https://github.com/gannonh/kata-code/pull/103) | fix(task-workspace): settle Claude Task CLI completions across turn-id mismatch | Merged |
| [#107](https://github.com/gannonh/kata-code/pull/107) | fix(task-workspace): bind Task CLI completion aliases to active turns | Merged |
| [#110](https://github.com/gannonh/kata-code/pull/110) | fix(identity): Kata dock icon, katacode scheme, and bare sidebar | Merged |
| [#112](https://github.com/gannonh/kata-code/pull/112) | fix(release): restore nightly desktop startup and branding | Merged |
| [#114](https://github.com/gannonh/kata-code/pull/114) | feat(connect): adopt Kata wire identity and relay continuity | Merged |
| [#115](https://github.com/gannonh/kata-code/pull/115) | fix(desktop): restore Kata Code Connect sign-in | Merged |
| [#116](https://github.com/gannonh/kata-code/pull/116) | fix(desktop): let macOS quitAndInstall own the window close | Merged |
| [#117](https://github.com/gannonh/kata-code/pull/117) | docs(remote): document headless environment setup | Merged |
| [#120](https://github.com/gannonh/kata-code/pull/120) | fix: point server update and SSH tunnel flows at the Kata CLI | Merged |
| [#121](https://github.com/gannonh/kata-code/pull/121) | fix(connect): prevent truncated headless auth links | Merged |
| [#122](https://github.com/gannonh/kata-code/pull/122) | chore(skills): per-project plan-build-verify bootstrap | Merged |
| [#123](https://github.com/gannonh/kata-code/pull/123) | fix: add trailing newline to t3.json | Closed |
| [#126](https://github.com/gannonh/kata-code/pull/126) | feat(web): port T3 terminal Ghostty cluster | Merged |
| [#128](https://github.com/gannonh/kata-code/pull/128) | fix(branding): update Kata CLI names in user-facing copy | Merged |
| [#130](https://github.com/gannonh/kata-code/pull/130) | feat(web): port usage insights redesign | Merged |
| [#135](https://github.com/gannonh/kata-code/pull/135) | fix(client-runtime): recover environment queries after session replacement | Merged |
| [#136](https://github.com/gannonh/kata-code/pull/136) | fix(client-runtime): prevent oversized thread search crashes | Merged |
| [#137](https://github.com/gannonh/kata-code/pull/137) | fix(clients): default GitHub project clones to HTTPS | Merged |
| [#138](https://github.com/gannonh/kata-code/pull/138) | fix(client-runtime): retry auth-blocked reconnects during server-update resume | Merged |
| [#139](https://github.com/gannonh/kata-code/pull/139) | chore(release): prepare v0.0.42 | Merged |
| [#140](https://github.com/gannonh/kata-code/pull/140) | fix(ci): oxfmt craft workspace JSON configs breaking Check on main | Merged |
| [#149](https://github.com/gannonh/kata-code/pull/149) | fix(codex): accept 0.150 multi-agent resume values | Merged |
| [#150](https://github.com/gannonh/kata-code/pull/150) | fix(mobile): launch Kata Code Dev with Kata identity | Merged |
| [#151](https://github.com/gannonh/kata-code/pull/151) | feat(mobile): persist Settled and Snoozed shelf expansion | Merged |
| [#152](https://github.com/gannonh/kata-code/pull/152) | feat(mobile): preserve markdown image dimensions | Merged |
| [#153](https://github.com/gannonh/kata-code/pull/153) | docs(verify): keep verify-katacode map honest after live pass | Merged |
| [#154](https://github.com/gannonh/kata-code/pull/154) | fix(mobile): isolate Markdown image requests | Merged |
| [#155](https://github.com/gannonh/kata-code/pull/155) | fix(mobile): restore Android tablet thread controls | Merged |
| [#156](https://github.com/gannonh/kata-code/pull/156) | fix(mobile): keep first Android thread above composer | Merged |
| [#157](https://github.com/gannonh/kata-code/pull/157) | docs(github): route feature requests to a Kata issue form | Merged |
| [#158](https://github.com/gannonh/kata-code/pull/158) | docs(fork): document upstream T3 identifier policy | Merged |
| [#162](https://github.com/gannonh/kata-code/pull/162) | feat(sandbox): add Docker sandbox deployments | Merged |
| [#164](https://github.com/gannonh/kata-code/pull/164) | feat(sandbox): provision Docker sandboxes from Add Environment | Merged |
| [#165](https://github.com/gannonh/kata-code/pull/165) | feat(sandbox): resume Docker sandboxes across clients and restarts | Merged |
| [#166](https://github.com/gannonh/kata-code/pull/166) | fix(sandbox): publish the managed image to the authenticated Vercel project | Closed |
| [#167](https://github.com/gannonh/kata-code/pull/167) | fix(release): reject dual pulls of one sandbox index digest | Merged |
| [#168](https://github.com/gannonh/kata-code/pull/168) | fix(web): pin hosted Vercel deploy to katacode-web dist | Merged |
| [#169](https://github.com/gannonh/kata-code/pull/169) | fix(release): restore hosted credentials for Sandbox smoke | Merged |
| [#173](https://github.com/gannonh/kata-code/pull/173) | feat(cli): manage Kata Code on Fly Sprites | Merged |
| [#175](https://github.com/gannonh/kata-code/pull/175) | docs(verify): fix stale handles in the verify-katacode map | Merged |
| [#181](https://github.com/gannonh/kata-code/pull/181) | feat(sandbox): ship Docker sandboxes behind a preview flag | Open draft |
| [#182](https://github.com/gannonh/kata-code/pull/182) | chore(skills): install only project-specific skills | Merged |
| [#183](https://github.com/gannonh/kata-code/pull/183) | chore(skills): retarget plan-build-verify docs to plugin install | Closed |

## Local artifact status

This planning document is uncommitted. No product code was changed and no Build, release, PR readiness change or merge was initiated. GitHub issue bodies and states remain historical inbound records; Linear is the current authority.
