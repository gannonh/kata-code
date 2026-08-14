import {
  EnvironmentHttpApi,
  TASK_CLI_ENDPOINT_ENVIRONMENT_KEY,
  TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY,
  TASK_CLI_PROTOCOL,
  TaskCliContextEnvelope,
  type TaskCliErrorCode,
} from "@kata-sh/code-contracts";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import { Command } from "effect/unstable/cli";
import { FetchHttpClient, HttpClientError } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);

class TaskCliCommandError extends Data.TaggedError("TaskCliCommandError")<{
  readonly code: TaskCliErrorCode;
  readonly message: string;
  readonly [Runtime.errorExitCode]: 1;
  readonly [Runtime.errorReported]: false;
}> {}

const failureEnvelope = (code: TaskCliErrorCode, message: string) => ({
  protocol: TASK_CLI_PROTOCOL,
  ok: false as const,
  operation: "context" as const,
  error: { code, message },
});

const TASK_CLI_IDENTITY_FLAGS = new Set([
  "--task-id",
  "--taskId",
  "--thread-id",
  "--threadId",
  "--occurrence",
  "--provider",
  "--session",
  "--turn",
  "--turn-id",
  "--turnId",
  "--provider-instance",
  "--providerInstanceId",
]);

const TASK_CLI_CONTEXT_REQUIRED_MESSAGE =
  "Specify a Task command. The available command is `katacode task context`.";

const TASK_CLI_BOOLEAN_FLAGS = new Set([
  "--no-browser",
  "--auto-bootstrap-project-from-cwd",
  "--log-websocket-events",
  "--log-ws-events",
  "--tailscale-serve",
  "--help",
  "-h",
  "--version",
  "-v",
]);

const firstPositionalIndex = (args: ReadonlyArray<string>): number => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) return -1;
    if (arg === "--") return index + 1 < args.length ? index + 1 : -1;
    if (!arg.startsWith("-")) return index;
    const name = arg.split("=")[0] ?? arg;
    if (arg.includes("=") || TASK_CLI_BOOLEAN_FLAGS.has(name)) continue;
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("-")) index += 1;
  }
  return -1;
};

const printEnvelope = (envelope: unknown) =>
  encodeJsonString(envelope).pipe(Effect.flatMap((line) => Console.log(line)));

/** Reject identity flags and non-context verbs before Effect CLI help rendering. */
export const inspectTaskCliInvocationArgs = (args: ReadonlyArray<string>): string | undefined => {
  const taskIndex = firstPositionalIndex(args);
  if (taskIndex === -1 || args[taskIndex] !== "task") return undefined;
  const rest = args.slice(taskIndex + 1);
  for (const arg of rest) {
    const name = arg.split("=")[0];
    if (name !== undefined && TASK_CLI_IDENTITY_FLAGS.has(name)) {
      return "Context requests accept no identity flags or identity payload fields.";
    }
  }
  const verbs = rest.filter((arg) => !arg.startsWith("-"));
  if (verbs.length === 0) {
    return TASK_CLI_CONTEXT_REQUIRED_MESSAGE;
  }
  if (verbs[0] !== "context") {
    return `Unknown Task command \`${verbs[0]}\`. The available command is \`katacode task context\`.`;
  }
  return undefined;
};

export const failTaskCliInvalidRequest = (message: string) =>
  Effect.gen(function* () {
    yield* printEnvelope(failureEnvelope("invalid_request", message));
    return yield* new TaskCliCommandError({
      code: "invalid_request",
      message,
      [Runtime.errorExitCode]: 1,
      [Runtime.errorReported]: false,
    });
  });

const endpointFromEnvironment = (): string | undefined => {
  const raw = process.env[TASK_CLI_ENDPOINT_ENVIRONMENT_KEY]?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
};

const invocationTokenFromEnvironment = (): string | undefined => {
  const token = process.env[TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY]?.trim();
  return token && token.length > 0 ? token : undefined;
};

const runContext = Effect.gen(function* () {
  let envelope: typeof TaskCliContextEnvelope.Type;
  const endpoint = endpointFromEnvironment();
  if (!endpoint) {
    envelope = failureEnvelope(
      "invalid_request",
      `Set ${TASK_CLI_ENDPOINT_ENVIRONMENT_KEY} to the running Kata Code server URL.`,
    );
  } else {
    const token = invocationTokenFromEnvironment();
    if (!token) {
      envelope = failureEnvelope(
        "unauthorized",
        `Set ${TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY} to the injected Task invocation credential.`,
      );
    } else {
      envelope = yield* Effect.gen(function* () {
        const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: endpoint });
        return yield* client.taskCli.context({
          headers: { authorization: `Bearer ${token}` },
        });
      }).pipe(
        Effect.catch((error) => {
          const message = HttpClientError.isHttpClientError(error)
            ? `Task CLI request failed: ${error.message}`
            : `Task CLI request failed: ${String(error)}`;
          return Effect.succeed(failureEnvelope("internal_error", message));
        }),
      );
    }
  }

  yield* printEnvelope(envelope);
  if (!envelope.ok) {
    return yield* new TaskCliCommandError({
      code: envelope.error.code,
      message: envelope.error.message,
      [Runtime.errorExitCode]: 1,
      [Runtime.errorReported]: false,
    });
  }
});

export const taskContextCommand = Command.make("context").pipe(
  Command.withDescription("Print the server-authoritative context for the active Task turn."),
  Command.withHandler(() => runContext),
);

export const taskCliRuntimeLayer = FetchHttpClient.layer;

export const taskCommand = Command.make("task").pipe(
  Command.withDescription("Run provider-facing Task workflow commands."),
  Command.withHandler(() => failTaskCliInvalidRequest(TASK_CLI_CONTEXT_REQUIRED_MESSAGE)),
  Command.withSubcommands([taskContextCommand]),
  Command.provide(taskCliRuntimeLayer),
);
