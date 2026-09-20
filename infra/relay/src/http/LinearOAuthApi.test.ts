import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { EnvironmentId } from "@kata-sh/code-contracts";
import {
  RelayApi,
  RelayClientAuth,
  RelayClientPrincipal,
  RelayEnvironmentAuth,
  RelayEnvironmentPrincipal,
  RelayLinearOAuthStartRequest,
  RelayLinearOAuthStartResponse,
  RelayLinearAccessToken,
} from "@kata-sh/code-contracts/relay";

import {
  linearClientApi,
  linearServerApi,
  relayLinearOAuthCallbackHandler,
} from "./LinearOAuthApi.ts";
import * as RelayConfiguration from "../Config.ts";
import * as EnvironmentConnector from "../environments/EnvironmentConnector.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as LinearOAuth from "../linear/LinearOAuth.ts";
import * as LinearOAuthBroker from "../linear/LinearOAuthBroker.ts";
import * as LinearOAuthStates from "../linear/LinearOAuthStates.ts";
import * as LinearTokens from "../linear/LinearTokens.ts";

const relaySettings: RelayConfiguration.RelayConfiguration["Service"] = {
  relayIssuer: "https://relay.example.test",
  apns: null,
  clerkSecretKey: Redacted.make("clerk-secret-key"),
  clerkPublishableKey: "pk_test_test",
  clerkJwtAudience: "kata-code-relay",
  apnsDeliveryJobSigningSecret: Redacted.make("apns-delivery-secret"),
  cloudMintPrivateKey: Redacted.make("cloud-mint-private-key"),
  cloudMintPublicKey: "cloud-mint-public-key",
  managedEndpointBaseDomain: undefined,
  managedEndpointNamespace: undefined,
  linearOAuth: {
    clientId: "linear-client-id",
    clientSecret: Redacted.make("linear-client-secret"),
  },
};

const LINEAR_BUNDLE = {
  accessToken: "linear-access-token",
  refreshToken: "linear-refresh-token",
  expiresAt: 1_790_000_000_000,
  scope: "read,admin",
} as const;

const ROTATED_BUNDLE = {
  accessToken: "rotated-access-token",
  refreshToken: "rotated-refresh-token",
  expiresAt: 1_790_000_600_000,
  scope: "read,admin",
} as const;

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

const encodeStartRequest = Schema.encodeSync(Schema.fromJsonString(RelayLinearOAuthStartRequest));
const decodeStartResponse = Schema.decodeUnknownSync(
  Schema.fromJsonString(RelayLinearOAuthStartResponse),
);
const decodeRefreshResponse = Schema.decodeUnknownSync(
  Schema.fromJsonString(RelayLinearAccessToken),
);

// Only `authorizeUrl` is real; every call that reaches Linear is replaced per test.
const makeLinearOAuthForTest = () =>
  LinearOAuth.makeLinearOAuth({
    clientId: "linear-client-id",
    clientSecret: "linear-client-secret",
    redirectUri: "https://relay.example.test/v1/oauth/linear/callback",
    fetch: () => Promise.reject(new Error("unexpected Linear request")),
  });

