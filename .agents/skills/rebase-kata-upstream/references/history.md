# Verified history and gotchas

These observations were checked against Kata main `0c2aa608219f35ae1254092fa81a25ff26aac6d3` on September 10, 2026. The last-integration record was checked on squash `e96c74aa48e7ae5b56b70db9b7a62096dc0df0d5` on September 20, 2026. The workflow-reference lesson was checked against that same squash on September 15, 2026. Resolve current paths and issue states before applying them. Repository documents are the detailed evidence; this file preserves lessons that change integration decisions.

## Last upstream integration

[KAT-3371 / PR #223](https://github.com/gannonh/kata-code/pull/223) integrated 107 upstream commits, from `36668dbe4fe2f8c881cc4f93bc675413eef1406f` to `47ace94962a714a561d7cfbdbaa4c721ef6b0598`. Kata freeze main was `b22872bd59d85b0ff64ad2cd7d5837c256057155`. It landed as squash `e96c74aa48e7ae5b56b70db9b7a62096dc0df0d5` with parent `af4a4ec39706fcffca53bf26b3168126bd5f6bd3` ([KAT-3301 / PR #224](https://github.com/gannonh/kata-code/pull/224)). On that commit, `git merge-base --is-ancestor 47ace94962a714a561d7cfbdbaa4c721ef6b0598 HEAD` is false. Original root remains `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`.

Read `docs/upstream/kat-3371-intake.md` and `docs/upstream/kat-3371-decisions.tsv`.

The previous integration [KAT-3329 / PR #212](https://github.com/gannonh/kata-code/pull/212) landed as merge commit `9926bc3db3ee0edc0579c289f7d9ce7f5c71bdbe`, so pin `36668dbe4fe2f8c881cc4f93bc675413eef1406f` was an ancestor of the Kata base. KAT-3371 intake recorded SKIP for the squash-recovery anchor for that reason. GitHub then squash-merged #223. The next run recovers pin `47ace94962a714a561d7cfbdbaa4c721ef6b0598` with `git merge --strategy=ours --no-ff` before merging the frozen tip, the same class as [KAT-3297 / PR #194](https://github.com/gannonh/kata-code/pull/194). Check ancestry after landing, not just on the PR branch.

Read `FORK.md` at the current Kata base for the live pin. This section records the KAT-3371 landing. It does not replace that table.

## Squash after SKIP of the recovery anchor

| Observed trap | Resolution to carry forward |
| --- | --- |
| Intake recorded SKIP for squash recovery because the previous pin was already an ancestor of the Kata base, then GitHub squash-merged the PR | After [KAT-3371 / PR #223](https://github.com/gannonh/kata-code/pull/223) landed as `e96c74aa48e7ae5b56b70db9b7a62096dc0df0d5`, `git merge-base --is-ancestor 47ace94962a714a561d7cfbdbaa4c721ef6b0598 HEAD` is false. The next intake recovers that pin even though this run recorded SKIP for the anchor. A pre-merge ancestor check does not prove post-squash ancestry. |

## Preserve behavior through refactors

| Observed trap | Resolution to carry forward |
| --- | --- |
| Kata and upstream both used migration IDs 41 and 42 | Preserve shipped Kata identities. Upstream operations 41–49 became 43–51. Compare current manifests and allocate new unused IDs each run; test existing-state upgrade, clean startup, and a second migration pass with no repeated operations. Do not hardcode the old offset. |
| Upstream process refactors omitted Kata callers' requirements | Preserve `ProcessRunner.runBytes`, `VcsProcess.runBytes`, replacement-environment semantics, credential byte cleanup, and unconditional sandbox bootstrap-token stripping, including overrides. Verify callers when APIs move. |
| UI extraction moved a retained behavior | Mobile image lifecycle guards moved into `ThreadMarkdownImage.tsx`. Preserve the behavior and its test in the new owner rather than keeping an obsolete implementation. |
| Export/SQLite refactors merged cleanly | Find Kata-only consumers and retained assertions even when upstream deletes or moves their source tests. Compilation and selected conflict tests alone are insufficient. |
| New upstream automation and assets entered the delta | Preserve active/parked workflow decisions, registry/release ownership, existing Kata artwork, and intentional deletions of `.repos`, `.plans`, devcontainer/reference debris. Review newly added files. |
| Browser preview improvements overlap Docker settings | Preserve Docker provisioning, credential/private-GitHub/resume behavior and shipped Sprite CLI. Keep `enableSandboxes` off by default, its supported override, and the current Experimental placement. Do not restart canceled feature work. |
| Codex cited AGENTS.md "Do not preserve backward compatibility" to delete TAKE mixed-fleet adapters | Keep `threadPullRequestCompatibility` `single` / `thread.meta.update` PR linking and `translateLegacyProjectOverridePatch` / `deriveLegacyProjectOverrides` while main still advertises `threadPullRequestLinking` and `projectAgentBrowserAccessOverrides`. Gannon KEEP on KAT-3329 PR #212 (`r3996918967`, `r3996919018`). Mixed fleet is the TAKE. |

## Workflow takes inherit upstream's jobs

[KAT-3371 / PR #223](https://github.com/gannonh/kata-code/pull/223) landed as `e96c74aa48` and took upstream `release.yml` and `release-desktop.yml` wholesale. References to infrastructure Kata had parked, deleted, or never taken came with them, and GitHub rejected the entire release workflow before any job ran:

| Reintroduced reference | Why it is wrong in Kata | Observed failure |
| --- | --- | --- |
| `publish_aur` job calling `./.github/workflows/publish-aur.yml` | The file is parked at `.github/disabled/publish-aur.yml` (`e917fb7edf`, `packaging/aur/README.md`). | `Invalid workflow file: .github/workflows/release.yml#L1043 ... failed to fetch workflow: workflow was not found`. No job in the file loads. |
| Three steps using `./.github/actions/setup-apt-mirrors` | Kata keeps no `.github/actions/`; `e917fb7edf` removed Blacksmith runners, and `ci.yml` installs packages without a mirror step. | The three jobs would fail once the file loads. |
| `announce_discord` job running `scripts/notify-discord-release.ts` | `931cd1c539` deleted the script and test, and the KAT-3297 intake records the tooling as a SKIP. | `continue-on-error` hid the missing-script failures. |
| `resolve_commit` requiring `./.github/scripts/check-nightly-release.cjs` | `df0776ad66` deleted the script as then-unused, but the taken `release.yml` calls it and the nightly gap and stable-from-nightly logic are live behavior. | Post-merge nightly dispatch failed: `Cannot find module .../.github/scripts/check-nightly-release.cjs`. The fix restores the script and test from upstream rather than deleting the call. |

Resolution: delete inherited jobs and steps that depend on parked or deleted infrastructure, restore upstream scripts a taken job genuinely needs, and drop the matching doc claims (the AUR and Discord lines in `docs/operations/release.md`). A clean merge of an upstream workflow file is not evidence that its jobs belong in Kata. Before committing a workflow take, compare every job against `.github/disabled/README.md`, prior deletion commits, and intake SKIP entries, then resolve every `uses: ./...` path, every `require()`/`import()` path inside inline `github-script` blocks, and every script path in `run:` steps against the candidate tree. `scripts/check-workflow-references.mjs` performs these scans, and CI runs it plus its `node:test` suite in the Check job and the restored nightly gate test in the Test job.

## Branding repair exposed missing coverage

[KAT-3306 / PR #196](https://github.com/gannonh/kata-code/pull/196), landed as `1206a9be79`, repaired visible T3 copy after #194. Missed surfaces included Settings and search, boot errors, client labels, native capture, mobile onboarding, work logs, and release links.

Use `docs/product-branding.md`, `scripts/check-product-branding.mjs`, and exact exceptions in `docs/branding-exceptions.json`. The scanner covers new source files but cannot prove artwork or every assembled string. Inspect rendered Settings and new assets. Keep private symbols, storage keys, wire identifiers, OAuth destinations, and explicit FORK.md exceptions; broad T3 replacement can break behavior.

The intake rejected six new Android T3 PNGs and retained existing Kata launcher/splash assets. Pre-existing monochrome artwork remained KAT-3301. Re-read that issue instead of assuming it has been fixed or copying historical acceptance claims.

## Preservation gate replaced weak evidence

[KAT-3307 / PR #201](https://github.com/gannonh/kata-code/pull/201), landed as `851fc94d00`, adds the inventory and exact-candidate gate. Read `docs/upstream/kat-3307-runbook.md` and `retained-behavior.v1.json`.

The validator reads the candidate's FORK.md dynamically. CI repeats the upstream tip in separate fetch and checker environments. Advance both with the pin. Preserve the checker's trusted-base execution. The gate's `upstreamBase` is the original root, not the preceding intake tip. The gate does not prove Git ancestry; check it separately.

Historical browser evidence proved Kata pairing/title and unchecked sandbox preview. It did not exercise a provider response or native mobile/desktop. The later baseline recorded 29 portable checks passing and three manual checks `NOT RUN`. Those historical receipts cannot satisfy a new candidate's mandatory live checks.

Local #194 subprocess/socket failures came from environment permissions. The tests passed with normal process permissions without runtime workarounds. The local node-pty addon needed its install script and the launcher helper needed `lsof`. Match current prerequisites before diagnosing a product regression.

The old web recipe expected an empty home, but runtime auto-created a CWD project. Observe current launch behavior and use the current pairing helper. Never consume a token intended for another client or point a verification run at user state.

## Add a lesson after landing

For each new, demonstrated trap, record the issue/PR and merged SHA, observed failure, corrective decision, and verifying check. Edit an existing entry when the new result supersedes it. Put full run narratives in repository intake/verification documents, not here. A rehearsal finding must be labeled as rehearsal evidence until observed in a real integration.
