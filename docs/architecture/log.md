# Architecture log

## 2026-07-01

- Added a [Provider skills](/architecture/providers.md#provider-skills) section to [provider architecture](/architecture/providers.md): filesystem skill discovery (`apps/server/src/provider/skills/filesystemSkills.ts`) scanning `.cursor/skills`, `.agents/skills`, `.claude/skills`, `.codex/skills` at project + user scope (first-match-wins), the shared `@kata-sh/code-shared/providerSkills` token model (`PROVIDER_SKILL_TOKEN_REGEX`, FNV-1a-32 path hash, `$skillname` and path-qualified `$skill:name:hash` tokens), and server-side `<skill>` block prompt expansion wired into the Cursor adapter. Added a Provider skills row to the code map. Noted the `pi` driver already loads `.agents/skills` via its own SDK path (project-trust gated).

## 2026-06-26

- Added the `pi` driver (in-process `@earendil-works/pi-coding-agent`, early access) to the [provider architecture](/architecture/providers.md) driver table and canonical-event coverage list.

## 2026-06-17

- Rewrote [provider architecture](/architecture/providers.md) for the multi-driver model (Codex, Claude, Cursor, Grok, OpenCode), driver/instance/adapter layering, and canonical `ProviderRuntimeEvent` flow.
- Updated [architecture overview](/architecture/overview.md) stack diagram and turn-flow sequence for provider-agnostic routing (links to providers note).

## 2026-06-16

- Added section index as part of OKF init; existing architecture notes retained in place.