function makeLinearTestServices(options?: {
  readonly linkForEnvironment1?: boolean;
  readonly failDelivery?: boolean;
  readonly oauthExchange?: LinearOAuth.LinearOAuth["Service"]["exchangeCode"];
  readonly oauthRefresh?: LinearOAuth.LinearOAuth["Service"]["refresh"];
  readonly oauthRevoke?: LinearOAuth.LinearOAuth["Service"]["revoke"];
  readonly linearSettings?: RelayConfiguration.RelayConfiguration["Service"];
}) {
  const states = new Map<string, LinearOAuthStates.LinearOAuthStateBinding>();
  const consumedStates = new Set<string>();
  const storedTokens = new Map<string, LinearTokens.LinearOAuthTokenRecord>();
  const delivered: Array<
    Parameters<EnvironmentConnector.EnvironmentConnector["Service"]["deliverLinearOAuth"]>[0]
  > = [];
  const refreshCalls: Array<string> = [];
  const revoked: Array<string> = [];
  const exchangeCalls: Array<{ code: string; codeVerifier: string }> = [];

  let stateCounter = 0;
  const statesService = LinearOAuthStates.LinearOAuthStates.of({
    create: (input) =>
      Effect.sync(() => {
        for (const [state, binding] of states) {
          if (
            binding.environmentId === input.environmentId &&
            binding.connectionId === input.connectionId
          )
            states.delete(state);
        }
        const state = `state-${++stateCounter}`;
        states.set(state, {
          userId: input.userId,
          environmentId: input.environmentId,
          connectionId: input.connectionId,
          codeVerifier: input.codeVerifier,
        });
        return { state };
      }),
    consume: ({ state }) =>
      Effect.suspend(() => {
        const binding = states.get(state);
        if (!binding) {
          return Effect.fail(new LinearOAuthStates.LinearOAuthStateRejected({ reason: "unknown" }));
        }
        if (consumedStates.has(state)) {
          return Effect.fail(
            new LinearOAuthStates.LinearOAuthStateRejected({ reason: "already_consumed" }),
          );
        }
        consumedStates.add(state);
        return Effect.succeed(binding);
      }),
    claim: ({ state }) =>
      Effect.sync(() => {
        const existed = states.has(state);
        states.delete(state);
        return existed;
      }),
    pruneExpired: Effect.die("unused pruneExpired"),
  });

  const tokenKey = (input: { readonly environmentId: string; readonly connectionId: string }) =>
    `${input.environmentId}:${input.connectionId}`;
  const tokensService = LinearTokens.LinearTokens.of({
    save: (input) =>
      Effect.sync(() => {
        storedTokens.set(tokenKey(input), input);
      }),
    get: (input) => Effect.succeed(storedTokens.get(tokenKey(input)) ?? null),
    delete: (input) =>
      Effect.sync(() => {
        const record = storedTokens.get(tokenKey(input));
        if (!record || record.userId !== input.userId) {
          return null;
        }
        storedTokens.delete(tokenKey(input));
        return record;
      }),
    deleteForEnvironment: () => Effect.die("unused deleteForEnvironment"),
  });

  const settings = options?.linearSettings ?? relaySettings;
  const configuredOAuth = makeLinearOAuthForTest();
  const notConfigured = () => Effect.fail(new LinearOAuth.LinearOAuthNotConfigured());
  const oauthService = LinearOAuth.LinearOAuth.of(
    settings.linearOAuth === null
      ? {
          ensureConfigured: notConfigured(),
          authorizeUrl: notConfigured,
          exchangeCode: notConfigured,
          refresh: notConfigured,
          revoke: notConfigured,
        }
      : {
          ensureConfigured: Effect.void,
          authorizeUrl: configuredOAuth.authorizeUrl,
          exchangeCode:
            options?.oauthExchange ??
            ((input) => {
              exchangeCalls.push(input);
              return Effect.succeed(LINEAR_BUNDLE);
            }),
          refresh:
            options?.oauthRefresh ??
            ((input) => {
              refreshCalls.push(input.refreshToken);
              return Effect.succeed(ROTATED_BUNDLE);
            }),
          revoke:
            options?.oauthRevoke ??
            ((input) =>
              Effect.sync(() => {
                revoked.push(input.refreshToken);
              })),
        },
  );

  const linksService = EnvironmentLinks.EnvironmentLinks.of({
    upsert: () => Effect.die("unused upsert"),
    listUsersForEnvironment: () => Effect.die("unused listUsersForEnvironment"),
    listUsersForEnvironmentPublicKey: () => Effect.die("unused listUsersForEnvironmentPublicKey"),
    listDeliveryUsersForEnvironment: () => Effect.die("unused listDeliveryUsersForEnvironment"),
    listPublicKeysForEnvironment: () => Effect.die("unused listPublicKeysForEnvironment"),
    listForUser: () => Effect.die("unused listForUser"),
    getForUser: ({ userId, environmentId }) =>
      Effect.succeed(
        options?.linkForEnvironment1 === false ||
          userId !== "user-1" ||
          environmentId !== "environment-1"
          ? null
          : linkedEnvironmentRecord,
      ),
    revokeForUser: () => Effect.die("unused revokeForUser"),
  });

  const connectorService = EnvironmentConnector.EnvironmentConnector.of({
    connect: () => Effect.die("unused connect"),
    status: () => Effect.die("unused status"),
    deliverLinearOAuth: (input) =>
      options?.failDelivery
        ? Effect.fail(
            new EnvironmentConnector.EnvironmentMintRequestFailed({
              environmentId: input.environmentId,
              operation: "linear-oauth-delivery",
              cause: "delivery unavailable",
            }),
          )
        : Effect.sync(() => {
            delivered.push(input);
          }),
  });

  return {
    layer: LinearOAuthBroker.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.succeed(RelayConfiguration.RelayConfiguration, settings),
          NodeCrypto.layer,
          Layer.succeed(LinearOAuth.LinearOAuth, oauthService),
          Layer.succeed(LinearOAuthStates.LinearOAuthStates, statesService),
          Layer.succeed(LinearTokens.LinearTokens, tokensService),
          Layer.succeed(EnvironmentLinks.EnvironmentLinks, linksService),
          Layer.succeed(EnvironmentConnector.EnvironmentConnector, connectorService),
        ),
      ),
    ),
    states,
    consumedStates,
    storedTokens,
    delivered,
    refreshCalls,
    revoked,
    exchangeCalls,
  };
}

