import {
  EnvironmentHttpApi,
  TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY,
  TaskCliAmendmentRequest,
  TaskCliCheckBeginRequest,
  TaskCliCheckFinalizeRequest,
  TaskCliCompleteRequest,
  TaskCliProgressRequest,
  type TaskCliAmendmentEnvelope as TaskCliAmendmentEnvelopeValue,
  type TaskCliCheckBeginEnvelope as TaskCliCheckBeginEnvelopeValue,
  type TaskCliCheckFinalizeEnvelope as TaskCliCheckFinalizeEnvelopeValue,
  type TaskCliCompleteEnvelope as TaskCliCompleteEnvelopeValue,
  type TaskCliContextEnvelope as TaskCliContextEnvelopeValue,
  type TaskCliOperation,
  type TaskCliProgressEnvelope as TaskCliProgressEnvelopeValue,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { annotateEnvironmentRequest } from "../auth/http.ts";
import {
  taskCliAmendmentSuccessEnvelope,
  taskCliCheckBeginSuccessEnvelope,
  taskCliCheckFinalizeSuccessEnvelope,
  taskCliCompleteSuccessEnvelope,
  taskCliContextSuccessEnvelope,
  taskCliFailureEnvelope,
  taskCliProgressSuccessEnvelope,
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
const decodeProgressRequest = Schema.decodeUnknownEffect(TaskCliProgressRequest);
const decodeCheckBeginRequest = Schema.decodeUnknownEffect(TaskCliCheckBeginRequest);
const decodeCheckFinalizeRequest = Schema.decodeUnknownEffect(TaskCliCheckFinalizeRequest);
const decodeAmendmentRequest = Schema.decodeUnknownEffect(TaskCliAmendmentRequest);

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
      )
      .handle(
        "progress",
        Effect.fn("environment.taskCli.progress")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* appendTaskCliResponseHeaders;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const rejected = identityRejection("progress", request, args.payload);
          if (rejected) return rejected satisfies TaskCliProgressEnvelopeValue;
          const token = tokenFromHeaders(request);
          if (!token)
            return unauthorizedEnvelope("progress") satisfies TaskCliProgressEnvelopeValue;
          const decoded = yield* decodeProgressRequest(args.payload).pipe(
            Effect.catch(() =>
              Effect.succeed<typeof TaskCliProgressRequest.Type | undefined>(undefined),
            ),
          );
          if (!decoded) {
            return taskCliFailureEnvelope(
              "progress",
              "invalid_request",
              "Progress requests require a target (phase or work-item), id, status, and summary.",
            ) satisfies TaskCliProgressEnvelopeValue;
          }
          return yield* invocations
            .progress({
              token,
              target: decoded.target,
              id: decoded.id,
              status: decoded.status,
              summary: decoded.summary,
            })
            .pipe(
              Effect.map((ack) => taskCliProgressSuccessEnvelope(ack)),
              Effect.catchTag("TaskInvocationError", (error) =>
                Effect.succeed(taskCliFailureEnvelope("progress", error.code, error.message)),
              ),
            );
        }),
      )
      .handle(
        "checkBegin",
        Effect.fn("environment.taskCli.checkBegin")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* appendTaskCliResponseHeaders;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const rejected = identityRejection("check", request, args.payload);
          if (rejected) return rejected satisfies TaskCliCheckBeginEnvelopeValue;
          const token = tokenFromHeaders(request);
          if (!token) return unauthorizedEnvelope("check") satisfies TaskCliCheckBeginEnvelopeValue;
          const decoded = yield* decodeCheckBeginRequest(args.payload).pipe(
            Effect.catch(() =>
              Effect.succeed<typeof TaskCliCheckBeginRequest.Type | undefined>(undefined),
            ),
          );
          if (!decoded) {
            return taskCliFailureEnvelope(
              "check",
              "invalid_request",
              "Check begin requests require a known check id.",
            ) satisfies TaskCliCheckBeginEnvelopeValue;
          }
          return yield* invocations.checkBegin({ token, checkId: decoded.checkId }).pipe(
            Effect.map((result) => taskCliCheckBeginSuccessEnvelope(result)),
            Effect.catchTag("TaskInvocationError", (error) =>
              Effect.succeed(taskCliFailureEnvelope("check", error.code, error.message)),
            ),
          );
        }),
      )
      .handle(
        "checkFinalize",
        Effect.fn("environment.taskCli.checkFinalize")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* appendTaskCliResponseHeaders;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const rejected = identityRejection("check", request, args.payload);
          if (rejected) return rejected satisfies TaskCliCheckFinalizeEnvelopeValue;
          // The finalizer token is the credential for finalization; the request
          // carries no invocation identity and no bearer token.
          const decoded = yield* decodeCheckFinalizeRequest(args.payload).pipe(
            Effect.catch(() =>
              Effect.succeed<typeof TaskCliCheckFinalizeRequest.Type | undefined>(undefined),
            ),
          );
          if (!decoded) {
            return taskCliFailureEnvelope(
              "check",
              "invalid_request",
              "Check finalize requests require a finalizer token and observed result.",
            ) satisfies TaskCliCheckFinalizeEnvelopeValue;
          }
          return yield* invocations.checkFinalize(decoded).pipe(
            Effect.map((result) => taskCliCheckFinalizeSuccessEnvelope(result)),
            Effect.catchTag("TaskInvocationError", (error) =>
              Effect.succeed(taskCliFailureEnvelope("check", error.code, error.message)),
            ),
          );
        }),
      )
      .handle(
        "amendment",
        Effect.fn("environment.taskCli.amendment")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* appendTaskCliResponseHeaders;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const rejected = identityRejection("amendment", request, args.payload);
          if (rejected) return rejected satisfies TaskCliAmendmentEnvelopeValue;
          const token = tokenFromHeaders(request);
          if (!token)
            return unauthorizedEnvelope("amendment") satisfies TaskCliAmendmentEnvelopeValue;
          const decoded = yield* decodeAmendmentRequest(args.payload).pipe(
            Effect.catch(() =>
              Effect.succeed<typeof TaskCliAmendmentRequest.Type | undefined>(undefined),
            ),
          );
          if (!decoded) {
            return taskCliFailureEnvelope(
              "amendment",
              "invalid_request",
              "Amendment requests require phase, work item, expected, found, impact, and proposed Plan markdown.",
            ) satisfies TaskCliAmendmentEnvelopeValue;
          }
          return yield* invocations
            .amendmentPropose({
              token,
              phaseId: decoded.phaseId,
              workItemId: decoded.workItemId,
              triggeringCheckId: decoded.triggeringCheckId,
              expected: decoded.expected,
              found: decoded.found,
              impact: decoded.impact,
              proposedPlanMarkdown: decoded.proposedPlanMarkdown,
            })
            .pipe(
              Effect.map((ack) => taskCliAmendmentSuccessEnvelope(ack)),
              Effect.catchTag("TaskInvocationError", (error) =>
                Effect.succeed(taskCliFailureEnvelope("amendment", error.code, error.message)),
              ),
            );
        }),
      );
  }),
);
