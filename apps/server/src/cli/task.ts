// @effect-diagnostics nodeBuiltinImport:off - the CLI reads artifact Markdown from a file path or stdin.
import { readFileSync } from "node:fs";
import * as NodeFs from "node:fs/promises";

import {
  EnvironmentHttpApi,
  TASK_CLI_ENDPOINT_ENVIRONMENT_KEY,
  TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY,
  type TaskCliAmendmentEnvelope,
  type TaskCliCheckBeginEnvelope,
  type TaskCliCheckFinalizeEnvelope,
  type TaskCliCompleteEnvelope,
  type TaskCliContextEnvelope,
  type TaskCliErrorCode,
  type TaskCliOperation,
  type TaskCliProgressEnvelope,
} from "@kata-sh/code-contracts";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient, HttpClientError } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import { taskCliFailureEnvelope } from "../taskCli/envelope.ts";
import * as ProcessRunner from "../processRunner.ts";
import { TaskCheckExecutor, TaskCheckExecutorLive } from "../taskCli/TaskCheckExecutor.ts";

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
  "Specify a Task command. The available commands are `katacode task context`, `katacode task progress`, `katacode task check run`, `katacode task amendment propose`, and `katacode task complete`.";

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

const TASK_CLI_VERBS = new Set(["context", "complete", "progress", "check", "amendment"]);

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
  const operation: TaskCliOperation =
    verbs[0] === "complete"
      ? "complete"
      : verbs[0] === "progress"
        ? "progress"
        : verbs[0] === "check"
          ? "check"
          : verbs[0] === "amendment"
            ? "amendment"
            : "context";
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
      message: `Unknown Task command \`${verbs[0]}\`. The available commands are \`katacode task context\`, \`katacode task progress\`, \`katacode task check run\`, \`katacode task amendment propose\`, and \`katacode task complete\`.`,
      operation: "context",
    };
  }
  if (verbs[0] === "progress" && verbs.length < 3) {
    return {
      message:
        "Specify `katacode task progress phase <id>` or `katacode task progress work-item <id>` with --status and --summary.",
      operation: "progress",
    };
  }
  if (verbs[0] === "check" && !(verbs[1] === "run" && verbs.length >= 3)) {
    return {
      message: "Specify `katacode task check run <check-id>`.",
      operation: "check",
    };
  }
  if (verbs[0] === "amendment" && verbs[1] !== "propose") {
    return {
      message:
        "Specify `katacode task amendment propose` with --phase, --work-item, --expected, --found, --impact, and --input <file|->.",
      operation: "amendment",
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

type TaskCliEnvelope =
  | TaskCliContextEnvelope
  | TaskCliCompleteEnvelope
  | TaskCliProgressEnvelope
  | TaskCliCheckBeginEnvelope
  | TaskCliCheckFinalizeEnvelope
  | TaskCliAmendmentEnvelope;

const finishTaskCliEnvelope = (envelope: TaskCliEnvelope) =>
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

const runProgress = (input: {
  readonly target: "phase" | "work-item";
  readonly id: string;
  readonly status: "running" | "completed" | "blocked";
  readonly summary: string;
}) =>
  Effect.gen(function* () {
    const endpoint = endpointFromEnvironment();
    const token = invocationTokenFromEnvironment();
    const envelope =
      endpoint === undefined
        ? missingEndpointEnvelope("progress")
        : token === undefined
          ? missingTokenEnvelope("progress")
          : yield* Effect.gen(function* () {
              const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: endpoint });
              return yield* client.taskCli.progress({
                headers: { authorization: `Bearer ${token}` },
                payload: {
                  target: input.target,
                  id: input.id,
                  status: input.status,
                  summary: input.summary,
                },
              });
            }).pipe(
              Effect.catch((error) => {
                const message = HttpClientError.isHttpClientError(error)
                  ? `Task CLI request failed: ${error.message}`
                  : `Task CLI request failed: ${String(error)}`;
                return Effect.succeed(
                  taskCliFailureEnvelope("progress", "internal_error", message),
                );
              }),
            );
    return yield* finishTaskCliEnvelope(envelope);
  });

