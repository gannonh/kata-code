import {
  EnvironmentHttpApi,
  TASK_CLI_ENDPOINT_ENVIRONMENT_KEY,
  TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY,
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
  protocol: "task-cli@1" as const,
  ok: false as const,
  operation: "context" as const,
  error: { code, message },
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

const printEnvelope = (envelope: unknown) =>
  Effect.gen(function* () {
    yield* Console.log(yield* encodeJsonString(envelope));
  });

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
        Effect.catchCause((cause) => {
          const message = HttpClientError.isHttpClientError(cause)
            ? `Task CLI request failed: ${cause.message}`
            : `Task CLI request failed: ${String(cause)}`;
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
  Command.withHandler(() =>
    Effect.fail(
      new TaskCliCommandError({
        code: "invalid_request",
        message: "Specify a Task command. The available command is `katacode task context`.",
        [Runtime.errorExitCode]: 1,
        [Runtime.errorReported]: false,
      }),
    ),
  ),
  Command.withSubcommands([taskContextCommand]),
  Command.provide(taskCliRuntimeLayer),
);
