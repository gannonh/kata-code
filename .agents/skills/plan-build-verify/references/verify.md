# Verify Workflow

Use this workflow to validate completed implementation against the approved spec, Build completion report, and acceptance criteria.

Verify is the third phase in Plan → Build → Verify. It produces acceptance evidence and a signoff recommendation.

## Step 1: Gather inputs

- Spec path with status `Implemented`, or an approved spec plus Build completion evidence.
- Completed implementation or branch to verify.
- Build completion report when available.
- Acceptance criteria from the spec.

If the user asks for UAT, signoff, merge readiness, or proof that work is complete, start here.

## Step 2: Verify against acceptance criteria

- Use the `user-acceptance` skill to verify the **Acceptance criteria** from the spec.
- Follow `user-acceptance` instructions for evidence capture, UAT reporting, screenshots, recordings, command output, and human test guides.
- Use an explicit **acceptance-criteria matrix** in the final report.
- Each criterion should show the verification method, result (`Pass`, `Fail`, `Blocked`, or `Not tested`), and evidence path or note -- This keeps Verify tied to the approved scope instead of only producing a general UAT summary.

If `user-acceptance` is unavailable, stop and alert the user that the preferred verification workflow is missing, then offer to run the standalone workflow below.

The `user-acceptance` skill is available here if it needs to be installed: <https://github.com/gannonh/skills/tree/main/user-acceptance>

## Step 3: Verify the report and fill in gaps

- Task a subagent to verify the `uat-evidence` against the spec's acceptance criteria
- Fill in any gaps before presenting the final report to the user.

## Stop and ask

Ask before proceeding when:

- The approved spec cannot be found.
- Acceptance criteria are missing or ambiguous.
- Required credentials, services, or devices are unavailable.
- Verification would run destructive commands.
- The branch has unrelated changes that make evidence unreliable.
