import { type RoutineLinearMetadata } from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_TEXT = 200;

/**
 * Why a Linear metadata read failed. Access failures are distinct from
 * transient failures so the connection can name revoked access instead of
 * silently dropping pickers or inventing resources.
 */
export type LinearMetadataError =
  | { readonly _tag: "access"; readonly message: string }
  | { readonly _tag: "unavailable"; readonly message: string }
  | { readonly _tag: "invalid"; readonly message: string };

export interface LinearGraphqlRequest {
  readonly accessToken: string;
  readonly query: string;
  readonly variables?: Readonly<Record<string, string | null>>;
}

export interface LinearRoutineMetadataShape {
  readonly read: (accessToken: string) => Effect.Effect<RoutineLinearMetadata, LinearMetadataError>;
}

export class LinearRoutineMetadata extends Context.Service<
  LinearRoutineMetadata,
  LinearRoutineMetadataShape
>()("@kata-sh/code-cli/routines/LinearRoutineMetadata") {}

const METADATA_QUERY = `query RoutineMetadata(
  $teamsAfter: String
  $projectsAfter: String
  $workflowStatesAfter: String
  $issueLabelsAfter: String
) {
  organization { id name urlKey }
  teams(first: 100, after: $teamsAfter) {
    nodes { id name key visibility }
    pageInfo { hasNextPage endCursor }
  }
  projects(first: 100, after: $projectsAfter) {
    nodes {
      id
      name
      teams(first: 50) { nodes { id } pageInfo { hasNextPage endCursor } }
    }
    pageInfo { hasNextPage endCursor }
  }
  workflowStates(first: 250, after: $workflowStatesAfter) {
    nodes { id name type team { id } }
    pageInfo { hasNextPage endCursor }
  }
  issueLabels(first: 250, after: $issueLabelsAfter) {
    nodes { id name team { id } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const PROJECT_TEAMS_QUERY = `query RoutineProjectTeams($projectId: String!, $projectTeamsAfter: String) {
  project(id: $projectId) {
    teams(first: 250, after: $projectTeamsAfter) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const PageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});

const MetadataJson = Schema.Struct({
  data: Schema.Struct({
    organization: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      urlKey: Schema.String,
    }),
    teams: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          key: Schema.String,
          visibility: Schema.Literals(["public", "private", "restricted"]),
        }),
      ),
      pageInfo: PageInfo,
    }),
    projects: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          teams: Schema.Struct({
            nodes: Schema.Array(Schema.Struct({ id: Schema.String })),
            pageInfo: PageInfo,
          }),
        }),
      ),
      pageInfo: PageInfo,
    }),
    workflowStates: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          type: Schema.String,
          team: Schema.Struct({ id: Schema.String }),
        }),
      ),
      pageInfo: PageInfo,
    }),
    issueLabels: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          team: Schema.NullOr(Schema.Struct({ id: Schema.String })),
        }),
      ),
      pageInfo: PageInfo,
    }),
  }),
});

const ProjectTeamsJson = Schema.Struct({
  data: Schema.Struct({
    project: Schema.NullOr(
      Schema.Struct({
        teams: Schema.Struct({
          nodes: Schema.Array(Schema.Struct({ id: Schema.String })),
          pageInfo: PageInfo,
        }),
      }),
    ),
  }),
});

const bounded = (value: string): string =>
  value
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_TEXT);

const access = (message: string): LinearMetadataError => ({
  _tag: "access",
  message: bounded(message),
});
const unavailable = (message: string): LinearMetadataError => ({
  _tag: "unavailable",
  message: bounded(message),
});
const invalid = (message: string): LinearMetadataError => ({
  _tag: "invalid",
  message: bounded(message),
});

