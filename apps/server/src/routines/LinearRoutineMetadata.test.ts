import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  makeLinearGraphqlRequest,
  makeLinearRoutineMetadata,
  type LinearGraphqlRequest,
  type LinearMetadataError,
} from "./LinearRoutineMetadata.ts";

const response = {
  data: {
    organization: { id: "workspace-1", name: "Acme", urlKey: "acme" },
    teams: {
      nodes: [
        { id: "team-1", name: "Engineering", key: "ENG", visibility: "public" },
        { id: "team-2", name: "Design", key: "DES", visibility: "private" },
        { id: "team-3", name: "Platform", key: "PLAT", visibility: "restricted" },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    projects: {
      nodes: [
        {
          id: "project-1",
          name: "Roadmap",
          teams: {
            nodes: [{ id: "team-1" }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    workflowStates: {
      nodes: [{ id: "state-1", name: "In Progress", type: "started", team: { id: "team-1" } }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    issueLabels: {
      nodes: [
        { id: "label-1", name: "Bug", team: { id: "team-1" } },
        { id: "label-2", name: "Workspace label", team: null },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
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
  Schema.fromJsonString(
    Schema.Struct({
      query: Schema.String,
      variables: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
    }),
  ),
);

describe("Linear metadata reads", () => {
  it.effect("maps the GraphQL response to workspace, teams, projects, states, and labels", () =>
    Effect.gen(function* () {
      const result = yield* metadataWith(response).read("lin_oauth_access_token");
      assert.deepEqual(result.workspace, { id: "workspace-1", name: "Acme", urlKey: "acme" });
      assert.equal(result.teams.length, 3);
      assert.equal(result.teams[0]?.visibility, "public");
      assert.equal(result.teams[1]?.visibility, "private");
      assert.equal(result.teams[2]?.visibility, "restricted");
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

  it.effect("follows Relay cursors for every metadata collection", () =>
    Effect.gen(function* () {
      const requests: Array<LinearGraphqlRequest> = [];
      const pages = [
        {
          data: {
            ...response.data,
            teams: {
              nodes: [response.data.teams.nodes[0]!],
              pageInfo: { hasNextPage: true, endCursor: "teams-cursor" },
            },
            projects: {
              nodes: [response.data.projects.nodes[0]!],
              pageInfo: { hasNextPage: true, endCursor: "projects-cursor" },
            },
            workflowStates: {
              nodes: [response.data.workflowStates.nodes[0]!],
              pageInfo: { hasNextPage: true, endCursor: "states-cursor" },
            },
            issueLabels: {
              nodes: [response.data.issueLabels.nodes[0]!],
              pageInfo: { hasNextPage: true, endCursor: "labels-cursor" },
            },
          },
        },
        {
          data: {
            ...response.data,
            teams: {
              nodes: [response.data.teams.nodes[1]!],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            projects: {
              nodes: [
                {
                  id: "project-2",
                  name: "Design",
                  teams: {
                    nodes: [{ id: "team-2" }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: "projects-cursor-2" },
            },
            workflowStates: {
              nodes: [{ id: "state-2", name: "Done", type: "completed", team: { id: "team-2" } }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            issueLabels: {
              nodes: [{ id: "label-3", name: "Design", team: { id: "team-2" } }],
              pageInfo: { hasNextPage: true, endCursor: "labels-cursor-2" },
            },
          },
        },
        {
          data: {
            ...response.data,
            teams: {
              nodes: [response.data.teams.nodes[1]!],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            projects: {
              nodes: [
                {
                  id: "project-3",
                  name: "Launch",
                  teams: {
                    nodes: [{ id: "team-1" }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            workflowStates: {
              nodes: [{ id: "state-2", name: "Done", type: "completed", team: { id: "team-2" } }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            issueLabels: {
              nodes: [{ id: "label-4", name: "Launch", team: { id: "team-1" } }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      ];
      const metadata = makeLinearRoutineMetadata({
        graphql: (request) => {
          requests.push(request);
          return Effect.succeed(pages[requests.length - 1] ?? pages[1]);
        },
      });

      const result = yield* metadata.read("lin_oauth_access_token");

      assert.equal(requests.length, 3);
      assert.deepEqual(requests[0]?.variables, {
        teamsAfter: null,
        projectsAfter: null,
        workflowStatesAfter: null,
        issueLabelsAfter: null,
      });
      assert.deepEqual(requests[1]?.variables, {
        teamsAfter: "teams-cursor",
        projectsAfter: "projects-cursor",
        workflowStatesAfter: "states-cursor",
        issueLabelsAfter: "labels-cursor",
      });
      assert.deepEqual(requests[2]?.variables, {
        teamsAfter: null,
        projectsAfter: "projects-cursor-2",
        workflowStatesAfter: null,
        issueLabelsAfter: "labels-cursor-2",
      });
      assert.deepEqual(
        result.teams.map((team) => team.id),
        ["team-1", "team-2"],
      );
      assert.deepEqual(
        result.projects.map((project) => project.id),
        ["project-1", "project-2", "project-3"],
      );
      assert.deepEqual(
        result.states.map((state) => state.id),
        ["state-1", "state-2"],
      );
      assert.deepEqual(
        result.labels.map((label) => label.id),
        ["label-1", "label-3", "label-4"],
      );
    }),
  );

  it.effect("follows the nested team cursor for each Linear project", () =>
    Effect.gen(function* () {
      const requests: Array<LinearGraphqlRequest> = [];
      const metadata = makeLinearRoutineMetadata({
        graphql: (request) => {
          requests.push(request);
          if (requests.length === 1)
            return Effect.succeed({
              data: {
                ...response.data,
                projects: {
                  nodes: [
                    {
                      id: "project-1",
                      name: "Roadmap",
                      teams: {
                        nodes: [{ id: "team-1" }],
                        pageInfo: { hasNextPage: true, endCursor: "project-teams-cursor" },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            });
          return Effect.succeed({
            data: {
              project: {
                teams: {
                  nodes: [{ id: "team-2" }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          });
        },
      });

      const result = yield* metadata.read("lin_oauth_access_token");

      assert.equal(requests.length, 2);
      assert.include(requests[0]?.query ?? "", "teams(first: 50)");
      assert.deepEqual(requests[1]?.variables, {
        projectId: "project-1",
        projectTeamsAfter: "project-teams-cursor",
      });
      assert.deepEqual(result.projects[0]?.teamIds, ["team-1", "team-2"]);
    }),
  );

  it.effect("rejects a reused metadata page cursor", () =>
    Effect.gen(function* () {
      let requestCount = 0;
      const metadata = makeLinearRoutineMetadata({
        graphql: () => {
          requestCount += 1;
          return Effect.succeed({
            data: {
              ...response.data,
              teams: {
                nodes: [response.data.teams.nodes[0]!],
                pageInfo: {
                  hasNextPage: true,
                  endCursor: requestCount === 2 ? "cursor-b" : "cursor-a",
                },
              },
            },
          });
        },
      });

      const failure = yield* Effect.flip(metadata.read("lin_oauth_access_token"));

      assert.equal(failure._tag, "invalid");
      assert.equal(failure.message, "Linear repeated a metadata page cursor.");
      assert.equal(requestCount, 3);
    }),
  );

  it.effect("rejects a reused project team cursor", () =>
    Effect.gen(function* () {
      let requestCount = 0;
      const metadata = makeLinearRoutineMetadata({
        graphql: () => {
          requestCount += 1;
          if (requestCount === 1)
            return Effect.succeed({
              data: {
                ...response.data,
                projects: {
                  nodes: [
                    {
                      id: "project-1",
                      name: "Roadmap",
                      teams: {
                        nodes: [{ id: "team-1" }],
                        pageInfo: { hasNextPage: true, endCursor: "cursor-a" },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            });
          return Effect.succeed({
            data: {
              project: {
                teams: {
                  nodes: [{ id: "team-2" }],
                  pageInfo: {
                    hasNextPage: true,
                    endCursor: requestCount === 2 ? "cursor-b" : "cursor-a",
                  },
                },
              },
            },
          });
        },
      });

      const failure = yield* Effect.flip(metadata.read("lin_oauth_access_token"));

      assert.equal(failure._tag, "invalid");
      assert.equal(failure.message, "Linear repeated a project team cursor.");
      assert.equal(requestCount, 3);
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

  it.effect("encodes Relay cursor variables in the GraphQL request body", () =>
    Effect.gen(function* () {
      const seen: Array<RequestInit> = [];
      const fetchImpl: typeof fetch = async (_url, init) => {
        seen.push(init ?? {});
        return new Response(JSON.stringify({ data: { organization: {} } }), { status: 200 });
      };
      yield* makeLinearGraphqlRequest(fetchImpl)({
        accessToken: "lin_oauth_access_token",
        query: "query X($cursor: String) { teams(after: $cursor) { nodes { id } } }",
        variables: { cursor: "opaque-cursor" },
      });
      assert.deepEqual(decodeBodies(seen[0]!.body).variables, { cursor: "opaque-cursor" });
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
