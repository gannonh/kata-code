import * as NodeCrypto from "node:crypto";
import {
  RoutineConnection,
  RoutineConnectionId,
  RoutineError,
  type EnvironmentId,
  type RoutineGitHubMetadata,
} from "@kata-sh/code-contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { CLOUD_MANAGED_ENDPOINT_URL } from "../cloud/config.ts";
import * as ServerConfig from "../config.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import { routineConnectionSecretName, routineWebhookCallbackPath } from "./RoutineWebhooks.ts";
import { RoutineStore } from "./RoutineStore.ts";

const HOOK_EVENTS = ["pull_request", "issues", "workflow_run"] as const;
const PING_WAIT_MS = 15_000;
const PING_POLL_MS = 500;

const RepositoryJson = Schema.Struct({
  id: Schema.Number,
  full_name: Schema.String,
  html_url: Schema.String,
  default_branch: Schema.String,
});
const HookJson = Schema.Struct({ id: Schema.Number });
const HookConfigJson = Schema.Struct({
  url: Schema.String,
  content_type: Schema.String,
  secret: Schema.String,
  insecure_ssl: Schema.String,
});
const encodeHookCreate = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      active: Schema.Boolean,
      events: Schema.Array(Schema.String),
      config: HookConfigJson,
    }),
  ),
);
const encodeHookPatch = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ config: HookConfigJson })),
);
const BranchesJson = Schema.Array(Schema.Struct({ name: Schema.String }));
const LabelsJson = Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String }));
const decodeJson = <S extends Schema.Top>(schema: S, stdout: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(stdout).pipe(
    Effect.mapError(
      () =>
        new RoutineError({
          code: "persistence",
          message: "GitHub returned an unexpected response.",
        }),
    ),
  );

const failure = (code: RoutineError["code"], message: string) =>
  new RoutineError({ code, message });

export interface RoutineConnectionsShape {
  readonly list: (
    environmentId: EnvironmentId,
  ) => Effect.Effect<ReadonlyArray<RoutineConnection>, RoutineError>;
  readonly create: (input: {
    readonly environmentId: EnvironmentId;
    readonly id: RoutineConnectionId;
    readonly repository: string;
  }) => Effect.Effect<RoutineConnection, RoutineError>;
  /** Waits for the provider ping, asking GitHub to resend it once if it has not arrived. */
  readonly verify: (input: {
    readonly environmentId: EnvironmentId;
    readonly id: RoutineConnectionId;
  }) => Effect.Effect<RoutineConnection, RoutineError>;
  readonly disable: (input: {
    readonly environmentId: EnvironmentId;
    readonly id: RoutineConnectionId;
  }) => Effect.Effect<RoutineConnection, RoutineError>;
  readonly rotateSecret: (input: {
    readonly environmentId: EnvironmentId;
    readonly id: RoutineConnectionId;
  }) => Effect.Effect<RoutineConnection, RoutineError>;
  readonly metadata: (input: {
    readonly repository?: string | undefined;
  }) => Effect.Effect<RoutineGitHubMetadata, RoutineError>;
}

export class RoutineConnections extends Context.Service<
  RoutineConnections,
  RoutineConnectionsShape
>()("@kata-sh/code-cli/routines/RoutineConnections") {}

/** Only `owner/name` reaches `gh api`; anything else is rejected before a process spawns. */
export function parseRepositoryName(value: string): { owner: string; name: string } | null {
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/.exec(
    value.trim(),
  );
  return match ? { owner: match[1]!, name: match[2]! } : null;
}

export const makeRoutineConnections = Effect.gen(function* () {
  const store = yield* RoutineStore;
  const github = yield* GitHubCli.GitHubCli;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const config = yield* ServerConfig.ServerConfig;
  const cwd = config.cwd;
  const isoNow = Effect.map(DateTime.now, DateTime.formatIso);

  const gitHubFailure = (context: string) => (error: GitHubCli.GitHubCliError) =>
    failure(
      "blocked",
      error._tag === "GitHubCliAuthenticationError" || error._tag === "GitHubCliUnavailableError"
        ? error.detail
        : `${context}: ${error._tag === "GitHubCliCommandError" ? "GitHub rejected the request. Confirm you administer this repository." : error.detail}`,
    );
  const api = (args: ReadonlyArray<string>, stdin?: string, context = "GitHub request failed") =>
    github
      .execute({ cwd, args: ["api", ...args], ...(stdin === undefined ? {} : { stdin }) })
      .pipe(Effect.mapError(gitHubFailure(context)));
  const repositoryPath = (repository: string) => {
    const parsed = parseRepositoryName(repository);
    return parsed === null
      ? Effect.fail(failure("validation", "Use the owner/name form for the repository."))
      : Effect.succeed(`repos/${parsed.owner}/${parsed.name}`);
  };
  const callbackBaseUrl = secrets.get(CLOUD_MANAGED_ENDPOINT_URL).pipe(
    Effect.mapError(() => failure("persistence", "Could not read the environment link state.")),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            failure(
              "blocked",
              "This environment has no public callback URL. Link it through Kata Code Connect with a managed tunnel, then try again.",
            ),
          ),
        onSome: (bytes) => Effect.succeed(new TextDecoder().decode(bytes).replace(/\/+$/u, "")),
      }),
    ),
  );
  const secretBytes = () => Effect.sync(() => NodeCrypto.randomBytes(32));
  const secretText = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
  const hookConfig = (callbackUrl: string, secret: string) => ({
    url: callbackUrl,
    content_type: "json",
    secret,
    insecure_ssl: "0",
  });
  const owned = (environmentId: EnvironmentId, id: RoutineConnectionId) =>
    store.getConnection(environmentId, id);

  const list: RoutineConnectionsShape["list"] = (environmentId) =>
    store.listConnections(environmentId);

  const create: RoutineConnectionsShape["create"] = Effect.fn("RoutineConnections.create")(
    function* (input) {
      const path = yield* repositoryPath(input.repository);
      const baseUrl = yield* callbackBaseUrl;
      yield* github
        .assertAuthenticated({ cwd })
        .pipe(Effect.mapError(gitHubFailure("GitHub authentication")));
      const repository = yield* api([path]).pipe(
        Effect.flatMap((output) => decodeJson(RepositoryJson, output.stdout)),
      );
      // Listing hooks requires admin on the repository; a non-admin sees 404.
      yield* api([`${path}/hooks`], undefined, "Webhook access check").pipe(
        Effect.mapError(() =>
          failure(
            "blocked",
            `Creating a webhook needs admin access to ${repository.full_name}. Ask a repository admin to grant it.`,
          ),
        ),
      );
      const callbackUrl = `${baseUrl}${routineWebhookCallbackPath(input.id)}`;
      const secret = yield* secretBytes();
      // The secret is stored before the hook exists so a delivery that races the
      // create call can already be verified; it never enters argv or logs.
      yield* secrets
        .set(routineConnectionSecretName(input.id), secret)
        .pipe(Effect.mapError(() => failure("persistence", "Could not store the signing secret.")));
      const hook = yield* api(
        ["-X", "POST", `${path}/hooks`, "--input", "-"],
        encodeHookCreate({
          name: "web",
          active: true,
          events: [...HOOK_EVENTS],
          config: hookConfig(callbackUrl, secretText(secret)),
        }),
        "Webhook creation",
      ).pipe(Effect.flatMap((output) => decodeJson(HookJson, output.stdout)));
      const now = yield* isoNow;
      const connection: RoutineConnection = {
        id: input.id,
        environmentId: input.environmentId,
        provider: "github",
        repositoryId: repository.id,
        repositoryName: repository.full_name,
        repositoryUrl: repository.html_url,
        defaultBranch: repository.default_branch,
        hookId: hook.id,
        callbackUrl,
        status: "pending",
        lastDelivery: null,
        acceptedCount: 0,
        ignoredCount: 0,
        rejectedCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      yield* store.saveConnection(connection);
      return connection;
    },
  );

  const awaitPing = (environmentId: EnvironmentId, id: RoutineConnectionId, budgetMs: number) =>
    Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis;
      while (true) {
        const current = yield* owned(environmentId, id);
        const elapsed = (yield* Clock.currentTimeMillis) - started;
        if (current.status !== "pending" || elapsed >= budgetMs) return current;
        yield* Effect.sleep(`${PING_POLL_MS} millis`);
      }
    });

  const verify: RoutineConnectionsShape["verify"] = Effect.fn("RoutineConnections.verify")(
    function* (input) {
      const first = yield* awaitPing(input.environmentId, input.id, PING_WAIT_MS / 3);
      if (first.status !== "pending" || first.hookId === null) return first;
      const path = yield* repositoryPath(first.repositoryName);
      yield* api(["-X", "POST", `${path}/hooks/${first.hookId}/pings`], undefined, "Webhook ping");
      return yield* awaitPing(input.environmentId, input.id, PING_WAIT_MS);
    },
  );

  const disable: RoutineConnectionsShape["disable"] = Effect.fn("RoutineConnections.disable")(
    function* (input) {
      const current = yield* owned(input.environmentId, input.id);
      // Local acceptance ends first; the provider-side delete is best effort.
      yield* secrets
        .remove(routineConnectionSecretName(current.id))
        .pipe(
          Effect.mapError(() => failure("persistence", "Could not remove the signing secret.")),
        );
      const updated = yield* store.updateConnection(current.id, (connection) => ({
        ...connection,
        status: "disabled",
        updatedAt: DateTime.formatIso(DateTime.nowUnsafe()),
      }));
      if (current.hookId !== null) {
        const path = yield* repositoryPath(current.repositoryName);
        yield* api(
          ["-X", "DELETE", `${path}/hooks/${current.hookId}`],
          undefined,
          "Webhook delete",
        ).pipe(
          Effect.catch((error) =>
            Effect.logWarning("routine webhook could not be deleted on GitHub", {
              connectionId: current.id,
              detail: error.message,
            }),
          ),
        );
      }
      return updated;
    },
  );

  const rotateSecret: RoutineConnectionsShape["rotateSecret"] = Effect.fn(
    "RoutineConnections.rotateSecret",
  )(function* (input) {
    const current = yield* owned(input.environmentId, input.id);
    if (current.status === "disabled" || current.hookId === null)
      return yield* failure("blocked", "Reconnect the repository before rotating its secret.");
    const path = yield* repositoryPath(current.repositoryName);
    const secret = yield* secretBytes();
    yield* api(
      ["-X", "PATCH", `${path}/hooks/${current.hookId}`, "--input", "-"],
      encodeHookPatch({ config: hookConfig(current.callbackUrl, secretText(secret)) }),
      "Webhook secret rotation",
    );
    yield* secrets
      .set(routineConnectionSecretName(current.id), secret)
      .pipe(Effect.mapError(() => failure("persistence", "Could not store the signing secret.")));
    return yield* store.updateConnection(current.id, (connection) => ({
      ...connection,
      updatedAt: DateTime.formatIso(DateTime.nowUnsafe()),
    }));
  });

  const metadata: RoutineConnectionsShape["metadata"] = Effect.fn("RoutineConnections.metadata")(
    function* (input) {
      const page = yield* github
        .listRepositories({ cwd, page: 1 })
        .pipe(Effect.mapError(gitHubFailure("Repository listing")));
      const repositories = page.repositories.map((repository) => ({
        nameWithOwner: repository.nameWithOwner,
        defaultBranch: repository.defaultBranch,
      }));
      if (input.repository === undefined) return { repositories, repository: null };
      const path = yield* repositoryPath(input.repository);
      const repository = yield* api([path]).pipe(
        Effect.flatMap((output) => decodeJson(RepositoryJson, output.stdout)),
      );
      const branches = yield* api([`${path}/branches?per_page=100`]).pipe(
        Effect.flatMap((output) => decodeJson(BranchesJson, output.stdout)),
      );
      const labels = yield* api([`${path}/labels?per_page=100`]).pipe(
        Effect.flatMap((output) => decodeJson(LabelsJson, output.stdout)),
      );
      return {
        repositories,
        repository: {
          id: repository.id,
          nameWithOwner: repository.full_name,
          defaultBranch: repository.default_branch,
          branches: branches.map((branch) => branch.name),
          labels: labels.map((label) => ({ id: label.id, name: label.name })),
        },
      };
    },
  );

  return {
    list,
    create,
    verify,
    disable,
    rotateSecret,
    metadata,
  } satisfies RoutineConnectionsShape;
});

export const RoutineConnectionsLive = Layer.effect(RoutineConnections, makeRoutineConnections);