const runAmendment = (input: {
  readonly phaseId: string;
  readonly workItemId: string;
  readonly triggeringCheckId: string | null;
  readonly expected: string;
  readonly found: string;
  readonly impact: string;
  readonly artifactFile: string;
}) =>
  Effect.gen(function* () {
    const proposedPlanMarkdown = yield* readArtifactMarkdown(input.artifactFile).pipe(
      Effect.catchTag("TaskCliArtifactReadError", (error) =>
        failTaskCliInvalidRequest(error.message, "amendment"),
      ),
    );
    const endpoint = endpointFromEnvironment();
    const token = invocationTokenFromEnvironment();
    const envelope =
      endpoint === undefined
        ? missingEndpointEnvelope("amendment")
        : token === undefined
          ? missingTokenEnvelope("amendment")
          : yield* Effect.gen(function* () {
              const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: endpoint });
              return yield* client.taskCli.amendment({
                headers: { authorization: `Bearer ${token}` },
                payload: {
                  phaseId: input.phaseId,
                  workItemId: input.workItemId,
                  triggeringCheckId: input.triggeringCheckId,
                  expected: input.expected,
                  found: input.found,
                  impact: input.impact,
                  proposedPlanMarkdown,
                },
              });
            }).pipe(
              Effect.catch((error) => {
                const message = HttpClientError.isHttpClientError(error)
                  ? `Task CLI request failed: ${error.message}`
                  : `Task CLI request failed: ${String(error)}`;
                return Effect.succeed(
                  taskCliFailureEnvelope("amendment", "internal_error", message),
                );
              }),
            );
    return yield* finishTaskCliEnvelope(envelope);
  });

const runCheck = (checkId: string) =>
  Effect.gen(function* () {
    const endpoint = endpointFromEnvironment();
    const token = invocationTokenFromEnvironment();
    const beginEnvelope =
      endpoint === undefined
        ? missingEndpointEnvelope("check")
        : token === undefined
          ? missingTokenEnvelope("check")
          : yield* Effect.gen(function* () {
              const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: endpoint });
              return yield* client.taskCli.checkBegin({
                headers: { authorization: `Bearer ${token}` },
                payload: { checkId },
              });
            }).pipe(
              Effect.catch((error) => {
                const message = HttpClientError.isHttpClientError(error)
                  ? `Task CLI request failed: ${error.message}`
                  : `Task CLI request failed: ${String(error)}`;
                return Effect.succeed(taskCliFailureEnvelope("check", "internal_error", message));
              }),
            );
    if (!beginEnvelope.ok) {
      return yield* finishTaskCliEnvelope(beginEnvelope);
    }
    // A settled pass is a stable result: print it and do not re-run.
    if (beginEnvelope.outcome === "settled-pass") {
      return yield* finishTaskCliEnvelope(beginEnvelope);
    }
    const finalizerToken = beginEnvelope.finalizerToken;
    if (finalizerToken === null) {
      return yield* finishTaskCliEnvelope(
        taskCliFailureEnvelope(
          "check",
          "internal_error",
          `Check '${checkId}' began without a finalization credential.`,
        ),
      );
    }
    const executor = yield* TaskCheckExecutor;
    const executed = yield* executor
      .run({
        worktreePath: beginEnvelope.cwd,
        expectedStartingCommitSha: beginEnvelope.startingCommitSha,
        command: beginEnvelope.command,
        timeoutMs: beginEnvelope.timeoutMs,
        maxOutputBytes: beginEnvelope.maxOutputBytes,
      })
      .pipe(
        Effect.map((result) => ({ _tag: "result" as const, result })),
        Effect.catchTag("TaskCheckExecutorError", (error) =>
          Effect.succeed(
            error.kind === "git-state"
              ? { _tag: "git-state" as const, message: error.message }
              : { _tag: "execution-failure" as const, message: error.message },
          ),
        ),
      );

    if (executed._tag === "git-state") {
      // Do not finalize: leave the attempt pending so the server reconcile
      // settles it indeterminate.
      return yield* finishTaskCliEnvelope(
        taskCliFailureEnvelope("check", "conflict", executed.message),
      );
    }

    const finalizePayload =
      executed._tag === "result"
        ? {
            finalizerToken,
            exitCode: executed.result.exitCode,
            status: executed.result.status,
            output: executed.result.output.slice(0, beginEnvelope.maxOutputBytes),
            timedOut: executed.result.timedOut,
            startingCommitSha: executed.result.startingCommitSha,
            endingCommitSha: executed.result.endingCommitSha,
            startingStatus: executed.result.startingStatus,
            endingStatus: executed.result.endingStatus,
          }
        : {
            finalizerToken,
            exitCode: null,
            status: "indeterminate" as const,
            output: executed.message,
            timedOut: false,
            startingCommitSha: beginEnvelope.startingCommitSha,
            endingCommitSha: null,
            startingStatus: beginEnvelope.startingStatus,
            endingStatus: null,
          };

    const finalizeEnvelope = yield* Effect.gen(function* () {
      const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: endpoint });
      return yield* client.taskCli.checkFinalize({ headers: {}, payload: finalizePayload });
    }).pipe(
      Effect.catch((error) => {
        const message = HttpClientError.isHttpClientError(error)
          ? `Task CLI request failed: ${error.message}`
          : `Task CLI request failed: ${String(error)}`;
        return Effect.succeed(taskCliFailureEnvelope("check", "internal_error", message));
      }),
    );
    return yield* finishTaskCliEnvelope(finalizeEnvelope);
  });

