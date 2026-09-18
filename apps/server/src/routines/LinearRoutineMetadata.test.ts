import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

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

/** The transport fails with an unknown success value, so flipping it detypes the error. */
const expectFailure = (effect: Effect.Effect<unknown, LinearMetadataError>) =>
  Effect.gen(function* () {
    const result = yield* Effect.result(effect);
    if (result._tag === "Success") return yield* Effect.die("Expected the request to fail.");
    return result.failure;
  });

const decodeBodies = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ query: Schema.String })),
);

describe("Linear metadata reads", () => {
  it.effect("maps the GraphQL response to workspace, teams, projects, states, and labels", () =>
    Effect.gen(function* () {
      const result = yield* metadataWith(response).read("lin_oauth_access_token");
      assert.deepEqual(result.workspace, { id: "workspace-1", name: "Acme", urlKey: "acme" });
      assert.equal(result.teams.length, 2);
      assert.deepEqual(result.projects[0]?.teamIds, ["team-1"]);
      assert.deepEqual(result.states[0], {
        id: "state-1",
        name: "In Progress",
        teamId: "team-1",
        type: "started",
      });
      assert.isNull(result.labels[1]?.teamId);
    }),
  );

  it.effect("classifies revoked credentials as access errors", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        metadataWith({ _tag: "access", message: "Authentication required" }).read("bad"),
      );
      assert.equal(failure._tag, "access");
    }),
  );

  it.effect("rejects an unexpected response shape without inventing resources", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        metadataWith({ data: { organization: null } }).read("lin_oauth_access_token"),
      );
      assert.equal(failure._tag, "invalid");
    }),
  );
});

describe("Linear GraphQL transport", () => {
  const request = (fetchImpl: typeof fetch) =>
    makeLinearGraphqlRequest(fetchImpl)({
      accessToken: "lin_oauth_access_token",
      query: "query X { viewer { id } }",
    });

  it.effect("posts the query with the OAuth access token as a Bearer header", () =>
    Effect.gen(function* () {
      const seen: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        seen.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ data: { organization: {} } }), { status: 200 });
      };
      yield* request(fetchImpl);
      const captured = seen[0]!;
      assert.equal(captured.url, "https://api.linear.app/graphql");
      assert.equal(
        (captured.init.headers as Record<string, string>).authorization,
        "Bearer lin_oauth_access_token",
      );
      assert.equal(decodeBodies(captured.init.body).query, "query X { viewer { id } }");
    }),
  );

  it.effect(
    "classifies 401 responses as access errors and keeps the token out of the message",
    () =>
      Effect.gen(function* () {
        const fetchImpl: typeof fetch = async () =>
          new Response(JSON.stringify({ errors: [{ message: "Authentication required" }] }), {
            status: 401,
          });
        const failure = yield* expectFailure(request(fetchImpl));
        assert.equal(failure._tag, "access");
        assert.notInclude(failure.message, "lin_oauth_access_token");
      }),
  );

  it.effect("classifies GraphQL authentication errors on a 200 response as access errors", () =>
    Effect.gen(function* () {
      const fetchImpl: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            errors: [
              { message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } },
            ],
          }),
          { status: 200 },
        );
      const failure = yield* expectFailure(request(fetchImpl));
      assert.equal(failure._tag, "access");
    }),
  );

  it.effect("classifies network failures and 5xx responses as unavailable", () =>
    Effect.gen(function* () {
      const throwing: typeof fetch = async () => {
        throw new Error("connect ECONNREFUSED");
      };
      const thrown = yield* expectFailure(request(throwing));
      assert.equal(thrown._tag, "unavailable");
      const failing: typeof fetch = async () => new Response("nope", { status: 502 });
      const failed = yield* expectFailure(request(failing));
      assert.equal(failed._tag, "unavailable");
    }),
  );

  it.effect("rejects a non-JSON body as an invalid response", () =>
    Effect.gen(function* () {
      const fetchImpl: typeof fetch = async () => new Response("<html>", { status: 200 });
      const failure = yield* expectFailure(request(fetchImpl));
      assert.equal(failure._tag, "invalid");
    }),
  );
});
