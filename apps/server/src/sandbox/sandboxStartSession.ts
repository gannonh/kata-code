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
import { DockerSandboxProvider } from "@kata-sh/code-sandbox-docker";
import { VERCEL_KIND, VERCEL_SOURCE_TOKEN_ENV } from "@kata-sh/code-sandbox-vercel";

import type * as CliTokenManager from "../cloud/CliTokenManager.ts";
import {
  decodeEnvironmentConfigText,
  loadEnvironmentConfig,
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
import { resolveVercelSource, sourceFingerprint } from "./vercelGitHubSource.ts";
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
  readonly store: SandboxSessionStore;
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
      // Provider status while this instance is locked (full reconcile skips busy).
      yield* runtime.refreshLockedInstanceStatus(sessionKey, settings);
      const existing = runtime.store.records.find((r) => r.instanceId === sessionKey);
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
        // Reject a changed source: a record created with a source fingerprint
        // must start against a resolvable, matching current source. A removed
        // or edited source (including one cleared from settings) fails loud;
        // delete and recreate to re-clone.
        if (existing.sourceFingerprint !== undefined) {
          const startSource = resolveVercelSource(resolvedConfig.config);
          const currentFingerprint =
            startSource !== null
              ? sourceFingerprint({
                  repositoryKey: startSource.repositoryKey,
                  branch: startSource.branch,
                })
              : undefined;
          if (currentFingerprint !== existing.sourceFingerprint) {
            return yield* new SandboxRpcError({
              reason: "invalid-config",
              message:
                "The sandbox source changed since it was created. Delete this sandbox and create it again to clone the new source.",
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
        // Docker env is fixed at container create: the restarted in-container
        // server re-seeds its ORIGINAL create-time bootstrap grant, not the
        // fresh token minted above. Recover the effective token from the
        // container env so the exchange matches what the server booted with.
        // (Vercel relaunches `serve` with the fresh env, so it keeps the
        // fresh token.)
        let effectiveBootstrapToken = bootstrapToken;
        if ((inst.driver.kind as string) === (DockerSandboxProvider.kind as string)) {
          const recovered = yield* inst.driver
            .exec(started, "printenv KATACODE_DESKTOP_BOOTSTRAP_TOKEN")
            .pipe(Effect.mapError(mapDriverError));
          const token = recovered.stdout.trim();
          if (token.length === 0) {
            return yield* new SandboxRpcError({
              reason: "connect-failed",
              message:
                "Started container has no KATACODE_DESKTOP_BOOTSTRAP_TOKEN in its environment; delete the sandbox and create it again.",
            });
          }
          effectiveBootstrapToken = token;
        }
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
      // Vercel clones a selected GitHub repo/branch natively; Docker seeds the
      // selected local worktree. Resolve the Vercel source from config.
      const vercelSource = isVercel ? resolveVercelSource(resolvedConfig.config) : null;
      if (isVercel && options?.repository !== undefined) {
        return yield* new SandboxRpcError({
          reason: "invalid-config",
          message:
            "Vercel sandboxes clone their GitHub source; a local repository cannot be provided.",
        });
      }
      if (isVercel && vercelSource === null) {
        return yield* new SandboxRpcError({
          reason: "invalid-config",
          message:
            "Select a GitHub repository and branch for this Vercel sandbox before creating it.",
        });
      }

      // @effect-diagnostics-next-line effect(globalDateInEffect):off - random token, not a clock read.
      const bootstrapToken = NodeCrypto.randomBytes(24).toString("hex");

      // Saved per-repo env keys off the local repo (Docker) or the Vercel
      // source's canonical GitHub key.
      const savedEnvKey =
        options?.repository !== undefined
          ? RepositoryCanonicalKey.make(options.repository.repositoryIdentity.canonicalKey)
          : vercelSource !== null
            ? RepositoryCanonicalKey.make(vercelSource.repositoryKey)
            : undefined;
      const savedEnv =
        savedEnvKey !== undefined ? settings.savedSandboxEnvironments[savedEnvKey] : undefined;

      const { env, secretValues } = buildProvisionEnvironment({
        bootstrapToken,
        instanceEnvironment: config.environment,
        savedEnvironment: savedEnv?.environment,
      });

      // Resolve the active host GitHub token for the Vercel native clone +
      // in-sandbox gh auth seed. Missing/unauthenticated fails before create.
      const githubToken =
        vercelSource !== null
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
      // The transient source token is appended only for the create call; the
      // Vercel driver extracts it for the native source and excludes it from
      // the sandbox env. It is never persisted or seeded via env.
      const provisionEnv =
        githubToken !== undefined
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

      // ── Vercel native-source setup: seed gh auth, read remote config, run
      //    setup in /vercel/sandbox. ──
      if (vercelSource !== null) {
        // Seed authenticated gh/Git into the persistent sandbox filesystem.
        // @effect-diagnostics-next-line effect(globalDateInEffect):off - random nonce, not a clock read.
        const authNonce = NodeCrypto.randomBytes(8).toString("hex");
        yield* seedGitHubAuth({
          driver: inst.driver,
          handle,
          token: githubToken as string,
          nonce: authNonce,
        }).pipe(
          Effect.catch((error: VercelRemoteSetupError | SandboxProviderError) =>
            failProvision(
              error._tag === "VercelRemoteSetupError"
                ? new SandboxRpcError({ reason: "provision-failed", message: error.message })
                : mapDriverError(error),
            ),
          ),
        );

        const remoteRaw = yield* readRemoteEnvironmentConfig(inst.driver, handle).pipe(
          Effect.catch((error: VercelRemoteSetupError | SandboxProviderError) =>
            failProvision(
              error._tag === "VercelRemoteSetupError"
                ? new SandboxRpcError({ reason: "invalid-config", message: error.message })
                : mapDriverError(error),
            ),
          ),
        );
        const repoFileConfig =
          remoteRaw !== null
            ? yield* decodeEnvironmentConfigText(
                remoteRaw,
                `${VERCEL_WORKSPACE}/.kata/environment.json`,
              ).pipe(Effect.mapError(mapLoadError), Effect.catch(failProvision))
            : undefined;
        const loadedResolved = resolveLoadedEnvironmentConfig({
          ...(repoFileConfig !== undefined ? { repoFileConfig } : {}),
          repositoryKey: vercelSource.repositoryKey,
          savedSandboxEnvironments: settings.savedSandboxEnvironments,
        }).resolved;
        if (loadedResolved.build?.dockerfile !== undefined) {
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
          workspace: { path: VERCEL_WORKSPACE },
        }).pipe(
          Effect.catch((error: SetupFailed | SandboxProviderError) =>
            failProvision(
              error._tag === "SetupFailed" ? mapSetupFailed(error) : mapDriverError(error),
            ),
          ),
        );
      } else if (options?.repository !== undefined) {
        const loaded = yield* loadEnvironmentConfig({
          repoRoot: options.repository.repoRoot,
          repositoryIdentity: options.repository.repositoryIdentity,
          savedSandboxEnvironments: settings.savedSandboxEnvironments,
        }).pipe(Effect.mapError(mapLoadError), Effect.catch(failProvision));

        if (
          loaded.resolved.build?.dockerfile !== undefined &&
          (inst.driver.kind as string) !== "docker"
        ) {
          return yield* failProvision(
            new SandboxRpcError({
              reason: "invalid-config",
              message: `.kata/environment.json requests a Dockerfile build, which the "${inst.driver.kind as string}" sandbox driver does not support. Use a local Docker deployment target for this repository.`,
            }),
          );
        }

        yield* runSandboxSetup({
          driver: inst.driver,
          handle,
          resolved: loaded.resolved,
          secretValues,
          seed: { repoRoot: options.repository.repoRoot },
        }).pipe(
          Effect.catch((error: SetupFailed | SandboxProviderError) =>
            failProvision(
              error._tag === "SetupFailed" ? mapSetupFailed(error) : mapDriverError(error),
            ),
          ),
        );
      }

      const finalized = yield* runtime.registerAndFinalizeSession({
        sessionKey,
        instanceId,
        driver: inst.driver,
        handle,
        config: resolvedConfig,
        bootstrapToken,
        connectAuthToken: options?.connectAuthToken,
      });

      // Persist the session record (logs on failure rather than swallowing).
      // A Vercel source records its non-secret fingerprint so lifecycle start
      // can reject a changed source.
      const provisionFingerprint =
        vercelSource !== null
          ? sourceFingerprint({
              repositoryKey: vercelSource.repositoryKey,
              branch: vercelSource.branch,
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
