import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { RoutineError } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import {
  readLinearOAuthBundle,
  routineLinearOAuthSecretName,
  saveLinearOAuthBundle,
  type LinearOAuthBundle,
} from "./LinearOAuth.ts";

const secretsLayer = ServerSecretStore.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-linear-oauth-" })),
  Layer.provide(NodeServices.layer),
);

it.layer(secretsLayer)("linear oauth bundle storage", (it) => {
  it.effect("round-trips a bundle under the routine linear oauth secret name", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const bundle: LinearOAuthBundle = {
        accessToken: "linear-access-token",
        refreshToken: "linear-refresh-token",
        expiresAt: 1_800_000_000_000,
        scope: "read issues:create",
      };

      yield* saveLinearOAuthBundle({ secrets, connectionId: "connection-round-trip", bundle });

      const stored = yield* secrets.get(routineLinearOAuthSecretName("connection-round-trip"));
      assert.isTrue(Option.isSome(stored));
      const read = yield* readLinearOAuthBundle({
        secrets,
        connectionId: "connection-round-trip",
      });
      assert.deepEqual(Option.getOrNull(read), bundle);
    }),
  );

  it.effect("returns none when no bundle is stored", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const read = yield* readLinearOAuthBundle({ secrets, connectionId: "connection-missing" });
      assert.isTrue(Option.isNone(read));
    }),
  );

  it.effect(
    "reports malformed stored bundles as persistence errors without echoing the value",
    () =>
      Effect.gen(function* () {
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        yield* secrets.set(
          routineLinearOAuthSecretName("connection-malformed"),
          new TextEncoder().encode("linear-access-token-not-json"),
        );

        const error = yield* Effect.flip(
          readLinearOAuthBundle({ secrets, connectionId: "connection-malformed" }),
        );

        assert.instanceOf(error, RoutineError);
        assert.equal(error.code, "persistence");
        assert.notInclude(error.message, "linear-access-token-not-json");
      }),
  );
});
