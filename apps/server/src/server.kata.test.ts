// Kata-owned server coverage that lived in Kata's copy of server.test.ts before
// upstream deleted that suite with orchestration V2: routine webhooks during
// startup, Kata Code Connect relay configuration and managed callbacks, the
// Kata wire routes, and the KAT-3578 RPC scope boundary. The harness serves
// only the routes these cases exercise, wired the way server.ts wires them.
// @effect-diagnostics nodeBuiltinImport:off - Tests sign relay requests with Node crypto.
import * as NodeCrypto from "node:crypto";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  EnvironmentId,
  RoutineConnectionId,
  WS_METHODS,
} from "@kata-sh/code-contracts";
import type { RelayManagedEndpointRuntimeConfig } from "@kata-sh/code-contracts/relay";
import { wireEnvironmentIssuer } from "@kata-sh/code-contracts/wireIdentity";
import { DEFAULT_SIGNAL_EXPORT } from "@kata-sh/code-shared/observability";
import * as OtelEnvironment from "@kata-sh/code-shared/otelEnvironment";
import { RELAY_HEALTH_REQUEST_TYP, RELAY_MINT_REQUEST_TYP } from "@kata-sh/code-shared/relayJwt";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServerResponse,
} from "effect/unstable/http";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { authHttpApiLayer, environmentAuthenticatedAuthLayer } from "./auth/http.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { requiredScopeForRpcMethod } from "./auth/RpcAuthorization.ts";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as CloudCliTokenManager from "./cloud/CliTokenManager.ts";
import { connectHttpApiLayer } from "./cloud/http.ts";
import * as CloudManagedEndpointRuntime from "./cloud/ManagedEndpointRuntime.ts";
import * as ServerConfig from "./config.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import { serverEnvironmentHttpApiLayer } from "./http.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import * as AgentAwarenessRelay from "./relay/AgentAwarenessRelay.ts";
import * as RoutineStore from "./routines/RoutineStore.ts";
import {
  routineConnectionSecretName,
  routineWebhookCallbackPath,
  routineWebhookRouteLayer,
  signGitHubWebhookBody,
} from "./routines/RoutineWebhooks.ts";
import { commandReadinessLayer } from "./server.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";

const desktopBootstrapToken = "kata-test-desktop-bootstrap-token";
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const manualRelayEndpoint = {
  httpBaseUrl: "http://127.0.0.1:3773",
  wsBaseUrl: "ws://127.0.0.1:3773",
  providerKind: "manual",
} as const;

const managedRelayEndpoint = {
  httpBaseUrl: "https://desktop.example.test/",
  wsBaseUrl: "wss://desktop.example.test",
  providerKind: "cloudflare_tunnel",
} as const;

const managedEndpointRuntime: RelayManagedEndpointRuntimeConfig = {
  providerKind: "cloudflare_tunnel",
  connectorToken: "connector-token",
  tunnelId: "tunnel-1",
};

class TestHttpRequestError extends Data.TaggedError("TestHttpRequestError")<{
  readonly cause: unknown;
}> {}

// Same API identifier as EnvironmentHttpApi, so the production group layers
// implement it. Only the groups these cases reach are present.
class KataServerTestApi extends HttpApi.make("environment").add(
  EnvironmentHttpApi.groups.metadata,
  EnvironmentHttpApi.groups.auth,
  EnvironmentHttpApi.groups.connect,
) {}

interface HarnessOptions {
  readonly baseDir?: string;
  readonly awaitCommandReady?: Effect.Effect<void>;
  readonly endpointRuntime?: Partial<
    CloudManagedEndpointRuntime.CloudManagedEndpointRuntime["Service"]
  >;
  readonly relayHttpClient?: HttpClient.HttpClient;
}

