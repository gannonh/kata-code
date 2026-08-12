import {
  EnvironmentHttpApi,
  EnvironmentHttpInternalServerError,
  TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY,
  TaskCliContextEnvelope,
  type TaskCliContextEnvelope as TaskCliContextEnvelopeValue,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";

import { annotateEnvironmentRequest } from "../auth/http.ts";
import { TaskInvocationError, TaskInvocationService } from "./TaskInvocationService.ts";

const tokenFromHeaders = (request: HttpServerRequest.HttpServerRequest): string | undefined => {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
};

export const taskCliHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "taskCli",
  Effect.fnUntraced(function* (handlers) {
    const invocations = yield* TaskInvocationService;
    return handlers.handle(
      "context",
      Effect.fn("environment.taskCli.context")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        const request = yield* HttpServerRequest.HttpServerRequest;
        const token = tokenFromHeaders(request);
        if (!token) {
          return {
            protocol: "task-cli@1",
            ok: false,
            operation: "context",
            error: {
              code: "unauthorized",
              message: `Set ${TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY} or provide an Authorization bearer token.`,
            },
          } satisfies TaskCliContextEnvelopeValue;
        }
        return yield* invocations.resolve(token).pipe(
          Effect.map(
            (resolved) =>
              ({
                protocol: "task-cli@1",
                ok: true,
                operation: "context",
                context: resolved.context,
              }) satisfies TaskCliContextEnvelopeValue,
          ),
          Effect.catchTag("TaskInvocationError", (error) =>
            Effect.succeed({
              protocol: "task-cli@1",
              ok: false,
              operation: "context",
              error: { code: error.code, message: error.message },
            } satisfies TaskCliContextEnvelopeValue),
          ),
        );
      }),
    );
  }),
);
