# KAT-3578 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `ef043ab71a4b2684bdd7f618e3db6419573e0c36` (`origin/main` 2026-09-30T07:00Z) |
| Previous upstream pin  | `d2c9281b8112dc3b2991642c4bdb985e4b08b9bb`                                   |
| Frozen upstream target | `0fcd5f90611451cca842689faea53b5450c022da` (frozen 2026-09-30T07:00Z)        |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20260930T070036Z-claude-mini` froze 16 commits that change 156 paths: 116 modified and 40 added. The previous pin is an ancestor of the target. The range adds no migrations, workflow files, pnpm patches, or binary assets.

## Ancestry

KAT-3562 landed the previous pin through PR #317 as merge commit `f6432296da5637255989659de1b169e035649d7a`. `d2c9281b8` is an ancestor of the Kata base, and `git merge-base --all ef043ab71 0fcd5f906` returns exactly `d2c9281b8`. The run needs no recovery anchor.

The three-way merge of `0fcd5f906` is `86d917d58502291c59b9d73931d68439e954bb88`, with parents `ef043ab71` and `0fcd5f906`. The Kata base, the previous pin, the target, and the original root are all ancestors of the candidate.

## TAKE

| Upstream            | Change                                                        | Kata note                                                                         |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `27bdf1aa14` #14290 | Connect ChatGPT accounts to Codex with managed authentication | Adapted; see "Identity mapping", "Trusted assertions", and "Conflict resolutions" |
| `5e83e99c95`        | Model manifest `currentModels`                                | The bundle equals upstream's                                                      |
| `451afcb22d` #14304 | Codex Pro Max accounts load, so Ultrafast shows up            |                                                                                   |
| `1a553d0f5d` #14209 | OpenCode Go limits merge by credential                        |                                                                                   |
| `422248515a` #14311 | Codex 0.159 protocol bindings                                 | The bundle equals upstream's                                                      |
| `8792f95762` #14323 | Codex install advisory test no longer pins a release range    |                                                                                   |
| `60cb7d180d` #14243 | Unresolved pull request links use the compact link tooltip    |                                                                                   |
| `88fbc2cac7` #13909 | Model ids in inline code no longer become file chips          |                                                                                   |
| `916ec94f93` #12900 | User-input timeline rows show the agent's question            |                                                                                   |
| `55ec55b1fb` #12449 | Workspace root links open in the file explorer                |                                                                                   |
| `050cfad04f` #10607 | Grok recovers from crashed provider sessions                  |                                                                                   |
| `2a23c30ea6` #8865  | Command menu descriptions use the full row width              |                                                                                   |
| `0fcd5f9061` #13211 | Multi-PR badges open the linked pull requests panel           | `docs/user/source-control.md` keeps Kata copy                                     |

## SKIP

- `2cbc24fcae` and `ff1db030b1`, upstream release version bumps to v0.0.43 and v0.0.44. Kata's release bot owns package versions (`0750f22ecb` prepared Kata v0.0.43), so the four `package.json` versions stay `0.0.43`.
- `63b61e647c` #14307, `.coderabbit.yaml` `high_level_summary: false`. Kata owns its CodeRabbit configuration, which already diverges from upstream. The file stays at the Kata base.
- Upstream `AGENTS.md`, user-visible T3 names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations.
- Deliberate cleanup stays in place: the deleted `.repos`, `.plans`, and `.macroscope` directories and the parked workflows. The range touches none of them.

## Identity mapping

#14290 adds a ChatGPT sign-in for Codex, a managed Codex install, and a hosted-web-to-desktop handoff. Its user-visible and operator-facing identity maps to Kata:

- **Copy.** "T3 Code" becomes "Kata Code" in the OAuth callback pages (`CodexAuthCallbackPage.ts`, `packages/shared/src/codexAuthCallback.ts`), in settings and welcome copy (`CodexSetupSection.tsx`, `ChatGptWelcomeCoordinator.tsx`), in server errors (`CodexInstallation.ts`, `providerInstallation.ts`, `CodexAuthCallback.ts`), and in `docs/user/providers-codex.md` and `docs/user/install.md`. "Use T3 desktop for automatic return" becomes "Use Kata Code desktop for automatic return".
- **OpenAI consent screen.** The dynamic client's `agent_name_hint` is "Kata Code" (`CodexChatGptAuth.ts`).
- **Codex app-server client.** `clientInfo` is `{ name: "Kata Code", title: "Kata Code" }`. Upstream moved the name from the internal `t3code_desktop` to its product name in the same commit, so Kata uses its product name.
- **Return and handoff URLs.** `providerAuthReturnUrl` accepts `katacode:` and `katacode-dev:` desktop URLs and the hosted origin `https://app.kata.sh` (`DEFAULT_HOSTED_APP_ORIGIN`), not `t3code:` or `https://app.t3.codes`. `codexAuthHandoffUrl` and `readCodexAuthHandoff` use `desktopProtocolScheme`. New test cases reject `t3code://app/welcome` and `https://app.t3.codes/welcome`.
- **Operator interface.** `CodexManagedRuntime` strips `KATACODE_CODEX_LAUNCH_ARGS`, Kata's name for the launch-args override (`codexLaunchArgs.ts`), from a managed session's environment. Upstream strips `T3CODE_CODEX_LAUNCH_ARGS`. Keeping upstream's name would let an ambient Kata override redirect a managed ChatGPT token, which is exactly what the guard prevents.
- **Service key.** `CodexInstallation` uses the deterministic key `@kata-sh/code-cli/provider/CodexInstallation`.
- **Retained.** Temporary prefixes (`t3-codex-install-test-`, `t3-codex-driver-`), the test fixture path `/Users/saphid/.t3/...`, and test credential owners stay under FORK.md's identifier policy.
- `vp run check:branding` passes on the candidate.

