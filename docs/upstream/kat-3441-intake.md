# KAT-3441 upstream intake

## Frozen refs

| Value                  | Commit                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| Kata base              | `88f8995ccedbb9c94855349f6761531cc830a38b` (`origin/main` 2026-09-23) |
| Previous upstream pin  | `b379b5b1407b4c718095cd13395173b6cc005218`                            |
| Frozen upstream target | `f5ef0ddb90a8c36584e181b1913e7b8a5df30ffc` (frozen 2026-09-23T07:00Z) |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                            |

Run `kat-upstream-20260923T070045Z-claude-mini` froze a range of 92 commits and 441 changed paths: 389 modified, 32 added, 13 deleted, and 7 renamed. The previous pin is an ancestor of the target. The range has no workflow, asset, migration, `.repos/`, or `.plans/` paths.

KAT-3432 landed the previous pin through PR #247 as squash `cc725adf0cef8a772d0b11cdfd02579c6462b8ea`. `docs/upstream/kat-3432-intake.md` and `FORK.md` at the Kata base account for pin `b379b5b1407b4c718095cd13395173b6cc005218`. That pin is not an ancestor of `origin/main`. This run recorded it with `git merge --strategy=ours --no-ff` as `cc99c6e3e7dbd6f664f545e4ee4f08668fc603da`, with the tree unchanged from the Kata base. `git merge-base --all HEAD upstream` then returned exactly the previous pin. KAT-3432's learning landed through KAT-3437 / PR #252.

## TAKE

- Recover squash-lost previous-pin ancestry for `b379b5b14`, then merge frozen tip `f5ef0ddb9`.
- Take the upstream product changes: `components/ui` variant refactors and the `shadcn/no-restyle` lint, the unified pull request comment and review composer, the sidebar thread undo notice, settings scope sentence and breadcrumb pickers, mod+[ / mod+] navigation, retirement of the legacy mobile thread list, mobile render error recovery, uniwind platform variants, provider sign-in flows and credential bindings, provider compatibility ranges, PR sync quota fixes, model manifest updates, vite-plus 0.3.3, the mobile version bump to 1.3.1, and related tests. Map `@t3tools/*` imports to `@kata-sh/code-*`.
- Take upstream deletions of files Kata changed only for package scope: the legacy mobile list modules and tests, `threadPresentation.ts`, `PullRequestCommentComposer.tsx`, `UsagePage.test.tsx`, `showUndoToast.ts`, and `packages/shared/src/threadEnvMode.ts`. Kata callers of `threadEnvMode` move with upstream to the nullable `defaultThreadEnvMode` setting.
- Adapt Kata-only screens to the `shadcn/no-restyle` rule instead of exempting them. The sandbox GitHub picker uses upstream's `ComboboxSearchInput`, which carries the same search field markup. `inputClassName` was removed upstream and folded into `unstyled`. Add-environment dialog footers use margin in place of padding overrides. The add-environment trigger takes upstream's `xs` / `ghost-muted` treatment of the same control. Routines drop classes `SidebarInset` already applies, and the routine chat Retry button uses `size="xs"`.
- Rebrand new upstream copy: provider compatibility messages, the provider maintenance incompatibility message, the `t3.json` worktree-submodules description, the `docs/user/install.md` compatibility paragraph, Connect onboarding (`Kata Code Connect`, `${KATA_CLI} connect`, "Keep Kata Code running"), the mobile clients empty state, the Connect environments empty state, and the hosted-app connect prompt.

## SKIP

- Skip upstream `AGENTS.md`. Kata deleted it and uses `AGENTS.override.md`; upstream's new `components/ui` guidance is review material only.
- Skip user-visible T3 product names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations.
- Skip upstream's sidebar stage backdrop, brand wordmark, and `media-navigation` sidebar trigger in `SidebarChrome.tsx` and `AppSidebarLayout.tsx`. KAT-3423's bare sidebar header stays. The header row keeps upstream's plain `div`, with the `flex gap-2` classes `SidebarHeader` used to supply, and takes upstream's pill Badge styling.
- Skip upstream's inline add-environment dialog body in `ConnectionsSettings.tsx`. Kata's `AddEnvironmentDialog` owns sandboxes, SSH targets, and pairing.
- Skip changes that remove Kata Docker and Sprite behavior, the disabled-by-default sandbox preview, process byte APIs, credential cleanup, provider isolation, mixed-fleet adapters, or GitHubCli discovery APIs.
- Keep deliberate cleanup: deleted `.repos`, `.plans`, and parked workflows.

