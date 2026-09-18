import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  RoutineConnectionId,
  RoutineError,
  type RoutineLinearMetadata,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { LinearOAuthRelay, type LinearOAuthRelayShape } from "../cloud/LinearOAuthRelay.ts";
import { CLOUD_MANAGED_ENDPOINT_URL } from "../cloud/config.ts";
import * as CloudManagedEndpointRuntime from "../cloud/ManagedEndpointRuntime.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import type * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  readLinearOAuthBundle,
  saveLinearOAuthBundle,
  type LinearOAuthBundle,
} from "./LinearOAuth.ts";
import { summarizeLinearEvent } from "./LinearRoutineEvents.ts";
import { LinearRoutineMetadata, type LinearMetadataError } from "./LinearRoutineMetadata.ts";
import {
  RoutineConnections,
  RoutineConnectionsLive,
  parseRepositoryName,
} from "./RoutineConnections.ts";
import {
  routineConnectionMetadataSecretName,
  routineConnectionSecretName,
  routineLinearWebhookCallbackPath,
} from "./RoutineWebhooks.ts";
import { RoutineStore, RoutineStoreLive } from "./RoutineStore.ts";

const environmentId = EnvironmentId.make("routine-connections-environment");
const decodeHookCreatePayload = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      events: Schema.Array(Schema.String),
      config: Schema.Struct({ url: Schema.String, secret: Schema.String }),
    }),
  ),
);
const decodeHookConfigPayload = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      config: Schema.Struct({ url: Schema.String, secret: Schema.String }),
    }),
  ),
);
const output = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});
type Call = { readonly args: ReadonlyArray<string>; readonly stdin: string | undefined };
const calls: Call[] = [];
let hooksListStatus: "ok" | "forbidden" = "ok";
let hookCreateStatus: "ok" | "failure" = "ok";
let hookPatchStatus: "ok" | "failure" = "ok";
const githubLayer = Layer.mock(GitHubCli.GitHubCli)({
  assertAuthenticated: () => Effect.void,
  listRepositories: () =>
    Effect.succeed({
      repositories: [
        { nameWithOwner: "acme/widgets", defaultBranch: "main", visibility: "private" },
      ],
      page: 1,
      hasMore: false,
    }),
  execute: (input) => {
    calls.push({ args: input.args, stdin: input.stdin });
    const path =
      input.args.find(
        (arg) =>
          !arg.startsWith("-") &&
          arg !== "api" &&
          arg !== "POST" &&
          arg !== "PATCH" &&
          arg !== "DELETE",
      ) ?? "";
    if (path === "repos/acme/widgets") {
      return Effect.succeed(
        output(
          JSON.stringify({
            id: 42,
            full_name: "acme/widgets",
            html_url: "https://github.com/acme/widgets",
            default_branch: "main",
          }),
        ),
      );
    }
    if (path === "repos/acme/widgets/hooks" && !input.args.includes("POST")) {
      return hooksListStatus === "ok"
        ? Effect.succeed(output("[]"))
        : Effect.fail(
            new GitHubCli.GitHubCliCommandError({
              command: "gh",
              cwd: input.cwd,
              cause: "HTTP 404",
            }),
          );
    }
    if (path === "repos/acme/widgets/hooks") {
      return hookCreateStatus === "ok"
        ? Effect.succeed(output(JSON.stringify({ id: 1001 })))
        : Effect.fail(
            new GitHubCli.GitHubCliCommandError({
              command: "gh",
              cwd: input.cwd,
              cause: "HTTP 500",
            }),
          );
    }
    if (path.startsWith("repos/acme/widgets/branches"))
      return Effect.succeed(output(JSON.stringify([{ name: "main" }, { name: "release" }])));
    if (path.startsWith("repos/acme/widgets/labels"))
      return Effect.succeed(output(JSON.stringify([{ id: 5, name: "bug" }])));
    if (path.startsWith("repos/acme/widgets/hooks/1001")) {
      return hookPatchStatus === "ok"
        ? Effect.succeed(output("{}"))
        : Effect.fail(
            new GitHubCli.GitHubCliCommandError({
              command: "gh",
              cwd: input.cwd,
              cause: "HTTP 500",
            }),
          );
    }
    return Effect.fail(
      new GitHubCli.GitHubCliCommandError({
        command: "gh",
        cwd: input.cwd,
        cause: `unexpected ${path}`,
      }),
    );
  },
});
const configLayer = ServerConfig.layerTest(process.cwd(), { prefix: "t3-routine-connections-" });
const secretsLayer = ServerSecretStore.layer.pipe(Layer.provide(configLayer));
const endpointRuntimeLayer = Layer.succeed(
  CloudManagedEndpointRuntime.CloudManagedEndpointRuntime,
  CloudManagedEndpointRuntime.CloudManagedEndpointRuntime.of({
    applyConfig: () =>
      Effect.succeed({ status: "running", providerKind: "cloudflare_tunnel", pid: 1 }),
    getStatus: Effect.succeed({ status: "running", providerKind: "cloudflare_tunnel", pid: 1 }),
  }),
);
const linearMetadataFixture: RoutineLinearMetadata = {
  workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
  teams: [{ id: "team-1", name: "Engineering", key: "ENG" }],
  projects: [{ id: "project-1", name: "Roadmap", teamIds: ["team-1"] }],
  states: [{ id: "state-1", name: "In Progress", teamId: "team-1", type: "started" }],
  labels: [{ id: "label-1", name: "Bug", teamId: "team-1" }],
};
let linearMetadataRead: () => Effect.Effect<RoutineLinearMetadata, LinearMetadataError> = () =>
  Effect.succeed(linearMetadataFixture);
