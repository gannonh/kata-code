# KAT-3411 upstream intake

## Frozen refs

| Value                  | Commit                                     |
| ---------------------- | ------------------------------------------ |
| Kata base              | `7fad04511b62b0897ce8db989cb98f2edd12cc02` |
| Previous upstream pin  | `47ace94962a714a561d7cfbdbaa4c721ef6b0598` |
| Frozen upstream target | `0150c6a53b409ba3bcb45645709b649cf8708354` |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f` |

Run `kat-upstream-20260917T071749Z-cursor-cloud` froze a range of 130 commits and 751 changed paths. Reverse commits: 0.

KAT-3371 landed the previous pin through PR #223 as squash `e96c74aa48e7ae5b56b70db9b7a62096dc0df0d5`. `docs/upstream/kat-3371-intake.md` and `FORK.md` at the Kata base account for pin `47ace94962a714a561d7cfbdbaa4c721ef6b0598`. That pin is not an ancestor of `origin/main`. This run recorded it with `git merge --strategy=ours --no-ff` as `ca3309803c130f5cb87810de7bd8561396ad66a0` (tree unchanged versus the Kata base), then started a normal three-way merge of the frozen tip. `git merge-base --all HEAD upstream` after the anchor was exactly the previous pin.

KAT-3377 remains Todo waiting Start and is not this run's Build.

## TAKE

- Take current upstream product changes in CLI installer/update progress, storage cleanup, worktree setup, multi-model new threads, command-palette search (PRs, usage, thread IDs, keybindings), default Tiptap composer, Android Material layouts, usage limits, custom snooze, project cloning, theme picker, pull-request comments/diffs/media, folder-drop, and related tests. Adapt packages, binaries, workflows, and documentation to Kata-owned names and repositories.
- Take upstream migration `052_ProjectionThreadTitleState` as Kata migration `056`. Kata already owns 041–055, including 052 `ProjectionThreadPullRequests`.
- Take `.github/scripts/stage-preview-bundle.py` and its test because `ci.yml` calls them.
- Take Clerk catalog `4.6.8` and the matching patch. Keep Kata's `alchemy@2.0.0-beta.76` pin.
- Take `relay_client_tracing` on `release-desktop.yml` while keeping Kata `dry_run`.
- Take new tests and current documentation for accepted functionality after applying Kata identity and operator-interface rules.

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

Build verification uses the checker and inventory archived from the frozen Kata base. Required checks include formatting and lint, typecheck, unused-code checks, CI test partitions, desktop build, preload verification, branding, ancestry, workflow-reference scan, and the preservation checker. Mandatory live browser, device, provider, Android artwork, and macOS Icon Composer evidence remains `NOT RUN` until exercised against an exact candidate.
