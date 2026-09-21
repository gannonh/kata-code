# KAT-3432 upstream intake

## Frozen refs

| Value                  | Commit                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| Kata base              | `af0d264336d2707cd98bdd57a59feca652e24033` (`origin/main` after KAT-3377 PR #244) |
| Previous upstream pin  | `c14f6015bfe479d313355cb234af1a5c16dbb15f`                                        |
| Frozen upstream target | `b379b5b1407b4c718095cd13395173b6cc005218`                                        |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                        |

Run `kat-upstream-20260921T071320Z-cursor-cloud` froze a range of 40 commits and 180 changed paths. Reverse commits: 0. None of the paths are under `.repos/`.

KAT-3411 landed the previous pin through PR #239 as squash `8b5a83d06198cb4dfec5da735217c09310c00796`. `docs/upstream/kat-3411-intake.md` and `FORK.md` at the Kata base account for pin `c14f6015bfe479d313355cb234af1a5c16dbb15f`. That pin is not an ancestor of `origin/main`. This run recorded it with `git merge --strategy=ours --no-ff` as `14a398ab16dac89400f4b22e9e2db32e8aacac06` (tree unchanged versus the Kata base), then started a normal three-way merge of the frozen tip. `git merge-base --all HEAD upstream` after the anchor was exactly the previous pin.

KAT-3429 remains Todo waiting Start and is not this run's Build. KAT-3377 is Done.

## TAKE

- Recover squash-lost previous-pin ancestry for `c14f6015b`, then merge frozen tip `b379b5b`.
- Take current upstream product changes in web sidebar/composer/PR/device UI, undo for settle/snooze/archive/unpin, device toolchain and update discovery, iOS shutdown recovery, mobile review diffs and device streams, server device/PR/observability per-signal export, and related tests. Adapt packages to `@kata-sh/code-*`.
- Take relocated native device-stream tests in `packages/client-runtime/src/device/stream.test.ts` and delete the Kata-modified web copy `apps/web/src/components/device/deviceStream.test.ts`.
- Take upstream network-access confirmation copy, rewritten to Kata Code / Kata Code Connect.
- Take new tests and current documentation for accepted functionality after applying Kata identity and operator-interface rules.
- Preserve KAT-3423 bare sidebar header, `sandboxes-preview`, Sprite CLI, GitHubCli discovery APIs, routines RPC, and shipped Kata migration IDs `041`-`057`. This freeze contains no new migrations.

## SKIP

- Skip upstream `AGENTS.md` and `.macroscope` instruction files. None appear in this range.
- Skip user-visible T3 product names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations.
- Skip changes that remove Kata Docker and Sprite behavior, the disabled-by-default sandbox preview, process byte APIs, credential cleanup, provider isolation, mixed-fleet adapters, or GitHubCli discovery APIs.
- Skip upstream artwork replacement. KAT-3301 remains the separate owner of Android monochrome artwork.
- Keep deliberate repository cleanup (deleted `.repos`, `.plans`, parked workflows).

## Conflict resolutions

23 unmerged paths. Most were `@t3tools` vs `@kata-sh/code-*` import conflicts; TAKE upstream symbols remapped to Kata packages. Additional behavior resolutions:

- `DeviceService.shutdownDevice`: TAKE upstream iOS serve-sim shutdown and already-off recovery.
- `DeviceService.test.ts`: KEEP Kata iOS stream-attach rejection coverage and TAKE upstream capture-release / already-off shutdown tests. Fixture accepts both `inspectError` and `streamAttachError`.
- `ConnectionsSettings` network-access dialog: TAKE upstream explanation with Kata names.
- `pair.ts`: KEEP Kata well-known path and `resolveWorktreeKatacodeHome`; TAKE `DEFAULT_SIGNAL_EXPORT`.
- `config.ts` / CLI observability: TAKE per-signal export from `@kata-sh/code-shared/observability`; KEEP `KATACODE_OTLP_*` names.

## Retained-outcome review

Clean merges and new files received the same review as conflicts. Auto-merged files that arrived with `@t3tools` imports were remapped. `sandboxes-preview`, Sprite connect, GitHubCli discovery APIs, and routines RPC remain present on the candidate. New comments that said "T3 Code" in `observability.ts` and `cli/config.ts` were rewritten to Kata Code. Portable branding failed on new device-tool ownership copy (`T3 server` in `packages/client-runtime/src/state/device.ts` and `docs/user/devices.md`); those strings were rewritten to Kata Code server. New `deviceToolMaintenance.test.ts` omitted `ProcessRunner.runBytes` on its mock; the unused stub matches other server tests.

## Verification

Build verification uses the checker and inventory archived from Kata base `af0d264336d2707cd98bdd57a59feca652e24033`. Required checks include formatting and lint, typecheck, unused-code checks, CI test partitions, desktop build, preload verification, branding, ancestry, workflow-reference scan, and the preservation checker. Mandatory live browser, device, provider, Android artwork, and macOS Icon Composer evidence remains `NOT RUN` until exercised against an exact candidate.
