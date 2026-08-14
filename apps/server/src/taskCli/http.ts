import {
  EnvironmentHttpApi,
  TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY,
  type TaskCliContextEnvelope as TaskCliContextEnvelopeValue,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { annotateEnvironmentRequest } from "../auth/http.ts";
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

const identityQueryKey = (url: string): string | undefined => {
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return undefined;
  const params = new URLSearchParams(url.slice(queryIndex + 1));
  for (const key of params.keys()) {
    if (TASK_CLI_IDENTITY_QUERY_KEYS.has(key.toLowerCase())) return key;
  }
  return undefined;
};

const rejectIdentityPayload = (request: HttpServerRequest.HttpServerRequest) => {
  const queryKey = identityQueryKey(request.url);
  if (queryKey !== undefined) {
    return {
      protocol: "task-cli@1",
      ok: false,
      operation: "context",
      error: {
        code: "invalid_request" as const,
        message: `Context requests accept no identity flags or identity payload fields (${queryKey}).`,
      },
    } satisfies TaskCliContextEnvelopeValue;
  }
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return {
      protocol: "task-cli@1",
      ok: false,
      operation: "context",
      error: {
        code: "invalid_request" as const,
        message: "Context requests accept no identity flags or identity payload fields.",
      },
    } satisfies TaskCliContextEnvelopeValue;
  }
  return undefined;
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
        const identityRejection = rejectIdentityPayload(request);
        if (identityRejection) {
          return identityRejection;
        }
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
