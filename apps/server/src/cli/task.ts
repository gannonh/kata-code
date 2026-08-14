// @effect-diagnostics nodeBuiltinImport:off - the CLI reads artifact Markdown from a file path or stdin.
import { readFileSync } from "node:fs";
import * as NodeFs from "node:fs/promises";

import {
  EnvironmentHttpApi,
  TASK_CLI_ENDPOINT_ENVIRONMENT_KEY,
  TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY,
  type TaskCliCompleteEnvelope,
  type TaskCliContextEnvelope,
  type TaskCliErrorCode,
  type TaskCliOperation,
} from "@kata-sh/code-contracts";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient, HttpClientError } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import { taskCliFailureEnvelope } from "../taskCli/envelope.ts";

const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);

class TaskCliCommandError extends Data.TaggedError("TaskCliCommandError")<{
  readonly code: TaskCliErrorCode;
  readonly message: string;
  readonly [Runtime.errorExitCode]: 1;
  readonly [Runtime.errorReported]: false;
}> {}

class TaskCliArtifactReadError extends Data.TaggedError("TaskCliArtifactReadError")<{
  readonly message: string;
}> {}

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

const TASK_CLI_COMMANDS_REQUIRED_MESSAGE =
  "Specify a Task command. The available commands are `katacode task context` and `katacode task complete`.";

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

const TASK_CLI_VERBS = new Set(["context", "complete"]);

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

export interface TaskCliInspectionRejection {
  readonly message: string;
  readonly operation: TaskCliOperation;
}

/** Reject identity flags and unknown verbs before Effect CLI help rendering. */
export const inspectTaskCliInvocationArgs = (
  args: ReadonlyArray<string>,
): TaskCliInspectionRejection | undefined => {
  const taskIndex = firstPositionalIndex(args);
  if (taskIndex === -1 || args[taskIndex] !== "task") return undefined;
  const rest = args.slice(taskIndex + 1);
  const verbs = rest.filter((arg) => !arg.startsWith("-"));
  const operation: TaskCliOperation = verbs[0] === "complete" ? "complete" : "context";
  for (const arg of rest) {
    const name = arg.split("=")[0];
    if (name !== undefined && TASK_CLI_IDENTITY_FLAGS.has(name)) {
      return {
        message: "Task CLI requests accept no identity flags or identity payload fields.",
        operation,
      };
    }
  }
  if (verbs.length === 0) {
    return { message: TASK_CLI_COMMANDS_REQUIRED_MESSAGE, operation: "context" };
  }
  if (!TASK_CLI_VERBS.has(verbs[0]!)) {
    return {
      message: `Unknown Task command \`${verbs[0]}\`. The available commands are \`katacode task context\` and \`katacode task complete\`.`,
      operation: "context",
    };
  }
  return undefined;
};