let lastLinearMetadataCredential: string | null = null;
const linearMetadataLayer = Layer.mock(LinearRoutineMetadata)({
  read: (credential) =>
    Effect.sync(() => {
      lastLinearMetadataCredential = credential;
    }).pipe(Effect.andThen(linearMetadataRead())),
});
const freshOAuthBundle = (overrides: Partial<LinearOAuthBundle> = {}): LinearOAuthBundle => ({
  accessToken: "linear-access-token",
  refreshToken: "linear-refresh-token",
  expiresAt: 1_800_000_000_000,
  scope: "read",
  ...overrides,
});
const DEFAULT_AUTHORIZE_URL = "https://linear.app/oauth/authorize?state=abc";
const successfulStart: LinearOAuthRelayShape["start"] = () =>
  Effect.succeed({ authorizeUrl: DEFAULT_AUTHORIZE_URL });
let linearOAuthStart: LinearOAuthRelayShape["start"] = successfulStart;
let lastStartInput: { environmentId: string; connectionId: string } | null = null;
const unusedRefresh: LinearOAuthRelayShape["refresh"] = () =>
  Effect.die("LinearOAuthRelay.refresh is not used by this test");
let linearOAuthRefresh: LinearOAuthRelayShape["refresh"] = unusedRefresh;
const linearOAuthRelayLayer = Layer.mock(LinearOAuthRelay)({
  start: (input) =>
    Effect.sync(() => {
      lastStartInput = input;
    }).pipe(Effect.andThen(linearOAuthStart(input))),
  refresh: (input) => linearOAuthRefresh(input),
});
const layer = RoutineConnectionsLive.pipe(
  Layer.provideMerge(RoutineStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory))),
  Layer.provideMerge(secretsLayer),
  Layer.provide(githubLayer),
  Layer.provide(endpointRuntimeLayer),
  Layer.provide(linearMetadataLayer),
  Layer.provide(linearOAuthRelayLayer),
  Layer.provideMerge(configLayer),
  Layer.provide(NodeServices.layer),
);