const encodeGraphqlBody = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      query: Schema.String,
      variables: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
    }),
  ),
);
const decodeGraphqlBody = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const isAuthenticationError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  const extensions =
    typeof record.extensions === "object" && record.extensions !== null
      ? (record.extensions as Record<string, unknown>)
      : {};
  const code = typeof extensions.code === "string" ? extensions.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  return (
    code.toUpperCase() === "AUTHENTICATION_ERROR" ||
    message.toLowerCase().includes("authentication") ||
    message.toLowerCase().includes("unauthorized")
  );
};

const graphqlErrors = (value: unknown): ReadonlyArray<unknown> => {
  if (typeof value !== "object" || value === null) return [];
  const errors = (value as Record<string, unknown>).errors;
  return Array.isArray(errors) ? errors : [];
};

/**
 * The transport for one Linear GraphQL request. It never includes the access
 * token in an error message and never logs the request body.
 */
export function makeLinearGraphqlRequest(fetchImpl: typeof fetch) {
  return (request: LinearGraphqlRequest): Effect.Effect<unknown, LinearMetadataError> =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetchImpl(LINEAR_GRAPHQL_ENDPOINT, {
            method: "POST",
            headers: {
              authorization: `Bearer ${request.accessToken}`,
              "content-type": "application/json",
            },
            body: encodeGraphqlBody({ query: request.query, variables: request.variables }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        catch: () => unavailable("Linear did not respond. Check network access and try again."),
      });
      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => unavailable("Linear returned an unreadable response."),
      });
      if (response.status === 401 || response.status === 403)
        return yield* Effect.fail(
          access(
            "Linear rejected the OAuth access token. Disconnect and reconnect Linear, then try again.",
          ),
        );
      if (response.status >= 500)
        return yield* Effect.fail(unavailable(`Linear returned status ${response.status}.`));
      const parsed = yield* Effect.fromOption(decodeGraphqlBody(text)).pipe(
        Effect.mapError(() => invalid("Linear returned a response that is not JSON.")),
      );
      const errors = graphqlErrors(parsed);
      if (errors.some(isAuthenticationError))
        return yield* Effect.fail(
          access(
            "Linear rejected the OAuth access token. Disconnect and reconnect Linear, then try again.",
          ),
        );
      if (errors.length > 0)
        return yield* Effect.fail(
          invalid(
            typeof (errors[0] as Record<string, unknown> | null)?.message === "string"
              ? String((errors[0] as Record<string, unknown>).message)
              : "Linear rejected the metadata query.",
          ),
        );
      if (response.status < 200 || response.status >= 300)
        return yield* Effect.fail(invalid(`Linear returned status ${response.status}.`));
      return parsed;
    });
}