export const taskProgressCommand = Command.make("progress", {
  target: Argument.string("target"),
  id: Argument.string("id"),
  status: Flag.string("status").pipe(
    Flag.withDescription("New status: running, completed, or blocked."),
    Flag.optional,
  ),
  summary: Flag.string("summary").pipe(
    Flag.withDescription("Concise progress summary."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Record typed implementation progress for a known phase or work item."),
  Command.withHandler((args) => {
    const target = args.target;
    const id = args.id.trim();
    const status = Option.getOrUndefined(args.status)?.trim();
    const summary = Option.getOrUndefined(args.summary)?.trim();
    if (target !== "phase" && target !== "work-item") {
      return failTaskCliInvalidRequest(
        "Specify `katacode task progress phase <id>` or `katacode task progress work-item <id>`.",
        "progress",
      );
    }
    if (
      !id ||
      !status ||
      (status !== "running" && status !== "completed" && status !== "blocked") ||
      !summary
    ) {
      return failTaskCliInvalidRequest(
        "Progress requires --status running|completed|blocked and --summary <text>.",
        "progress",
      );
    }
    return runProgress({ target, id, status, summary });
  }),
);

export const taskCheckRunCommand = Command.make("run", {
  checkId: Argument.string("check-id"),
}).pipe(
  Command.withDescription("Run an approved automated check in the canonical task worktree."),
  Command.withHandler((args) => runCheck(args.checkId.trim())),
  Command.provide(TaskCheckExecutorLive.pipe(Layer.provide(ProcessRunner.layer))),
);

export const taskCheckCommand = Command.make("check").pipe(
  Command.withDescription("Run approved implementation checks."),
  Command.withSubcommands([taskCheckRunCommand]),
);

export const taskAmendmentProposeCommand = Command.make("propose", {
  phase: Flag.string("phase"),
  workItem: Flag.string("work-item"),
  check: Flag.string("check").pipe(Flag.optional),
  expected: Flag.string("expected"),
  found: Flag.string("found"),
  impact: Flag.string("impact"),
  input: Flag.string("input").pipe(
    Flag.withDescription("Path to the structural Plan diff Markdown, or - to read stdin."),
  ),
}).pipe(
  Command.withDescription("Propose a Plan amendment for human review."),
  Command.withHandler((flags) => {
    const phaseId = flags.phase.trim();
    const workItemId = flags.workItem.trim();
    const triggeringCheckId = Option.getOrUndefined(flags.check)?.trim() ?? null;
    const expected = flags.expected.trim();
    const found = flags.found.trim();
    const impact = flags.impact.trim();
    const artifactFile = flags.input.trim();
    if (!phaseId || !workItemId || !expected || !found || !impact || !artifactFile) {
      return failTaskCliInvalidRequest(
        "Amendment propose requires --phase, --work-item, --expected, --found, --impact, and --input <file|->.",
        "amendment",
      );
    }
    return runAmendment({
      phaseId,
      workItemId,
      triggeringCheckId,
      expected,
      found,
      impact,
      artifactFile,
    });
  }),
);

export const taskAmendmentCommand = Command.make("amendment").pipe(
  Command.withDescription("Propose Plan amendments during implementation."),
  Command.withSubcommands([taskAmendmentProposeCommand]),
);

export const taskCliRuntimeLayer = FetchHttpClient.layer;

export const taskCommand = Command.make("task").pipe(
  Command.withDescription("Run provider-facing Task workflow commands."),
  Command.withHandler(() => failTaskCliInvalidRequest(TASK_CLI_COMMANDS_REQUIRED_MESSAGE)),
  Command.withSubcommands([
    taskContextCommand,
    taskProgressCommand,
    taskCheckCommand,
    taskAmendmentCommand,
    taskCompleteCommand,
  ]),
  Command.provide(taskCliRuntimeLayer),
);
