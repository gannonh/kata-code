# Remote access

Connect a phone, browser, or another desktop app to Kata Code running on a different
machine. That machine must stay running and reachable while you work.

## Kata Code Connect

Kata Code Connect makes an environment available to your other devices without setting
up router forwarding. In the desktop app on the host, open **Settings →
Connections**, sign in, and enable **Kata Code Connect** for that environment.

For a command-line host, run:

```bash
npx @kata-sh/code-cli@latest connect
```

Follow the sign-in instructions. Setup offers a
[background service](./background-service.md); if you decline it, start the
server with `npx @kata-sh/code-cli serve`. Saving your sign-in alone does not make the machine
reachable.

On your other device, sign in to the same Kata Code Connect account and choose the
environment. Over SSH, the CLI prints a browser link and accepts the returned
authorization code, so you do not need to forward an OAuth callback port.

Kata Code Connect renews access credentials when needed without disconnecting a healthy
connection. Pull request diffs and provider settings keep working after the
previous credential expires. A failed renewal affects that request; it does not
disconnect an otherwise healthy conversation.

## Pair over a LAN or private network

Use direct pairing when the other device can reach the host's network address.

On a desktop host, open **Settings → Connections**, enable **Network access**,
then create a pairing link using an address the other device can reach. Changing
network access restarts the desktop app. You can turn it off in the same place.

For a command-line host, replace `<private-ip>` with the host's LAN or tailnet
address:

```bash
npx @kata-sh/code-cli serve --host <private-ip>
```

If a server is already running, generate a fresh link without restarting it:

```bash
npx @kata-sh/code-cli pair
```

Scan the QR code on your phone or paste the pairing URL into **Add environment**
in the receiving app. Connection settings are under **Settings → Connections**
on web and desktop and **Settings → Environments** on mobile. A loopback address
such as `127.0.0.1` reaches only the device opening the link.

Pairing authorizes that device for future connections. Use a fresh one-time link
for each new device; you do not need the original token to reconnect. Links
created in Settings can only be copied from the client that created them while
its Connections page stays open. If you leave or reload that page, create
another link to share.

### Balance new threads across machines

Auto balance is off by default. On web and desktop, enable it in
**Settings → Connections → Load balancing** to automatically choose a machine for
new threads in projects grouped across connected environments.
Each machine starts at **Normal**. Choose **Prefer** to favor it when it has CPU and
memory available, **Less often** to reduce its share, or **Manual only** to exclude
it from automatic selection. These are preferences, not fixed traffic percentages.
Preferences are saved separately in each client.

The composer checks eligible machines when choosing a draft's environment, then keeps
that choice stable. Choose **Auto balance** again to check current resources, or choose
a specific machine to override it. Choosing a branch or worktree also keeps the draft
on that machine. Existing threads stay where they started. If resource checks are
unavailable or all eligible machines are full, choose a machine manually to continue.
Mobile keeps its manual environment selection.

### Tailscale HTTPS

Join both devices to the same tailnet. In the desktop app, enable **Tailscale
HTTPS** in **Settings → Connections**. Turn it off there to remove that route.

To start a command-line server with Tailscale HTTPS:

```bash
npx @kata-sh/code-cli serve --tailscale-serve
```

For an already-running server:

```bash
npx @kata-sh/code-cli pair --tailscale
```

The pairing link uses an address such as `https://machine.tailnet.ts.net/`.
The mapping created by `pair --tailscale` persists across restarts. Remove its
default-port mapping with:

```bash
tailscale serve --https=443 off
```

If that port is already in use, choose another with
`--tailscale-serve-port`. See `npx @kata-sh/code-cli pair --help` for other pairing options.

### Hosted web app