## Trusted assertions

`desktop-clerk-environment-identity` trusts `apps/desktop/src/app/DesktopClerk.test.ts` byte for byte, and #14290 edits it. The base bytes fail 5 of 5 cases against upstream's `DesktopClerk.ts`:

- Upstream's `DesktopClerk` requires an `ElectronShell` service, which the base test layer does not provide.
- Upstream's `configure` registers an `open-url` listener, and the base test asserts that only `second-instance` is registered.

A companion suite cannot absorb that. Taking the file would add a `ci.yml` allowlist line that needs a per-run human decision. The KAT-3578 spec recorded the resolution before implementation:

- `DesktopClerk.ts` and `DesktopClerk.test.ts` stay at the Kata base.
- Upstream's provider-auth deep-link handling moves into `apps/desktop/src/app/DesktopProviderAuthLinks.ts`. It handles the hosted-web `katacode://auth/codex` handoff at startup and on `open-url`, and loads `katacode://app/...` return URLs into the main window on `open-url` and `second-instance`.
- `DesktopApp.ts` registers it right after `clerk.configure`. `clerk.configure` interrupts a secondary instance, so the handlers run only in the primary instance, as upstream's did.
- Upstream's three new cases move to `DesktopProviderAuthLinks.test.ts`, with Kata schemes and an added case that ignores `t3code-dev://app/welcome`.
- On `second-instance`, which is how Linux delivers links, Clerk's base listener always reveals the main window. Upstream skips that reveal when the argv holds a provider-auth link. For a return link, the new listener reveals the window anyway. For a hosted-web handoff link, the desktop window comes forward first, and then `shell.openExternal` opens OpenAI's page in the browser, which normally takes focus. Kata accepts this divergence rather than changing the trusted `DesktopClerk.ts`. macOS delivers these links through `open-url` and is unaffected. The companion suite covers the handoff through startup, `open-url`, and `second-instance`.

No `ci.yml` allowlist line changes.

## Conflict resolutions

The merge conflicted in 17 files:

