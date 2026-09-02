// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalTimers:off - the gated harness spawns an isolated serve process and talks HTTP plus Docker CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  AuthAccessTokenType,
  AuthAdministrativeScopes,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
} from "@kata-sh/code-contracts";
import { SandboxProviderLabels } from "@kata-sh/code-kata-sandbox-contracts/domain";
import { dockerContainerName } from "@kata-sh/code-kata-sandbox-docker";
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

const enabled = process.env.KATACODE_DOCKER_HTTP_E2E === "1";
const repositoryRoot = NodePath.resolve(
  NodeURL.fileURLToPath(new URL("../../../../", import.meta.url)),
);
const binPath = NodePath.join(repositoryRoot, "apps/server/src/bin.ts");
const socketPath = process.env.KATACODE_DOCKER_SOCKET ?? "/var/run/docker.sock";
const sourceRepository = process.env.KATACODE_DOCKER_HTTP_E2E_REPOSITORY ?? "octocat/Hello-World";
const sourceRef = process.env.KATACODE_DOCKER_HTTP_E2E_REF ?? "master";
const OCI_DIGEST = /^(?:[a-z0-9][a-z0-9._:/-]*@)?sha256:[0-9a-f]{64}$/i;
const HTTP_E2E_TIMEOUT_MS = 12 * 60_000;

interface SandboxReceipt {
  readonly operationId: string;
  readonly status: string;
  readonly deploymentId?: string;
  readonly profileId?: string;
  readonly error?: string;
  readonly result?: {
    readonly kind: string;
    readonly profileId?: string;
    readonly deploymentId?: string;
    readonly endpoint?: string;
  };
  readonly progress?: {
    readonly stage?: string;
    readonly lastStage?: string;
    readonly diagnostic?: string;
  };
}

class DockerSandboxHttpE2EError extends Data.TaggedError("DockerSandboxHttpE2EError")<{
  readonly message: string;
}> {}

function asError(cause: unknown): DockerSandboxHttpE2EError {
  return cause instanceof DockerSandboxHttpE2EError
    ? cause
    : new DockerSandboxHttpE2EError({
        message: cause instanceof Error ? cause.message : String(cause),
      });
}

function readImageDigest(): string {
  const direct = process.env.KATACODE_SANDBOX_IMAGE_DIGEST?.trim();
  if (direct !== undefined && OCI_DIGEST.test(direct)) return direct;
  const file = process.env.KATACODE_SANDBOX_IMAGE_DIGEST_FILE?.trim();
  if (file !== undefined && file.length > 0) {
    const parsed = JSON.parse(NodeFS.readFileSync(file, "utf8")) as { imageId?: unknown };
    if (typeof parsed.imageId === "string" && OCI_DIGEST.test(parsed.imageId)) {
      return parsed.imageId;
    }
  }
  throw new DockerSandboxHttpE2EError({
    message:
      "KATACODE_SANDBOX_IMAGE_DIGEST or KATACODE_SANDBOX_IMAGE_DIGEST_FILE.imageId is required.",
  });
}

function writeIsolatedHome(baseDir: string, codexHome: string): void {
  NodeFS.mkdirSync(NodePath.join(baseDir, "userdata"), { recursive: true });
  NodeFS.mkdirSync(codexHome, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(codexHome, "auth.json"),
    `${JSON.stringify({ OPENAI_API_KEY: "sandbox-http-e2e" })}\n`,
  );
  NodeFS.writeFileSync(
    NodePath.join(baseDir, "userdata", "settings.json"),
    `${JSON.stringify({ providers: { codex: { homePath: codexHome } } }, null, 2)}\n`,
  );
}

