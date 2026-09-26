# KAT-3496 upstream intake

## Frozen refs

| Value                  | Commit                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Kata base              | `50f52dae6320049b933ade4f19f74d207ece78b4` (`origin/main` 2026-09-26T07:00Z) |
| Previous upstream pin  | `b3de243d5ed44783c4e7990d8e63cb519d390a03`                                   |
| Frozen upstream target | `a21b42cec478b093cdc50cc2105b5368ea8b3546` (frozen 2026-09-26T07:01Z)        |
| Original upstream root | `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`                                   |

Run `kat-upstream-20260926T070042Z-claude-mini` froze a range of 44 commits and 217 changed paths (196 modified, 20 added, 1 deleted). The previous pin is an ancestor of the target. The range adds no server or relay migrations, edits no workflow files, and adds no binary assets.

KAT-3471 landed the previous pin through PR #273 as squash `88562206ed9436f86f7cb80ca6ce7154461b1db6` (single parent `f73921e6f321b4c47220d501a0f6b73baa97c7a3`), so `b3de243d5` is not an ancestor of the Kata base. `docs/upstream/kat-3471-intake.md` accounts for that exact pin, including its SKIPs. The branch records it with `git merge --strategy=ours --no-ff` as `63c6814f2d79aaf39be5f3b7c03de5f55491ead4`; the tree equals the base and `git merge-base --all HEAD a21b42cec` returns exactly `b3de243d5`. The three-way merge of `a21b42cec` follows. This run also recorded KAT-3471's post-merge acceptance on that issue and filed its lesson as KAT-3495.

## TAKE

- Merge frozen tip `a21b42cec` with a normal three-way merge after the anchor.
- Take the upstream product changes with `@t3tools/*` imports mapped to `@kata-sh/code-*`:
  - server performance work on thread lists, settlement, PR sync, shutdown, and review previews;
  - SQLite WAL shrinking and prepared-statement retries;
  - event loop stall spans, SIGUSR2 heap snapshots, and subprocess span command names;
  - `katacode trace summary` (upstream `t3 trace summary`);
  - replay-marker pruning in the secrets directory;
  - Cursor, OpenCode, and Antigravity usage readers, the Cursor Keychain opt-in, and pricing fixes;
  - the chat width setting, Mod+B on non-Latin layouts, the draggable empty workspace, compact provider badges, and composer focus after a citation note;
  - Android control sizing, project icons in the mobile chat list, and lighter Home rows;
  - editor discovery and `agy` fixes, SSH port stripping in provider URLs, the OpenCode v2 ready line, idle shell cleanup on thread settle, and the `katacode app` second-quit fix;
  - the updated OpenAI provider logo, a third-party mark rather than Kata artwork.
- Take the standard `OTEL_EXPORTER_OTLP_*` endpoint, header, and protocol variables in the server, the desktop main process, and WSL backends. A non-blank `KATACODE_OTLP_*_URL` still wins.
- Take upstream's fixed OTLP service names under Kata identity. See the observability section.

## SKIP

- Skip upstream `AGENTS.md`, user-visible T3 names, package scope, CLI names, environment prefixes, state directories, protocols, bundle identifiers, hosted URLs, and release destinations.
- Keep deliberate cleanup: deleted `.repos`, `.plans`, `.macroscope`, and parked workflows. The range touches none of them.
- Skip upstream's edit to the trusted `apps/server/src/processRunner.test.ts`. See the trusted assertions section.

## Identity mapping

Identity mapping applies only to lines this merge adds. Pre-existing retained identifiers stay. Upstream `@t3tools/` imports, `T3CODE_{OTLP,TRACE,HOME,OTEL_SDK,LOG}_*` operator variables, `T3 Code` copy, `t3 trace|triage|app` commands, `npx t3`, and `$HOME/.t3` become `@kata-sh/code-`, `KATACODE_*`, `Kata Code`, `katacode …`, `npx @kata-sh/code-cli`, and `$HOME/.katacode`. Private symbols (`T3CODE_TRUE`, `T3CODE_FALSE`), temporary directory prefixes, CSS `font-t3-*` utilities, and `__T3_SETUP_DONE__` stay under the identifier policy in `FORK.md`. The independent review found new T3 copy in `docs/user/usage.md` that the branding scanner does not cover; it now names Kata Code. Two older occurrences in `docs/user/` are KAT-3500 (Backlog).