- **`package.json` (desktop, server, web, contracts).** Kata names and version `0.0.43` stay. The server takes upstream's `jose`, `proper-lockfile`, and `@types/proper-lockfile` and keeps Kata's `oauth4webapi`.
- **`pnpm-lock.yaml`.** Kept both `oauth4webapi` and `proper-lockfile` importer entries. `vp install --frozen-lockfile` accepts it.
- **`.coderabbit.yaml`.** Kept Kata's; see "SKIP".
- **`docs/user/install.md`.** Took upstream's "Connect with ChatGPT" row with Kata Code copy.
- **`DesktopClerk.ts`.** Kept the base; see "Trusted assertions".
- **`CodexProvider.ts`.** See "Identity mapping" for `clientInfo`.
- **`ProviderService.ts`.** `sendTurn` consumes Kata's routine submission first, then records upstream's `provider.turn.attempted`, then sends the turn. A typed failure records upstream's `provider.turn.rejected`, and any failure still marks the routine submission as needing attention. The turn binding to the routine run is unchanged.
- **`ProviderService.test.ts`.** Kata's shared routine-store fixture takes upstream's optional `settingsLayer`.
- **`server.ts`.** Kata's routine layers stay. Upstream's `ProviderInstallationRefreshLive` replaces `AntigravityInstallationRefreshLive`.
- **`CodexTextGeneration.ts`.** Kata's routine draft working directory and safety config stay alongside upstream's managed `resolveRuntime`, which supplies the effective config and environment.
- **`CodexDriver.test.ts`, `WelcomeWizard.tsx`, web `UsageLimitsPooled.tsx`, mobile `UsageLimitsSection.tsx`.** Import lists only; took upstream's with Kata scope.

Typecheck then found two Kata interactions in clean merges:

- `CodexManagedProvider.ts` built a text-generation object without Kata's `generateRoutineDraft`. It now forwards routine drafts through the same managed-access guard as the other operations.
- `CodexInstallation.ts` used upstream's `t3/provider/CodexInstallation` key; see "Identity mapping".

## Clean merges and new files

Of the 156 upstream paths, 28 match upstream exactly and 57 match once the package scope is renamed. The rest carry an existing Kata divergence or one of the adaptations above.

- **`WelcomeWizard.tsx`.** #14290 adds a resume path to the Agents step and a ChatGPT connection. Kata's early-access controls are unchanged.
- **`SettingsScopeContext.tsx`.** #14290 edits the scope axis. Kata's optimistic-file fix, which reads `optimisticFileAtom` before skipping a waiting member, is unchanged.
- **`model-manifest.json`.** The candidate equals upstream's. Since KAT-3564 Kata keeps no manifest entries of its own.
- **Server.** New modules cover the ChatGPT OAuth flow (`CodexChatGptAuth.ts`), the loopback callback (`CodexAuthCallback.ts`), the managed Codex download (`CodexInstallation.ts`), and managed runtimes (`CodexManagedRuntime.ts`, `CodexManagedProvider.ts`). Managed tokens go to the server secret store, and the managed install lives under the server state directory, which is `~/.katacode` in Kata.
- **`server.test.ts`.** Upstream adds a `CodexInstallation` mock. The range adds no relay-config posts.

The range touches none of these retained owners: the Sprite CLI, credential cleanup, provider isolation, the Cursor custom-endpoint guard, the Linear OAuth broker, relay wire identity, migrations, and desktop identity.

## Pin consumers

These advance to `0fcd5f906`:

- `FORK.md`
- both upstream-tip literals in `.github/workflows/ci.yml`
- `docs/upstream/kat-3307-runbook.md`
- the live-tree `currentUpstreamSha` in `scripts/check-upstream-preservation.test.ts`

`baselineUpstreamSha` stays at its historical pin, and the original root stays `6a687ee43`. `FORK.md` now lists `d2c9281b8` as the previous accounted-for pin.

## Independent review

An independent Opus review re-ran a plain three-way merge for all 156 upstream paths and compared it with candidate `86d917d58`. It read the 60 paths where the candidate differs and reviewed the candidate against Kata main. It found no blocker and dropped no Kata-only behavior.

It confirmed:

- the identity mapping and allowlists, and that sign-in registers a dynamic OpenAI client rather than a T3-owned one
- the `KATACODE_CODEX_LAUNCH_ARGS` scrub, which also removes `OPENAI_API_KEY` and `OPENAI_BASE_URL`
- the `DesktopProviderAuthLinks` equivalence with upstream's `configure`, and that `DesktopClerk.ts` and its test are byte-identical to the base
- the `sendTurn` order, the routine and Linear OAuth relay layers, the scope checks on the four new RPC methods, and that the UsageService change never meets Kata's Cursor custom-endpoint guard
- the `SettingsScopeContext.tsx` optimistic-file fix and the `WelcomeWizard.tsx` early-access controls

