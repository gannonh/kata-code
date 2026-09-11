---
name: 1password
description: Loads Kata Code source-build secrets from a 1Password Environment via CLI and a service account. Use when the user or task mentions 1Password, op, OP_SERVICE_ACCOUNT_TOKEN, environment variables, secrets, dotenv, .env, remote or Sprite development servers, or starting vp run dev / Connect. Do not create, read, or upload dotenv files.
---

# 1Password Environments

Source builds load secrets from 1Password Environment `tlgyne6mxr5iejiwvshbxsnxde`. There are no dotenv files. `scripts/lib/public-config.ts` `loadRepoEnv` is the only source-build env boundary.

Canonical runbook: [docs/operations/environment-variables.md](../../../docs/operations/environment-variables.md). CLI details: [references/cli.md](references/cli.md).

## Hard rules

- Do not create, read, symlink, or upload `.env`, `.env.local`, or `infra/relay/.env`.
- Do not copy `.env.example` or `infra/relay/.env.example` to `.env`. Those files are name templates.
- Do not wrap `vp` (or any repo command) in `op run` or `op run --environment`.
- Do not mount a 1Password local / FIFO `.env`. Desktop approval is the rejected path.
- Do not write `op://vault/item/field` references into files. That is a different 1Password feature (vault items). This repo uses Environments.
- Do not print, log, commit, or paste secret values, token strings, or `op environment read` stdout.
- GitHub Actions production secrets stay in GitHub. Do not move them into the Environment unless a spec says so.
- `katacode connect sprite setup --env` is for the **installed** CLI service (`~/.katacode/service-env.json`). It is not how you develop this repository.

If asked to "just make a .env" or copy dotenv onto a server, follow this skill instead.

## Setup (every machine)

1. Install 1Password CLI **beta** `2.33.0-beta.02` or later (`brew install --cask 1password-cli@beta`). Stable `op` has no `op environment`.
2. Export `OP_SERVICE_ACCOUNT_TOKEN` for a service account that can read Environment `tlgyne6mxr5iejiwvshbxsnxde`. Same export in systemd, Sprite service env, or the login profile. The token is the only secret that lives on the machine.
3. Confirm `op whoami` is a service account. Desktop-app integration is not a substitute.
4. Delete leftover `.env` / `.env.local` / `infra/relay/.env` if they exist. Do not upload them.
5. From the repository root: `vp i` then `vp run dev`.

`OP_ENVIRONMENT_ID` overrides the Environment id. Process env overrides 1Password for the same key. Keys that are not in the Environment belong in the process environment (shell export / unit / Sprite service env), never in a dotenv file.

## How load works

When `OP_SERVICE_ACCOUNT_TOKEN` is set, `loadRepoEnv` runs `op environment read <id>` and parses stdout. Vite, server, desktop, mobile, desktop artifact build, and local relay deploy all go through that function.

- Missing token: skip `op`, Connect stays disabled (CI, tests, unconfigured clones).
- Token set and `op` fails: hard error (`OnePasswordEnvironmentReadError`). Fix CLI, token, or Environment access. Do not fall back to files.

## Adding or changing a secret

1. Put the key in the 1Password Environment (default id above).
2. Name it in `.env.example` only if it is a source-build name the repo should document.
3. Do not write the value into the checkout.

After a relay deploy, the command prints a public relay URL. Put that URL in the Environment as `KATACODE_RELAY_URL` when that stage should be the source-build default. Do not write it to a root `.env`.

`--env-file` on relay deploy is an explicit override only. Do not use it for local or remote development.

## Diagnose without leaking values

```sh
op --version
op environment --help
op whoami
test -n "${OP_SERVICE_ACCOUNT_TOKEN:-}"
```

`op --version` must be beta. `op whoami` must be a service account. To list **names only**:

```sh
op environment read "${OP_ENVIRONMENT_ID:-tlgyne6mxr5iejiwvshbxsnxde}" | awk -F= 'NF{print $1}'
```

Never paste that command's unfiltered stdout into chat. If `loadRepoEnv` throws, report the error class and the first stderr line `op` already sanitized, not the Environment payload.

## Remote servers

Same as local: beta CLI, `OP_SERVICE_ACCOUNT_TOKEN`, clone, `vp i`, `vp run dev`. Do not copy a dotenv file onto the server.