it.layer(layer)("RoutineConnections", (it) => {
  it.effect("refuses setup without a public callback URL", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const error = yield* connections
        .create({
          environmentId,
          provider: "github",
          id: RoutineConnectionId.make("connection-no-url"),
          repository: "acme/widgets",
        })
        .pipe(Effect.flip);
      assert.equal(error.code, "blocked");
      assert.include(error.message, "public callback URL");
      assert.equal(calls.length, 0);
    }),
  );

  it.effect("creates the hook through gh with the secret on stdin and never on argv", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      yield* secrets.set(
        CLOUD_MANAGED_ENDPOINT_URL,
        new TextEncoder().encode("https://env.example/"),
      );
      const id = RoutineConnectionId.make("connection-create");
      const connection = yield* connections.create({
        environmentId,
        provider: "github",
        id,
        repository: "acme/widgets",
      });
      assert.equal(connection.provider, "github");
      if (connection.provider !== "github") return;
      assert.equal(connection.repositoryId, 42);
      assert.equal(connection.hookId, 1001);
      assert.equal(connection.status, "pending");
      assert.equal(
        connection.callbackUrl,
        `https://env.example/api/routines/webhooks/github/${id}`,
      );
      const create = calls.find((call) => call.args.includes("POST"))!;
      assert.deepEqual(create.args, [
        "api",
        "-X",
        "POST",
        "repos/acme/widgets/hooks",
        "--input",
        "-",
      ]);
      const payload = yield* decodeHookCreatePayload(create.stdin!);
      assert.deepEqual(payload.events, ["pull_request", "issues", "workflow_run"]);
      assert.equal(payload.config.url, connection.callbackUrl);
      const stored = yield* secrets.get(routineConnectionSecretName(id));
      assert.isTrue(Option.isSome(stored));
      const storedSecret = Option.getOrThrow(stored);
      assert.equal(new TextDecoder().decode(storedSecret), payload.config.secret);
      const body = Buffer.from('{"provider":"github"}');
      const providerSignature = `sha256=${NodeCrypto.createHmac("sha256", payload.config.secret).update(body).digest("hex")}`;
      const localSignature = `sha256=${NodeCrypto.createHmac("sha256", storedSecret).update(body).digest("hex")}`;
      assert.equal(localSignature, providerSignature);
      assert.isFalse(
        calls.some((call) => call.args.some((arg) => arg.includes(payload.config.secret))),
      );
      const listed = yield* connections.list(environmentId);
      assert.deepEqual(
        listed.map((entry) => entry.id),
        [id],
      );
    }),
  );

  it.effect("names the missing admin permission when the hook list is refused", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      hooksListStatus = "forbidden";
      const error = yield* connections
        .create({
          environmentId,
          provider: "github",
          id: RoutineConnectionId.make("connection-forbidden"),
          repository: "acme/widgets",
        })
        .pipe(Effect.flip, Effect.ensuring(Effect.sync(() => (hooksListStatus = "ok"))));
      assert.instanceOf(error, RoutineError);
      assert.include(error.message, "admin access");
    }),
  );

  it.effect("verify resends the ping once and returns once the store marks it verified", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const store = yield* RoutineStore;
      const id = RoutineConnectionId.make("connection-verify");
      yield* connections.create({
        environmentId,
        provider: "github",
        id,
        repository: "acme/widgets",
      });
      const verifying = yield* connections.verify({ environmentId, id }).pipe(Effect.forkChild);
      yield* TestClock.adjust("600 millis");
      yield* store.admitEvent({
        connectionId: id,
        deliveryId: "ping-1",
        digest: "ping-1-digest",
        eventName: "ping",
        providerResourceId: 42,
        summary: null,
        now: 5_000,
      });
      yield* TestClock.adjust("600 millis");
      const verified = yield* Fiber.join(verifying);
      assert.equal(verified.status, "verified");
    }),
  );

  it.effect("rotating replaces the secret on GitHub and locally; disabling removes it", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const id = RoutineConnectionId.make("connection-rotate");
      yield* connections.create({
        environmentId,
        provider: "github",
        id,
        repository: "acme/widgets",
      });
      const before = Option.getOrThrow(yield* secrets.get(routineConnectionSecretName(id)));
      yield* connections.rotateSecret({ environmentId, id });
      const patch = calls.findLast((call) => call.args.includes("PATCH"))!;
      const after = Option.getOrThrow(yield* secrets.get(routineConnectionSecretName(id)));
      assert.notDeepEqual(Buffer.from(before), Buffer.from(after));
      const payload = yield* decodeHookConfigPayload(patch.stdin!);
      assert.equal(new TextDecoder().decode(after), payload.config.secret);
      assert.equal(payload.config.url, `https://env.example/api/routines/webhooks/github/${id}`);
      const disabled = yield* connections.disable({ environmentId, id });
      assert.equal(disabled.status, "disabled");
      assert.isTrue(Option.isNone(yield* secrets.get(routineConnectionSecretName(id))));
      assert.isTrue(calls.some((call) => call.args.includes("DELETE")));
    }),
  );

  it.effect("keeps the previous secret when the GitHub patch fails during rotation", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const id = RoutineConnectionId.make("connection-rotate-failure");
      yield* connections.create({
        environmentId,
        provider: "github",
        id,
        repository: "acme/widgets",
      });
      const before = Option.getOrThrow(yield* secrets.get(routineConnectionSecretName(id)));
      hookPatchStatus = "failure";
      const error = yield* connections
        .rotateSecret({ environmentId, id })
        .pipe(Effect.flip, Effect.ensuring(Effect.sync(() => (hookPatchStatus = "ok"))));
      assert.equal(error.code, "blocked");
      assert.include(error.message, "GitHub rejected the request");
      const after = Option.getOrThrow(yield* secrets.get(routineConnectionSecretName(id)));
      assert.deepEqual(Buffer.from(after), Buffer.from(before));
    }),
  );

  it.effect("releases the reserved secret when setup fails so the id can be retried", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const id = RoutineConnectionId.make("connection-retry");
      hookCreateStatus = "failure";
      yield* connections
        .create({ environmentId, provider: "github", id, repository: "acme/widgets" })
        .pipe(Effect.flip, Effect.ensuring(Effect.sync(() => (hookCreateStatus = "ok"))));
      assert.isTrue(Option.isNone(yield* secrets.get(routineConnectionSecretName(id))));
      const retried = yield* connections.create({
        environmentId,
        provider: "github",
        id,
        repository: "acme/widgets",
      });
      assert.equal(retried.provider, "github");
      if (retried.provider !== "github") return;
      assert.equal(retried.hookId, 1001);
    }),
  );

  it.effect(
    "removes the created hook and the reserved secret when the connection cannot be saved",
    () =>
      Effect.gen(function* () {
        const connections = yield* RoutineConnections;
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        const sql = yield* SqlClient.SqlClient;
        const id = RoutineConnectionId.make("connection-hook-cleanup");
        const callsBefore = calls.length;
        yield* sql`CREATE TEMP TRIGGER fail_connection_save BEFORE INSERT ON routine_connections
        WHEN NEW.id='connection-hook-cleanup'
        BEGIN SELECT RAISE(FAIL, 'simulated save failure'); END`;
        const failed = yield* connections
          .create({ environmentId, provider: "github", id, repository: "acme/widgets" })
          .pipe(
            Effect.flip,
            Effect.ensuring(sql`DROP TRIGGER fail_connection_save`.pipe(Effect.orDie)),
          );
        assert.equal(failed.code, "persistence");
        assert.isTrue(Option.isNone(yield* secrets.get(routineConnectionSecretName(id))));
        assert.isTrue(
          calls
            .slice(callsBefore)
            .some(
              (call) =>
                call.args.includes("DELETE") && call.args.includes("repos/acme/widgets/hooks/1001"),
            ),
        );
        const retried = yield* connections.create({
          environmentId,
          provider: "github",
          id,
          repository: "acme/widgets",
        });
        assert.equal(retried.provider, "github");
        if (retried.provider !== "github") return;
        assert.equal(retried.hookId, 1001);
      }),
  );

  it.effect("metadata lists repositories and resolves stable ids for one repository", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const overview = yield* connections.metadata({});
      assert.deepEqual(overview.repositories, [
        { nameWithOwner: "acme/widgets", defaultBranch: "main" },
      ]);
      assert.isNull(overview.repository);
      const detail = yield* connections.metadata({ repository: "acme/widgets" });
      assert.equal(detail.repository?.id, 42);
      assert.deepEqual(detail.repository?.branches, ["main", "release"]);
      assert.deepEqual(detail.repository?.labels, [{ id: 5, name: "bug" }]);
      assert.isNull(parseRepositoryName("acme/widgets/extra"));
      assert.isNull(parseRepositoryName("-X"));
    }),
  );
});

