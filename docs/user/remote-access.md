# Remote Access

Use this when you want to connect to a Kata Code server from another device such as a phone, tablet, or separate desktop app.

## Quick Pairing for a Running Server

If a server is already running on this machine, mint a fresh pairing token and QR code without restarting anything:

```bash
npx @kata-sh/code-cli@latest pair
```

`katacode pair` finds the running server (the shared `~/.katacode` install, or the current worktree's dev server when run inside one), issues a one-time pairing token, and prints the pairing URL as a QR code you can scan from your phone.

If the server is only bound to loopback, the printed URL is not reachable from another device. Pair over your tailnet instead:

```bash
npx @kata-sh/code-cli@latest pair --tailscale
```

This publishes the server over Tailscale Serve HTTPS (configuring the mapping if needed — it persists until you run `tailscale serve --https=443 off`) and pairs through the `https://machine.tailnet.ts.net/` URL. Use `--tailscale-serve-port` for a different HTTPS port, `--ttl` to change the token lifetime, and `--base-dir` to target a specific data directory.

If no server is running, `katacode pair` says so and points you at the `serve` or `connect` command.

## Recommended Setup

Use a trusted private network that meshes your devices together, such as a tailnet.

That gives you:

- a stable address to connect to
- transport security at the network layer
- less exposure than opening the server to the public internet

## Enabling Network Access

There are three ways to reach your server from another device: expose the desktop app's backend,
run a headless server from the CLI, or have the desktop app launch Kata Code over SSH.

### Option 1: Desktop App

If you are already running the desktop app and want to make it reachable from other devices:

1. Open **Settings** → **Connections**.
2. Under **This environment**, toggle **Network access** on. This will restart the app and run the backend on all network interfaces.
3. The settings panel will show the default reachable endpoint, with a `+N` control when more endpoints are available. Expand it to inspect alternatives such as loopback, LAN, private-network, or HTTPS endpoints.
4. Use **Create Link** to generate a pairing link you can share with another device.

The default endpoint controls the QR code and primary copy action for pairing links. You can change it from the expanded endpoint list. The preference is stored by endpoint type, so choosing the local LAN endpoint survives normal IP address changes when you move between networks.

When no user default is saved, the app uses the built-in LAN endpoint for pairing links when
available. You can set another endpoint as the default from the expanded endpoint list.

- HTTPS/WSS-compatible endpoints work from `https://app.kata.sh`, but are not made the default
  automatically.
- Non-loopback HTTP endpoints are useful for direct LAN pairing.
- Loopback-only endpoints are not useful for another device unless that device is the same machine.

If the copied link points directly at `http://192.168.x.y:3773`, open it from a client that can reach that LAN address. If it points at `https://app.kata.sh/pair?...`, the hosted web app will save the environment and connect directly to the backend URL in the link.

In the mobile app's **Add Environment** form, a numeric IP address without a scheme uses HTTP. Include `https://` explicitly when the backend is served over HTTPS.

### Tailscale Endpoints

When the desktop app can detect Tailscale, it adds Tailnet endpoints to the reachable endpoint list.

Depending on your Tailscale setup, this may include:

- the machine's `100.x.y.z` Tailnet IP
- a MagicDNS name
- an HTTPS MagicDNS endpoint when Tailscale Serve is configured for this backend

The Tailscale HTTPS endpoint uses the clean MagicDNS URL, such as
`https://machine.tailnet.ts.net/`, and is off until you opt in. Turn on **Enable Tailscale HTTPS**
on the **Tailscale HTTPS** row in **Settings** → **Connections**. The desktop app restarts the
backend with the same server-side behavior as `katacode serve --tailscale-serve`, then the server asks
Tailscale Serve to proxy HTTPS traffic to the local backend. Turn the same switch off to stop it.

The Tailscale support is an endpoint provider add-on. The core remote model still works without Tailscale: LAN HTTP endpoints, custom HTTPS endpoints, future tunnels, and SSH-launched environments all use the same saved environment and pairing flow.

For `https://app.kata.sh`, prefer an HTTPS Tailnet or other HTTPS endpoint. A plain `http://100.x.y.z:3773` endpoint can still work from a desktop client or another browser page served over HTTP, but it will not work from the hosted HTTPS app because of browser mixed-content rules.

### Option 2: Headless Server (CLI)

Use this when you want to run the server without a GUI, for example on a remote machine over SSH.

Run the server with `katacode serve`.

```bash
npx @kata-sh/code-cli@latest serve --host "$(tailscale ip -4)"
```

`katacode serve` starts the server without opening a browser and prints:

- a connection string
- a pairing token
- a pairing URL
- a QR code for the pairing URL

From there, connect from another device in either of these ways:

- scan the QR code on your phone
- in the desktop app, open **Settings** → **Connections** → **Add environment** → **Remote link**, paste the full pairing URL into **Host**, then click **Add environment**
- in the desktop app, enter the host and token separately
- in the hosted web app, open a hosted pairing URL when the backend is reachable over HTTPS

Use `katacode serve --help` for the full flag reference. It supports the same general startup options as the normal server command, including an optional `cwd` argument.

#### Test a second server on the same machine

Give a local test server its own data directory. Without `--base-dir`, the desktop app and CLI can
share an environment ID, causing the app to treat the test server as its primary environment and
hide it from **Remote environments**.

```bash
npx @kata-sh/code-cli@latest serve \
  --port 53210 \
  --base-dir ~/.katacode-headless-test
```

Paste the printed pairing URL into **Settings** → **Connections** → **Add environment** →
**Remote link**. Use `@nightly` instead of `@latest` when testing against the Nightly desktop app.

#### Connect a headless server through Kata Code Connect

On the headless machine, register the environment:

```bash
npx @kata-sh/code-cli@latest connect link --headless
```

Approve the managed relay-client installation when prompted. Then open the printed URL on a device
with a browser, sign in, and paste the authorization code back into the terminal. Start the server
with the same package channel and data directory:

```bash
npx @kata-sh/code-cli@latest serve
```

Kata Code Connect supplies the tunnel, so this flow does not require `--host 0.0.0.0` or an open
inbound firewall port. In the desktop app, sign in with the same Kata Code Connect account, open
**Settings** → **Connections**, find the environment under **Remote environments**, and click
**Connect**.

If you pass `--base-dir` to `connect link`, pass the same value to `serve`. Use `@nightly` for both
commands when the desktop app runs Nightly.

##### Run on a Fly Sprite

A Sprite suspends when idle, which freezes Kata Code and its outbound Connect tunnel. The
`katacode connect sprite` commands install Kata Code as a Sprite service. The server uses the Sprite
Tasks API to stay awake while a client, agent, or terminal job is active.

The commands operate on an existing Sprite. They never create, recreate, or destroy the Sprite.
Authenticate the Sprite CLI and create the Sprite before running setup:

```bash
npx @kata-sh/code-cli@latest connect sprite setup --sprite kata-dev --org my-org
npx @kata-sh/code-cli@latest connect sprite wake --sprite kata-dev --org my-org
npx @kata-sh/code-cli@latest connect sprite status --sprite kata-dev --org my-org
npx @kata-sh/code-cli@latest connect sprite release --sprite kata-dev --org my-org
```

Run `npx @kata-sh/code-cli@latest connect sprite --help` or append `--help` to a subcommand for its
full flag reference.

`setup` installs the same Kata Code version as the CLI running the command, verifies `node-pty`, and
opens the headless Connect authorization flow. It stops and replaces only the Sprite service named
`katacode`, binding the new service to `127.0.0.1:8080`. Existing files, repositories, Sprite state,
and unrelated services remain intact. Setup forces Cloudflare HTTP/2 to avoid QUIC timeouts on
Sprites. Rerun setup to update Kata Code or replace its service environment.

Put service environment variables and secrets in a `.env` file:

```dotenv
OPENAI_API_KEY=replace-me
KATACODE_PROVIDER=codex
```

Pass the file to setup:

```bash
npx @kata-sh/code-cli@latest connect sprite setup --sprite kata-dev --env .env
```

The command parses the file with Node's dotenv parser and does not print its values. Setup writes the
parsed environment to `~/.katacode/service-env.json` with owner-only permissions. The environment
persists across suspension and wake-ups. Running setup without `--env` preserves it; running setup
with a new `--env` file replaces it. Quoted commas and multiline values are supported. Names beginning
with `KATACODE_SPRITE_` and `TUNNEL_TRANSPORT_PROTOCOL` are reserved.

Clone a public repository into the Sprite:

```bash
npx @kata-sh/code-cli@latest connect sprite clone \
  --sprite kata-dev \
  --repo https://github.com/owner/repository.git
```

The default destination is `$HOME/workspaces/repository`. Pass `--dir /absolute/path` to override
it. If the destination already contains a Git checkout, `clone` runs `git pull --ff-only` only when
that checkout's fetch remote is the same repository as `--repo`. Repository URLs, destination paths,
and package specs cannot contain commas or newlines. For a private GitHub repository, add `GH_TOKEN`
to the `.env` file passed to setup. Clone automatically reuses the saved token. Pass `--env` to clone
only to override saved values for that command. The command sends the token as an HTTPS authorization
header to `github.com` remotes only, and does not save it in the Git remote URL.

`wake` creates a five-minute bootstrap task named `kata-session`, then restarts the `katacode`
service so its Connect tunnel registers fresh connections. Once Kata Code starts, it refreshes a
five-minute task every minute while any client connection, active provider turn, or terminal subprocess
exists. It keeps refreshing for 10 minutes after the last activity, then removes the task so Fly can
suspend the Sprite. If Kata Code exits unexpectedly, the task expires within five minutes.

Wake does not create or restore a Connect link. Connect links persist across normal Sprite
suspension. If the client reports that the environment is not authorized, rerun `setup` to authorize
and replace the `katacode` service.

`status` prints the `katacode` service state and the current `kata-session` task. Reading status can
briefly wake a suspended Sprite.

`release` deletes the current `kata-session` task so Fly can suspend the Sprite. Suspension takes the
Kata Code server and its Connect tunnel offline, which disconnects clients. The Sprite, files, service
definition, environment, and Connect authorization persist. Run `wake` to restart the server and
register fresh tunnel connections.

#### Fix a Connect account mismatch

Clerk stores the desktop app session and the Connect CLI authorization separately. The environment
belongs to the account that authorized `connect link`. Signing in to another account in the desktop
app does not change the CLI authorization.

`connect link --headless` reuses a valid stored CLI credential. To move a Nightly environment to the
same account as the mobile app, clear that credential and authorize the link again:

```bash
npx @kata-sh/code-cli@nightly connect logout --base-dir ~/.katacode
npx @kata-sh/code-cli@nightly connect link --headless --base-dir ~/.katacode
```

Open the authorization URL and sign in with the account used on mobile. Confirm that the command
reports the expected account, then restart the Nightly desktop app. The explicit `--base-dir` keeps
the commands on the installed app's data when you run them from a linked worktree.

For hosted web pairing over Tailscale HTTPS, opt in to Tailscale Serve:

```bash
npx @kata-sh/code-cli@latest serve --tailscale-serve
```

By default this configures Tailscale Serve on HTTPS port 443 and advertises
`https://machine.tailnet.ts.net/`. Advanced users can choose a different HTTPS port:

```bash
npx @kata-sh/code-cli@latest serve --tailscale-serve --tailscale-serve-port 8443
```

Once paired, add projects normally: open the Command Palette and choose **Add Project**, then pick
the environment the project lives on. Every saved environment is offered, not only the local one.

### Option 3: Desktop-Managed SSH Launch

Use this when you want the desktop app to start or reuse Kata Code on another machine over SSH.

1. Open **Settings** → **Connections**.
2. Under **Remote Environments**, choose **Add environment**.
3. Select the SSH launch flow.
4. Enter the SSH target, such as `user@example.com`.
5. Confirm the launch. The desktop app probes the host, starts or reuses a remote Kata server, opens a local port forward, and saves the environment.

After setup, the renderer connects to a local forwarded HTTP/WebSocket endpoint. The remote host still owns the actual Kata server, projects, files, git state, terminals, and provider sessions.

SSH launch is a desktop feature because it needs local process and SSH access. Once the environment is paired and saved, it uses the same environment list and connection model as direct LAN, Tailscale, HTTPS, or future tunnel-backed environments.

#### SSH Launch Troubleshooting

The desktop SSH launcher connects with a non-interactive `sh` session, writes a small launcher script under `~/.katacode/ssh-launch/<host-key>/`, starts or reuses a remote Kata server, and forwards the remote loopback port back to your desktop.

The remote host must have a compatible Node.js runtime. Kata Code uses the server package's `engines.node` requirement:

```text
^22.16 || ^23.11 || >=24.10
```

During SSH launch, Kata Code first checks whether `node` is on `PATH`. If it is missing, the launcher
looks in the usual install directories and tries to activate a version manager if it finds one
(Volta, asdf, mise, fnm, nodenv, nvm). That covers most setups, but a version manager that only
initializes from an interactive shell profile will not be picked up.

If launch fails with `node: command not found`, a port-scan failure, or a message that the remote Node version does not satisfy the required range, SSH into the host and check the same non-interactive shell path Kata Code uses:

```bash
ssh user@example.com 'sh -lc "command -v node && node --version"'
```

If that does not print a compatible Node version, configure your version manager for non-interactive shells or install a compatible Node binary in one of the searched locations. For example, with nvm you may need a default alias:

```bash
nvm alias default 24
```

With mise, asdf, fnm, or nodenv, make sure the tool's shim directory is installed and resolves to a Node version satisfying the range above without an interactive shell.

If reconnecting after an app update fails, retry the SSH launch once. The launcher now compares its generated runner script, stops stale launcher-managed remote servers, clears the SSH launch PID/port state, and starts a fresh remote server. You should not normally need to delete `~/.katacode/ssh-launch` or kill `katacode` processes manually.

## Updating a Remote Server

When the Kata Code web or desktop app and a remote server use different versions, a warning appears in
the conversation and in **Settings** → **Connections**. Follow the action shown there: Kata Code may
be able to update and reconnect the server for you, or it may ask you to update the desktop app or
run a copied command on the server machine.

Finish active work before updating because the server restarts briefly. For step-by-step guidance,
see [Keeping Kata Code in Sync](./updating.md).

On a Linux host, you can keep the server running after logout and manage it independently of the
connection method. See [Running Kata Code in the Background](./background-service.md).

## How Pairing Works

The remote device does not need a long-lived secret up front.

Instead:

1. `katacode serve` issues a one-time owner pairing token.
2. The remote device exchanges that token with the server.
3. The server creates an authenticated session for that device.

After pairing, future access is session-based. You do not need to keep reusing the original token unless you are pairing a new device.

## Hosted Web App Pairing

The hosted web app at `https://app.kata.sh` can save a remote backend in browser local storage from a URL like:

```text
https://app.kata.sh/pair?host=https://backend.example.com:3773#token=PAIRCODE
```

Use hosted pairing when the backend is reachable from the browser over HTTPS/WSS. This includes a backend behind a trusted HTTPS tunnel or another HTTPS endpoint you operate.

Do not use hosted pairing for plain HTTP LAN URLs such as `http://192.168.x.y:3773`. Browsers block an HTTPS page from connecting to an insecure HTTP or WS backend. For those endpoints, use the direct pairing URL shown by the desktop app or CLI from a client that can open that HTTP URL directly.

Hosted pairing does not proxy traffic through Kata Code. The browser still connects directly to the backend URL in the pairing link.

## Managing Access Later

Use `katacode auth` to manage access after the initial pairing flow.

Typical uses:

- issue additional pairing credentials
- inspect active sessions
- revoke old pairing links or sessions

Use `katacode auth --help` and the nested subcommand help pages for the full reference.

### Deregister a Kata Code Connect Environment

Open your account menu and choose **Kata Code Connect** to see every environment registered to your
account. On mobile, open **Settings** → **Kata Code Connect**. Choose **Deregister** to revoke an
environment's Kata Code Connect access, remove any managed tunnel, and free its host space.

Deregistration is an account action and does not need a connection to the environment, so it also
works for a server that was wiped or is no longer reachable. Device-local connect and disconnect
controls remain in **Settings** → **Connections** on web and desktop or **Settings** →
**Environments** on mobile.

## Security Notes

- Treat pairing URLs and pairing tokens like passwords.
- Prefer binding `--host` to a trusted private address, such as a Tailnet IP, instead of exposing the server broadly.
- Anyone with a valid pairing credential can create a session until that credential expires or is revoked.
- Hosted pairing links keep the credential in the URL hash so it is not sent to the hosted app server, but it can still be exposed through browser history, screenshots, logs, or copy/paste.
- Use `katacode auth` to revoke credentials or sessions you no longer trust.
