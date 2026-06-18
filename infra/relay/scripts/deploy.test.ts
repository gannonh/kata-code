import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  createDeployConfigProvider,
  removeLeadingPackageManagerSeparator,
  hasDeployChanges,
  publicConfigFromOutput,
  reconcileRootEnvPublicConfig,
  reconcileRootEnvRelayUrl,
  serializeGithubOutput,
  serializeRelayClientTracingEnvironment,
} from "./deploy.ts";

describe("removeLeadingPackageManagerSeparator", () => {
  it("removes the package manager separator before CLI flag parsing", () => {
    const argv = ["node", "scripts/deploy.ts", "--", "--stage", "prod", "--dry-run"];

    removeLeadingPackageManagerSeparator(argv);

    expect(argv).toEqual(["node", "scripts/deploy.ts", "--stage", "prod", "--dry-run"]);
  });

  it("leaves argv unchanged when the separator is absent", () => {
    const argv = ["node", "scripts/deploy.ts", "--stage", "prod", "--dry-run"];

    removeLeadingPackageManagerSeparator(argv);

    expect(argv).toEqual(["node", "scripts/deploy.ts", "--stage", "prod", "--dry-run"]);
  });
});

describe("createDeployConfigProvider", () => {
  it("forces CI when dry-run or yes is set", () => {
    const previousCi = process.env.CI;
    delete process.env.CI;

    createDeployConfigProvider({
      dryRun: true,
      force: false,
      envFile: Option.none(),
      stage: Option.none(),
      yes: true,
      adopt: false,
      githubOutput: false,
      githubEnvFile: Option.none(),
      readState: false,
    });

    expect(process.env.CI).toBe("true");

    if (previousCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previousCi;
    }
  });
});

describe("hasDeployChanges", () => {
  it("detects resource, binding, and deletion changes", () => {
    expect(hasDeployChanges({ resources: {}, deletions: {} } as never)).toBe(false);
    expect(
      hasDeployChanges({
        resources: {
          api: { action: "create", bindings: [] },
        },
        deletions: {},
      } as never),
    ).toBe(true);
    expect(
      hasDeployChanges({
        resources: {
          api: { action: "noop", bindings: [{ action: "update" }] },
        },
        deletions: {},
      } as never),
    ).toBe(true);
    expect(
      hasDeployChanges({
        resources: {},
        deletions: {
          api: { action: "delete", bindings: [] },
        },
      } as never),
    ).toBe(true);
  });
});

describe("reconcileRootEnvRelayUrl", () => {
  it("adds the relay URL to an empty root env file", () => {
    expect(reconcileRootEnvRelayUrl("", "https://relay.example.test")).toBe(
      "KATACODE_RELAY_URL=https://relay.example.test\n",
    );
  });

  it("preserves unrelated root env entries while replacing a previous relay URL", () => {
    expect(
      reconcileRootEnvRelayUrl(
        "KATACODE_CLERK_PUBLISHABLE_KEY=pk_test_example\nKATACODE_RELAY_URL=https://old.example.test\n",
        "https://relay.example.test",
      ),
    ).toBe(
      "KATACODE_CLERK_PUBLISHABLE_KEY=pk_test_example\nKATACODE_RELAY_URL=https://relay.example.test\n",
    );
  });
});

