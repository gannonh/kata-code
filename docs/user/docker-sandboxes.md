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

The deployment list shows the durable lifecycle state and the latest provider observation. An
identified deployment can be attached through the ordinary environment onboarding flow. Each attach
request creates a new one-use credential that expires after five minutes. Use Attach environment
again when the first handoff expires or the browser loses the response.

Delete a deployment from the same list when its work is complete. Provider Delete removes the owned
Docker container and writes a durable deletion record. Client Remove only clears an environment from
the current client and leaves the Docker deployment in place.

An `Unknown` observation means Kata Code could not prove the Docker state. For an allocated
deployment, Delete deployment retries cleanup after the daemon is available. For an identified
deployment, Attach environment rechecks that the container is running. The deployment and its exact
resource handle remain stored for recovery. Disabled profiles retain their deployments and can be
re-enabled after the daemon or image is fixed.

Kata Code copies only the selected Codex `auth.json` into the sandbox. The sandbox receives no
provider credentials for other providers.
