import { assert, it } from "@effect/vitest";
import { EnvironmentId, RoutineError } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { makeLinearOAuthRelay, type LinearOAuthRelayShape } from "./LinearOAuthRelay.ts";

const RELAY_URL = "https://relay.example.test";
const ENVIRONMENT_ID = EnvironmentId.make("environment-linear-oauth");
const CONNECTION_ID = "connection-linear-oauth";
const CLIENT_ACCESS_TOKEN = "cli-access-token-secret";
const ENVIRONMENT_CREDENTIAL = "environment-credential-secret";

const requestJson = (request: HttpClientRequest.HttpClientRequest): unknown => {
  const body = request.body;
  if (body._tag === "Uint8Array") {
    return JSON.parse(new TextDecoder().decode(body.body));
  }
  if (body._tag === "Raw") {
    return JSON.parse(String(body.body));
  }
  return null;
};

interface Harness {
  readonly relay: LinearOAuthRelayShape;
  readonly requests: Array<HttpClientRequest.HttpClientRequest>;
}

interface HarnessDependencies {
  readonly relayUrl?: Option.Option<string>;
  readonly clientAccessToken?: Option.Option<string>;
  readonly environmentCredential?: Option.Option<string>;
}

const makeHarness = (
  respond: (request: HttpClientRequest.HttpClientRequest) => Response,
  dependencies: HarnessDependencies = {},
): Harness => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const relay = makeLinearOAuthRelay({
    httpClient: HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push(request);
        return HttpClientResponse.fromWeb(request, respond(request));
      }),
    ),
    relayUrl: Effect.succeed(dependencies.relayUrl ?? Option.some(RELAY_URL)),
    clientAccessToken: Effect.succeed(
      dependencies.clientAccessToken ?? Option.some(CLIENT_ACCESS_TOKEN),
    ),
    environmentCredential: Effect.succeed(
      dependencies.environmentCredential ?? Option.some(ENVIRONMENT_CREDENTIAL),
    ),
  });
  return { relay, requests };
};

it.effect("refresh trades the relay-held refresh token for a fresh access token", () =>
  Effect.gen(function* () {
    const bundle = {
      accessToken: "fresh-access-token",
      expiresAt: 1_800_000_000_000,
      scope: "read issues:create",
    };
    const { relay, requests } = makeHarness(() => Response.json(bundle));

    const result = yield* relay.refresh({
      environmentId: ENVIRONMENT_ID,
      connectionId: CONNECTION_ID,
    });

    assert.deepEqual(result, bundle);
    assert.equal(requests.length, 1);
    const request = requests[0]!;
    assert.equal(request.method, "POST");
    assert.equal(
      request.url,
      `${RELAY_URL}/v1/environments/${ENVIRONMENT_ID}/linear/oauth/refresh`,
    );
    assert.equal(request.headers.authorization, `Bearer ${ENVIRONMENT_CREDENTIAL}`);
    assert.deepEqual(requestJson(request), { connectionId: CONNECTION_ID });
  }),
);

