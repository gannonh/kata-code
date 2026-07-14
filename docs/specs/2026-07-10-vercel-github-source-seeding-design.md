---
type: Spec
title: Vercel GitHub repository and branch seeding
description: Create Vercel sandboxes from a selected GitHub repository and branch through Vercel native Git source support, while preserving authenticated Git and GitHub CLI access in persistent sandboxes.
status: Implemented
approved_at: 2026-07-10T17:07:30Z
---

# Vercel GitHub repository and branch seeding

## Status

Implemented

## Goal

Vercel sandbox creation uses a persisted GitHub repository and branch selection instead of uploading the host working tree. Vercel clones the selected source into its native workspace, `/vercel/sandbox`. The persistent sandbox supports authenticated `git` operations and `gh` after creation and after stop/start.

## References

- [Phase 3b Vercel Sandbox driver](/specs/2026-07-04-kata-environments-deployments-phase-3b-design.md)
- [Sandbox lifecycle design](/specs/2026-07-07-kata-sandbox-lifecycle-design.md)
- [ADR 0007 — Vercel Sandbox first cloud sandbox driver](/adrs/0007-vercel-sandbox-first-cloud-sandbox-driver.md)
- [Deferred Docker remote-source work #29](https://github.com/gannonh/kata-code/issues/29)

## Verified current state

- `repoSeedArchive.ts` builds a host-side archive that includes `.git`; its default cap is 256 MiB. The local repository currently exceeds that cap because a single Git pack is about 438 MiB, while the selected source tree is about 1.87 GiB.
- `SandboxService.startSession` passes a host repository root to `runSandboxSetup`, which builds and uploads that archive through the driver `copyInto` capability.
- `VercelSandboxProvider` creates a runtime sandbox, bootstraps Kata/provider CLIs, then exposes public reachability. Its SDK wrapper currently models snapshot source only.
- The installed `@vercel/sandbox` v2.4.0 declarations define Git source variants with `url`, optional `username`/`password`, `depth`, and `revision` (`packages/sandbox-vercel/node_modules/@vercel/sandbox/dist/sandbox.d.ts`). Its README identifies `/vercel/sandbox` as the default session working directory and writable user-code location. Kata's wrapper must expose that existing SDK capability.
- Persistent Vercel sandboxes snapshot their filesystem on stop and restore it on start. Vercel driver commands already use `/home/katacode` as `HOME`.
- `GitHubCli` already centralizes host `gh` process execution and normalizes unauthenticated-client errors. On 2026-07-10, the active host session returned a non-empty value from `gh auth token --hostname github.com`; the value was not displayed or persisted.
- `SavedEnvironmentEditor` keys per-repository setup settings from a repository canonical key. The current editor chooses among open local projects.

## Decisions and constraints

- Vercel uses native Git source. It does not build or upload a local repository archive.
- Docker remains on its existing local-worktree seed flow and `/workspace` convention. Follow-up work is tracked in [#29](https://github.com/gannonh/kata-code/issues/29).
- A Vercel target requires a selected GitHub repository and branch before creation. Existing Vercel targets without a source remain editable and show a required-source state.
- The source selection persists with the Vercel target. A sandbox source cannot change while a Vercel sandbox exists. The user deletes the sandbox, changes the source, then creates a new sandbox.
- Vercel’s clone workspace is `/vercel/sandbox`; Docker setup remains `/workspace`.
- Existing `.kata/environment.json` precedence and saved per-repository setup settings remain intact. All non-repository credential seeding remains intact.
- GitHub access reuses the active host `gh` session. Kata never adds a target-specific GitHub token setting.
- GitHub tokens must not enter settings, the durable sandbox-session store, RPC results, UI state, progress output, or logs. The persistent sandbox stores GitHub CLI credentials because authenticated post-clone Git and `gh` are required.
- Vercel `Sandbox.create` remains billable and non-idempotent. It is never retried automatically.

## Design

### Source record and lifecycle ownership

`VercelSandboxConfig` gains an optional GitHub source record for backward-compatible settings decoding. It is hidden from the generic provider-settings renderer because the Vercel card owns its dedicated picker:

- `repository`: canonical `owner/name` GitHub repository name.
- `branch`: selected branch name.

The settings envelope’s existing `repositoryKey` is set to the source’s canonical GitHub key by calling the existing `normalizeGitRemoteUrl` with `https://github.com/<owner>/<name>.git`. It therefore remains the key for `savedSandboxEnvironments` without creating a synthetic local `RepositoryIdentity`. Server-side validation derives and verifies that key from the selected source before creation.

A source is optional only while loading a legacy target or testing Vercel credentials. `SandboxService.startSession` owns the source-required check for a Vercel create path; Vercel's driver can still provision a source-less disposable test sandbox. A Vercel `SandboxSessionRecord` gains an optional `sourceFingerprint`, calculated as SHA-256 of `<canonical repository key>\0<branch>`. `storeSessionRecord` writes it for Vercel creates. Lifecycle start derives the current fingerprint and rejects a missing or mismatched stored fingerprint, requiring delete and recreate. Optional schema decoding preserves older records.

### GitHub discovery RPCs

The sandbox RPC contract gains read-only GitHub discovery methods:

- Repository search returns accessible repositories with `nameWithOwner`, display URL, default branch, visibility, and pagination metadata.
- Branch search accepts a selected `owner/name` repository and returns branch names with pagination metadata.

The server implements both through new narrowly typed `GitHubCli` methods backed by the active host `gh` authentication. Repository discovery calls `gh api /user/repos` with `affiliation=owner,collaborator,organization`, paginates by page, and schema-decodes `name`, `full_name`, `html_url`, `default_branch`, and `visibility`. Branch discovery calls `gh api /repos/<owner>/<repo>/branches`, paginates by page, and schema-decodes branch names. The combobox filters loaded pages by the entered text and requests further pages explicitly, so discovery stays bounded and observable. The browser never receives an access token or executes `gh`.

Unauthenticated, unavailable, permission, malformed-response, and network failures reuse the existing GitHub CLI error normalization and show the concrete recovery message. The source picker does not silently fall back to local projects or unauthenticated public browsing.

### Vercel native clone

The Vercel SDK wrapper expands `source` to model native Git source. On initial Vercel provisioning, the driver passes:

- HTTPS GitHub repository URL derived from `owner/name`.
- GitHub HTTPS token credentials supplied only in the `Sandbox.create` request.
- `depth: 1`.
- `revision` set to the selected branch.

The wrapper models the installed SDK's Git source union as `{ type: "git", url, username: "x-access-token", password: token, depth: 1, revision: branch }`. The source clone supplies `.git` metadata without transferring host Git packs or local generated files. Vercel can resolve the revision to a detached `HEAD`, so the provider creates the selected local branch at that revision before Kata starts its server. Lifecycle start repairs a detached source checkout and preserves an existing branch checkout. The Vercel setup workspace is `/vercel/sandbox`.

The Vercel provider remains responsible for the Vercel SDK source payload. The server resolves the active GitHub token immediately before provisioning and appends it under a reserved transient provision-environment name. The Vercel provider extracts that value only when both a configured source and transient token exist, then excludes it from create-time and serve-time sandbox environment variables. This preserves the frozen required provision signature while keeping the token out of persisted config, the provider handle, and the session record. `testConnection` omits the transient value, so its disposable Vercel probe remains source-less even when a target has a configured source.

### Setup and configuration resolution

Sandbox setup receives an explicit workspace path instead of assuming `/workspace`:

- Docker continues to seed and set up `/workspace` from a host repository root.
- Vercel sets up `/vercel/sandbox` after Vercel’s native clone. It never calls `buildRepoSeedArchive`.

Environment-config loading is split into shared parse/merge logic plus source-specific readers. The shared layer accepts optional raw JSON and a repository key, decodes a present file with the current `EnvironmentConfig` schema, looks up `savedSandboxEnvironments[repositoryKey]`, and invokes the existing resolver. The Vercel reader first executes a fixed `test -f .kata/environment.json` in `/vercel/sandbox`; on success it reads the fixed file with `cat` and passes raw text to the shared parser. Exit code 1 means absent; read or parse failures fail creation and delete the newly created sandbox. The Docker reader retains host filesystem behavior.

`RunSandboxSetupInput` gains `workspace: { path, seed? }`: Docker passes `{ path: "/workspace", seed: { repoRoot } }`, while Vercel passes `{ path: "/vercel/sandbox" }`. Install, start, and terminal commands use `workspace.path`; only the Docker path calls `buildRepoSeedArchive`. The existing rejection of Dockerfile-based environment config for Vercel remains.

### Provision routing

`SandboxService.startSession` routes by driver kind. For Vercel it rejects a client-supplied local `repository` input, derives the source and canonical key from decoded Vercel config, resolves the saved environment and host GitHub token, provisions from native source, seeds credentials, loads the remote config, and runs remote-workspace setup. For Docker it retains the current optional client repository path, host config reader, archive seed, and `/workspace` setup. The Vercel branch never calls the host archive builder.

### Persistent GitHub authentication

Vercel bootstrap installs `gh` and verifies it is executable. The exact Amazon Linux installation command is a build-blocking Vercel runtime spike. Bootstrap fails if `gh` cannot be installed; it does not continue with a partially configured sandbox.

After provider credential seeding and before repository setup commands, a dedicated GitHub-auth seed packs one mode-0600 token file and transfers it through `copyInto` to a random `/tmp/kata-github-auth-<nonce>/token` path. One `driver.exec` command uses `set -eu` and an `EXIT` trap to remove that token file and directory, runs unattended `gh auth login --hostname github.com --with-token < "$tokenFile"`, then runs `gh auth setup-git`. The command contains the random path, never the token.

The token itself is never placed in an exec command, command output, log message, settings record, session record, browser response, create-time sandbox environment, or serve-time sandbox environment. The reserved transient provision tuple is excluded before environment construction. `runGitHubAuthSeed` receives the in-memory token as a redaction value and applies the existing `redactSecrets` helper to captured stdout and stderr before mapping a failure. The resulting `gh` and Git configuration live under `/home/katacode`, so Vercel’s persistent filesystem snapshot preserves authenticated Git and `gh` across stop/start. The native clone credentials serve creation; the seeded `gh` configuration serves subsequent work.

Provider static and credential archives remain separate and unchanged. The GitHub auth seed is a dedicated small archive, not a repository archive.

### Settings UI

Vercel cards replace the local-project “Saved environment” selector with compact progressive source controls:

1. **GitHub repository** is a keyboard-accessible searchable combobox with loading, empty, and error states.
2. **Branch** is disabled until a repository is selected, initializes to the repository default branch, and uses a searchable paginated combobox.
3. Existing install, start, terminal, and repository environment-variable fields appear immediately under the selected source controls and continue to edit saved settings for that repository key.

`SavedEnvironmentEditor` receives the selected canonical repository key directly for Vercel and renders no second repository field. The GitHub repository and branch controls are the sole Vercel source selector. Beneath a selected source, the card states that `.kata/environment.json` is read from the selected branch at creation and that its install, start, and terminal fields override corresponding saved settings. Docker continues supplying its local-project selector.

When Add Project opens for a Vercel sandbox, its filesystem browser starts at `/vercel/sandbox/`, Vercel's native Git clone root. This lets repository identity resolution group the remote source with the matching local project.

`Create & run sandbox` is disabled until both controls are selected. Test connection remains available without a source because it only validates Vercel credentials. When a Vercel sandbox is running or stopped, source controls are disabled with a clear instruction to delete the sandbox before changing repository or branch.

The picker follows the existing accessible combobox primitives and exposes labels, keyboard navigation, focus handling, loading status, error status, and selected values at WCAG 2.1 AA. Docker cards retain their existing local project selection UI.

### Failure and cleanup behavior

- Missing host `gh` or no active GitHub authentication fails before `Sandbox.create` with `gh auth login` guidance.
- Repository/branch discovery errors remain in the picker and preserve the user’s existing selection.
- A native clone failure, `gh` bootstrap failure, GitHub-auth seed failure, invalid remote environment config, or setup failure deletes the newly provisioned sandbox and removes its in-progress session record.
- A stopped Vercel sandbox resumes its existing filesystem. Start does not clone, reseed, or replace GitHub auth.
- Source change attempts while a sandbox exists fail clearly at both UI and server boundaries.

## Acceptance criteria

1. **AC-GS1** — A Vercel target persists a selected GitHub `owner/name` repository and branch. Its derived `repositoryKey` is `github.com/<owner>/<name>`. Legacy Vercel targets still decode, but Create fails with a source-selection message until both values exist.
2. **AC-GS2** — Authenticated repository and branch discovery use the existing host `gh` session. RPC results contain only repository/branch metadata and pagination data; they contain no GitHub token or credential path.
3. **AC-GS3** — The Vercel settings card provides labeled, keyboard-operable searchable repository and branch comboboxes. Selecting a repository initializes Branch to its default branch. Loading, no-result, and GitHub-authentication failures have observable accessible status text.
4. **AC-GS4** — A Vercel sandbox cannot be created without a selected repository and branch. Test connection remains usable without a source and creates a disposable source-less Vercel probe. Docker retains its existing local-project selection and local seed behavior.
5. **AC-GS5** — Initial Vercel provision sends `{ type: "git", url, username, password, depth: 1, revision }` with the selected HTTPS repository URL, `x-access-token` username, in-memory GitHub token, and selected branch. The cloned workspace is `/vercel/sandbox`, and the selected revision is attached to a local branch before Kata accepts worktree requests.
6. **AC-GS6** — Vercel creation never calls `buildRepoSeedArchive`, never uploads a host repository tar, and does not invoke the Vercel repository `copyInto` path. Provider credential seeds and the small GitHub-auth seed still use supported small-file transfer.
7. **AC-GS7** — Vercel reads `.kata/environment.json` from `/vercel/sandbox` through driver exec, preserves current saved-environment merge precedence using the derived canonical GitHub key, rejects a Dockerfile build for Vercel, and runs install/start/terminal commands in `/vercel/sandbox`. Docker retains `/workspace` setup behavior.
8. **AC-GS8 — Maintainer-local UAT** — A created Vercel sandbox has executable `gh`, an authenticated `gh auth status`, and Git credential-helper configuration. An authenticated Git operation succeeds against a private repository selected by the maintainer-local UAT account.
9. **AC-GS9** — GitHub token material is excluded from settings, sandbox session records, RPC results, UI state, progress output, Kata logs, create-time sandbox environment, and serve-time sandbox environment. The temporary token file is removed after auth bootstrap on both success and failure paths. Tests verify token redaction, transient-environment exclusion, source payload separation, and an origin URL with no embedded token.
10. **AC-GS10** — Stop/start resumes the same Vercel filesystem: the selected clone, `gh auth status`, and authenticated Git operation remain available without another clone or credential seed.
11. **AC-GS11** — A Vercel source control is locked while a sandbox record exists. After Delete sandbox, the selection becomes editable; the next Create clones the new source. Server lifecycle start rejects a source fingerprint mismatch.
12. **AC-GS12** — Missing host GitHub auth, inaccessible repository/branch, clone failure, `gh` installation/auth failure, malformed remote environment config, and setup failure surface actionable errors. A new sandbox created for a failed setup is deleted.
13. **AC-GS13** — Unit and browser tests cover source validation, GitHub discovery parsing/errors, SDK source payload, attached source branch, no-local-archive Vercel path, dynamic workspace setup, config precedence, source locking, and token redaction. The tagged Electron E2E for interactive source selection, New worktree base-branch selection, and locked lifecycle state is maintainer-local (no CI Vercel secret) and deferred to [#32](https://github.com/gannonh/kata-code/issues/32); interactive `VercelSourcePicker` component tests are deferred to [#31](https://github.com/gannonh/kata-code/issues/31).
14. **AC-GS14** — `vp check`, `vp run typecheck`, `vp run test`, `vp run release:smoke`, and the focused `@environments-deploy` Electron E2E pass. Maintainer-local Vercel UAT records evidence for private clone, local branch checkout, New worktree base-branch selection, `gh auth status`, authenticated Git, and persistence after stop/start.

## Implementation phases

1. **Runtime spike and contracts** — Validate and pin a supported `gh` installation procedure on the Vercel Amazon Linux runtime; add source/discovery contract types, safe GitHub CLI methods, source validation, source-fingerprint store migration, and fake fixtures. The installed SDK Git-source type is already verified locally. Stop for a user decision if the Vercel runtime cannot install a supported `gh` binary.
2. **Vercel driver** — Extend the SDK wrapper and provider source model, pass native Git source into create, use `/vercel/sandbox`, and add source-related driver tests.
3. **Server setup path** — Split workspace/config loading, route Vercel through native source without repository archive construction, add GitHub auth seeding/redaction/cleanup, persist source fingerprints, and retain Docker behavior.
4. **Settings UI** — Implement source discovery hooks and accessible comboboxes, replace Vercel’s local-project editor binding, enforce source-required creation and source locking, and preserve saved setup editing.
5. **Verification and documentation** — Add focused tests and Electron E2E, run required gates, perform credentialed Vercel UAT, and record the implementation result in this spec and the OKF log.

## Risks and mitigations

- **Vercel runtime package availability:** validate the `gh` installation procedure before broad implementation. The provisioning path fails loudly if executable verification fails.
- **GitHub token lifetime or revocation:** later Git operations surface normal GitHub authentication failures. Recreate the sandbox after refreshing host `gh` authentication; automatic token refresh is out of scope.
- **Persistent secret storage:** authenticated Git and `gh` require a token in the persistent sandbox filesystem. The token remains absent from Kata-managed persistence and observability surfaces.
- **Branch deletion or access changes:** creation fails at clone time with the provider error; the user selects a valid branch or refreshes access.
- **Source drift after settings changes:** UI locking and server source-fingerprint comparison require delete/recreate instead of silently starting a sandbox with unexpected source content.

## Explicitly deferred work

- Docker GitHub remote-source selection and cloning are deferred to [#29](https://github.com/gannonh/kata-code/issues/29). Docker continues using the local worktree seed path for this feature.
- Automatic refresh of expired GitHub credentials inside an existing Vercel sandbox is out of scope. The recovery path is host `gh` reauthentication followed by sandbox delete/recreate.

## Build handoff

Implement only Vercel native Git source, GitHub repository/branch selection, remote-workspace setup, and persistent Git/`gh` authentication described here. Preserve Docker’s current source path, provider credential seeding, Vercel lifecycle behavior, and saved-environment precedence. Begin with the Vercel `gh` install spike, then stop and ask for direction if it fails. Complete the acceptance criteria and required verification before changing this spec from Approved to Implemented.

## Build completion report

**Branch:** `feat/vercel-github-source-seeding` · **Base:** `5e40de257` · **Head:** `c46acf4a7`

### Commits

1. `1df4f126b` feat(sandbox-vercel): install gh in bootstrap — live-verified official RPM install of `gh 2.96.0` on the Vercel `node24` runtime; fail-loud (no `|| true`).
2. `b98261e3a` feat(sandbox): add GitHub source contracts — optional `source {repository, branch}` config field; `vercelGitHubSource` canonical-key/URL/fingerprint helpers; host-`gh` `searchRepositories`/`listBranches`/`getAuthToken`; read-scoped `sandbox.searchGitHubRepositories`/`listGitHubBranches` RPCs + client runtime.
3. `923f8914d` feat(sandbox-vercel): clone from native git source — SDK wrapper Git-source union; provision builds `{type:"git", url, username:"x-access-token", password, depth:1, revision}` from config + a reserved transient token env excluded from create/serve env.
4. `0300210c2` feat(sandbox): seed vercel github source setup — provision routing (Vercel vs Docker), injected host GitHub token, trap-cleaned auth seed, remote `.kata/environment.json` read at `/vercel/sandbox`, dynamic setup workspace, non-secret `sourceFingerprint` persisted and enforced on lifecycle start.
5. `c46acf4a7` feat(web): add vercel github source picker — accessible searchable repository/branch comboboxes with pagination, source-required Create gating, source locking, and saved-env binding to the selected source.
6. `555789ed7` fix(web): open Vercel projects at clone root — Add Project now starts at `/vercel/sandbox/` for Vercel so its Git identity groups with the matching project.

### Acceptance status

- **AC-GS1–AC-GS7, AC-GS9–AC-GS12:** implemented and covered by unit/logic/browser tests.
- **AC-GS8, AC-GS14 (UAT portion):** maintainer-local Vercel UAT pending (no CI Vercel secret).
- **AC-GS13:** unit/browser coverage landed; interactive picker component tests deferred to [#31](https://github.com/gannonh/kata-code/issues/31); the tagged Electron E2E for source selection/lock is maintainer-local and deferred to [#32](https://github.com/gannonh/kata-code/issues/32).

### Verification

`vp check` (0 errors), `vp run typecheck`, `vp run test` (all packages green), and `vp run release:smoke` pass on head `c46acf4a7`.

### Post-implementation correction

Vercel's native Git `revision` checkout can leave `HEAD` detached. The provider now creates the selected local branch at that revision before bootstrap, so the chat worktree picker has a base ref. Lifecycle start conditionally repairs a detached checkout while preserving an existing branch checkout. A sandbox created before this correction receives the repair after Stop and Start.

### Deferred follow-ups

- Docker GitHub remote source — [#29](https://github.com/gannonh/kata-code/issues/29).
- `SandboxService` Vercel orchestration tests — [#30](https://github.com/gannonh/kata-code/issues/30).
- `VercelSourcePicker` component tests — [#31](https://github.com/gannonh/kata-code/issues/31).
- Vercel source-selection/lock Electron E2E — [#32](https://github.com/gannonh/kata-code/issues/32).
- Maintainer-local Vercel UAT evidence (AC-GS8/AC-GS14) before release sign-off.
