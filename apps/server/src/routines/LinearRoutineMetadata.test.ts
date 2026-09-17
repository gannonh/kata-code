import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import {
  makeLinearGraphqlRequest,
  makeLinearRoutineMetadata,
  type LinearMetadataError,
} from "./LinearRoutineMetadata.ts";

const response = {
  data: {
    organization: { id: "workspace-1", name: "Acme", urlKey: "acme" },
    teams: {
      nodes: [
        { id: "team-1", name: "Engineering", key: "ENG" },
        { id: "team-2", name: "Design", key: "DES" },
      ],
    },
    projects: {
      nodes: [{ id: "project-1", name: "Roadmap", teams: { nodes: [{ id: "team-1" }] } }],
    },
    workflowStates: {
      nodes: [{ id: "state-1", name: "In Progress", type: "started", team: { id: "team-1" } }],
    },
    issueLabels: {
      nodes: [
        { id: "label-1", name: "Bug", team: { id: "team-1" } },
        { id: "label-2", name: "Workspace label", team: null },
      ],
    },
  },
};

const metadataWith = (result: unknown | LinearMetadataError) =>
  makeLinearRoutineMetadata({
    graphql: () =>
      typeof result === "object" && result !== null && "_tag" in result
        ? Effect.fail(result as LinearMetadataError)
        : Effect.succeed(result),
  });

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.result));

describe("Linear metadata reads", () => {
  it("maps the GraphQL response to workspace, teams, projects, states, and labels", async () => {
    const result = await run(metadataWith(response).read("lin_api_key"));
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;
    expect(result.success.workspace).toEqual({ id: "workspace-1", name: "Acme", urlKey: "acme" });
    expect(result.success.teams).toHaveLength(2);
    expect(result.success.projects[0]?.teamIds).toEqual(["team-1"]);
    expect(result.success.states[0]).toEqual({
      id: "state-1",
      name: "In Progress",
      teamId: "team-1",
      type: "started",
    });
    expect(result.success.labels[1]?.teamId).toBeNull();
  });

  it("classifies revoked credentials as access errors", async () => {
    const result = await run(
      metadataWith({ _tag: "access", message: "Authentication required" }).read("bad"),
    );
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "access" } });
  });

  it("rejects an unexpected response shape without inventing resources", async () => {
    const result = await run(metadataWith({ data: { organization: null } }).read("lin_api_key"));
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "invalid" } });
  });
});

describe("Linear GraphQL transport", () => {
  const request = (fetchImpl: typeof fetch) =>
    makeLinearGraphqlRequest(fetchImpl)({
      apiKey: "lin_api_secret",
      query: "query X { viewer { id } }",
    });

  it("posts the query with the API key in the Authorization header", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ data: { organization: {} } }), { status: 200 });
    };
    const result = await run(request(fetchImpl));
    expect(result._tag).toBe("Success");
    expect(seen!.url).toBe("https://api.linear.app/graphql");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("lin_api_secret");
    expect(JSON.parse(String(seen!.init.body))).toEqual({
      query: "query X { viewer { id } }",
    });
  });

  it("classifies 401 responses as access errors and keeps the key out of the message", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ errors: [{ message: "Authentication required" }] }), {
        status: 401,
      });
    const result = await run(request(fetchImpl));
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "access" } });
    if (result._tag === "Failure") expect(result.failure.message).not.toContain("lin_api_secret");
  });

  it("classifies GraphQL authentication errors on a 200 response as access errors", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          errors: [
            { message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } },
          ],
        }),
        { status: 200 },
      );
    const result = await run(request(fetchImpl));
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "access" } });
  });

  it("classifies network failures and 5xx responses as unavailable", async () => {
    const throwing: typeof fetch = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const thrown = await run(request(throwing));
    expect(thrown).toMatchObject({ _tag: "Failure", failure: { _tag: "unavailable" } });
    const failing: typeof fetch = async () => new Response("nope", { status: 502 });
    const failed = await run(request(failing));
    expect(failed).toMatchObject({ _tag: "Failure", failure: { _tag: "unavailable" } });
  });

  it("rejects a non-JSON body as an invalid response", async () => {
    const fetchImpl: typeof fetch = async () => new Response("<html>", { status: 200 });
    const result = await run(request(fetchImpl));
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "invalid" } });
  });
});
