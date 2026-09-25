import * as NodeCrypto from "node:crypto";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Context from "effect/Context";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import { EnvironmentId } from "@kata-sh/code-contracts";
import {
  RelayApi,
  RelayClientAuth,
  RelayClientPrincipal,
  RelayEnvironmentAuth,
  RelayEnvironmentCredentialRefreshRequest,
  RelayEnvironmentPrincipal,
  type RelayClientDeviceRecord,
} from "@kata-sh/code-contracts/relay";
import { wireEnvironmentIssuer } from "@kata-sh/code-contracts/wireIdentity";
import {
  RELAY_ENVIRONMENT_CREDENTIAL_REFRESH_TYP,
  RELAY_MANAGED_TUNNEL_RECOVERY_TYP,
  signRelayJwt,
} from "@kata-sh/code-shared/relayJwt";

import {
  RELAY_HTTP_ROUTER_CONFIG,
  RELAY_REQUEST_DEADLINE_MS,
  clientApi,
  relayCors,
  relayDocsRedirectRoute,
  relayEnvironmentAuthLayer,
  relayNotFoundRoute,
  recoverEnvironmentTunnelRecord,
  registerEnvironmentTunnelRecovery,
  relayDpopFailureReason,
  revokeEnvironmentLinkRecord,
  serverApi,
  traceRelayHttpRequestWith,
  unlinkEnvironmentRecord,
  verifyRelayClientBearerToken,
  verifyEnvironmentTunnelRecoveryProof,
  withoutCapturedParentSpan,
} from "./Api.ts";
import * as RelayConfiguration from "../Config.ts";
import * as RelayDb from "../db.ts";
import * as AgentActivityPublisher from "../agentActivity/AgentActivityPublisher.ts";
import * as EnvironmentCredentials from "../environments/EnvironmentCredentials.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as ManagedEndpointAllocations from "../environments/ManagedEndpointAllocations.ts";
import * as EnvironmentPublishSignatures from "../environments/EnvironmentPublishSignatures.ts";
import * as ManagedEndpointProvider from "../environments/ManagedEndpointProvider.ts";
import * as LinearOAuthBroker from "../linear/LinearOAuthBroker.ts";
import * as EnvironmentLinker from "../environments/EnvironmentLinker.ts";
import * as DpopProofs from "../auth/DpopProofs.ts";
import * as RelayTokens from "../auth/RelayTokens.ts";
import * as Devices from "../agentActivity/Devices.ts";

vi.mock("@clerk/backend", () => ({
  createClerkClient: vi.fn(),
  verifyToken: vi.fn(),
}));

const relaySettings: RelayConfiguration.RelayConfiguration["Service"] = {
  relayIssuer: "https://relay.example.test",
  apns: {
    teamId: "apns-team",
    keyId: "apns-key",
    privateKey: Redacted.make("apns-private-key"),
    bundleId: "com.example.t3",
    environment: "sandbox",
  },
  clerkSecretKey: Redacted.make("clerk-secret-key"),
  clerkPublishableKey: "pk_test_test",
  clerkJwtAudience: "kata-code-relay",
  apnsDeliveryJobSigningSecret: Redacted.make("apns-delivery-secret"),
  cloudMintPrivateKey: Redacted.make("cloud-mint-private-key"),
  cloudMintPublicKey: "cloud-mint-public-key",
  linearOAuth: null,
  managedEndpointBaseDomain: undefined,
  managedEndpointNamespace: undefined,
};

describe("device listing compatibility", () => {
  it.effect("keeps v1 iOS-only while v2 returns every platform for the same account", () => {
    const iphone: RelayClientDeviceRecord = {
      deviceId: "iphone",
      label: "iPhone",
      platform: "ios",
      iosMajorVersion: 18,
      appVersion: "1.0.0",
      notifications: {
        enabled: true,
        notifyOnApproval: true,
        notifyOnInput: true,
        notifyOnCompletion: true,
        notifyOnFailure: true,
      },
      liveActivities: { enabled: true },
      updatedAt: "2026-09-09T00:00:00.000Z",
    };
    const android: RelayClientDeviceRecord = {
      ...iphone,
      deviceId: "android",
      label: "Android",
      platform: "android",
      iosMajorVersion: null,
      androidApiLevel: 36,
    };
    const handlers = clientApi.pipe(
      HttpRouter.provideRequest(
        Layer.mergeAll(
          Layer.mock(EnvironmentCredentials.EnvironmentCredentials, {}),
          Layer.mock(EnvironmentLinks.EnvironmentLinks, {}),
          Layer.mock(ManagedEndpointProvider.ManagedEndpointProvider, {}),
          Layer.mock(RelayDb.RelayTransactions, {}),
          Layer.mock(LinearOAuthBroker.LinearOAuthBroker, {}),
        ),
      ),
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(RelayConfiguration.RelayConfiguration, relaySettings),
          NodeCryptoLayer.layer,
          Layer.mock(RelayTokens.RelayTokens, { resolveDpopAccessTokenScopes: () => null }),
          Layer.mock(EnvironmentLinker.EnvironmentLinker, {}),
          Layer.mock(EnvironmentLinks.EnvironmentLinks, {}),
          Layer.mock(ManagedEndpointProvider.ManagedEndpointProvider, {}),
          Layer.mock(DpopProofs.DpopProofReplay, {}),
          Layer.mock(Devices.Devices, {
            listForUser: ({ userId }) => {
              expect(userId).toBe("user-1");
              return Effect.succeed([iphone, android]);
            },
          }),
        ),
      ),
      Layer.provideMerge(
        Layer.succeed(RelayClientAuth, {
          clientBearer: (effect) =>
            Effect.provideService(effect, RelayClientPrincipal, {
              userId: "user-1",
              token: "test-token",
            }),
        }),
      ),
    );
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            HttpApiBuilder.layer(HttpApi.make("RelayApi").add(RelayApi.groups.client)).pipe(
              Layer.provide(handlers),
              Layer.provide(HttpServer.layerServices),
            ),
            { disableLogger: true },
          ),
        ),
        (app) => Effect.promise(() => app.dispose()),
      );
      for (const [version, devices] of [
        ["v1", [iphone]],
        ["v2", [iphone, android]],
      ] as const) {
        const response = yield* Effect.promise(() =>
          app.handler(
            new Request(`https://relay.example.test/${version}/client/devices`, {
              headers: { authorization: "Bearer test-token" },
            }),
          ),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(yield* Effect.promise(() => response.json())).toEqual({ devices });
      }
    }).pipe(Effect.scoped);
  });
});

