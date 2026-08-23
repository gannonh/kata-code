# Clerk CLI - Recipes

Copy-pasteable patterns for common tasks. Treat these as starting points; confirm exact paths and parameters with `clerk api ls <keyword>` and `clerk <command> --help`, since the Clerk API evolves.

Mutation snippets below are preview-only by default. Run the `--dry-run` command, inspect its target and payload, then stop for explicit user approval. After approval, rerun that same command without `--dry-run`. Agent mode skips interactive confirmation, so the preview is not approval.

Replace `app_abc123` and `ins_abc123` with the intended app and instance. Raw API mutations below carry both targets explicitly. Clerk CLI 3.1.0 does not expose `--app` or `--instance` on `users create`; verify the linked or secret-key target before using that curated command, or use its explicitly targeted raw API equivalent.

## Discovery first

```sh
clerk api ls                  # everything Backend API exposes
clerk api ls users            # filter by keyword
clerk api ls --platform       # Platform API (account-level)
```

The bundled catalog is cached locally for 1 hour. There is no force-refresh flag - once the TTL expires the next `clerk api ls` re-fetches automatically; on fetch failure the CLI falls back to the stale cache and prints a warning.

## Users

```sh
# List users (preferred; curated flags). --limit defaults to 100 (max 250).
# JSON output is `{ data: [...], hasMore }` so callers can paginate without /users/count.
clerk users list
clerk users list --limit 50 --offset 0 --order-by -created_at

# Count users (no curated subcommand; use the raw API)
clerk api /users/count

# Fetch a user (no curated subcommand; use the raw API)
clerk api /users/user_abc123

# Search by email
clerk users list --email-address alice@example.com

# Open a user's profile in the dashboard
clerk users open user_abc123
clerk users open user_abc123 --print     # print the URL instead of opening

# Create a user (preferred; curated command)
# Keep the password in a temporary file instead of shell history or process arguments.
# This curated command uses the linked or secret-key target; use the raw command below for explicit targets.
umask 077
payload="$(mktemp)"
trap 'rm -f "$payload"' EXIT
cat > "$payload" <<'JSON'
{
  "email_address": ["alice@example.com"],
  "password": "REPLACE_WITH_PASSWORD",
  "first_name": "Alice",
  "last_name": "Doe"
}
JSON
# Replace the password placeholder before running the commands.
clerk users create --file "$payload" --dry-run
# After user approval, rerun the same command without --dry-run.

# Equivalent raw BAPI call. Use only when curated flags don't cover a field.
clerk api /users --app app_abc123 --instance ins_abc123 --file "$payload" --dry-run
# After user approval, rerun the same command without --dry-run.

# Update (PATCH merges; preview first)
clerk api /users/user_abc123 --app app_abc123 --instance ins_abc123 -X PATCH -d '{"first_name":"Alicia"}' --dry-run

# Ban / unban (preview each request before approval)
clerk api /users/user_abc123/ban --app app_abc123 --instance ins_abc123 -X POST --dry-run
clerk api /users/user_abc123/unban --app app_abc123 --instance ins_abc123 -X POST --dry-run

# Lock / unlock (preview each request before approval)
clerk api /users/user_abc123/lock --app app_abc123 --instance ins_abc123 -X POST --dry-run
clerk api /users/user_abc123/unlock --app app_abc123 --instance ins_abc123 -X POST --dry-run

# Delete (PREVIEW FIRST; rerun without --dry-run after approval)
clerk api /users/user_abc123 --app app_abc123 --instance ins_abc123 -X DELETE --dry-run
```

### Test users (development only)

For test accounts you need to sign into without real email or SMS delivery, Clerk provides two magic patterns. Test mode is required. It is enabled by default on development instances and can also be enabled on production instances, although Clerk discourages it.

**By email.** Any address with the `+clerk_test` subaddress is recognized as a test email. The domain portion is arbitrary.

```sh
# Create a test user with a test email (dev instance)
# `skip_password_checks` isn't a curated flag, so pass the body via `-d`.
clerk api /users --app app_abc123 --instance ins_abc123 -d '{
  "email_address": ["demo+clerk_test@example.com"],
  "password": "REPLACE_WITH_PASSWORD",
  "skip_password_checks": true
}' --dry-run
# After user approval, rerun the same command without --dry-run.
```

