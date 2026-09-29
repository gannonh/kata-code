# Kata Code Connect setup

Deployment and client configuration for Kata Code Connect. The [architecture note](../internals/t3-connect.md)
explains the trust boundaries; the [relay README](../../infra/relay/README.md#deployment) owns relay
provisioning instructions.

## Public application configuration

Kata Code Connect is disabled in a fresh clone until `OP_SERVICE_ACCOUNT_TOKEN` is set. Source
builds then load Clerk and relay identifiers from the 1Password Environment. See
[environment variables](./environment-variables.md). Do not create a repository-root `.env`.

Canonical names (process env overrides 1Password):

```dotenv
KATACODE_CLERK_PUBLISHABLE_KEY=<publishable key>
KATACODE_CLERK_JWT_TEMPLATE=<JWT template name>
KATACODE_CLERK_CLI_OAUTH_CLIENT_ID=<public OAuth application client ID>
KATACODE_RELAY_URL=https://relay.example.com
```

The build loader supplies framework-specific aliases. These values are public identifiers.
`CLERK_SECRET_KEY` belongs only in the 1Password Environment (and GitHub Actions for production
relay), never in client configuration.

Client and bundled-server builds embed the public values, so the token must be set before building.
EAS preview and production environments need the publishable key, JWT template name, and relay URL.
Bundled servers also accept runtime overrides for operator-managed deployments.

Relay deployment settings are the same 1Password Environment. Deploy `prod` before personal stages
because it owns the retained database that their branches depend on. The deploy command prints the
relay URL; put it in the Environment as `KATACODE_RELAY_URL` when that stage should be the
source-build default.

## CLI OAuth application

In Clerk's OAuth applications settings:

1. Create a public OAuth application for the Kata Code CLI, using authorization-code exchange with PKCE.
2. Allow the redirect URI `http://127.0.0.1:34338/callback`.
3. Enable the `openid`, `profile`, `email`, and `offline_access` scopes.
4. Enable **Device authorization grant** on the application. Headless and SSH authorization
   (`katacode connect link --headless`) use it. The instance discovery document can list the
   `device_code` grant while the application still has it off. In that state
   `POST /oauth/device_authorization` returns HTTP 400 `invalid_grant` ("The requested OAuth 2.0
   Client does not have the 'urn:ietf:params:oauth:grant-type:device_code' grant"). If the
   dashboard does not show the toggle, set it through the Backend API with the instance's secret
   key:

   ```sh
   curl -X PATCH "https://api.clerk.com/v1/oauth_applications/<oauth application id>" \
     -H "Authorization: Bearer $CLERK_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{"device_authorization_grant_enabled":true}'
   ```

   `GET` the same URL and confirm `device_authorization_grant_enabled` is `true`. The application
   id starts with `oa_`, and it is different from the public client ID.

5. Set `KATACODE_CLERK_CLI_OAUTH_CLIENT_ID` to the generated public client ID in local and release
   build environments.

## JWT template

Create a Clerk JWT template named `kata-relay` with claims:

```json
{ "aud": "kata-code-relay" }
```

Set `KATACODE_CLERK_JWT_TEMPLATE=kata-relay` for clients and
`CLERK_JWT_AUDIENCE=kata-code-relay` for the relay. The production relay deployment environment
also defines `CLERK_JWT_TEMPLATE`. The audience stays the same across relay stages; the relay
URL selects the deployment.

## Desktop OAuth redirects

Enable Clerk's Native API and add the desktop redirects to its SSO redirect allowlist:

```text
katacode-dev://app/
katacode://app/
```

Add the corresponding origin to the Clerk instance's Backend API `allowed_origins` array.
Development uses `katacode-dev://app`; production uses `katacode://app`. Update the array with
`PATCH https://api.clerk.com/v1/instance` using the Clerk secret key, preserving existing entries.
The Clerk Electron integration handles token
persistence and system-browser callback delivery.

## Android native sign-in redirects

Android is parked ([supported platforms](./supported-platforms.md#android)). Keep this for when it returns.

Clerk's native Android SDK uses `clerk://<applicationId>.callback`. In the Clerk instance selected by the app's publishable key, add each supported package to **Native applications > Allowlist for mobile SSO redirect**:

| Variant     | Callback                                      |
| ----------- | --------------------------------------------- |
| Development | `clerk://com.t3tools.t3code.dev.callback`     |
| Preview     | `clerk://com.t3tools.t3code.preview.callback` |
| Production  | `clerk://com.t3tools.t3code.callback`         |

Preserve existing entries. These callbacks are separate from the `t3code-dev` / `t3code-preview` / `t3code` navigation schemes. A private development build using the production Clerk key still needs its development callback allowed by that instance's administrator; rebuilding the same package does not change the allowlist.

## Desktop passkeys

For a production macOS app with bundle ID `com.katacode.app`:

1. Create an explicit macOS App ID in the Apple Developer portal with **Associated Domains**.
2. Create a provisioning profile for that App ID and the distribution signing certificate.
3. In Clerk's Native API settings, add an iOS app with the same Apple Team ID and bundle ID.
   This setting also configures Electron/macOS passkeys.
4. Check `https://<frontend-api>/.well-known/apple-app-site-association`. Its
   `webcredentials.apps` must include `<TEAM_ID>.com.katacode.app`.
5. Configure signing as described in the [release runbook](./release.md#2-apple-signing--notarization-setup-macos).

Local signed builds additionally use these names in the 1Password Environment:

```dotenv
KATACODE_APPLE_TEAM_ID=ABC1234567
KATACODE_MACOS_PROVISIONING_PROFILE=/absolute/path/to/katacode.provisionprofile
# Override only when the RP domain differs from the Clerk Frontend API hostname.
KATACODE_CLERK_PASSKEY_RP_DOMAINS=example.clerk.accounts.dev,clerk.example.com
```

Without the override, the build derives the RP domain from the Clerk publishable key.
After changing Associated Domains, bump the build version before rebuilding. macOS can otherwise
reuse stale Shared Web Credentials metadata for the same app/version pair.

The ordinary `dev:desktop` launcher is unsigned and cannot exercise macOS passkeys. For renderer
HMR, install a signed build, start `vp run dev:web`, and launch the installed executable with the
actual web and server ports. For example, with the default ports:

```sh
VITE_DEV_SERVER_URL=http://127.0.0.1:5733 \
KATACODE_PORT=13773 \
  "/Applications/Kata Code (Alpha).app/Contents/MacOS/Kata Code (Alpha)"
```

Rebuild the signed app after native dependency, main-process, preload, entitlement, provisioning,
or signing changes. Renderer edits can reuse it. Verify the installed bundle before testing:

```sh
codesign --verify --deep --strict "/Applications/Kata Code (Alpha).app"
codesign -d --entitlements :- "/Applications/Kata Code (Alpha).app"
```

## Production Clerk instance

Released builds, the hosted web app, TestFlight builds, and the production relay all authenticate
against one Clerk instance. The relay verifies tokens with the `CLERK_PUBLISHABLE_KEY` and
`CLERK_SECRET_KEY` of the GitHub `production` environment, so every client must use a publishable
key from the same instance. A key pair from different instances makes the relay reject every token.
The 1Password Environment feeds source builds against the same relay, so it moves with the relay.

Clerk's [production deployment guide](https://clerk.com/docs/guides/development/deployment/production)
is the reference. Set up the instance in this order and swap the keys last, so nothing depends on
the instance before it works.

1. **Clone the development instance.** In the Clerk Dashboard, open the instance switcher and
   select **Create production instance**, then **Clone development instance**. Cloning copies
   authentication and theme settings. Clerk does not copy SSO connections, integrations, or paths.
2. **Add the DNS records.** The instance's **Domains** page lists the CNAME records for `kata.sh`
   (typically `clerk`, `accounts`, and the mail and DKIM records). `kata.sh` DNS is on Cloudflare
   and has a proxied wildcard `*.kata.sh` A record. Add every Clerk record as an explicit CNAME with
   the proxy off (**DNS only**), or the wildcard shadows it. Select **Verify configuration** once
   the records resolve. Propagation can take up to 48 hours, and Clerk issues certificates after
   verification.
3. **Add each social provider's own OAuth credentials.** Production cannot use Clerk's shared
   development credentials. Without them the provider's authorize URL has no `client_id` and
   sign-in fails. Google is the only provider enabled. Its OAuth client lives in the Google Cloud
   project `kata-code` (owner `gannon@gannonh.dev`):
   - Google Auth Platform: External audience, scopes `openid`, `email`, `profile` only, publishing
     status **In production** (Testing mode blocks every Google account that is not a listed test
     user). Branding uses `https://kata.sh` and `https://kata.sh/privacy` and needs no Google
     verification while it has no logo or sensitive scopes.
   - Client: type **Web application**, authorized redirect URI
     `https://clerk.kata.sh/v1/oauth_callback`.
   - In Clerk, **User & authentication > SSO connections > Google**, enter the client ID and secret.

   Check it: the `external_verification_redirect_url` from
   `POST https://clerk.kata.sh/v1/client/sign_ins` with `strategy=oauth_google` must contain a
   `client_id` parameter.

4. **Check what the clone carried over.** The clone copied the `kata-relay` JWT template and
   **Access mode: Waitlist**. It did not copy the CLI OAuth application, the iOS app, or the native
   redirect allowlist. Recreate them:
   - the [CLI OAuth application](#cli-oauth-application), public, with redirect URIs
     `http://127.0.0.1:34338/callback` and `https://app.kata.sh/connect/callback`, scopes
     `openid profile email offline_access`, and **Device authorization grant**. The Backend API
     creates it (`POST /v1/oauth_applications`, with `redirect_uris` and without `callback_url`)
     and enabled the device grant on production without a Clerk support request.
   - the Native API iOS app `ZBZKKWF95G.com.katacode.app`. Clerk also adds
     `com.katacode.app://callback` to the redirect allowlist. Add `katacode://app/` and
     `katacode-dev://app/` too.
   - **Access mode** set to **Waitlist** (see [Early access waitlist](#early-access-waitlist)).
     Without it, any client sign-in screen can create an account.
5. **Create a smoke-test user.** The relay deploy runs `CLERK_SMOKE_USER_ID` against the instance.
   Create a user in the production instance, `kata-code-smoke@kata.sh`, and set the `production`
   variable and the 1Password Environment to its ID. Production rejects Backend API session
   creation, so the smoke test signs the user in with a sign-in token through the Frontend API.
6. **Swap the keys together.** Changing only some of them leaves the relay rejecting tokens.

   ```sh
   gh variable set CLERK_PUBLISHABLE_KEY --env production --repo gannonh/kata-code   # pk_live_...
   gh variable set CLERK_CLI_OAUTH_CLIENT_ID --env production --repo gannonh/kata-code
   gh variable set CLERK_SMOKE_USER_ID --env production --repo gannonh/kata-code
   gh secret set CLERK_SECRET_KEY --env production --repo gannonh/kata-code           # sk_live_...
   ```

   Update `KATACODE_CLERK_PUBLISHABLE_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
   `KATACODE_CLERK_CLI_OAUTH_CLIENT_ID`, `CLERK_CLI_OAUTH_CLIENT_ID`, and `CLERK_SMOKE_USER_ID` in
   the 1Password Environment to match. `op` can only read Environments, so edit them in the
   1Password app. Then run the **Deploy Kata Code Connect relay** workflow.

7. **Verify on released builds.** Sign in fresh on a desktop nightly, the hosted web app, and a
   TestFlight build, and pair an environment through `https://relay.kata.sh` from each. Run
   `katacode` CLI sign-in through the browser (PKCE) and headless (device grant).

Development-instance users and their sessions do not carry over. Clients sign in again and re-pair.
Move to production before the first invited users sign up. Migrating users later means exporting
them and remapping any relay data keyed on their Clerk user IDs.

## Early access waitlist

Kata Code Connect is invite-gated. Clients show **Request early access**, which submits the email to
the Clerk waitlist, and a separate **Sign in** path for approved users. Web and desktop open Clerk's
`<Waitlist />` modal; mobile submits through `useWaitlist()` on the Settings early-access screen
(deep link `/settings/waitlist`). Clerk enforces the gate server-side, so the instance must be in
waitlist mode. Otherwise any client's sign-in screen can still create an account.

### Turn on waitlist mode

The Backend API and the Clerk secret key cannot change the sign-up mode. Use the Dashboard for the
instance that released builds use:

1. Open the Clerk Dashboard, select the application, and select the instance (Development or
   Production) whose publishable key the release uses.
2. Go to **User & authentication > Access mode**.
3. Select **Waitlist**, then select **Save**.

The Clerk CLI can set the same value after an interactive `clerk auth login` and `clerk link` to
the application:

```sh
npx clerk@latest config patch --instance dev --json '{"sign_up_mode":"waitlist"}'
```

Check the result without a secret. The instance's Frontend API host is the base64-decoded
publishable key without the trailing `$`:

```sh
curl -s "https://<frontend-api-host>/v1/environment" | jq -r .user_settings.sign_up.mode
# waitlist
```

### Approve requests

In the Dashboard, open **Waitlist**. For each entry, choose **Invite** to email the person a sign-up
invitation or **Deny** to reject the request. An invited person creates their account from the
invitation, then signs in from any client.

The Backend API can do the same with the Clerk secret key:

```sh
curl -s -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  "https://api.clerk.com/v1/waitlist_entries?status=pending"
curl -s -X POST -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  "https://api.clerk.com/v1/waitlist_entries/<waitlist_entry_id>/invite"
curl -s -X POST -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  "https://api.clerk.com/v1/waitlist_entries/<waitlist_entry_id>/reject"
```

Load `CLERK_SECRET_KEY` from the 1Password Environment into the shell for the command; do not
write it to a file.

## Restricting sign-ups

Waitlist mode replaces the allowlist and Invite-only mode for Connect access. An enabled empty
allowlist blocks all new sign-ups.

Sign-up restrictions do not revoke an existing account's access. Ban the account in Clerk when
its active sessions and future sign-ins must be disabled.