const clientAuthLayer = Layer.succeed(RelayClientAuth, {
  clientBearer: (effect) =>
    Effect.provideService(effect, RelayClientPrincipal, {
      userId: "user-1",
      token: "test-token",
    }),
});

const environmentAuthLayer = Layer.succeed(RelayEnvironmentAuth, {
  environmentBearer: (effect) =>
    Effect.provideService(effect, RelayEnvironmentPrincipal, {
      environmentId: "environment-1",
      environmentPublicKey: "public-key",
    }),
});

function makeApiApp(services: ReturnType<typeof makeLinearTestServices>) {
  return HttpApiBuilder.layer(
    HttpApi.make("RelayApi").add(RelayApi.groups.linearClient).add(RelayApi.groups.linearServer),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(linearClientApi, linearServerApi).pipe(Layer.provide(services.layer)),
    ),
    Layer.provide(environmentAuthLayer),
    Layer.provide(clientAuthLayer),
    Layer.provide(HttpServer.layerServices),
  );
}

function toWebHandler(appLayer: ReturnType<typeof makeApiApp>) {
  return HttpRouter.toWebHandler(appLayer, { disableLogger: true });
}

const makeCallbackHandler = (services: ReturnType<typeof makeLinearTestServices>) =>
  Effect.sync(() =>
    HttpRouter.toWebHandler(
      HttpRouter.add(
        "GET",
        LinearOAuth.LINEAR_OAUTH_CALLBACK_PATH,
        relayLinearOAuthCallbackHandler.pipe(Effect.provide(services.layer)),
      ).pipe(
        HttpRouter.provideRequest(services.layer),
        Layer.provide(services.layer),
        Layer.provide(HttpServer.layerServices),
      ),
      { disableLogger: true },
    ),
  );

