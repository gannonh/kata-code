import * as NodeCrypto from "node:crypto";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { EnvironmentHttpApi, EnvironmentId } from "@kata-sh/code-contracts";
import { wireEnvironmentIssuer } from "@kata-sh/code-contracts/wireIdentity";
import { RELAY_LINEAR_OAUTH_DELIVERY_TYP } from "@kata-sh/code-shared/relayJwt";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpPlatform from "effect/unstable/http/HttpPlatform";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { environmentAuthenticatedAuthLayer } from "../auth/http.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { readLinearAccessToken, routineLinearOAuthSecretName } from "../routines/LinearOAuth.ts";
import * as CliTokenManager from "./CliTokenManager.ts";
import { CLOUD_LINKED_USER_ID, CLOUD_MINT_PUBLIC_KEY, RELAY_ISSUER_SECRET } from "./config.ts";
import { connectHttpApiLayer } from "./http.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";

const environmentId = EnvironmentId.make("environment-linear-oauth");
const connectionId = "connection-linear-oauth";
const accessToken = "linear-access-token-secret";
const tokenExpiresAt = 1_800_000_000_000;
const scope = "read issues:create";

class ConnectTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.connect) {}

const routesLayer = HttpApiBuilder.layer(ConnectTestApi).pipe(
  Layer.provide(connectHttpApiLayer),
  Layer.provide(environmentAuthenticatedAuthLayer),
);

const appLayer = HttpRouter.serve(routesLayer, {
  disableListenLog: true,
  disableLogger: true,
}).pipe(
  Layer.provideMerge(
    ServerSecretStore.layer.pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-linear-oauth-delivery-" })),
      Layer.provide(NodeServices.layer),
    ),
  ),
  Layer.provideMerge(
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(environmentId),
    }),
  ),
  Layer.provide(Layer.mock(ManagedEndpointRuntime.CloudManagedEndpointRuntime)({})),
  Layer.provide(Layer.mock(EnvironmentAuth.EnvironmentAuth)({})),
  Layer.provide(Layer.mock(CliTokenManager.CloudCliTokenManager)({})),
  Layer.provide(FetchHttpClient.layer),
  Layer.provideMerge(
    HttpPlatform.layer.pipe(
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(Etag.layerWeak),
    ),
  ),
  Layer.provide(NodeServices.layer),
);

const generateCloudKeyPair = () =>
  NodeCrypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });

const seedCloudSecrets = (publicKey: string) =>
  Effect.gen(function* () {
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    yield* secrets.set(CLOUD_MINT_PUBLIC_KEY, new TextEncoder().encode(publicKey));
    yield* secrets.set(RELAY_ISSUER_SECRET, new TextEncoder().encode("https://relay.example.test"));
    yield* secrets.set(CLOUD_LINKED_USER_ID, new TextEncoder().encode("user_123"));
  });

