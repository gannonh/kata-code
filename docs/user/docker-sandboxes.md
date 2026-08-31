# Docker sandboxes

Docker sandboxes run a separate Kata Code environment for a GitHub repository and ref.

## Create a sandbox

1. Open Settings → Connections and select Add environment.
2. Select Sandboxes → Local Container → Docker.
3. Reuse an available Docker profile or select Add Docker profile.
4. Enter a deployment label, public GitHub repository and ref, and Codex provider.
5. Select Create and attach environment.

Kata resolves the matching managed image to an immutable VCR digest, pulls it when Docker does not
have it, validates the image, creates the container, and attaches it through ordinary environment
onboarding. Profile progress shows image resolution, pull, validation, and bounded download and
layer counts. A failed profile remains visible with its diagnostic and can be retried.

Profiles use the Docker Unix socket available to the Kata Code server. The default is
`/var/run/docker.sock`. Docker must support `linux/amd64` or `linux/arm64`.

The managed image uses the control-server version. Stable releases use the exact version tag.
Nightly releases use the matching nightly tag. The public VCR repository contains one OCI index for
both platforms. Docker selects the host platform. Vercel Sandbox uses the prepared `linux/amd64`
manifest. The default repository is `vcr.vercel.com/kata-sh/kata-code/kata-sandbox`; deployments
using another VCR project set `KATACODE_SANDBOX_IMAGE_REPOSITORY` to that full repository name.

## Advanced image override

Leave the managed image selected for normal use. Development profiles can provide an immutable
custom image under Advanced. Use a repository digest such as
`registry.example.com/team/image@sha256:<64 hex characters>` or a local Docker image ID in the form
`sha256:<64 hex characters>`. Mutable tags are rejected and are never stored.

The image builder reads the checked-in source manifest. Run it without image or Codex environment
variables:

```bash
vp run --filter @kata-sh/code-kata-sandbox-docker build:image
```

The source manifest pins the Node base image digest and the exact Codex package and npm integrity.
The builder verifies both values before Docker work. The image contains Node 24, Git, GitHub CLI,
native build tools, the Kata CLI, the Codex CLI, and the bootstrap verifier. It creates writable
`HOME=/home/katacode` and `KATACODE_HOME=/var/lib/katacode` directories for the runtime user.

## Manage sandboxes

Connections lists saved profiles and deployments separately from saved client environments.
Unavailable profiles remain visible with a daemon, image, or configuration diagnostic. Retry
validation after fixing Docker or the image.

- Provider Delete removes the owned Docker container and records the deployment deletion.
- Client Remove removes only the environment registration from the current client.
- Attach environment mints a one-use credential that expires after five minutes. Retry Attach when
  the handoff expires or the client loses the response.

Kata copies only the selected Codex `auth.json` into the sandbox. Other provider credentials,
host credentials, repository data, and mutable package installs are excluded from the image.