describe("relay client authentication", () => {
  it.effect("preserves the existing Clerk session JWT path", () =>
    Effect.gen(function* () {
      vi.mocked(verifyToken).mockResolvedValue({
        sub: "user_session",
        aud: relaySettings.clerkJwtAudience,
      } as never);

      expect(yield* verifyRelayClientBearerToken(relaySettings, "session-token")).toEqual({
        sub: "user_session",
        mode: "clerk_session_bearer",
      });
      expect(verifyToken).toHaveBeenCalledWith("session-token", {
        secretKey: "clerk-secret-key",
        audience: relaySettings.clerkJwtAudience,
      });
      expect(createClerkClient).not.toHaveBeenCalled();
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.mocked(verifyToken).mockReset();
          vi.mocked(createClerkClient).mockReset();
        }),
      ),
    ),
  );

  it.effect("falls back to Clerk OAuth token verification for the headless CLI", () =>
    Effect.gen(function* () {
      vi.mocked(verifyToken).mockRejectedValue(new Error("not a session JWT"));
      vi.mocked(createClerkClient).mockReturnValue({
        authenticateRequest: vi.fn().mockResolvedValue({
          isAuthenticated: true,
          toAuth: () => ({ userId: "user_oauth" }),
        }),
      } as never);

      expect(yield* verifyRelayClientBearerToken(relaySettings, "oauth-token")).toEqual({
        sub: "user_oauth",
        mode: "clerk_oauth_bearer",
      });
      expect(createClerkClient).toHaveBeenCalledWith({
        secretKey: "clerk-secret-key",
        publishableKey: "pk_test_test",
      });
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.mocked(verifyToken).mockReset();
          vi.mocked(createClerkClient).mockReset();
        }),
      ),
    ),
  );
});

describe("relay DPoP failure mapping", () => {
  it("maps verifier failures to safe client-facing categories", () => {
    const mappings = [
      ["time_window", "time_window"],
      ["key_mismatch", "key_mismatch"],
      ["method_mismatch", "request_mismatch"],
      ["url_mismatch", "request_mismatch"],
      ["access_token_hash_mismatch", "token_mismatch"],
      ["replayed", "replay"],
      ["missing_proof", "invalid_proof"],
      ["malformed_proof", "invalid_proof"],
      ["invalid_signature", "invalid_proof"],
      ["invalid_proof", "invalid_proof"],
    ] as const;

    for (const [code, expected] of mappings) {
      expect(relayDpopFailureReason(code)).toBe(expected);
    }
  });
});

describe("relay environment authentication", () => {
  it.effect("preserves credential lookup persistence failures as internal errors", () => {
    const failure = new EnvironmentCredentials.EnvironmentCredentialAuthenticatePersistenceError({
      stage: "lookup-credential",
      cause: "database unavailable",
    });
    const credentials: EnvironmentCredentials.EnvironmentCredentials["Service"] = {
      create: () => Effect.die("unused create"),
      authenticate: () => Effect.fail(failure),
      revokeForEnvironmentPublicKey: () => Effect.die("unused revoke"),
    };

    return Effect.gen(function* () {
      const auth = yield* RelayEnvironmentAuth;
      const error = yield* Effect.flip(
        auth.environmentBearer(Effect.succeed(HttpServerResponse.empty()), {
          credential: Redacted.make("environment-credential"),
          endpoint: {} as never,
          group: {} as never,
        }),
      );

      expect(Predicate.isTagged(error, "RelayInternalError")).toBe(true);
      if (Predicate.isTagged(error, "RelayInternalError")) {
        expect(error.reason).toBe("persistence_failed");
      }
    }).pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request("https://relay.test/v1/server/link")),
      ),
      Effect.provideService(HttpServerRequest.ParsedSearchParams, {}),
      Effect.provideService(HttpRouter.RouteContext, {
        params: {},
        route: {} as never,
      }),
      Effect.provide(
        relayEnvironmentAuthLayer.pipe(
          Layer.provide(Layer.succeed(EnvironmentCredentials.EnvironmentCredentials, credentials)),
        ),
      ),
      Effect.scoped,
    );
  });
});

function relayUnlinkTestLayer(input?: {
  readonly withTransaction?: RelayDb.RelayTransactions["Service"]["withTransaction"];
  readonly getForUser?: EnvironmentLinks.EnvironmentLinks["Service"]["getForUser"];
  readonly revokeForUser?: EnvironmentLinks.EnvironmentLinks["Service"]["revokeForUser"];
  readonly revokeCredential?: EnvironmentCredentials.EnvironmentCredentials["Service"]["revokeForEnvironmentPublicKey"];
  readonly prepareDeprovision?: ManagedEndpointProvider.ManagedEndpointProvider["Service"]["prepareDeprovision"];
  readonly deprovision?: ManagedEndpointProvider.ManagedEndpointProvider["Service"]["deprovision"];
  readonly revokeLinearGrants?: LinearOAuthBroker.LinearOAuthBroker["Service"]["revokeForEnvironment"];
  readonly provision?: ManagedEndpointProvider.ManagedEndpointProvider["Service"]["provision"];
  readonly reconcileOrigin?: ManagedEndpointProvider.ManagedEndpointProvider["Service"]["reconcileOrigin"];
  readonly release?: ManagedEndpointProvider.ManagedEndpointProvider["Service"]["release"];
}) {
  return Layer.mergeAll(
    Layer.mock(LinearOAuthBroker.LinearOAuthBroker, {
      revokeForEnvironment: input?.revokeLinearGrants ?? (() => Effect.void),
    }),
    Layer.succeed(
      RelayDb.RelayTransactions,
      RelayDb.RelayTransactions.of({
        withTransaction: input?.withTransaction ?? ((effect) => effect),
      }),
    ),
    Layer.succeed(
      EnvironmentLinks.EnvironmentLinks,
      EnvironmentLinks.EnvironmentLinks.of({
        upsert: () => Effect.die("unused upsert"),
        listUsersForEnvironmentPublicKey: () =>
          Effect.die("unused listUsersForEnvironmentPublicKey"),
        listDeliveryUsersForEnvironment: () => Effect.die("unused listDeliveryUsersForEnvironment"),
        listForUser: () => Effect.die("unused listForUser"),
        getForUser: input?.getForUser ?? (() => Effect.succeed(null)),
        revokeForUser: input?.revokeForUser ?? (() => Effect.succeed(false)),
      }),
    ),
    Layer.succeed(
      EnvironmentCredentials.EnvironmentCredentials,
      EnvironmentCredentials.EnvironmentCredentials.of({
        create: () => Effect.die("unused create"),
        authenticate: () => Effect.die("unused authenticate"),
        revokeForEnvironmentPublicKey: input?.revokeCredential ?? (() => Effect.succeed(false)),
      }),
    ),
    Layer.succeed(
      ManagedEndpointProvider.ManagedEndpointProvider,
      ManagedEndpointProvider.ManagedEndpointProvider.of({
        provision: input?.provision ?? (() => Effect.die("unused provision")),
        reconcileOrigin: input?.reconcileOrigin ?? (() => Effect.succeed("ready")),
        prepareDeprovision: input?.prepareDeprovision ?? (() => Effect.succeed(null)),
        deprovision: input?.deprovision ?? (() => Effect.succeed(true)),
        release: input?.release ?? (() => Effect.die("unused release")),
      }),
    ),
  );
}

