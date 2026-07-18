import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";

import {
  RepositoryCanonicalKey,
  type AdvertisedEndpoint,
  type ServerSettings,
} from "@kata-sh/code-contracts";
import type { SandboxProviderInstanceConfig } from "@kata-sh/code-contracts/sandboxProviderInstance";
import {
  type SandboxProviderInstanceConfigMap,
  SandboxProviderInstanceId,
} from "@kata-sh/code-contracts/sandboxProviderInstance";
import { type SandboxStartSessionInput, SandboxRpcError } from "@kata-sh/code-contracts/sandboxRpc";
import {
  SandboxProviderError,
  type SandboxHandle,
  type SandboxProvider,
} from "@kata-sh/code-sandbox/driver";
import { VERCEL_KIND, VERCEL_SOURCE_TOKEN_ENV } from "@kata-sh/code-sandbox-vercel";

import type * as CliTokenManager from "../cloud/CliTokenManager.ts";
import {
  decodeEnvironmentConfigText,
  resolveLoadedEnvironmentConfig,
} from "./environmentConfigLoader.ts";
import { SetupFailed, runSandboxSetup } from "./sandboxSetupRunner.ts";
import {
  buildProvisionEnvironment,
  mapDriverError,
  mapLoadError,
  mapSetupFailed,
  registryError,
  resolveProvisionImage,
  runCredentialSeed,
} from "./sandboxProvisionHelpers.ts";
import {
  buildRegistry,
  reinjectVercelAuth,
  resolveInstanceEnvelope,
} from "./sandboxSessionHelpers.ts";
import type { SandboxSessionStore } from "./sandboxSessionStore.ts";
import type { LiveSession } from "./sandboxSessionTypes.ts";
import type { registerAndFinalizeSession as registerAndFinalizeSessionImpl } from "./sandboxSessionFinalize.ts";
import { resolveSandboxGitHubSource, sourceFingerprint } from "./sandboxGitHubSource.ts";
import {
  cloneGitHubSourceIntoWorkspace,
  DOCKER_WORKSPACE,
  DockerRemoteSetupError,
  readDockerRemoteEnvironmentConfig,
} from "./dockerRemoteSetup.ts";
import {
  readRemoteEnvironmentConfig,
  seedGitHubAuth,
  VERCEL_WORKSPACE,
  VercelRemoteSetupError,
} from "./vercelRemoteSetup.ts";

export interface PersistSandboxSessionInput {
  readonly instanceId: SandboxProviderInstanceId;
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
  readonly config: SandboxProviderInstanceConfig;
  readonly environmentId: string;
  readonly endpoint: AdvertisedEndpoint;
  readonly relay: { readonly relayUrl: string; readonly bearerToken: string } | null;
  readonly status: "running" | "stopped";
  readonly sourceFingerprint?: string | undefined;
}

export interface SandboxStartSessionRuntime {
  readonly busyInstances: Set<string>;
  readonly getStore: () => SandboxSessionStore;
  readonly liveSessions: Map<string, LiveSession>;
  readonly nameNamespace: string | undefined;
  readonly refreshLockedInstanceStatus: (
    sessionKey: string,
    settings: ServerSettings,
  ) => Effect.Effect<void, never, CliTokenManager.CloudCliTokenManager>;
  readonly registerAndFinalizeSession: (
    input: Omit<Parameters<typeof registerAndFinalizeSessionImpl>[0], "removeStoreRecord">,
  ) => ReturnType<typeof registerAndFinalizeSessionImpl>;
  readonly disposeAfterFailure: (
    sessionKey: string,
    driver: SandboxProvider,
    handle: SandboxHandle,
  ) => Effect.Effect<void, never>;
  readonly persistSessionRecord: (input: PersistSandboxSessionInput) => Effect.Effect<void, never>;
}

/**
 * Prefer the driver-resolved bootstrap token when present (Docker create-time
 * env). Other drivers keep the freshly minted token.
 */
