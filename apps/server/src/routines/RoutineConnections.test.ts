import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { EnvironmentId, RoutineConnectionId, RoutineError } from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { CLOUD_MANAGED_ENDPOINT_URL } from "../cloud/config.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import type * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  RoutineConnections,
  RoutineConnectionsLive,
  parseRepositoryName,
} from "./RoutineConnections.ts";
import { routineConnectionSecretName } from "./RoutineWebhooks.ts";
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
    if (path === "repos/acme/widgets/hooks")
      return Effect.succeed(output(JSON.stringify({ id: 1001 })));
    if (path.startsWith("repos/acme/widgets/branches"))
      return Effect.succeed(output(JSON.stringify([{ name: "main" }, { name: "release" }])));
    if (path.startsWith("repos/acme/widgets/labels"))
      return Effect.succeed(output(JSON.stringify([{ id: 5, name: "bug" }])));
    if (path.startsWith("repos/acme/widgets/hooks/1001")) return Effect.succeed(output("{}"));
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
const layer = RoutineConnectionsLive.pipe(
  Layer.provideMerge(RoutineStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory))),
  Layer.provideMerge(secretsLayer),
  Layer.provide(githubLayer),
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
        id,
        repository: "acme/widgets",
      });
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
      assert.equal(Buffer.from(Option.getOrThrow(stored)).toString("hex"), payload.config.secret);
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
      yield* connections.create({ environmentId, id, repository: "acme/widgets" });
      const verifying = yield* connections.verify({ environmentId, id }).pipe(Effect.forkChild);
      yield* TestClock.adjust("600 millis");
      yield* store.markConnectionVerified(id, "ping-1", 5_000);
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
      yield* connections.create({ environmentId, id, repository: "acme/widgets" });
      const before = Option.getOrThrow(yield* secrets.get(routineConnectionSecretName(id)));
      yield* connections.rotateSecret({ environmentId, id });
      const patch = calls.findLast((call) => call.args.includes("PATCH"))!;
      const after = Option.getOrThrow(yield* secrets.get(routineConnectionSecretName(id)));
      assert.notDeepEqual(Buffer.from(before), Buffer.from(after));
      assert.include(patch.stdin, Buffer.from(after).toString("hex"));
      const disabled = yield* connections.disable({ environmentId, id });
      assert.equal(disabled.status, "disabled");
      assert.isTrue(Option.isNone(yield* secrets.get(routineConnectionSecretName(id))));
      assert.isTrue(calls.some((call) => call.args.includes("DELETE")));
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
