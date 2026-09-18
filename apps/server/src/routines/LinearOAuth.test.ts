import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { EnvironmentId, RoutineError } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import type { LinearOAuthRelayShape } from "../cloud/LinearOAuthRelay.ts";
import * as ServerConfig from "../config.ts";
import {
  ensureFreshLinearAccessToken,
  readLinearAccessToken,
  routineLinearOAuthSecretName,
  saveLinearAccessToken,
} from "./LinearOAuth.ts";

const environmentId = EnvironmentId.make("linear-oauth-environment");
const relayWith = (refresh: LinearOAuthRelayShape["refresh"]): LinearOAuthRelayShape => ({
  start: () => Effect.die("LinearOAuthRelay.start is not used in these tests"),
  refresh,
  revoke: () => Effect.die("LinearOAuthRelay.revoke is not used in these tests"),
});

const secretsLayer = ServerSecretStore.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-linear-oauth-" })),
  Layer.provide(NodeServices.layer),
);

it.layer(secretsLayer)("linear access token storage", (it) => {
  it.effect("round-trips a token under the routine linear oauth secret name", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const token = {
        accessToken: "linear-access-token",
        expiresAt: 1_800_000_000_000,
        scope: "read issues:create",
      };

      yield* saveLinearAccessToken({ secrets, connectionId: "connection-round-trip", token });

      const stored = yield* secrets.get(routineLinearOAuthSecretName("connection-round-trip"));
      assert.isTrue(Option.isSome(stored));
      const read = yield* readLinearAccessToken({
        secrets,
        connectionId: "connection-round-trip",
      });
      assert.deepEqual(Option.getOrNull(read), token);
    }),
  );

  it.effect("returns none when no token is stored", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const read = yield* readLinearAccessToken({ secrets, connectionId: "connection-missing" });
      assert.isTrue(Option.isNone(read));
    }),
  );

  it.effect("reports malformed stored tokens as persistence errors without echoing the value", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      yield* secrets.set(
        routineLinearOAuthSecretName("connection-malformed"),
        new TextEncoder().encode("linear-access-token-not-json"),
      );

      const error = yield* Effect.flip(
        readLinearAccessToken({ secrets, connectionId: "connection-malformed" }),
      );

      assert.instanceOf(error, RoutineError);
      assert.equal(error.code, "persistence");
      assert.notInclude(error.message, "linear-access-token-not-json");
    }),
  );
});

it.layer(secretsLayer)("ensure fresh linear access token", (it) => {
  it.effect("blocks workspace metadata until Linear is connected", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const error = yield* Effect.flip(
        ensureFreshLinearAccessToken({
          secrets,
          relay: relayWith(() => Effect.die("refresh must not run without a token")),
          environmentId,
          connectionId: "connection-not-connected",
        }),
      );
      assert.instanceOf(error, RoutineError);
      assert.equal(error.code, "blocked");
      assert.include(error.message, "Connect Linear before reading workspace metadata.");
    }),
  );

  it.effect("returns a stored token that is more than a minute from expiry", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const token = {
        accessToken: "linear-access-token",
        expiresAt: 1_800_000_000_000,
        scope: "read",
      };
      yield* saveLinearAccessToken({ secrets, connectionId: "connection-fresh", token });
      const result = yield* ensureFreshLinearAccessToken({
        secrets,
        relay: relayWith(() => Effect.die("refresh must not run for a fresh token")),
        environmentId,
        connectionId: "connection-fresh",
      });
      assert.deepEqual(result, token);
    }),
  );

  it.effect("refreshes through the relay and persists a token that is near expiry", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      yield* saveLinearAccessToken({
        secrets,
        connectionId: "connection-expired",
        token: { accessToken: "stale-access-token", expiresAt: 30_000, scope: "read" },
      });
      const seen: Array<{ environmentId: string; connectionId: string }> = [];
      const refreshed = {
        accessToken: "refreshed-access-token",
        expiresAt: 1_800_000_000_000,
        scope: "read issues:create",
      };
      const result = yield* ensureFreshLinearAccessToken({
        secrets,
        relay: relayWith((input) => {
          seen.push(input);
          return Effect.succeed(refreshed);
        }),
        environmentId,
        connectionId: "connection-expired",
      });
      assert.deepEqual(seen, [{ environmentId, connectionId: "connection-expired" }]);
      assert.deepEqual(result, refreshed);
      const stored = yield* readLinearAccessToken({ secrets, connectionId: "connection-expired" });
      assert.deepEqual(Option.getOrNull(stored), refreshed);
    }),
  );
});
