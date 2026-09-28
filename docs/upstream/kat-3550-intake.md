# KAT-3550 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `fc798afd2040f6791887f9f8d3fb45754718c1ac` (`origin/main` 2026-09-28T07:00Z) |
| Previous upstream pin  | `ab099178a7b7f9728843e90fc95ed90bb61d710d`                                   |
| Frozen upstream target | `d15210cd3da79f9a1a495a6309d912d76362a046` (frozen 2026-09-28T07:01Z)        |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20260928T070040Z-claude-mini` froze a range of 4 commits and 7 changed paths (5 modified, 1 added, 1 deleted). The previous pin is an ancestor of the target. The range adds no migrations, workflow files, binary assets, dependencies, or pnpm patches.

KAT-3532 landed the previous pin through PR #288 as merge commit `19d1e84be32c29bdd6fbaf51663b19499b711bd2`, so `ab099178a` is an ancestor of the Kata base and this run needs no squash-recovery anchor. `git merge-base --all HEAD d15210cd3` on the base returns exactly `ab099178a`. The three-way merge of `d15210cd3` is `9c623b03fa28bf1a1daaeaf6b7cc3c3b20e892f9`, with parents `fc798afd2` and `d15210cd3`.

## TAKE

Every commit in the range is taken.

| Upstream            | Change                                                                                         | Kata note                                  |
| ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `a727d1d976` #13932 | Delete `infra/relay/src/dbConfig.test.ts`, which restated a constant                           | Kata never edited the file                 |
| `de251fc297` #13935 | Onboarding enters the workspace after an incomplete history import, then reports it in a toast | New test imports `@kata-sh/code-contracts` |
| `94f92a7a38` #13999 | Claude Stop lets the SDK abort the turn, with a 3 s grace, before it closes the session        |                                            |
| `d15210cd3d` #13991 | The Usage cost summary moves the unpriced-records note into an info popover so the line holds  |                                            |

## SKIP

- Skip the squash-recovery anchor. The previous pin is already an ancestor of the base.
- Skip upstream `AGENTS.md`, user-visible T3 names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations. The range touches none of these.
- Keep deliberate cleanup: deleted `.repos`, `.plans`, `.macroscope`, and parked workflows. The range touches none of them.

## Identity mapping

The only new `@t3tools/*` import is in the new `apps/web/src/components/onboarding/WelcomeWizard.test.tsx`, which now imports `@kata-sh/code-contracts`. The new toast copy ("Some history was not imported", "Imported N threads") and the Usage popover label ("Unpriced usage details") name no product. Kata's wizard branding merged cleanly and stays: the "Set up Kata Code" title, the Kata icon identity, `Kata Code Connect`, and the `npx @kata-sh/code-cli@latest` commands. The `npx t3` mention in a `welcome.tsx` comment predates this range; FORK.md's identifier policy retains comments.

## Conflict resolutions

None. `git merge-tree --write-tree fc798afd2 d15210cd3` and the actual merge both reported no conflicts. The merge commit `9c623b03f` is not the bare automatic merge: it also carries the scope rename of the new test's import. Its tree differs from the merge-tree result (`e14f54047`) only in that one line of `WelcomeWizard.test.tsx`.

## Clean merges and new files

Clean merges and the new file received the same review as conflicts.

- `ClaudeAdapter.ts`: Kata's only edit to this file is the package scope. The new `settleInterruptedTurn` calls the SDK's `Query.interrupt` and waits up to 3 s for `completeTurn` before the existing `close`. It spawns no process and changes no environment or credential handling. Upstream's two new tests pass, along with the other 141 tests in the file.
- `WelcomeWizard.tsx`, `welcome.tsx`: `onDone` may now return a promise. The wizard awaits navigation before it shows the import toast. The inline import error and its "Continue without the rest" button are gone; "Do not import projects" finishes the import step. The Kata branding hunks do not overlap these changes.
- `UsagePage.tsx`: uses Kata's existing `Popover` (`openOnHover`, `tooltipStyle`) and `InlineButton` (`tone="muted"`).
- `infra/relay/src/dbConfig.test.ts`: deleted. `relayDatabaseMode` is unchanged, and the relay suite passes (39 files, 448 tests).

No retained owner in the Sprite CLI, process byte APIs, credential cleanup, provider isolation, the Cursor custom-endpoint guard, mixed-fleet adapters, the Linear OAuth broker, relay wire identity, the `SettingsScopeContext.tsx` optimistic-file fix, migrations, or desktop identity is in the range.

## Trusted assertions

Upstream edited no trusted assertion file. No `ci.yml` allowlist line changes.

## Changed retained outcomes

The checker reports three changed retained outcomes, all owned by `FORK.md` alone:

| Check                                | Changed owner | Disposition                                                  |
| ------------------------------------ | ------------- | ------------------------------------------------------------ |
| `product-identity-release-ownership` | `FORK.md`     | TAKE: pin advances to `d15210cd3`; identity tables unchanged |
| `connect-wire-identity`              | `FORK.md`     | TAKE: same pin-only edit                                     |
| `state-isolation`                    | `FORK.md`     | TAKE: same pin-only edit                                     |

## Independent review

An independent Opus review covered all 7 upstream paths three-way and the 6 paths in the pin commit. It found no blocker and no defect introduced by the merge. It asked for the changed-outcome table above and the note about the merge commit's tree. Its upstream-behavior follow-ups:

- A slow Claude Stop holds up other threads' commands for up to 3 s, because `ProviderCommandReactor` runs one serial worker for every thread. Filed as KAT-3551.
- If the interrupt wait is itself interrupted, `settleInterruptedTurn` leaves a stale `Deferred` on the session context. It is harmless: the next `completeTurn` resolves it with no waiter, and the next Stop replaces it. No action.
- If `completeOnboarding` succeeds but both navigations reject, the wizard shows "Could not finish setup" although the settings saved. Both navigations must fail, so this is improbable. No action.

## Pin consumers

`FORK.md`, both upstream-tip literals in `.github/workflows/ci.yml`, `docs/upstream/kat-3307-runbook.md`, and the live-tree `currentUpstreamSha` in `scripts/check-upstream-preservation.test.ts` advance to `d15210cd3`. `baselineUpstreamSha` stays at its historical pin, and the original root stays `6a687ee43`.
