# KAT-3686 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `992475cf95ff829e11eb2101dcbc498bd0af00ee` (`origin/main` 2026-10-06T07:00Z) |
| Previous upstream pin  | `250e052f44dd313b658abebc707242a7b25be340`                                   |
| Frozen upstream target | `4ae976dbae39b3e80243b864a8b61da00f642dc4` (frozen 2026-10-06T07:00:37Z)     |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20261006T070028Z-claude-mini` froze 112 commits. Outside `.repos/`, they change 1,467 paths. The previous pin is an ancestor of the target. The range brings these changes:

- Effect moves from `4.0.0-rc.115` to stable `4.0.1`.
- Server modules move to one module per service (#16295).
- CloudLink takes over the Connect link lifecycle from the cloud routes.
- Webhook automations for scheduled tasks arrive, with relay forwarding and an opt-in hold while offline.
- Agents can show HTML pages inline and ask for a secret through a private card.
- Native `/goal` arrives for Codex and Claude.
- The legacy relay tunnel cleanup arrives, off by default.
- PR watches spend fewer GitHub points.
- The desktop renderer bootstrap token rotates.
- Many fixes land across the server, relay, web, mobile, and desktop clients.

The range adds two server migrations and two relay migrations, and adds no binary asset.

## Ancestry

KAT-3668 landed the previous pin through PR #348 as merge commit `99fa8759e334bf02bd92a0e7391ad507b74f91ed`, with parents `f352d5a2eb` and the reviewed candidate `b62f761e6e`. `250e052f44` is an ancestor of the base, so the run recorded SKIP for the recovery anchor. `git merge-base --all 992475cf95 4ae976dbae` returns exactly `250e052f44`.

## Intake review

Four independent Opus reviews covered all 112 commits, split by area: relay, Connect, and webhooks; server and contracts; clients; and toolchain and refactors. None found a commit that changes an accepted Kata outcome and needs a human product decision first:

- #16118 stops encoding monogram icons in the old form. Clients built before 2026-09-23 cannot decode the new form. Those clients already cannot speak protocol 2, which ended the mixed fleet when KAT-3635 adopted Orchestration V2, so this ends no compatibility that still exists.
- Two new features do reach protocol-2 clients built from the Kata base, including the current TestFlight build. Those clients decode thread turn items and the scheduled-task list strictly. A thread stops loading for them once an agent asks for a secret (`secret_request` turn item, #15907). The scheduled-task list fails for them once any webhook task exists (#15085). The forward-compatible decoders this range adds (#15951) protect only clients built from it onward. In the other direction, a server built from the base rejects the new `tool-output-image` asset, so tool screenshots do not render against it. These breaks need the new features to be used. They do not change a retained outcome. They are named for Human Review, and shipping a client build with the server release closes them.
- The legacy tunnel cleanup deletes nothing unless `RELAY_LEGACY_TUNNEL_CLEANUP_MODE` is set (KAT-3692).
- Webhook automations, the secret card, and HTML renders are new upstream features. Their open product and security questions are filed as KAT-3689, KAT-3690, and KAT-3691. Relay deploys stay manual: `deploy-relay.yml` has only `workflow_dispatch`.

## Resolution method

The merge census on the base (`git merge-tree --write-tree --merge-base=250e052f44 992475cf95 4ae976dbae`) found 286 conflicted files outside `.repos/`:

- 268 content conflicts
- 14 modify/delete conflicts
- 4 file-location conflicts

It also found 4,882 `.repos/` paths, which resolve as the carried-forward deletion.

1. **Identity-only files.** For 133 content conflicts, Kata's change from the previous pin was only the identity transform: `@t3tools/` → `@kata-sh/code-`, `T3CODE_` → `KATACODE_`, `T3 Code` → `Kata Code`, and `T3 Connect` → `Kata Code Connect`. For each file the resolver first checked that the transform maps the previous-pin blob exactly to Kata's blob, then took upstream's blob through the same transform. No file failed the byte check. A review of what the transform changed in each file found only `KATACODE_*` operator interfaces and Kata Code copy.
2. **Renamed-base merge.** For 111 files carrying Kata behavior, `git merge-file --diff3` merged the transformed previous pin and upstream into Kata's raw blob. 34 merged cleanly.
3. **Trusted files.** The 7 trusted test files with content conflicts stay at base bytes. Git also merged upstream edits cleanly into 8 other trusted files: `VcsProcess.test.ts`, `build-desktop-artifact.test.ts`, `update-release-package-versions.test.ts`, and five desktop app tests. Those were restored to base bytes too. All 39 active trusted paths match the base byte for byte.
4. **Lanes.** The remaining 92 files went to five lanes with disjoint ownership: Connect cloud and relay, text generation, provider and persistence, server core, and clients. Manifests, patches, the lockfile, migration numbering, and pin consumers stayed with the coordinator and were done in sequence.
5. **Import sweep.** Stale `effect/unstable/*` specifiers moved to Effect 4.0.1's stable paths in 47 cleanly merged non-trusted files. The `effect/Encoding` row of the map held prose instead of a path; four relay files received it, and the relay lane rewrote them to `effect/encoding/Base64`, `Base64Url`, and `Hex`. The sweep also rewrote the specifiers inside `patches/@opencode__client@2.0.23.patch` and `@opencode__protocol@2.0.23.patch`, where they are the patch's own removed lines. The frozen install then failed in every CI job of run 37443388527. `5c64b30f29` restored both patches to upstream's bytes.
6. **Added-line identity sweep.** Cleanly merged and added files never pass through the transform. Their added lines were swept for `@t3tools/`, `T3CODE_`, Kata-renamed wire identifiers (`/.well-known/t3/`, `t3-env:`, `x-t3-relay-*`, `x-t3-hook-outcome`, `t3-relay-hook-delivery+jwt`), `t3code` defaults, and T3 product copy. The remaining hits are test fixtures (`pingdotgg/t3code` URLs), retained `T3CODE_TRUE`/`T3CODE_FALSE`, `.t3code/vcs.json` (unchanged since the base), private comments, and `apps/marketing`, which stays T3-shaped per `FORK.md`.

## TAKE

All 112 commits apart from the SKIPs below. Kata adaptations:

| Upstream                                                                           | Change                                     | Kata adaptation                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `194c73f3f9` #16138                                                                | Effect 4.0.1                               | Kata code uses the stable paths. `patches/effect@4.0.1.patch` adds `exports` aliases `./unstable/{cli,http,httpapi/*,process,process/*}` that point at the same `dist` files. The aliased and stable imports return the identical module. Trusted files and the historical baseline tree keep their imports. KAT-3687 removes the aliases through the two-PR unfreeze.                                                                                             |
| `3d17862e58` #16295                                                                | One module per service                     | Kata edits to the six deleted `Services/` and `Layers/` files are ported to the new modules, including 409 lines of KAT-3609/KAT-3626 `ProviderRegistry` tests. Five of those tests fail against upstream's registry without Kata's scan-generation guard. The moved services keep Kata's `@kata-sh/code-cli/...` service keys.                                                                                                                                    |
| `9422e2ee12` #16265, `ff873b2ec1`, `68e50db20b`, `99db70cf1a`                      | CloudLink                                  | All 33 Kata hunks of `cloud/http.ts` are ported into `CloudLink.ts`, `linkChecks.ts`, and the route mapping. They cover credential refresh on `invalid_bearer` (a `bearerRejected` discriminator on `RelayRequestError`), the managed callback origin and its insecure-URL rejection before any runtime change, Linear OAuth delivery with its replay markers and messages, `connectorPort`, `endpoint: link.endpoint`, and the `kataConnectMintCredential` route. |
| `7dfb86a32b`–`ea4b44343d` #15085–#15088, `f33b060caf` #15487                       | Webhook automations and hold-while-offline | Server migrations 62 and 63. The relay merge migration `20261006080000_merge_upstream_kata_webhook_heads` joins the Kata and upstream snapshot heads. The hook wire identity is Kata's: `kata-relay-hook-delivery+jwt`, the `x-kata-relay-delivery*` and `x-kata-hook-outcome` headers, and `wireEnvironmentIssuer()` audiences. The server webhook route reads the same constants. User copy says Kata Code Connect.                                              |
| `41d2535a90`, `6bfc8baeb8`, `6b456a9618`, `7b32b2ca39`, `204a639096`, `18c1210810` | Legacy tunnel cleanup                      | Off by default. `tunnel-census.ts` uses `katacoderelay-managedendpoint-`. `deploy-relay.yml` gains only `RELAY_LEGACY_TUNNEL_CLEANUP_MODE`. The runbook and `remote-access.md` use Kata names and are worded conditionally.                                                                                                                                                                                                                                        |
| `442735897f` #16382                                                                | One relay tracer                           | Upstream's `Axiom.Telemetry` with service name `katacode-relay`. Kata's `withoutSecretQuery` still redacts the Linear OAuth callback query.                                                                                                                                                                                                                                                                                                                        |
| `4ae976dbae` #16210                                                                | Text generation `fromRunner`               | `generateRoutineDraft` is part of the shared runner. Strict decoding for routine drafts remains, and turning it off fails 6 rejection tests. The Codex safety config and temporary directory, the Claude temporary directory, the Cursor tool-call abort, the OpenCode and OpenCode2 tool rejection, and the Grok and ACP unsupported stubs all remain.                                                                                                            |
| `b12b3f706d` #16167                                                                | Branch named like the prefix               | A local `katacode` branch moves temporary names to `katacode-<hex>`. `t3code/*` refs are not treated as Kata temporary branches.                                                                                                                                                                                                                                                                                                                                   |
| `1024941575` #16231                                                                | Choose the worktree directory              | The default stays `~/.katacode/worktrees`. The symlink-safe storage cleanup from KAT-3453 covers the new extra roots.                                                                                                                                                                                                                                                                                                                                              |
| PR watch #16095, #16204, #16208, #16262, #16270                                    | Watch lifecycle and cost                   | One `pullRequestWatchThreadEndReason` serves the sweep and the Sprite activity lease. Wake copy says Kata Code.                                                                                                                                                                                                                                                                                                                                                    |
| `447046b589` #14718                                                                | `GIT_OPTIONAL_LOCKS=0`                     | Added after Kata's `withoutGitRepositoryEnv(process.env)`.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `7b797f2b90` #16032                                                                | Renderer history                           | `DesktopWindow` looks up `DesktopRendererHistory` as an optional service, so the trusted `DesktopWindow.test.ts` still builds its layer. `main.ts` provides it. New cases live in `DesktopWindow.upstream.test.ts`.                                                                                                                                                                                                                                                |
| `eef36a67c3` #16242                                                                | Atomic cache writes                        | `ModelManifest.ts` still rejects a fetched manifest older than the bundle before the atomic write.                                                                                                                                                                                                                                                                                                                                                                 |
| `31d0c8a4f4` #16294, `ff397a2952` #16361                                           | Lint rules                                 | The rules land in `oxlint-plugin-kata-code` under `kata-code/` keys.                                                                                                                                                                                                                                                                                                                                                                                               |
| `9f61ba6741` #15907, `677d1527c3` #15968                                           | Secret card, HTML renders                  | Agent-facing copy and the new service keys use Kata identity. Open questions are in KAT-3690 and KAT-3691.                                                                                                                                                                                                                                                                                                                                                         |

## SKIP

- `2afe87ea4b` #16220, the shorter `t3/` branch prefix. Kata keeps `katacode` (`packages/shared/src/branding.ts`) and never created `t3code/*` branches.
- `25d5c7cacb` #16228, the PS-80 resize of upstream's own relay database. `infra/relay/src/db.ts` keeps Kata's `katacoderelay` at PS_20 with `originConnectionLimit: 20`.
- `2bffcc52f7` #16178. It moves a `transfer-report` job onto Blacksmith, but Kata has no such job and no Blacksmith runners.
- `ea54be7f85` #16281, `c21f93e430` #16324, and `3a9c1a6df1` #16328, the CodeRabbit TypeScript config. Kata keeps `.coderabbit.yaml`, and the `@coderabbitai/config` devDependency stays out.
- `3236d8ce73`, the `VOUCHED.td` entry, and `6f9cea00ae` #16170, the `.repos` sync. Kata deleted both files.
- Partial skips: the `deploy-relay.yml` push trigger and `force` input from #13563, the `AGENTS.md` hunk of #16286, and the `.cursor/rules` hunk of #16295.
- Carried forward: upstream identity on product surfaces, artwork, unlicensed assets, `reconcileV2PreviewMigration` (upstream IDs 53–56, KAT-3635), the deleted `AGENTS.md`, contribution-triage, `.macroscope`, `.repos`, and `VOUCHED` files, the `t3code-v2` desktop profile, and parked infrastructure.

## Dependencies

- `pnpm-lock.yaml` is regenerated from Kata's base lockfile with `vp install`. Of 47 packages in the upgraded families (Effect, alchemy, opencode, undici, ws, cursor sdk, astro, vite-plus), three differ from upstream's lockfile:
  - `vite-plus` 0.3.3 is Kata's pin.
  - `undici` 6.28.1 is an older-major transitive kept from the base. The dedupe override targets `^8` only.
  - `@effect/sql-d1` resolves 4.0.1 inside its `^4` range.
- `patches/alchemy@2.0.0-beta.80.patch` carries Kata's beta.79 content. beta.80 still replaces a PostgreSQL database on a replica change, and Kata's PlanetScale replica sections apply to beta.80 without fuzz. Its Drizzle sections equal upstream's. Upstream's `Test/Vitest` hunk has no Kata importer.
- Effect, `@effect/vitest`, and the opencode patches are upstream's; Kata had no content of its own in them. Every new patched dependency is pinned exactly, so Release Smoke resolves the patched versions without a lockfile.
- Kata's overrides (`expo-modules-core` 58.0.11 and the Expo pins) are unchanged.

## Migrations

- Server: upstream's 57 `ScheduledTaskWebhooks` and 58 `WebhookRelayDeliveries` run as Kata **62** and **63**. Kata already shipped 57–61, and `scheduled_tasks` comes from Kata 59. `059_OrchestrationV2.test.ts` and `KataUpstreamUpgrade.test.ts` list 62 and 63.
- Relay: upstream adds `20261004061459_hold_webhooks_while_offline` and `20261005232034_managed_endpoint_tunnel_released_at`. The no-op `20261006080000_merge_upstream_kata_webhook_heads` joins both snapshot heads. The expected head in `infra/relay/src/persistence/schema.test.ts` moves to it.

## Preservation gate

Every changed owner path gets a TAKE disposition. No retained outcome changes.

| Check                                                                            | Changed owner paths                                     | Disposition                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `product-identity-release-ownership`, `connect-wire-identity`, `state-isolation` | `FORK.md`                                               | Pin row, intake links, and previous-pin line                                                |
| `migration-identity`                                                             | `Migrations.ts`, `KataUpstreamUpgrade.test.ts`          | Kata 1–61 unchanged; upstream 57/58 appended as 62/63                                       |
| `retained-process-credential-behavior`                                           | `processRunner.ts`, `VcsProcess.ts`                     | Effect 4.0.1 import paths only                                                              |
| `mobile-shelf-preferences`                                                       | `use-thread-list-v2-shelf-preferences.ts`               | Import path only                                                                            |
| `mobile-markdown-image-lifecycle`                                                | `ThreadMarkdownImage.tsx`                               | Adds the `tool-output-image` resource and its cache key; the lifecycle guards are unchanged |
| `desktop-protocol-bundle-identity`                                               | `ElectronProtocol.ts`                                   | Import path only                                                                            |
| `desktop-url-handler-backend-routes`                                             | `DesktopLinuxUrlHandler.ts`, `DesktopBackendManager.ts` | Import paths; `catchTag` becomes `catchTags`                                                |
| `desktop-browser-session-isolation`                                              | `BrowserSession.ts`                                     | `Encoding.encodeHex` becomes `Hex.encode`; partition names are unchanged                    |
| `desktop-window-behavior`                                                        | `DesktopWindow.ts`                                      | Optional renderer-history registration for main and splash windows                          |
| `desktop-packaging-asset-identity`                                               | `scripts/build-desktop-artifact.ts`                     | Import paths only                                                                           |
| `release-package-ownership`                                                      | `scripts/update-release-package-versions.ts`            | Import path only                                                                            |
| `mobile-theme-native-identity`                                                   | `mobileTheme.ts`                                        | `nativeColors` is exported for HTML renders                                                 |
| `connect-early-access-waitlist`                                                  | `SettingsNotificationsRouteScreen.tsx`                  | Import path only                                                                            |
| `model-manifest-newer-bundle`                                                    | `ModelManifest.ts`                                      | Atomic cache write after Kata's older-manifest rejection                                    |
| `icon-composer-live-evidence`                                                    | `scripts/export-brand-icons.ts`                         | Import paths only                                                                           |

## Pin consumers

The following all name `4ae976dbae`:

- `FORK.md`
- both `Lint`-job literals in `.github/workflows/ci.yml` (`UPSTREAM_TIP`, `UPSTREAM_SHA`)
- the runbook's frozen refs and command examples
- `currentUpstreamSha` in `scripts/check-upstream-preservation.test.ts`

The original root stays `6a687ee43b`. The historical baseline worktree cannot run under Effect 4.0.1: its tree imports the removed `effect/Encoding` and calls `.compose()` methods 4.0.1 removed, at module scope. `baselineCandidateSha` therefore moves to this branch's integration commit, with that commit's own pin, `4ae976dbae`, as `baselineUpstreamSha`. That commit is an ancestor of `main` only if the PR lands as a merge commit. The annotated tag `upstream-baseline/kat-3686` points at it so that CI, which fetches tags with `fetch-depth: 0`, still finds it after a squash or rebase merge.

## Follow-ups

- KAT-3687: move the trusted tests to stable Effect imports and drop the alias patch.
- KAT-3688: scan CloudLink and the relay hook files in the Connect wire check.
- KAT-3689: reconcile webhook automations with Kata Routines.
- KAT-3690: secret card storage and unattended runs.
- KAT-3691: HTML preview Chrome download and its `--no-sandbox` fallback.
- KAT-3692: legacy tunnel cleanup dry run and decision.
- KAT-3685: KAT-3668's lesson.

## Independent review

Three independent Opus reviews covered the complete fork delta, split into three lenses: server and relay; clients and contracts; and identity, dependencies, workflows, and deletions. Each compared Kata's divergence from the previous pin before the merge, identity-transformed, with its divergence from the frozen tip after the merge, file by file. Cleanly merged files got the same check as conflicts.

- **Server and relay:** no blocker. 857 files were checked and 54 flagged hunks were read by hand; every Kata line is present at its new location. Accepted notes:
  - A failed Linear OAuth token save now answers with CloudLink's fixed message. The relay treats every delivery failure alike, and the `RoutineError` is still logged as the cause.
  - The relay drops the `service.namespace` resource attribute, as upstream #16382 does; `docs/operations/observability.md` names it only for the server and desktop.
  - Headless Chrome inherits the server environment. This is added to KAT-3691.
- **Clients and contracts:** no blocker. 520 files were checked, and none lost Kata divergence. Its should-fix item, older Kata clients and the new `secret_request` and webhook data, is recorded under "Intake review" above.
- **Identity, dependencies, and workflows:** found the corrupted opencode patches, which `5c64b30f29` had already fixed. It also found that the baseline commit is lost on a squash merge, now covered by the `upstream-baseline/kat-3686` tag. Whole-tree counts of `@t3tools/`, `T3CODE_`, `T3 Code`, `T3 Connect`, `/.well-known/t3/`, and `t3-env:` are unchanged from the base. The extra `t3.codes` is a relay CORS test fixture.
- CodeRabbit skips PRs with more than 100 files, as recorded for earlier integrations.

## Verification

Code under test is `5c64b30f29ee584cbd3046c2bead188160360ba4`'s tree on base `992475cf95ff829e11eb2101dcbc498bd0af00ee`. The commit recording this section changes only this document and a comment in `scripts/check-upstream-preservation.test.ts`.

**Local checks** (macOS):

- Pass: `vp run typecheck` (15 packages), `vp check` (0 errors), `vp run knip:check`, `check:branding` and `test:branding`, `check-workflow-references` and its test, the Connect wire scan (25 files), the nightly gate test, `vp install --frozen-lockfile`, `build:desktop` and preload verification, `lint:mobile`, and release smoke.
- Suites: web 445 files and 5,969 tests; server 516 files and 7,032 tests; non-server partition with the macOS-only mobile native tests, all passing after the merge commit existed. Before that, two script tests that build a worktree from `HEAD` failed because `HEAD` was still the base; after the commit, `check-upstream-preservation.test.ts` and `connect.test.ts` pass, 41 of 41.
- Running alone on this Mac, `cli/invocation.test.ts` (2), `AntigravityAdapterV2.test.ts` (2), and one `GitVcsDriverCore.test.ts` case also fail on landed `main` `99fa8759e3`, so they predate this merge. All of them pass in the full server run.

**PR CI:** run 37443758048 on `5c64b30f29`, all 17 jobs green. Run 37443388527 on `ad0fc656d6` failed `vp install --frozen-lockfile` in every job because of the opencode patches.

**Web** (`verify-katacode`, agent-browser 0.38.2): run `web-20261006-093214-bf02eb51` on `main` `992475cf95`, and run `web-20261006-093646-1d9a2766` on `5c64b30f29`. All 10 scenarios pass:

1. Pairing, the setup wizard without import, and the empty landing match `main` pixel for pixel (0 differing pixels).
2. Settings → Connections uses Kata Code Connect copy and has the Add Environment form.
3. Settings → Scheduled Tasks → New task offers "On webhook" with no T3 copy. The Kata Code Connect URL note appears only after saving, and it was checked in source, not live.
4. The Source Control branch prefix default is `katacode`.
5. Storage → Worktree location defaults to the Kata Code home folder, and the server created `<home>/worktrees` in the disposable home.
6. Settings General and Providers render.
7. Usage switches from Cost to Tokens.
8. The command palette filters to "Open settings" and opens it.
9. Adding a local folder project opens its draft composer and lists it in the sidebar filter.
10. The Pull Requests page renders. No captured snapshot contains T3 product copy.

No message was sent to a provider, to avoid a billed call. Two screenshots and a 29.8-second walkthrough of scenarios 6–9 are on PR #361.