## Observability service names

Upstream #13699 fixes each application's OTLP service name, adds `service.namespace`, ignores `OTEL_SERVICE_NAME`, and removes the service-name variable. Kata takes the model under Kata names:

| Producer             | Before                                     | After              |
| -------------------- | ------------------------------------------ | ------------------ |
| Server               | `t3-server` (`KATACODE_OTLP_SERVICE_NAME`) | `katacode-server`  |
| Server relay client  | `t3-headless-relay-client`                 | `katacode-server`  |
| Desktop main process | `desktop`                                  | `katacode-desktop` |
| Web                  | `kata-web`                                 | `katacode-web`     |
| Web relay client     | `kata-web-relay-client`                    | `katacode-web`     |
| Mobile relay client  | `kata-mobile-relay-client`                 | `katacode-mobile`  |
| Relay worker         | `kata-code-relay-worker`                   | `katacode-relay`   |

Every producer reports `service.namespace` `katacode`. The web keeps `service.runtime` `kata-web` and the server keeps `t3-server`.

This changes a documented Kata operator interface: `KATACODE_OTLP_SERVICE_NAME` is gone, and operators tell installations apart with `OTEL_RESOURCE_ATTRIBUTES` as `docs/operations/observability.md` now describes. The KAT-3496 spec records the change as an accepted adaptation. No retained-behavior inventory entry covers service names, and nothing in the repository queries the old names. Collectors or dashboards keyed on them stop matching. The relay worker reports `katacode-relay` after its next deploy.

## Replay markers

Upstream #13695 prunes replay-marker files older than a day from the secrets directory, using four literal prefixes such as `cloud-mint-nonce-`. Kata's `consumeCloudProof` names its markers `${replayPrefix}-jti-*` and `${replayPrefix}-nonce-*` for three prefixes: `cloud-health`, `cloud-mint`, and the Kata-only `cloud-linear-oauth` from the Linear OAuth broker (KAT-3415). `apps/server/src/cloud/http.ts` now declares those three prefixes once, builds `CLOUD_REPLAY_MARKER_PREFIXES` from them, and uses the same constants at the three call sites. Every Kata cloud proof has the same five-minute lifetime cap, so the one-day prune is safe. `replayMarkers.test.ts` also expires `cloud-linear-oauth` markers and asserts the exact remaining files.

Upstream's server test "rejects cloud replays by time alone once their markers can be pruned" merged cleanly but posted to `/api/t3-connect/*` without the manual relay endpoint Kata requires. It now uses Kata's `/api/kata-connect/*` routes and `manualRelayEndpoint`.

## Conflict resolutions

26 paths conflicted, all content conflicts. Resolutions not covered above:

- Scope-only conflicts in usage, contracts, client-runtime, launcher, and web settings files: Kata scope plus upstream's added imports and doc comments, with Kata Code copy.
- `ProviderCommandReactor.ts`: Kata's `RoutineStore` import beside upstream's `TerminalManager`.
- `server.ts`: Kata's `SpriteActivityLease.layer` beside upstream's `HeapSnapshot.layer`.
- `cli/config.ts`: upstream's shared `traceFileConfig` and `traceMaxFilesConfig` under `KATACODE_*`, and the service-name variable removed.
- `cli/config.test.ts`: Kata's `KATACODE_SANDBOXES` cases and upstream's OTEL precedence cases.
- `DesktopBackendConfiguration.ts` and its test: upstream's WSL forwarding list under `KATACODE_OTLP_*` names plus the standard `OTEL_*` variables.
- `CompactBrandTitle.tsx`: Kata's `KataMark` lockup and inline styles, multiplied by upstream's Android control scale. Android uses upstream's gap and pill padding. On iOS the scale is 1, so iOS is unchanged.
- `docs/operations/observability.md`: upstream's new trace summary, event loop, heap snapshot, and OTEL sections with Kata names.

## Clean merges and new files

