# Product branding

KAT-3306 restores Kata Code copy in the shipped web, desktop, mobile, CLI, and user-visible server paths. Marketing is unpublished and managed separately; this change excludes `apps/marketing` entirely.

Use `APP_BASE_NAME` and `CLOUD_PRODUCT_NAME` from `@kata-sh/code-shared/branding` where a shared runtime value is practical. The Connections row and settings search share `CLOUD_PRODUCT_NAME`. Native helpers use literal Kata Code text. Desktop release history and version links point to `gannonh/kata-code`. Copied Bitbucket checkout commands use `katacode-pr-*` as the destination.

## Regression check

Run `vp run check:branding` and `vp run test:branding`. CI runs both in its Check job. The checker discovers files recursively under `apps/web`, `apps/desktop`, `apps/mobile`, `apps/server`, `packages`, and `native`, including newly added untracked files. It scans source, UI markup, and configuration text for case-insensitive `T3 Code`, `T3 Connect`, `T3 Server`, `T3 account`, `T3 thread(s)`, and known environment/backend/runtime/preview phrases, including whitespace split across lines. It excludes dependency/build output, tests, and fixtures. It is a copy check, not a replacement for reviewing standalone names, images, dynamically assembled strings, or new file formats.

`branding-exceptions.json` permits only exact comment text at an exact source path. Every entry states why it remains. No whole source file is exempted. Changed comments must be reviewed again. Internal symbols such as `T3ConnectClient`, wire identifiers, storage keys, and named third-party themes do not match product phrases and need no exception. Tests inject rejected copy into new source files and ensure the command fails; they also verify that an excepted comment cannot hide a new product string in the same file.

## Audit and retained occurrences

The source audit searched `T3 Code`, `T3 Connect`, standalone `T3`, `t3code`, `t3.codes`, and upstream repository links across the scoped applications, shared packages, and native helpers. It covered the Connections row/search catalog, boot failure text, client labels, desktop activation errors, capture setup and permissions, browser import, integration examples, diagnostics, terminal previews, mobile sign-in, work-log labels, server environment/error text, and native capture helpers.

Retained categories and concrete occurrences:

| Occurrence                                                                                                                                          | Reason                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `T3 Chat` in `packages/shared/src/themePalettes.ts`, theme IDs and corresponding web styling                                                        | Named third-party theme attribution.                                                                                           |
| `t3.json`, `T3 project file`, `https://t3.codes/schema/t3.json` and schema documentation in `packages/contracts/src/t3ProjectFile.ts`               | The project-file schema and its documented identity are explicitly out of scope.                                               |
| `t3code:*` local storage, `t3_thread_*` MCP names, `T3NativeControls`, `T3Connect*`, CSS/data attributes, debug keys, protocol/resource identifiers | Private persisted or wire identities, not product display labels. Work-log display labels changed without changing tool names. |
| `T3Mark` widget asset reference and native module filenames                                                                                         | Internal asset/module references. Artwork changes, including Android artwork, are outside this copy task.                      |
| `T3 Tools` authors in mobile podspecs and signing configuration                                                                                     | Upstream author attribution and signing identity.                                                                              |
| Model-manifest URL in `apps/server/src/provider/ModelManifest.ts`                                                                                   | Upstream data service explicitly excluded from this task.                                                                      |
| Clerk relying parties, OAuth referrer, mobile store links, and `apps/mobile/src/features/settings/lib/legal-document-url.ts`                        | External authentication, store, and legal destinations explicitly excluded; changing their names could change behavior.        |
| `t3code@users.noreply.github.com` in `apps/server/src/vcs/GitVcsDriver.ts`                                                                          | Private checkpoint commit metadata. Author/committer display names already say Kata Code.                                      |
| Runtime/temporary file prefixes                                                                                                                     | Internal directory identifiers.                                                                                                |
| `DESKTOP_LINUX_EXECUTABLE_NAME` and `PROTOCOL_SCHEME_LEGACY` in shared branding                                                                     | Existing executable/protocol identities, not display copy.                                                                     |
| Upstream issue links and historical comments, including the exact comments in `branding-exceptions.json`                                            | Implementation context and attribution, not rendered text.                                                                     |
| Test fixtures, development scripts and logs, build output, dependency metadata                                                                      | Outside shipped product copy. Existing external app/window names in fixtures can still contain upstream names.                 |

## Rendered verification

`apps/web/src/components/settings/settingsBranding.test.tsx` renders the real SettingsRow with the search catalog entry and checks its heading, then checks lookup by the displayed product name in desktop mode. Existing release-link tests cover stable, nightly, and history destinations.

For the real Electron UI check, run `scripts/verify-branding-ui.sh` against a caller-owned Electron CDP session. Start an isolated, onboarded app with public cloud configuration enabled, open Settings, and leave the search field empty. The script checks the Connections heading, enters the settings search query, checks the rendered result, and records screenshots. It does not provision accounts or alter connection settings. See the script's arguments for the CDP port and evidence directory.
