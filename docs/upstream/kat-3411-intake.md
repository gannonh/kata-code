# KAT-3411 upstream intake

## Frozen refs

| Value                  | Commit                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Kata base              | `2eb3b14fa4662ed3824be818d5e285ead63696ca` (updated from `5b7fa4dc4f251e83d7562c5223d295f005de94ca` after Gannon merged origin/main KAT-3415; earlier freeze `7fad04511b62b0897ce8db989cb98f2edd12cc02`) |
| Previous upstream pin  | `47ace94962a714a561d7cfbdbaa4c721ef6b0598`                                                                                      |
| Frozen upstream target | `0150c6a53b409ba3bcb45645709b649cf8708354`                                                                                      |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                                                                      |

Run `kat-upstream-20260917T071749Z-cursor-cloud` froze a range of 130 commits and 751 changed paths. Reverse commits: 0.

KAT-3371 landed the previous pin through PR #223 as squash `e96c74aa48e7ae5b56b70db9b7a62096dc0df0d5`. `docs/upstream/kat-3371-intake.md` and `FORK.md` at the Kata base account for pin `47ace94962a714a561d7cfbdbaa4c721ef6b0598`. That pin is not an ancestor of `origin/main`. This run recorded it with `git merge --strategy=ours --no-ff` as `ca3309803c130f5cb87810de7bd8561396ad66a0` (tree unchanged versus the Kata base), then started a normal three-way merge of the frozen tip. `git merge-base --all HEAD upstream` after the anchor was exactly the previous pin.

KAT-3377 remains Todo waiting Start and is not this run's Build.

On 2026-09-18 resume, `origin/main` had advanced by KAT-3390 (`fbbf8f276`), KAT-3392 (`fae7dbdb6`), and KAT-3391 (`5b7fa4dc4`). The frozen upstream target stays `0150c6a53b409ba3bcb45645709b649cf8708354` (do not chase `upstream/main` `74796256868916da550ecbe9b5e37d359a8cb321`). Merge `f80e90a1b5cc5db19aa46be9dc838e453b433c03` parents `35d45f93800c85c61d9ad9f7ead1606b6ef853f6` + `5b7fa4dc4f251e83d7562c5223d295f005de94ca`. The only content conflict was `.opencode/skills/build/scripts/user-acceptance/verify-evidence.mjs` (Set vs array membership). Routine files auto-merged identically to origin/main.

On 2026-09-20 resume (`kat-upstream-20260920T070134Z-cursor-cloud`), keep the same frozen upstream target (do not chase observed `upstream/main` `7445aa733ada33e45289e5aa5055f79142556513`). Gannon merged origin/main into the issue branch as `33d49ea8ddcf80ffa3bbaf3418ecbb1dea11b525` (parents `6f4a18b5512d0890174e461a4f21958bd22749ee` + `2eb3b14fa4662ed3824be818d5e285ead63696ca`, KAT-3415 Linear OAuth broker). The merge kept upstream TAKEs that main does not yet have (`reasoningMessages` on `environmentHttp.ts`, Android `activity_chip` on FCM payloads). `packages/contracts/src/wireIdentity.ts` matches origin/main, including Kata `kata-cloud-linear-oauth+jwt`. New Kata base is `2eb3b14fa4662ed3824be818d5e285ead63696ca`. `git merge-base --all HEAD 0150c6a53` remains the frozen tip.

## TAKE