const buildServer = (options: HarnessOptions = {}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir =
      options.baseDir ?? (yield* fileSystem.makeTempDirectoryScoped({ prefix: "kata-server-" }));
    const derivedPaths = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
    const config: ServerConfig.ServerConfig["Service"] = {
      logLevel: "Info",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 200,
      traceMaxBytes: 10 * 1024 * 1024,
      traceMaxFiles: 10,
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpLogsUrl: undefined,
      otlpTracesExport: DEFAULT_SIGNAL_EXPORT,
      otlpMetricsExport: DEFAULT_SIGNAL_EXPORT,
      otlpLogsExport: DEFAULT_SIGNAL_EXPORT,
      otelEnvironment: OtelEnvironment.none,
      mode: "desktop",
      port: 0,
      host: "127.0.0.1",
      cwd: process.cwd(),
      baseDir,
      ...derivedPaths,
      staticDir: undefined,
      devUrl: undefined,
      devAllowedOrigins: [],
      noBrowser: true,
      startupPresentation: "browser",
      desktopBootstrapToken,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
    };

    const environmentLayer = ServerEnvironment.layer.pipe(
      Layer.provideMerge(ServerSecretStore.layer),
    );
    const authLayer = EnvironmentAuth.layer.pipe(Layer.provide(environmentLayer));
    const cloudServices = Layer.mergeAll(
      Layer.succeed(
        CloudManagedEndpointRuntime.CloudManagedEndpointRuntime,
        CloudManagedEndpointRuntime.CloudManagedEndpointRuntime.of({
          applyConfig: () => Effect.succeed({ status: "disabled" }),
          getStatus: Effect.succeed({ status: "disabled" }),
          recoveryRequests: Stream.empty,
          requestRecovery: () => Effect.void,
          withLinkStateLock: (effect) => effect,
          ...options.endpointRuntime,
        }),
      ),
      Layer.mock(AgentAwarenessRelay.AgentAwarenessRelay)({
        requestCatchUp: () => Effect.void,
      }),
      Layer.mock(CloudCliTokenManager.CloudCliTokenManager)({
        get: Effect.die(new Error("Unexpected Kata Code Connect CLI authorization request.")),
        getExisting: Effect.succeedNone,
        hasCredential: Effect.succeed(false),
        clear: Effect.void,
      }),
    );
    const apiLayer = HttpApiBuilder.layer(KataServerTestApi).pipe(
      Layer.provide(authHttpApiLayer),
      Layer.provide(connectHttpApiLayer),
      Layer.provide(serverEnvironmentHttpApiLayer),
      Layer.provide(environmentAuthenticatedAuthLayer),
      // The relay calls made by Connect handlers, not the test's own client.
      Layer.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          options.relayHttpClient ??
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(request, Response.json({ status: "ready" })),
              ),
            ),
        ),
      ),
    );
    const routes = Layer.mergeAll(
      apiLayer,
      routineWebhookRouteLayer,
      HttpRouter.add("GET", "/", Effect.succeed(HttpServerResponse.text("ready"))),
    ).pipe(Layer.provide(commandReadinessLayer));
    const context = yield* Layer.build(
      HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.provide(cloudServices),
        Layer.provide(
          Layer.succeed(
            ServerRuntimeStartup.ServerRuntimeStartup,
            ServerRuntimeStartup.ServerRuntimeStartup.of({
              awaitCommandReady: options.awaitCommandReady ?? Effect.void,
              markHttpListening: Effect.void,
              enqueueCommand: (effect) => effect,
            }),
          ),
        ),
        Layer.provideMerge(authLayer),
        Layer.provideMerge(environmentLayer),
        Layer.provide(ServerConfig.layer(config)),
      ),
    );
    return {
      config,
      secrets: Context.get(context, ServerSecretStore.ServerSecretStore),
      environmentId: yield* Context.get(context, ServerEnvironment.ServerEnvironment)
        .getEnvironmentId,
    };
  });

const send = (
  method: "GET" | "POST",
  pathname: string,
  init: { readonly headers?: Record<string, string>; readonly body?: unknown } = {},
) =>
  HttpClient.execute(
    HttpClientRequest.make(method)(pathname, { headers: init.headers ?? {} }).pipe(
      init.body === undefined
        ? (request) => request
        : HttpClientRequest.bodyText(encodeJson(init.body), "application/json"),
    ),
  ).pipe(Effect.mapError((cause) => new TestHttpRequestError({ cause })));

const responseJson = <A>(response: HttpClientResponse.HttpClientResponse) =>
  response.json.pipe(
    Effect.map((json) => json as A),
    Effect.mapError((cause) => new TestHttpRequestError({ cause })),
  );

const ownerCookie = Effect.gen(function* () {
  const response = yield* send("POST", "/api/auth/browser-session", {
    body: { credential: desktopBootstrapToken },
  });
  assert.equal(response.status, 200);
  const cookie = response.headers["set-cookie"];
  assert.isString(cookie);
  return cookie!.split(";")[0]!;
});

const generateCloudKeyPair = () =>
  NodeCrypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });

const postRelayConfig = (
  cookie: string,
  input: {
    readonly cloudMintPublicKey: string;
    readonly endpoint: unknown;
    readonly endpointRuntime: unknown;
  },
) =>
  send("POST", "/api/connect/relay-config", {
    headers: { cookie },
    body: {
      relayUrl: "https://relay.example.test",
      cloudUserId: "user_123",
      environmentCredential: "t3env_test_credential",
      ...input,
    },
  });

