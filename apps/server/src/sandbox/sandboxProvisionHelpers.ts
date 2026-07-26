/**
 * Shared provision helpers for SandboxService: credential seeding, env
 * materialization, and driver/RPC error mapping.
 *
 * @module sandboxProvisionHelpers
 */
import * as os from "node:os";
import * as Effect from "effect/Effect";

import type {
  ProviderInstanceEnvironment,
  ProviderInstanceEnvironmentVariable,
} from "@kata-sh/code-contracts";
import { SandboxRpcError } from "@kata-sh/code-contracts/sandboxRpc";
import {
  SandboxProviderError,
  type SandboxHandle,
  type SandboxProvider,
} from "@kata-sh/code-sandbox/driver";
import { DEFAULT_DOCKER_CONFIG } from "@kata-sh/code-sandbox-docker";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { buildCredentialSeedArchives } from "./credentialSeed.ts";
import { EnvironmentConfigLoadError } from "./environmentConfigLoader.ts";
import { buildPiPackageInstallCommands, resolveHostPiPackages } from "./piSandboxPackages.ts";
import { SetupFailed } from "./sandboxSetupRunner.ts";
import { loadStoredSandboxCredentials } from "./storedSandboxCredentials.ts";

/** Map a loader failure to the RPC error channel. */
export function mapLoadError(e: EnvironmentConfigLoadError): SandboxRpcError {
  return new SandboxRpcError({ reason: "invalid-config", message: e.message });
}

/** Map a setup-runner failure to the RPC error channel. */
export function mapSetupFailed(e: SetupFailed): SandboxRpcError {
  return new SandboxRpcError({
    reason: "provision-failed",
    message: `Setup failed (${e.stage}): ${e.message}`,
  });
}

/** Map a driver `SandboxProviderError` to the RPC `SandboxRpcError`. */
export function mapDriverError(e: SandboxProviderError): SandboxRpcError {
  let reason: SandboxRpcError["reason"];
  switch (e.reason) {
    case "invalid-config":
      reason = "invalid-config";
      break;
    case "unreachable":
      reason = "unreachable";
      break;
    case "provision-failed":
    case "dispose-failed":
    case "exec-failed":
      reason = "provision-failed";
      break;
    default:
      reason = "internal";
  }
  return new SandboxRpcError({ reason, message: e.message });
}

/** Map a registry unavailable reason to an RPC error. */
export function registryError(
  reason: "unknown-driver" | "disabled" | "invalid-config",
  message: string,
): SandboxRpcError {
  return new SandboxRpcError({ reason, message });
}

/**
 * Turn an effect into an Either-shaped `{ _tag: "Left"|"Right" }` value.
 * `Effect.either` is not exported in the installed Effect (4.0.0-beta.78).
 */
export function either<A, E>(
  eff: Effect.Effect<A, E>,
): Effect.Effect<{ _tag: "Left"; left: E } | { _tag: "Right"; right: A }, never> {
  return Effect.matchEffect(eff, {
    onFailure: (left) => Effect.succeed<{ _tag: "Left"; left: E }>({ _tag: "Left", left }),
    onSuccess: (right) => Effect.succeed<{ _tag: "Right"; right: A }>({ _tag: "Right", right }),
  });
}

/** Seed provider credentials (static config + auth) into the container home. */
export function runCredentialSeed(
  driver: SandboxProvider,
  handle: SandboxHandle,
): Effect.Effect<void, SetupFailed | SandboxProviderError, ServerSecretStore> {
  return Effect.gen(function* () {
    const copyIntoCap = driver.copyInto;
    if (!copyIntoCap) return;
    const storedCredentials = yield* loadStoredSandboxCredentials().pipe(
      Effect.mapError(
        (e) =>
          new SetupFailed({
            stage: "seed",
            message: `credential secret load failed: ${e.message}`,
            cause: e,
          }),
      ),
    );
    const archives = yield* buildCredentialSeedArchives({
      hostHome: os.homedir(),
      ...(storedCredentials.length > 0 ? { storedCredentials } : {}),
    }).pipe(
      Effect.mapError(
        (e) =>
          new SetupFailed({
            stage: "seed",
            message: `credential seed build failed: ${e.message}`,
            cause: e,
          }),
      ),
    );
    if (archives.static) {
      yield* copyIntoCap.copyInto(handle, archives.static, "/home/katacode").pipe(
        Effect.mapError(
          (e) =>
            new SetupFailed({
              stage: "seed",
              message: `credential static copyInto failed: ${e.message}`,
              cause: e,
            }),
        ),
      );
    }
    if (archives.credentials) {
      yield* copyIntoCap.copyInto(handle, archives.credentials, "/home/katacode").pipe(
        Effect.mapError(
          (e) =>
            new SetupFailed({
              stage: "seed",
              message: `credential auth copyInto failed: ${e.message}`,
              cause: e,
            }),
        ),
      );
    }
  });
}