function dockerIds(filters: ReadonlyArray<string>): ReadonlyArray<string> {
  const result = NodeChildProcess.spawnSync(
    "docker",
    ["ps", "-aq", ...filters.flatMap((filter) => ["--filter", filter])],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new DockerSandboxHttpE2EError({
      message: result.stderr.trim() || "docker ps failed while listing owned sandbox containers.",
    });
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function removeContainers(ids: ReadonlyArray<string>): void {
  if (ids.length === 0) return;
  NodeChildProcess.spawnSync("docker", ["rm", "-f", ...ids], { encoding: "utf8" });
}

function ownedContainerFilters(input: {
  readonly profileId?: string;
  readonly deploymentId?: string;
}): ReadonlyArray<string> {
  const filters = [`label=${SandboxProviderLabels.schemaVersion}=v1`];
  if (input.deploymentId !== undefined) {
    filters.push(`label=${SandboxProviderLabels.deploymentId}=${input.deploymentId}`);
  } else if (input.profileId !== undefined) {
    filters.push(`label=${SandboxProviderLabels.profileId}=${input.profileId}`);
  }
  return filters;
}

function onChildExit(child: NodeChildProcess.ChildProcess, onExit: () => void): () => void {
  if (child.exitCode !== null || child.signalCode !== null) {
    onExit();
    return () => undefined;
  }
  const timer = setTimeout(() => {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // The captured serve PID is already gone.
      }
    }
  }, 5_000);
  const finished = () => {
    clearTimeout(timer);
    onExit();
  };
  child.once("exit", finished);
  return () => {
    clearTimeout(timer);
    child.off("exit", finished);
  };
}

function stopServe(child: NodeChildProcess.ChildProcess): Effect.Effect<void> {
  return Effect.sync(() => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      // The captured serve PID is already gone.
    }
  }).pipe(
    Effect.andThen(
      Effect.callback<void>((resume) => {
        onChildExit(child, () => resume(Effect.void));
      }),
    ),
  );
}

