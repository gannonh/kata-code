import { RoutineError } from "@kata-sh/code-contracts";
import { RelayLinearAccessToken } from "@kata-sh/code-contracts/relay";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

/**
 * The secret name is a file name in the secret store. `connectionId` reaches
 * here only through `RelayLinearConnectionId`, which admits no path separator.
 */
export const routineLinearOAuthSecretName = (connectionId: string): string =>
  `routine-linear-oauth-${connectionId}`;

const LinearAccessTokenJson = Schema.fromJsonString(RelayLinearAccessToken);
const encodeLinearAccessToken = Schema.encodeEffect(LinearAccessTokenJson);
const decodeLinearAccessToken = Schema.decodeUnknownEffect(LinearAccessTokenJson);

const persistenceFailure = (message: string) => new RoutineError({ code: "persistence", message });

export function saveLinearAccessToken(input: {
  readonly secrets: ServerSecretStore.ServerSecretStore["Service"];
  readonly connectionId: string;
  readonly token: RelayLinearAccessToken;
}): Effect.Effect<void, RoutineError> {
  return Effect.gen(function* () {
    const encoded = yield* encodeLinearAccessToken(input.token).pipe(
      Effect.mapError(() => persistenceFailure("Could not encode the Linear access token.")),
    );
    yield* input.secrets
      .set(routineLinearOAuthSecretName(input.connectionId), new TextEncoder().encode(encoded))
      .pipe(Effect.mapError(() => persistenceFailure("Could not store the Linear access token.")));
  });
}

export function readLinearAccessToken(input: {
  readonly secrets: ServerSecretStore.ServerSecretStore["Service"];
  readonly connectionId: string;
}): Effect.Effect<Option.Option<RelayLinearAccessToken>, RoutineError> {
  return Effect.gen(function* () {
    const stored = yield* input.secrets
      .get(routineLinearOAuthSecretName(input.connectionId))
      .pipe(Effect.mapError(() => persistenceFailure("Could not read the Linear access token.")));
    if (Option.isNone(stored)) {
      return Option.none<RelayLinearAccessToken>();
    }
    const decoded = yield* decodeLinearAccessToken(new TextDecoder().decode(stored.value)).pipe(
      Effect.mapError(() => persistenceFailure("Could not decode the Linear access token.")),
    );
    return Option.some(decoded);
  });
}
