# 1Password CLI for Kata Code

## Install

```sh
brew uninstall --cask 1password-cli
brew install --cask 1password-cli@beta
op --version
```

Need `op environment`. If that subcommand is missing, the binary is stable or too old. Minimum: `2.33.0-beta.02`.

The service account token authenticates the CLI. Do not run `op signin` for source-build loads. Desktop app approval is the rejected remote path.

## Auth check

```sh
export OP_SERVICE_ACCOUNT_TOKEN=ops_...   # never echo this
op whoami
```

Expect a service account. Account or user sign-in is the wrong mode for headless `vp`.

## Environments vs vault items

| Feature | Command | This repo |
| --- | --- | --- |
| Environments | `op environment read <id>` | Source-build secrets. `loadRepoEnv` does this. |
| Vault item refs | `op://vault/item/field` plus `op run --env-file` | Do not use. |
| `op run --environment` | injects the Environment then execs a child | Do not wrap `vp`. The Node loader already reads. |
| Destinations / local `.env` mount | FIFO file, desktop approval | Do not use. |

`op environment list` confirms the service account can see Environments. Do not dump `op environment read` into a transcript.

## Persist the token

The token must be in the environment of every process that runs `vp`. Examples: shell profile, systemd `Environment=`, Sprite installed-service env. Do not put it in a repo `.env`.

## Sprite `--env`

`katacode connect sprite setup --env` writes the **published CLI** service file `~/.katacode/service-env.json`. For a source checkout on a Sprite, export `OP_SERVICE_ACCOUNT_TOKEN` and run `vp` as on any other machine.