function waitForPairing(child: NodeChildProcess.ChildProcess, output: { text: string }) {
  return Effect.callback<{ readonly origin: string; readonly token: string }, Error>((resume) => {
    const settle = () => {
      const match = /Pairing URL:\s*(\S+)/.exec(output.text);
      if (match === null) return false;
      const pairingUrl = new URL(match[1]!);
      const token = new URLSearchParams(pairingUrl.hash.replace(/^#/, "")).get("token");
      if (token === null || token.length === 0) return false;
      resume(Effect.succeed({ origin: pairingUrl.origin, token }));
      return true;
    };
    if (settle()) return;
    const onData = () => {
      if (settle()) {
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
      }
    };
    const onExit = (code: number | null) => {
      resume(
        Effect.fail(
          new DockerSandboxHttpE2EError({
            message: `Isolated serve exited ${String(code)} before printing a pairing URL.\n${output.text}`,
          }),
        ),
      );
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
    return Effect.sync(() => {
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(60),
      orElse: () =>
        Effect.fail(
          new DockerSandboxHttpE2EError({
            message: `Timed out waiting for the isolated serve pairing URL.\n${output.text}`,
          }),
        ),
    }),
  );
}

async function httpJson<Body>(input: {
  readonly origin: string;
  readonly token: string;
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}): Promise<{ readonly status: number; readonly body: Body; readonly text: string }> {
  const response = await fetch(new URL(input.path, input.origin), {
    method: input.method,
    headers: {
      authorization: `Bearer ${input.token}`,
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: (text.length === 0 ? {} : JSON.parse(text)) as Body,
  };
}

function jsonRequest<Body>(input: {
  readonly origin: string;
  readonly token: string;
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}): Effect.Effect<{ readonly status: number; readonly body: Body; readonly text: string }, Error> {
  return Effect.tryPromise({
    try: () => httpJson<Body>(input),
    catch: asError,
  });
}

async function exchangeAccessTokenHttp(origin: string, credential: string): Promise<string> {
  const response = await fetch(new URL("/oauth/token", origin), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: AuthTokenExchangeGrantType,
      subject_token: credential,
      subject_token_type: AuthEnvironmentBootstrapTokenType,
      requested_token_type: AuthAccessTokenType,
      scope: AuthAdministrativeScopes.join(" "),
    }),
  });
  const body = (await response.json()) as { readonly access_token?: string };
  if (response.status !== 200 || body.access_token === undefined) {
    throw new DockerSandboxHttpE2EError({
      message: `Token exchange failed with ${String(response.status)}.`,
    });
  }
  return body.access_token;
}

function exchangeAccessToken(origin: string, credential: string) {
  return Effect.tryPromise({
    try: () => exchangeAccessTokenHttp(origin, credential),
    catch: asError,
  });
}

function containerLogs(ids: ReadonlyArray<string>): string {
  if (ids.length === 0) return "";
  return ids
    .map((id) => {
      const inspect = NodeChildProcess.spawnSync(
        "docker",
        [
          "inspect",
          "--format",
          "{{.State.Status}} error={{.State.Error}} exit={{.State.ExitCode}}",
          id,
        ],
        { encoding: "utf8" },
      );
      const logs = NodeChildProcess.spawnSync("docker", ["logs", "--tail", "80", id], {
        encoding: "utf8",
      });
      return `--- docker ${id} ---\n${inspect.stdout}${inspect.stderr}--- logs ---\n${logs.stdout}\n${logs.stderr}`;
    })
    .join("\n");
}

function describeDocker(profileId: string, deploymentId?: string): string {
  try {
    const listed = NodeChildProcess.spawnSync(
      "docker",
      ["ps", "-a", "--format", "{{.ID}} {{.Status}} {{.Names}} {{.Ports}}"],
      { encoding: "utf8" },
    );
    const named =
      deploymentId === undefined
        ? { stdout: "", stderr: "" }
        : NodeChildProcess.spawnSync("docker", ["inspect", dockerContainerName(deploymentId)], {
            encoding: "utf8",
          });
    const ids = dockerIds(
      ownedContainerFilters({ profileId, ...(deploymentId === undefined ? {} : { deploymentId }) }),
    );
    return `deploymentId=${deploymentId ?? ""}\n${listed.stdout}${listed.stderr}\n${named.stdout}${named.stderr}\n${containerLogs(ids)}`;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

function describeReceipt(receipt: SandboxReceipt): string {
  const progress = [
    receipt.progress?.stage,
    receipt.progress?.lastStage,
    receipt.progress?.diagnostic,
  ]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" ");
  return [
    `status=${receipt.status}`,
    receipt.error === undefined ? undefined : `error=${receipt.error}`,
    progress.length === 0 ? undefined : `progress=${progress}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");
}

function waitForReceipt(input: {
  readonly origin: string;
  readonly token: string;
  readonly operationId: string;
  readonly ceiling: Duration.Duration;
  readonly diagnostics?: (receipt: SandboxReceipt) => string;
}) {
  return Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(input.ceiling);
    while (true) {
      const response = yield* jsonRequest<{ readonly receipt: SandboxReceipt }>({
        origin: input.origin,
        token: input.token,
        method: "GET",
        path: `/api/kata-sandbox/operations/${input.operationId}`,
      });
      if (response.status !== 200) {
        return yield* new DockerSandboxHttpE2EError({
          message: `Operation ${input.operationId} returned ${String(response.status)}: ${response.text}`,
        });
      }
      const receipt = response.body.receipt;
      if (receipt.status === "Succeeded") return receipt;
      if (receipt.status === "Failed") {
        return yield* new DockerSandboxHttpE2EError({
          message: `${receipt.error ?? `Sandbox operation ${input.operationId} failed.`}\n${input.diagnostics?.(receipt) ?? ""}`,
        });
      }
      if ((yield* Clock.currentTimeMillis) >= deadline) {
        return yield* new DockerSandboxHttpE2EError({
          message: `Timed out waiting for sandbox operation ${input.operationId} (${describeReceipt(receipt)}).\n${input.diagnostics?.(receipt) ?? ""}`,
        });
      }
      yield* Effect.sleep("250 millis");
    }
  });
}

function acceptOperation(input: {
  readonly origin: string;
  readonly token: string;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}) {
  return Effect.gen(function* () {
    const response = yield* jsonRequest<{ readonly operationId?: string }>(input);
    if (response.status !== 202 || response.body.operationId === undefined) {
      return yield* new DockerSandboxHttpE2EError({
        message: `${input.method} ${input.path} returned ${String(response.status)}: ${response.text}`,
      });
    }
    return response.body.operationId;
  });
}

describe.runIf(enabled)("Docker sandbox HTTP E2E", () => {
  it.live(
    "creates a sandbox through the authenticated HTTP boundary",
    () => {
      const imageDigest = readImageDigest();
      const profileId = `docker-http-e2e-${NodeCrypto.randomUUID()}`;
      const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kata-sandbox-http-e2e-"));
      const codexHome = NodePath.join(baseDir, "codex-home");
      writeIsolatedHome(baseDir, codexHome);

      const child = NodeChildProcess.spawn(
        process.execPath,
        [binPath, "serve", "--host", "127.0.0.1", "--base-dir", baseDir, "--no-browser"],
        {
          cwd: repositoryRoot,
          env: {
            ...process.env,
            KATACODE_SANDBOXES: "1",
            KATACODE_NO_BROWSER: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      if (child.pid === undefined) {
        throw new DockerSandboxHttpE2EError({
          message: "Isolated serve did not report a PID.",
        });
      }
      const output = { text: "" };
      const append = (chunk: Buffer | string) => {
        output.text += String(chunk);
      };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);

      let deploymentId: string | undefined;

      return Effect.gen(function* () {
        const pairing = yield* waitForPairing(child, output);
        const token = yield* exchangeAccessToken(pairing.origin, pairing.token);

        const list = yield* jsonRequest<{
          readonly providers: ReadonlyArray<{ readonly driverKind: string }>;
        }>({
          origin: pairing.origin,
          token,
          method: "GET",
          path: "/api/kata-sandbox",
        });
        if (list.status !== 200) {
          return yield* new DockerSandboxHttpE2EError({
            message: `GET /api/kata-sandbox returned ${String(list.status)}: ${list.text}\n${output.text}`,
          });
        }
        expect(list.body.providers.some((provider) => provider.driverKind === "docker")).toBe(true);

        const upsertId = yield* acceptOperation({
          origin: pairing.origin,
          token,
          method: "POST",
          path: "/api/kata-sandbox/profiles",
          body: {
            requestId: NodeCrypto.randomUUID(),
            profileId,
            name: "Docker HTTP E2E",
            driverKind: "docker",
            socketPath,
            image: { kind: "custom", digest: imageDigest },
            enabled: true,
          },
        });
        const diagnostics = (receipt: SandboxReceipt) =>
          `${output.text}\n${describeDocker(profileId, receipt.deploymentId ?? deploymentId)}`;
        const upserted = yield* waitForReceipt({
          origin: pairing.origin,
          token,
          operationId: upsertId,
          ceiling: Duration.minutes(2),
          diagnostics,
        });
        expect(upserted.result?.kind).toBe("profile");

        const createId = yield* acceptOperation({
          origin: pairing.origin,
          token,
          method: "POST",
          path: "/api/kata-sandbox/deployments",
          body: {
            requestId: NodeCrypto.randomUUID(),
            profileId,
            label: "HTTP E2E",
            source: { repository: sourceRepository, ref: sourceRef },
            providerInstanceId: "codex",
          },
        });
        const created = yield* waitForReceipt({
          origin: pairing.origin,
          token,
          operationId: createId,
          ceiling: Duration.minutes(10),
          diagnostics,
        });
        const createdDeploymentId = created.deploymentId ?? created.result?.deploymentId;
        if (createdDeploymentId === undefined) {
          return yield* new DockerSandboxHttpE2EError({
            message: "Create receipt did not include a deployment id.",
          });
        }
        deploymentId = createdDeploymentId;
        expect(created.result?.kind).toBe("deployment");
        expect(created.result?.endpoint?.startsWith("http://127.0.0.1:")).toBe(true);

        const handoff = yield* jsonRequest<{
          readonly attachment?: string;
          readonly pairingUrl?: string;
          readonly endpoint?: string;
        }>({
          origin: pairing.origin,
          token,
          method: "POST",
          path: `/api/kata-sandbox/deployments/${createdDeploymentId}/handoff`,
        });
        expect(handoff.status).toBe(200);
        expect(handoff.body.attachment).toBe("direct");
        expect(handoff.body.pairingUrl).toBeTruthy();
        expect(handoff.body.endpoint?.startsWith("http://127.0.0.1:")).toBe(true);

        const deleteId = yield* acceptOperation({
          origin: pairing.origin,
          token,
          method: "POST",
          path: "/api/kata-sandbox/deployments/delete",
          body: {
            requestId: NodeCrypto.randomUUID(),
            deploymentId: createdDeploymentId,
          },
        });
        const deleted = yield* waitForReceipt({
          origin: pairing.origin,
          token,
          operationId: deleteId,
          ceiling: Duration.minutes(2),
          diagnostics,
        });
        expect(deleted.result?.kind).toBe("deleted");
        expect(
          dockerIds(ownedContainerFilters({ profileId, deploymentId: createdDeploymentId })),
        ).toEqual([]);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            try {
              removeContainers(
                dockerIds(
                  ownedContainerFilters({
                    profileId,
                    ...(deploymentId === undefined ? {} : { deploymentId }),
                  }),
                ),
              );
            } catch {
              // Leftover container cleanup is best-effort after the receipt path.
            }
          }).pipe(Effect.andThen(stopServe(child))),
        ),
      );
    },
    { timeout: HTTP_E2E_TIMEOUT_MS },
  );
});