/** Sandbox home the credential seed extracts into. */
const SANDBOX_HOME = "/home/katacode";

/**
 * Install the Pi extension packages declared in the host's `settings.json`.
 *
 * The seed ships the `packages` list but never the host `npm/node_modules`
 * tree (darwin-native binaries), so the sandbox resolves the same specs from
 * npm. Installing here — during provision, before `katacode serve` handles a
 * session — keeps the cost off the provider probe's timeout budget.
 *
 * Extensions are optional: a non-zero install exit logs a warning and leaves
 * the sandbox usable for providers that need no extension. A missing or
 * package-less host `settings.json` is a no-op.
 */
export function runPiPackageInstall(
  driver: SandboxProvider,
  handle: SandboxHandle,
): Effect.Effect<void, SandboxProviderError> {
  return Effect.gen(function* () {
    const installs = buildPiPackageInstallCommands({
      packages: yield* resolveHostPiPackages(),
      home: SANDBOX_HOME,
    });

    for (const install of installs) {
      const result = yield* driver.exec(handle, install.command, { cwd: SANDBOX_HOME });
      if (result.exitCode !== 0) {
        yield* Effect.logWarning(
          `[sandbox] Pi extension install failed for ${install.spec} (exit ${result.exitCode}); providers it registers (for example Anthropic OAuth) are unavailable in this sandbox: ${result.stderr.slice(-512)}`,
        );
      }
    }
  });
}

/** Collect provision env tuples and secret values for setup-output redaction. */
export function buildProvisionEnvironment(input: {
  readonly bootstrapToken: string;
  readonly instanceEnvironment?: ProviderInstanceEnvironment | undefined;
  readonly savedEnvironment?: ProviderInstanceEnvironment | undefined;
}): {
  readonly env: ReadonlyArray<readonly [string, string]>;
  readonly secretValues: ReadonlyArray<string>;
} {
  const byName = new Map<string, ProviderInstanceEnvironmentVariable>();
  for (const variable of input.instanceEnvironment ?? []) {
    byName.set(variable.name, variable);
  }
  for (const variable of input.savedEnvironment ?? []) {
    byName.set(variable.name, variable);
  }
  const env: Array<readonly [string, string]> = [
    ["KATACODE_DESKTOP_BOOTSTRAP_TOKEN", input.bootstrapToken],
  ];
  const secretValues: string[] = [input.bootstrapToken];
  for (const variable of byName.values()) {
    env.push([variable.name, variable.value]);
    if (variable.sensitive && variable.value.length > 0) {
      secretValues.push(variable.value);
    }
  }
  return { env, secretValues };
}

/** Resolve the base image for a provision request from the decoded driver config. */
export function resolveProvisionImage(config: unknown): string {
  if (
    config !== null &&
    typeof config === "object" &&
    typeof (config as { image?: unknown }).image === "string"
  ) {
    return (config as { image: string }).image;
  }
  return DEFAULT_DOCKER_CONFIG.image;
}

/** Resolve the configured timeout window (ms) from a decoded driver config. */
export function resolveSandboxTimeoutMs(config: unknown): number {
  if (
    config !== null &&
    typeof config === "object" &&
    typeof (config as { timeoutMs?: unknown }).timeoutMs === "number"
  ) {
    return (config as { timeoutMs: number }).timeoutMs;
  }
  return 2_700_000;
}
