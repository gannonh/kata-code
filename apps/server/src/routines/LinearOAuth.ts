import { RoutineError } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

export interface LinearOAuthBundle {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly scope: string;
}

export const routineLinearOAuthSecretName = (connectionId: string): string =>
  `routine-linear-oauth-${connectionId}`;

const LinearOAuthBundleJson = Schema.fromJsonString(
  Schema.Struct({
    accessToken: Schema.String,
    refreshToken: Schema.String,
    expiresAt: Schema.Number,
    scope: Schema.String,
  }),
);

const encodeLinearOAuthBundle = Schema.encodeEffect(LinearOAuthBundleJson);
const decodeLinearOAuthBundle = Schema.decodeUnknownEffect(LinearOAuthBundleJson);

const persistenceFailure = (message: string) => new RoutineError({ code: "persistence", message });

const bytesToString = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const stringToBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

export function saveLinearOAuthBundle(input: {
  readonly secrets: ServerSecretStore.ServerSecretStore["Service"];
  readonly connectionId: string;
  readonly bundle: LinearOAuthBundle;
}): Effect.Effect<void, RoutineError> {
  return Effect.gen(function* () {
    const encoded = yield* encodeLinearOAuthBundle(input.bundle).pipe(
      Effect.mapError(() => persistenceFailure("Could not encode the Linear OAuth bundle.")),
    );
    yield* input.secrets
      .set(routineLinearOAuthSecretName(input.connectionId), stringToBytes(encoded))
      .pipe(Effect.mapError(() => persistenceFailure("Could not store the Linear OAuth bundle.")));
  });
}

export function readLinearOAuthBundle(input: {
  readonly secrets: ServerSecretStore.ServerSecretStore["Service"];
  readonly connectionId: string;
}): Effect.Effect<Option.Option<LinearOAuthBundle>, RoutineError> {
  return Effect.gen(function* () {
    const stored = yield* input.secrets
      .get(routineLinearOAuthSecretName(input.connectionId))
      .pipe(Effect.mapError(() => persistenceFailure("Could not read the Linear OAuth bundle.")));
    if (Option.isNone(stored)) {
      return Option.none<LinearOAuthBundle>();
    }
    const decoded = yield* decodeLinearOAuthBundle(bytesToString(stored.value)).pipe(
      Effect.mapError(() => persistenceFailure("Could not decode the Linear OAuth bundle.")),
    );
    return Option.some(decoded);
  });
}
