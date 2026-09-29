# KAT-3562 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `aeed6ffbb1be8cbaf51359bbbaa08e269db73e5f` (`origin/main` 2026-09-29T07:00Z) |
| Previous upstream pin  | `d15210cd3da79f9a1a495a6309d912d76362a046`                                   |
| Frozen upstream target | `d2c9281b8112dc3b2991642c4bdb985e4b08b9bb` (frozen 2026-09-29T07:01Z)        |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20260929T070031Z-claude-mini` froze 12 commits that change 49 paths: 43 modified and 6 added. The previous pin is an ancestor of the target. The range adds one pnpm patch (`node-pty`, Windows-only) and no migrations, workflow files, or binary assets.

## Ancestry

KAT-3550 landed the previous pin through PR #309 as squash `a16b340bd4a7dab17cbdd684ab302868d61c2ac5`, which has a single parent (`b20ae10a9`). So `d15210cd3` is not an ancestor of the Kata base. `docs/upstream/kat-3550-intake.md` on the base accounts for exactly `d15210cd3`, and the landed tree equals KAT-3550's reviewed candidate.

The run recovers the ancestry with `git merge --strategy=ours --no-ff d15210cd3` as `43c24b31865c1d3f8790d145639c4fdad6e4a4f8`:

- Its tree equals the base.
- The base and `d15210cd3` are its ancestors.
- `git merge-base --all 43c24b318 d2c9281b8` returns exactly `d15210cd3`.

The three-way merge of `d2c9281b8` is `df1490b58abda103f82fac9a7afc017562e97480`, with parents `43c24b318` and `d2c9281b8`.

## TAKE

| Upstream            | Change                                                                      | Kata note                                                                       |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ed57bed8e7` #13884 | Shortcut modifier state skips unchanged updates                             |                                                                                 |
| `ba79610d16` #14127 | Removing a Connect environment explains that its account registration stays | Copy adapted to Kata Code Connect and Kata Code Account; see "Identity mapping" |
| `72330e22c0` #14152 | Claude Sonnet 5.5                                                           | Adapted: Kata's KAT-3557 entry stays; see "Model manifest"                      |
| `b528a70110` #13927 | Windows terminal startup waits for the node-pty PID                         | Unsupported platform. Shared `Manager.ts` subscription order reviewed           |
| `b21f3b7191` #14179 | Windows PTY helpers ignore watch-mode IPC (`node-pty` patch)                | Unsupported platform. The patch touches only `windows*.js` in node-pty          |
| `38f3c62304` #13463 | Local-path remotes no longer crash legacy PR link projection                | Kata's mixed-fleet PR-link adapters unchanged                                   |
| `adfc9240ea` #13650 | Oversized transcript records keep their usage                               |                                                                                 |
| `e518866d28` #12003 | OpenCode stop no longer hangs before submission                             |                                                                                 |
| `5da55957d4` #14103 | Save Bitbucket credentials from Source Control settings                     | Env names stay `KATACODE_BITBUCKET_*`; tokens go to the existing secret store   |
| `76fa23df2e` #14198 | OpenCode v2 marked incompatible                                             | Compatibility rows taken into the manifest                                      |
| `d2c9281b81` #14007 | Pull request badge sits on the sidebar row's baseline                       |                                                                                 |

## SKIP

- `7733bc839e` #8673, Linux URL handler icon and MIME cache refresh. `DesktopLinuxUrlHandler.ts`, `DesktopLinuxUrlHandler.test.ts`, `DesktopPreReadyPlatform.ts`, and `DesktopPreReadyPlatform.test.ts` stay at the Kata base. The KAT-3562 spec recorded the change from TAKE before implementation. See "Trusted assertions". KAT-3563 adopts it through the runbook's two-PR `unfrozenTrustedPaths` procedure.
- Upstream `AGENTS.md`, user-visible T3 names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations.
- Deliberate cleanup stays in place: the deleted `.repos`, `.plans`, and `.macroscope` directories and the parked workflows. The range touches none of them.

## Identity mapping

- **#14127 copy.**
  - The new web `RemoveT3ConnectEnvironmentDialog.tsx` says "Kata Code Connect account" and "Kata Code Connect settings".
  - The new `T3ConnectAccountPages.tsx` keeps Kata's page label "Kata Code Connect" and the retained `t3-connect` route id.
  - The mobile alert says "Kata Code Connect account", "Kata Code Account → Kata Code Connect", and "Open Kata Code Account", matching the mobile Settings row "Kata Code Account".
  - Comments in the new code say Kata Code Connect. The `T3Connect*` symbols are internal and stay.
