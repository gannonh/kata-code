import {
  EnvironmentHttpApi,
  EnvironmentHttpInternalServerError,
  TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY,
  TaskCliContextEnvelope,
  type TaskCliContextEnvelope as TaskCliContextEnvelopeValue,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { annotateEnvironmentRequest } from "../auth/http.ts";
import { TaskInvocationError, TaskInvocationService } from "./TaskInvocationService.ts";

const TASK_CLI_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
} as const;

const appendTaskCliResponseHeaders = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeaders(response, TASK_CLI_RESPONSE_HEADERS)),
);

const tokenFromHeaders = (request: HttpServerRequest.HttpServerRequest): string | undefined => {
  const authorization = request.headers.authorization;
  const match = /^(?:Bearer)\s+(.+)$/iu.exec(authorization ?? "");
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
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
        yield* appendTaskCliResponseHeaders;
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