const linkedEnvironmentRecord = {
  environmentId: EnvironmentId.make("environment-1"),
  label: "Environment 1",
  endpoint: {
    httpBaseUrl: "https://environment-1.example.test/",
    wsBaseUrl: "wss://environment-1.example.test/ws",
    providerKind: "cloudflare_tunnel",
  },
  environmentPublicKey: "public-key",
  linkedAt: "2026-07-28T00:00:00.000Z",
} as const;

describe("relay managed tunnel recovery", () => {
  it.effect("binds recovery requests to the host, cloud user, and T3 service origin", () =>
    Effect.gen(function* () {
      const keyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const now = yield* DateTime.now;
      const issuedAt = Math.floor(now.epochMilliseconds / 1_000);
      const proof = yield* signRelayJwt({
        privateKey: keyPair.privateKey,
        typ: RELAY_MANAGED_TUNNEL_RECOVERY_TYP,
        payload: {
          iss: wireEnvironmentIssuer("environment-1"),
          aud: "https://relay.example.test",
          sub: "environment-1",
          jti: "recovery-proof",
          iat: issuedAt,
          exp: issuedAt + 60,
          action: "recover",
          environmentId: "environment-1",
          cloudUserId: "user-1",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        },
      });
      const request = {
        action: "recover" as const,
        proof,
        userId: "user-1",
        environmentId: "environment-1",
        environmentPublicKey: keyPair.publicKey,
        origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
      };

      yield* verifyEnvironmentTunnelRecoveryProof(request);

      const wrongOwner = yield* Effect.flip(
        verifyEnvironmentTunnelRecoveryProof({ ...request, userId: "user-2" }),
      );
      expect(wrongOwner).toMatchObject({ _tag: "Unauthorized" });

      const wrongOrigin = yield* Effect.flip(
        verifyEnvironmentTunnelRecoveryProof({
          ...request,
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 5432 },
        }),
      );
      expect(wrongOrigin).toMatchObject({ _tag: "Unauthorized" });

      const wrongAction = yield* Effect.flip(
        verifyEnvironmentTunnelRecoveryProof({
          action: "register",
          proof,
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: keyPair.publicKey,
          tunnelId: "existing-tunnel",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        }),
      );
      expect(wrongAction).toMatchObject({ _tag: "Unauthorized" });
    }).pipe(Effect.provideService(RelayConfiguration.RelayConfiguration, relaySettings)),
  );

  it.effect("rejects a signed registration proof for a different origin", () =>
    Effect.gen(function* () {
      const keyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const now = yield* DateTime.now;
      const issuedAt = Math.floor(now.epochMilliseconds / 1_000);
      const proof = yield* signRelayJwt({
        privateKey: keyPair.privateKey,
        typ: RELAY_MANAGED_TUNNEL_RECOVERY_TYP,
        payload: {
          iss: wireEnvironmentIssuer("environment-1"),
          aud: "https://relay.example.test",
          sub: "environment-1",
          jti: "registration-origin-proof",
          iat: issuedAt,
          exp: issuedAt + 60,
          action: "register",
          environmentId: "environment-1",
          cloudUserId: "user-1",
          tunnelId: "existing-tunnel",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        },
      });

      const error = yield* Effect.flip(
        verifyEnvironmentTunnelRecoveryProof({
          action: "register",
          proof,
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: keyPair.publicKey,
          tunnelId: "existing-tunnel",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 5432 },
        }),
      );

      expect(error).toMatchObject({ _tag: "Unauthorized" });
    }).pipe(Effect.provideService(RelayConfiguration.RelayConfiguration, relaySettings)),
  );

  it.effect("registers recovery for an existing tunnel without provisioning it", () => {
    let recoveryEnabledFor: {
      readonly userId: string;
      readonly environmentId: string;
      readonly tunnelId: string;
      readonly environmentPublicKey: string;
      readonly origin: { readonly localHttpHost: string; readonly localHttpPort: number };
    } | null = null;

    return Effect.gen(function* () {
      expect(
        yield* registerEnvironmentTunnelRecovery({
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: "public-key",
          tunnelId: "existing-tunnel",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        }),
      ).toEqual({ status: "ready" });
      expect(recoveryEnabledFor).toEqual({
        userId: "user-1",
        environmentId: "environment-1",
        tunnelId: "existing-tunnel",
        environmentPublicKey: "public-key",
        origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
      });
    }).pipe(
      Effect.provide(
        Layer.merge(
          relayUnlinkTestLayer({
            getForUser: () => Effect.succeed(linkedEnvironmentRecord),
            provision: () => Effect.die("registration must not provision a tunnel"),
          }),
          Layer.mock(ManagedEndpointAllocations.ManagedEndpointAllocations)({
            enableRecovery: (input) =>
              Effect.sync(() => {
                recoveryEnabledFor = input;
                return true;
              }),
          }),
        ),
      ),
    );
  });

  it.effect("requests recovery without enabling a stale tunnel", () => {
    let recoveryEnabled = false;

    return Effect.gen(function* () {
      expect(
        yield* registerEnvironmentTunnelRecovery({
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: "public-key",
          tunnelId: "deleted-tunnel",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        }),
      ).toEqual({ status: "recovery_required" });
      expect(recoveryEnabled).toBe(false);
    }).pipe(
      Effect.provide(
        Layer.merge(
          relayUnlinkTestLayer({
            getForUser: () => Effect.succeed(linkedEnvironmentRecord),
            reconcileOrigin: () => Effect.succeed("recovery_required"),
          }),
          Layer.mock(ManagedEndpointAllocations.ManagedEndpointAllocations)({
            enableRecovery: () =>
              Effect.sync(() => {
                recoveryEnabled = true;
                return true;
              }),
          }),
        ),
      ),
    );
  });

  it.effect("rejects recovery registration for a different environment key", () => {
    let recoveryEnabled = false;

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        registerEnvironmentTunnelRecovery({
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: "different-public-key",
          tunnelId: "existing-tunnel",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        }),
      );

      expect(error).toMatchObject({ _tag: "Unauthorized" });
      expect(recoveryEnabled).toBe(false);
    }).pipe(
      Effect.provide(
        Layer.merge(
          relayUnlinkTestLayer({
            getForUser: () => Effect.succeed(linkedEnvironmentRecord),
          }),
          Layer.mock(ManagedEndpointAllocations.ManagedEndpointAllocations)({
            enableRecovery: () =>
              Effect.sync(() => {
                recoveryEnabled = true;
                return true;
              }),
          }),
        ),
      ),
    );
  });

  it.effect("rejects recovery registration when the recorded tunnel changed", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        registerEnvironmentTunnelRecovery({
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: "public-key",
          tunnelId: "stale-tunnel",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        }),
      );

      expect(error).toMatchObject({ _tag: "Unauthorized" });
    }).pipe(
      Effect.provide(
        Layer.merge(
          relayUnlinkTestLayer({
            getForUser: () => Effect.succeed(linkedEnvironmentRecord),
          }),
          Layer.mock(ManagedEndpointAllocations.ManagedEndpointAllocations)({
            enableRecovery: () => Effect.succeed(false),
          }),
        ),
      ),
    ),
  );

  it.effect("recovers a linked environment and marks its tunnel as recoverable", () => {
    let recoveryEnabledFor: {
      readonly userId: string;
      readonly environmentId: string;
      readonly tunnelId: string;
      readonly environmentPublicKey: string;
    } | null = null;
    const runtime = {
      providerKind: "cloudflare_tunnel" as const,
      connectorToken: "replacement-token",
      tunnelId: "replacement-tunnel",
    };

    return Effect.gen(function* () {
      expect(
        yield* recoverEnvironmentTunnelRecord({
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: "public-key",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        }),
      ).toEqual({
        endpoint: linkedEnvironmentRecord.endpoint,
        endpointRuntime: runtime,
      });
      expect(recoveryEnabledFor).toEqual({
        userId: "user-1",
        environmentId: "environment-1",
        tunnelId: "replacement-tunnel",
        environmentPublicKey: "public-key",
        origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
      });
    }).pipe(
      Effect.provide(
        Layer.merge(
          relayUnlinkTestLayer({
            getForUser: () => Effect.succeed(linkedEnvironmentRecord),
            provision: () =>
              Effect.succeed({
                endpoint: linkedEnvironmentRecord.endpoint,
                runtime,
              }),
          }),
          Layer.mock(ManagedEndpointAllocations.ManagedEndpointAllocations)({
            enableRecovery: (input) =>
              Effect.sync(() => {
                recoveryEnabledFor = input;
                return true;
              }),
          }),
        ),
      ),
    );
  });

  it.effect("rejects a credential from a different environment owner", () => {
    let provisioned = false;

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        recoverEnvironmentTunnelRecord({
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: "different-public-key",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        }),
      );
      expect(error).toMatchObject({ _tag: "Unauthorized" });
      expect(provisioned).toBe(false);
    }).pipe(
      Effect.provide(
        Layer.merge(
          relayUnlinkTestLayer({
            getForUser: () => Effect.succeed(linkedEnvironmentRecord),
            provision: () =>
              Effect.sync(() => {
                provisioned = true;
                return {
                  endpoint: linkedEnvironmentRecord.endpoint,
                  runtime: { providerKind: "cloudflare_tunnel", connectorToken: "token" },
                };
              }),
          }),
          Layer.mock(ManagedEndpointAllocations.ManagedEndpointAllocations)({
            enableRecovery: () => Effect.die("unused"),
          }),
        ),
      ),
    );
  });

  it.effect("does not recover a publish-only environment", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        recoverEnvironmentTunnelRecord({
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: "public-key",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        }),
      );
      expect(error).toMatchObject({ _tag: "Unauthorized" });
    }).pipe(
      Effect.provide(
        Layer.merge(
          relayUnlinkTestLayer({
            getForUser: () =>
              Effect.succeed({
                ...linkedEnvironmentRecord,
                endpoint: {
                  ...linkedEnvironmentRecord.endpoint,
                  providerKind: "manual" as const,
                },
              }),
          }),
          Layer.mock(ManagedEndpointAllocations.ManagedEndpointAllocations)({
            enableRecovery: () => Effect.die("unused"),
          }),
        ),
      ),
    ),
  );

  it.effect("rejects a recovered tunnel that changes the linked endpoint", () => {
    let recoveryEnabled = false;
    const cleaned: Array<string> = [];

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        recoverEnvironmentTunnelRecord({
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: "public-key",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        }),
      );
      expect(error).toMatchObject({ _tag: "Unauthorized" });
      expect(recoveryEnabled).toBe(false);
      expect(cleaned).toEqual(["replacement-tunnel"]);
    }).pipe(
      Effect.provide(
        Layer.merge(
          relayUnlinkTestLayer({
            getForUser: () => Effect.succeed(linkedEnvironmentRecord),
            provision: () =>
              Effect.succeed({
                endpoint: {
                  httpBaseUrl: "https://different.example.test/",
                  wsBaseUrl: "wss://different.example.test/ws",
                  providerKind: "cloudflare_tunnel",
                },
                runtime: {
                  providerKind: "cloudflare_tunnel",
                  connectorToken: "token",
                  tunnelId: "replacement-tunnel",
                },
              }),
            prepareDeprovision: () => Effect.die("must keep the active allocation"),
            deprovision: () => Effect.die("must keep the active link DNS"),
            release: ({ expectedTunnelId }) =>
              Effect.sync(() => {
                if (expectedTunnelId) {
                  cleaned.push(expectedTunnelId);
                }
                return true;
              }),
          }),
          Layer.mock(ManagedEndpointAllocations.ManagedEndpointAllocations)({
            enableRecovery: () =>
              Effect.sync(() => {
                recoveryEnabled = true;
                return true;
              }),
          }),
        ),
      ),
    );
  });

  it.effect.each([
    { state: "removed", currentLink: null },
    {
      state: "publish-only",
      currentLink: {
        ...linkedEnvironmentRecord,
        endpoint: {
          ...linkedEnvironmentRecord.endpoint,
          providerKind: "manual" as const,
        },
      },
    },
  ])("removes a recovered tunnel when its link becomes $state", ({ currentLink }) => {
    let lookups = 0;
    const cleaned: Array<string> = [];
    const target = {
      userId: "user-1",
      environmentId: "environment-1",
      hostname: "environment-1.example.test",
      tunnelId: "replacement-tunnel",
      tunnelName: "environment-1-tunnel",
      dnsRecordId: "dns-1",
      readyAt: "2026-07-28T00:00:00.000Z",
      origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
      updatedAt: "replacement-generation",
      generation: 3,
    } satisfies ManagedEndpointProvider.ManagedEndpointDeprovisionTarget;

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        recoverEnvironmentTunnelRecord({
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: "public-key",
          origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        }),
      );
      expect(error).toMatchObject({ _tag: "Unauthorized" });
      expect(cleaned).toEqual(["replacement-tunnel"]);
    }).pipe(
      Effect.provide(
        Layer.merge(
          relayUnlinkTestLayer({
            getForUser: () =>
              Effect.sync(() => (++lookups === 1 ? linkedEnvironmentRecord : currentLink)),
            provision: () =>
              Effect.succeed({
                endpoint: linkedEnvironmentRecord.endpoint,
                runtime: {
                  providerKind: "cloudflare_tunnel",
                  connectorToken: "replacement-token",
                  tunnelId: "replacement-tunnel",
                },
              }),
            prepareDeprovision: () => Effect.succeed(target),
            deprovision: ({ target: captured }) =>
              Effect.sync(() => {
                if (captured?.tunnelId) {
                  cleaned.push(captured.tunnelId);
                }
                return true;
              }),
          }),
          Layer.mock(ManagedEndpointAllocations.ManagedEndpointAllocations)({
            enableRecovery: () => Effect.succeed(false),
          }),
        ),
      ),
    );
  });
});

