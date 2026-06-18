---
type: Guide
title: "Relay deploy setup"
description: "One-time GitHub and cloud provider configuration for manual production Kata Code Connect relay deployment."
tags: [operations, relay, infrastructure, cloudflare, setup]
timestamp: 2026-06-18T00:00:00Z
---

# Relay deploy setup

Configure this **once** (or when rotating credentials). Day-to-day relay operations use the manual [Deploy Kata Code Connect relay](../../.github/workflows/deploy-relay.yml) workflow.

Workflow: [`.github/workflows/deploy-relay.yml`](../../.github/workflows/deploy-relay.yml)

## Overview

Production relay deploy is **manual-only** and scoped to the Alchemy `prod` stage. The workflow supports:

- `dry_run=true` — plan infrastructure without applying changes
- `dry_run=false` — apply production infrastructure, then verify public endpoints and Clerk DPoP exchange

Stable and nightly releases read relay URL and client tracing config from deployed Alchemy `prod` state. Clerk public config remains in the GitHub `production` environment.

## 1. Cloudflare

### Account and API token

1. Create or choose a fork-owned Cloudflare account (do not reuse upstream deploy targets).
2. Copy the **Account ID** from the Cloudflare dashboard overview page.
3. Create an API token with permissions sufficient for Alchemy to manage Workers, Queues, DNS records, Hyperdrive, and state storage in that account. Start from the **Edit Cloudflare Workers** template and include account-level access for Workers scripts/subdomain and Secrets Store plus zone-level `Zone:Read` and `DNS:Edit` for `kata.sh`. Validate with `node infra/relay/scripts/run-credential-smoke.ts` before deploying.
4. Store:
   - Repository variable `CLOUDFLARE_ACCOUNT_ID`
   - `production` environment secret `CLOUDFLARE_API_TOKEN`

Release preflight reads Alchemy `prod` state with the same Cloudflare credentials; PlanetScale, Axiom, Clerk, and APNs credentials are **not** required for state reads.

### DNS zones

The relay stack expects two zones in the same Cloudflare account:

| Variable                 | Purpose                              | Example                                   |
| ------------------------ | ------------------------------------ | ----------------------------------------- |
| `RELAY_API_ZONE_NAME`    | Public relay API hostname            | `connect.kata.sh` or a dedicated API zone |
| `RELAY_TUNNEL_ZONE_NAME` | Managed environment tunnel hostnames | `tunnels.kata.sh`                         |

Production hostnames:

- Relay API: `relay.<RELAY_API_ZONE_NAME>` unless `RELAY_DOMAIN` overrides it
- Managed tunnels: `prod-<digest>.<RELAY_TUNNEL_ZONE_NAME>`

Steps:

1. Register or transfer the domains you will use for Kata Code Connect.
2. Add each zone to Cloudflare and complete DNS delegation.
3. Set `RELAY_API_ZONE_NAME` and `RELAY_TUNNEL_ZONE_NAME` on the GitHub `production` environment.

You may use one zone for both variables if product DNS allows tunnel hostnames under the same zone.

## 2. PlanetScale

1. Create a fork-owned PlanetScale organization.
2. Create a service token with permission to manage databases/branches used by relay deploy.
3. Store:
   - Repository variable `PLANETSCALE_ORGANIZATION`
   - `production` environment secrets `PLANETSCALE_API_TOKEN_ID` and `PLANETSCALE_API_TOKEN`

The `prod` stage owns the retained production database. Deploy `prod` before creating personal developer stages.

## 3. Axiom

1. Create a fork-owned Axiom organization for relay traces.
2. Create a personal access token with ingest permissions for trace datasets provisioned by the relay stack.
3. Store:
   - Repository variable `AXIOM_ORG_ID`
   - `production` environment secret `AXIOM_TOKEN`

## 4. Clerk

Follow [Kata Code Connect Clerk Setup](../cloud/t3-connect-clerk.md) for the production Clerk application, JWT template, CLI OAuth app, and waitlist/allowlist policy.

Store on the GitHub `production` environment:

| Name                        | Type     | Purpose                                             |
| --------------------------- | -------- | --------------------------------------------------- |
| `CLERK_PUBLISHABLE_KEY`     | variable | Client-facing Clerk key                             |
| `CLERK_JWT_TEMPLATE`        | variable | Relay JWT template name (`kata-relay`)              |
| `CLERK_JWT_AUDIENCE`        | variable | Relay runtime audience (`kata-code-relay`)          |
| `CLERK_CLI_OAUTH_CLIENT_ID` | variable | Headless CLI OAuth public client ID                 |
| `CLERK_SECRET_KEY`          | secret   | Relay runtime + CI smoke token minting              |
| `CLERK_SMOKE_USER_ID`       | variable | Dedicated approved Clerk user for deploy DPoP smoke |

### Clerk DPoP deploy smoke (recommended pattern)

The deploy workflow mints a **fresh** Clerk JWT on every apply run:

1. Create a dedicated approved beta user in Clerk for CI smoke only.
2. Copy the user ID (`user_...`) to `CLERK_SMOKE_USER_ID`.
3. During apply, the workflow uses `CLERK_SECRET_KEY` to create a short-lived session for that user and mint a JWT from `CLERK_JWT_TEMPLATE`.
4. The workflow exchanges that JWT at `/v1/client/dpop-token` and revokes the session afterward.

No long-lived bearer token is stored in GitHub beyond `CLERK_SECRET_KEY`, which the relay runtime already requires.

## 5. Apple Push Notification service (APNs)

APNs is required for production relay deploy.

Store on the GitHub `production` environment:

| Name               | Type                                 |
| ------------------ | ------------------------------------ |
| `APNS_ENVIRONMENT` | variable (`sandbox` or `production`) |
| `APNS_TEAM_ID`     | variable                             |
| `APNS_KEY_ID`      | variable                             |
| `APNS_BUNDLE_ID`   | variable                             |
| `APNS_PRIVATE_KEY` | secret                               |

## GitHub environment summary

### Repository variables

- `CLOUDFLARE_ACCOUNT_ID`
- `PLANETSCALE_ORGANIZATION`
- `AXIOM_ORG_ID`

### `production` environment variables

- `RELAY_API_ZONE_NAME`
- `RELAY_TUNNEL_ZONE_NAME`
- `RELAY_DOMAIN` (optional override)
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_JWT_AUDIENCE`
- `CLERK_JWT_TEMPLATE`
- `CLERK_CLI_OAUTH_CLIENT_ID`
- `CLERK_SMOKE_USER_ID`
- `APNS_ENVIRONMENT`
- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_BUNDLE_ID`

### `production` environment secrets

- `CLOUDFLARE_API_TOKEN`
- `PLANETSCALE_API_TOKEN_ID`
- `PLANETSCALE_API_TOKEN`
- `AXIOM_TOKEN`
- `CLERK_SECRET_KEY`
- `APNS_PRIVATE_KEY`

Verify names (not values):

```bash
gh variable list -R gannonh/kata-code
gh secret list -R gannonh/kata-code --env production
```

## Operator flow

1. Configure all variables and secrets above.
2. Dispatch `deploy-relay.yml` with `dry_run=true` and confirm the plan succeeds.
3. Dispatch `deploy-relay.yml` with `dry_run=false` and confirm health, OAuth metadata, and DPoP smoke pass.
4. Dispatch `release.yml` dry-run for stable or nightly and confirm Connect config resolves from Alchemy state.
5. Complete manual UAT for Connect UI, CLI login, link, connect, and unlink using [Relay Deploy UAT](../guides/relay-deploy-uat.md).

## Troubleshooting

| Symptom                                     | Fix                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Validate step lists missing Cloudflare vars | Set repository `CLOUDFLARE_ACCOUNT_ID` and `production` `CLOUDFLARE_API_TOKEN`                                                      |
| Dry-run fails on DNS zone adoption          | Confirm zones exist in the Cloudflare account and names match `RELAY_*_ZONE_NAME`                                                   |
| DPoP smoke fails with auth errors           | Confirm `CLERK_SMOKE_USER_ID` is approved, JWT template audience matches `CLERK_JWT_AUDIENCE`, relay has current `CLERK_SECRET_KEY` |
| Release fails on missing Connect config     | Deploy relay `prod` first; confirm Alchemy state read succeeds and Clerk vars exist on `production`                                 |
| Tracing token appears in logs               | Workflow masks `KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN`; report leaks if seen                                                      |

## Related

- [Relay README](../../infra/relay/README.md)
- [Relay Deploy spec](../specs/2026-06-18-relay-deploy-design.md)
- [Release setup](./release-setup.md)
- [Release runbook](./release.md)
- [Relay deploy UAT](../guides/relay-deploy-uat.md)