**By phone.** Any US fictional phone number in the `+1 (XXX) 555-0100` through `+1 (XXX) 555-0199` range is recognized as a test phone. Pass the E.164 form.

```sh
# Create a test user with a test phone (dev instance)
clerk api /users --app app_abc123 --instance ins_abc123 -d '{
  "phone_number": ["+12015550100"],
  "password": "REPLACE_WITH_PASSWORD",
  "skip_password_checks": true
}' --dry-run
# After user approval, rerun the same command without --dry-run.
```

When signing in with an email or phone verification code, enter `424242`. Email verification-link flows send a link that is valid for 10 minutes.

These patterns only apply when test mode is enabled. Using real-looking test addresses is highly discouraged. Test addresses and numbers do not count against the dev-instance monthly caps (20 SMS, 100 emails). See [Clerk's test emails and phones reference](https://clerk.com/docs/guides/development/testing/test-emails-and-phones) for the full contract.

## Organizations

```sh
# List
clerk api /organizations
clerk api '/organizations?limit=20&query=acme'

# Fetch
clerk api /organizations/org_abc123

# Create (preview first)
clerk api /organizations --app app_abc123 --instance ins_abc123 -d '{"name":"Acme","created_by":"user_abc123"}' --dry-run

# Update (preview first)
clerk api /organizations/org_abc123 --app app_abc123 --instance ins_abc123 -X PATCH -d '{"name":"Acme Inc."}' --dry-run

# Members
clerk api /organizations/org_abc123/memberships
clerk api /organizations/org_abc123/memberships --app app_abc123 --instance ins_abc123 -d '{"user_id":"user_xyz","role":"org:member"}' --dry-run
clerk api /organizations/org_abc123/memberships/user_xyz --app app_abc123 --instance ins_abc123 -X PATCH -d '{"role":"org:admin"}' --dry-run
clerk api /organizations/org_abc123/memberships/user_xyz --app app_abc123 --instance ins_abc123 -X DELETE --dry-run

# Invitations
clerk api /organizations/org_abc123/invitations --app app_abc123 --instance ins_abc123 -d '{"email_address":"new@acme.com","role":"org:member"}' --dry-run
```

If organization endpoints return `organization_not_enabled_in_instance`, enable the feature first with the dedicated toggle:

```sh
# Inspect org settings
clerk api /instance/organization_settings

# Preview, then enable organizations for this instance
clerk enable orgs --app app_abc123 --instance ins_abc123 --dry-run
# After user approval, rerun the same command without --dry-run.
```

For org settings the toggle flags don't cover, preview `clerk config patch --json '{"organization_settings":{...}}' --dry-run`, then rerun it after approval. Deeper org workflows (roles, memberships, components) live in the `clerk-orgs` skill.

## Sessions

```sh
# List active sessions for a user
clerk api '/sessions?user_id=user_abc123&status=active'

# Revoke a session
clerk api /sessions/sess_abc123/revoke --app app_abc123 --instance ins_abc123 -X POST --dry-run
```

## Impersonation (sign in as a user)

Impersonation goes through `clerk impersonate` (alias `imp`): it creates an actor token stamped `cli:<your-email>` so every impersonation session is traceable. Requires `clerk auth login`.

```sh
# Print the sign-in URL for a user (agent-safe: no browser, no prompt)
clerk imp user_abc123 --app app_abc123 --instance ins_abc123 --print

# Resolve by exact email instead of user ID
clerk imp alice@example.com --app app_abc123 --instance ins_abc123 --print

# Short-lived token. This command has no dry-run; confirm with the user before minting it.
clerk imp user_abc123 --app app_abc123 --instance ins_abc123 --expires-in 900

# Revoke a pending actor token after user approval (the id is printed at creation - capture it then)
clerk imp revoke act_abc123 --app app_abc123 --instance ins_abc123
```

To mint a one-time **sign-in token** instead - for building custom token sign-in flows, signing in *as* the user with no actor audit trail - use the raw API:

```sh
clerk api /sign_in_tokens --app app_abc123 --instance ins_abc123 -d '{"user_id":"user_abc123"}' --dry-run
```

## Invitations (top-level, not org-scoped)

```sh
clerk api /invitations
clerk api /invitations --app app_abc123 --instance ins_abc123 -d '{"email_address":"new@example.com","redirect_url":"https://example.com/welcome"}' --dry-run
clerk api /invitations/inv_abc123/revoke --app app_abc123 --instance ins_abc123 -X POST --dry-run
```

## JWT templates

```sh
clerk api /jwt_templates
clerk api /jwt_templates/jtmp_abc123
clerk api /jwt_templates --app app_abc123 --instance ins_abc123 -d '{
  "name": "supabase",
  "claims": {"aud": "authenticated", "role": "authenticated"},
  "lifetime": 60
}' --dry-run
```

## Webhooks (local testing)

`listen` talks only to the Svix relay and `verify` is pure local HMAC - neither needs auth or a linked project.

```sh
# 1. Mint a token and open a pinned tunnel that forwards deliveries to your handler.
#    The command prints a relay inbox URL (https://webhooks.clerk.com/in/c_.../).
clerk webhooks listen --token "$(clerk webhooks token)" --forward-to http://localhost:3000/api/webhooks

# 2. Add that relay URL as a webhook endpoint in the Clerk Dashboard.
#    Real events now stream to your terminal and forward to your local handler.
#    svix-* headers are preserved, so verifyWebhook() in your handler still
#    verifies against that endpoint's signing secret.

# 3. Capture events for replay/verification (agent mode emits NDJSON automatically)
clerk webhooks listen --forward-to http://localhost:3000/api/webhooks --json > events.ndjson

# 4. Verify a saved delivery offline against the endpoint's signing secret
clerk webhooks verify --secret whsec_... --delivery @event.json
```

Pin the token (`--token`) whenever you want the inbox URL to survive across machines and restarts - otherwise the relay URL can change and the Dashboard endpoint needs re-pointing.

## Instance configuration

Prefer the dedicated `config` commands over raw `api` calls - they handle confirmation, dry-run, and formatting.

```sh
# Pull the current dev config
clerk config pull
clerk config pull --output config.dev.json

# Pull production
clerk config pull --instance prod --output config.prod.json

# Look at the schema to know what's available
clerk config schema --keys session sign_in social

# PATCH: surgical updates
clerk config patch --app app_abc123 --instance ins_abc123 --json '{"session":{"lifetime":3600}}' --dry-run
# After user approval, rerun the same command without --dry-run.

# PUT: replace everything (destructive - always --dry-run first)
clerk config put --app app_abc123 --instance prod --file config.prod.json --dry-run
# After user approval, rerun the same command without --dry-run and keep --instance prod.
```

## Environment variables

```sh
# Pull dev keys into .env.local (auto-detects framework and key names)
clerk env pull

# Pull production keys
clerk env pull --instance prod

# Target a specific file
clerk env pull --file .env
```

`env pull` merges into the existing file: existing Clerk keys are updated in place; new ones are appended under a `# Clerk` header; everything else is preserved.

## Applications (Platform API)

```sh
# List your apps
clerk apps list
clerk apps list --json

# Fetch one (raw API)
clerk api /v1/platform/applications/app_abc123 --platform
```

## Scripting patterns

### Save large responses to a file before reading them

`users list`, `apps list`, `config pull`, and most `clerk api` GETs can return responses ranging from kilobytes to megabytes. Reading the full payload into an LLM-driven session burns context for no benefit. Persist the response, then query just the slice you need:

```sh
# Persist only the fields needed below in a private temporary directory.
umask 077
response_dir="$(mktemp -d "${TMPDIR:-/tmp}/clerk-cli.XXXXXX")"
response_file="$response_dir/users.json"
trap 'rm -rf "$response_dir"' EXIT
clerk users list --json --limit 250 |
  jq '{data: [.data[] | {id, email_addresses}], hasMore}' > "$response_file"

jq '.data | length'  "$response_file"   # count rows on the page
jq '.hasMore'        "$response_file"   # any more pages?
jq '.data[0] | keys' "$response_file"   # learn the saved shape
jq '.data[]'         "$response_file"   # inspect the selected fields
```

If `jq` is not on `PATH`, fall back to Python or Node, which most environments have:

```sh
RESPONSE_FILE="$response_file" python3 -c 'import json, os; d=json.load(open(os.environ["RESPONSE_FILE"])); print(len(d["data"]), d["hasMore"])'
RESPONSE_FILE="$response_file" node -e 'const d=require(process.env.RESPONSE_FILE); console.log(d.data.length, d.hasMore)'
```

Only `cat`/`head` the file when you genuinely need the raw structure for one-off debugging.

### Pipe to `jq`

For small responses (or one-shot lookups), inline piping to `jq` is fine:

```sh
# Get a list of user IDs from the current page (the page envelope is `{ data, hasMore }`)
clerk users list --json | jq -r '.data[] | .id'

# Count banned users on the current page
clerk users list --json | jq '[.data[] | select(.banned)] | length'

# Walk every page until hasMore is false. Save each page to its own file so you
# can inspect them independently without re-fetching.
umask 077
response_dir="$(mktemp -d "${TMPDIR:-/tmp}/clerk-pages.XXXXXX")"
trap 'rm -rf "$response_dir"' EXIT
offset=0
while :; do
  page="$response_dir/users-${offset}.json"
  clerk users list --json --limit 250 --offset "$offset" > "$page"
  jq -r '.data[] | .id' "$page"
  [ "$(jq -r '.hasMore' "$page")" = "true" ] || break
  offset=$((offset + 250))
done
```

### Read body from stdin

```sh
echo '{"first_name":"Bob"}' | clerk api /users/user_abc123 --app app_abc123 --instance ins_abc123 -X PATCH --dry-run
jq -n '{email_address:["c@d.co"]}' | clerk api /users --app app_abc123 --instance ins_abc123 --dry-run
```

### Loop safely

```bash
set -euo pipefail
umask 077
workdir="$(mktemp -d "${TMPDIR:-/tmp}/clerk-update.XXXXXX")"
trap 'rm -rf "$workdir"' EXIT
ids_file="$workdir/reviewed-user-ids.txt"

update_users() {
  dry_run="$1"
  if [ "$dry_run" = true ]; then
    : > "$ids_file"
    offset=0
    while :; do
      page="$workdir/users-${offset}.json"
      clerk users list --app app_abc123 --instance ins_abc123 --json --limit 250 --offset "$offset" > "$page"
      ids="$(jq -r '.data[] | .id' "$page")"
      printf '%s\n' "$ids" >> "$ids_file"
      while IFS= read -r id; do
        [ -n "$id" ] || continue
        clerk api "/users/$id" --app app_abc123 --instance ins_abc123 -X PATCH -d '{"public_metadata":{"migrated":true}}' --dry-run
      done <<EOF
$ids
EOF
      has_more="$(jq -r '.hasMore' "$page")"
      [ "$has_more" = true ] || break
      offset=$((offset + 250))
    done
    return
  fi

  while IFS= read -r id; do
    [ -n "$id" ] || continue
    clerk api "/users/$id" --app app_abc123 --instance ins_abc123 -X PATCH -d '{"public_metadata":{"migrated":true}}'
  done < "$ids_file"
}

update_users true
# Stop here. Keep this shell open, review every preview, and get user approval before applying changes.
# The private reviewed-user-ids.txt file is the approved set; the apply pass never re-lists users.
```

After approval, run the apply phase separately in the same shell so it uses the private reviewed ID snapshot:

```bash
update_users false
```

### Target multiple instances

```sh
# Copy config from dev to staging for review
umask 077
config_dir="$(mktemp -d "${TMPDIR:-/tmp}/clerk-config.XXXXXX")"
trap 'rm -rf "$config_dir"' EXIT
clerk config pull --app app_abc123 --instance dev --output "$config_dir/dev-config.json"
clerk config put --app app_abc123 --instance ins_staging --file "$config_dir/dev-config.json" --dry-run
```

## When in doubt

```sh
clerk api ls <keyword>        # find the right endpoint
clerk <command> --help        # authoritative flag list
clerk doctor --json           # health check
```