describe("relay environment unlink", () => {
  it.effect("revokes the link and its credentials in one database transaction", () => {
    const calls: Array<string> = [];
    return Effect.gen(function* () {
      expect(
        yield* revokeEnvironmentLinkRecord({
          userId: "user-1",
          environmentId: "environment-1",
          environmentPublicKey: "public-key",
        }),
      ).toBe(true);
      expect(calls).toEqual(["transaction", "link", "credential"]);
    }).pipe(
      Effect.provide(
        relayUnlinkTestLayer({
          withTransaction: (effect) => {
            calls.push("transaction");
            return effect;
          },
          revokeForUser: () =>
            Effect.sync(() => {
              calls.push("link");
              return true;
            }),
          revokeCredential: () =>
            Effect.sync(() => {
              calls.push("credential");
              return true;
            }),
        }),
      ),
    );
  });

  it.effect("commits database revocation before deprovisioning the managed endpoint", () => {
    const calls: Array<string> = [];
    const deprovisionTarget = {
      userId: "user-1",
      environmentId: "environment-1",
      hostname: "environment-1.example.test",
      tunnelId: "tunnel-1",
      tunnelName: "environment-1-tunnel",
      dnsRecordId: "dns-1",
      readyAt: "2026-07-28T00:00:00.000Z",
      origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
      updatedAt: "generation-before-unlink",
      generation: 1,
    } satisfies ManagedEndpointProvider.ManagedEndpointDeprovisionTarget;

    return Effect.gen(function* () {
      expect(
        yield* unlinkEnvironmentRecord({
          userId: "user-1",
          environmentId: "environment-1",
        }),
      ).toBe(true);
      expect(calls).toEqual([
        "prepare",
        "lookup",
        "transaction",
        "link",
        "credential",
        "deprovision",
        "linear",
      ]);
    }).pipe(
      Effect.provide(
        relayUnlinkTestLayer({
          withTransaction: (effect) => {
            calls.push("transaction");
            return effect;
          },
          getForUser: () =>
            Effect.sync(() => {
              calls.push("lookup");
              return linkedEnvironmentRecord;
            }),
          revokeForUser: () =>
            Effect.sync(() => {
              calls.push("link");
              return true;
            }),
          revokeCredential: () =>
            Effect.sync(() => {
              calls.push("credential");
              return true;
            }),
          prepareDeprovision: () =>
            Effect.sync(() => {
              calls.push("prepare");
              return deprovisionTarget;
            }),
          deprovision: (request) =>
            Effect.sync(() => {
              expect(request.target).toBe(deprovisionTarget);
              calls.push("deprovision");
              return true;
            }),
          revokeLinearGrants: (request) =>
            Effect.sync(() => {
              expect(request).toEqual({ userId: "user-1", environmentId: "environment-1" });
              calls.push("linear");
            }),
        }),
      ),
    );
  });

  it.effect("does not deprovision when database revocation fails", () => {
    const calls: Array<string> = [];
    const failure = new EnvironmentCredentials.EnvironmentCredentialRevokePersistenceError({
      environmentId: "environment-1",
      cause: "database unavailable",
    });

    return Effect.gen(function* () {
      expect(
        yield* Effect.flip(
          unlinkEnvironmentRecord({
            userId: "user-1",
            environmentId: "environment-1",
          }),
        ),
      ).toBe(failure);
      expect(calls).toEqual(["prepare", "transaction", "link", "credential"]);
    }).pipe(
      Effect.provide(
        relayUnlinkTestLayer({
          withTransaction: (effect) => {
            calls.push("transaction");
            return effect;
          },
          getForUser: () => Effect.succeed(linkedEnvironmentRecord),
          revokeForUser: () =>
            Effect.sync(() => {
              calls.push("link");
              return true;
            }),
          revokeCredential: () =>
            Effect.sync(() => {
              calls.push("credential");
            }).pipe(Effect.andThen(Effect.fail(failure))),
          prepareDeprovision: () =>
            Effect.sync(() => {
              calls.push("prepare");
              return null;
            }),
          deprovision: () =>
            Effect.sync(() => {
              calls.push("deprovision");
              return true;
            }),
        }),
      ),
    );
  });

  it.effect("retries deprovisioning after the link is already revoked", () => {
    const calls: Array<string> = [];
    return Effect.gen(function* () {
      expect(
        yield* unlinkEnvironmentRecord({
          userId: "user-1",
          environmentId: "environment-1",
        }),
      ).toBe(false);
      expect(calls).toEqual(["prepare", "deprovision"]);
    }).pipe(
      Effect.provide(
        relayUnlinkTestLayer({
          prepareDeprovision: () =>
            Effect.sync(() => {
              calls.push("prepare");
              return null;
            }),
          deprovision: () =>
            Effect.sync(() => {
              calls.push("deprovision");
              return true;
            }),
        }),
      ),
    );
  });

  it.effect("retries unlink cleanup when a concurrent tunnel release wins the first claim", () => {
    let lookups = 0;
    const targets: Array<ManagedEndpointProvider.ManagedEndpointDeprovisionTarget | undefined> = [];
    const target = {
      userId: "user-1",
      environmentId: "environment-1",
      hostname: "environment-1.example.test",
      tunnelId: "tunnel-1",
      tunnelName: "environment-1-tunnel",
      dnsRecordId: "dns-1",
      readyAt: "2026-07-28T00:00:00.000Z",
      origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
      updatedAt: "original-generation",
      generation: 1,
    } satisfies ManagedEndpointProvider.ManagedEndpointDeprovisionTarget;

    return Effect.gen(function* () {
      expect(
        yield* unlinkEnvironmentRecord({
          userId: "user-1",
          environmentId: "environment-1",
        }),
      ).toBe(true);
      expect(targets).toEqual([target, target]);
    }).pipe(
      Effect.provide(
        relayUnlinkTestLayer({
          getForUser: () => Effect.sync(() => (++lookups === 1 ? linkedEnvironmentRecord : null)),
          revokeForUser: () => Effect.succeed(true),
          prepareDeprovision: () => Effect.succeed(target),
          deprovision: ({ target: captured }) =>
            Effect.sync(() => {
              targets.push(captured ?? undefined);
              return targets.length > 1;
            }),
        }),
      ),
    );
  });
});

