# Verify the current integration

Read the current trusted `docs/upstream/kat-3307-runbook.md`, retained inventory, checker source, and active CI workflow. Derive commands from these sources. Historical counts and Node versions are not acceptance targets.

## Preserve independent checks

CI archives `scripts/check-upstream-preservation.ts` and `scripts/lib/` from the PR base and executes that checker against the candidate tree. Reproduce this trusted-base approach locally for `ci` and `human-review` modes. Preserve the workflow's dependency setup. Do not validate a candidate exclusively with a checker it modified.

The checker validates the new tip against the candidate's `FORK.md`. Its `--upstream-base` remains the original fork root. At the September 10 baseline, CI has separate fetch and checker environment literals for tip and root. Keep them consistent with FORK.md. A pin update does not require weakening validation.

Use a clean checkout whose HEAD equals the full candidate SHA. Commit changes before creating evidence. Store live records under ignored `uat-evidence/<run-id>/`. Follow the runbook's evidence schemas; checked-in `.example.json` files cannot satisfy live evidence.

Each changed retained outcome needs exact changed owner paths, disposition, rationale, legitimate approver, timestamp, and evidence binding. Mandatory manual checks need current observations. Use the actual agent identity when agent approval is authorized; never invent human approval. Bind artifacts to the exact base, candidate, upstream, original root, and check ID. Produce contents and digests from real observations. A valid digest proves record consistency, not that behavior was exercised.

## Run required checks

Run current formatting/lint, typecheck, unused-code checks, CI test partitions including server shards, desktop build, and preload verification. Install pinned tools and dependencies in the isolated workspace. Resolve environment failures before interpreting product failures. Do not skip a failing shard because a targeted rerun passed.

Run branding checks and inspect new user-facing strings and asset references across shipped web, desktop, mobile, and CLI. Keep exact exceptions narrow. Run all mandatory retained-outcome checks, including files without conflicts. Do not delete or weaken inventory entries and tests to accept a changed implementation.

Read and use the available project verification skills:

- `.agents/skills/verify-katacode/SKILL.md` for a disposable web stack and captured observations.
- `.agents/skills/test-t3-app/SKILL.md` for current pairing mechanics when an older recipe disagrees with runtime behavior.
- `.agents/skills/test-t3-mobile/SKILL.md` for a compatible device or simulator, including Android when the changed behavior is Android-specific.

Obtain a fresh token for each client. Keep credentials out of screenshots and durable logs. Never run migrations against user state. Pairing, landing, Settings connections/search, preview gating, and a real provider interaction need evidence where the inventory requires it. Exercise native desktop/mobile and macOS Icon Composer where required; a browser screenshot cannot prove those results.

The September 10 baseline records 29 portable passes and three manual checks as `NOT RUN`, including pre-existing Android monochrome asset issue KAT-3301. Read its live status. Historical debt does not permit skipping the current gate. Identify prerequisite work early and follow its own authorization.

`ci` accepts automated checks. `baseline` is observational. `human-review` also requires mandatory live evidence and dispositions. Missing mandatory evidence blocks advancement despite green GitHub checks. Keep redacted artifacts available after local cleanup through an approved durable evidence destination.

After extracting the trusted checker as CI specifies, run this from the clean candidate checkout. All variables must resolve to the frozen full SHAs and actual records for this candidate:

```bash
node "$trusted_root/scripts/check-upstream-preservation.ts" \
  --mode human-review \
  --candidate "$candidate" --base "$base" \
  --upstream "$upstream" --upstream-base "$root_pin" \
  --integration-record "uat-evidence/$run_id/integration-record.json" \
  --manual-evidence "uat-evidence/$run_id/manual-evidence.json"
```

Require exit code zero and `HUMAN_REVIEW_ACCEPTANCE status=PASS`. GitHub PR CI may use a synthetic merge SHA; its receipt does not replace these exact-candidate records.

## Finish review and merge

Review the full fork delta and all required GitHub checks and conversations for the exact PR head. Resolve every thread with a fix or an evidence-backed reply. Follow the live Linear state and explicit issue-specific authority.

In Merging, re-read remote main and the PR head. Verify they match the accepted base and candidate, the PR is ready and mergeable, and every check and conversation gate passes. Use a head-matching request, such as `gh pr merge <number> --repo gannonh/kata-code --merge --match-head-commit <candidate-sha>`. Honor branch protection and merge queues. This head guard does not lock the base; base advancement requires revalidation. Success requires an actual reported merge.

Fetch and inspect the landed commit. A merge commit differs from the reviewed candidate SHA; compare its tree and parents. If its tree differs, run acceptance against that landed tree. Record post-merge results and pin read-back in Linear. Preserve failures and open or reopen the appropriate repair issue when an AC did not land. Finish SKILL.md's learning step before declaring completion.
