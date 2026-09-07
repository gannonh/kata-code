# Verify private GitHub sandbox selection

For maintainers. Product behavior is in [Docker sandboxes](../user/docker-sandboxes.md).

## Focused tests

From a worktree with `vp` on `PATH`:

```bash
vp test run \
  apps/server/src/kataSandbox/SandboxGitHubAccess.test.ts \
  apps/server/src/sourceControl/GitHubCli.test.ts \
  apps/server/src/kataSandbox/SandboxDeploymentService.test.ts \
  apps/web/src/features/kataSandbox/SandboxGitHubSourcePicker.logic.test.ts \
  apps/web/src/features/kataSandbox/DeploymentSettings.test.tsx \
  packages/kata-sandbox-contracts/src/http.github.test.ts \
  packages/kata-sandbox-docker/src/driver.test.ts \
  packages/kata-sandbox-docker/src/engine.test.ts \
  apps/server/src/kataSandbox/DockerSandboxE2E.test.ts
```

`DockerSandboxE2E.test.ts` skips unless `KATACODE_DOCKER_E2E=1` and the private-repository fixture env vars are set. Do not print `gh auth token` output.

## Browser picker

1. Launch an isolated stack with `.agents/skills/verify-katacode/bin/launch`.
2. Pair with the startup admin URL.
3. Turn on Settings → General → Sandboxes (preview).
4. Open Settings → Connections → Add environment → Sandboxes → Docker.
5. Open GitHub repository.

Before `ec6ea5348` (#190 / KAT-3295) the picker request was `GET /api/kata-sandbox/github/repositories%3Fpage=1` and returned 404. On current main the client requests `GET /api/kata-sandbox/github/repositories?page=1` and returns metadata-only pages with `Cache-Control: no-store`. `DeploymentSettings.test.tsx` locks the unencoded query contract when `window` is present.

## Guarded Docker checkout

Requires group access to `/var/run/docker.sock` and an owned private repository. Reuse the original [Build report](https://github.com/gannonh/kata-code/issues/171#issuecomment-5488665020) when the driver path is unchanged. Combine SQLite, receipt, inspect, and log absence checks in one isolated home. Never snapshot a real token.
