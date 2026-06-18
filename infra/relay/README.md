# Kata Code Connect Relay

> [!WARNING]
> Kata Code Connect is currently in private beta. Join the waitlist in the app under Settings > Kata Code Connect.

The relay is the hosted control plane for Kata Code Connect. It helps clients discover and connect to
remote environments, manages the cloud-side records needed for those connections, and delivers
optional mobile notifications and Live Activities.

The relay is intentionally not in the hot path for normal Kata Code traffic. After a client connects,
regular API and WebSocket traffic goes directly between that client and the selected environment.
See the [Kata Code Connect architecture overview](../../docs/cloud/t3-code-connect-auth-flow.html) for the larger system
design.

## Responsibilities

The relay currently owns:

- Linking Kata Code environments to a cloud account.
- Provisioning and tracking managed environment endpoints.
- Issuing short-lived credentials used to connect clients to linked environments.
- Listing linked environments and registered mobile devices for an account.
- Registering mobile notification preferences and APNs tokens.
- Receiving published agent activity and delivering notifications or Live Activity updates.
- Persisting relay state and exposing relay-specific traces for diagnostics.

The environment server and relay have separate credentials and trust boundaries. Read
[Environment Authentication Profile](../../docs/cloud/environment-auth.md) before changing token,
credential, or authorization behavior.

## Code Map

- [`alchemy.run.ts`](./alchemy.run.ts) defines the deployed Alchemy stack.
- [`src/worker.ts`](./src/worker.ts) wires Cloudflare bindings, runtime layers, queues, and HTTP APIs.
- [`src/http/Api.ts`](./src/http/Api.ts) contains the relay HTTP handlers and authentication
  boundaries.
- [`src/environments`](./src/environments) contains environment linking, credentials, endpoint
  provisioning, and connection flows.
- [`src/agentActivity`](./src/agentActivity) contains mobile device registration, activity state,
  APNs delivery, and queue processing.
- [`src/auth`](./src/auth) contains relay token and DPoP proof handling.
- [`src/persistence/schema.ts`](./src/persistence/schema.ts) defines persisted relay state. Keep
  schema and migration changes together.

Shared request and response schemas live in
[`packages/contracts/src/relay.ts`](../../packages/contracts/src/relay.ts). Shared client-side relay
calls live in
[`packages/client-runtime/src/managedRelay.ts`](../../packages/client-runtime/src/managedRelay.ts).

## Working Locally

Install dependencies from the repository root, then run relay-focused checks from this directory:

```sh
vp install
cd infra/relay
vp test run
vp run typecheck
```

To run a smaller test set while iterating:

```sh
vp test run src/environments/EnvironmentLinker.test.ts
```

Before considering a change complete, run the repository-wide checks from the root:

```sh
vp check
vp run typecheck
```

Backend changes should include tests. Prefer testing the real business logic with external
dependencies represented at their boundary rather than mocking internal behavior.

## Deployment

The relay deploys through Alchemy:

```sh
vp run --filter @kata-sh/code-relay deploy
```

The stack provisions the Cloudflare Worker and queues, managed endpoint resources, database
connectivity, and relay tracing resources. Copy [`infra/relay/.env.example`](./.env.example) to
`infra/relay/.env` and fill in the deployment-specific values before deploying. Alchemy loads that
file from the relay directory and merges it with process environment variables (so `CI=true` and
other shell exports still apply). Scripted deploys pass `--yes` (and usually `--dry-run` first),
which forces non-interactive provider auth. Runtime secrets include Clerk and APNs credentials.
Production adopts
the configured API and tunnel DNS zones as retained Cloudflare resources. Personal stages reference
the production-owned zones.

The `prod` Alchemy stage owns the retained PlanetScale database and is the shared hosted relay for
stable and nightly clients. Every other stage references that database and provisions an isolated
PlanetScale branch and runtime role for local development, so deploy `prod` before creating
developer stages:

```sh
vp run --filter @kata-sh/code-relay deploy -- --stage prod
vp run --filter @kata-sh/code-relay deploy -- --env-file .env.local
```

### First deploy on a new Cloudflare account

Bootstrap Alchemy's Cloudflare state store once before the first `prod` deploy:

```sh
CLOUDFLARE_ACCOUNT_ID="$(node -e "const {parseEnv}=require('node:util');const {readFileSync}=require('node:fs');console.log(parseEnv(readFileSync('infra/relay/.env','utf8')).CLOUDFLARE_ACCOUNT_ID)")" \
CLOUDFLARE_API_TOKEN="$(node -e "const {parseEnv}=require('node:util');const {readFileSync}=require('node:fs');console.log(parseEnv(readFileSync('infra/relay/.env','utf8')).CLOUDFLARE_API_TOKEN)")" \
pnpm --dir infra/relay exec alchemy cloudflare bootstrap --profile default
```

Export Cloudflare credentials into the shell for bootstrap; do not rely on `--env-file .env` for that command. See [Relay deploy setup](../../docs/operations/relay-deploy-setup.md) for the full operator checklist.

Alchemy defaults personal deployments to the `dev_$USER` stage. Relay custom domains apply the same
DNS-safe sanitization as Alchemy physical resource names, so `prod` uses
`relay.<RELAY_API_ZONE_NAME>` and `dev_julius` uses
`relay-dev-julius.<RELAY_API_ZONE_NAME>`. Managed environment endpoints are provisioned below
`RELAY_TUNNEL_ZONE_NAME`, which may be a different Cloudflare zone. Production tunnel hostnames use
`prod-<digest>.<RELAY_TUNNEL_ZONE_NAME>`; personal stages use
`<stage>-<digest>.<RELAY_TUNNEL_ZONE_NAME>`. `RELAY_DOMAIN` remains available as an explicit API
domain override.

After a successful deploy, the wrapper updates the repository-root `.env` file with the derived relay
URL. That makes subsequent source builds point at the relay that was just deployed without copying
the URL manually.

### Deployment CI

Production relay deploy is manual-only through `.github/workflows/deploy-relay.yml`. Dispatch it with `dry_run=true` before the first apply, then run apply mode after GitHub `production` environment credentials are configured.

The workflow deploys only the shared Alchemy `prod` stage. Stable and nightly release builds resolve relay URL and client tracing config from deployed Alchemy state plus Clerk public config from the GitHub `production` environment. Pull requests do not deploy relay stages. Developers deploy personal non-production stages locally with any stage name other than `prod`.

See [Relay deploy setup](../../docs/operations/relay-deploy-setup.md) for the full credential checklist and operator flow.

See:

- [Kata Code Connect Clerk Setup](../../docs/cloud/t3-connect-clerk.md) for Clerk keys, JWT templates, and waitlist
  setup.
- [Relay Observability](../../docs/relay-observability.md) for deployment tracing and diagnostics.
- [Kata Code Connect Architecture Overview](../../docs/cloud/t3-code-connect-auth-flow.html) for the full link,
  connect, endpoint, and notification flows.
