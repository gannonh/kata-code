import { request } from "node:http";
import {
  assertDockerDaemonReachable,
  assertKatacodeImageBuilt,
  readDockerSocketPath,
} from "../../src/harness/env.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import {
  authorizeConnectCli,
  extractConnectEnvironmentId,
  registerConnectEnvironmentCleanup,
  withConnectBrowser,
} from "../../src/flows/connect.ts";
import {
  addContainerEnvironment,
  deploymentTargetCard,
  openConnectionsSettings,
} from "../../src/flows/settings.ts";
import { dismissBlockingToasts } from "../../src/flows/navigation.ts";
import { deleteSandboxDeploymentTarget } from "../../src/flows/sandboxDeployment.ts";
import { createOrOpenProject, createSeededGitWorkspace } from "../../src/flows/workspace.ts";
import type { E2ERunContext } from "../../src/harness/isolatedRun.ts";
import { expect, resetAppToHome, test } from "../../src/harness/testFixtures.ts";

/**
 * Container sandbox environment — provisions the real `katacode:local` image
 * (built by `pnpm run build:docker-image`) running `katacode serve`, then
 * verifies the in-container Kata server boots and is reachable over loopback
 * (AC-1.10: server boots container-side; the full agent-turn slice needs a
 * paired model provider and is recorded as a manual UAT per the spec's
 * two-client rule).
 */

/** Authorize Connect CLI before creating a sandbox environment. */
async function authorizeConnect(runContext: E2ERunContext): Promise<void> {
  await withConnectBrowser((connectPage) => authorizeConnectCli(runContext, connectPage));
}

/** Register per-environment Connect cleanup once Session ready exposes the id. */
function registerConnectEnvironmentTeardown(
  runContext: E2ERunContext,
  sessionText: string | null,
): void {
  const environmentId = extractConnectEnvironmentId(sessionText);
  if (!environmentId) {
    throw new Error(
      `session text did not expose the Connect environment id: ${sessionText ?? "(empty)"}`,
    );
  }
  registerConnectEnvironmentCleanup(runContext, environmentId);
}

/** Resolve the host port from a loopback httpBaseUrl like `http://localhost:32789`. */
function parseHostPort(httpBaseUrl: string): number {
  const port = Number(new URL(httpBaseUrl).port);
  if (!Number.isFinite(port) || port === 0) {
    throw new Error(`Could not parse host port from session httpBaseUrl: ${httpBaseUrl}`);
  }
  return port;
}

/** Probe the provisioned container's /healthz over the published loopback port. */
async function probeContainerHealth(hostPort: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port: hostPort, path: "/healthz", method: "GET", timeout: 5_000 },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", (error) => reject(new Error(`healthz probe failed: ${error.message}`)));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`healthz probe timed out on port ${hostPort}`));
    });
    req.end();
  });
}

interface DockerResponse {
  readonly statusCode: number;
  readonly body: Buffer;
}

interface DockerContainerSummary {
  readonly Id: string;
  readonly Created?: number;
  readonly State?: string;
}

interface DockerExecCreateResponse {
  readonly Id: string;
}

interface DockerExecInspectResponse {
  readonly ExitCode?: number | null;
}

