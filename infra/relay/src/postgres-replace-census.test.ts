// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "@effect/vitest";

import {
  abortInFlightPostgresReplace,
  alchemyPostgresReplaceActors,
  confirmRestoredPostgresGeneration,
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

  it("does not treat replica count as a replace actor", () => {
    expect(
      alchemyPostgresReplaceActors({
        news: { replicas: 2 },
        olds: { replicas: 0 },
        output: { region: { slug: "us-west" } },
      }),
    ).toEqual([]);
    expect(
      alchemyPostgresReplaceActors({
        news: { replicas: 0 },
        olds: {},
        output: {},
      }),
    ).toEqual([]);
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

describe("confirmRestoredPostgresGeneration", () => {
  const expected = { id: "s5mpblbu2m4s", name: "katacoderelay" };

  it("accepts the restored ready generation", () => {
    expect(
      confirmRestoredPostgresGeneration(
        {
          status: "updated",
          attr: { id: "s5mpblbu2m4s", name: "katacoderelay", state: "ready" },
        },
        expected,
      ),
    ).toEqual({ kind: "ok" });
  });

  it("refuses a missing post-write row", () => {
    expect(confirmRestoredPostgresGeneration(undefined, expected)).toEqual({
      kind: "refuse",
      reason: "post-write Alchemy row is missing",
    });
  });

  it("refuses a leftover replacing row with empty attr", () => {
    expect(
      confirmRestoredPostgresGeneration(
        {
          status: "replacing",
          attr: {},
          old: {
            status: "updated",
            attr: { id: "s5mpblbu2m4s", name: "katacoderelay", state: "ready" },
          },
        },
        expected,
      ),
    ).toEqual({
      kind: "refuse",
      reason: "post-write generation has no database identity",
    });
  });

  it("refuses a post-write row whose identity is not the restored generation", () => {
    expect(
      confirmRestoredPostgresGeneration(
        {
          status: "updated",
          attr: { id: "other", name: "otherdb", state: "ready" },
        },
        expected,
      ),
    ).toEqual({
      kind: "refuse",
      reason: "post-write identity otherdb/other is not katacoderelay/s5mpblbu2m4s",
    });
  });

  it("refuses a post-write row that is not ready", () => {
    expect(
      confirmRestoredPostgresGeneration(
        {
          status: "updated",
          attr: { id: "s5mpblbu2m4s", name: "katacoderelay", state: "sleeping" },
        },
        expected,
      ),
    ).toEqual({
      kind: "refuse",
      reason: "post-write generation state is sleeping",
    });
  });
});

describe("patched alchemy PostgresDatabase", () => {
  it("plans replica count changes as in-place updates", () => {
    const alchemyPlanetscale = NodePath.dirname(
      NodeURL.fileURLToPath(import.meta.resolve("alchemy/Planetscale")),
    );
    const source = NodeFS.readFileSync(
      NodePath.join(alchemyPlanetscale, "Postgres/PostgresDatabase.js"),
      "utf8",
    );
    expect(source).toMatch(
      /if \(news\.replicas !== olds\.replicas\) \{\s*return \{ action: "update", stables \}/,
    );
    expect(source).not.toMatch(
      /if \(news\.replicas !== olds\.replicas\) \{\s*return \{ action: "replace" \}/,
    );
    expect(source).toContain("updateBranchChangeRequest");
    expect(source).toContain("replicas: desiredReplicas");
  });

  it("targets two replicas on the prod shared database", () => {
    const source = NodeFS.readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    expect(source).toMatch(/replicas:\s*2/);
  });
});
