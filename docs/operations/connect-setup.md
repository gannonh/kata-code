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
2. Allow both redirect URIs: `http://127.0.0.1:34338/callback` and
   `https://app.kata.sh/connect/callback`. A custom `KATACODE_HOSTED_APP_URL` needs its own
   `/connect/callback` URL. Headless and SSH authorization depend on the hosted redirect.
3. Enable the `openid`, `profile`, and `email` scopes.
4. Set `KATACODE_CLERK_CLI_OAUTH_CLIENT_ID` to the generated public client ID in local and release
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

## Restricting sign-ups

Use Clerk's allowlist for permitted email addresses or domains, or Restricted mode for invitation-only
sign-up. An enabled empty allowlist blocks all new sign-ups.

Sign-up restrictions do not revoke an existing account's access. Ban the account in Clerk when
its active sessions and future sign-ins must be disabled.