describe("relay Linear OAuth client API", () => {
  it.effect("starts an authorization with PKCE parameters for a linked environment", () => {
    const services = makeLinearTestServices();
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request("https://relay.example.test/v1/linear/oauth/start", {
            method: "POST",
            headers: { authorization: "Bearer test-token", "content-type": "application/json" },
            body: encodeStartRequest({
              environmentId: EnvironmentId.make("environment-1"),
              connectionId: "connection-1",
            }),
          }),
        ),
      );

      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.text());
      expect(body).not.toContain("linear-client-secret");
      const { authorizeUrl } = decodeStartResponse(body);
      const url = new URL(authorizeUrl);
      expect(url.origin).toBe("https://linear.app");
      expect(url.pathname).toBe("/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe("linear-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "https://relay.example.test/v1/oauth/linear/callback",
      );
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toBe("read,write,admin");
      expect(url.searchParams.get("actor")).toBe("user");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")?.length).toBeGreaterThan(20);
      expect(url.searchParams.get("state")?.length).toBeGreaterThan(0);
      expect(authorizeUrl).not.toContain("linear-client-secret");

      const binding = services.states.get(url.searchParams.get("state") ?? "");
      expect(binding).toMatchObject({
        userId: "user-1",
        environmentId: "environment-1",
        connectionId: "connection-1",
      });
      expect(binding?.codeVerifier.length).toBeGreaterThan(20);
    }).pipe(Effect.scoped);
  });

  it.effect("invalidates an earlier authorization state when the same connection retries", () => {
    const services = makeLinearTestServices();
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );
      const start = () =>
        Effect.promise(() =>
          app.handler(
            new Request("https://relay.example.test/v1/linear/oauth/start", {
              method: "POST",
              headers: { authorization: "Bearer test-token", "content-type": "application/json" },
              body: encodeStartRequest({
                environmentId: EnvironmentId.make("environment-1"),
                connectionId: "connection-1",
              }),
            }),
          ),
        ).pipe(
          Effect.flatMap((response) => Effect.promise(() => response.text())),
          Effect.map((body) =>
            new URL(decodeStartResponse(body).authorizeUrl).searchParams.get("state"),
          ),
        );

      const firstState = yield* start();
      const secondState = yield* start();

      expect(firstState).not.toBe(secondState);
      expect(services.states.has(firstState ?? "")).toBe(false);
      expect(services.states.has(secondState ?? "")).toBe(true);
      expect(services.states.size).toBe(1);
    }).pipe(Effect.scoped);
  });

  it.effect("rejects starting an authorization for an environment the user does not own", () => {
    const services = makeLinearTestServices();
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request("https://relay.example.test/v1/linear/oauth/start", {
            method: "POST",
            headers: { authorization: "Bearer test-token", "content-type": "application/json" },
            body: encodeStartRequest({
              environmentId: EnvironmentId.make("environment-not-owned"),
              connectionId: "connection-1",
            }),
          }),
        ),
      );

      expect(response.status).toBe(401);
      const body = yield* Effect.promise(() => response.text());
      expect(body).not.toContain("linear-client-secret");
      expect(services.states.size).toBe(0);
    }).pipe(Effect.scoped);
  });
  it.effect("revokes the stored token bundle for the caller's connection", () => {
    const services = makeLinearTestServices();
    services.storedTokens.set("environment-1:connection-1", {
      userId: "user-1",
      environmentId: "environment-1",
      connectionId: "connection-1",
      ...LINEAR_BUNDLE,
    });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request("https://relay.example.test/v1/linear/oauth/revoke", {
            method: "POST",
            headers: { authorization: "Bearer test-token", "content-type": "application/json" },
            body: `{"environmentId":"environment-1","connectionId":"connection-1"}`,
          }),
        ),
      );

      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.text());
      expect(body).not.toContain(LINEAR_BUNDLE.accessToken);
      expect(services.revoked).toEqual([LINEAR_BUNDLE.refreshToken]);
      expect(services.storedTokens.size).toBe(0);
    }).pipe(Effect.scoped);
  });

  it.effect("keeps the stored bundle when Linear cannot be reached to revoke it", () => {
    const services = makeLinearTestServices({
      oauthRevoke: () =>
        Effect.fail(
          new LinearOAuth.LinearOAuthRequestFailed({
            operation: "token revocation",
            reason: "unavailable",
          }),
        ),
    });
    services.storedTokens.set("environment-1:connection-1", {
      userId: "user-1",
      environmentId: "environment-1",
      connectionId: "connection-1",
      ...LINEAR_BUNDLE,
    });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request("https://relay.example.test/v1/linear/oauth/revoke", {
            method: "POST",
            headers: { authorization: "Bearer test-token", "content-type": "application/json" },
            body: `{"environmentId":"environment-1","connectionId":"connection-1"}`,
          }),
        ),
      );

      expect(response.status).toBe(500);
      expect(services.storedTokens.size).toBe(1);
    }).pipe(Effect.scoped);
  });

  it.effect("does not revoke a connection another user authorized", () => {
    const services = makeLinearTestServices();
    services.storedTokens.set("environment-1:connection-1", {
      userId: "user-other",
      environmentId: "environment-1",
      connectionId: "connection-1",
      ...LINEAR_BUNDLE,
    });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request("https://relay.example.test/v1/linear/oauth/revoke", {
            method: "POST",
            headers: { authorization: "Bearer test-token", "content-type": "application/json" },
            body: `{"environmentId":"environment-1","connectionId":"connection-1"}`,
          }),
        ),
      );

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.text())).toContain('"ok":false');
      expect(services.revoked).toEqual([]);
      expect(services.storedTokens.size).toBe(1);
    }).pipe(Effect.scoped);
  });

  it.effect("treats an already absent Linear authorization as revoked", () => {
    const services = makeLinearTestServices();
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request("https://relay.example.test/v1/linear/oauth/revoke", {
            method: "POST",
            headers: { authorization: "Bearer test-token", "content-type": "application/json" },
            body: `{"environmentId":"environment-1","connectionId":"connection-1"}`,
          }),
        ),
      );

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.text())).toContain('"ok":true');
      expect(services.revoked).toEqual([]);
    }).pipe(Effect.scoped);
  });

  it.effect("rejects starting an authorization when the relay has no Linear configuration", () => {
    const services = makeLinearTestServices({
      linearSettings: { ...relaySettings, linearOAuth: null },
    });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request("https://relay.example.test/v1/linear/oauth/start", {
            method: "POST",
            headers: { authorization: "Bearer test-token", "content-type": "application/json" },
            body: encodeStartRequest({
              environmentId: EnvironmentId.make("environment-1"),
              connectionId: "connection-1",
            }),
          }),
        ),
      );

      expect(response.status).toBe(503);
      const body = yield* Effect.promise(() => response.text());
      expect(body).toContain("linear_oauth_not_configured");
      expect(services.states.size).toBe(0);
    }).pipe(Effect.scoped);
  });
});