- **#14103 env names.** Upstream's new references to `T3CODE_BITBUCKET_*` become `KATACODE_BITBUCKET_*` in `BitbucketApi.ts`, the credential settings UI, `packages/contracts/src/settings.ts`, `evaluate-thread-titles.ts`, the tests, and `docs/user/source-control.md`. That doc's new fallback sentence says Kata Code. The new settings UI imports `@kata-sh/code-contracts`.
- `t3code-server-settings-test-` in a new server test is a temporary prefix, which FORK.md's identifier policy retains.
- `vp run check:branding` passes on the merge.

## Model manifest

KAT-3557 shipped `claude-sonnet-5-5` with a dedicated `sonnet-5-5` profile: Medium is the default effort, and the model sits directly above Claude Sonnet 5. Its AC 1 and 2 require that order and default, and require them to survive a remote refresh. Upstream #14152 adds the same slug on the `sonnet-5` profile (High default) after Claude Opus 5.5.

The resolution:

- Keeps Kata's entry and profile, and drops upstream's duplicate.
- Takes upstream's OpenCode compatibility rows (#14198).
- Sets `updatedAt` to `2026-09-29T07:15:00Z`.

The server fetches the manifest from upstream main and replaces the bundle unless the fetched copy is older. Upstream's current `updatedAt` is `2026-09-29T01:03:44Z`, so this bundle outranks it again. Main's bundle (`2026-09-28T20:05:00Z`) no longer does. Any later upstream publish overrides Kata's entry again; KAT-3564 owns that decision.

## Conflict resolutions

The merge conflicted in 14 files:

- **Bitbucket** (`BitbucketApi.ts`, `BitbucketApi.test.ts`, `BitbucketSourceControlProvider.ts`, `SourceControlDiscovery.test.ts`, `packages/contracts/src/pullRequest.ts`, `docs/user/source-control.md`): took upstream's settings-first copy and applied Kata's `KATACODE_BITBUCKET_*` names.
- **`T3ConnectSidebarSignIn.tsx`**: took upstream's `T3_CONNECT_ACCOUNT_PAGES` loop and kept `SparklesIcon` for Kata's early-access button.
- **`use-remote-environment-registry.ts`**: took upstream's `useNavigation` import with Kata's `@kata-sh/code-contracts` scope.
- **`model-manifest.json`**: see "Model manifest".
- **`pnpm-lock.yaml`**: kept Kata's `expo-widgets` patch hash and `oauth4webapi`, and added upstream's patched `node-pty`. `vp install --frozen-lockfile` accepts it.
- **The four #8673 desktop files**: restored to the base; see "SKIP".

## Clean merges and new files

Clean merges and new files were reviewed like conflicts:

- **`serverSettings.ts`, `packages/contracts/src/settings.ts`, `BitbucketCredentialsSettings.tsx`, `SourceControlSettings.tsx`, `settingsSearch.ts`.** Bitbucket tokens use the existing secret store, the same pattern as usage-limit management keys. The server sends a redaction marker to clients, and it moves a token hand-edited into `settings.json` into the store on load. Settings search gains a Bitbucket entry with no product name.
- **`Manager.ts`, `NodePtyAdapter.ts`.** The Windows readiness wait and cancel run only on win32. `Manager.ts` now subscribes to data and exit after it records the process and drains events once startup is published. That order is shared across platforms, and the terminal suites run it.
- **`ConnectionsSettings.tsx`.** A Connect-managed environment opens the new removal dialog; other environments keep the old confirm.
- **`threadPullRequests.ts`, `pullRequest.ts`.** Local-path remotes project without throwing. Kata's `threadPullRequestCompatibility` and `thread.meta.update` linking are untouched.
- **Usage transcripts, OpenCode adapter, `AgentSessionJson.ts`, `ProviderStatusBanner.tsx`, `ThreadStatusIndicators.tsx`, mobile `ThreadComposer.tsx`, `shortcutModifierState.ts`.** Kata's only edit in these files is the package scope.

The range touches none of these retained owners: the Sprite CLI, process byte APIs, credential cleanup, provider isolation, the Cursor custom-endpoint guard, the Linear OAuth broker, relay wire identity, the `SettingsScopeContext.tsx` optimistic-file fix, migrations, and desktop identity.

## Trusted assertions

`desktop-url-handler-backend-routes` trusts `apps/desktop/src/app/DesktopLinuxUrlHandler.test.ts` byte for byte. #8673 edits that file, so the base bytes must stay. Those bytes cannot pass with #8673's behavior, for three reasons:

- The packaged-registration test asserts the exact command list: two `xdg-mime` calls and no `update-desktop-database`.
- The pre-ready test asserts that an existing entry rendered without `Icon=` is not rewritten.
- The layer provides no `DesktopAssets` service.