describe("relay environment credential refresh", () => {
  const encodeRefreshRequest = Schema.encodeSync(
    Schema.fromJsonString(RelayEnvironmentCredentialRefreshRequest),
  );
  const generateEnvironmentKeyPair = () =>
    NodeCrypto.generateKeyPairSync("ed25519", {
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });

  const signRefreshProof = (input: {
    readonly privateKey: string;
    readonly jti: string;
    readonly cloudUserId?: string;
  }) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const issuedAt = Math.floor(now.epochMilliseconds / 1_000);
      return yield* signRelayJwt({
        privateKey: input.privateKey,
        typ: RELAY_ENVIRONMENT_CREDENTIAL_REFRESH_TYP,
        payload: {
          iss: wireEnvironmentIssuer("environment-1"),
          aud: "https://relay.example.test",
          sub: "environment-1",
          jti: input.jti,
          iat: issuedAt,
          exp: issuedAt + 60,
          environmentId: "environment-1",
          cloudUserId: input.cloudUserId ?? "user-1",
        },
      });
    });

  // Serves the client group for a relay where user-1 has linked environment-1
  // with the given key. The bearer token doubles as the signed-in user id.
  const makeRefreshRelay = (environmentPublicKey: string) =>
    Effect.gen(function* () {
      const createCalls: Array<{
        readonly environmentId: string;
        readonly environmentPublicKey: string;
      }> = [];
      const providerCalls: Array<string> = [];
      const consumedProofs = new Set<string>();
      const unexpectedProviderCall = (name: string) => () =>
        Effect.sync(() => providerCalls.push(name)).pipe(
          Effect.andThen(Effect.die(`unexpected ${name}`)),
        );
      const managedEndpointProvider = ManagedEndpointProvider.ManagedEndpointProvider.of({
        provision: unexpectedProviderCall("provision"),
        reconcileOrigin: unexpectedProviderCall("reconcileOrigin"),
        prepareDeprovision: unexpectedProviderCall("prepareDeprovision"),
        deprovision: unexpectedProviderCall("deprovision"),
        release: unexpectedProviderCall("release"),
      });
      const links = EnvironmentLinks.EnvironmentLinks.of({
        upsert: () => Effect.die("unused upsert"),
        listUsersForEnvironmentPublicKey: () =>
          Effect.die("unused listUsersForEnvironmentPublicKey"),
        listDeliveryUsersForEnvironment: () => Effect.die("unused listDeliveryUsersForEnvironment"),
        listForUser: () => Effect.die("unused listForUser"),
        getForUser: ({ userId, environmentId }) =>
          Effect.succeed(
            userId === "user-1" && environmentId === "environment-1"
              ? { ...linkedEnvironmentRecord, environmentPublicKey }
              : null,
          ),
        revokeForUser: () => Effect.die("unused revokeForUser"),
      });
      const credentials = Layer.succeed(
        EnvironmentCredentials.EnvironmentCredentials,
        EnvironmentCredentials.EnvironmentCredentials.of({
          create: (input) =>
            Effect.sync(() => {
              createCalls.push(input);
              return `fresh-credential-${createCalls.length}`;
            }),
          authenticate: () => Effect.die("unused authenticate"),
          revokeForEnvironmentPublicKey: () => Effect.die("unused revoke"),
        }),
      );
      const handlers = clientApi.pipe(
        HttpRouter.provideRequest(
          Layer.mergeAll(
            credentials,
            Layer.succeed(EnvironmentLinks.EnvironmentLinks, links),
            Layer.succeed(ManagedEndpointProvider.ManagedEndpointProvider, managedEndpointProvider),
            Layer.mock(RelayDb.RelayTransactions, {}),
            Layer.mock(LinearOAuthBroker.LinearOAuthBroker, {}),
          ),
        ),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(RelayConfiguration.RelayConfiguration, relaySettings),
            NodeCryptoLayer.layer,
            Layer.mock(RelayTokens.RelayTokens, { resolveDpopAccessTokenScopes: () => null }),
            Layer.mock(EnvironmentLinker.EnvironmentLinker, {}),
            credentials,
            Layer.succeed(EnvironmentLinks.EnvironmentLinks, links),
            Layer.succeed(ManagedEndpointProvider.ManagedEndpointProvider, managedEndpointProvider),
            Layer.mock(Devices.Devices, {}),
            Layer.mock(DpopProofs.DpopProofReplay, {
              consume: ({ thumbprint, jti }) =>
                Effect.sync(() => {
                  const key = `${thumbprint}:${jti}`;
                  if (consumedProofs.has(key)) return false;
                  consumedProofs.add(key);
                  return true;
                }),
            }),
          ),
        ),
        Layer.provideMerge(
          Layer.succeed(RelayClientAuth, {
            clientBearer: (effect, { credential }) =>
              Effect.provideService(effect, RelayClientPrincipal, {
                userId: Redacted.value(credential).trim(),
                token: Redacted.value(credential).trim(),
              }),
          }),
        ),
      );
      const app = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            HttpApiBuilder.layer(HttpApi.make("RelayApi").add(RelayApi.groups.client)).pipe(
              Layer.provide(handlers),
              Layer.provide(HttpServer.layerServices),
            ),
            { disableLogger: true },
          ),
        ),
        (app) => Effect.promise(() => app.dispose()),
      );
      const refresh = (input: {
        readonly userId: string;
        readonly environmentId: string;
        readonly proof: string;
      }) =>
        Effect.promise(async () => {
          const response = await app.handler(
            new Request(
              `https://relay.example.test/v1/client/environment-links/${input.environmentId}/credential`,
              {
                method: "POST",
                headers: {
                  authorization: `Bearer ${input.userId}`,
                  "content-type": "application/json",
                },
                body: encodeRefreshRequest({ proof: input.proof }),
              },
            ),
          );
          const body: unknown = await response.json();
          return { status: response.status, body };
        });
      return { refresh, createCalls, providerCalls };
    });

  it.live("issues a credential for the linked key without touching the managed endpoint", () =>
    Effect.gen(function* () {
      const keyPair = generateEnvironmentKeyPair();
      const relay = yield* makeRefreshRelay(keyPair.publicKey);
      const proof = yield* signRefreshProof({ privateKey: keyPair.privateKey, jti: "refresh-1" });

      expect(
        yield* relay.refresh({ userId: "user-1", environmentId: "environment-1", proof }),
      ).toEqual({ status: 200, body: { environmentCredential: "fresh-credential-1" } });
      expect(relay.createCalls).toEqual([
        { environmentId: "environment-1", environmentPublicKey: keyPair.publicKey },
      ]);
      expect(relay.providerCalls).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live("rejects a replayed refresh proof", () =>
    Effect.gen(function* () {
      const keyPair = generateEnvironmentKeyPair();
      const relay = yield* makeRefreshRelay(keyPair.publicKey);
      const proof = yield* signRefreshProof({ privateKey: keyPair.privateKey, jti: "refresh-1" });
      const request = { userId: "user-1", environmentId: "environment-1", proof };

      expect((yield* relay.refresh(request)).status).toBe(200);
      expect(yield* relay.refresh(request)).toMatchObject({
        status: 401,
        body: { _tag: "RelayAuthInvalidError", reason: "not_authorized" },
      });
      expect(relay.createCalls).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.live("rejects a proof signed by a key other than the linked one", () =>
    Effect.gen(function* () {
      const linkedKeyPair = generateEnvironmentKeyPair();
      const otherKeyPair = generateEnvironmentKeyPair();
      const relay = yield* makeRefreshRelay(linkedKeyPair.publicKey);
      const proof = yield* signRefreshProof({
        privateKey: otherKeyPair.privateKey,
        jti: "refresh-1",
      });

      expect(
        yield* relay.refresh({ userId: "user-1", environmentId: "environment-1", proof }),
      ).toMatchObject({
        status: 401,
        body: { _tag: "RelayAuthInvalidError", reason: "not_authorized" },
      });
      expect(relay.createCalls).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live("rejects callers without an active link to the environment", () =>
    Effect.gen(function* () {
      const keyPair = generateEnvironmentKeyPair();
      const relay = yield* makeRefreshRelay(keyPair.publicKey);
      const attempts = [
        {
          userId: "user-2",
          environmentId: "environment-1",
          proof: yield* signRefreshProof({
            privateKey: keyPair.privateKey,
            jti: "other-user",
            cloudUserId: "user-2",
          }),
        },
        {
          userId: "user-1",
          environmentId: "environment-2",
          proof: yield* signRefreshProof({ privateKey: keyPair.privateKey, jti: "unlinked" }),
        },
        {
          userId: "user-1",
          environmentId: "environment-1",
          proof: yield* signRefreshProof({
            privateKey: keyPair.privateKey,
            jti: "claims-other-user",
            cloudUserId: "user-2",
          }),
        },
      ];

      for (const attempt of attempts) {
        expect(yield* relay.refresh(attempt)).toMatchObject({
          status: 401,
          body: { _tag: "RelayAuthInvalidError", reason: "not_authorized" },
        });
      }
      expect(relay.createCalls).toEqual([]);
      expect(relay.providerCalls).toEqual([]);
    }).pipe(Effect.scoped),
  );
});

describe("relay request tracing", () => {
  it.effect(
    "does not parent endpoint spans to an ambient parent captured while building handlers",
    () =>
      Effect.gen(function* () {
        const spans: Array<Tracer.NativeSpan> = [];
        const tracer = Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);
            return span;
          },
        });
        const ambientParent = Tracer.externalSpan({
          traceId: "00000000000000000000000000000001",
          spanId: "0000000000000001",
          sampled: true,
        });
        const endpoint = yield* withoutCapturedParentSpan(
          Effect.context<never>().pipe(
            Effect.map((capturedContext: Context.Context<never>) =>
              Effect.succeed(HttpServerResponse.empty({ status: 204 })).pipe(
                Effect.withSpan("relay.test.endpoint"),
                Effect.provideContext(capturedContext),
              ),
            ),
          ),
        ).pipe(Effect.provideService(Tracer.ParentSpan, ambientParent));
        const request = HttpServerRequest.fromWeb(
          new Request("https://relay.test/v1/mobile/devices?client=mobile", {
            method: "POST",
            headers: {
              authorization: "Bearer secret",
              dpop: "signed-proof",
            },
          }),
        );

        yield* traceRelayHttpRequestWith(endpoint, Layer.succeed(Tracer.Tracer, tracer)).pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        );

        expect(spans.map((span) => span.name)).toEqual(["http.server POST", "relay.test.endpoint"]);
        expect(spans[0]?.kind).toBe("server");
        expect(spans[0]?.attributes.get("url.path")).toBe("/v1/mobile/devices");
        expect(spans[0]?.attributes.get("http.response.status_code")).toBe(204);
        expect(spans[0]?.attributes.get("http.request.header.authorization")).toBe("<redacted>");
        expect(spans[0]?.attributes.get("http.request.header.dpop")).toBe("<redacted>");
        expect(Option.isNone(spans[0]!.parent)).toBe(true);
        expect(Option.getOrUndefined(spans[1]!.parent)?.spanId).toBe(spans[0]?.spanId);
      }),
  );

  it.effect("keeps the Linear authorization code and state out of the request span", () =>
    Effect.gen(function* () {
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const request = HttpServerRequest.fromWeb(
        new Request(
          "https://relay.test/v1/oauth/linear/callback?code=linear-code&state=linear-state",
        ),
      );
      const handlerUrls: Array<string> = [];
      const endpoint = HttpServerRequest.HttpServerRequest.pipe(
        Effect.map((handled) => {
          handlerUrls.push(handled.url);
          return HttpServerResponse.empty({ status: 204 });
        }),
      );

      yield* traceRelayHttpRequestWith(endpoint, Layer.succeed(Tracer.Tracer, tracer)).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      );

      expect(handlerUrls[0]).toContain("code=linear-code");
      expect(spans[0]?.attributes.get("url.path")).toBe("/v1/oauth/linear/callback");
      const recorded = [...(spans[0]?.attributes.values() ?? [])].map(String).join(" ");
      expect(recorded).not.toContain("linear-code");
      expect(recorded).not.toContain("linear-state");
    }),
  );

  it.effect("fails hung requests with a 504 before the client's 10s abort", () =>
    Effect.gen(function* () {
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const request = HttpServerRequest.fromWeb(
        new Request("https://relay.test/v1/mobile/devices", { method: "POST" }),
      );

      const fiber = yield* traceRelayHttpRequestWith(
        Effect.never,
        Layer.succeed(Tracer.Tracer, tracer),
      ).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request), Effect.forkChild);
      yield* TestClock.adjust(Duration.millis(RELAY_REQUEST_DEADLINE_MS));
      const response = yield* Fiber.join(fiber);

      expect(response.status).toBe(504);
      expect(spans[0]?.attributes.get("relay.request.deadline_exceeded")).toBe(true);
      expect(spans[0]?.attributes.get("http.response.status_code")).toBe(504);
    }),
  );
});

