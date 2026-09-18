import * as NodeCrypto from "node:crypto";
import {
  RoutineConnection,
  RoutineConnectionId,
  RoutineError,
  type EnvironmentId,
  type RoutineConnectionCreateInput,
  type RoutineGitHubMetadata,
  type RoutineLinearMetadata,
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
import { LinearOAuthRelay } from "../cloud/LinearOAuthRelay.ts";
import { CLOUD_MANAGED_ENDPOINT_URL } from "../cloud/config.ts";
import * as ServerConfig from "../config.ts";
import * as CloudManagedEndpointRuntime from "../cloud/ManagedEndpointRuntime.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import { ensureFreshLinearOAuthBundle, routineLinearOAuthSecretName } from "./LinearOAuth.ts";
import { LinearRoutineMetadata, type LinearMetadataError } from "./LinearRoutineMetadata.ts";
import { LinearWebhookAdmin } from "./LinearRoutineWebhooks.ts";
import {
  routineConnectionSecretName,
  routineLinearWebhookCallbackPath,
  routineWebhookCallbackPath,
} from "./RoutineWebhooks.ts";
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
  readonly create: (
    input: RoutineConnectionCreateInput & { readonly environmentId: EnvironmentId },
  ) => Effect.Effect<RoutineConnection, RoutineError>;
  /** Linear only: asks the relay for the provider URL that starts OAuth authorization. */
  readonly beginAuthorization: (input: {
    readonly environmentId: EnvironmentId;
    readonly id: RoutineConnectionId;
  }) => Effect.Effect<{ readonly authorizeUrl: string }, RoutineError>;
  /**
   * GitHub waits for the provider ping, asking GitHub to resend it once if it
   * has not arrived. Linear has no ping event, so it waits for the first
   * delivery the provider sends for the connected webhook.
   */
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
  readonly linearMetadata: (input: {
    readonly environmentId: EnvironmentId;
    readonly connectionId: RoutineConnectionId;
  }) => Effect.Effect<RoutineLinearMetadata, RoutineError>;
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

const makeRoutineConnections = Effect.gen(function* () {
  const store = yield* RoutineStore;
  const github = yield* GitHubCli.GitHubCli;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const linearMetadataClient = yield* LinearRoutineMetadata;
  const linearWebhookAdmin = yield* LinearWebhookAdmin;
  const linearOAuthRelay = yield* LinearOAuthRelay;
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

  const linearMetadataFailure = (error: LinearMetadataError) => failure("blocked", error.message);
  const createLinear = Effect.fn("RoutineConnections.createLinear")(function* (input: {
    readonly environmentId: EnvironmentId;
    readonly id: RoutineConnectionId;
    readonly allTeams: boolean;
    readonly teamIds: ReadonlyArray<string>;
  }) {
    const bundle = yield* ensureFreshLinearOAuthBundle({
      secrets,
      relay: linearOAuthRelay,
      environmentId: input.environmentId,
      connectionId: input.id,
    });
    const baseUrl = yield* callbackBaseUrl;
    const metadata = yield* linearMetadataClient
      .read(bundle.accessToken)
      .pipe(Effect.mapError(linearMetadataFailure));
    const teamIds = input.allTeams ? [] : [...input.teamIds];
    if (!input.allTeams && teamIds.length !== 1)
      return yield* failure("validation", "Choose exactly one team, or connect all public teams.");
    const workspaceTeams = new Set(metadata.teams.map((team) => team.id));
    const unknownTeam = teamIds.find((teamId) => !workspaceTeams.has(teamId));
    if (unknownTeam !== undefined)
      return yield* failure("validation", "A selected team is not in this Linear workspace.");
    const secretName = routineConnectionSecretName(input.id);
    const createdWebhookId = yield* Ref.make<string | null>(null);
    return yield* Effect.gen(function* () {
      const callbackUrl = `${baseUrl}${routineLinearWebhookCallbackPath(input.id)}`;
      const webhook = yield* linearWebhookAdmin.createWebhook({
        accessToken: bundle.accessToken,
        callbackUrl,
        allTeams: input.allTeams,
        teamId: teamIds[0],
      });
      yield* Ref.set(createdWebhookId, webhook.webhookId);
      yield* secrets
        .create(secretName, new TextEncoder().encode(webhook.secret))
        .pipe(
          Effect.mapError((error) =>
            ServerSecretStore.isSecretAlreadyExistsError(error)
              ? failure("conflict", "A routine connection with this ID already exists.")
              : failure("persistence", "Could not store the signing secret."),
          ),
        );
      const now = yield* isoNow;
      const connection: RoutineConnection = {
        id: input.id,
        environmentId: input.environmentId,
        provider: "linear",
        workspaceId: metadata.workspace.id,
        workspaceName: metadata.workspace.name,
        teamIds,
        allTeams: input.allTeams,
        webhookId: webhook.webhookId,
        metadataAccess: "ok",
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
    }).pipe(
      // A failed setup releases the reserved secret and removes the created
      // webhook so the id can be retried instead of delivering to nothing.
      Effect.onError(() =>
        Effect.gen(function* () {
          const persisted = yield* store
            .findConnection(input.id)
            .pipe(Effect.orElseSucceed(() => null));
          if (persisted !== null) return;
          yield* secrets.remove(secretName).pipe(
            Effect.catch((error) =>
              Effect.logWarning("routine Linear signing secret cleanup failed", {
                connectionId: input.id,
                detail: error.message,
              }),
            ),
          );
          const webhookId = yield* Ref.get(createdWebhookId);
          if (webhookId === null) return;
          yield* linearWebhookAdmin
            .deleteWebhook({ accessToken: bundle.accessToken, webhookId })
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("routine Linear webhook cleanup failed", {
                  connectionId: input.id,
                  webhookId,
                  detail: error.message,
                }),
              ),
            );
        }),
      ),
    );
  });

  const createGitHub = Effect.fn("RoutineConnections.createGitHub")(function* (input: {
    readonly environmentId: EnvironmentId;
    readonly id: RoutineConnectionId;
    readonly repository: string;
  }) {
    const id = input.id;
    const path = yield* repositoryPath(input.repository);
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
      return connection;
    }).pipe(
      // A failed setup releases the reserved name so the id can be retried
      // instead of failing forever on a conflict with itself, and removes the
      // provider hook when one was already created. The store is the durable
      // record of whether the connection committed, so a failure between the
      // write and this handler still keeps both.
      Effect.onError(() =>
        Effect.gen(function* () {
          const persisted = yield* store.findConnection(id).pipe(Effect.orElseSucceed(() => null));
          if (persisted !== null) return;
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
  });

  const create: RoutineConnectionsShape["create"] = Effect.fn("RoutineConnections.create")(
    function* (input) {
      const id = yield* validateConnectionId(input.id);
      const existing = yield* store.findConnection(id);
      if (existing !== null)
        return yield* failure("conflict", "A routine connection with this ID already exists.");
      if (input.provider === "linear") return yield* createLinear({ ...input, id });
      return yield* createGitHub({ ...input, id });
    },
  );

  const beginAuthorization: RoutineConnectionsShape["beginAuthorization"] = Effect.fn(
    "RoutineConnections.beginAuthorization",
  )(function* (input) {
    const id = yield* validateConnectionId(input.id);
    return yield* linearOAuthRelay.start({
      environmentId: input.environmentId,
      connectionId: id,
    });
  });

  const awaitStatus = (environmentId: EnvironmentId, id: RoutineConnectionId, budgetMs: number) =>
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
      const ownedConnection = yield* owned(input.environmentId, id);
      if (ownedConnection.provider === "linear") {
        // Linear has no ping event. The connection becomes verified when the
        // first delivery arrives, so verify waits for it after the secret is in
        // place and never asks the provider to resend anything.
        if (ownedConnection.status !== "pending") return ownedConnection;
        const secret = yield* secrets
          .get(routineConnectionSecretName(id))
          .pipe(
            Effect.mapError(() =>
              failure("persistence", "Could not read the Linear signing secret."),
            ),
          );
        if (Option.isNone(secret))
          return yield* failure(
            "blocked",
            "This Linear connection has no signing secret. Disable it and create a new connection.",
          );
        return yield* awaitStatus(input.environmentId, id, PING_WAIT_MS);
      }
      const first = yield* awaitStatus(input.environmentId, id, PING_WAIT_MS / 3);
      if (first.status !== "pending" || first.provider !== "github" || first.hookId === null)
        return first;
      const path = yield* repositoryPath(first.repositoryName);
      yield* api(["-X", "POST", `${path}/hooks/${first.hookId}/pings`], undefined, "Webhook ping");
      return yield* awaitStatus(input.environmentId, id, PING_WAIT_MS);
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
      if (current.provider === "linear") {
        // The provider-side delete and revoke are best effort; local
        // acceptance already ended with the signing secret above.
        if (current.webhookId !== null) {
          const bundle = yield* ensureFreshLinearOAuthBundle({
            secrets,
            relay: linearOAuthRelay,
            environmentId: input.environmentId,
            connectionId: current.id,
          }).pipe(Effect.result);
          if (bundle._tag === "Success") {
            yield* linearWebhookAdmin
              .deleteWebhook({
                accessToken: bundle.success.accessToken,
                webhookId: current.webhookId,
              })
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning("routine Linear webhook could not be deleted", {
                    connectionId: current.id,
                    webhookId: current.webhookId,
                    detail: error.message,
                  }),
                ),
              );
          } else {
            yield* Effect.logWarning("routine Linear webhook delete skipped", {
              connectionId: current.id,
              detail: bundle.failure.message,
            });
          }
        }
        yield* linearOAuthRelay
          .revoke({ environmentId: input.environmentId, connectionId: current.id })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("routine Linear authorization could not be revoked", {
                connectionId: current.id,
                detail: error.message,
              }),
            ),
          );
        yield* secrets.remove(routineLinearOAuthSecretName(current.id)).pipe(
          Effect.catch((error) =>
            Effect.logWarning("routine Linear OAuth bundle cleanup failed", {
              connectionId: current.id,
              detail: error.message,
            }),
          ),
        );
        return yield* store.updateConnection(current.id, (connection) =>
          connection.provider === "linear"
            ? {
                ...connection,
                status: "disabled",
                webhookId: null,
                updatedAt: DateTime.formatIso(DateTime.nowUnsafe()),
              }
            : connection,
        );
      }
      const updated = yield* store.updateConnection(current.id, (connection) =>
        connection.provider === "github"
          ? {
              ...connection,
              status: "disabled",
              // The provider hook is deleted below; keeping its id would offer a
              // delivery-history link to a hook that no longer exists.
              hookId: null,
              updatedAt: DateTime.formatIso(DateTime.nowUnsafe()),
            }
          : connection,
      );
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
    if (current.provider === "linear")
      return yield* failure(
        "blocked",
        "Linear owns this webhook's signing secret. Disable this connection and create a new one.",
      );
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
      const [repository, branches, labels] = yield* Effect.all(
        [
          api([path]).pipe(Effect.flatMap((output) => decodeJson(RepositoryJson, output.stdout))),
          api([`${path}/branches?per_page=100`]).pipe(
            Effect.flatMap((output) => decodeJson(BranchesJson, output.stdout)),
          ),
          api([`${path}/labels?per_page=100`]).pipe(
            Effect.flatMap((output) => decodeJson(LabelsJson, output.stdout)),
          ),
        ],
        { concurrency: "unbounded" },
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

  const linearMetadata: RoutineConnectionsShape["linearMetadata"] = Effect.fn(
    "RoutineConnections.linearMetadata",
  )(function* (input) {
    const id = yield* validateConnectionId(input.connectionId);
    const bundle = yield* ensureFreshLinearOAuthBundle({
      secrets,
      relay: linearOAuthRelay,
      environmentId: input.environmentId,
      connectionId: id,
    });
    const found = yield* store.findConnection(id);
    const connection = found !== null && found.environmentId === input.environmentId ? found : null;
    const result = yield* linearMetadataClient.read(bundle.accessToken).pipe(Effect.result);
    const stampMetadataAccess = (metadataAccess: "ok" | "revoked") =>
      store
        .updateConnection(id, (current) =>
          current.provider === "linear"
            ? { ...current, metadataAccess, updatedAt: DateTime.formatIso(DateTime.nowUnsafe()) }
            : current,
        )
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("routine Linear metadata status update failed", { cause }),
          ),
        );
    if (result._tag === "Failure") {
      if (result.failure._tag === "access") {
        // Revoked access is a named connection state, not an empty picker.
        if (connection !== null) yield* stampMetadataAccess("revoked");
        return yield* failure(
          "blocked",
          "Linear metadata access was revoked. Disable this connection and create a new one with a working API key.",
        );
      }
      return yield* failure("blocked", result.failure.message);
    }
    if (
      connection !== null &&
      connection.provider === "linear" &&
      connection.metadataAccess === "revoked"
    )
      yield* stampMetadataAccess("ok");
    return result.success;
  });

  return {
    list,
    create,
    beginAuthorization,
    verify,
    disable,
    rotateSecret,
    metadata,
    linearMetadata,
  } satisfies RoutineConnectionsShape;
});

export const RoutineConnectionsLive = Layer.effect(RoutineConnections, makeRoutineConnections);
