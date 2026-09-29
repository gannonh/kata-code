# Environment variables

Source builds load secrets from a 1Password Environment through 1Password CLI. There are no
dotenv files on disk. Do not create `.env`, `.env.local`, or `infra/relay/.env`. Do not upload those
files to development servers.

`.env.example` and `infra/relay/.env.example` are committed name templates only. Never copy them to
`.env`.

## One-time setup

1. Install 1Password CLI **beta** `2.33.0-beta.02` or later. Current beta is `2.39.1-beta.01`.

   ```sh
   brew uninstall --cask 1password-cli
   brew install --cask 1password-cli@beta
   op --version
   ```

   Stable `op` does not have `op environment`.

2. Create a service account with read access to Environment `tlgyne6mxr5iejiwvshbxsnxde`.
3. Export the token in every shell and on every development server that runs this repo:

   ```sh
   export OP_SERVICE_ACCOUNT_TOKEN=ops_...
   op whoami
   ```

   The whoami output must be a service account. Put the same export in the server's systemd unit,
   Sprite service env, or login profile. The token is the only secret that lives on the machine.

4. Optional: `export OP_ENVIRONMENT_ID=<id>` to use a different Environment. The default is
   `tlgyne6mxr5iejiwvshbxsnxde`.

## Run

From the repository root, after `vp i`:

```sh
vp run dev
```

`scripts/lib/public-config.ts` `loadRepoEnv` runs `op environment read` when
`OP_SERVICE_ACCOUNT_TOKEN` is set. Vite, the server, desktop, mobile, the desktop artifact build,
and local relay deploy all go through that function. You do not wrap `vp` in `op run`. You do not
mount a 1Password local `.env` file.

A clone without the token starts with Connect disabled, same as an unconfigured checkout. A set
token and a failed `op environment read` fail the process. Install the beta CLI, confirm the token,
and confirm the service account can read the Environment.

Process environment variables override 1Password for the same key.

## Clerk instance and relay

Source builds, released builds, and the production relay all sign in against the Clerk production
instance for `kata.sh` (Frontend API `clerk.kata.sh`). `KATACODE_CLERK_PUBLISHABLE_KEY` is a
`pk_live_` key for it. `KATACODE_RELAY_URL` points at the production relay, `https://relay.kata.sh`.

The relay authenticates with `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from the GitHub
`production` environment (see `.github/workflows/deploy-relay.yml`), which are the same instance as
the 1Password Environment. The `production` variable `CLERK_CLI_OAUTH_CLIENT_ID` matches the
source-build CLI client. Change the publishable key, the `CLERK_SECRET_KEY` secret, and the CLI
client ID together, in GitHub and in the 1Password Environment. A publishable key and secret key
from different instances make the relay reject every token. See
[Production Clerk instance](./connect-setup.md#production-clerk-instance) for setup.

The earlier development instance (`upward-terrier-81.clerk.accounts.dev`) is no longer used by any
released or source build.

## Link a source worktree

A linked worktree uses its own `.katacode` data directory. Run the source Connect launcher from
that worktree so authorization and relay state use the same directory as `vp run dev`:

```sh
vp run connect link --headless
```

Open the printed URL in a browser signed in to Kata Code, check that the page shows the one-time code
the terminal printed, and approve. Restart the worktree's development server after the command succeeds. Server startup
creates the local link proof, provisions the managed endpoint, and stores the relay configuration.

Inspect or remove the worktree link with the same launcher:

```sh
vp run connect status --json
vp run connect unlink
```

The launcher accepts only managed-link setup, status, unlink, and logout commands. It pins the data
directory to the current linked worktree and rejects `--base-dir` and publish-only setup.

## Remote development servers

Install the same beta CLI, export `OP_SERVICE_ACCOUNT_TOKEN`, clone the repo, `vp i`, then
`vp run dev`. Do not copy a dotenv file onto the server.

## Relay deploy

```sh
vp run --filter kata-code-relay deploy -- --stage prod
vp run --filter kata-code-relay deploy
```

Alchemy reads process env after `loadRepoEnv`. After a successful deploy, the command prints the
relay URL. Put that URL in the 1Password Environment as `KATACODE_RELAY_URL` when the stage should
be the source-build default. GitHub Actions production secrets stay in GitHub.

`--env-file` remains only as an explicit override. Do not use it for local or remote development.

## Sprite `--env`

`katacode connect sprite setup --env` injects variables into the **installed** Kata Code CLI service
on a Sprite (`~/.katacode/service-env.json`). That product flag is not how you develop this
repository. For a source checkout on a Sprite, export `OP_SERVICE_ACCOUNT_TOKEN` and run `vp` as
above.