describe("relay routing fallback", () => {
  it.effect("publishes activity for escaped delegated thread IDs longer than 100 characters", () =>
    Effect.gen(function* () {
      const environmentId = "environment-1";
      const environmentPublicKey = "environment-public-key";
      const published: Array<
        Parameters<AgentActivityPublisher.AgentActivityPublisher["Service"]["publish"]>[0]
      > = [];
      const verified: Array<
        Parameters<
          EnvironmentPublishSignatures.EnvironmentPublishSignatures["Service"]["verify"]
        >[0]
      > = [];
      const publisher = Layer.succeed(AgentActivityPublisher.AgentActivityPublisher, {
        publish: (input) =>
          Effect.sync(() => {
            published.push(input);
            return { ok: true as const, deliveries: [] };
          }),
        replayForLiveActivityRegistration: () => Effect.succeed(null),
      });
      const signatures = Layer.succeed(EnvironmentPublishSignatures.EnvironmentPublishSignatures, {
        verify: (input) =>
          Effect.sync(() => {
            verified.push(input);
          }),
      });
      const auth = Layer.succeed(RelayEnvironmentAuth, {
        environmentBearer: (effect) =>
          effect.pipe(
            Effect.provideService(RelayEnvironmentPrincipal, {
              environmentId,
              environmentPublicKey,
            }),
          ),
      });
      const routes = HttpApiBuilder.layer(
        HttpApi.make("RelayApi").add(RelayApi.groups.server),
      ).pipe(
        Layer.provide(
          serverApi.pipe(
            HttpRouter.provideRequest(
              Layer.mergeAll(
                Layer.succeed(RelayConfiguration.RelayConfiguration, relaySettings),
                Layer.mock(EnvironmentLinks.EnvironmentLinks, {}),
                Layer.mock(ManagedEndpointAllocations.ManagedEndpointAllocations, {}),
                Layer.mock(ManagedEndpointProvider.ManagedEndpointProvider, {}),
              ),
            ),
            Layer.provide([publisher, signatures]),
          ),
        ),
        Layer.provide(auth),
        Layer.provide([NodeServices.layer, NodeHttpPlatform.layer, Etag.layerWeak]),
      );
      const httpEffect = yield* HttpRouter.toHttpEffect(
        Layer.mergeAll(routes, relayNotFoundRoute, relayCors),
      ).pipe(Effect.provideService(HttpRouter.RouterConfig, RELAY_HTTP_ROUTER_CONFIG));
      const threadIds = [
        "b7c8c522-d244-43dc-875f-7224fce79912",
        "t".repeat(512),
        "thread:delegated-task:command%3Amcp%3Ab7c8c522-d244-43dc-875f-7224fce79912%3Adelegate-task%3Agreet-subagent-20260813",
      ];
      for (const threadId of threadIds) {
        const request = HttpServerRequest.fromWeb(
          new Request(
            `https://relay.test/v1/environments/${environmentId}/threads/${encodeURIComponent(threadId)}/agent-activity`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer environment-credential",
                "content-type": "application/json",
              },
              body: '{"state":null,"proof":"signed-proof"}',
            },
          ),
        );
        const response = yield* httpEffect.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        );
        expect(response.status).toBe(200);
      }
      expect(published).toEqual(
        threadIds.map((threadId) => ({
          environmentId,
          environmentPublicKey,
          threadId,
          state: null,
        })),
      );
      expect(verified.map((input) => input.threadId)).toEqual(threadIds);
    }).pipe(Effect.scoped),
  );

  it.effect("redirects the relay root to the API docs", () =>
    Effect.gen(function* () {
      const request = HttpServerRequest.fromWeb(new Request("https://relay.test/"));
      const httpEffect = yield* HttpRouter.toHttpEffect(
        Layer.mergeAll(relayDocsRedirectRoute, relayNotFoundRoute, relayCors),
      );
      const response = yield* httpEffect.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe("/docs");
      expect(response.headers["access-control-allow-origin"]).toBe("*");
    }).pipe(Effect.scoped),
  );

  it.effect("returns a CORS-compatible 404 response for unmatched paths", () =>
    Effect.gen(function* () {
      const request = HttpServerRequest.fromWeb(
        new Request("https://relay.test/v1/environmentsd", { method: "GET" }),
      );
      const httpEffect = yield* HttpRouter.toHttpEffect(Layer.merge(relayNotFoundRoute, relayCors));
      const response = yield* httpEffect.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      );

      expect(response.status).toBe(404);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
    }).pipe(Effect.scoped),
  );
});