export const resolveBootstrapToken = (
  driver: SandboxProvider,
  handle: SandboxHandle,
  mintedToken: string,
): Effect.Effect<string, SandboxRpcError> =>
  driver.resolveBootstrapToken
    ? driver.resolveBootstrapToken(handle, mintedToken).pipe(Effect.mapError(mapDriverError))
    : Effect.succeed(mintedToken);

export const startSandboxSession = (
  runtime: SandboxStartSessionRuntime,
  instanceId: SandboxProviderInstanceId,
  settings: ServerSettings,
  options?: {
    readonly connectAuthToken?: SandboxStartSessionInput["connectAuthToken"];
    readonly repository?: SandboxStartSessionInput["repository"];
    /** Resolve the active host GitHub token for the Vercel native clone.
     *  Injected by the WS layer so `GitHubCli` stays out of this method's
     *  requirements. Fails with the concrete `gh auth login` message. */
    readonly resolveGitHubToken?: Effect.Effect<string, SandboxRpcError>;
  },
) =>
  Effect.gen(function* () {
    const sessionKey = instanceId as string;
    // Operation lock: prevents concurrent start/stop/delete on the same instance.
    // Add to the lock BEFORE any yield (reconcile) so a concurrent startSession
    // for the same instance cannot pass the guard and orphan a second container.
    if (runtime.busyInstances.has(sessionKey)) {
      return yield* new SandboxRpcError({
        reason: "provision-failed",
        message: "An operation is already in progress for this sandbox environment.",
      });
    }
    runtime.busyInstances.add(sessionKey);
    return yield* Effect.gen(function* () {
      // Ensure durable records are loaded before branching on existing status.
      // After a server restart the in-memory cache is empty until load() runs.
      yield* runtime
        .getStore()
        .load()
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not load sandbox sessions before start", { cause }).pipe(
              Effect.as([] as const),
            ),
          ),
        );
      // Provider status while this instance is locked (full reconcile skips busy).
      yield* runtime.refreshLockedInstanceStatus(sessionKey, settings);
      const existing = runtime.getStore().records.find((r) => r.instanceId === sessionKey);
      if (existing !== undefined && existing.status === "running") {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message: "A session is already running for this sandbox environment.",
        });
      }
      const registry = buildRegistry();
      const config = (settings.sandboxProviderInstances as SandboxProviderInstanceConfigMap)[
        instanceId as SandboxProviderInstanceId
      ];
      if (config === undefined) {
        return yield* new SandboxRpcError({
          reason: "invalid-config",
          message: "instance not found",
        });
      }
      const resolvedConfig = resolveInstanceEnvelope(config);
      const inst = registry.materializeOne(instanceId, resolvedConfig);
      if (inst.kind !== "available") {
        return yield* registryError(inst.reason, inst.message);
      }

      // ── Start-from-stopped path ──
      if (existing !== undefined && existing.status === "stopped") {
        if (inst.driver.lifecycle === undefined) {
          return yield* new SandboxRpcError({
            reason: "not-running",
            message: "This sandbox driver does not support lifecycle start.",
          });
        }
        // A stopped sandbox already has a seeded workspace; re-seeding is
        // not supported. Fail loud rather than silently dropping the input.
        if (options?.repository !== undefined) {
          return yield* new SandboxRpcError({
            reason: "invalid-config",
            message: "The sandbox already has a seeded workspace; delete it to re-seed.",
          });
        }
        // Reject a changed or newly-added source: sourced sandboxes must match
        // their stored fingerprint; source-less sandboxes cannot gain a source
        // on resume. Delete and recreate to re-clone.
        {
          const startSource = resolveSandboxGitHubSource(resolvedConfig.config);
          const currentFingerprint =
            startSource !== null
              ? sourceFingerprint({
                  repositoryKey: startSource.repositoryKey,
                  branch: startSource.branch,
                })
              : undefined;
          if (existing.sourceFingerprint !== undefined) {
            if (currentFingerprint !== existing.sourceFingerprint) {
              return yield* new SandboxRpcError({
                reason: "invalid-config",
                message:
                  "The sandbox source changed since it was created. Delete this sandbox and create it again to clone the new source.",
              });
            }
          } else if (currentFingerprint !== undefined) {
            return yield* new SandboxRpcError({
              reason: "invalid-config",
              message:
                "This sandbox was created without a GitHub source. Delete it and create it again to clone a repository.",
            });
          }
        }
        const handle: SandboxHandle = {
          driverKind: inst.driver.kind,
          instanceId: sessionKey,
          // Re-inject Vercel auth into the stored (sanitized) handle.
          handle: reinjectVercelAuth(
            inst.driver.kind as string,
            existing.handle.handle,
            resolvedConfig.config,
          ),
        };
        // Fresh bootstrap token for the started server.
        // @effect-diagnostics-next-line effect(globalDateInEffect):off - random token, not a clock read.
        const bootstrapToken = NodeCrypto.randomBytes(24).toString("hex");
        const { env } = buildProvisionEnvironment({
          bootstrapToken,
          instanceEnvironment: resolvedConfig.environment,
        });
        const started = yield* inst.driver.lifecycle
          .start(handle, { config: resolvedConfig.config, env })
          .pipe(Effect.mapError(mapDriverError));
        // (Vercel relaunches `serve` with the fresh env, so it keeps the
        // fresh token; drivers with resolveBootstrapToken recover create-time.)
        const effectiveBootstrapToken = yield* resolveBootstrapToken(
          inst.driver,
          started,
          bootstrapToken,
        );
        // Re-run Connect registration + mint a fresh pairing token. `keep`:
        // a transient Connect failure must never destroy a stopped-started
        // sandbox's durable filesystem — the user retries Start.
        const finalized = yield* runtime.registerAndFinalizeSession({
          sessionKey,
          instanceId,
          driver: inst.driver,
          handle: started,
          config: resolvedConfig,
          bootstrapToken: effectiveBootstrapToken,
          connectAuthToken: options?.connectAuthToken,
          failureCleanup: "keep",
        });
        // Update the store record (logs on failure rather than swallowing).
        // Preserve the persisted source fingerprint across stop/start.
        yield* runtime.persistSessionRecord({
          instanceId,
          driver: inst.driver,
          handle: started,
          config: resolvedConfig,
          environmentId: finalized.environmentId,
          endpoint: finalized.endpoint,
          relay: finalized.relay,
          status: "running",
          ...(existing.sourceFingerprint !== undefined
            ? { sourceFingerprint: existing.sourceFingerprint }
            : {}),
        });
        // Cache the live session.
        runtime.liveSessions.set(sessionKey, {
          handle: started,
          driver: inst.driver,
          instanceConfig: resolvedConfig,
          environmentId: finalized.environmentId,
          adminAccessToken: finalized.adminAccessToken,
        });
        return {
          instanceId,
          environmentId: finalized.environmentId,
          pairingToken: finalized.pairingToken,
          endpoint: finalized.endpoint,
        };
      }

      // ── Provision path (no existing record) ──
      const isVercel = (inst.driver.kind as string) === (VERCEL_KIND as string);
      const isDocker = (inst.driver.kind as string) === "docker";
      // Docker and Vercel both clone a selected GitHub repo/branch. Local
      // worktree archive seeding is no longer used on the Docker create path.
      const githubSource = resolveSandboxGitHubSource(resolvedConfig.config);
      if (options?.repository !== undefined) {
        return yield* new SandboxRpcError({
          reason: "invalid-config",
          message:
            "Sandbox targets clone their GitHub source; a local repository cannot be provided.",
        });
      }
      if ((isVercel || isDocker) && githubSource === null) {
        return yield* new SandboxRpcError({
          reason: "invalid-config",
          message: "Select a GitHub repository and branch for this sandbox before creating it.",
        });
      }

      // @effect-diagnostics-next-line effect(globalDateInEffect):off - random token, not a clock read.
      const bootstrapToken = NodeCrypto.randomBytes(24).toString("hex");

      // Saved per-repo env keys off the source's canonical GitHub key.
      const savedEnvKey =
        githubSource !== null ? RepositoryCanonicalKey.make(githubSource.repositoryKey) : undefined;
      const savedEnv =
        savedEnvKey !== undefined ? settings.savedSandboxEnvironments[savedEnvKey] : undefined;

      const { env, secretValues } = buildProvisionEnvironment({
        bootstrapToken,
        instanceEnvironment: config.environment,
        savedEnvironment: savedEnv?.environment,
      });

      // Resolve the active host GitHub token for native clone (Vercel) and
      // in-sandbox gh auth seed (Docker + Vercel). Missing auth fails before create.
      const githubToken =
        githubSource !== null
          ? yield* (
              options?.resolveGitHubToken ??
                new SandboxRpcError({
                  reason: "invalid-config",
                  message: "GitHub authentication is unavailable. Run `gh auth login` and retry.",
                })
            )
          : undefined;

      const envWithLabel = config.displayName
        ? [...env, ["KATACODE_ENVIRONMENT_LABEL", config.displayName] as const]
        : env;
      // The transient source token is appended only for the Vercel create call;
      // the Vercel driver extracts it for the native source and excludes it from
      // the sandbox env. It is never persisted or seeded via env.
      const provisionEnv =
        isVercel && githubToken !== undefined
          ? [...envWithLabel, [VERCEL_SOURCE_TOKEN_ENV, githubToken] as const]
          : envWithLabel;

      const handle = yield* inst.driver
        .provision({
          instanceId: instanceId as string,
          config: inst.config,
          image: resolveProvisionImage(inst.config),
          env: provisionEnv,
          ...(runtime.nameNamespace !== undefined ? { nameNamespace: runtime.nameNamespace } : {}),
        })
        .pipe(Effect.mapError(mapDriverError));

      const failProvision = (error: SandboxRpcError) =>
        runtime
          .disposeAfterFailure(sessionKey, inst.driver, handle)
          .pipe(Effect.andThen(Effect.fail(error)));

      yield* runCredentialSeed(inst.driver, handle).pipe(
        Effect.catch((error: SetupFailed | SandboxProviderError) =>
          failProvision(
            error._tag === "SetupFailed" ? mapSetupFailed(error) : mapDriverError(error),
          ),
        ),
      );

      // ── GitHub-sourced setup (Vercel native clone workspace, Docker in-container clone) ──
      if (githubSource !== null) {
        // Seed authenticated gh/Git into the sandbox filesystem (before Docker
        // clone so git can use the credential helper).
        // @effect-diagnostics-next-line effect(globalDateInEffect):off - random nonce, not a clock read.
        const authNonce = NodeCrypto.randomBytes(8).toString("hex");
        yield* seedGitHubAuth({
          driver: inst.driver,
          handle,
          token: githubToken as string,
          nonce: authNonce,
          // Auth seed only needs a valid cwd; Docker has no /vercel/sandbox.
          cwd: isVercel ? VERCEL_WORKSPACE : DOCKER_WORKSPACE,
        }).pipe(
          Effect.catch((error: VercelRemoteSetupError | SandboxProviderError) =>
            failProvision(
              error._tag === "VercelRemoteSetupError"
                ? new SandboxRpcError({ reason: "provision-failed", message: error.message })
                : mapDriverError(error),
            ),
          ),
        );

        const workspacePath = isVercel ? VERCEL_WORKSPACE : DOCKER_WORKSPACE;

        // Docker: shallow-clone the selected source into /workspace after auth seed.
        // Vercel: native SDK clone already populated /vercel/sandbox at provision.
        if (isDocker) {
          yield* cloneGitHubSourceIntoWorkspace({
            driver: inst.driver,
            handle,
            httpsUrl: githubSource.httpsUrl,
            branch: githubSource.branch,
            workspacePath: DOCKER_WORKSPACE,
          }).pipe(
            Effect.catch((error: DockerRemoteSetupError | SandboxProviderError) =>
              failProvision(
                error._tag === "DockerRemoteSetupError"
                  ? new SandboxRpcError({ reason: "provision-failed", message: error.message })
                  : mapDriverError(error),
              ),
            ),
          );
        }

        const remoteRaw = yield* (
          isVercel
            ? readRemoteEnvironmentConfig(inst.driver, handle)
            : readDockerRemoteEnvironmentConfig(inst.driver, handle, workspacePath)
        ).pipe(
          Effect.catch(
            (error: VercelRemoteSetupError | DockerRemoteSetupError | SandboxProviderError) =>
              failProvision(
                error._tag === "VercelRemoteSetupError" || error._tag === "DockerRemoteSetupError"
                  ? new SandboxRpcError({ reason: "invalid-config", message: error.message })
                  : mapDriverError(error),
              ),
          ),
        );
        const repoFileConfig =
          remoteRaw !== null
            ? yield* decodeEnvironmentConfigText(
                remoteRaw,
                `${workspacePath}/.kata/environment.json`,
              ).pipe(Effect.mapError(mapLoadError), Effect.catch(failProvision))
            : undefined;
        const loadedResolved = resolveLoadedEnvironmentConfig({
          ...(repoFileConfig !== undefined ? { repoFileConfig } : {}),
          repositoryKey: githubSource.repositoryKey,
          savedSandboxEnvironments: settings.savedSandboxEnvironments,
        }).resolved;
        if (loadedResolved.build?.dockerfile !== undefined && isVercel) {
          return yield* failProvision(
            new SandboxRpcError({
              reason: "invalid-config",
              message:
                ".kata/environment.json requests a Dockerfile build, which the Vercel sandbox driver does not support. Use a local Docker deployment target for this repository.",
            }),
          );
        }
        yield* runSandboxSetup({
          driver: inst.driver,
          handle,
          resolved: loadedResolved,
          secretValues,
          workspace: { path: workspacePath },
        }).pipe(
          Effect.catch((error: SetupFailed | SandboxProviderError) =>
            failProvision(
              error._tag === "SetupFailed" ? mapSetupFailed(error) : mapDriverError(error),
            ),
          ),
        );
      }

      // Drivers that adopt existing runtimes (Docker) may need the create-time
      // bootstrap token rather than the one minted above.
      const provisionBootstrapToken = yield* resolveBootstrapToken(
        inst.driver,
        handle,
        bootstrapToken,
      ).pipe(Effect.catch(failProvision));

      const finalized = yield* runtime.registerAndFinalizeSession({
        sessionKey,
        instanceId,
        driver: inst.driver,
        handle,
        config: resolvedConfig,
        bootstrapToken: provisionBootstrapToken,
        connectAuthToken: options?.connectAuthToken,
      });

      // Persist the session record (logs on failure rather than swallowing).
      // A GitHub source records its non-secret fingerprint so lifecycle start
      // can reject a changed source.
      const provisionFingerprint =
        githubSource !== null
          ? sourceFingerprint({
              repositoryKey: githubSource.repositoryKey,
              branch: githubSource.branch,
            })
          : undefined;
      yield* runtime.persistSessionRecord({
        instanceId,
        driver: inst.driver,
        handle,
        config: resolvedConfig,
        environmentId: finalized.environmentId,
        endpoint: finalized.endpoint,
        relay: finalized.relay,
        status: "running",
        ...(provisionFingerprint !== undefined ? { sourceFingerprint: provisionFingerprint } : {}),
      });

      // Cache the live session.
      runtime.liveSessions.set(sessionKey, {
        handle,
        driver: inst.driver,
        instanceConfig: resolvedConfig,
        environmentId: finalized.environmentId,
        adminAccessToken: finalized.adminAccessToken,
      });

      return {
        instanceId,
        environmentId: finalized.environmentId,
        pairingToken: finalized.pairingToken,
        endpoint: finalized.endpoint,
      };
    }).pipe(Effect.ensuring(Effect.sync(() => runtime.busyInstances.delete(sessionKey))));
  });
