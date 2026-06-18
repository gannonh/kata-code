---
type: Guide
title: "Relay credentials playbook"
description: "Step-by-step credential collection, local .env placement, GitHub sync, smoke validation, and UAT sequencing for Kata Code Connect relay deploy."
tags: [relay, connect, credentials, setup, uat]
timestamp: 2026-06-18T00:00:00Z
---

# Relay credentials playbook

Use this as the single operator sequence. Do not split credentials across mystery locations.

## Files (only two matter)

| File                   | Purpose                                               | When                                                 |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| **`infra/relay/.env`** | Master credential file for relay deploy + GitHub sync | Fill first                                           |
| **Repo root `.env`**   | Client dev (`KATACODE_*`)                             | Generated from relay env; updated again after deploy |

Everything for relay infrastructure lives in **`infra/relay/.env`**. GitHub Actions reads the same values after sync.

```bash
cp infra/relay/.env.example infra/relay/.env
```

---

## Phase 1 — Collect every value into `infra/relay/.env`

### Cloudflare

| Variable                 | How to get it                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`  | [Cloudflare dashboard](https://dash.cloudflare.com) → any zone → right sidebar **Account ID**. Confirm it matches `GET /accounts` for the API token (a typo still verifies the token but fails Workers with `403`). |
| `CLOUDFLARE_API_TOKEN`   | **My Profile → API Tokens → Create Token** → start from **Edit Cloudflare Workers** template → create → copy token once                                                                                             |
| `RELAY_API_ZONE_NAME`    | Register/transfer domain → **Websites → Add site** → use apex zone name (e.g. `connect.kata.sh`)                                                                                                                    |
| `RELAY_TUNNEL_ZONE_NAME` | Same account → add second zone for tunnels (e.g. `tunnels.kata.sh`) or reuse API zone if DNS layout allows                                                                                                          |

Optional: `RELAY_DOMAIN` only if production relay URL must not be `relay.<RELAY_API_ZONE_NAME>`.

### PlanetScale

| Variable                   | How to get it                                                                     |
| -------------------------- | --------------------------------------------------------------------------------- |
| `PLANETSCALE_ORGANIZATION` | [PlanetScale](https://app.planetscale.com) → org **Settings** → organization name |
| `PLANETSCALE_API_TOKEN_ID` | **Settings → Service tokens → New service token** → copy token ID                 |
| `PLANETSCALE_API_TOKEN`    | Same dialog → copy token secret                                                   |

### Axiom

| Variable       | How to get it                                                                 |
| -------------- | ----------------------------------------------------------------------------- |
| `AXIOM_ORG_ID` | [Axiom](https://app.axiom.co) → **Settings → Organization** → Organization ID |
| `AXIOM_TOKEN`  | **Settings → API tokens → New token** → ingest access                         |

### Clerk

Follow [Kata Code Connect Clerk Setup](../cloud/t3-connect-clerk.md).

| Variable                    | How to get it                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `CLERK_PUBLISHABLE_KEY`     | Clerk Dashboard → **API keys** → Publishable key                                         |
| `CLERK_SECRET_KEY`          | Clerk Dashboard → **API keys** → Secret key                                              |
| `CLERK_JWT_TEMPLATE`        | **JWT templates → New** → Name `kata-relay`, claims `{"aud":"kata-code-relay"}`          |
| `CLERK_JWT_AUDIENCE`        | Fixed: `kata-code-relay`                                                                 |
| `CLERK_CLI_OAUTH_CLIENT_ID` | **OAuth applications → New** → Public client, redirect `http://127.0.0.1:34338/callback` |
| `CLERK_SMOKE_USER_ID`       | Create/approve a dedicated beta user → **Users** → copy `user_...` id                    |

Also configure waitlist/allowlist per Clerk setup guide before UAT.

### Apple Push Notification service

