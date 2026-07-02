import { request } from "node:http";
import type { Locator, Page } from "@playwright/test";
import {
  assertDockerDaemonReachable,
  assertKatacodeImageBuilt,
  readDockerSocketPath,
} from "../../src/harness/env.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import { openConnectionsSettings } from "../../src/flows/settings.ts";
import { dismissBlockingToasts } from "../../src/flows/navigation.ts";
import { createOrOpenProject, createSeededGitWorkspace } from "../../src/flows/workspace.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

/**
 * Container sandbox environment — provisions the real `katacode:local` image
 * (built by `pnpm run build:docker-image`) running `katacode serve`, then
 * verifies the in-container Kata server boots and is reachable over loopback
 * (AC-1.10: server boots container-side; the full agent-turn slice needs a
 * paired model provider and is recorded as a manual UAT per the spec's
 * two-client rule).
 */

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

function deploymentTargetCard(page: Page, label: string): Locator {
  const section = page
    .getByRole("heading", { name: "Sandbox environments", level: 2 })
    .locator("xpath=ancestor::section[1]");
  return section.locator("div.border-t").filter({
    has: page.getByRole("heading", { name: label, level: 3 }),
  });
}

async function addContainerDeploymentTarget(page: Page, label: string): Promise<Locator> {
  await page.getByRole("button", { name: "Add sandbox environment" }).click();
  const dialog = page.getByRole("dialog", { name: "Add container sandbox environment" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Label").fill(label);
  // Fill image + command explicitly (the dialog defaults to these, but set
  // them so the test does not depend on default resolution under load).
  await dialog.getByLabel("Image").fill("katacode:local");
  await dialog.getByLabel("Start command").fill("katacode serve --port 13773");
  await dialog.getByRole("button", { name: "Add target" }).click();
  await expect(dialog).toBeHidden();

  const card = deploymentTargetCard(page, label);
  await expect(card).toBeVisible({ timeout: E2E_TIMEOUTS.authMs });
  await expect(card.getByText("docker", { exact: true })).toBeVisible();
  await expect(card.getByText("available")).toBeVisible({ timeout: E2E_TIMEOUTS.authMs });
  return card;
}

async function dockerEngineRequest(
  path: string,
  input: {
    readonly method?: "GET" | "POST";
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

test.describe(`Environments/deployments container target ${E2E_TAGS.environmentsDeploy}`, () => {
  test.describe.configure({ timeout: REAL_IMAGE_E2E_TIMEOUT_MS });

  test("add sandbox environment, test connection + start session boot the real katacode image", async ({
    appWindow,
  }, testInfo) => {
    // Fail loud if Docker or the katacode image isn't available — the flow
    // provisions the real Kata server, so either is a hard prerequisite.
    await assertDockerDaemonReachable();
    await assertKatacodeImageBuilt();

    const page = appWindow;
    await openConnectionsSettings(page);
    await dismissBlockingToasts(page);

    const card = await addContainerDeploymentTarget(page, "E2E Smoke");

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

    // Start session (AC-1.10): provision the real katacode image, auto-register
    // with Connect using the signed-in app user's Clerk relay token, and surface
    // the loopback endpoint + environmentId.
    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: "Start session" }).click();
    const sessionLine = card.getByText(/Session ready:/);
    await expect(sessionLine).toBeVisible({ timeout: E2E_TIMEOUTS.agentReplyMs });
    await sessionLine.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("session-ready.png"), fullPage: true });

    // Extract the published loopback URL and verify the in-container Kata
    // server answers over it — the loopback reachability half of AC-1.10.
    const sessionText = await sessionLine.textContent();
    const httpBaseUrlMatch = sessionText?.match(/http:\/\/localhost:\d+/);
    expect(
      httpBaseUrlMatch,
      `session text did not expose a loopback URL: ${sessionText}`,
    ).not.toBeNull();
    const hostPort = parseHostPort(httpBaseUrlMatch![0]);
    const healthStatus = await probeContainerHealth(hostPort);
    expect(healthStatus).toBe(200);

    // Dispose the session — the container is released and the session line
    // disappears (AC-1.12 single-client slice).
    await card.getByRole("button", { name: "Dispose" }).click();
    await expect(sessionLine).toBeHidden({ timeout: E2E_TIMEOUTS.assertionMs });

    // Clean up the target via the trash button on the card row.
    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: /Delete sandbox environment/ }).click();
    await expect(card).toBeHidden({ timeout: E2E_TIMEOUTS.assertionMs });
  });

  test("saved repo environment seeds, injects secrets, and launches setup processes", async ({
    appWindow,
    runContext,
  }, testInfo) => {
    await assertDockerDaemonReachable();
    await assertKatacodeImageBuilt();

    const page = appWindow;
    const secret = `phase2-secret-${Date.now()}`;
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

    await addContainerDeploymentTarget(page, "E2E Phase2");

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
    await page.waitForTimeout(1_000);

    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: "Start session" }).click();
    const sessionLine = card.getByText(/Session ready:/);
    await expect(sessionLine).toBeVisible({ timeout: E2E_TIMEOUTS.agentReplyMs });
    await page.screenshot({
      path: testInfo.outputPath("phase2-session-ready.png"),
      fullPage: true,
    });

    const progress = card.locator("pre");
    await expect(progress).not.toContainText(secret);

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

    await card.getByRole("button", { name: "Dispose" }).click();
    await expect(sessionLine).toBeHidden({ timeout: E2E_TIMEOUTS.assertionMs });

    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: /Delete sandbox environment/ }).click();
    await expect(card).toBeHidden({ timeout: E2E_TIMEOUTS.assertionMs });
  });
});