it.effect("maps a rejected environment credential to blocked without leaking it for start", () =>
  Effect.gen(function* () {
    const { relay } = makeHarness(() =>
      Response.json(
        {
          _tag: "RelayAuthInvalidError",
          code: "auth_invalid",
          reason: "invalid_bearer",
          traceId: "trace-start",
        },
        { status: 401 },
      ),
    );

    const error = yield* relay
      .start({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);

    assert.instanceOf(error, RoutineError);
    assert.equal(error.code, "blocked");
    assert.include(error.message, "Relink this environment");
    assert.notInclude(error.message, ENVIRONMENT_CREDENTIAL);
    assert.notInclude(error.message, "trace-start");
  }),
);

it.effect("maps a rejected environment credential to blocked without leaking it", () =>
  Effect.gen(function* () {
    const { relay } = makeHarness(() =>
      Response.json(
        {
          _tag: "RelayAuthInvalidError",
          code: "auth_invalid",
          reason: "invalid_bearer",
          traceId: "trace-refresh",
        },
        { status: 401 },
      ),
    );

    const error = yield* relay
      .refresh({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);

    assert.instanceOf(error, RoutineError);
    assert.equal(error.code, "blocked");
    assert.include(error.message, "Relink this environment");
    assert.notInclude(error.message, ENVIRONMENT_CREDENTIAL);
  }),
);

it.effect("reports an unconfigured relay Linear OAuth application", () =>
  Effect.gen(function* () {
    const { relay } = makeHarness(() =>
      Response.json(
        {
          _tag: "RelayLinearOAuthNotConfiguredError",
          code: "linear_oauth_not_configured",
          traceId: "trace-not-configured",
        },
        { status: 503 },
      ),
    );

    const error = yield* relay
      .start({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);

    assert.equal(error.code, "blocked");
    assert.include(error.message, "Linear OAuth");
  }),
);

it.effect("maps a malformed start response to blocked without leaking its body", () =>
  Effect.gen(function* () {
    const { relay } = makeHarness(() =>
      Response.json({ authorizeUrl: 42, leaked: "private-start-response-value" }),
    );

    const error = yield* relay
      .start({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);

    assert.instanceOf(error, RoutineError);
    assert.equal(error.code, "blocked");
    assert.notInclude(error.message, "private-start-response-value");
  }),
);

it.effect("maps a malformed refresh response to blocked without leaking its body", () =>
  Effect.gen(function* () {
    const { relay } = makeHarness(() =>
      Response.json({ accessToken: "private-refresh-token-value", scope: "read" }),
    );

    const error = yield* relay
      .refresh({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);

    assert.instanceOf(error, RoutineError);
    assert.equal(error.code, "blocked");
    assert.notInclude(error.message, "private-refresh-token-value");
  }),
);

it.effect("blocks start when the environment holds no relay credential", () =>
  Effect.gen(function* () {
    const { relay, requests } = makeHarness(
      () => Response.json({ authorizeUrl: "https://linear.app/oauth/authorize" }),
      { environmentCredential: Option.none() },
    );

    const error = yield* relay
      .start({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);

    assert.equal(error.code, "blocked");
    assert.include(error.message, "Link the environment");
    assert.deepEqual(requests, []);
  }),
);

it.effect("blocks refresh when the environment holds no relay credential", () =>
  Effect.gen(function* () {
    const { relay, requests } = makeHarness(() => Response.json({}), {
      environmentCredential: Option.none(),
    });

    const error = yield* relay
      .refresh({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);

    assert.equal(error.code, "blocked");
    assert.isBelow(error.message.length, 200);
    assert.deepEqual(requests, []);
  }),
);

it.effect("blocks both calls when the environment is not linked to a relay", () =>
  Effect.gen(function* () {
    const { relay, requests } = makeHarness(() => Response.json({}), {
      relayUrl: Option.none(),
    });

    const startError = yield* relay
      .start({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);
    const refreshError = yield* relay
      .refresh({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);

    assert.equal(startError.code, "blocked");
    assert.equal(refreshError.code, "blocked");
    assert.deepEqual(requests, []);
  }),
);

it.effect("revoke asks the relay to drop the Linear authorization", () =>
  Effect.gen(function* () {
    const { relay, requests } = makeHarness(() => Response.json({ ok: true }));

    yield* relay.revoke({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID });

    assert.equal(requests.length, 1);
    const request = requests[0]!;
    assert.equal(request.method, "POST");
    assert.equal(request.url, `${RELAY_URL}/v1/linear/oauth/revoke`);
    assert.equal(request.headers.authorization, `Bearer ${CLIENT_ACCESS_TOKEN}`);
    assert.deepEqual(requestJson(request), {
      environmentId: ENVIRONMENT_ID,
      connectionId: CONNECTION_ID,
    });
  }),
);

it.effect("maps a rejected Linear grant to blocked without leaking the response", () =>
  Effect.gen(function* () {
    const { relay } = makeHarness(() =>
      Response.json(
        {
          _tag: "RelayLinearOAuthReauthorizationRequiredError",
          code: "linear_oauth_reauthorization_required",
          traceId: "trace-reauthorize",
        },
        { status: 409 },
      ),
    );

    const error = yield* relay
      .refresh({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);

    assert.instanceOf(error, RoutineError);
    assert.equal(error.code, "blocked");
    assert.include(error.message, "Connect Linear again");
    assert.notInclude(error.message, ENVIRONMENT_CREDENTIAL);
    assert.notInclude(error.message, "trace-reauthorize");
  }),
);

it.effect("blocks revoke when the environment holds no cloud client credential", () =>
  Effect.gen(function* () {
    const { relay, requests } = makeHarness(() => Response.json({ ok: true }), {
      clientAccessToken: Option.none(),
    });

    const error = yield* relay
      .revoke({ environmentId: ENVIRONMENT_ID, connectionId: CONNECTION_ID })
      .pipe(Effect.flip);

    assert.equal(error.code, "blocked");
    assert.include(error.message, "katacode connect login");
    assert.deepEqual(requests, []);
  }),
);

it.effect("start asks the relay for a Linear authorize URL with the environment credential", () =>
  Effect.gen(function* () {
    const { relay, requests } = makeHarness(() =>
      Response.json({ authorizeUrl: "https://linear.app/oauth/authorize?state=abc" }),
    );

    const result = yield* relay.start({
      environmentId: ENVIRONMENT_ID,
      connectionId: CONNECTION_ID,
    });

    assert.deepEqual(result, { authorizeUrl: "https://linear.app/oauth/authorize?state=abc" });
    assert.equal(requests.length, 1);
    const request = requests[0]!;
    assert.equal(request.method, "POST");
    assert.equal(request.url, `${RELAY_URL}/v1/environments/${ENVIRONMENT_ID}/linear/oauth/start`);
    assert.equal(request.headers.authorization, `Bearer ${ENVIRONMENT_CREDENTIAL}`);
    assert.deepEqual(requestJson(request), { connectionId: CONNECTION_ID });
  }),
);
