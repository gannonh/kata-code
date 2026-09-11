// @effect-diagnostics nodeBuiltinImport:off - Tests exercise 1Password env loading without an Effect runtime.
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_OP_ENVIRONMENT_ID,
  loadRepoEnv,
  OnePasswordEnvironmentReadError,
  resolvePublicConfig,
} from "./public-config.ts";

describe("loadRepoEnv", () => {
  it("does not project cloud configuration for an unconfigured clone", () => {
    const env = loadRepoEnv({
      baseEnv: {},
      readOpEnvironment: () => {
        throw new Error("should not read 1Password without a service account token");
      },
    });

    expect(env.KATACODE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.KATACODE_CLERK_CLI_OAUTH_CLIENT_ID).toBeUndefined();
    expect(env.VITE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.KATACODE_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.VITE_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.KATACODE_RELAY_URL).toBeUndefined();
    expect(env.VITE_KATACODE_RELAY_URL).toBeUndefined();
    expect(env.KATACODE_MOBILE_OTLP_TRACES_URL).toBeUndefined();
    expect(env.KATACODE_MOBILE_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.KATACODE_MOBILE_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_URL).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.KATACODE_RELAY_CLIENT_OTLP_TRACES_URL).toBeUndefined();
    expect(env.KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_URL).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_TOKEN).toBeUndefined();
  });

  it("applies process env over 1Password Environment values", () => {
    let requestedId = "";
    const env = loadRepoEnv({
      baseEnv: {
        OP_SERVICE_ACCOUNT_TOKEN: "ops_test",
        KATACODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
        KATACODE_CLERK_JWT_TEMPLATE: "template_ci",
        KATACODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
        KATACODE_RELAY_URL: "https://ci.example.test",
      },
      readOpEnvironment: ({ environmentId }) => {
        requestedId = environmentId;
        return {
          KATACODE_CLERK_PUBLISHABLE_KEY: "pk_op",
          KATACODE_CLERK_JWT_TEMPLATE: "template_op",
          KATACODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_op",
          KATACODE_RELAY_URL: "https://op.example.test",
        };
      },
    });

    expect(requestedId).toBe(DEFAULT_OP_ENVIRONMENT_ID);
    expect(env).toMatchObject({
      KATACODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      KATACODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ci",
      KATACODE_CLERK_JWT_TEMPLATE: "template_ci",
      VITE_CLERK_JWT_TEMPLATE: "template_ci",
      EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_ci",
      KATACODE_RELAY_URL: "https://ci.example.test",
      VITE_KATACODE_RELAY_URL: "https://ci.example.test",
    });
  });

  it("uses 1Password values when process env does not set them", () => {
    const env = loadRepoEnv({
      baseEnv: { OP_SERVICE_ACCOUNT_TOKEN: "ops_test" },
      readOpEnvironment: () => ({
        KATACODE_RELAY_URL: "https://op.example.test",
        KATACODE_CLERK_PUBLISHABLE_KEY: "pk_op",
      }),
    });

    expect(env.KATACODE_RELAY_URL).toBe("https://op.example.test");
    expect(env.VITE_KATACODE_RELAY_URL).toBe("https://op.example.test");
    expect(env.KATACODE_CLERK_PUBLISHABLE_KEY).toBe("pk_op");
    expect(env.VITE_CLERK_PUBLISHABLE_KEY).toBe("pk_op");
  });

  it("honors OP_ENVIRONMENT_ID", () => {
    let requestedId = "";
    loadRepoEnv({
      baseEnv: {
        OP_SERVICE_ACCOUNT_TOKEN: "ops_test",
        OP_ENVIRONMENT_ID: "custom-environment-id",
      },
      readOpEnvironment: ({ environmentId }) => {
        requestedId = environmentId;
        return {};
      },
    });
    expect(requestedId).toBe("custom-environment-id");
  });

  it("fails closed when 1Password read fails", () => {
    expect(() =>
      loadRepoEnv({
        baseEnv: { OP_SERVICE_ACCOUNT_TOKEN: "ops_test" },
        readOpEnvironment: () => {
          throw new OnePasswordEnvironmentReadError("env-id", "not signed in");
        },
      }),
    ).toThrow(/1Password Environment env-id/);
  });

  it("accepts legacy framework aliases as root overrides", () => {
    expect(
      resolvePublicConfig({
        VITE_CLERK_PUBLISHABLE_KEY: "pk_legacy",
        VITE_CLERK_JWT_TEMPLATE: "template_legacy",
        KATACODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_canonical",
        VITE_KATACODE_RELAY_URL: "https://legacy.example.test",
        EXPO_PUBLIC_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
        EXPO_PUBLIC_OTLP_TRACES_DATASET: "mobile-traces",
        EXPO_PUBLIC_OTLP_TRACES_TOKEN: "mobile-token",
      }),
    ).toEqual({
      clerkPublishableKey: "pk_legacy",
      clerkJwtTemplate: "template_legacy",
      clerkCliOAuthClientId: "oauth_canonical",
      relayUrl: "https://legacy.example.test",
      mobileOtlpTracesUrl: "https://api.axiom.co/v1/traces",
      mobileOtlpTracesDataset: "mobile-traces",
      mobileOtlpTracesToken: "mobile-token",
      relayClientOtlpTracesUrl: undefined,
      relayClientOtlpTracesDataset: undefined,
      relayClientOtlpTracesToken: undefined,
    });
  });

  it("projects canonical relay client tracing values to web build aliases", () => {
    expect(
      loadRepoEnv({
        baseEnv: {
          KATACODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
          KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "relay-client-traces",
          KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "relay-client-token",
        },
        readOpEnvironment: () => {
          throw new Error("should not read 1Password without a service account token");
        },
      }),
    ).toEqual({
      KATACODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "relay-client-traces",
      KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "relay-client-token",
      VITE_RELAY_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      VITE_RELAY_OTLP_TRACES_DATASET: "relay-client-traces",
      VITE_RELAY_OTLP_TRACES_TOKEN: "relay-client-token",
    });
  });

  it("projects canonical mobile tracing values to Expo public aliases", () => {
    expect(
      loadRepoEnv({
        baseEnv: {
          KATACODE_RELAY_URL: "https://relay.example.test",
          KATACODE_MOBILE_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
          KATACODE_MOBILE_OTLP_TRACES_DATASET: "mobile-traces",
          KATACODE_MOBILE_OTLP_TRACES_TOKEN: "mobile-token",
        },
        readOpEnvironment: () => {
          throw new Error("should not read 1Password without a service account token");
        },
      }),
    ).toEqual({
      KATACODE_RELAY_URL: "https://relay.example.test",
      VITE_KATACODE_RELAY_URL: "https://relay.example.test",
      KATACODE_MOBILE_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      KATACODE_MOBILE_OTLP_TRACES_DATASET: "mobile-traces",
      KATACODE_MOBILE_OTLP_TRACES_TOKEN: "mobile-token",
      EXPO_PUBLIC_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      EXPO_PUBLIC_OTLP_TRACES_DATASET: "mobile-traces",
      EXPO_PUBLIC_OTLP_TRACES_TOKEN: "mobile-token",
    });
  });
});