describe("relay Linear OAuth environment API", () => {
  it.effect("starts an authorization for the environment's bound owner", () => {
    const services = makeLinearTestServices();
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request(
            "https://relay.example.test/v1/environments/environment-1/linear/oauth/start",
            {
              method: "POST",
              headers: { authorization: "Bearer test-token", "content-type": "application/json" },
              body: `{"connectionId":"connection-1","userId":"user-1"}`,
            },
          ),
        ),
      );

      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.text());
      expect(body).not.toContain("linear-client-secret");
      const { authorizeUrl } = decodeStartResponse(body);
      const url = new URL(authorizeUrl);
      expect(url.origin).toBe("https://linear.app");
      expect(url.pathname).toBe("/oauth/authorize");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("state")?.length).toBeGreaterThan(0);
      const binding = services.states.get(url.searchParams.get("state") ?? "");
      expect(binding).toMatchObject({
        userId: "user-1",
        environmentId: "environment-1",
        connectionId: "connection-1",
      });
    }).pipe(Effect.scoped);
  });

  it.effect("rejects an authorization for a user who does not own the environment link", () => {
    const services = makeLinearTestServices();
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request(
            "https://relay.example.test/v1/environments/environment-1/linear/oauth/start",
            {
              method: "POST",
              headers: { authorization: "Bearer test-token", "content-type": "application/json" },
              body: `{"connectionId":"connection-1","userId":"user-2"}`,
            },
          ),
        ),
      );

      expect(response.status).toBe(401);
      expect(services.states.size).toBe(0);
    }).pipe(Effect.scoped);
  });

  it.effect("rejects an authorization when the environment has no bound owner", () => {
    const services = makeLinearTestServices({ linkForEnvironment1: false });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request(
            "https://relay.example.test/v1/environments/environment-1/linear/oauth/start",
            {
              method: "POST",
              headers: { authorization: "Bearer test-token", "content-type": "application/json" },
              body: `{"connectionId":"connection-1","userId":"user-1"}`,
            },
          ),
        ),
      );

      expect(response.status).toBe(401);
      expect(services.states.size).toBe(0);
    }).pipe(Effect.scoped);
  });

  it.effect("rejects refreshing a token for a mismatched environment", () => {
    const services = makeLinearTestServices();
    services.storedTokens.set("environment-2:connection-1", {
      userId: "user-1",
      environmentId: "environment-2",
      connectionId: "connection-1",
      ...LINEAR_BUNDLE,
    });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request(
            "https://relay.example.test/v1/environments/environment-2/linear/oauth/refresh",
            {
              method: "POST",
              headers: { authorization: "Bearer test-token", "content-type": "application/json" },
              body: `{"connectionId":"connection-1"}`,
            },
          ),
        ),
      );

      expect(response.status).toBe(401);
      expect(services.refreshCalls).toEqual([]);
    }).pipe(Effect.scoped);
  });

  it.effect("refreshes and rotates the stored token bundle for the environment", () => {
    const services = makeLinearTestServices();
    services.storedTokens.set("environment-1:connection-1", {
      userId: "user-1",
      environmentId: "environment-1",
      connectionId: "connection-1",
      ...LINEAR_BUNDLE,
    });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request(
            "https://relay.example.test/v1/environments/environment-1/linear/oauth/refresh",
            {
              method: "POST",
              headers: { authorization: "Bearer test-token", "content-type": "application/json" },
              body: `{"connectionId":"connection-1"}`,
            },
          ),
        ),
      );

      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.text());
      expect(body).not.toContain(LINEAR_BUNDLE.refreshToken);
      expect(decodeRefreshResponse(body)).toEqual({
        accessToken: ROTATED_BUNDLE.accessToken,
        expiresAt: ROTATED_BUNDLE.expiresAt,
        scope: ROTATED_BUNDLE.scope,
      });
      expect(services.refreshCalls).toEqual([LINEAR_BUNDLE.refreshToken]);
      expect(services.storedTokens.get("environment-1:connection-1")).toMatchObject(ROTATED_BUNDLE);
    }).pipe(Effect.scoped);
  });
});