it.layer(layer)("RoutineConnections Linear", (it) => {
  const linearCreate = (id: RoutineConnectionId, teamIds: string[] = ["team-1"]) => ({
    environmentId,
    provider: "linear" as const,
    id,
    apiKey: "lin_api_secret",
    allTeams: false,
    teamIds,
  });

  it.effect("creates a Linear connection from validated metadata and attaches its secret", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const store = yield* RoutineStore;
      yield* secrets.set(
        CLOUD_MANAGED_ENDPOINT_URL,
        new TextEncoder().encode("https://env.example/"),
      );
      const id = RoutineConnectionId.make("connection-linear-create");
      const connection = yield* connections.create(linearCreate(id));
      assert.equal(connection.provider, "linear");
      if (connection.provider !== "linear") return;
      assert.equal(connection.workspaceId, "workspace-1");
      assert.equal(connection.workspaceName, "Acme");
      assert.deepEqual(connection.teamIds, ["team-1"]);
      assert.equal(connection.status, "pending");
      assert.equal(
        connection.callbackUrl,
        `https://env.example${routineLinearWebhookCallbackPath(id)}`,
      );
      assert.isTrue(Option.isNone(yield* secrets.get(routineConnectionSecretName(id))));
      const storedKey = yield* secrets.get(routineConnectionMetadataSecretName(id));
      assert.equal(new TextDecoder().decode(Option.getOrThrow(storedKey)), "lin_api_secret");

      const attached = yield* connections.attachSecret({
        environmentId,
        id,
        signingSecret: "linear-signing-secret",
      });
      assert.equal(attached.provider, "linear");
      const storedSecret = yield* secrets.get(routineConnectionSecretName(id));
      assert.equal(
        new TextDecoder().decode(Option.getOrThrow(storedSecret)),
        "linear-signing-secret",
      );

      const verifying = yield* connections.verify({ environmentId, id }).pipe(Effect.forkChild);
      yield* TestClock.adjust("600 millis");
      const summarized = summarizeLinearEvent({
        action: "create",
        data: { id: "issue-1", identifier: "KAT-1", title: "Issue", teamId: "team-1" },
        organizationId: "workspace-1",
        type: "Issue",
      });
      yield* store.admitEvent({
        connectionId: id,
        deliveryId: "linear-delivery-1",
        digest: "linear-digest-1",
        eventName: "Issue",
        providerResourceId: "workspace-1",
        summary: summarized.kind === "event" ? summarized.summary : null,
        now: 5_000,
      });
      yield* TestClock.adjust("600 millis");
      const verified = yield* Fiber.join(verifying);
      assert.equal(verified.status, "verified");
    }),
  );

  it.effect("rejects a revoked credential and unknown teams without saving a connection", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const revoked = RoutineConnectionId.make("connection-linear-revoked");
      linearMetadataRead = () =>
        Effect.fail({ _tag: "access", message: "Authentication required" });
      const accessError = yield* connections
        .create(linearCreate(revoked))
        .pipe(
          Effect.flip,
          Effect.ensuring(
            Effect.sync(() => (linearMetadataRead = () => Effect.succeed(linearMetadataFixture))),
          ),
        );
      assert.equal(accessError.code, "blocked");
      assert.include(accessError.message, "access");
      assert.isTrue(
        Option.isNone(yield* secrets.get(routineConnectionMetadataSecretName(revoked))),
      );

      const unknown = RoutineConnectionId.make("connection-linear-unknown-team");
      const teamError = yield* connections
        .create(linearCreate(unknown, ["team-missing"]))
        .pipe(Effect.flip);
      assert.equal(teamError.code, "validation");
      assert.isTrue(
        Option.isNone(yield* secrets.get(routineConnectionMetadataSecretName(unknown))),
      );
    }),
  );

  it.effect(
    "reads workspace metadata from the stored OAuth bundle without a connection record",
    () =>
      Effect.gen(function* () {
        const connections = yield* RoutineConnections;
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        const store = yield* RoutineStore;
        const id = RoutineConnectionId.make("connection-linear-metadata-bundle");
        yield* saveLinearOAuthBundle({
          secrets,
          connectionId: id,
          bundle: freshOAuthBundle({ accessToken: "bundle-access-token" }),
        });
        const metadata = yield* connections.linearMetadata({ environmentId, connectionId: id });
        assert.equal(metadata.workspace.name, "Acme");
        assert.equal(metadata.teams[0]?.id, "team-1");
        assert.equal(lastLinearMetadataCredential, "bundle-access-token");
        assert.isNull(yield* store.findConnection(id));
      }),
  );

  it.effect("refreshes a near-expiry bundle through the relay and persists the new token", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const id = RoutineConnectionId.make("connection-linear-metadata-refresh");
      yield* saveLinearOAuthBundle({
        secrets,
        connectionId: id,
        bundle: freshOAuthBundle({ accessToken: "stale-access-token", expiresAt: 30_000 }),
      });
      const refreshes: Array<{ environmentId: string; connectionId: string }> = [];
      linearOAuthRefresh = (input) => {
        refreshes.push(input);
        return Effect.succeed({
          accessToken: "refreshed-access-token",
          expiresAt: 1_800_000_000_000,
          scope: "read",
        });
      };
      const metadata = yield* connections
        .linearMetadata({ environmentId, connectionId: id })
        .pipe(Effect.ensuring(Effect.sync(() => (linearOAuthRefresh = unusedRefresh))));
      assert.equal(metadata.workspace.name, "Acme");
      assert.deepEqual(refreshes, [{ environmentId, connectionId: id }]);
      assert.equal(lastLinearMetadataCredential, "refreshed-access-token");
      const stored = Option.getOrThrow(yield* readLinearOAuthBundle({ secrets, connectionId: id }));
      assert.equal(stored.accessToken, "refreshed-access-token");
      assert.equal(stored.refreshToken, "linear-refresh-token");
    }),
  );

  it.effect("blocks metadata before Linear is connected", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const store = yield* RoutineStore;
      const id = RoutineConnectionId.make("connection-linear-metadata-missing");
      const error = yield* connections
        .linearMetadata({ environmentId, connectionId: id })
        .pipe(Effect.flip);
      assert.equal(error.code, "blocked");
      assert.include(error.message, "Connect Linear before reading workspace metadata.");
      assert.isNull(yield* store.findConnection(id));
    }),
  );

  it.effect("names revoked metadata access and clears it after the next successful read", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const store = yield* RoutineStore;
      const id = RoutineConnectionId.make("connection-linear-metadata-revoked");
      yield* connections.create(linearCreate(id));
      yield* saveLinearOAuthBundle({ secrets, connectionId: id, bundle: freshOAuthBundle() });
      linearMetadataRead = () =>
        Effect.fail({ _tag: "access", message: "Authentication required" });
      const error = yield* connections
        .linearMetadata({ environmentId, connectionId: id })
        .pipe(
          Effect.flip,
          Effect.ensuring(
            Effect.sync(() => (linearMetadataRead = () => Effect.succeed(linearMetadataFixture))),
          ),
        );
      assert.equal(error.code, "blocked");
      assert.include(error.message, "revoked");
      const revoked = yield* store.getConnection(environmentId, id);
      assert.equal(revoked.provider === "linear" ? revoked.metadataAccess : null, "revoked");
      const metadata = yield* connections.linearMetadata({ environmentId, connectionId: id });
      assert.equal(metadata.workspace.name, "Acme");
      const restored = yield* store.getConnection(environmentId, id);
      assert.equal(restored.provider === "linear" ? restored.metadataAccess : null, "ok");
    }),
  );

  it.effect(
    "disabling a Linear connection removes both secrets and keeps the provider webhook",
    () =>
      Effect.gen(function* () {
        const connections = yield* RoutineConnections;
        const secrets = yield* ServerSecretStore.ServerSecretStore;
        const id = RoutineConnectionId.make("connection-linear-disable");
        yield* connections.create(linearCreate(id));
        yield* connections.attachSecret({
          environmentId,
          id,
          signingSecret: "linear-signing-secret",
        });
        const callsBefore = calls.length;
        const disabled = yield* connections.disable({ environmentId, id });
        assert.equal(disabled.status, "disabled");
        assert.isTrue(Option.isNone(yield* secrets.get(routineConnectionSecretName(id))));
        assert.isTrue(Option.isNone(yield* secrets.get(routineConnectionMetadataSecretName(id))));
        assert.equal(calls.length, callsBefore);
      }),
  );

  it.effect("begins a Linear authorization through the relay for this environment", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      const id = RoutineConnectionId.make("connection-linear-begin");
      const authorization = yield* connections.beginAuthorization({ environmentId, id });
      assert.deepEqual(authorization, { authorizeUrl: DEFAULT_AUTHORIZE_URL });
      assert.deepEqual(lastStartInput, { environmentId, connectionId: id });
    }),
  );

  it.effect("rejects a path-like connection id before asking the relay", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      lastStartInput = null;
      const error = yield* connections
        .beginAuthorization({
          environmentId,
          id: "../escape" as RoutineConnectionId,
        })
        .pipe(Effect.flip);
      assert.equal(error.code, "validation");
      assert.isNull(lastStartInput);
    }),
  );

  it.effect("surfaces a relay failure as a RoutineError", () =>
    Effect.gen(function* () {
      const connections = yield* RoutineConnections;
      linearOAuthStart = () =>
        Effect.fail(
          new RoutineError({
            code: "blocked",
            message: "Could not reach Kata Code Connect to authorize Linear.",
          }),
        );
      const error = yield* connections
        .beginAuthorization({
          environmentId,
          id: RoutineConnectionId.make("connection-linear-begin-failure"),
        })
        .pipe(
          Effect.flip,
          Effect.ensuring(Effect.sync(() => (linearOAuthStart = successfulStart))),
        );
      assert.instanceOf(error, RoutineError);
      assert.equal(error.code, "blocked");
      assert.include(error.message, "Could not reach Kata Code Connect");
    }),
  );
});
