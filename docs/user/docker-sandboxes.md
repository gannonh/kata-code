# Docker sandboxes

Docker sandboxes run a separate Kata Code environment for a GitHub repository and ref.

The feature is a preview and is off by default. An administrative session turns
it on with **Sandboxes (preview)** under Experimental in Settings → General.
The next request picks up the change. No restart is required. `KATACODE_SANDBOXES=1` or `=0` on
the server process overrides the stored switch for that process. With the
switch off, sandbox routes, Connections, and Add Environment hide the feature.
Existing deployments stay in the database.

A stock install creates a sandbox from the managed image for the running server
version. No environment variables, digest, or local image build are required.

## Create a sandbox

1. Turn on Sandboxes (preview) under Experimental in Settings → General, or start the server with
   `KATACODE_SANDBOXES=1`.
2. Open Settings → Connections and select Add environment on the Kata host
   (the desktop app or the locally hosted web app). Remote clients over Connect
   or a tunnel cannot reach the sandbox pairing port.
3. Select Sandboxes → Local Container → Docker.
4. Select a GitHub repository and branch, then choose a Codex provider instance.
   Leave the optional label blank to use the repository name.
5. If needed, expand Advanced to enter a manual ref, Docker socket path, or custom immutable image.
6. Select Create sandbox.

The form shows image resolution, download percentage and sizes, validation, container creation,
source checkout, and server startup with elapsed time. Kata saves the operation before image
preparation begins. You can close the dialog or reload the page while creation continues.
Reopen Add environment to resume. If several sandboxes need attention, select one from
Continue a sandbox. A completed sandbox offers Open sandbox, including when pairing or navigation
was interrupted.

Kata imports the ordinary pairing handoff, opens the repository at `/workspace` as a project,
and starts a new thread. Reopening the same sandbox reuses its project. Profiles are configured
automatically and reused when their socket and image match.

If the connection drops, the dialog shows Reconnecting while the server continues. Authorization
loss or a missing operation shows a diagnostic and a Refresh operation action. No browser
observation timeout cancels the server create operation.

### Recover a failed create

A failed create shows the stage and a redacted diagnostic.

- Select Try again to resume a retained container. If cleanup confirmed that the container is
  absent, Kata links a replacement attempt using the original resolved commit.
- If cleanup is uncertain, select Reconcile sandbox to check Docker before retrying. Kata does
  not allocate a replacement until it confirms the previous resource is absent.
- Select Discard sandbox to delete it. Confirm discard before Kata removes the container.

If creation succeeded but attachment failed, select Open sandbox to continue pairing and project
setup. This action does not allocate another container.

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

If image preparation reports an OCI `401`, check the server version and image repository. Current
releases pull anonymously from GHCR. An older server or a
`KATACODE_SANDBOX_IMAGE_REPOSITORY` override can still point at a registry that requires
credentials.

## Advanced image override

Leave the managed image selected for normal use. You can provide an immutable custom image under Advanced. Use a repository digest such as
`registry.example.com/team/image@sha256:<64 hex characters>` or a local Docker image ID in the form
`sha256:<64 hex characters>`. Mutable tags are rejected and are never stored.

The image stamps Kata version, server artifact SHA-256, and Codex version and
digest as OCI labels. Create reads those labels from the image. Managed images
only resolve published release tags, so an unreleased server version requires the Advanced override.

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