Clean merges and new files received the same review as conflicts. All 20 new files fit Kata. Four needed remapping (`projectIcon.ts`, `trace.ts`, `HeapSnapshot.ts`, and the `shell.ts` change). The Antigravity reader keeps its managed profiles under the Kata state directory. `katacode trace summary` reads `KATACODE_HOME` and `KATACODE_TRACE_FILE`. Heap snapshots go to Kata's logs directory. The Cursor Keychain read is limited to Cursor's own `cursor-access-token` entry and requires the `cursorKeychainUsageEnabled` opt-in. Process byte APIs, credential cleanup, sandbox bootstrap-token stripping, Docker/Sprite behavior, the disabled-by-default sandbox preview, the Linear OAuth broker, relay wire identity, the `SettingsScopeContext.tsx` optimistic-file fix, migrations, and desktop identity are untouched by the range. `ProcessRunner` gains only a `process.command` span annotation.

## Codex review

Codex reviewed `69d5e1c` and raised three findings, all in upstream code this merge takes unchanged:

- **P1, fixed here.** Upstream's Cursor account-history scan posts the stored CLI login to `cursor.com` even when a Cursor provider or `CURSOR_API_ENDPOINT` names another endpoint. The limits path already refuses that case. The login is a credential boundary, so `UsageService` now skips the history scan when any Cursor provider instance or its environment names a non-default endpoint, and shows "Cursor account history requires the default Cursor endpoint." `DEFAULT_CURSOR_API_ENDPOINT` is exported from `cursorUsageLimits.ts` so both paths use one value. On Windows the guard matches `CURSOR_API_ENDPOINT` in any casing, because Windows variable names are case-insensitive (Codex re-review of `ea11deb`). A new `UsageService.test.ts` case covers the setting, the host variable, and a lowercase Windows instance variable, and asserts no request to `cursor.com`. Each form fails without its part of the guard.
- **P1, filed as KAT-3501 (Backlog).** Upstream #13673's `closeIdle` treats a same-name child of the terminal shell with no children as an async prompt helper, so a user-started `bash script.sh` running only builtins can be closed when its thread settles. This is upstream's heuristic and needs its own design.
- **P2, filed as KAT-3502 (Backlog).** In a mixed-version fleet, `usageMerge.ts` can count legacy v4/v5 buckets twice when a v6 partial scan shares one of their roots. The effect is display-only.

## Sandbox runtime lock

Upstream adds `@napi-rs/keyring` to `apps/server/package.json` for the Cursor Keychain store. `packages/kata-sandbox-docker/runtime-package-lock.json` must list the same CLI dependencies, or `imageBuild.test.ts` fails and `writeRuntimeInstallLock` refuses to build the sandbox image. The lock now carries `@napi-rs/keyring` 1.3.0 (the `pnpm-lock.yaml` version) and its platform packages, generated with `npm install --package-lock-only` for that exact version.

## Trusted assertions

The preservation gate requires each check's trusted test files to match the Kata base byte for byte. Upstream edited two:

| Trusted file                            | Upstream change                                                           | Resolution                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/server/src/processRunner.test.ts` | New `commandName` case                                                    | Restored to base; the case lives in `apps/server/src/processRunner.upstream.test.ts` |
| `apps/server/src/server.test.ts`        | Service names, OTEL forwarding, replay pruning, removed `otlpServiceName` | Taken; its FAIL line is already in the `ci.yml` allowlist (KAT-3411)                 |

The base `server.test.ts` passes `otlpServiceName`, which no longer exists, so its base bytes would not typecheck. No new `ci.yml` allowlist line is needed.

## Host limits

Local verification runs on a macOS arm64 Mac mini inside a Kata Code agent shell with `ELECTRON_RUN_AS_NODE` unset (KAT-3452). Two mobile native regression tests (`scripts/permissions-service.test.ts` and `scripts/notification-center-manager.test.ts`) cannot compile on this host because the Xcode license has not been accepted. The range does not touch them. In the full parallel server run, "stores browser OTLP trace exports locally" timed out at 120 s under load. It passes alone, and so does the whole `server.test.ts` file (214 tests).
