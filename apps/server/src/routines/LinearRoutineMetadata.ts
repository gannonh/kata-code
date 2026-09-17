import { type RoutineLinearMetadata } from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
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
  readonly apiKey: string;
  readonly query: string;
}

export interface LinearRoutineMetadataShape {
  readonly read: (apiKey: string) => Effect.Effect<RoutineLinearMetadata, LinearMetadataError>;
}

export class LinearRoutineMetadata extends Context.Service<
  LinearRoutineMetadata,
  LinearRoutineMetadataShape
>()("@kata-sh/code-cli/routines/LinearRoutineMetadata") {}

const METADATA_QUERY = `query RoutineMetadata {
  organization { id name urlKey }
  teams(first: 100) { nodes { id name key } }
  projects(first: 100) { nodes { id name teams { nodes { id } } } }
  workflowStates(first: 250) { nodes { id name type team { id } } }
  issueLabels(first: 250) { nodes { id name team { id } } }
}`;

const MetadataJson = Schema.Struct({
  data: Schema.Struct({
    organization: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      urlKey: Schema.String,
    }),
    teams: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({ id: Schema.String, name: Schema.String, key: Schema.String }),
      ),
    }),
    projects: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          teams: Schema.Struct({ nodes: Schema.Array(Schema.Struct({ id: Schema.String })) }),
        }),
      ),
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
    }),
    issueLabels: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          team: Schema.NullOr(Schema.Struct({ id: Schema.String })),
        }),
      ),
    }),
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
 * The transport for one Linear GraphQL request. It never includes the API key
 * in an error message and never logs the request body.
 */
export function makeLinearGraphqlRequest(fetchImpl: typeof fetch) {
  return (request: LinearGraphqlRequest): Effect.Effect<unknown, LinearMetadataError> =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetchImpl(LINEAR_GRAPHQL_ENDPOINT, {
            method: "POST",
            headers: {
              authorization: request.apiKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({ query: request.query }),
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
          access("Linear rejected the metadata credential. Check the API key and its access."),
        );
      if (response.status >= 500)
        return yield* Effect.fail(unavailable(`Linear returned status ${response.status}.`));
      const parsed = yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: () => invalid("Linear returned a response that is not JSON."),
      });
      const errors = graphqlErrors(parsed);
      if (errors.some(isAuthenticationError))
        return yield* Effect.fail(
          access("Linear rejected the metadata credential. Check the API key and its access."),
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
  const read: LinearRoutineMetadataShape["read"] = (apiKey) =>
    dependencies.graphql({ apiKey, query: METADATA_QUERY }).pipe(
      Effect.flatMap((raw) =>
        Schema.decodeUnknownEffect(MetadataJson)(raw).pipe(
          Effect.mapError(() => invalid("Linear returned an unexpected metadata response.")),
        ),
      ),
      Effect.map(({ data }) => ({
        workspace: {
          id: data.organization.id,
          name: data.organization.name,
          urlKey: data.organization.urlKey,
        },
        teams: data.teams.nodes,
        projects: data.projects.nodes.map((project) => ({
          id: project.id,
          name: project.name,
          teamIds: project.teams.nodes.map((team) => team.id),
        })),
        states: data.workflowStates.nodes.map((state) => ({
          id: state.id,
          name: state.name,
          teamId: state.team.id,
          type: state.type,
        })),
        labels: data.issueLabels.nodes.map((label) => ({
          id: label.id,
          name: label.name,
          teamId: label.team?.id ?? null,
        })),
      })),
    );
  return { read };
}

export const LinearRoutineMetadataLive = Layer.succeed(
  LinearRoutineMetadata,
  makeLinearRoutineMetadata({ graphql: makeLinearGraphqlRequest(fetch) }),
);
