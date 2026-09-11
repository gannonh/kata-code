import { describe, expect, it } from "@effect/vitest";

import {
  abortInFlightPostgresReplace,
  alchemyPostgresReplaceActors,
  pickPostgresIdentity,
  postgresStateIdentity,
} from "./postgres-replace-census.ts";

describe("alchemyPostgresReplaceActors", () => {
  it("names region when news and output slugs differ", () => {
    expect(
      alchemyPostgresReplaceActors({
        news: { region: { slug: "us-west" }, replicas: 0 },
        olds: { replicas: 0 },
        output: { region: { slug: "us-east" } },
      }),
    ).toEqual(["region"]);
  });

  it("names replicas when news and olds differ, including 0 vs missing", () => {
    expect(
      alchemyPostgresReplaceActors({
        news: { replicas: 0 },
        olds: {},
        output: { region: { slug: "us-west" } },
      }),
    ).toEqual(["replicas"]);
    expect(
      alchemyPostgresReplaceActors({
        news: {},
        olds: { replicas: 0 },
        output: {},
      }),
    ).toEqual(["replicas"]);
  });

  it("names arch only when news.arch is set and differs from output, olds, or x86", () => {
    expect(
      alchemyPostgresReplaceActors({
        news: { replicas: 0 },
        olds: { replicas: 0 },
        output: {},
      }),
    ).toEqual([]);
    expect(
      alchemyPostgresReplaceActors({
        news: { arch: "arm", replicas: 0 },
        olds: { replicas: 0 },
        output: {},
      }),
    ).toEqual(["arch"]);
    expect(
      alchemyPostgresReplaceActors({
        news: { arch: "arm", replicas: 0 },
        olds: { replicas: 0, arch: "arm" },
        output: { arch: "arm" },
      }),
    ).toEqual([]);
  });

  it("names status for in-flight replace recovery", () => {
    expect(
      alchemyPostgresReplaceActors({
        news: { replicas: 0 },
        olds: { replicas: 0 },
        output: {},
        status: "replacing",
      }),
    ).toEqual(["status"]);
  });

  it("names providerMode when the plan mode differs from the stamped mode", () => {
    expect(
      alchemyPostgresReplaceActors({
        news: { replicas: 0 },
        olds: { replicas: 0 },
        output: {},
        providerMode: "local",
        planMode: "live",
      }),
    ).toEqual(["providerMode"]);
  });
});

describe("postgresStateIdentity", () => {
  it("keeps identity fields and drops everything else", () => {
    expect(
      postgresStateIdentity({
        fqn: "RelayPostgresDatabase",
        logicalId: "RelayPostgresDatabase",
        resourceType: "Planetscale.PostgresDatabase",
        status: "updated",
        providerMode: "live",
        props: { name: "katacoderelay", replicas: 0, password: "nope" },
        attr: { id: "s5mpblbu2m4s", token: "nope" },
      }),
    ).toEqual({
      fqn: "RelayPostgresDatabase",
      logicalId: "RelayPostgresDatabase",
      resourceType: "Planetscale.PostgresDatabase",
      status: "updated",
      providerMode: "live",
      props: { name: "katacoderelay", replicas: 0 },
      attr: { id: "s5mpblbu2m4s" },
      oldStatus: undefined,
      oldProps: undefined,
      oldAttr: undefined,
    });
    expect(pickPostgresIdentity({ token: "nope", origin: "nope" })).toEqual({});
  });
});

describe("abortInFlightPostgresReplace", () => {
  const live = {
    fqn: "RelayPostgresDatabase",
    logicalId: "RelayPostgresDatabase",
    resourceType: "Planetscale.PostgresDatabase",
    status: "updated",
    instanceId: "live-instance",
    props: { name: "katacoderelay", replicas: 0, arch: "arm", clusterSize: "PS_5" },
    attr: {
      id: "s5mpblbu2m4s",
      name: "katacoderelay",
      state: "ready",
      arch: "arm",
      region: { slug: "us-west" },
    },
  };

  it("restores the live generation from a stuck replace", () => {
    const result = abortInFlightPostgresReplace({
      ...live,
      status: "replacing",
      instanceId: "replacement-instance",
      props: { name: "katacoderelay", replicas: 2, clusterSize: "PS_20" },
      attr: {},
      old: live,
      deleteFirst: false,
    });
    expect(result).toEqual({
      kind: "restored",
      row: live,
      restoredId: "s5mpblbu2m4s",
      restoredName: "katacoderelay",
    });
  });

  it("no-ops when the row is already the live generation", () => {
    expect(abortInFlightPostgresReplace(live)).toEqual({
      kind: "noop",
      reason: "status is updated",
    });
  });

  it("refuses a replace whose old identity is not production katacoderelay", () => {
    expect(
      abortInFlightPostgresReplace({
        status: "replacing",
        old: {
          status: "updated",
          attr: { id: "other", name: "otherdb", state: "ready" },
        },
      }),
    ).toEqual({
      kind: "refuse",
      reason: "old generation identity otherdb/other is not katacoderelay/s5mpblbu2m4s",
    });
  });
});