Its findings:

- **Should fix:** the Linux `second-instance` reveal described under "Trusted assertions". It is accepted as a divergence, and a `second-instance` handoff case is added to the companion suite.
- **Note:** the Codex `clientInfo.name` change also applies to CLI-login sessions. Codex uses it as the request originator. A managed ChatGPT sign-in and turn is a live provider check, which the standing waiver covers on this run; it is not claimed as verified.
- **Note:** `providerAuthReturnUrl` accepts only `https://app.kata.sh`, not `latest.` or `nightly.app.kata.sh`. This matches upstream, which accepts only `app.t3.codes`, and the channel hosts are served through `app.kata.sh`. The paste-the-redirect-URL fallback works everywhere.
- **Note:** `FORK.md` in the merge commit links to intake files that arrive in the next commit. They land together.

## Verification

Local gates ran on a clean checkout of `b30826746`. Candidates after it change only this intake and the decisions TSV.

- **Checks:** branding, workflow references, knip, `vp check`, and `vpr typecheck` pass. The desktop build and preload verification pass. So do the preview, nightly, and release-smoke tests.
- **Tests:** the non-server suites pass. All three server shards pass: 5942 passed, 0 failed.
- **Trusted checker, archived from base `ef043ab71`:**
  - `--mode ci`: 27 automated checks and the inventory pass.
  - `--mode human-review`: `INTEGRATION_RECORD status=PASS`, and `CHANGED_RETAINED_OUTCOMES status=PASS` with 4 TAKE dispositions. Three are `FORK.md` pin-only (`product-identity-release-ownership`, `connect-wire-identity`, `state-isolation`), and one is `WelcomeWizard.tsx` for `connect-early-access-waitlist`.
  - It prints `HUMAN_REVIEW_ACCEPTANCE status=FAIL`. The only open items are `human-device-provider-evidence` and `icon-composer-live-evidence`, which are NOT RUN under the standing waiver. This is not a PASS.

## Web verification

Disposable stacks ran from `verify-katacode`: branch run `web-20260930-072229-11772bad` on `b30826746`, and main run `web-20260930-072644-d4238ad6` on `ef043ab71`.

1. The main welcome Agents step lists agents only. The branch step offers "Connect another ChatGPT account".
2. Pairing works, and the Connect step says Kata Code and Kata Code Connect.
3. The Add ChatGPT account dialog opens with a default account name.
4. Continuing opens OpenAI's authorize page with `client_id=dynamic_agent_client`, `agent_name_hint=Kata Code`, and a `127.0.0.1` loopback redirect. No account was signed in.
5. The sign-in fallback says "If sign-in doesn't return to Kata Code, paste the URL from the final localhost page."
6. A cancelled OpenAI response sent to the loopback receiver shows "Sign-in couldn't finish · Kata Code". Its return link points to this app's `/welcome#agents:<environment>`, and the app then shows that sign-in was declined.
7. The ChatGPT instance's runtime says "Selected by Kata Code." Its shadow home is under the Kata state directory.
8. Searching settings for "ChatGPT" narrows the providers list.
9. Settings → Connections says Kata Code Connect, with no T3 copy.
10. The Usage page renders without errors, and the command palette opens.

Not exercised live:

- A real ChatGPT sign-in and a Codex turn. This is a live provider check under the standing waiver.
- The hosted-web-to-desktop handoff. Unit tests cover it through startup, `open-url`, and `second-instance`.
- The thread-level web fixes, which need a provider thread. Their upstream unit tests pass.

Screenshots and a 48 s, 1 fps video are on PR #332.

## CI repair after the main sync, 2026-09-30

Gannon requested CI repair and landing of PR #332. Main advanced from `ef043ab71a4b2684bdd7f618e3db6419573e0c36` to `be15dd1120d7f72c1ab5100dbf12a78b99729e04`, and merge `4fad06b7eaed5368e183091a8cf08fabf2649b4b` brought it into the candidate. The frozen upstream target stays `0fcd5f90611451cca842689faea53b5450c022da`.

