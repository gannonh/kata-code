import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  hasDeployChanges,
  missingRelayPublicConfigFields,
  postgresReplaceCensusFromPlan,
  publicConfigFromOutput,
  RelayDeployError,
  RelayDeployPublicConfigUnavailableError,
  serializeGithubOutput,
  serializeRelayClientTracingEnvironment,
} from "./deploy.ts";

describe("RelayDeployError", () => {
  it("reports the incomplete state source, stage, and missing fields", () => {
    const missingFields = missingRelayPublicConfigFields({
      url: "https://relay.example.test",
      mobileTracingUrl: "https://api.axiom.co/v1/traces",
    });
    const error = new RelayDeployError({
      source: "alchemy_state",
      stage: "production",
      missingFields,
    });

    expect(error).toMatchObject({
      source: "alchemy_state",
      stage: "production",
      missingFields: [
        "mobileTracingDataset",
        "mobileTracingToken",
        "clientTracingUrl",
        "clientTracingDataset",
        "clientTracingToken",
      ],
    });
    expect(error.message).toBe(
      "Relay deploy output from 'alchemy_state' for stage 'production' is missing required public config fields: mobileTracingDataset, mobileTracingToken, clientTracingUrl, clientTracingDataset, clientTracingToken",
    );
  });

  it("distinguishes deploy results that do not produce public config", () => {
    const error = new RelayDeployPublicConfigUnavailableError({
      result: "dry-run",
      stage: "production",
      outputPath: "/tmp/relay-client.env",
    });

    expect(error.message).toBe(
      "Relay deploy result 'dry-run' for stage 'production' did not produce public config required by GitHub environment output '/tmp/relay-client.env'.",
    );
  });
});

describe("postgresReplaceCensusFromPlan", () => {
  it("names Alchemy replace actors from the planned database node", () => {
    expect(
      postgresReplaceCensusFromPlan({
        resources: {
          RelayPostgresDatabase: {
            resource: { LogicalId: "RelayPostgresDatabase" },
            action: "replace",
            mode: "live",
            props: { name: "katacoderelay", region: { slug: "us-west" }, replicas: 0 },
            state: {
              status: "updated",
              providerMode: "live",
              props: { name: "katacoderelay", replicas: 2 },
              attr: { name: "katacoderelay", region: { slug: "us-east" } },
            },
          },
        },
        deletions: {},
      } as never),
    ).toEqual({
      actors: ["region", "replicas"],
      status: "updated",
      providerMode: "live",
      planMode: "live",
      news: { name: "katacoderelay", region: { slug: "us-west" }, replicas: 0 },
      olds: { name: "katacoderelay", replicas: 2 },
      output: { name: "katacoderelay", region: { slug: "us-east" } },
    });
  });

  it("names a stuck replace from the live old generation, not the in-flight props", () => {
    expect(
      postgresReplaceCensusFromPlan({
        resources: {
          RelayPostgresDatabase: {
            resource: { LogicalId: "RelayPostgresDatabase" },
            action: "replace",
            mode: "live",
            props: { name: "katacoderelay", replicas: 0, arch: "arm" },
            state: {
              status: "replacing",
              providerMode: "live",
              props: { name: "katacoderelay", replicas: 2, clusterSize: "PS_20" },
              attr: {},
              old: {
                status: "updated",
                props: { name: "katacoderelay", replicas: 0, arch: "arm", clusterSize: "PS_5" },
                attr: {
                  id: "s5mpblbu2m4s",
                  name: "katacoderelay",
                  state: "ready",
                  arch: "arm",
                  region: { slug: "us-west" },
                },
              },
            },
          },
        },
        deletions: {},
      } as never),
    ).toEqual({
      actors: ["status"],
      status: "replacing",
      providerMode: "live",
      planMode: "live",
      news: { name: "katacoderelay", replicas: 0, arch: "arm" },
      olds: { name: "katacoderelay", replicas: 0, arch: "arm", clusterSize: "PS_5" },
      output: {
        id: "s5mpblbu2m4s",
        name: "katacoderelay",
        state: "ready",
        arch: "arm",
        region: { slug: "us-west" },
      },
    });
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
  it.effect("uses an artifact instead of a masked cross-job token output", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workflowPath = yield* path.fromFileUrl(
        new URL("../../../.github/workflows/release.yml", import.meta.url),
      );
      const workflow = yield* fileSystem.readFileString(workflowPath);

      expect(workflow).not.toContain("client_tracing_token:");
      expect(workflow).not.toContain("needs.relay_public_config.outputs.client_tracing_token");
      expect(workflow).toContain('--github-env-file "$RUNNER_TEMP/relay-client-tracing.env"');
      expect(workflow).toContain("name: relay-client-tracing-config");
      expect(workflow).toContain('cat "$config_path" >> "$GITHUB_ENV"');
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