const readLinkState = (cookie: string) =>
  Effect.gen(function* () {
    const response = yield* send("GET", "/api/connect/link-state", { headers: { cookie } });
    assert.equal(response.status, 200);
    return yield* responseJson<{
      readonly linked?: boolean;
      readonly cloudUserId?: string | null;
      readonly managedTunnelActive?: boolean;
      readonly managedCallbackReady?: boolean;
    }>(response);
  });

const signRelayRequest = (input: {
  readonly privateKey: string;
  readonly typ: string;
  readonly payload: Record<string, unknown>;
}) => {
  const header = Buffer.from(encodeJson({ alg: "EdDSA", typ: input.typ })).toString("base64url");
  const encodedPayload = Buffer.from(encodeJson(input.payload)).toString("base64url");
  const signingInput = `${header}.${encodedPayload}`;
  return {
    proof: `${signingInput}.${NodeCrypto.sign(null, Buffer.from(signingInput), input.privateKey).toString("base64url")}`,
  };
};

const decodeCompactJwtPayload = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ requestNonce: Schema.optional(Schema.String) })),
);
const proofNonce = (token: string) =>
  decodeCompactJwtPayload(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"))
    .requestNonce;

it.layer(NodeServices.layer)("Kata server routes", (it) => {
  it.effect("records a signed routine webhook while command readiness is still pending", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>();
      const { secrets, environmentId } = yield* buildServer({
        awaitCommandReady: Deferred.await(ready),
      });
      const store = yield* RoutineStore.RoutineStore;
      const connectionId = RoutineConnectionId.make("connection-startup");
      const secret = new TextEncoder().encode("startup-secret");
      yield* store.saveConnection({
        id: connectionId,
        environmentId,
        provider: "github",
        repositoryId: 42,
        repositoryName: "acme/widgets",
        repositoryUrl: "https://github.com/acme/widgets",
        defaultBranch: "main",
        hookId: 1,
        callbackUrl: `http://localhost${routineWebhookCallbackPath(connectionId)}`,
        status: "pending",
        lastDelivery: null,
        acceptedCount: 0,
        ignoredCount: 0,
        rejectedCount: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      yield* secrets.set(routineConnectionSecretName(connectionId), secret);

      const parked = yield* send("GET", "/").pipe(Effect.forkChild);
      const body = new TextEncoder().encode(encodeJson({ repository: { id: 42 }, zen: "ready" }));
      const response = yield* HttpClient.execute(
        HttpClientRequest.post(routineWebhookCallbackPath(connectionId)).pipe(
          HttpClientRequest.setHeaders({
            "x-github-delivery": "startup-ping",
            "x-github-event": "ping",
            "x-hub-signature-256": signGitHubWebhookBody(secret, body),
          }),
          HttpClientRequest.bodyUint8Array(body, "application/json"),
        ),
      );
      assert.equal(response.status, 200);
      assert.equal((yield* store.getConnection(environmentId, connectionId)).status, "verified");
      // Every other route still waits for command readiness.
      assert.isUndefined(parked.pollUnsafe());
      yield* Deferred.succeed(ready, undefined);
      assert.equal((yield* Fiber.join(parked)).status, 200);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          RoutineStore.RoutineStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
          NodeHttpServer.layerTest,
        ),
      ),
    ),
  );

  it.effect("serves the public environment descriptor at the Kata well-known path", () =>
    Effect.gen(function* () {
      const { environmentId } = yield* buildServer();
      const response = yield* send("GET", "/.well-known/kata/environment");
      const body = yield* responseJson<{ readonly environmentId?: string }>(response);
      assert.equal(response.status, 200);
      assert.equal(body.environmentId, environmentId);
      assert.equal((yield* send("GET", "/.well-known/t3/environment")).status, 404);
    }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeHttpServer.layerTest))),
  );

  it.effect("reports link state from a relay config that names the manual endpoint", () =>
    Effect.gen(function* () {
      yield* buildServer();
      const cookie = yield* ownerCookie;
      assert.equal((yield* readLinkState(cookie)).linked, false);
      const saved = yield* postRelayConfig(cookie, {
        cloudMintPublicKey: generateCloudKeyPair().publicKey,
        endpoint: manualRelayEndpoint,
        endpointRuntime: null,
      });
      assert.equal(saved.status, 200);
      const state = yield* readLinkState(cookie);
      assert.equal(state.linked, true);
      assert.equal(state.cloudUserId, "user_123");
      assert.equal(state.managedTunnelActive, false);
      assert.equal(state.managedCallbackReady, false);
    }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeHttpServer.layerTest))),
  );

  it.effect("reports a stored managed runtime without a callback URL as not ready", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "kata-stale-callback-" });
      yield* buildServer({ baseDir });
      const secretsDir = path.join(baseDir, "userdata", "secrets");
      yield* fileSystem.makeDirectory(secretsDir, { recursive: true });
      yield* fileSystem.writeFile(
        path.join(secretsDir, "cloud-endpoint-runtime-config.bin"),
        new TextEncoder().encode("present"),
      );
      const state = yield* readLinkState(yield* ownerCookie);
      assert.equal(state.managedTunnelActive, true);
      assert.equal(state.managedCallbackReady, false);
    }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeHttpServer.layerTest))),
  );

  it.effect(
    "persists the managed callback origin and reports it ready only while the runtime runs",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "kata-callback-origin-",
        });
        let failRuntime = false;
        let runtimeStatus: CloudManagedEndpointRuntime.CloudManagedEndpointRuntimeStatus = {
          status: "disabled",
        };
        yield* buildServer({
          baseDir,
          endpointRuntime: {
            applyConfig: (config) =>
              Effect.sync(() => {
                runtimeStatus = !config
                  ? { status: "disabled" }
                  : failRuntime
                    ? {
                        status: "failed",
                        providerKind: "cloudflare_tunnel",
                        failure: "not-installed",
                        reason: "cloudflared missing",
                      }
                    : { status: "running", providerKind: "cloudflare_tunnel", pid: 123 };
                return runtimeStatus;
              }),
            getStatus: Effect.sync(() => runtimeStatus),
          },
        });
        const cookie = yield* ownerCookie;
        const cloudMintPublicKey = generateCloudKeyPair().publicKey;
        const callbackPath = path.join(
          baseDir,
          "userdata",
          "secrets",
          "cloud-managed-endpoint-url.bin",
        );
        const readCallback = fileSystem
          .readFileString(callbackPath)
          .pipe(Effect.asSome, Effect.orElseSucceed(Option.none));
        const post = (
          endpoint: typeof managedRelayEndpoint | typeof manualRelayEndpoint,
          endpointRuntime: RelayManagedEndpointRuntimeConfig | null = endpoint.providerKind ===
          "cloudflare_tunnel"
            ? managedEndpointRuntime
            : null,
        ) => postRelayConfig(cookie, { cloudMintPublicKey, endpoint, endpointRuntime });

        assert.equal((yield* post(managedRelayEndpoint, null)).status, 200);
        assert.deepEqual(yield* readCallback, Option.some("https://desktop.example.test"));
        const external = yield* readLinkState(cookie);
        assert.equal(external.managedTunnelActive, false);
        assert.equal(external.managedCallbackReady, false);

        assert.equal((yield* post(managedRelayEndpoint)).status, 200);
        const ready = yield* readLinkState(cookie);
        assert.equal(ready.managedTunnelActive, true);
        assert.equal(ready.managedCallbackReady, true);

        // A failed start keeps the stored config so startup can retry it, but
        // the callback does not read as ready until the connector runs.
        failRuntime = true;
        assert.equal((yield* post(managedRelayEndpoint)).status, 503);
        assert.deepEqual(yield* readCallback, Option.some("https://desktop.example.test"));
        const failed = yield* readLinkState(cookie);
        assert.equal(failed.managedTunnelActive, true);
        assert.equal(failed.managedCallbackReady, false);

        failRuntime = false;
        assert.equal((yield* post(managedRelayEndpoint)).status, 200);
        assert.equal((yield* readLinkState(cookie)).managedCallbackReady, true);

        // Publish-only links keep no managed callback.
        assert.equal((yield* post(manualRelayEndpoint)).status, 200);
        assert.deepEqual(yield* readCallback, Option.none());
        const publishOnly = yield* readLinkState(cookie);
        assert.equal(publishOnly.managedTunnelActive, false);
        assert.equal(publishOnly.managedCallbackReady, false);
      }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeHttpServer.layerTest))),
  );

  it.effect("rejects an insecure managed callback URL before starting the runtime", () =>
    Effect.gen(function* () {
      const applied: Array<unknown> = [];
      yield* buildServer({
        endpointRuntime: {
          applyConfig: (config) => {
            applied.push(config);
            return Effect.succeed({
              status: "running",
              providerKind: "cloudflare_tunnel",
              pid: 123,
            });
          },
        },
      });
      const cookie = yield* ownerCookie;
      const response = yield* postRelayConfig(cookie, {
        cloudMintPublicKey: generateCloudKeyPair().publicKey,
        endpoint: {
          httpBaseUrl: "http://desktop.example.test",
          wsBaseUrl: "ws://desktop.example.test",
          providerKind: "cloudflare_tunnel",
        },
        endpointRuntime: { providerKind: "cloudflare_tunnel", connectorToken: "connector-token" },
      });
      const body = yield* responseJson<{ readonly message?: string }>(response);
      assert.equal(response.status, 400);
      assert.equal(body.message, "Managed callback URL must be a secure HTTPS origin.");
      assert.deepEqual(applied, []);
      const state = yield* readLinkState(cookie);
      assert.equal(state.managedTunnelActive, false);
      assert.equal(state.managedCallbackReady, false);
    }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeHttpServer.layerTest))),
  );

  it.effect("serves signed Kata Code Connect mint credential and health requests", () =>
    Effect.gen(function* () {
      const { environmentId } = yield* buildServer();
      const cookie = yield* ownerCookie;
      const cloudKeyPair = generateCloudKeyPair();
      const saved = yield* postRelayConfig(cookie, {
        cloudMintPublicKey: cloudKeyPair.publicKey,
        endpoint: manualRelayEndpoint,
        endpointRuntime: null,
      });
      assert.equal(saved.status, 200);

      const now = yield* DateTime.now;
      const iat = Math.floor(now.epochMilliseconds / 1_000);
      const exp = iat + 300;
      const audience = wireEnvironmentIssuer(EnvironmentId.make(environmentId));
      assert.isTrue(audience.startsWith("kata-env:"));
      const mint = yield* send("POST", "/api/kata-connect/mint-credential", {
        body: signRelayRequest({
          privateKey: cloudKeyPair.privateKey,
          typ: RELAY_MINT_REQUEST_TYP,
          payload: {
            iss: "https://relay.example.test",
            aud: audience,
            sub: "user_123",
            jti: "kata-mint-jti",
            environmentId,
            clientProofKeyThumbprint: "client-proof-key-thumbprint",
            cnf: { jkt: "client-proof-key-thumbprint" },
            nonce: "kata-mint-nonce",
            iat,
            exp,
            scope: ["environment:connect"],
          },
        }),
      });
      assert.equal(mint.status, 200);
      const minted = yield* responseJson<{ readonly credential?: string; readonly proof?: string }>(
        mint,
      );
      assert.isString(minted.credential);
      assert.equal(proofNonce(minted.proof ?? ""), "kata-mint-nonce");

      const health = yield* send("POST", "/api/kata-connect/health", {
        body: signRelayRequest({
          privateKey: cloudKeyPair.privateKey,
          typ: RELAY_HEALTH_REQUEST_TYP,
          payload: {
            iss: "https://relay.example.test",
            aud: audience,
            sub: "user_123",
            jti: "kata-health-jti",
            environmentId,
            nonce: "kata-health-nonce",
            iat,
            exp,
            scope: ["environment:status"],
          },
        }),
      });
      assert.equal(health.status, 200);
      const status = yield* responseJson<{
        readonly status?: string;
        readonly descriptor?: { readonly environmentId?: string };
        readonly proof?: string;
      }>(health);
      assert.equal(status.status, "online");
      assert.equal(status.descriptor?.environmentId, environmentId);
      assert.equal(proofNonce(status.proof ?? ""), "kata-health-nonce");
    }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeHttpServer.layerTest))),
  );
});

it("requires operate scope for ChatGPT profile transfer and handoff RPCs (KAT-3578)", () => {
  for (const method of [
    WS_METHODS.chatGptReconnectProfile,
    WS_METHODS.chatGptImportProfile,
    WS_METHODS.chatGptHandoffSubscribe,
  ]) {
    assert.equal(requiredScopeForRpcMethod(method), AuthOrchestrationOperateScope);
  }
});

it("keeps routine reads readable and routine changes operate-only", () => {
  assert.equal(requiredScopeForRpcMethod(WS_METHODS.routinesList), AuthOrchestrationReadScope);
  assert.equal(requiredScopeForRpcMethod(WS_METHODS.routinesSubscribe), AuthOrchestrationReadScope);
  assert.equal(requiredScopeForRpcMethod(WS_METHODS.routinesSave), AuthOrchestrationOperateScope);
  assert.equal(requiredScopeForRpcMethod(WS_METHODS.routinesDraft), AuthOrchestrationOperateScope);
  assert.equal(
    requiredScopeForRpcMethod(WS_METHODS.routinesConnectionsRotateSecret),
    AuthOrchestrationOperateScope,
  );
});
