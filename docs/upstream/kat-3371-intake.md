# KAT-3371 upstream intake

## Frozen refs

| Value                  | Commit                                     |
| ---------------------- | ------------------------------------------ |
| Kata base              | `b22872bd59d85b0ff64ad2cd7d5837c256057155` |
| Previous upstream pin  | `36668dbe4fe2f8c881cc4f93bc675413eef1406f` |
| Frozen upstream target | `47ace94962a714a561d7cfbdbaa4c721ef6b0598` |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f` |

Run `kat-3371-20260914T175002Z-codex-sartre` froze a range of 107 commits and 815 changed paths. A merge-tree review reported 144 conflicted paths.

KAT-3329 landed the previous pin through PR #212 at `9926bc3db3ee0edc0579c289f7d9ce7f5c71bdbe`. KAT-3347 landed that run's lesson through PR #217 at `a03743dfebf42b515656c65cad29f54ae51f6121`. The previous pin is an ancestor of the Kata base and the frozen target. Their only merge base is the previous pin, so this run does not need a synthetic ancestry anchor.

## TAKE

- Take the self-contained CLI archive, update, uninstall, service, WSL, remote preview, and release improvements. Adapt packages, binaries, workflows, and documentation to Kata-owned release names and repositories.
- Take the desktop local-environment switch, WSL runtime work, preview input fixes, notification badges, recovery behavior, and related tests.
- Take the web composer context, attachments, file previews, compact sidebar, pull-request routing, notification, recovery, accessibility, and environment-settings work.
- Take the mobile native composer context, attachments, file browsing, crash diagnostics, subscription widget, license notices, review comment, and rendering fixes.
- Take the server authentication, reusable development token, release-runtime, terminal-output, source-control routing, pull-request, and workspace improvements.
- Take upstream migration 051 `ProjectionThreadMessageContext` as Kata migration 054. Kata already owns migrations 041, 042, and 053, and the prior integration occupies 043 through 052.
- Take new tests and current documentation for accepted functionality after applying Kata identity and operator-interface rules.

## SKIP

- Skip upstream `AGENTS.md` and modified `.macroscope/check-run-agents` files. Kata deliberately removed those files, and upstream instructions do not become authority for this run.
- Skip user-visible T3 product names, upstream package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations. Apply the current Kata identity policy to taken functionality.
- Skip changes that remove Kata Docker and Sprite behavior, the disabled-by-default sandbox preview, process byte APIs, credential cleanup, provider isolation, or the retained mixed-fleet adapters.
- Skip upstream artwork where it would replace current Kata channel assets. KAT-3301 remains the separate owner of the existing Android monochrome artwork defect.
- Keep deliberate repository cleanup, including deleted `.repos`, `.plans`, and upstream-only automation that is outside Kata's active or parked workflow policy.

## Retained-outcome review

The upstream range changes retained owners for product and release identity, portable assets, desktop environment and protocol behavior, sandbox route registration, migration identity, browser sessions, updates, window behavior, desktop packaging, launcher identity, Android config, mobile project cloning, and mobile themes. Each candidate path gets an exact `TAKE` or `SKIP` disposition in `kat-3371-decisions.tsv` and in candidate-bound machine evidence.

Shared contracts, package manifests, the lockfile, workflow ownership, and migration numbering remain sequential review points. Clean merges and new files receive the same review as conflicts.

## Verification

Build verification uses the checker and inventory archived from the frozen Kata base. Required checks include formatting and lint, typecheck, unused-code checks, CI test partitions, desktop build, preload verification, branding, ancestry, and the preservation checker. Mandatory live browser, device, provider, Android artwork, and macOS Icon Composer evidence remains `NOT RUN` until exercised against an exact candidate.
