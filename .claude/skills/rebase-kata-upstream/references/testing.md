# Test changes to this skill

Validate SKILL.md with skill-creator's `scripts/quick_validate.py` when available. Check referenced resources and instructions as well; structural validation cannot prove safe Git behavior.

Use an independent agent for a behavioral rehearsal. Give it this skill, a realistic task, and the minimum raw fixture or repository snapshot. Do not supply expected answers or suspected failures. Give it an isolated output directory. Disable remote writes and prohibit production Linear/GitHub mutations. Keep the original checkout untouched.

## Exercise the repeated Git workflow

Construct a small local Git repository with an upstream root, a branded Kata fork containing an extra feature and a deliberately deleted upstream file, and a prior upstream update landed as a squash. Put the prior pin and its actual intake record in the fixture. Add a next upstream update touching the branded file, the deleted file, and ordinary upstream functionality.

Ask the agent to use this skill to integrate the next update and then a second update locally. Inspect actual trees and commit parents. Check that the Kata feature, identity, and intentional deletion survive; new upstream behavior arrives; the old main remains an ancestor; and the latest pin is an ancestor. Confirm the third invocation with an unchanged tip creates no new commit.

Repeat relevant cases when changing the Git procedure: an already-unsquashed history, a mismatched pin/intake, divergent upstream, a half-resolved owned merge, and an advanced Kata main. Verify observed stops or resumptions. Do not claim unexecuted cases passed.

## Exercise decision gates

Give a fresh agent a candidate with green portable checks but missing mandatory device evidence. Inspect whether it advances or merges. Separately provide a Human Review issue, an already-merged PR with unfinished learning, and stale candidate-bound receipts. Confirm that the agent follows the live lifecycle and actual evidence. Use fixture records rather than changing real issues.

For ownership changes, launch two simultaneous lock acquisitions against one temporary coordinator. Exactly one may succeed. Verify that a duplicate leaves the run record unchanged, release preserves the record, and reacquisition resumes pending learning. Missing owner metadata must not trigger automatic lock removal. A local lock cannot prove coordination across hosts.

Invoke the skill without a mode and verify that the agent selects Preflight without external mutations. Check that the routine's configured canonical skill source receives reference-only lesson updates and that its recorded content digest changes. Do not report lesson promotion complete for an unverified remote copy.

## Rehearse on current Kata history

Clone current Kata into a temporary directory and disable pushes. Freeze fresh origin/upstream SHAs. Compare the ordinary merge base with the documented previous pin. Test the ancestry anchor and assert identical trees before and after. Inspect a merge-tree or conflict census for the next fixed upstream interval without landing it.

Run the actual application and preservation checks only when that integration rehearsal includes a reviewable candidate and the required environment. A successful graph rehearsal proves Git mechanics, not feature retention, full CI, device behavior, or autonomous production landing.

Keep evaluation prompts, command outputs, before/after SHAs, and actual outcomes in a local evaluation directory outside the product checkout. Report observed failures, revise the narrow instruction responsible, and rerun the affected case. Preserve verification limits when reporting readiness for a twice-weekly routine.