describe("relay Linear OAuth revoked grants", () => {
  it.effect("tells the environment to reauthorize when Linear rejects the stored grant", () => {
    const services = makeLinearTestServices({
      oauthRefresh: () =>
        Effect.fail(
          new LinearOAuth.LinearOAuthRequestFailed({
            operation: "token refresh",
            reason: "rejected",
            status: 400,
          }),
        ),
    });
    services.storedTokens.set("environment-1:connection-1", {
      userId: "user-1",
      environmentId: "environment-1",
      connectionId: "connection-1",
      ...LINEAR_BUNDLE,
    });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => toWebHandler(makeApiApp(services))),
        (app) => Effect.promise(() => app.dispose()),
      );

      const response = yield* Effect.promise(() =>
        app.handler(
          new Request(
            "https://relay.example.test/v1/environments/environment-1/linear/oauth/refresh",
            {
              method: "POST",
              headers: { authorization: "Bearer test-token", "content-type": "application/json" },
              body: `{"connectionId":"connection-1"}`,
            },
          ),
        ),
      );

      expect(response.status).toBe(409);
      const body = yield* Effect.promise(() => response.text());
      expect(body).toContain("linear_oauth_reauthorization_required");
      expect(body).not.toContain(LINEAR_BUNDLE.refreshToken);
    }).pipe(Effect.scoped);
  });
});