const makeDeliveryProof = (input: {
  readonly privateKey: string;
  readonly environmentId: EnvironmentId;
  readonly jti: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly jwtExpiresAt: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly subject?: string;
  readonly connectionId?: string;
}) => {
  const nowSeconds = Math.floor(DateTime.makeUnsafe(input.issuedAt).epochMilliseconds / 1_000);
  const payload = {
    iss: input.issuer ?? "https://relay.example.test",
    aud: input.audience ?? wireEnvironmentIssuer(environmentId),
    sub: input.subject ?? "user_123",
    jti: input.jti,
    environmentId: input.environmentId,
    connectionId: input.connectionId ?? connectionId,
    token: { accessToken, expiresAt: tokenExpiresAt, scope },
    nonce: input.nonce,
    iat: nowSeconds,
    exp: Math.floor(DateTime.makeUnsafe(input.jwtExpiresAt).epochMilliseconds / 1_000),
  };
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: RELAY_LINEAR_OAUTH_DELIVERY_TYP }),
  ).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${encodedPayload}`;
  return {
    proof: `${signingInput}.${NodeCrypto.sign(null, Buffer.from(signingInput), input.privateKey).toString("base64url")}`,
  };
};

const proofFor = (
  privateKey: string,
  options?: {
    readonly environmentId?: EnvironmentId;
    readonly subject?: string;
    readonly connectionId?: string;
    readonly lifetimeMinutes?: number;
  },
) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const unique = NodeCrypto.randomUUID();
    return makeDeliveryProof({
      privateKey,
      environmentId: options?.environmentId ?? environmentId,
      jti: `linear-oauth-jti-${unique}`,
      nonce: `linear-oauth-nonce-${unique}`,
      issuedAt: DateTime.formatIso(now),
      jwtExpiresAt: DateTime.formatIso(
        DateTime.add(now, { minutes: options?.lifetimeMinutes ?? 5 }),
      ),
      ...(options?.subject ? { subject: options.subject } : {}),
      ...(options?.connectionId ? { connectionId: options.connectionId } : {}),
    });
  });

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const postProof = (proof: string) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      HttpClientRequest.post("/api/connect/linear-oauth").pipe(
        HttpClientRequest.setHeaders({ "content-type": "application/json" }),
        HttpClientRequest.bodyText(encodeJson({ proof }), "application/json"),
      ),
    );
    const body = (yield* response.json) as Record<string, unknown>;
    return { status: response.status, body };
  });

it.layer(appLayer.pipe(Layer.provideMerge(NodeHttpServer.layerTest)))(
  "linear oauth delivery",
  (it) => {
    it.effect("stores the delivered access token and answers ok", () =>
      Effect.gen(function* () {
        const keyPair = generateCloudKeyPair();
        yield* seedCloudSecrets(keyPair.publicKey);
        const request = yield* proofFor(keyPair.privateKey);

        const response = yield* postProof(request.proof);

        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { ok: true });
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        const stored = yield* secrets.get(routineLinearOAuthSecretName(connectionId));
        assert.isTrue(Option.isSome(stored));
        const token = yield* readLinearAccessToken({ secrets, connectionId });
        assert.deepEqual(Option.getOrNull(token), {
          accessToken,
          expiresAt: tokenExpiresAt,
          scope,
        });
      }),
    );

    it.effect("rejects a proof bound to another environment without echoing tokens", () =>
      Effect.gen(function* () {
        const keyPair = generateCloudKeyPair();
        yield* seedCloudSecrets(keyPair.publicKey);
        const request = yield* proofFor(keyPair.privateKey, {
          environmentId: EnvironmentId.make("environment-other"),
        });

        const response = yield* postProof(request.proof);

        assert.equal(response.status, 401);
        assert.notInclude(encodeJson(response.body), accessToken);
      }),
    );

    it.effect("rejects replayed proofs without echoing tokens", () =>
      Effect.gen(function* () {
        const keyPair = generateCloudKeyPair();
        yield* seedCloudSecrets(keyPair.publicKey);
        const request = yield* proofFor(keyPair.privateKey);

        const first = yield* postProof(request.proof);
        const replay = yield* postProof(request.proof);

        assert.equal(first.status, 200);
        assert.equal(replay.status, 409);
        assert.notInclude(encodeJson(replay.body), accessToken);
      }),
    );

    it.effect("rejects a proof signed by an unknown key without echoing tokens", () =>
      Effect.gen(function* () {
        const keyPair = generateCloudKeyPair();
        const attackerKeyPair = generateCloudKeyPair();
        yield* seedCloudSecrets(keyPair.publicKey);
        const request = yield* proofFor(attackerKeyPair.privateKey);

        const response = yield* postProof(request.proof);

        assert.equal(response.status, 401);
        assert.notInclude(encodeJson(response.body), accessToken);
      }),
    );
    it.effect("rejects a proof issued for a user who did not install this environment", () =>
      Effect.gen(function* () {
        const keyPair = generateCloudKeyPair();
        yield* seedCloudSecrets(keyPair.publicKey);
        const request = yield* proofFor(keyPair.privateKey, {
          subject: "user_other",
          connectionId: "connection-other-user",
        });

        const response = yield* postProof(request.proof);

        assert.equal(response.status, 401);
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        const stored = yield* secrets.get(routineLinearOAuthSecretName("connection-other-user"));
        assert.isTrue(Option.isNone(stored));
      }),
    );

    it.effect("rejects a proof that outlives the cloud proof lifetime", () =>
      Effect.gen(function* () {
        const keyPair = generateCloudKeyPair();
        yield* seedCloudSecrets(keyPair.publicKey);
        const request = yield* proofFor(keyPair.privateKey, { lifetimeMinutes: 60 });

        const response = yield* postProof(request.proof);

        assert.equal(response.status, 401);
      }),
    );

    it.effect("rejects a connection id that would leave the secret directory", () =>
      Effect.gen(function* () {
        const keyPair = generateCloudKeyPair();
        yield* seedCloudSecrets(keyPair.publicKey);
        const request = yield* proofFor(keyPair.privateKey, {
          connectionId: "x/../relay-issuer",
        });

        const response = yield* postProof(request.proof);

        assert.equal(response.status, 401);
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        const issuer = yield* secrets.get(RELAY_ISSUER_SECRET);
        assert.equal(
          new TextDecoder().decode(Option.getOrThrow(issuer)),
          "https://relay.example.test",
        );
      }),
    );
  },
);