/** Maps a metadata transport result to the picker payload, or a named failure. */
export function makeLinearRoutineMetadata(dependencies: {
  readonly graphql: (request: LinearGraphqlRequest) => Effect.Effect<unknown, LinearMetadataError>;
}): LinearRoutineMetadataShape {
  const decodeMetadata = Schema.decodeUnknownEffect(MetadataJson);
  const decodeProjectTeams = Schema.decodeUnknownEffect(ProjectTeamsJson);
  const read: LinearRoutineMetadataShape["read"] = (accessToken) =>
    Effect.gen(function* () {
      const teams: Array<
        Schema.Schema.Type<typeof MetadataJson>["data"]["teams"]["nodes"][number]
      > = [];
      const projects: Array<
        Schema.Schema.Type<typeof MetadataJson>["data"]["projects"]["nodes"][number]
      > = [];
      const states: Array<
        Schema.Schema.Type<typeof MetadataJson>["data"]["workflowStates"]["nodes"][number]
      > = [];
      const labels: Array<
        Schema.Schema.Type<typeof MetadataJson>["data"]["issueLabels"]["nodes"][number]
      > = [];
      let cursors = {
        teamsAfter: null as string | null,
        projectsAfter: null as string | null,
        workflowStatesAfter: null as string | null,
        issueLabelsAfter: null as string | null,
      };
      let active = {
        teams: true,
        projects: true,
        workflowStates: true,
        issueLabels: true,
      };
      let workspace: Schema.Schema.Type<typeof MetadataJson>["data"]["organization"] | undefined;

      while (active.teams || active.projects || active.workflowStates || active.issueLabels) {
        const raw = yield* dependencies.graphql({
          accessToken,
          query: METADATA_QUERY,
          variables: cursors,
        });
        const decoded = yield* decodeMetadata(raw).pipe(
          Effect.mapError(() => invalid("Linear returned an unexpected metadata response.")),
        );
        workspace ??= decoded.data.organization;
        if (active.teams) teams.push(...decoded.data.teams.nodes);
        if (active.projects) projects.push(...decoded.data.projects.nodes);
        if (active.workflowStates) states.push(...decoded.data.workflowStates.nodes);
        if (active.issueLabels) labels.push(...decoded.data.issueLabels.nodes);

        const pageInfos = [
          ["teams", decoded.data.teams.pageInfo],
          ["projects", decoded.data.projects.pageInfo],
          ["workflow states", decoded.data.workflowStates.pageInfo],
          ["issue labels", decoded.data.issueLabels.pageInfo],
        ] as const;
        if (pageInfos.some(([, pageInfo]) => pageInfo.hasNextPage && pageInfo.endCursor === null))
          return yield* Effect.fail(invalid("Linear returned an invalid metadata page cursor."));

        active = {
          teams: active.teams && decoded.data.teams.pageInfo.hasNextPage,
          projects: active.projects && decoded.data.projects.pageInfo.hasNextPage,
          workflowStates: active.workflowStates && decoded.data.workflowStates.pageInfo.hasNextPage,
          issueLabels: active.issueLabels && decoded.data.issueLabels.pageInfo.hasNextPage,
        };
        cursors = {
          teamsAfter: active.teams ? decoded.data.teams.pageInfo.endCursor : null,
          projectsAfter: active.projects ? decoded.data.projects.pageInfo.endCursor : null,
          workflowStatesAfter: active.workflowStates
            ? decoded.data.workflowStates.pageInfo.endCursor
            : null,
          issueLabelsAfter: active.issueLabels ? decoded.data.issueLabels.pageInfo.endCursor : null,
        };
      }

      if (workspace === undefined)
        return yield* Effect.fail(invalid("Linear returned no workspace metadata."));
      const mappedProjects: RoutineLinearMetadata["projects"][number][] = [];
      for (const project of projects) {
        const teamIds = project.teams.nodes.map((team) => team.id);
        let pageInfo = project.teams.pageInfo;
        while (pageInfo.hasNextPage) {
          if (pageInfo.endCursor === null)
            return yield* Effect.fail(invalid("Linear returned an invalid project team cursor."));
          const raw = yield* dependencies.graphql({
            accessToken,
            query: PROJECT_TEAMS_QUERY,
            variables: { projectId: project.id, projectTeamsAfter: pageInfo.endCursor },
          });
          const decoded = yield* decodeProjectTeams(raw).pipe(
            Effect.mapError(() => invalid("Linear returned an unexpected project team response.")),
          );
          if (decoded.data.project === null)
            return yield* Effect.fail(
              invalid("A Linear project disappeared while its teams were being read."),
            );
          teamIds.push(...decoded.data.project.teams.nodes.map((team) => team.id));
          pageInfo = decoded.data.project.teams.pageInfo;
        }
        mappedProjects.push({ id: project.id, name: project.name, teamIds });
      }
      return {
        workspace,
        teams,
        projects: mappedProjects,
        states: states.map((state) => ({
          id: state.id,
          name: state.name,
          teamId: state.team.id,
          type: state.type,
        })),
        labels: labels.map((label) => ({
          id: label.id,
          name: label.name,
          teamId: label.team?.id ?? null,
        })),
      };
    });
  return { read };
}

export const LinearRoutineMetadataLive = Layer.succeed(
  LinearRoutineMetadata,
  makeLinearRoutineMetadata({ graphql: makeLinearGraphqlRequest(fetch) }),
);