describe("relay Linear OAuth callback", () => {
  it.effect("consumes the state once, stores the tokens, and delivers them", () => {
    const services = makeLinearTestServices();
    services.states.set("state-1", {
      userId: "user-1",
      environmentId: "environment-1",
      connectionId: "connection-1",
      codeVerifier: "code-verifier",
    });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(makeCallbackHandler(services), (app) =>
        Effect.promise(() => app.dispose()),
      );
      const callbackUrl =
        "https://relay.example.test/v1/oauth/linear/callback?code=linear-code&state=state-1";

      const response = yield* Effect.promise(() => app.handler(new Request(callbackUrl)));

      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.text());
      expect(body).toContain("Kata Code is connected to Linear. You can close this window.");
      expect(body).not.toContain(LINEAR_BUNDLE.accessToken);
      expect(body).not.toContain(LINEAR_BUNDLE.refreshToken);
      expect(services.exchangeCalls).toEqual([
        { code: "linear-code", codeVerifier: "code-verifier" },
      ]);
      expect(services.storedTokens.get("environment-1:connection-1")).toMatchObject({
        userId: "user-1",
        ...LINEAR_BUNDLE,
      });
      expect(services.delivered).toEqual([
        {
          userId: "user-1",
          environmentId: "environment-1",
          connectionId: "connection-1",
          token: {
            accessToken: LINEAR_BUNDLE.accessToken,
            expiresAt: LINEAR_BUNDLE.expiresAt,
            scope: LINEAR_BUNDLE.scope,
          },
        },
      ]);

      const secondResponse = yield* Effect.promise(() => app.handler(new Request(callbackUrl)));
      expect(secondResponse.status).toBe(400);
      const secondBody = yield* Effect.promise(() => secondResponse.text());
      expect(secondBody).not.toContain(LINEAR_BUNDLE.accessToken);
      expect(secondBody).not.toContain(LINEAR_BUNDLE.refreshToken);
    }).pipe(Effect.scoped);
  });

  it.effect("returns 400 for an unknown or missing callback state", () => {
    const services = makeLinearTestServices();
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(makeCallbackHandler(services), (app) =>
        Effect.promise(() => app.dispose()),
      );

      const unknownState = yield* Effect.promise(() =>
        app.handler(
          new Request(
            "https://relay.example.test/v1/oauth/linear/callback?code=linear-code&state=unknown-state",
          ),
        ),
      );
      expect(unknownState.status).toBe(400);

      const missingCode = yield* Effect.promise(() =>
        app.handler(
          new Request("https://relay.example.test/v1/oauth/linear/callback?state=state-1"),
        ),
      );
      expect(missingCode.status).toBe(400);
      const missingCodeBody = yield* Effect.promise(() => missingCode.text());
      expect(missingCodeBody).not.toContain("linear-access-token");
    }).pipe(Effect.scoped);
  });

  it.effect("revokes and discards the grant when delivery fails, leaving no unheld token", () => {
    const services = makeLinearTestServices({ failDelivery: true });
    services.states.set("state-1", {
      userId: "user-1",
      environmentId: "environment-1",
      connectionId: "connection-1",
      codeVerifier: "code-verifier",
    });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(makeCallbackHandler(services), (app) =>
        Effect.promise(() => app.dispose()),
      );
      const response = yield* Effect.promise(() =>
        app.handler(
          new Request(
            "https://relay.example.test/v1/oauth/linear/callback?code=linear-code&state=state-1",
          ),
        ),
      );

      expect(response.status).toBe(502);
      const body = yield* Effect.promise(() => response.text());
      expect(body).not.toContain(LINEAR_BUNDLE.accessToken);
      expect(body).not.toContain(LINEAR_BUNDLE.refreshToken);
      expect(services.storedTokens.size).toBe(0);
      expect(services.revoked).toEqual([LINEAR_BUNDLE.refreshToken]);
    }).pipe(Effect.scoped);
  });

  it.effect("revokes a callback whose state was superseded after consume", () => {
    let states: Map<string, LinearOAuthStates.LinearOAuthStateBinding> | undefined;
    const services = makeLinearTestServices({
      oauthExchange: () =>
        Effect.sync(() => {
          states?.delete("state-1");
          return LINEAR_BUNDLE;
        }),
    });
    states = services.states;
    services.states.set("state-1", {
      userId: "user-1",
      environmentId: "environment-1",
      connectionId: "connection-1",
      codeVerifier: "code-verifier",
    });
    return Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(makeCallbackHandler(services), (app) =>
        Effect.promise(() => app.dispose()),
      );
      const response = yield* Effect.promise(() =>
        app.handler(
          new Request(
            "https://relay.example.test/v1/oauth/linear/callback?code=linear-code&state=state-1",
          ),
        ),
      );

      expect(response.status).toBe(400);
      const body = yield* Effect.promise(() => response.text());
      expect(body).toContain("invalid, expired, or already used");
      expect(body).not.toContain(LINEAR_BUNDLE.accessToken);
      expect(body).not.toContain(LINEAR_BUNDLE.refreshToken);
      expect(services.storedTokens.size).toBe(0);
      expect(services.delivered).toEqual([]);
      expect(services.revoked).toEqual([LINEAR_BUNDLE.refreshToken]);
    }).pipe(Effect.scoped);
  });
});
