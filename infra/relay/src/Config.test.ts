import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { linearOAuthConfig, managedEndpointCleanupModeConfig } from "./Config.ts";

it.effect.each([
  { name: "missing", env: {}, expected: "off" },
  { name: "empty", env: { RELAY_TUNNEL_CLEANUP_MODE: "" }, expected: "off" },
  { name: "whitespace", env: { RELAY_TUNNEL_CLEANUP_MODE: "  \t" }, expected: "off" },
  { name: "off", env: { RELAY_TUNNEL_CLEANUP_MODE: "off" }, expected: "off" },
  {
    name: "dry-run",
    env: { RELAY_TUNNEL_CLEANUP_MODE: "dry-run" },
    expected: "dry-run",
  },
  { name: "enabled", env: { RELAY_TUNNEL_CLEANUP_MODE: "enabled" }, expected: "enabled" },
] as const)("loads $name cleanup mode as $expected", ({ env, expected }) =>
  Effect.gen(function* () {
    const provider = ConfigProvider.fromEnv({ env });
    expect(yield* managedEndpointCleanupModeConfig.parse(provider)).toBe(expected);
  }),
);

it.effect("rejects an invalid cleanup mode", () =>
  Effect.gen(function* () {
    const provider = ConfigProvider.fromEnv({
      env: { RELAY_TUNNEL_CLEANUP_MODE: "delete-everything" },
    });
    const error = yield* Effect.flip(managedEndpointCleanupModeConfig.parse(provider));

    expect(error._tag).toBe("ConfigError");
    expect(error.message).toContain('Expected "off" | "dry-run" | "enabled"');
  }),
);

const LINEAR_CLIENT = {
  LINEAR_OAUTH_CLIENT_ID: "linear-client-id",
  LINEAR_OAUTH_CLIENT_SECRET: "linear-client-secret",
} as const;
const TOKEN_ENCRYPTION_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

it.effect("loads the Linear client with a 32-byte token encryption key", () =>
  Effect.gen(function* () {
    const provider = ConfigProvider.fromEnv({
      env: { ...LINEAR_CLIENT, LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY: TOKEN_ENCRYPTION_KEY },
    });
    const linearOAuth = yield* linearOAuthConfig.parse(provider);

    expect(linearOAuth?.clientId).toBe("linear-client-id");
    expect(linearOAuth && Redacted.value(linearOAuth.clientSecret)).toBe("linear-client-secret");
    expect(linearOAuth && Redacted.value(linearOAuth.tokenEncryptionKey)).toBe(
      TOKEN_ENCRYPTION_KEY,
    );
  }),
);

it.effect.each([
  { name: "nothing set", env: {} },
  { name: "only a key", env: { LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY: TOKEN_ENCRYPTION_KEY } },
  {
    name: "a blank client secret",
    env: { ...LINEAR_CLIENT, LINEAR_OAUTH_CLIENT_SECRET: " " },
  },
] as const)("leaves Linear unconfigured with $name", ({ env }) =>
  Effect.gen(function* () {
    const provider = ConfigProvider.fromEnv({ env });
    expect(yield* linearOAuthConfig.parse(provider)).toBeNull();
  }),
);

it.effect.each([
  { name: "missing", env: LINEAR_CLIENT },
  { name: "blank", env: { ...LINEAR_CLIENT, LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY: "" } },
  {
    name: "16 bytes",
    env: { ...LINEAR_CLIENT, LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQ==" },
  },
  {
    name: "not base64",
    env: { ...LINEAR_CLIENT, LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY: "not-a-base64-key!" },
  },
] as const)("rejects a configured Linear client whose token key is $name", ({ env }) =>
  Effect.gen(function* () {
    const provider = ConfigProvider.fromEnv({ env });
    const error = yield* Effect.flip(linearOAuthConfig.parse(provider));

    expect(error._tag).toBe("ConfigError");
    expect(error.message).toBe(
      "SchemaError(LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY must be base64 of 32 random bytes when the Linear OAuth client is configured)",
    );
    expect(error.message).not.toContain("AQEBAQEBAQEBAQEBAQEBAQ");
  }),
);
