# Docker sandboxes

Docker sandboxes run a separate Kata Code environment for a GitHub repository and ref.

## Create a sandbox

1. Open Settings → Connections and select Add environment on the Kata host
   (the desktop app or the locally hosted web app). Remote clients over Connect
   or a tunnel cannot reach the sandbox pairing port.
2. Select Sandboxes → Local Container → Docker.
3. Reuse an available Docker profile or select Add Docker profile.
4. Enter a deployment label, select a GitHub repository and branch, and choose a Codex provider.
   Use the Git ref field for a tag or explicit ref such as `refs/pull/123/head`.
5. Select Create and attach environment.

Kata resolves the matching managed image to an immutable OCI digest, pulls it when Docker does not
have it, validates the image, creates the container, and attaches it through ordinary environment
onboarding. Profile progress shows image resolution, pull, validation, and bounded download and
layer counts. A failed profile remains visible with its diagnostic and can be retried.

Profiles use the Docker Unix socket available to the Kata Code server. The default is
`/var/run/docker.sock`. Docker must support `linux/amd64` or `linux/arm64`.

Repository and branch choices come from the GitHub CLI session on the Kata Code server. Run
`gh auth login` on that host before creating a sandbox. Repositories available to that account,
including private repositories and organization repositories, appear in the picker. Kata resolves
the selected ref to an exact commit before it creates the container.

Private checkout credentials stay on the server and never enter browser requests or saved sandbox
configuration. During checkout, Kata streams a short-lived credential through Docker exec stdin
into a mode-0600 file in container memory. Kata removes the file after Git verifies the exact
commit. Treat the local Docker daemon and anyone who can access its socket as trusted. Remote or
untrusted Docker daemons are not supported for private repository checkout.

The managed image uses the control-server version. Stable releases use the exact version tag.
Nightly releases use the matching nightly tag. The public GHCR repository contains one OCI index for
both platforms. Docker selects the host platform. Vercel Sandbox uses the same image published to
VCR. The default repository is `ghcr.io/gannonh/kata-sandbox`; deployments using another registry
set `KATACODE_SANDBOX_IMAGE_REPOSITORY` to that full repository name.

If a managed profile reports an OCI `401`, check the server version and image repository. Current
releases pull anonymously from GHCR. An older server or a
`KATACODE_SANDBOX_IMAGE_REPOSITORY` override can still point at a registry that requires
credentials.

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

To test an unreleased development build, write the builder result to a file:

```bash
node packages/kata-sandbox-docker/scripts/build-image.mjs \
  --output-file /tmp/kata-sandbox-dev-image.json
```

Copy `serverArtifactSha256`, `codexVersion`, and `codexArtifactSha256` from that file into the
development server environment:

```dotenv
KATACODE_SANDBOX_SERVER_ARTIFACT_SHA256=<serverArtifactSha256>
KATACODE_SANDBOX_CODEX_VERSION=<codexVersion>
KATACODE_SANDBOX_CODEX_ARTIFACT_SHA256=<codexArtifactSha256>
```

Restart the development server so it loads those values. Create the Docker profile with Advanced
enabled and paste the result's `imageId` into the custom image field. Managed images only resolve
published release tags, so an unreleased `dev:desktop` version requires this override.

The source manifest pins the Node base image digest and the exact Codex package and npm integrity.
The builder verifies both values before Docker work. The image contains Node 24, Git, GitHub CLI,
native build tools, the Kata CLI, the Codex CLI, and the bootstrap verifier. It creates writable
`HOME=/home/katacode` and `KATACODE_HOME=/var/lib/katacode` directories for the runtime user.

## Manage sandboxes

Connections lists saved profiles and deployments separately from saved client environments.
Unavailable profiles remain visible with a daemon, image, or configuration diagnostic. Retry
validation after fixing Docker or the image.

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

Kata Code copies only the selected Codex `auth.json` and the short-lived GitHub checkout credential
needed for the selected source into the sandbox. The GitHub credential is removed after checkout.
The sandbox receives no provider credentials for other providers. Other host credentials,
repository data, and mutable package installs are excluded from the image.
