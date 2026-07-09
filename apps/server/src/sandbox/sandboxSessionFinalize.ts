/**
 * Post-provision / start-from-stopped finalization: reachability → Connect
 * registration → pairing credential → provider refresh.
 *
 * @module sandboxSessionFinalize
 */
import * as Effect from "effect/Effect";

import type { AdvertisedEndpoint } from "@kata-sh/code-contracts";
import type { SandboxProviderInstanceId } from "@kata-sh/code-contracts/sandboxProviderInstance";
import type { SandboxProviderInstanceConfig } from "@kata-sh/code-contracts/sandboxProviderInstance";
import type { SandboxStartSessionInput } from "@kata-sh/code-contracts/sandboxRpc";
import { SandboxRpcError } from "@kata-sh/code-contracts/sandboxRpc";
import type { SandboxHandle, SandboxProvider } from "@kata-sh/code-sandbox/driver";
import { VERCEL_KIND } from "@kata-sh/code-sandbox-vercel";
import type { RelayManagedEndpointProviderKind } from "@kata-sh/code-contracts/relay";
import { createAdvertisedEndpoint } from "@kata-sh/code-shared/advertisedEndpoint";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import {
  withConnectAuthHint,
  registerSandboxWithConnect,
  issueSandboxPairingCredential,
  refreshSandboxProviders,
} from "./sandboxConnect.ts";
import { mapDriverError } from "./sandboxProvisionHelpers.ts";
import {
  resolveSandboxPort,
  SANDBOX_ENDPOINT_PROVIDER,
  VERCEL_ENDPOINT_PROVIDER,
} from "./sandboxSessionHelpers.ts";

/** Dispose a provisioned sandbox after a post-provision failure. */
export function disposeAfterFailure(
  sessionKey: string,
  driver: SandboxProvider,
  handle: SandboxHandle,
  removeStoreRecord: (sessionKey: string) => Effect.Effect<void, never>,
): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    yield* Effect.ignore(removeStoreRecord(sessionKey));
    yield* driver.dispose(handle).pipe(
      Effect.catch((disposeError) =>
        Effect.logWarning("Could not dispose sandbox after startSession failure", {
          cause: disposeError,
        }),
      ),
    );
  });
}

/** Shared post-provision/start finalization. */
export function registerAndFinalizeSession(input: {
  readonly sessionKey: string;
  readonly instanceId: SandboxProviderInstanceId;
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
  readonly config: SandboxProviderInstanceConfig;
  readonly bootstrapToken: string;
  readonly connectAuthToken: SandboxStartSessionInput["connectAuthToken"];
  /** Failure cleanup policy. `dispose` (default) deletes the sandbox — only
   *  correct for the fresh-provision path. The start-from-stopped path MUST
   *  pass `keep`. */
  readonly failureCleanup?: "dispose" | "keep";
  readonly removeStoreRecord: (sessionKey: string) => Effect.Effect<void, never>;
}): Effect.Effect<
  {
    readonly environmentId: string;
    readonly adminAccessToken: string;
    readonly relay: { readonly relayUrl: string; readonly bearerToken: string } | null;
    readonly pairingToken: string;
    readonly endpoint: AdvertisedEndpoint;
  },
  SandboxRpcError,
  CliTokenManager.CloudCliTokenManager
> {
  return Effect.gen(function* () {
    const driverConfig = input.config.config;
    const cleanupOnFailure =
      input.failureCleanup === "keep"
        ? Effect.void
        : disposeAfterFailure(
            input.sessionKey,
            input.driver,
            input.handle,
            input.removeStoreRecord,
          );
    const reach = yield* input.driver
      .reachability(input.handle, resolveSandboxPort(driverConfig))
      .pipe(
        Effect.mapError(mapDriverError),
        Effect.catch((error: SandboxRpcError) =>
          cleanupOnFailure.pipe(Effect.andThen(Effect.fail(error))),
        ),
      );
    const isVercel = (input.driver.kind as string) === (VERCEL_KIND as string);
    const endpointProvider = isVercel ? VERCEL_ENDPOINT_PROVIDER : SANDBOX_ENDPOINT_PROVIDER;
    const endpoint: AdvertisedEndpoint = createAdvertisedEndpoint({
      id: `sandbox-${input.instanceId as string}`,
      label:
        input.config.displayName ??
        (isVercel
          ? `Vercel ${input.instanceId as string}`
          : `Container ${input.instanceId as string}`),
      provider: endpointProvider,
      httpBaseUrl: reach.httpBaseUrl,
      reachability: reach.reachabilityKind,
      source: "server",
    });
    const isLoopback = reach.reachabilityKind === "loopback";
    const connectBaseUrl = isLoopback
      ? reach.httpBaseUrl.replace("localhost", "127.0.0.1")
      : reach.httpBaseUrl;
    const connectUrl = new URL(connectBaseUrl);
    const connectOrigin = isLoopback
      ? { localHttpHost: "127.0.0.1", localHttpPort: Number(connectUrl.port || 80) }
      : { localHttpHost: connectUrl.hostname, localHttpPort: Number(connectUrl.port || 443) };
    const endpointProviderKind = (
      isLoopback ? "cloudflare_tunnel" : "manual"
    ) as RelayManagedEndpointProviderKind;
    const { descriptor, adminAccessToken, relay } = yield* registerSandboxWithConnect({
      httpBaseUrl: connectBaseUrl,
      bootstrapToken: input.bootstrapToken,
      connectAuthToken: input.connectAuthToken,
      endpointProviderKind,
      origin: connectOrigin,
    }).pipe(
      Effect.catch((error: SandboxRpcError) =>
        cleanupOnFailure.pipe(
          Effect.andThen(
            Effect.fail(
              new SandboxRpcError({
                reason: "connect-failed",
                message: withConnectAuthHint(`Connect auto-registration failed: ${error.message}`),
              }),
            ),
          ),
        ),
      ),
    );
    const pairingToken = yield* issueSandboxPairingCredential({
      httpBaseUrl: connectBaseUrl,
      adminAccessToken,
    }).pipe(
      Effect.catch((error: SandboxRpcError) =>
        cleanupOnFailure.pipe(
          Effect.andThen(
            Effect.fail(
              new SandboxRpcError({
                reason: "connect-failed",
                message: `Could not issue a sandbox pairing credential: ${error.message}`,
              }),
            ),
          ),
        ),
      ),
    );
    yield* refreshSandboxProviders({
      httpBaseUrl: connectBaseUrl,
      adminAccessToken,
    }).pipe(
      Effect.catchTag("SandboxRpcError", (error: SandboxRpcError) =>
        Effect.logWarning("Could not refresh sandbox providers after credential seed", {
          message: error.message,
        }).pipe(Effect.asVoid),
      ),
    );
    return {
      environmentId: descriptor.environmentId,
      adminAccessToken,
      relay: relay ?? null,
      pairingToken,
      endpoint,
    };
  });
}
