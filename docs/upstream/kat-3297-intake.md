## Build intake: proposed take/skip

Fixed range `6a687ee43bf222672ab8d3f4c0bab3d8d174f79f..12391bd0d38eef6655b7a9f8945d0cb5febadc2b`, 1,105 commits. Kata baseline `22c5c9c04526199a93fa938d82b5f0fdb8fa8b5e`.

### TAKE
- Upstream web chat, composer, sidebar, project/PR, terminal and preview changes, with supporting client-runtime/contracts/tests. Examples include project favicons `12391bd0d`, file drops `b5d89038a`, preview snapshots `061543e9e`, and recording transfer `9e37f0c29`.
- Provider/session recovery, approvals, interrupts, model discovery and error handling. Representative commits `1abc717f0`, `230c5d4a5`, `17822fab7`, `7c6163c67`.
- Streaming, usage, idle CPU/event-leak fixes (`7e4ce3bbb`, `0bfb6df34`, `e86604d33`, `17490c0a0`).
- Git/worktree, settlement and SSH lifecycle fixes (`994372ba4`, `be3da50e9`, `86070cbc7`, `f32f9a2f4`, `49c2b4471`, `f33fdc992`, `39802c061`, `60e6fa30c`), preserving Kata process and credential behavior.
- Desktop browser/window capture, platform fixes, mobile functionality and native dependency changes; Windows terminal cleanup `47eed9fac`.
- Coordinated persistence, contracts, dependency/lockfile, native, lint/build and test updates, including shared SQLite `ca63d42d6`, Effect/Alchemy `bd56e920b`, and TypeScript `a37c66406`. Adapt active CI to Kata package identities and retained release configuration.

### SKIP / KEEP
- SKIP restoring deleted `.repos/**` reference snapshots. Kata deliberately removed them; runtime dependencies come from package manifests.
- SKIP restoring deleted development/reference/planning debris, including removed `.plans/**`, devcontainer configuration, Macroscope rules, vouch data and Discord announcement tooling. Preserve prior cleanup rather than reactivate it.
- SKIP upstream product/operator identity and T3 artwork substitutions. KEEP Kata branding, `@kata-sh/code-*`, `katacode`, `KATACODE_*`, state directories, protocols, desktop bundle IDs, hosted origins, registry/release ownership and assets. No wholesale rename; internal T3 identifiers follow FORK.md.
- SKIP upstream automation activation and release ownership changes. KEEP Kata active/parked workflow decisions, project instructions and project-local verification skills; take only build changes needed by the integrated runtime.
- KEEP all Kata-only Docker provisioning, credential, private GitHub, resume and preview-gating behavior. `enableSandboxes` remains false by default, with existing `KATACODE_SANDBOXES` override. Browser preview improvements do not enable Docker.
- KEEP shipped Sprite CLI behavior. No canceled Docker Gate 0, Sprite/Phase2 or Vercel driver work is resumed.
- No new KAT-3298 polish. The recorded Kata baseline already contains its merged #192 change, so preserve that existing setting placement.

### Conflict callouts and strategy
Use an equivalent merge from the recorded Kata main with the fixed upstream commit as a parent. A dry `git -c merge.renameLimit=20000 merge-tree --write-tree` found 443 content conflicts plus reference deletion/location conflicts. Most reference conflicts are covered by the explicit cleanup skips above.

Review `server.ts` composition for sandbox routes/services; `processRunner.ts`, `vcs/VcsProcess.ts`, `sourceControl/GitHubCli.ts` and SSH for Kata behavior; contracts/settings and clients for preview gating; manifests/build scripts/hosts/branding for identity. Export refactors and shared SQLite movement can break Kata-only callers without textual conflicts.

Both sides occupy migration IDs 41 and 42. Preserve Kata's already shipped IDs and execute upstream's new schema operations in order at unoccupied IDs; prove startup and schema results before accepting this resolution. Do not silently replace applied migration identities.

Every non-trivial resolution will be logged. If integration requires a different take/skip decision, update this intake before proceeding. Gannon must re-confirm the final take/skip before merge; Build stops at Agent Review and does not merge.

### Verification
Required PR CI, fixed-tip ancestry and FORK.md read-back; stock Kata branding on the pairing/landing surface; Docker preview default and existing toggle placement; persistence collision coverage and relevant Kata-only tests. Follow-up unique-feature tickets will be listed separately, or explicitly none.