export const failTaskCliInvalidRequest = (
  message: string,
  operation: TaskCliOperation = "context",
) =>
  Effect.gen(function* () {
    yield* printEnvelope(taskCliFailureEnvelope(operation, "invalid_request", message));
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

const readArtifactMarkdown = (artifactFile: string) =>
  artifactFile === "-"
    ? Effect.try({
        try: () => readFileSync(0, "utf8"),
        catch: (cause) =>
          new TaskCliArtifactReadError({
            message: `Failed to read artifact Markdown from stdin: ${String(cause)}`,
          }),
      })
    : Effect.tryPromise({
        try: () => NodeFs.readFile(artifactFile, "utf8"),
        catch: (cause) =>
          new TaskCliArtifactReadError({
            message: `Failed to read artifact Markdown from '${artifactFile}': ${String(cause)}`,
          }),
      });

const finishTaskCliEnvelope = (envelope: TaskCliContextEnvelope | TaskCliCompleteEnvelope) =>
  Effect.gen(function* () {
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

const missingEndpointEnvelope = (operation: TaskCliOperation) =>
  taskCliFailureEnvelope(
    operation,
    "invalid_request",
    `Set ${TASK_CLI_ENDPOINT_ENVIRONMENT_KEY} to the running Kata Code server URL.`,
  );

const missingTokenEnvelope = (operation: TaskCliOperation) =>
  taskCliFailureEnvelope(
    operation,
    "unauthorized",
    `Set ${TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY} to the injected Task invocation credential.`,
  );

const runContext = Effect.gen(function* () {
  const endpoint = endpointFromEnvironment();
  const token = invocationTokenFromEnvironment();
  const envelope =
    endpoint === undefined
      ? missingEndpointEnvelope("context")
      : token === undefined
        ? missingTokenEnvelope("context")
        : yield* Effect.gen(function* () {
            const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: endpoint });
            return yield* client.taskCli.context({
              headers: { authorization: `Bearer ${token}` },
            });
          }).pipe(
            Effect.catch((error) => {
              const message = HttpClientError.isHttpClientError(error)
                ? `Task CLI request failed: ${error.message}`
                : `Task CLI request failed: ${String(error)}`;
              return Effect.succeed(taskCliFailureEnvelope("context", "internal_error", message));
            }),
          );
  return yield* finishTaskCliEnvelope(envelope);
});

const runComplete = (input: { readonly summary: string; readonly artifactFile: string }) =>
  Effect.gen(function* () {
    const markdown = yield* readArtifactMarkdown(input.artifactFile).pipe(
      Effect.catchTag("TaskCliArtifactReadError", (error) =>
        failTaskCliInvalidRequest(error.message, "complete"),
      ),
    );
    const endpoint = endpointFromEnvironment();
    const token = invocationTokenFromEnvironment();
    const envelope =
      endpoint === undefined
        ? missingEndpointEnvelope("complete")
        : token === undefined
          ? missingTokenEnvelope("complete")
          : yield* Effect.gen(function* () {
              const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: endpoint });
              return yield* client.taskCli.complete({
                headers: { authorization: `Bearer ${token}` },
                payload: { summary: input.summary, markdown },
              });
            }).pipe(
              Effect.catch((error) => {
                const message = HttpClientError.isHttpClientError(error)
                  ? `Task CLI request failed: ${error.message}`
                  : `Task CLI request failed: ${String(error)}`;
                return Effect.succeed(
                  taskCliFailureEnvelope("complete", "internal_error", message),
                );
              }),
            );
    return yield* finishTaskCliEnvelope(envelope);
  });

export const taskContextCommand = Command.make("context").pipe(
  Command.withDescription("Print the server-authoritative context for the active Task turn."),
  Command.withHandler(() => runContext),
);

export const taskCompleteCommand = Command.make("complete", {
  summary: Flag.string("summary").pipe(
    Flag.withDescription("Concise stage completion summary."),
    Flag.optional,
  ),
  artifactFile: Flag.string("artifact-file").pipe(
    Flag.withDescription("Path to the stage artifact Markdown, or - to read stdin."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Propose completion of the active planning stage with a summary and artifact Markdown.",
  ),
  Command.withHandler((flags) => {
    const summary = Option.getOrUndefined(flags.summary)?.trim();
    const artifactFile = Option.getOrUndefined(flags.artifactFile)?.trim();
    if (!summary || !artifactFile) {
      return failTaskCliInvalidRequest(
        "Specify --summary and --artifact-file <file|->.",
        "complete",
      );
    }
    return runComplete({ summary, artifactFile });
  }),
);

export const taskCliRuntimeLayer = FetchHttpClient.layer;

export const taskCommand = Command.make("task").pipe(
  Command.withDescription("Run provider-facing Task workflow commands."),
  Command.withHandler(() => failTaskCliInvalidRequest(TASK_CLI_COMMANDS_REQUIRED_MESSAGE)),
  Command.withSubcommands([taskContextCommand, taskCompleteCommand]),
  Command.provide(taskCliRuntimeLayer),
);