CI run [36759267823](https://github.com/gannonh/kata-code/actions/runs/36759267823) passed all test shards but failed Check. KAT-3559 had added `model-manifest-newer-bundle`, whose trusted assertion is `apps/server/src/provider/ModelManifest.test.ts`. The checker reported `CHECK id=model-manifest-newer-bundle status=FAIL detail=trusted assertion changed apps/server/src/provider/ModelManifest.test.ts`. The intake had taken upstream's additional stale-fetch/cache test in that file before it became frozen.

The repair restores the trusted file to current main bytes and retains upstream's stale-fetch/cache coverage in `ModelManifest.upstream.test.ts`. Production behavior, the retained inventory, and the CI trusted-assertion allowlist stay unchanged by this repair. Exact-candidate evidence is regenerated against the current pre-merge main. The newly owned `ModelManifest.ts` change gets its own TAKE disposition, with the trusted newer-bundle guard exercised against the candidate. Earlier receipts keep their original refs.

## Accepted review repair before landing

The fresh [Codex review](https://github.com/gannonh/kata-code/pull/332#discussion_r4148286864) on `91496189dbe45221a6c863755bef21d5c8d2e310` found a one-way setup transition. In provider Settings, a managed Codex instance's Use existing CLI action changes `setupMode` to `existing`. The settings editor then removes `CodexSetupSection`, and the generic runtime editor hides `setupMode`. The same instance has no route back to managed setup or its saved ChatGPT connection.

The accepted repair keeps a setup action visible for existing Codex instances. Use managed Codex switches the same instance back to managed setup, while the existing CLI runtime fields remain available. The action respects read-only Settings and leaves the onboarding path intact. The owning Linear spec records this repair before implementation. Final-head checks, a focused regression, and an independent browser round trip revalidate it before landing.

## Accepted token renewal repair before landing

The fresh [Codex review](https://github.com/gannonh/kata-code/pull/332#discussion_r4148493935) on `36d17e8c90eb79ac53d7971330312a2642e455dd` found that managed Codex rejects a successful renewal when the response omits `refresh_token`. The response schema permits that omission. [OAuth 2.0 section 6](https://www.rfc-editor.org/rfc/rfc6749#section-6) makes issuing a replacement refresh token optional.

The accepted repair retains the saved refresh token when the response omits a replacement and saves a supplied rotated token. Bearer-token validation and revoked-token handling remain in place. The owning Linear spec records this repair before implementation. The mocked OAuth harness verifies successful access and a later renewal using the retained token; this does not require a live account or provider turn.

## Accepted authorization and callback repairs before landing

Fresh review on `cd190a2ac04dff137c0e48f2d5e1f811af5478d7` found two further defects in the imported OAuth flow:

- [ChatGPT RPC authorization](https://github.com/gannonh/kata-code/pull/332#discussion_r4148646413): reconnect, profile import, and handoff subscription declare an operate scope but bypass the RPC helpers that enforce it. The repair uses the existing effect and stream helpers so a read-only session cannot retrieve profile data, replace credentials, or subscribe to handoff data.
- [Direct loopback callback validation](https://github.com/gannonh/kata-code/pull/332#discussion_r4148646423): an unrelated request consumes the listener before its state is checked. The repair validates the callback URL and state first, allowing the matching redirect to finish the same attempt after an invalid request.

The owning Linear spec records both repairs before implementation. Mocked RPC and loopback regressions verify the boundaries without a live account or provider turn. Valid callback errors and single-use behavior remain covered.

## Accepted refresh scope repair before landing

Fresh [Codex review](https://github.com/gannonh/kata-code/pull/332#discussion_r4148814100) on `8dfcf2b0aefdc7ed46567cdeb09ad21eb0b6d17d` found that the shared token decoder requires `scope` on refresh responses. OAuth permits omitting it when the granted scopes are unchanged, so this rejects a successful renewal before saving the new access token.

The accepted repair retains the saved scopes only when a refresh response omits them. Explicitly supplied scopes replace the saved scopes and remain subject to the required sharing-scope check. Initial sign-in validation is preserved. Mocked renewal and persistence coverage verifies the repair.

During the broader local test run, one shell-overflow test timed out while several builds ran concurrently. It passed alone (264 ms test body), and the complete server suite then passed 209/209 serially at the same head. No source or timeout change was made for that retry.
