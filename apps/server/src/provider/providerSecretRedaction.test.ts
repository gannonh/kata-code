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

it.effect("ignores repeated calls to the same removal handle", () =>
  Effect.sync(() => {
    const secret = "task-secret-idempotent-handle";
    const removeFirst = registerProviderSecret(secret);
    const removeSecond = registerProviderSecret(secret);
    removeFirst();
    removeFirst();
    assert.equal(redactProviderSecrets(secret), REDACTED);
    removeSecond();
    assert.equal(redactProviderSecrets(secret), secret);
  }),
);

it.effect("masks values by credential key name", () =>
  Effect.sync(() => {
    assert.deepEqual(redactProviderSecrets({ authorization: "Bearer unregistered" }), {
      authorization: REDACTED,
    });
  }),
);

it.effect("preserves Error diagnostics while redacting nested secrets", () =>
  Effect.sync(() => {
    const secret = "task-secret-error-cause";
    const remove = registerProviderSecret(secret);
    const error = new Error(`failed with ${secret}`);
    error.cause = new Error(`cause ${secret}`);
    const redacted = redactProviderSecrets(error) as {
      name: string;
      message: string;
      stack?: string;
      cause: { message: string };
    };
    assert.equal(redacted.name, "Error");
    assert.equal(redacted.message, `failed with ${REDACTED}`);
    assert.ok((redacted.stack ?? "").includes(REDACTED));
    assert.ok(!(redacted.stack ?? "").includes(secret));
    assert.equal(redacted.cause.message, `cause ${REDACTED}`);
    remove();
  }),
);

it.effect("terminates cyclic objects and preserves non-plain values", () =>
  Effect.sync(() => {
    const cyclic: { self?: unknown; note: string } = { note: "visible" };
    cyclic.self = cyclic;
    const redacted = redactProviderSecrets(cyclic) as { self: unknown; note: string };
    assert.equal(redacted.note, "visible");
    assert.equal(redacted.self, REDACTED);
    const bytes = new Uint8Array([1, 2, 3]);
    assert.equal(redactProviderSecrets(bytes), bytes);
  }),
);
