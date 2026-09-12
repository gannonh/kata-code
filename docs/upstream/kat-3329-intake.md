## Build intake: proposed take/skip

Fixed range `12391bd0d38eef6655b7a9f8945d0cb5febadc2b..36668dbe4fe2f8c881cc4f93bc675413eef1406f`, 102 commits, 595 files. Kata baseline `cc884451eb56ca9b97ed527df3819e6dc3227870`. Original fork root `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f`. Run identity `kat-3329-20260912-bc-b1a21cba`.

KAT-3297 / PR #194 already accounted for pin `12391bd0d38eef6655b7a9f8945d0cb5febadc2b` and landed as squash `31828c7463c75197e288c6f52bff77c2c99a93fe`. That pin is an ancestor of the frozen tip and is not an ancestor of Kata main. This run recorded it with `git merge --strategy=ours --no-ff` before merging the frozen tip.

### TAKE

- Web and desktop: project setting overrides, device streams over chat, PR stacks (navigate/merge/rebase), command-palette environments, usage Limits tab, composer and preview performance, macOS permission onboarding, quit-hold, Safari cookie import permission.
- Mobile: Android FCM notifications and ongoing activity, thread drag arrangement, markdown and composer fixes. Keep the internal `t3-agent-notifications` module name.
- Server: device hub and SSH device hosts, PR sync/cache, rename detection in review diffs, compaction message queue, `@kata-sh/code-ssh`.
- Relay: FCM delivery plus APNs routing fixes. `deploy-relay.yml` already active; TAKE `FCM_SERVICE_ACCOUNT`.
- Persistence: upstream migration 050 as Kata 052 `ProjectionThreadPullRequests`. Keep shipped Kata IDs 41-51.
- Marketing copy and artwork that remain intentionally T3-shaped.

### SKIP / KEEP

- KEEP Kata dmg backgrounds. SKIP upstream installer artwork in `0fe4c99ee` and `5d14c0e96`.
- KEEP Kata identity: `@kata-sh/code-*`, `katacode`, `KATACODE_*`, sandbox default off, Docker/Sprite, process and credential boundaries, workflow and release ownership.
- KEEP parked workflows and deliberate deletions (`.repos`, `.plans`).
- KEEP shipped migration identities 41-51. Do not reuse those IDs.
- DELETE `ProjectDefaultActionsSettings.tsx`. Upstream replaced it with `ProjectActionsSettings.tsx`.
- KEEP Kata `knip.jsonc` ignoreDependencies. Add `src/mac-permission-preload.ts!` so the new Electron preload stays as an entry.

### Adaptations

These are not SKIP of features. They keep Kata operator and product identity on taken work.

- Rewrite `@t3tools/{contracts,shared,client-runtime,web,ssh,tailscale}` to `@kata-sh/code-*`. Desktop Effect tags use `@kata-sh/code-desktop/...`.
- User-facing `T3 Code` / `T3 Connect` in shipped web, desktop, mobile, server, packages, and new user/ops docs become Kata Code / Kata Code Connect. Marketing stays T3. Branding-exception comments stay exact.
- New operator env `T3CODE_MOBILE_UPDATES_ENABLED` and `T3CODE_ANDROID_GOOGLE_SERVICES_FILE` become `KATACODE_*`.
- Android application IDs in the new notifications doc match `com.katacode.{dev,preview,app}`.

### Conflict callouts

`git merge-tree --name-only` reported 84 content conflicts plus the modify/delete of `ProjectDefaultActionsSettings.tsx`. An early hunk regex with DOTALL consumed everything after the first conflict marker. Those files were rebuilt with `git merge-file` against previous pin `12391bd0d` and remaining markers taken from upstream.

Review `server.ts` composition for sandbox routes plus `DeviceLayerLive`. Keep `enableSandboxes` default false. Process/credential owners stay Kata. Manifests, lockfile, and migration numbering stay sequential.

### Verification

Required PR CI, ancestry of Kata base and frozen upstream, FORK.md pin read-back. Branding check. Trusted-base preservation checker in `ci` then `human-review`. Live branding, device, and provider evidence, or explicit `NOT RUN`. KAT-3301 Android monochrome remains separate.