describe("reconcileRootEnvPublicConfig", () => {
  const config = {
    relayUrl: "https://relay.example.test",
    mobileTracingUrl: "https://api.axiom.co/v1/traces",
    mobileTracingDataset: "kata-code-mobile-traces-dev",
    mobileTracingToken: "xaat-public-ingest",
    clientTracingUrl: "https://api.axiom.co/v1/traces",
    clientTracingDataset: "kata-code-relay-client-traces-dev",
    clientTracingToken: "xaat-relay-client-ingest",
  } as const;

  it("adds the complete local client config", () => {
    expect(reconcileRootEnvPublicConfig("", config)).toBe(
      [
        "KATACODE_RELAY_URL=https://relay.example.test",
        "KATACODE_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "KATACODE_MOBILE_OTLP_TRACES_DATASET=kata-code-mobile-traces-dev",
        "KATACODE_MOBILE_OTLP_TRACES_TOKEN=xaat-public-ingest",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET=kata-code-relay-client-traces-dev",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-relay-client-ingest",
        "",
      ].join("\n"),
    );
  });

  it("replaces stale values while preserving unrelated entries", () => {
    expect(
      reconcileRootEnvPublicConfig(
        [
          "KATACODE_CLERK_PUBLISHABLE_KEY=pk_test_example",
          "KATACODE_RELAY_URL=https://old.example.test",
          "KATACODE_MOBILE_OTLP_TRACES_URL=https://old.example.test/v1/traces",
          "KATACODE_MOBILE_OTLP_TRACES_DATASET=old-dataset",
          "KATACODE_MOBILE_OTLP_TRACES_TOKEN=old-token",
          "KATACODE_RELAY_CLIENT_OTLP_TRACES_URL=https://old.example.test/v1/traces",
          "KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET=old-client-dataset",
          "KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN=old-client-token",
          "",
        ].join("\n"),
        config,
      ),
    ).toBe(
      [
        "KATACODE_CLERK_PUBLISHABLE_KEY=pk_test_example",
        "KATACODE_RELAY_URL=https://relay.example.test",
        "KATACODE_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "KATACODE_MOBILE_OTLP_TRACES_DATASET=kata-code-mobile-traces-dev",
        "KATACODE_MOBILE_OTLP_TRACES_TOKEN=xaat-public-ingest",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET=kata-code-relay-client-traces-dev",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-relay-client-ingest",
        "",
      ].join("\n"),
    );
  });
});

describe("serializeGithubOutput", () => {
  it("serializes relay deploy metadata for GitHub Actions outputs", () => {
    expect(
      serializeGithubOutput({
        changed: false,
        result: "noop",
        relay_url: "https://relay.example.test",
      }),
    ).toBe("changed=false\nresult=noop\nrelay_url=https://relay.example.test\n");
  });
});

describe("serializeRelayClientTracingEnvironment", () => {
  it("serializes tracing config for downstream GITHUB_ENV loading", () => {
    expect(
      serializeRelayClientTracingEnvironment({
        relayUrl: "https://relay.example.test",
        mobileTracingUrl: "https://api.axiom.co/v1/traces",
        mobileTracingDataset: "mobile",
        mobileTracingToken: "mobile-token",
        clientTracingUrl: "https://api.axiom.co/v1/traces",
        clientTracingDataset: "relay",
        clientTracingToken: "client-token",
      }),
    ).toBe(
      [
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET=relay",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN=client-token",
        "",
      ].join("\n"),
    );
  });
});

describe("release workflow tracing config propagation", () => {
  it.effect("reads production relay config from Alchemy state during release preflight", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workflowPath = yield* path.fromFileUrl(
        new URL("../../../.github/workflows/release.yml", import.meta.url),
      );
      const workflow = yield* fileSystem.readFileString(workflowPath);

      expect(workflow).toContain("relay_client_otlp_traces_token:");
      expect(workflow).toContain("read-public-config.ts");
      expect(workflow).toContain("--github-output");
      expect(workflow).toContain("resolve-connect-public-config.ts");
      expect(workflow).toContain("REQUIRE_CONNECT_CONFIG");
      expect(workflow).toContain("resolve_public_config:");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("publicConfigFromOutput", () => {
  it("reads the complete public tracing config from persisted Alchemy output", () => {
    expect(
      publicConfigFromOutput({
        url: "https://relay.example.test",
        mobileTracingUrl: "https://api.axiom.co/v1/traces",
        mobileTracingDataset: "mobile",
        mobileTracingToken: "mobile-token",
        clientTracingUrl: "https://api.axiom.co/v1/traces",
        clientTracingDataset: "relay",
        clientTracingToken: "client-token",
      }),
    ).toEqual({
      relayUrl: "https://relay.example.test",
      mobileTracingUrl: "https://api.axiom.co/v1/traces",
      mobileTracingDataset: "mobile",
      mobileTracingToken: "mobile-token",
      clientTracingUrl: "https://api.axiom.co/v1/traces",
      clientTracingDataset: "relay",
      clientTracingToken: "client-token",
    });
  });

  it("rejects incomplete stack output", () => {
    expect(publicConfigFromOutput({ url: "https://relay.example.test" })).toBeNull();
  });
});