A companion suite cannot absorb that, and taking the file would add a `ci.yml` allowlist line that needs a per-run human decision. Pre-ready and the handler must render the same entry, so the whole commit is skipped. No `ci.yml` allowlist line changes.

## Pin consumers

These advance to `d2c9281b8`:

- `FORK.md`
- both upstream-tip literals in `.github/workflows/ci.yml`
- `docs/upstream/kat-3307-runbook.md`
- the live-tree `currentUpstreamSha` in `scripts/check-upstream-preservation.test.ts`

`baselineUpstreamSha` stays at its historical pin (`ab099178a`, the pin of `d62d138f6`), and the original root stays `6a687ee43`. `FORK.md` now lists `d15210cd3` as the previous accounted-for pin.

## Changed retained outcomes

The trusted checker from base `aeed6ffbb` reports four changed retained outcomes:

| Check                                | Changed owner                                              | Disposition                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product-identity-release-ownership` | `FORK.md`                                                  | TAKE: the pin advances to `d2c9281b8`; the identity tables are unchanged                                                                                         |
| `connect-wire-identity`              | `FORK.md`                                                  | TAKE: the same pin-only edit                                                                                                                                     |
| `state-isolation`                    | `FORK.md`                                                  | TAKE: the same pin-only edit                                                                                                                                     |
| `connect-early-access-waitlist`      | `apps/web/src/components/clerk/T3ConnectSidebarSignIn.tsx` | TAKE: upstream #14127 moves the account pages into `T3ConnectAccountPages.tsx`; the early-access sign-in menu and the Kata Code Connect page label are unchanged |

## Independent review

An independent Opus review covered all 12 upstream commits and both ranges: upstream to merge, and base to merge. It found no blocker. The merge changes only paths in upstream's 49. Of those, 30 carry upstream's patch exactly, and 15 match it once the Kata renames are applied. The review read the remaining 4 in full: the lockfile, the manifest, `ConnectionsSettings.tsx`, and `T3ConnectSidebarSignIn.tsx`.

It also confirmed four things:

- No `T3CODE_BITBUCKET` reference remains.
- Every settings path the server sends to clients redacts both Bitbucket tokens.
- `threadPullRequestCompatibility` is untouched.
- The manifest has exactly one `claude-sonnet-5-5`.

It raised three notes:

- Against a server that predates this merge, a Bitbucket save reports success but stores nothing. This is upstream behavior, filed as KAT-3565.
- The manifest bump protects Kata's Sonnet 5.5 entry only until upstream publishes again. Filed as KAT-3564.
- Skipping #8673 defers a Linux fix. Filed as KAT-3563.

## Web verification

Disposable stacks ran from `verify-katacode`: branch run `web-20260929-072303-786895cd` on `2b1b5a161`, and main run `web-20260929-072524-6ab508a1` on `aeed6ffbb`.

1. Main shows only the `KATACODE_BITBUCKET_*` env-var hint for Bitbucket. The branch shows the credentials form.
2. The branch form's fallback copy names `KATACODE_BITBUCKET_*`, and its status hint says "Add a Bitbucket token in Settings → Source Control."
3. Saving an access token shows **Remove**. `settings.json` stores `••••••`, and the token is in `secrets/bitbucket-access-token.bin` (mode 0600).
4. After a reload, the token stays saved and is not echoed back.
5. **Remove** deletes the secret file and the settings entry.
6. Settings search for "Bitbucket" finds **Bitbucket credentials**.
7. Claude models list Sonnet 5.5 once, directly above Sonnet 5, after the server fetched upstream's live manifest (HTTP 200) and kept the newer bundle.
8. Settings → Connections says Kata Code Connect, with no T3 copy.
9. The Usage page renders without errors.
10. The welcome wizard shows the Kata Code setup dialog.

The Connect-environment removal dialog was not exercised live, because it needs a Clerk sign-in and a relay-managed environment. Its copy is covered by the branding check and by review. Screenshots and a 33 s video are on PR #317.

## Main sync

Before landing, `origin/main` advanced one commit, from `aeed6ffbb` to `8a41706397b2bedb4b9dfc0bdd19eb14d6b04f58` (KAT-3546 / #316). That commit changes only `.agents/skills/rebase-kata-upstream/references/history.md` and `.agents/skills/verify-katacode/SKILL.md`.

Merge commit `dc39360c81e26290435fcb66e64a9788e3f80de0` (parents `4b29fc98d` and `8a4170639`) brings the branch up to date with no conflicts. The Kata base for verification is now `8a4170639`. No product, workflow, inventory, or checker file changed, so the changed retained outcomes stay the same four.