| Variable           | How to get it                                                                 |
| ------------------ | ----------------------------------------------------------------------------- |
| `APNS_ENVIRONMENT` | `sandbox` until production relay; then `production`                           |
| `APNS_TEAM_ID`     | [Apple Developer](https://developer.apple.com/account) → Membership → Team ID |
| `APNS_KEY_ID`      | **Certificates, Identifiers & Profiles → Keys** → create APNs key → Key ID    |
| `APNS_BUNDLE_ID`   | Mobile app bundle id (e.g. `com.katacode.app`)                                |
| `APNS_PRIVATE_KEY` | Download `.p8` from key creation → paste PEM into `.env`                      |

---

## Phase 2 — Validate locally, then push to GitHub

### 2a. Credential smoke (live API checks)

```bash
cd /path/to/kata-code
node infra/relay/scripts/run-credential-smoke.ts
```

Checks: Cloudflare token + account, PlanetScale org, Axiom org, Clerk smoke user, APNs PEM shape.

### 2b. Config completeness (same names CI uses)

```bash
set -a && source infra/relay/.env && set +a
node infra/relay/scripts/validate-deploy-config.ts --include-smoke
```

### 2c. Sync to GitHub

Dry run:

```bash
node infra/relay/scripts/sync-github-config.ts --dry-run
```

Apply (requires `gh auth login`):

```bash
GITHUB_REPOSITORY=gannonh/kata-code node infra/relay/scripts/sync-github-config.ts
```

Mapping:

| `infra/relay/.env` key                                                                         | GitHub destination                 |
| ---------------------------------------------------------------------------------------------- | ---------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`, `PLANETSCALE_ORGANIZATION`, `AXIOM_ORG_ID`                            | Repository variables               |
| All other non-secret keys                                                                      | `production` environment variables |
| `CLOUDFLARE_API_TOKEN`, `PLANETSCALE_*`, `AXIOM_TOKEN`, `CLERK_SECRET_KEY`, `APNS_PRIVATE_KEY` | `production` environment secrets   |

Verify:

```bash
gh variable list -R gannonh/kata-code
gh secret list -R gannonh/kata-code --env production
```

### 2d. Client dev env (optional before first deploy)

```bash
node scripts/sync-client-env-from-relay.ts
```

Writes `KATACODE_CLERK_*` and derived `KATACODE_RELAY_URL` into repo root `.env`.

---

## Phase 2.5 — One-time Alchemy Cloudflare bootstrap

Required before the first relay deploy on a new Cloudflare account. Creates Alchemy's `alchemy-state-store` worker and local profile credentials.

```bash
CLOUDFLARE_ACCOUNT_ID="$(node -e "const {parseEnv}=require('node:util');const {readFileSync}=require('node:fs');console.log(parseEnv(readFileSync('infra/relay/.env','utf8')).CLOUDFLARE_ACCOUNT_ID)")" \
CLOUDFLARE_API_TOKEN="$(node -e "const {parseEnv}=require('node:util');const {readFileSync}=require('node:fs');console.log(parseEnv(readFileSync('infra/relay/.env','utf8')).CLOUDFLARE_API_TOKEN)")" \
pnpm --dir infra/relay exec alchemy cloudflare bootstrap --profile default
```

Notes:

- Do **not** pass `--env-file .env` for bootstrap; export Cloudflare vars instead.
- Do **not** set `CI=true` during bootstrap.
- If deploy reports `Cloudflare State store not found`, rerun bootstrap before retrying deploy.

---

## Phase 3 — Deploy smoke (after bootstrap + GitHub sync)

1. **Local dry-run:** `vp run --filter @kata-sh/code-relay deploy -- --stage prod --dry-run --yes`
2. **Merge relay deploy PR** so `.github/workflows/deploy-relay.yml` is on `main`.
3. **Relay dry-run:** GitHub Actions → **Deploy Kata Code Connect relay** → `dry_run=true`
4. **Relay apply:** same workflow → `dry_run=false` (runs public endpoint + Clerk DPoP smoke)
5. **Release dry-run:** **Release** workflow → stable or nightly dry-run (reads Alchemy `prod` state)

Local dry-run command:

```bash
vp run --filter @kata-sh/code-relay deploy -- --stage prod --dry-run --yes
```

---

## Phase 4 — Manual UAT (step by step)

Use [Relay Deploy UAT](../guides/relay-deploy-uat.md). Sequence:

1. Build or install a production-configured client (release dry-run artifact or local build after `sync-client-env-from-relay` + deploy).
2. Open app → confirm Connect UI visible (no missing-config error).
3. Signed out → waitlist/sign-in path works for approved vs unapproved users.
4. Sign in as approved beta user → open **Connections**.
5. `katacode serve` locally → note environment label.
6. `katacode connect login` → complete Clerk OAuth.
7. `katacode connect link` → confirm relay link created.
8. App lists linked environment.
9. Connect through relay → confirm authenticated/connected state.
10. `katacode connect unlink` → confirm cleanup.

Capture workflow URLs, CLI output, and screenshots for each step.

---

## Phase 5 — CI coverage checklist

| Check                     | Where                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| Deploy config validation  | `deploy-relay.yml` validate step                                             |
| Credential/provider smoke | `run-credential-smoke.ts` (local + optional CI job later)                    |
| Public relay endpoints    | `run-post-deploy-smoke.ts` on apply                                          |
| Clerk DPoP exchange       | `clerk-dpop-smoke.ts` on apply                                               |
| Release Connect config    | `release.yml` `resolve_public_config`                                        |
| Unit tests                | `infra/relay/scripts/*.test.ts`, `scripts/lib/connect-public-config.test.ts` |

---

## Quick reference

```bash
# 1. Fill master file
cp infra/relay/.env.example infra/relay/.env

# 2. Validate
node infra/relay/scripts/run-credential-smoke.ts
set -a && source infra/relay/.env && set +a && node infra/relay/scripts/validate-deploy-config.ts --include-smoke

# 3. Push to GitHub
GITHUB_REPOSITORY=gannonh/kata-code node infra/relay/scripts/sync-github-config.ts

# 3b. Bootstrap Alchemy state store (once)
CLOUDFLARE_ACCOUNT_ID="$(node -e "const {parseEnv}=require('node:util');const {readFileSync}=require('node:fs');console.log(parseEnv(readFileSync('infra/relay/.env','utf8')).CLOUDFLARE_ACCOUNT_ID)")" \
CLOUDFLARE_API_TOKEN="$(node -e "const {parseEnv}=require('node:util');const {readFileSync}=require('node:fs');console.log(parseEnv(readFileSync('infra/relay/.env','utf8')).CLOUDFLARE_API_TOKEN)")" \
pnpm --dir infra/relay exec alchemy cloudflare bootstrap --profile default

# 4. Local deploy dry-run
vp run --filter @kata-sh/code-relay deploy -- --stage prod --dry-run --yes

# 5. Client dev env
node scripts/sync-client-env-from-relay.ts
```
