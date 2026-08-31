# Docker sandboxes

Docker sandboxes let you run a separate Kata Code environment for a GitHub repository and ref.
Configure them from Settings → Connections → Docker sandboxes.

Create a profile with:

- a profile name;
- the Docker Unix socket available to the Kata Code server; and
- an immutable image reference with a `sha256` digest.

The profile stays visible when Docker or the image is unavailable. The diagnostic identifies whether
the daemon, image, or profile configuration needs attention.

The image must be built or published with an immutable digest. For local verification, build the
repo-owned image with the Docker package:

```bash
KATACODE_SANDBOX_BASE_IMAGE=ghcr.io/example/base@sha256:<digest> \
KATACODE_SANDBOX_CODEX_TARBALL=/path/to/codex.tgz \
vp run --filter @kata-sh/code-kata-sandbox-docker build:image
```

The command prints an immutable registry digest when Docker provides one. A local build without a
registry association prints its bare `sha256:<config digest>` image ID. It also prints the three
`KATACODE_SANDBOX_*` values required by the control server. The base image must provide Node 24,
Git, GitHub CLI, and the native build tools used by current Kata dependencies.

Create a deployment by selecting an available profile, entering a GitHub repository and ref, and
selecting a Codex provider instance. Kata Code resolves the ref to a commit before creating the
container. The container checks its immutable bootstrap manifest, uses `/workspace` for the checked
out repository, and stores its runtime state under `/var/lib/katacode`.

The deployment list shows the durable lifecycle state and the latest provider observation. Use Stop
and Start to control the same container. Start uses the stored workspace, source locator, resolved
commit, bootstrap manifest, and Kata home. It does not resolve the Git ref again. A stopped deployment
keeps its environment ID and client registrations; connection supervisors show it as disconnected
until the container starts.

Choose Direct or Relay for every attachment. Direct creates a one-use bearer pairing URL for the
container endpoint. Relay links the sandbox through the configured Kata Code Connect account and
returns an ordinary relay registration. The handoff expires after five minutes. Use Attach direct or
Attach relay again when a handoff expires or a client loses the response. Web and mobile clients can
then discover the environment, add a project, and use it through their normal connection flows.

Delete a deployment from the same list when its work is complete. Provider Delete unlinks the
sandbox's Connect record, removes the owned Docker container, confirms `Gone`, and writes a durable
deleted record. Client Remove only clears an environment from the current client and leaves the
Docker deployment in place. A second administrative client can perform Stop, Start, attachment
retry, and Delete. Standard or read-only clients cannot perform those operations.

A `Stopped` observation means Docker confirmed the owned container is not running. `Unknown` means
Kata Code could not prove the Docker state, so the deployment, environment ID, registrations, last
observation, and exact resource handle remain stored. A successful absence observation or confirmed
Delete produces `Gone`; an outage never does. Allocated deployments can be deleted after Docker
returns. Disabled profiles retain their deployments and can be re-enabled after the daemon or image
is fixed.

Kata Code copies only the selected Codex `auth.json` into the sandbox. The sandbox receives no
provider credentials for other providers.
