import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
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
  RelayLinearOAuthRefreshResponse,
} from "@kata-sh/code-contracts/relay";

import { linearClientApi, linearServerApi, relayLinearOAuthCallbackHandler } from "./Api.ts";
import * as RelayConfiguration from "../Config.ts";
import * as EnvironmentConnector from "../environments/EnvironmentConnector.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as LinearOAuth from "../linear/LinearOAuth.ts";
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
  Schema.fromJsonString(RelayLinearOAuthRefreshResponse),
);

function makeLinearTestServices(options?: {
  readonly linkForEnvironment1?: boolean;
  readonly failDelivery?: boolean;
  readonly oauthExchange?: LinearOAuth.LinearOAuth["Service"]["exchangeCode"];
  readonly oauthRefresh?: LinearOAuth.LinearOAuth["Service"]["refresh"];
  readonly linearSettings?: RelayConfiguration.RelayConfiguration["Service"];
}) {
  const states = new Map<string, LinearOAuthStates.LinearOAuthStateBinding>();
  const consumedStates = new Set<string>();
  const storedTokens = new Map<string, LinearTokens.LinearOAuthTokenRecord>();
  const delivered: Array<
    Parameters<EnvironmentConnector.EnvironmentConnector["Service"]["deliverLinearOAuth"]>[0]
  > = [];
  const refreshCalls: Array<string> = [];
  const exchangeCalls: Array<{ code: string; codeVerifier: string }> = [];

  let stateCounter = 0;
  const statesService = LinearOAuthStates.LinearOAuthStates.of({
    create: (input) =>
      Effect.sync(() => {
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
  });

  const tokensService = LinearTokens.LinearTokens.of({
    save: (input) =>
      Effect.sync(() => {
        storedTokens.set(`${input.environmentId}:${input.connectionId}`, {
          ...input,
          updatedAt: "2026-09-18T00:00:00.000Z",
        });
      }),
    get: ({ userId, environmentId, connectionId }) => {
      const record = storedTokens.get(`${environmentId}:${connectionId}`);
      return Effect.succeed(record && record.userId === userId ? record : null);
    },
    getForEnvironment: ({ environmentId, connectionId }) =>
      Effect.succeed(storedTokens.get(`${environmentId}:${connectionId}`) ?? null),
    delete: () => Effect.die("unused delete"),
    deleteForUserConnection: ({ userId, connectionId }) =>
      Effect.sync(() =>
        [...storedTokens.entries()].some(([key, record]) =>
          key.endsWith(`:${connectionId}`) && record.userId === userId
            ? storedTokens.delete(key)
            : false,
        ),
      ),
    deleteForEnvironment: () => Effect.die("unused deleteForEnvironment"),
  });

  const oauthService = LinearOAuth.LinearOAuth.of({
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
  });

  const linksService = EnvironmentLinks.EnvironmentLinks.of({
    upsert: () => Effect.die("unused upsert"),
    listUsersForEnvironment: () => Effect.die("unused listUsersForEnvironment"),
    listDeliveryUsersForEnvironment: () => Effect.die("unused listDeliveryUsersForEnvironment"),
    listPublicKeysForEnvironment: () => Effect.die("unused listPublicKeysForEnvironment"),
    listForUser: () => Effect.die("unused listForUser"),
    getForUser: ({ environmentId }) =>
      Effect.succeed(
        options?.linkForEnvironment1 === false || environmentId !== "environment-1"
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
    layer: Layer.mergeAll(
      Layer.succeed(
        RelayConfiguration.RelayConfiguration,
        options?.linearSettings ?? relaySettings,
      ),
      NodeCrypto.layer,
      Layer.succeed(LinearOAuth.LinearOAuth, oauthService),
      Layer.succeed(LinearOAuthStates.LinearOAuthStates, statesService),
      Layer.succeed(LinearTokens.LinearTokens, tokensService),
      Layer.succeed(EnvironmentLinks.EnvironmentLinks, linksService),
      Layer.succeed(EnvironmentConnector.EnvironmentConnector, connectorService),
    ),
    states,
    consumedStates,
    storedTokens,
    delivered,
    refreshCalls,
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
      expect(url.searchParams.get("scope")).toBe("read,admin");
      expect(url.searchParams.get("actor")).toBe("application");
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
      updatedAt: "2026-09-18T00:00:00.000Z",
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
            body: `{"connectionId":"connection-1"}`,
          }),
        ),
      );

      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.text());
      expect(body).not.toContain(LINEAR_BUNDLE.accessToken);
      expect(services.storedTokens.size).toBe(0);
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
  it.effect("rejects refreshing a token for a mismatched environment", () => {
    const services = makeLinearTestServices();
    services.storedTokens.set("environment-2:connection-1", {
      userId: "user-1",
      environmentId: "environment-2",
      connectionId: "connection-1",
      ...LINEAR_BUNDLE,
      updatedAt: "2026-09-18T00:00:00.000Z",
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
      updatedAt: "2026-09-18T00:00:00.000Z",
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
          ...LINEAR_BUNDLE,
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

  it.effect("returns 502 on delivery failure but keeps the stored tokens", () => {
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
      expect(services.storedTokens.get("environment-1:connection-1")).toMatchObject(LINEAR_BUNDLE);
    }).pipe(Effect.scoped);
  });
});
