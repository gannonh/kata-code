# Verified history and gotchas

These observations were checked against Kata main `0c2aa608219f35ae1254092fa81a25ff26aac6d3` on September 10, 2026. Resolve current paths and issue states before applying them. Repository documents are the detailed evidence; this file preserves lessons that change integration decisions.

## Last upstream integration

[KAT-3297 / PR #194](https://github.com/gannonh/kata-code/pull/194) integrated 1,105 upstream commits, from `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f` to `12391bd0d38eef6655b7a9f8945d0cb5febadc2b`. Kata's starting main was `22c5c9c04526199a93fa938d82b5f0fdb8fa8b5e`. Its dry merge reported 443 content conflicts plus deletion/location conflicts.

Read these repository files for particular conflicts:

- `docs/upstream/kat-3297-intake.md` defines the range, retained features, and TAKE/SKIP decisions.
- `docs/upstream/kat-3297-decisions.tsv` records resolutions and superseding corrections. Later entries can correct earlier decisions.
- `docs/upstream/kat-3297-verification.md` separates tests, build results, and limited browser observations.

The landed commit `31828c7463c75197e288c6f52bff77c2c99a93fe` has only the Kata starting main as a parent. Squashing discarded the upstream ancestry described by the intake. `git merge-base main 12391bd0d...` still returns the original fork root at the observed baseline. Follow the guarded previous-pin anchor in [Git procedure](git-integration.md) instead of replaying the old intake. Check ancestry after landing, not just on the PR branch.

## Preserve behavior through refactors

| Observed trap | Resolution to carry forward |
| --- | --- |
| Kata and upstream both used migration IDs 41 and 42 | Preserve shipped Kata identities. Upstream operations 41–49 became 43–51. Compare current manifests and allocate new unused IDs each run; test existing-state upgrade, clean startup, and a second migration pass with no repeated operations. Do not hardcode the old offset. |
| Upstream process refactors omitted Kata callers' requirements | Preserve `ProcessRunner.runBytes`, `VcsProcess.runBytes`, replacement-environment semantics, credential byte cleanup, and unconditional sandbox bootstrap-token stripping, including overrides. Verify callers when APIs move. |
| UI extraction moved a retained behavior | Mobile image lifecycle guards moved into `ThreadMarkdownImage.tsx`. Preserve the behavior and its test in the new owner rather than keeping an obsolete implementation. |
| Export/SQLite refactors merged cleanly | Find Kata-only consumers and retained assertions even when upstream deletes or moves their source tests. Compilation and selected conflict tests alone are insufficient. |
| New upstream automation and assets entered the delta | Preserve active/parked workflow decisions, registry/release ownership, existing Kata artwork, and intentional deletions of `.repos`, `.plans`, devcontainer/reference debris. Review newly added files. |
| Browser preview improvements overlap Docker settings | Preserve Docker provisioning, credential/private-GitHub/resume behavior and shipped Sprite CLI. Keep `enableSandboxes` off by default, its supported override, and the current Experimental placement. Do not restart canceled feature work. |

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