## Conflict resolutions

56 paths conflicted: 46 content conflicts, 9 upstream deletions of Kata-modified files, and 1 Kata deletion of an upstream-modified file (`AGENTS.md`). Most content conflicts were `@t3tools` versus `@kata-sh/code-*` imports. The upstream import lists were taken with the scope mapped, and Kata-only imports were kept where the file still uses them. Behavior resolutions:

- `HomeScreen.tsx`, `ThreadNavigationSidebar.tsx`: keep Kata's persisted shelf preferences (`useThreadListV2ShelfPreferences`, `shelfPreferencesLoaded` in hook dependencies and list `extraData`). Take upstream's removal of `threadListV2Items` and `nowMinute` from those dependencies (#13149 scopes the snooze minute tick) and of `useThreadListV2Enabled`.
- `homeThreadList.test.ts`: take upstream's removal of the legacy `buildGroups` tests. Kata changed only fixture copy in them.
- `GitVcsDriverCore.ts`: keep Kata's `withoutGitRepositoryEnv` import alongside upstream's project-file settings imports.
- `ws.ts`: keep Kata routines RPC imports and add upstream's `resolveProjectSettings`.
- `ProviderAuthService.ts`: keep the Kata `deterministicKeys` diagnostic comment and take upstream's auth start and respond inputs.
- `DeviceService.test.ts`: keep Kata's `streamAttachError` fixture argument sixth and add upstream's `installTool` seventh. Upstream's two install callers pass `undefined` for the stream error.
- `GitManager.test.ts`: take upstream's single probed PR head (#13200) with Kata's `katacode/pr-142/statemachine` branch.
- `settings.test.ts`: keep Kata's sandbox preview default tests and take upstream's inherited `defaultThreadEnvMode` tests.
- `vite.config.ts`: keep `./oxlint-plugin-kata-code/index.ts` and add upstream's `@shadcn/lint` plugin and settings.
- `pnpm-lock.yaml`: regenerated from the merged manifests with `vp install`. The removed `react-native-nitro-markdown` tarball override no longer appears.

## Retained-outcome review

Clean merges and new files received the same review as conflicts. Fifteen cleanly merged or new files arrived with `@t3tools` imports and were remapped. Upstream's new `ProviderCredentialStore` stores provider credentials through Kata's existing `ServerSecretStore`. Its `owner: "t3"` binding value is an internal wire identifier retained under the `FORK.md` identifier policy. Provider compatibility ranges come from the existing model manifest, an upstream data source that `docs/product-branding.md` excludes. `SandboxGitHubSourcePicker.tsx` typechecked only after the removed `inputClassName` prop was dropped.

Retained owners changed against the Kata base: `FORK.md` (pin and intake links), `docs/upstream/kat-3307-runbook.md` (pin literals), and `apps/mobile/app.config.ts` (upstream version `1.3.1`; Kata slug, package, and asset paths unchanged). Live pin consumers are `FORK.md`, both `ci.yml` literals, the runbook, and live-tree `currentUpstreamSha` in `scripts/check-upstream-preservation.test.ts`. Each now names `f5ef0ddb9`. `withHistoricalBaselineWorktree` keeps its historical commit's own pin.

The lint warnings in `ConnectionsSettings.tsx` for unused inline dialog state already exist at the Kata base. They are outside this run.

## Verification

Build verification uses the checker and inventory archived from Kata base `88f8995ccedbb9c94855349f6761531cc830a38b`. Required checks: formatting and lint, typecheck, unused-code checks, CI test partitions, desktop build, preload verification, branding, ancestry, the workflow-reference scan, and the preservation checker. Mandatory live browser, device, provider, Android artwork, and macOS Icon Composer evidence stays `NOT RUN` until someone exercises it against an exact candidate.