- Take current upstream product changes in CLI installer/update progress, storage cleanup, worktree setup, multi-model new threads, command-palette search (PRs, usage, thread IDs, keybindings), default Tiptap composer, Android Material layouts, usage limits, custom snooze, project cloning, theme picker, pull-request comments/diffs/media, folder-drop, and related tests. Adapt packages, binaries, workflows, and documentation to Kata-owned names and repositories.
- Take upstream migration `052_ProjectionThreadTitleState` as Kata migration `056`. Kata already owns 041–055, including 052 `ProjectionThreadPullRequests`.
- Take `.github/scripts/stage-preview-bundle.py` and its test because `ci.yml` calls them.
- Take Clerk catalog `4.6.8` and the matching patch. Keep Kata's `alchemy@2.0.0-beta.76` pin.
- Take `relay_client_tracing` on `release-desktop.yml` while keeping Kata `dry_run`.
- Take new tests and current documentation for accepted functionality after applying Kata identity and operator-interface rules.
- Take origin/main KAT-3390 stale-revision routine save copy, KAT-3392 environment-scoped routine identity, and KAT-3391 offline mutation gating. Keep the integration branch's Set membership checks in `verify-evidence.mjs`.
- Take origin/main KAT-3415 Kata-owned Linear OAuth broker on the Connect relay (`kata-cloud-linear-oauth+jwt`, `/api/connect/linear-oauth`, `LINEAR_OAUTH_CLIENT_*` on `deploy-relay.yml`). Keep frozen-range extras that three-way-merged with that drop.

## SKIP

- Skip upstream `AGENTS.md` and modified `.macroscope` instruction files. Kata deliberately owns lifecycle instructions; upstream instructions are review material.
- Skip user-visible T3 product names, upstream package scope (`@t3tools` → `@kata-sh/code-*`), CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations.
- Skip changes that remove Kata Docker and Sprite behavior, the disabled-by-default sandbox preview, `ProcessRunner`/`VcsProcess.runBytes`, credential cleanup, provider isolation, or the retained mixed-fleet adapters (`threadPullRequestCompatibility`, `translateLegacyProjectOverridePatch`).
- Skip reintroduction of deleted `desktop-macos-preview.yml`, `desktop-macos-preview-publish.yml`, ios-debugger-agent SKILL, and `VOUCHED.td`.
- Skip inherited `publish_aur`, `setup-apt-mirrors`, and `notify-discord` jobs/steps. They remain absent from active workflows.
- Skip upstream artwork where it would replace current Kata channel assets. KAT-3301 remains the separate owner of the existing Android monochrome artwork defect.
- Keep deliberate repository cleanup, including deleted `.repos`, `.plans`, and upstream-only automation outside Kata's active or parked workflow policy.
- Marketing (`apps/marketing/**`) stays T3-shaped. Branding-exception comments stay exact; add only a new exact comment exception when upstream introduces a matching internal comment.

## Retained-outcome review

The upstream range changes retained owners for product and release identity, portable assets, desktop environment and protocol behavior, sandbox route registration, migration identity, browser sessions, updates, window behavior, desktop packaging, launcher identity, Android config, mobile project cloning, and mobile themes. Each candidate path gets an exact `TAKE` or `SKIP` disposition in `kat-3411-decisions.tsv`.

Shared contracts, package manifests, the lockfile, workflow ownership, and migration numbering remain sequential review points. Clean merges and new files receive the same review as conflicts, including `@t3tools` remaps on auto-merged files.

## Verification

Build verification uses the checker and inventory archived from the current Kata base (`2eb3b14fa4662ed3824be818d5e285ead63696ca`). Required checks include formatting and lint, typecheck, unused-code checks, CI test partitions, desktop build, preload verification, branding, ancestry, workflow-reference scan, and the preservation checker. Trusted-base `--mode ci` and GitHub Actions receipts bound to superseded candidates `6f4a18b5512d0890174e461a4f21958bd22749ee`, `35d45f93800c85c61d9ad9f7ead1606b6ef853f6`, `cd2a5746fb6756c0db5b55091987517fbe19aefb`, and `36427e288d5e62d286979cf873c3709a0f16af7c` are invalid after the KAT-3415 main merge. Portable CI on merge `33d49ea8ddcf80ffa3bbaf3418ecbb1dea11b525` (Actions run 35479196608) is valid only for that SHA. Mandatory live browser, device, provider, Android artwork, and macOS Icon Composer evidence remains `NOT RUN` until exercised against an exact candidate.