[app.kata.sh](https://app.kata.sh) needs an HTTPS endpoint. It connects directly
to your server; a hosted pairing link does not make an unreachable backend
reachable or convert HTTP to HTTPS.

For a plain HTTP LAN endpoint, use the direct pairing URL in a browser that can
open it, or pair from the desktop app. On mobile, an IP address entered without a
scheme uses HTTP, so include `https://` when your server uses HTTPS.

## Desktop-managed SSH

In the desktop app, open **Settings → Connections → Add environment**, choose
**SSH**, and enter a host or SSH alias such as `user@example.com`. Kata Code starts
or reuses a server there and opens the port forward for you. Projects, provider
credentials, and agent work stay on the remote machine.

The remote host needs a compatible [Node.js installation](./install.md#requirements)
and [provider setup](./install.md#providers). If launch cannot find Node or reports
an incompatible version, check it through a non-interactive SSH session:

```bash
ssh user@example.com 'sh -lc "command -v node && node --version"'
```

Configure your version manager for non-interactive shells if this differs from
your normal terminal. With nvm, setting a compatible default, such as
`nvm alias default 24`, can resolve the problem.

If SSH reconnecting fails after an app update, retry the launch once. Removing
the connection stops a server that Kata Code launched; a server that was already
running is left alone.

For Antigravity's Google callback on a remote host, see
[remote sign-in](./providers-antigravity.md#sign-in-from-a-remote-device).

## Manage or revoke access

On the host, **Settings → Connections** lets authorized administrators create
pairing links and revoke client sessions. Revoking an unused link prevents new
pairings; revoke a device's session to remove its existing access. Command-line
management is available through `npx @kata-sh/code-cli auth --help`.

A session with an open connection stays listed after its access credential
expires.

To remove an environment from Kata Code Connect, open your account menu's **Kata Code Connect**
page, or **Settings → Kata Code Connect** on mobile, and choose **Deregister**. This
revokes its cloud access and frees its host space even when the environment is
offline or has been wiped.

On a command-line host, `katacode connect unlink` disables exposure while retaining
your login; `katacode connect logout` also clears that login. Background-service
[removal](./background-service.md#manage-the-service) is separate.

Treat pairing URLs and authorization codes as passwords. Do not include them in
screenshots, logs, or bug reports.

## Kata Code Connect troubleshooting

Run `katacode connect status` on the host to inspect saved authorization and link
configuration. It is not a live reachability check. If the environment appears
offline, run `katacode service status` and read the displayed log. If it disappears
when SSH closes, see [background-service troubleshooting](./background-service.md#troubleshooting).

| Error                                                     | Recovery                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment_link_limit_exceeded` or managed tunnel limit | Deregister an unused environment, then restart Kata Code on the host.                                                                                         |
| `auth_invalid` or `invalid_bearer`                        | Run `katacode connect login`. If credentials were revoked, run `katacode connect logout`, then `katacode connect` again. Restart the server after signing in. |
| Expired or invalid link proof                             | Check the host's date and time, update Kata Code, then restart it.                                                                                            |
| HTTP 403 without a recognized error                       | Check relay access, proxies, and firewall rules. Keep any Cloudflare Ray ID for a bug report.                                                                 |
| HTTP 408, 429, or 5xx                                     | Check network and relay availability. Startup retries temporary failures for up to ten minutes.                                                               |

After fixing a permanent rejection, restart the host's server. On Linux, use
`systemctl --user restart t3code.service` for the background service. For a
foreground server, stop it and run `katacode serve` again with your usual options.
Include the diagnostic message and trace ID when reporting a persistent failure.

For a connection that still fails after linking, check the date and time on both
devices. For server version warnings, follow [Updating Kata Code](./updating.md).

## Test a second server on the same machine

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

## Connect a headless server through Kata Code Connect

On the headless machine, register the environment:

```bash
npx @kata-sh/code-cli@nightly connect link --headless
```

Approve the managed relay-client installation when prompted. Then open the printed URL on a device
with a browser, sign in, and paste the authorization code back into the terminal. Start the server
with the same package channel and data directory:

```bash
npx @kata-sh/code-cli@latest serve
# or to release the terminal
setsid npx --yes @kata-sh/code-cli@nightly serve </dev/null >kata-serve.log 2>&1 &
```

Kata Code Connect supplies the tunnel, so this flow does not require `--host 0.0.0.0` or an open
inbound firewall port. In the desktop app, sign in with the same Kata Code Connect account, open
**Settings** → **Connections**, find the environment under **Remote environments**, and click
**Connect**.

If you pass `--base-dir` to `connect link`, pass the same value to `serve`. Use `@nightly` for both
commands when the desktop app runs Nightly.

## Run on a Fly Sprite

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

`release` stops the `katacode` service, then deletes the `kata-session` task so Fly can suspend the
Sprite. Stopping the service takes Kata Code and its Connect tunnel offline immediately, which
disconnects clients. The Sprite, files, service definition, environment, and Connect authorization
persist. Run `wake` to restart the server and register fresh tunnel connections.

## Fix a Connect account mismatch

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