interface DockerExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function dockerEngineRequest(
  path: string,
  input: {
    readonly method?: "GET" | "POST" | "DELETE";
    readonly body?: unknown;
    readonly timeoutMs?: number;
  } = {},
): Promise<DockerResponse> {
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  return new Promise<DockerResponse>((resolve, reject) => {
    const req = request(
      {
        socketPath: readDockerSocketPath(),
        path,
        method: input.method ?? "GET",
        timeout: input.timeoutMs ?? 5_000,
        headers:
          body === undefined
            ? undefined
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("error", (error) =>
      reject(new Error(`Docker request ${path} failed: ${error.message}`)),
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Docker request ${path} timed out`));
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function parseDockerJson<T>(response: DockerResponse, phase: string): T {
  if (response.statusCode >= 300) {
    throw new Error(
      `${phase} failed with ${response.statusCode}: ${response.body.toString("utf8").slice(0, 400)}`,
    );
  }
  return JSON.parse(response.body.toString("utf8")) as T;
}

function demultiplexExecStream(buffer: Buffer): {
  readonly stdout: string;
  readonly stderr: string;
} {
  let stdout = "";
  let stderr = "";
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    const payloadLength = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + payloadLength > buffer.length) break;
    const chunk = buffer.subarray(offset, offset + payloadLength).toString("utf8");
    offset += payloadLength;
    if (streamType === 1) stdout += chunk;
    else if (streamType === 2) stderr += chunk;
  }
  return { stdout, stderr };
}

async function findSandboxContainerId(instanceId: string): Promise<string | undefined> {
  const filters = encodeURIComponent(
    JSON.stringify({ label: [`kata.sandbox.instance=${instanceId}`] }),
  );
  const response = await dockerEngineRequest(`/containers/json?all=true&filters=${filters}`);
  const containers = parseDockerJson<ReadonlyArray<DockerContainerSummary>>(
    response,
    "container lookup",
  );
  return [...containers]
    .filter((container) => container.State === "running")
    .sort((left, right) => (right.Created ?? 0) - (left.Created ?? 0))[0]?.Id;
}

/** Resolve the Docker container state for a sandbox instance (running/exited/…),
 *  state-insensitive so the stop/start lifecycle test can assert stopped vs
 *  running. Returns undefined when no container matches the instance label. */
async function findSandboxContainerState(
  instanceId: string,
): Promise<{ readonly Id: string; readonly State: string } | undefined> {
  const filters = encodeURIComponent(
    JSON.stringify({ label: [`kata.sandbox.instance=${instanceId}`] }),
  );
  const response = await dockerEngineRequest(`/containers/json?all=true&filters=${filters}`);
  const containers = parseDockerJson<ReadonlyArray<DockerContainerSummary>>(
    response,
    "container state lookup",
  );
  return [...containers].sort((left, right) => (right.Created ?? 0) - (left.Created ?? 0))[0];
}

async function execInContainer(containerId: string, command: string): Promise<DockerExecResult> {
  const create = parseDockerJson<DockerExecCreateResponse>(
    await dockerEngineRequest(`/containers/${containerId}/exec`, {
      method: "POST",
      body: {
        Cmd: ["sh", "-c", command],
        AttachStdout: true,
        AttachStderr: true,
      },
    }),
    "exec create",
  );

  const start = await dockerEngineRequest(`/exec/${create.Id}/start`, {
    method: "POST",
    body: { Detach: false, Tty: false },
    timeoutMs: 10_000,
  });
  if (start.statusCode >= 300) {
    throw new Error(`exec start failed with ${start.statusCode}: ${start.body.toString("utf8")}`);
  }
  const output = demultiplexExecStream(start.body);
  const inspect = parseDockerJson<DockerExecInspectResponse>(
    await dockerEngineRequest(`/exec/${create.Id}/json`),
    "exec inspect",
  );

  return {
    exitCode: inspect.ExitCode ?? -1,
    stdout: output.stdout,
    stderr: output.stderr,
  };
}

const REAL_IMAGE_E2E_TIMEOUT_MS = Math.max(E2E_TIMEOUTS.agentTestMs, 240_000);

/** Instance ids owned by this spec. Containers are global while each run's
 *  KATACODE_HOME is fresh, so a container left by an aborted run would be
 *  adopted by the next provision with a mismatched bootstrap token. */
const E2E_DOCKER_INSTANCE_IDS = [
  "docker_e2e_phase2",
  "docker_e2e_phase3a",
  "docker_e2e_lifecycle",
] as const;

async function removeStaleSandboxContainers(): Promise<void> {
  for (const instanceId of E2E_DOCKER_INSTANCE_IDS) {
    const filters = encodeURIComponent(
      JSON.stringify({ label: [`kata.sandbox.instance=${instanceId}`] }),
    );
    const response = await dockerEngineRequest(`/containers/json?all=true&filters=${filters}`);
    const containers = parseDockerJson<ReadonlyArray<DockerContainerSummary>>(
      response,
      "stale container lookup",
    );
    for (const container of containers) {
      const removal = await dockerEngineRequest(`/containers/${container.Id}?force=true`, {
        method: "DELETE",
        timeoutMs: 30_000,
      });
      // 404 = already gone (idempotent success).
      if (removal.statusCode >= 300 && removal.statusCode !== 404) {
        throw new Error(
          `Could not remove stale sandbox container ${container.Id} for ${instanceId}: ${removal.statusCode}`,
        );
      }
    }
  }
}

test.describe(`Environments/deployments container target ${E2E_TAGS.environmentsDeploy}`, () => {
  test.describe.configure({ timeout: REAL_IMAGE_E2E_TIMEOUT_MS });

  test.beforeAll(async () => {
    // Check the shared prerequisites before launching Electron. The running app
    // also reconciles Docker targets, which can briefly contend for the Engine API.
    await assertDockerDaemonReachable();
    await assertKatacodeImageBuilt();
    // Remove containers left by aborted prior runs. Each E2E run gets a fresh
    // KATACODE_HOME (no session store), but containers are global: provision
    // would adopt a leftover container whose create-time bootstrap token no
    // longer matches anything, failing Connect registration.
    await removeStaleSandboxContainers();
  });

  test.beforeEach(async ({ authenticatedAppWindow }) => {
    await resetAppToHome(authenticatedAppWindow);
  });

  test(
    "add sandbox environment, test connection + start session boot the real katacode image",
    { tag: [E2E_TAGS.environmentsDeploy, E2E_TAGS.sandbox] },
    async ({ authenticatedAppWindow, runContext }, testInfo) => {
      const page = authenticatedAppWindow;
      await openConnectionsSettings(page);
      await dismissBlockingToasts(page);

      const card = await addContainerEnvironment(page, "E2E Smoke");
      await expect(card.getByText("available")).toBeVisible({ timeout: E2E_TIMEOUTS.authMs });

      // Expand the card to reach the config + Test connection controls.
      await card.getByRole("button", { name: /Toggle .* details/ }).click();

      // Test connection: validate -> provision -> dispose -> done, all ok. The
      // provision step boots the real katacode image and waits for /healthz, so
      // `provision: ok` proves the in-container server reached readiness.
      await card.getByRole("button", { name: "Test connection" }).click();
      const progress = card.locator("pre");
      await expect(progress).toContainText("validate: ok", { timeout: E2E_TIMEOUTS.agentReplyMs });
      await expect(progress).toContainText("provision: ok", { timeout: E2E_TIMEOUTS.agentReplyMs });
      await expect(progress).toContainText("dispose: ok", { timeout: E2E_TIMEOUTS.agentReplyMs });
      await expect(progress).toContainText("done: ok", { timeout: E2E_TIMEOUTS.agentReplyMs });

      await authorizeConnect(runContext);

      // Start session (AC-1.10): provision the real katacode image, auto-register
      // with Connect using the signed-in app user's Clerk relay token, and surface
      // the loopback endpoint + environmentId. The primary action is state-driven:
      // no sandbox -> "Create & run sandbox" (AC-L11).
      await dismissBlockingToasts(page);
      await card.getByRole("button", { name: "Create & run sandbox" }).click();
      const sessionLine = card.getByText(/Session ready:/);
      await expect(sessionLine).toBeVisible({ timeout: E2E_TIMEOUTS.agentReplyMs });
      await sessionLine.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("session-ready.png"), fullPage: true });

      // Extract the published loopback URL and verify the in-container Kata
      // server answers over it — the loopback reachability half of AC-1.10.
      const sessionText = await sessionLine.textContent();
      registerConnectEnvironmentTeardown(runContext, sessionText);
      const httpBaseUrlMatch = sessionText?.match(/http:\/\/localhost:\d+/);
      expect(
        httpBaseUrlMatch,
        `session text did not expose a loopback URL: ${sessionText}`,
      ).not.toBeNull();
      const hostPort = parseHostPort(httpBaseUrlMatch![0]);
      const healthStatus = await probeContainerHealth(hostPort);
      expect(healthStatus).toBe(200);

      // Stop the running sandbox, then delete it. The durable lifecycle exposes
      // Stop (running) then Delete sandbox (stopped) instead of the old Dispose
      // (AC-L8/L9). The session line disappears once the sandbox is deleted.
      await dismissBlockingToasts(page);
      await card.getByRole("button", { name: "Stop" }).last().click();
      await card.getByRole("button", { name: "Delete sandbox", exact: true }).click();
      await expect(sessionLine).toBeHidden({ timeout: E2E_TIMEOUTS.agentReplyMs });

      // Clean up the target via the trash button on the card row.
      await deleteSandboxDeploymentTarget(page, "E2E Smoke");
    },
  );

  test(
    "saved repo environment seeds, injects secrets, and launches setup processes",
    { tag: [E2E_TAGS.environmentsDeploy, E2E_TAGS.sandbox] },
    async ({ authenticatedAppWindow, runContext }, testInfo) => {
      const page = authenticatedAppWindow;
      const secret = `**************${Date.now()}`;
      const workspacePath = await createSeededGitWorkspace(runContext, {
        name: "phase2-env",
        remoteUrl: "https://github.com/kata-sh/e2e-phase2.git",
        files: {
          "package.json": '{"name":"e2e-phase2-env","scripts":{"test":"echo ok"}}',
          "e2e-seed.txt": "seed ok\n",
          ".kata/environment.json": JSON.stringify(
            {
              install:
                'sh -c \'test -f /workspace/e2e-seed.txt && printf install-from-repo > /tmp/kata-phase2-install.txt && printf "%s" "$KATA_E2E_SECRET" > /tmp/kata-phase2-secret.txt\'',
              start: "sh -c 'sleep 300'",
              terminals: [{ name: "worker", command: "sh -c 'sleep 301'" }],
            },
            null,
            2,
          ),
        },
      });

      await openConnectionsSettings(page);
      await dismissBlockingToasts(page);

      await addContainerEnvironment(page, "E2E Phase2");

      await createOrOpenProject(page, workspacePath);
      await openConnectionsSettings(page);
      await dismissBlockingToasts(page);

      const card = deploymentTargetCard(page, "E2E Phase2");
      await expect(card).toBeVisible({ timeout: E2E_TIMEOUTS.authMs });
      await card.getByRole("button", { name: /Toggle .* details/ }).click();

      const editor = card.getByTestId("saved-environment-editor");
      await expect(editor).toBeVisible({ timeout: E2E_TIMEOUTS.assertionMs });
      await expect(editor.getByText("kata-sh/e2e-phase2")).toBeVisible({
        timeout: E2E_TIMEOUTS.authMs,
      });
      await editor.getByRole("combobox", { name: "Saved environment" }).click();
      await page.getByRole("option", { name: /github\.com\/kata-sh\/e2e-phase2/ }).click();

      await editor.getByRole("button", { name: "Add", exact: true }).click();
      await editor.getByLabel("Environment variable name 1").fill("KATA_E2E_SECRET");
      const secretInput = editor.getByLabel("Environment variable value 1");
      await secretInput.click();
      await page.keyboard.insertText(secret);
      await expect(secretInput).toHaveValue(secret);
      await secretInput.press("Enter");
      // Wait for the env-var value to be committed (saved state visible) before proceeding.
      await expect(editor.getByLabel("Environment variable value 1")).toHaveValue(secret);

      await authorizeConnect(runContext);

      await dismissBlockingToasts(page);
      await card.getByRole("button", { name: "Create & run sandbox" }).click();
      const sessionLine = card.getByText(/Session ready:/);
      await expect(sessionLine).toBeVisible({ timeout: E2E_TIMEOUTS.agentReplyMs });
      registerConnectEnvironmentTeardown(runContext, await sessionLine.textContent());

      // Assert secret redaction BEFORE capturing the screenshot so a regression
      // can't persist sensitive text into a CI artifact.
      const progress = card.locator("pre");
      await expect(progress).not.toContainText(secret);

      await page.screenshot({
        path: testInfo.outputPath("phase2-session-ready.png"),
        fullPage: true,
      });

      let containerId = "";
      await expect
        .poll(
          async () => {
            containerId = (await findSandboxContainerId("docker_e2e_phase2")) ?? "";
            return containerId;
          },
          { timeout: E2E_TIMEOUTS.agentReplyMs },
        )
        .not.toBe("");

      const installMarker = await execInContainer(containerId, "cat /tmp/kata-phase2-install.txt");
      expect(installMarker.exitCode).toBe(0);
      expect(installMarker.stdout).toBe("install-from-repo");

      const injectedSecret = await execInContainer(containerId, "cat /tmp/kata-phase2-secret.txt");
      expect(injectedSecret.exitCode).toBe(0);
      expect(injectedSecret.stdout).toBe(secret);

      const processList = await execInContainer(
        containerId,
        "ps -eo args | grep -E 'sleep 300|sleep 301' | grep -v grep",
      );
      expect(processList.exitCode).toBe(0);
      expect(processList.stdout).toContain("sleep 300");
      expect(processList.stdout).toContain("sleep 301");

      const workspaceSecretSearch = await execInContainer(
        containerId,
        `grep -R ${JSON.stringify(secret)} /workspace`,
      );
      expect(workspaceSecretSearch.exitCode).not.toBe(0);

      await dismissBlockingToasts(page);
      await card.getByRole("button", { name: "Stop" }).last().click();
      await card.getByRole("button", { name: "Delete sandbox", exact: true }).click();
      await expect(sessionLine).toBeHidden({ timeout: E2E_TIMEOUTS.agentReplyMs });

      await deleteSandboxDeploymentTarget(page, "E2E Phase2");
    },
  );

  test(
    "started sandbox has /bin/sh as SHELL and provider CLIs on PATH (AC-3a.1/2/3)",
    { tag: [E2E_TAGS.environmentsDeploy, E2E_TAGS.sandbox] },
    async ({ authenticatedAppWindow, runContext }, testInfo) => {
      const page = authenticatedAppWindow;
      await openConnectionsSettings(page);
      await dismissBlockingToasts(page);

      const card = await addContainerEnvironment(page, "E2E Phase3a");
      await card.getByRole("button", { name: /Toggle .* details/ }).click();

      await authorizeConnect(runContext);

      await dismissBlockingToasts(page);
      await card.getByRole("button", { name: "Create & run sandbox" }).click();
      const sessionLine = card.getByText(/Session ready:/);
      await expect(sessionLine).toBeVisible({ timeout: E2E_TIMEOUTS.agentReplyMs });
      registerConnectEnvironmentTeardown(runContext, await sessionLine.textContent());
      await page.screenshot({
        path: testInfo.outputPath("phase3a-session-ready.png"),
        fullPage: true,
      });

      let containerId = "";
      await expect
        .poll(
          async () => {
            containerId = (await findSandboxContainerId("docker_e2e_phase3a")) ?? "";
            return containerId;
          },
          { timeout: E2E_TIMEOUTS.agentReplyMs },
        )
        .not.toBe("");

      // AC-3a.2: SHELL=/bin/sh is set in the runtime stage and /bin/sh exists.
      const shellEnv = await execInContainer(containerId, 'printf "%s" "$SHELL"');
      expect(shellEnv.exitCode).toBe(0);
      expect(shellEnv.stdout).toBe("/bin/sh");

      const shExists = await execInContainer(containerId, "test -e /bin/sh && echo ok");
      expect(shExists.exitCode).toBe(0);
      expect(shExists.stdout.trim()).toBe("ok");

      // AC-3a.3: the in-container shell is interactive (echo runs).
      const echo = await execInContainer(containerId, "echo terminal-alive");
      expect(echo.exitCode).toBe(0);
      expect(echo.stdout.trim()).toBe("terminal-alive");

      // AC-3a.1: provider CLIs and git resolve on PATH inside the image.
      for (const binary of ["codex", "agent", "grok", "claude", "opencode", "pi", "git"]) {
        const probe = await execInContainer(containerId, `command -v ${binary}`);
        expect(probe.exitCode, `${binary} not on PATH in sandbox container: ${probe.stderr}`).toBe(
          0,
        );
      }

      await dismissBlockingToasts(page);
      await card.getByRole("button", { name: "Stop" }).last().click();
      await card.getByRole("button", { name: "Delete sandbox", exact: true }).click();
      await expect(sessionLine).toBeHidden({ timeout: E2E_TIMEOUTS.agentReplyMs });

      await deleteSandboxDeploymentTarget(page, "E2E Phase3a");
    },
  );

  test(
    "stop/start lifecycle preserves the container and its filesystem (AC-L5/L8)",
    { tag: [E2E_TAGS.environmentsDeploy, E2E_TAGS.sandbox] },
    async ({ authenticatedAppWindow, runContext }, testInfo) => {
      const page = authenticatedAppWindow;
      await openConnectionsSettings(page);
      await dismissBlockingToasts(page);

      const card = await addContainerEnvironment(page, "E2E Lifecycle");
      await card.getByRole("button", { name: /Toggle .* details/ }).click();

      await authorizeConnect(runContext);

      // Create & run the sandbox.
      await dismissBlockingToasts(page);
      await card.getByRole("button", { name: "Create & run sandbox" }).click();
      const sessionLine = card.getByText(/Session ready:/);
      await expect(sessionLine).toBeVisible({ timeout: E2E_TIMEOUTS.agentReplyMs });
      registerConnectEnvironmentTeardown(runContext, await sessionLine.textContent());

      const instanceId = "docker_e2e_lifecycle";
      let containerId = "";
      await expect
        .poll(
          async () => {
            containerId = (await findSandboxContainerId(instanceId)) ?? "";
            return containerId;
          },
          { timeout: E2E_TIMEOUTS.agentReplyMs },
        )
        .not.toBe("");

      // Write a marker file while running.
      const writeMarker = await execInContainer(
        containerId,
        "echo persisted > /tmp/lifecycle-marker.txt",
      );
      expect(writeMarker.exitCode).toBe(0);

      // Stop the sandbox: the container transitions to exited (not removed),
      // the card shows the stopped state with a Start button (AC-L8).
      await dismissBlockingToasts(page);
      await card.getByRole("button", { name: "Stop" }).last().click();
      // The stopped card shows Start in both the header row and the expanded
      // actions section; target the expanded one like the Stop clicks above.
      await expect(card.getByRole("button", { name: "Start" }).last()).toBeVisible({
        timeout: E2E_TIMEOUTS.assertionMs,
      });
      await expect
        .poll(async () => (await findSandboxContainerState(instanceId))?.State, {
          timeout: E2E_TIMEOUTS.assertionMs,
        })
        .not.toBe("running");
      await page.screenshot({ path: testInfo.outputPath("lifecycle-stopped.png"), fullPage: true });

      // Start the sandbox again: the same container resumes and the marker
      // file survives (AC-L5 filesystem persistence across stop/start).
      await dismissBlockingToasts(page);
      await card.getByRole("button", { name: "Start" }).last().click();
      await expect(sessionLine).toBeVisible({ timeout: E2E_TIMEOUTS.agentReplyMs });
      await expect
        .poll(async () => (await findSandboxContainerState(instanceId))?.State, {
          timeout: E2E_TIMEOUTS.agentReplyMs,
        })
        .toBe("running");

      const resumedContainerId = (await findSandboxContainerId(instanceId)) ?? "";
      expect(resumedContainerId, "start should resume the same container").toBe(containerId);
      const readMarker = await execInContainer(resumedContainerId, "cat /tmp/lifecycle-marker.txt");
      expect(readMarker.exitCode).toBe(0);
      expect(readMarker.stdout.trim()).toBe("persisted");

      // Stop then delete the sandbox and remove the target.
      await dismissBlockingToasts(page);
      await card.getByRole("button", { name: "Stop" }).last().click();
      await card.getByRole("button", { name: "Delete sandbox", exact: true }).click();
      await expect(sessionLine).toBeHidden({ timeout: E2E_TIMEOUTS.agentReplyMs });

      await deleteSandboxDeploymentTarget(page, "E2E Lifecycle");
    },
  );
});
