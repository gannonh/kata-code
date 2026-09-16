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
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { CLOUD_MANAGED_ENDPOINT_URL } from "../cloud/config.ts";
import * as ServerConfig from "../config.ts";
import * as CloudManagedEndpointRuntime from "../cloud/ManagedEndpointRuntime.ts";
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
const decodeConnectionId = Schema.decodeUnknownSync(RoutineConnectionId);
const validateConnectionId = (id: RoutineConnectionId) =>
  Effect.try({
    try: () => decodeConnectionId(id),
    catch: () =>
      failure(
        "validation",
        "Connection ID must be 1-128 characters using only letters, numbers, underscore, or hyphen.",
      ),
  });

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
  const endpointRuntime = yield* CloudManagedEndpointRuntime.CloudManagedEndpointRuntime;
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
  const callbackBaseUrl = Effect.gen(function* () {
    const runtimeStatus = yield* endpointRuntime.getStatus;
    if (runtimeStatus.status !== "running")
      return yield* failure(
        "blocked",
        "The managed endpoint runtime is not running. Start Kata Code Connect, then try again.",
      );
    const endpointUrl = yield* secrets
      .get(CLOUD_MANAGED_ENDPOINT_URL)
      .pipe(
        Effect.mapError(() => failure("persistence", "Could not read the environment link state.")),
      );
    return yield* Option.match(endpointUrl, {
      onNone: () =>
        Effect.fail(
          failure(
            "blocked",
            "This environment has no public callback URL. Link it through Kata Code Connect with a managed tunnel, then try again.",
          ),
        ),
      onSome: (bytes) => Effect.succeed(new TextDecoder().decode(bytes).replace(/\/+$/u, "")),
    });
  });
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
    Effect.gen(function* () {
      const connections = yield* store.listConnections(environmentId);
      if ((yield* endpointRuntime.getStatus).status === "running") return connections;
      return connections.map((connection) =>
        connection.status === "disabled" ? connection : { ...connection, status: "unavailable" },
      );
    });

  const create: RoutineConnectionsShape["create"] = Effect.fn("RoutineConnections.create")(
    function* (input) {
      const id = yield* validateConnectionId(input.id);
      const path = yield* repositoryPath(input.repository);
      const existing = yield* store.findConnection(id);
      if (existing !== null)
        return yield* failure("conflict", "A routine connection with this ID already exists.");
      const baseUrl = yield* callbackBaseUrl;
      const secret = yield* secretBytes();
      const secretValue = secretText(secret);
      yield* secrets
        .create(routineConnectionSecretName(id), new TextEncoder().encode(secretValue))
        .pipe(
          Effect.mapError((error) =>
            ServerSecretStore.isSecretAlreadyExistsError(error)
              ? failure("conflict", "A routine connection with this ID already exists.")
              : failure("persistence", "Could not reserve the signing secret."),
          ),
        );
      const createdHookId = yield* Ref.make<number | null>(null);
      const saved = yield* Ref.make(false);
      return yield* Effect.gen(function* () {
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
        const callbackUrl = `${baseUrl}${routineWebhookCallbackPath(id)}`;
        // The secret is reserved before the hook exists so GitHub cannot sign a
        // delivery the server would have no key to verify. It reaches GitHub only
        // through stdin and never enters argv or logs.
        const hook = yield* api(
          ["-X", "POST", `${path}/hooks`, "--input", "-"],
          encodeHookCreate({
            name: "web",
            active: true,
            events: [...HOOK_EVENTS],
            config: hookConfig(callbackUrl, secretValue),
          }),
          "Webhook creation",
        ).pipe(Effect.flatMap((output) => decodeJson(HookJson, output.stdout)));
        yield* Ref.set(createdHookId, hook.id);
        const now = yield* isoNow;
        const connection: RoutineConnection = {
          id,
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
        yield* Ref.set(saved, true);
        return connection;
      }).pipe(
        // A failed setup releases the reserved name so the id can be retried
        // instead of failing forever on a conflict with itself, and removes the
        // provider hook when one was already created. A committed connection
        // keeps both even when the caller is interrupted afterwards.
        Effect.onError(() =>
          Effect.gen(function* () {
            if (yield* Ref.get(saved)) return;
            yield* secrets.remove(routineConnectionSecretName(id)).pipe(
              Effect.catch((error) =>
                Effect.logWarning("routine connection secret cleanup failed", {
                  connectionId: id,
                  detail: error.message,
                }),
              ),
            );
            const hookId = yield* Ref.get(createdHookId);
            if (hookId === null) return;
            yield* api(
              ["-X", "DELETE", `${path}/hooks/${hookId}`],
              undefined,
              "Webhook cleanup",
            ).pipe(
              Effect.catch((error) =>
                Effect.logWarning("routine connection hook cleanup failed", {
                  connectionId: id,
                  hookId,
                  detail: error.message,
                }),
              ),
            );
          }),
        ),
      );
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
      const id = yield* validateConnectionId(input.id);
      const first = yield* awaitPing(input.environmentId, id, PING_WAIT_MS / 3);
      if (first.status !== "pending" || first.hookId === null) return first;
      const path = yield* repositoryPath(first.repositoryName);
      yield* api(["-X", "POST", `${path}/hooks/${first.hookId}/pings`], undefined, "Webhook ping");
      return yield* awaitPing(input.environmentId, id, PING_WAIT_MS);
    },
  );

  const disable: RoutineConnectionsShape["disable"] = Effect.fn("RoutineConnections.disable")(
    function* (input) {
      const id = yield* validateConnectionId(input.id);
      const current = yield* owned(input.environmentId, id);
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
    const id = yield* validateConnectionId(input.id);
    const current = yield* owned(input.environmentId, id);
    if (current.status === "disabled" || current.hookId === null)
      return yield* failure("blocked", "Reconnect the repository before rotating its secret.");
    const path = yield* repositoryPath(current.repositoryName);
    const name = routineConnectionSecretName(current.id);
    const previous = yield* secrets
      .get(name)
      .pipe(
        Effect.mapError(() => failure("persistence", "Could not read the current signing secret.")),
      );
    const secret = yield* secretBytes();
    // Store the new value locally first, then patch GitHub. If the patch fails,
    // the previous value is restored so provider and server never disagree.
    yield* secrets
      .set(name, new TextEncoder().encode(secretText(secret)))
      .pipe(Effect.mapError(() => failure("persistence", "Could not store the signing secret.")));
    yield* api(
      ["-X", "PATCH", `${path}/hooks/${current.hookId}`, "--input", "-"],
      encodeHookPatch({ config: hookConfig(current.callbackUrl, secretText(secret)) }),
      "Webhook secret rotation",
    ).pipe(
      Effect.catch((error) =>
        (Option.isSome(previous) ? secrets.set(name, previous.value) : secrets.remove(name)).pipe(
          Effect.catch((restoreError) =>
            Effect.logWarning("routine webhook secret restore failed", {
              connectionId: current.id,
              detail: restoreError.message,
            }),
          ),
          Effect.andThen(Effect.fail(error)),
        ),
      ),
    );
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
