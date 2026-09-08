# KAT-3297 integration verification

Integration base: `22c5c9c04526199a93fa938d82b5f0fdb8fa8b5e`.
Frozen upstream parent: `12391bd0d38eef6655b7a9f8945d0cb5febadc2b`.
PR: https://github.com/gannonh/kata-code/pull/194.

## Local checks

Run with Node 24.20.0 and the pinned pnpm 11.10.0 dependencies.

| Check                                                 | Result                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vp run typecheck`                                    | All 18 workspaces pass                                                                                                                                             |
| `vp run knip:check`                                   | Files, dependencies and scoped exports pass                                                                                                                        |
| `vp run lint`                                         | Pass; existing upstream warnings remain                                                                                                                            |
| CI non-server test command                            | All 16 tasks pass; includes 4,498 web, 1,399 mobile, 1,351 client-runtime and 1,313 desktop tests                                                                  |
| Server tests                                          | Full run: 4,351 pass, two stale branding assertions fail; corrected suites pass 142/142. Thirteen gated tests skipped. Remote CI reruns the complete server shards |
| Migration tests                                       | 18 files, 19 tests pass; Kata 41/42 preserved, upstream operations 43–51 applied once                                                                              |
| `vp run build:desktop`                                | Server/web/desktop pipeline passes                                                                                                                                 |
| `node apps/desktop/scripts/verify-preload-bundle.mjs` | Pass                                                                                                                                                               |
| Android Expo config                                   | Development/preview/production resolve existing Kata launcher and splash assets; mobile typecheck passes                                                           |

The non-server command is the command checked into `.github/workflows/ci.yml`:
`vp run --parallel --concurrency-limit 4 --filter '!@kata-sh/code-cli' --filter '!@kata-sh/code-monorepo' test`.
CI results on the PR are the durable check records. This file reports local verification;
it does not substitute for required remote CI.

Sandbox restrictions produced subprocess/socket EPERM failures, including in unmodified
upstream ProcessRunner tests. Those tests passed with normal local process permissions;
no production workaround was added. The local node-pty addon needed its existing install
script to build before the app could boot. The verification helper required `lsof`,
unpacked under `/tmp` without changing system packages.

## Browser evidence

Run `web-20260908-181834-b0d70992` used a disposable home. Doctor verified both listener
PIDs belonged to that run. A dedicated browser consumed the startup token through the
pairing form, then opened Settings → General → Experimental.

Observed:

- Pairing page and browser title display **Kata Code (Dev)**.
- Pairing opens the authenticated project composer.
- **Sandboxes (preview)** is unchecked, under Experimental above Legacy features.

Local evidence is in `uat-evidence/web-20260908-181834-b0d70992/`: redacted launch log,
`evidence.json`, before/after screenshots, and accessibility snapshots. The screenshots
were visually inspected. Tokens are excluded. Evidence is gitignored per repository policy.

The current web startup default creates a CWD project, so the older verification recipe's
empty-home landing expectation did not apply. No provider response, native mobile UI,
or native desktop UI was exercised. Settings was entered from the sidebar; palette and
direct-route entry points were not checked.

## Review and follow-up

Independent spec review caught new Android T3 artwork references; these now use existing
Kata assets. Cross-model audit by `gpt-5.6-terra` caught a contradictory preliminary
secret-storage decision, missing migration/CI evidence, and remaining triage template
branding. The append-only decision log records the corrections. Two local-only branding
helpers lost unnecessary exports after comment review; internal Effect identifier
suppressions remain because FORK.md requires retaining internal T3 names.

Pre-existing Android monochrome artwork is tracked separately in new Backlog
[KAT-3301](https://linear.app/kata-sh/issue/KAT-3301). No canceled ticket was reopened.
Gannon must reconfirm final take/skip before merge; merging requires Merging status.
