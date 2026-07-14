import * as Effect from "effect/Effect";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

export function consumeCloudReplayGuards(input: {
  readonly secrets: ServerSecretStore.ServerSecretStoreShape;
  readonly names: ReadonlyArray<string>;
  readonly value: Uint8Array;
}) {
  return Effect.all(
    input.names.map((name) =>
      input.secrets.create(name, input.value).pipe(
        Effect.as(true),
        Effect.catchTag("SecretStoreError", (error) =>
          ServerSecretStore.isSecretAlreadyExistsError(error)
            ? Effect.succeed(false)
            : Effect.fail(error),
        ),
      ),
    ),
    { concurrency: input.names.length },
  ).pipe(Effect.map((created) => created.every(Boolean)));
}
