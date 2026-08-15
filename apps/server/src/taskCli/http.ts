import {
  EnvironmentHttpApi,
  TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY,
  TaskCliCompleteRequest,
  type TaskCliCompleteEnvelope as TaskCliCompleteEnvelopeValue,
  type TaskCliContextEnvelope as TaskCliContextEnvelopeValue,
  type TaskCliOperation,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { annotateEnvironmentRequest } from "../auth/http.ts";
import {
  taskCliCompleteSuccessEnvelope,
  taskCliContextSuccessEnvelope,
  taskCliFailureEnvelope,
} from "./envelope.ts";
import { TaskInvocationService } from "./TaskInvocationService.ts";

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

const TASK_CLI_IDENTITY_QUERY_KEYS = new Set([
  "taskid",
  "task-id",
  "threadid",
  "thread-id",
  "occurrence",
  "provider",
  "session",
  "turn",
  "turnid",
  "turn-id",
  "providerinstanceid",
  "provider-instance-id",
  "task",
]);

const TASK_CLI_IDENTITY_BODY_KEYS = new Set([
  "taskid",
  "task-id",
  "task_id",
  "threadid",
  "thread-id",
  "thread_id",
  "occurrence",
  "provider",
  "session",
  "turn",
  "turnid",
  "turn-id",
  "turn_id",
  "providerinstanceid",
  "provider-instance-id",
  "provider_instance_id",
  "task",
]);

const identityQueryKey = (url: string): string | undefined => {
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return undefined;
  const params = new URLSearchParams(url.slice(queryIndex + 1));
  for (const key of params.keys()) {
    if (TASK_CLI_IDENTITY_QUERY_KEYS.has(key.toLowerCase())) return key;
  }
  return undefined;
};

const identityBodyKey = (payload: unknown): string | undefined => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  for (const key of Object.keys(payload)) {
    if (TASK_CLI_IDENTITY_BODY_KEYS.has(key.toLowerCase())) return key;
  }
  return undefined;
};

const identityRejection = (
  operation: TaskCliOperation,
  request: HttpServerRequest.HttpServerRequest,
  payload?: unknown,
) => {
  const queryKey = identityQueryKey(request.url);
  if (queryKey !== undefined) {
    return taskCliFailureEnvelope(
      operation,
      "invalid_request",
      `Task CLI requests accept no identity flags or identity payload fields (${queryKey}).`,
    );
  }
  const bodyKey = identityBodyKey(payload);
  if (bodyKey !== undefined) {
    return taskCliFailureEnvelope(
      operation,
      "invalid_request",
      `Task CLI requests accept no identity flags or identity payload fields (${bodyKey}).`,
    );
  }
  return undefined;
};

const unauthorizedEnvelope = (operation: TaskCliOperation) =>
  taskCliFailureEnvelope(
    operation,
    "unauthorized",
    `Set ${TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY} or provide an Authorization bearer token.`,
  );

const decodeCompleteRequest = Schema.decodeUnknownEffect(TaskCliCompleteRequest);

export const taskCliHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "taskCli",
  Effect.fnUntraced(function* (handlers) {
    const invocations = yield* TaskInvocationService;
    return handlers
      .handle(
        "context",
        Effect.fn("environment.taskCli.context")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* appendTaskCliResponseHeaders;
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
            return taskCliFailureEnvelope(
              "context",
              "invalid_request",
              "Task CLI requests accept no identity flags or identity payload fields.",
            ) satisfies TaskCliContextEnvelopeValue;
          }
          const rejected = identityRejection("context", request);
          if (rejected) return rejected satisfies TaskCliContextEnvelopeValue;
          const token = tokenFromHeaders(request);
          if (!token) return unauthorizedEnvelope("context") satisfies TaskCliContextEnvelopeValue;
          return yield* invocations.resolve(token).pipe(
            Effect.map((resolved) => taskCliContextSuccessEnvelope(resolved.context)),
            Effect.catchTag("TaskInvocationError", (error) =>
              Effect.succeed(taskCliFailureEnvelope("context", error.code, error.message)),
            ),
          );
        }),
      )
      .handle(
        "complete",
        Effect.fn("environment.taskCli.complete")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* appendTaskCliResponseHeaders;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const rejected = identityRejection("complete", request, args.payload);
          if (rejected) return rejected satisfies TaskCliCompleteEnvelopeValue;
          const token = tokenFromHeaders(request);
          if (!token)
            return unauthorizedEnvelope("complete") satisfies TaskCliCompleteEnvelopeValue;
          const decoded = yield* decodeCompleteRequest(args.payload).pipe(
            Effect.catch(() =>
              Effect.succeed<typeof TaskCliCompleteRequest.Type | undefined>(undefined),
            ),
          );
          if (!decoded) {
            return taskCliFailureEnvelope(
              "complete",
              "invalid_request",
              "Complete requests require summary and artifact Markdown.",
            ) satisfies TaskCliCompleteEnvelopeValue;
          }
          return yield* invocations
            .complete({
              token,
              summary: decoded.summary,
              markdown: decoded.markdown,
            })
            .pipe(
              Effect.map((completion) => taskCliCompleteSuccessEnvelope(completion)),
              Effect.catchTag("TaskInvocationError", (error) =>
                Effect.succeed(taskCliFailureEnvelope("complete", error.code, error.message)),
              ),
            );
        }),
      );
  }),
);
