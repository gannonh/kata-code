import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  REDACTED,
  redactProviderEvent,
  redactProviderSecrets,
  registerProviderSecret,
  registeredProviderSecretCount,
} from "./providerSecretRedaction.ts";

it.effect("redacts nested values and releases a secret after its final owner closes", () =>
  Effect.sync(() => {
    const secret = "task-secret-provider-redaction-test";
    const removeFirst = registerProviderSecret(secret);
    const removeSecond = registerProviderSecret(secret);

    assert.isAbove(registeredProviderSecretCount(), 0);
    assert.deepEqual(
      redactProviderEvent({
        payload: { output: `printed ${secret}`, token: secret },
        raw: { payload: [`${secret}:suffix`] },
      }),
      {
        payload: { output: `printed ${REDACTED}`, token: REDACTED },
        raw: { payload: [`${REDACTED}:suffix`] },
      },
    );

    removeFirst();
    assert.equal(redactProviderSecrets(secret), REDACTED);
    removeSecond();
    assert.equal(redactProviderSecrets(secret), secret);
  }),
);

it.effect("does not retain empty credentials", () =>
  Effect.sync(() => {
    const count = registeredProviderSecretCount();
    const remove = registerProviderSecret("   ");
    remove();
    assert.equal(registeredProviderSecretCount(), count);
  }),
);
