# Kata Sandbox

Kata Sandbox creates a Docker-hosted Kata environment from the control server. The feature keeps
deployment facts, Docker observations, operation receipts, and client attachment separate.

## Deployment

`SandboxDeployment` is the durable control-server record. It moves through these states:

- `Requested` records the profile snapshot, provider instance, source locator, resolved commit SHA,
  bootstrap manifest, workspace path, and Kata home before Docker allocation.
- `Allocated` records the exact owned Docker container. Docker assigns the ephemeral host port
  when the container starts, and `Identified` stores that completed resource handle.
- `Identified` records the target environment ID, endpoint, workspace root, and identification time.
- `Deleted` records a tombstone after Docker reports that the owned container is gone.

The deployment service writes each state through the Kata-owned SQLite repository. Revision checks
protect transitions and profile replacements from stale writes.

## Provider observations

`ProviderObservation` records the latest Docker check for an allocated or identified deployment:

- `Running` means Docker returned an owned running container.
- `Unknown` means the service could not prove the current state.
- `Gone` means Docker returned an authoritative missing-container result.

The service keeps an allocated resource in `Unknown` state so a later delete or recovery pass can
inspect the same container. It writes a deletion tombstone only after it observes `Gone`.

## Operation receipts

HTTP commands return `202 Accepted` with a `SandboxOperationId`. The receipt stores the caller,
request ID, payload hash, command status, result, and redacted error. A unique caller and request ID
pair makes retries idempotent. Reusing a request ID with a different payload returns a conflict.

Create resolves the GitHub source to an exact commit before it accepts the operation. The Docker
driver checks out that SHA in `/workspace`. The target server uses `/var/lib/katacode` for its state.

## Attachment

The control server stores a per-deployment bootstrap seed in `ServerSecretStore`. It exchanges that
seed with the target server and asks the target to issue a one-use pairing credential. The handoff
response contains the pairing URL and `Cache-Control: no-store`; the credential does not enter a
Sandbox table or operation receipt. Existing onboarding consumes the URL as an ordinary bearer
registration.

The Docker driver copies only the selected Codex `auth.json` into `/home/katacode/.codex`. It does
not mount host credential directories into the container.
