/**
 * ProviderServiceLive - Cross-provider orchestration layer.
 *
 * Routes validated transport/API calls to provider adapters through
 * `ProviderAdapterRegistry` and `ProviderSessionDirectory`, and exposes a
 * unified provider event stream for subscribers.
 *
 * It does not implement provider protocol details (adapter concern).
 *
 * @module ProviderServiceLive
 */
import {
  ModelSelection,
  NonNegativeInt,
  ThreadId,
  TurnId,
  ProviderCompactThreadInput,
  ProviderInterruptTurnInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  TASK_CLI_ENDPOINT_ENVIRONMENT_KEY,
  TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY,
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderSessionEnvironment,
} from "@kata-sh/code-contracts";
import { HostProcessPlatform } from "@kata-sh/code-shared/hostProcess";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { HttpServer as HttpServerService } from "effect/unstable/http/HttpServer";

import {
  increment,
  providerMetricAttributes,
  providerRuntimeEventsTotal,
  providerSessionsTotal,
  providerTurnDuration,
  providerTurnsTotal,
  providerTurnMetricAttributes,
  withMetrics,
} from "../../observability/Metrics.ts";
import { type ProviderAdapterError, ProviderValidationError } from "../Errors.ts";
import { ServerConfig } from "../../config.ts";
import { ServerEnvironment } from "../../environment/Services/ServerEnvironment.ts";
import { readPersistedServerRuntimeState } from "../../serverRuntimeState.ts";
import { TaskInvocationService } from "../../taskCli/TaskInvocationService.ts";
import {
  ensureTaskCliInvocationPath,
  resolveTaskCliLaunchTarget,
} from "../../taskCli/taskCliInvocationPath.ts";
import {
  supportsTaskWorktreeWrite,
  type ProviderAdapterShape,
} from "../Services/ProviderAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../Services/ProviderSessionDirectory.ts";
import { type EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { ProviderEventLoggers } from "./ProviderEventLoggers.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";
import {
  activeTaskProviderContextForThread,
  activeTaskStageForThread,
  isActiveTaskThread,
  validateActiveTaskTurn,
  type ActiveTaskProviderContext,
} from "../../taskWorkspace/TaskWorkspaceService.ts";
import type { TaskWorkspaceStage } from "@kata-sh/code-contracts";
// @effect-diagnostics nodeBuiltinImport:off - provider CLI executable discovery uses the launch path.
import { randomUUID } from "node:crypto";
import { trustedInstructionsForStage } from "../../taskWorkspace/taskStageInstructions.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";
import { redactProviderEvent } from "../providerSecretRedaction.ts";
const isModelSelection = Schema.is(ModelSelection);

/**
 * Hook for tests that want to override the canonical event logger pulled
 * from `ProviderEventLoggers`. Production wiring leaves this undefined and
 * reads the logger off the tag.
 */
export interface ProviderServiceLiveOptions {
  readonly canonicalEventLogger?: EventNdjsonLogger;
}

const ProviderRollbackConversationInput = Schema.Struct({
  threadId: ThreadId,
  numTurns: NonNegativeInt,
});

function toValidationError(
  operation: string,
  issue: string,
  cause?: unknown,
): ProviderValidationError {
  return new ProviderValidationError({
    operation,
    issue,
    ...(cause !== undefined ? { cause } : {}),
  });
}

/**
 * Reject a provider operation on an active Build task when the requested
 * provider instance is not the instance pinned by the task's model selection.
 * Non-build task stages and non-task threads pass through unchanged. Exposed
 * separately so Build-stage entry points share one guard and the rejection is
 * testable.
 */
export const assertPinnedToActiveBuildTask = (input: {
  readonly operation: string;
  readonly activeTaskStage: TaskWorkspaceStage | undefined;
  readonly activeTaskContext: Pick<ActiveTaskProviderContext, "providerInstanceId"> | undefined;
  readonly providerInstanceId: ProviderInstanceId;
}): Effect.Effect<void, ProviderValidationError> => {
  if (input.activeTaskStage !== "build") return Effect.void;
  if (!input.activeTaskContext) {
    return toValidationError(
      input.operation,
      "The active Build task has no canonical worktree/provider profile.",
    );
  }
  if (input.activeTaskContext.providerInstanceId !== input.providerInstanceId) {
    return toValidationError(
      input.operation,
      "The requested provider instance is not pinned to the active Build task.",
    );
  }
  return Effect.void;
};

const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string;
  readonly schema: S;
  readonly payload: unknown;
}) => {
  const decodeProviderRequestInput = Schema.decodeUnknownEffect(input.schema);
  return decodeProviderRequestInput(input.payload).pipe(
    Effect.mapError(
      (schemaError) =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        }),
    ),
  );
};

export function normalizeTaskStageInteractionMode(input: {
  readonly isTaskStage: boolean;
  readonly interactionMode?: "default" | "plan";
}): "default" | "plan" | undefined {
  return input.isTaskStage ? "default" : input.interactionMode;
}

function toRuntimeStatus(session: ProviderSession): "starting" | "running" | "stopped" | "error" {
  switch (session.status) {
    case "connecting":
      return "starting";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    case "running":
    default:
      return "running";
  }
}

function toRuntimePayloadFromSession(
  session: ProviderSession,
  extra?: {
    readonly modelSelection?: unknown;
    readonly developerInstructions?: string;
    readonly lastRuntimeEvent?: string;
    readonly lastRuntimeEventAt?: string;
  },
): Record<string, unknown> {
  return {
    cwd: session.cwd ?? null,
    model: session.model ?? null,
    activeTurnId: session.activeTurnId ?? null,
    lastError: session.lastError ?? null,
    ...(extra?.modelSelection !== undefined ? { modelSelection: extra.modelSelection } : {}),
    ...(extra?.developerInstructions !== undefined
      ? { developerInstructions: extra.developerInstructions }
      : {}),
    ...(extra?.lastRuntimeEvent !== undefined ? { lastRuntimeEvent: extra.lastRuntimeEvent } : {}),
    ...(extra?.lastRuntimeEventAt !== undefined
      ? { lastRuntimeEventAt: extra.lastRuntimeEventAt }
      : {}),
  };
}

function readPersistedModelSelection(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ModelSelection | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const raw = "modelSelection" in runtimePayload ? runtimePayload.modelSelection : undefined;
  return isModelSelection(raw) ? raw : undefined;
}

function readPersistedCwd(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const rawCwd = "cwd" in runtimePayload ? runtimePayload.cwd : undefined;
  if (typeof rawCwd !== "string") return undefined;
  const trimmed = rawCwd.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPersistedDeveloperInstructions(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const rawInstructions =
    "developerInstructions" in runtimePayload ? runtimePayload.developerInstructions : undefined;
  if (typeof rawInstructions !== "string") return undefined;
  const trimmed = rawInstructions.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const dieOnMissingBindingInstanceId = (
  operation: string,
  payload: {
    readonly providerInstanceId?: ProviderInstanceId | undefined;
    readonly provider?: ProviderDriverKind | undefined;
  },
): ProviderInstanceId => {
  if (payload.providerInstanceId !== undefined) {
    return payload.providerInstanceId;
  }
  throw new Error(
    payload.provider
      ? `${operation}: provider instance id is required for provider '${payload.provider}'.`
      : `${operation}: provider instance id is required.`,
  );
};

const correlateRuntimeEventWithInstance = (
  source: {
    readonly instanceId: ProviderInstanceId;
    readonly provider: ProviderDriverKind;
  },
  event: ProviderRuntimeEvent,
): ProviderRuntimeEvent => {
  if (event.provider !== source.provider) {
    throw new Error(
      `ProviderService.streamEvents: provider instance '${source.instanceId}' is backed by driver '${source.provider}' but emitted driver '${event.provider}'.`,
    );
  }
  if (event.providerInstanceId !== undefined && event.providerInstanceId !== source.instanceId) {
    throw new Error(
      `ProviderService.streamEvents: provider instance '${source.instanceId}' emitted event for instance '${event.providerInstanceId}'.`,
    );
  }
  return { ...event, providerInstanceId: source.instanceId };
};

const makeProviderService = Effect.fn("makeProviderService")(function* (
  options?: ProviderServiceLiveOptions,
) {
  const analytics = yield* Effect.service(AnalyticsService);
  const eventLoggers = yield* ProviderEventLoggers;
  // Options-provided logger wins (test overrides); otherwise we take whatever
  // the `ProviderEventLoggers` tag exposes — `undefined` means "no canonical
  // log writer is attached", which downstream code already handles as a
  // no-op.
  const canonicalEventLogger = options?.canonicalEventLogger ?? eventLoggers.canonical;

  const registry = yield* ProviderAdapterRegistry;
  const directory = yield* ProviderSessionDirectory;
  const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const taskTurnWatchdogs = new Map<ThreadId, Fiber.Fiber<void, never>>();
  const taskTurnCredentials = new Map<
    ThreadId,
    {
      readonly token: string;
      readonly providerInstanceId: ProviderInstanceId;
      readonly sessionGeneration: string;
      readonly leaseTurnId: TurnId;
      readonly environment: ProviderSessionEnvironment;
      readonly providerTurnId?: TurnId;
    }
  >();
  const isSessionInjectedTaskCliGeneration = (generation: string) =>
    generation === "session-pending" || generation === "recovery-pending";
  const reuseSessionInjectedTaskCliEnvironment = (input: {
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
  }) => {
    const existing = taskTurnCredentials.get(input.threadId);
    if (
      existing === undefined ||
      existing.providerInstanceId !== input.providerInstanceId ||
      !isSessionInjectedTaskCliGeneration(existing.sessionGeneration)
    ) {
      return undefined;
    }
    return {
      token: existing.token,
      leaseTurnId: existing.leaseTurnId,
      environment: existing.environment,
    } as const;
  };
  const mcpRotationLocksRef = yield* SynchronizedRef.make(
    new Map<string, { readonly semaphore: Semaphore.Semaphore; readonly users: number }>(),
  );
  const acquireMcpRotationLock = (threadId: ThreadId) =>
    SynchronizedRef.modifyEffect(mcpRotationLocksRef, (current) => {
      const key = String(threadId);
      const existing = current.get(key);
      if (existing) {
        const next = new Map(current);
        next.set(key, { ...existing, users: existing.users + 1 });
        return Effect.succeed([existing.semaphore, next] as const);
      }
      return Semaphore.make(1).pipe(
        Effect.map((semaphore) => {
          const next = new Map(current);
          next.set(key, { semaphore, users: 1 });
          return [semaphore, next] as const;
        }),
      );
    });
  const releaseMcpRotationLock = (threadId: ThreadId) =>
    SynchronizedRef.update(mcpRotationLocksRef, (current) => {
      const key = String(threadId);
      const existing = current.get(key);
      if (!existing) return current;
      const next = new Map(current);
      if (existing.users <= 1) next.delete(key);
      else next.set(key, { ...existing, users: existing.users - 1 });
      return next;
    });
  const withMcpRotationLock = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const semaphore = yield* acquireMcpRotationLock(threadId);
      return yield* semaphore
        .withPermit(effect)
        .pipe(Effect.ensuring(releaseMcpRotationLock(threadId)));
    });
  yield* Effect.addFinalizer(() =>
    Effect.forEach(taskTurnWatchdogs.values(), Fiber.interrupt, {
      concurrency: "unbounded",
      discard: true,
    }),
  );
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const hostPlatform = yield* HostProcessPlatform;
  const serverConfigForCli = yield* Effect.serviceOption(ServerConfig);
  const taskCliInvocationPath = Option.match(serverConfigForCli, {
    onNone: () => ({
      executablePath: resolveTaskCliLaunchTarget().entry,
      pathPrepend: [] as const,
    }),
    onSome: (config) =>
      ensureTaskCliInvocationPath({ stateDir: config.stateDir, platform: hostPlatform }),
  });
  const resolvedTaskCliExecutable = taskCliInvocationPath.executablePath;
  const taskCliEnvironmentForTurn = (input: {
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
  }): Effect.Effect<
    | {
        readonly environment: ProviderSessionEnvironment;
        readonly token: string;
        readonly leaseTurnId: TurnId;
      }
    | undefined,
    ProviderValidationError
  > =>
    Effect.gen(function* () {
      const taskInvocations = yield* Effect.serviceOption(TaskInvocationService);
      const serverEnvironment = yield* Effect.serviceOption(ServerEnvironment);
      const serverConfig = yield* Effect.serviceOption(ServerConfig);
      const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);
      const httpServer = yield* Effect.serviceOption(HttpServerService);
      if (Option.isNone(taskInvocations) || Option.isNone(serverEnvironment)) {
        return undefined;
      }
      const environmentId = yield* serverEnvironment.value.getEnvironmentId;
      const endpoint = yield* Effect.gen(function* () {
        if (Option.isSome(httpServer) && httpServer.value.address._tag === "TcpAddress") {
          return `http://127.0.0.1:${httpServer.value.address.port}`;
        }
        if (Option.isSome(serverConfig) && Option.isSome(fileSystem)) {
          const state = yield* readPersistedServerRuntimeState(
            serverConfig.value.serverRuntimeStatePath,
          ).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem.value),
            Effect.orElseSucceed(() => Option.none()),
          );
          if (Option.isSome(state)) {
            return state.value.origin;
          }
        }
        if (Option.isSome(serverConfig) && serverConfig.value.port > 0) {
          return `http://127.0.0.1:${serverConfig.value.port}`;
        }
        return undefined;
      });
      if (!endpoint) {
        return yield* toValidationError(
          "ProviderService.taskCliEnvironment",
          "The Task CLI endpoint is unavailable because the server is not listening.",
        );
      }
      const leaseTurnId = TurnId.make(`pending-task-cli-${randomUUID()}`);
      const issued = yield* taskInvocations.value.issue({
        environmentId,
        threadId: input.threadId,
        providerInstanceId: input.providerInstanceId,
        providerTurnId: leaseTurnId,
      });
      return {
        token: issued.token,
        leaseTurnId,
        environment: {
          variables: {
            [TASK_CLI_ENDPOINT_ENVIRONMENT_KEY]: endpoint,
            [TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY]: issued.token,
          },
          executablePath: resolvedTaskCliExecutable,
          pathPrepend: [...taskCliInvocationPath.pathPrepend],
        },
      };
    }).pipe(
      Effect.catchTag("TaskInvocationError", (error) =>
        error.code === "not_active" ? Effect.succeed(undefined) : Effect.fail(error),
      ),
      Effect.mapError((cause) =>
        toValidationError(
          "ProviderService.taskCliEnvironment",
          cause instanceof Error && "message" in cause
            ? String(cause.message)
            : "Failed to prepare Task CLI invocation environment.",
          cause,
        ),
      ),
    );

  const mergeSessionEnvironments = (
    base: ProviderSessionEnvironment | undefined,
    task: ProviderSessionEnvironment | undefined,
  ): ProviderSessionEnvironment | undefined => {
    if (!base) return task;
    if (!task) return base;
    return {
      variables: { ...base.variables, ...task.variables },
      executablePath: task.executablePath ?? base.executablePath,
      pathPrepend: [...task.pathPrepend, ...base.pathPrepend],
    };
  };
  const revokeTaskCredential = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const credential = taskTurnCredentials.get(threadId);
      const taskInvocations = yield* Effect.serviceOption(TaskInvocationService);
      if (!credential || Option.isNone(taskInvocations)) return;
      const turnIds = [credential.leaseTurnId, credential.providerTurnId].filter(
        (turnId, index, values): turnId is TurnId =>
          turnId !== undefined && values.indexOf(turnId) === index,
      );
      yield* Effect.forEach(
        turnIds,
        (providerTurnId) => taskInvocations.value.revokeTurn({ threadId, providerTurnId }),
        { discard: true },
      ).pipe(Effect.ignore);
      taskTurnCredentials.delete(threadId);
    });
  const markTaskTurnPending = (input: {
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
    readonly turnId: TurnId;
  }) =>
    Effect.gen(function* () {
      const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));
      if (!binding) return;
      const runtimePayload =
        binding.runtimePayload &&
        typeof binding.runtimePayload === "object" &&
        !Array.isArray(binding.runtimePayload)
          ? binding.runtimePayload
          : {};
      yield* directory.upsert({
        ...binding,
        providerInstanceId: input.providerInstanceId,
        status: "running",
        runtimePayload: {
          ...runtimePayload,
          activeTurnId: input.turnId,
          lastRuntimeEvent: "provider.task-cli.lease",
          lastRuntimeEventAt: yield* nowIso,
        },
      });
    });
  const prepareMcpSession = (
    threadId: ThreadId,
    providerInstanceId: ProviderInstanceId,
    taskStage: boolean,
  ) =>
    Effect.gen(function* () {
      // Native provider runtimes capture the MCP authorization header when a
      // session starts. Reuse a live thread-bound lease and rotate an expired
      // one so the caller can restart the native session with the new header.
      const existing = McpProviderSession.readMcpProviderSession(threadId);
      const activeStage = taskStage ? yield* activeTaskStageForThread(threadId) : undefined;
      if (existing?.providerInstanceId === providerInstanceId) {
        if (!McpSessionRegistry.hasActiveMcpSessionRegistry()) {
          McpProviderSession.clearMcpProviderSession(threadId);
          return { rotated: false } as const;
        }
        const scope = yield* McpSessionRegistry.resolveActiveMcpCredential(
          existing.authorizationHeader,
        );
        if (
          scope?.threadId === threadId &&
          scope.providerInstanceId === providerInstanceId &&
          (!taskStage || activeStage !== "build" || scope.capabilities.has("task-implementation"))
        ) {
          return { rotated: false } as const;
        }
      }

      if (existing) {
        McpProviderSession.clearMcpProviderSession(threadId);
      }
      const credential = yield* McpSessionRegistry.issueActiveMcpCredential({
        threadId,
        providerInstanceId,
      });
      if (!credential) {
        return { rotated: false } as const;
      }
      McpProviderSession.setMcpProviderSession(credential.config);
      return { rotated: true } as const;
    });
  const clearMcpSession = (threadId: ThreadId) =>
    McpSessionRegistry.revokeActiveMcpThread(threadId).pipe(
      Effect.tap(() => Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId))),
    );
  const publishRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Effect.gen(function* () {
      const safeEvent = redactProviderEvent(event);
      if (
        event.type === "turn.completed" ||
        event.type === "turn.aborted" ||
        event.type === "runtime.error" ||
        event.type === "session.exited"
      ) {
        const taskInvocations = yield* Effect.serviceOption(TaskInvocationService);
        const credential = taskTurnCredentials.get(safeEvent.threadId);
        if (Option.isSome(taskInvocations)) {
          if (event.turnId !== undefined) {
            yield* taskInvocations.value
              .revokeTurn({
                threadId: event.threadId,
                providerTurnId: event.turnId,
              })
              .pipe(Effect.ignore);
          } else if (
            (event.type === "runtime.error" || event.type === "session.exited") &&
            credential !== undefined &&
            (event.providerInstanceId === undefined ||
              event.providerInstanceId === credential.providerInstanceId) &&
            (event.sessionGeneration === undefined ||
              event.sessionGeneration === credential.sessionGeneration)
          ) {
            // A lifecycle event without a turn id is only authoritative when
            // it identifies the currently tracked provider instance. Old
            // replacement-session exits must not revoke the fresh lease.
            yield* taskInvocations.value.revokeThread(event.threadId).pipe(Effect.ignore);
          }
        }
        const eventMatchesCredential =
          credential !== undefined &&
          (safeEvent.turnId === undefined ||
            safeEvent.turnId === credential.leaseTurnId ||
            safeEvent.turnId === credential.providerTurnId) &&
          (safeEvent.providerInstanceId === undefined ||
            safeEvent.providerInstanceId === credential.providerInstanceId) &&
          (safeEvent.sessionGeneration === undefined ||
            safeEvent.sessionGeneration === credential.sessionGeneration);
        if (eventMatchesCredential) {
          yield* revokeTaskCredential(safeEvent.threadId);
          const watchdog = taskTurnWatchdogs.get(safeEvent.threadId);
          if (watchdog !== undefined) {
            taskTurnWatchdogs.delete(safeEvent.threadId);
            yield* Fiber.interrupt(watchdog);
          }
        }
      }
      yield* Effect.succeed(safeEvent).pipe(
        Effect.tap((canonicalEvent) =>
          canonicalEventLogger
            ? canonicalEventLogger.write(canonicalEvent, canonicalEvent.threadId)
            : Effect.void,
        ),
        Effect.flatMap((canonicalEvent) => PubSub.publish(runtimeEventPubSub, canonicalEvent)),
      );
    });

  const requireBindingInstanceId = (
    operation: string,
    payload: {
      readonly providerInstanceId?: ProviderInstanceId | undefined;
      readonly provider?: ProviderDriverKind | undefined;
    },
  ): Effect.Effect<ProviderInstanceId, ProviderValidationError> =>
    payload.providerInstanceId !== undefined
      ? Effect.succeed(payload.providerInstanceId)
      : Effect.fail(
          toValidationError(
            operation,
            payload.provider
              ? `Provider instance id is required for provider '${payload.provider}'.`
              : "Provider instance id is required.",
          ),
        );

  const upsertSessionBinding = (
    session: ProviderSession,
    threadId: ThreadId,
    extra?: {
      readonly modelSelection?: unknown;
      readonly developerInstructions?: string;
      readonly lastRuntimeEvent?: string;
      readonly lastRuntimeEventAt?: string;
    },
  ) =>
    Effect.gen(function* () {
      const providerInstanceId = yield* requireBindingInstanceId(
        "ProviderService.upsertSessionBinding",
        session,
      );
      yield* directory.upsert({
        threadId,
        provider: session.provider,
        providerInstanceId,
        runtimeMode: session.runtimeMode,
        status: toRuntimeStatus(session),
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
        runtimePayload: toRuntimePayloadFromSession(session, extra),
      });
    });

  const restartSessionForMcpCredential = Effect.fn("restartSessionForMcpCredential")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly providerInstanceId: ProviderInstanceId;
      readonly developerInstructions?: string;
      readonly environment?: ProviderSessionEnvironment;
      readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
    }) {
      const bindingOption = yield* directory.getBinding(input.threadId);
      const binding = Option.getOrUndefined(bindingOption);
      if (!binding) {
        return yield* toValidationError(
          "ProviderService.restartSessionForMcpCredential",
          `Cannot restart thread '${input.threadId}' because no persisted provider binding exists.`,
        );
      }

      if (yield* input.adapter.hasSession(input.threadId)) {
        yield* input.adapter.stopSession(input.threadId);
      }
      const modelSelection = readPersistedModelSelection(binding.runtimePayload);
      const cwd = readPersistedCwd(binding.runtimePayload);
      const persistedDeveloperInstructions = readPersistedDeveloperInstructions(
        binding.runtimePayload,
      );
      const activeTaskStage = yield* activeTaskStageForThread(input.threadId);
      const activeTaskContext =
        activeTaskStage === "build"
          ? yield* activeTaskProviderContextForThread(input.threadId)
          : undefined;
      yield* assertPinnedToActiveBuildTask({
        operation: "ProviderService.restartSessionForMcpCredential",
        activeTaskStage,
        activeTaskContext,
        providerInstanceId: input.providerInstanceId,
      });
      const taskExecutionProfile = activeTaskStage === "build" ? "task-worktree-write" : "planning";
      const developerInstructions = activeTaskStage
        ? trustedInstructionsForStage(activeTaskStage)
        : (input.developerInstructions ?? persistedDeveloperInstructions);
      const restarted = yield* input.adapter.startSession({
        threadId: input.threadId,
        provider: binding.provider,
        providerInstanceId: input.providerInstanceId,
        ...(activeTaskContext ? { cwd: activeTaskContext.worktreePath } : cwd ? { cwd } : {}),
        ...(activeTaskContext
          ? { modelSelection: activeTaskContext.modelSelection }
          : modelSelection
            ? { modelSelection }
            : {}),
        ...(developerInstructions ? { developerInstructions } : {}),
        ...(input.environment ? { environment: input.environment } : {}),
        taskStage: activeTaskStage === "build",
        taskExecutionProfile,
        ...(activeTaskContext ? { taskWorkspaceRoot: activeTaskContext.workspaceRoot } : {}),
        ...(binding.resumeCursor !== null && binding.resumeCursor !== undefined
          ? { resumeCursor: binding.resumeCursor }
          : {}),
        runtimeMode: activeTaskContext
          ? activeTaskContext.runtimeMode
          : (binding.runtimeMode ?? "full-access"),
      });
      yield* upsertSessionBinding(restarted, input.threadId, {
        ...(modelSelection ? { modelSelection } : {}),
        ...(developerInstructions ? { developerInstructions } : {}),
      });
      return restarted;
    },
  );

  const processRuntimeEvent = (
    source: {
      readonly instanceId: ProviderInstanceId;
      readonly provider: ProviderDriverKind;
    },
    event: ProviderRuntimeEvent,
  ): Effect.Effect<void> =>
    Effect.sync(() => correlateRuntimeEventWithInstance(source, event)).pipe(
      Effect.flatMap((canonicalEvent) =>
        increment(providerRuntimeEventsTotal, {
          provider: canonicalEvent.provider,
          eventType: canonicalEvent.type,
        }).pipe(Effect.andThen(publishRuntimeEvent(canonicalEvent))),
      ),
    );

  // `subscribedAdapters` is our source-of-truth for "which instance adapters
  // are currently wired into the runtime event bus". It both tracks the set
  // of live subscriptions (so `reconcileInstanceSubscriptions` can diff and
  // fork only the *new* or *rebuilt* ones) and serves as the dynamic adapter
  // list consumed by `stopStaleSessionsForThread`, `listSessions`, and
  // `runStopAll` — replacing the pre-Slice-D startup snapshot so hot-added
  // instances become visible to those call sites as soon as settings edits
  // land.
  const subscribedAdapters = yield* Ref.make(
    new Map<ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>>(),
  );

  const getAdapterEntries = Ref.get(subscribedAdapters).pipe(
    Effect.map((map) => Array.from(map.entries())),
  );

  // Rebuild the map of id → adapter from the registry and fork a new event
  // subscription for every instance that is either brand new or whose adapter
  // identity changed (indicating the underlying `ProviderInstance` was torn
  // down and rebuilt by `ProviderInstanceRegistry.reconcile`). Orphaned
  // fibers for removed/replaced instances exit on their own because their
  // adapter's `streamEvents` source terminates when the old scope closes.
  const reconcileInstanceSubscriptions = Effect.gen(function* () {
    const previous = yield* Ref.get(subscribedAdapters);
    const currentIds = yield* registry.listInstances();
    const next = new Map<ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>>();
    for (const id of currentIds) {
      const adapterOption = yield* registry
        .getByInstance(id)
        .pipe(Effect.tapError(Effect.logWarning), Effect.option);
      if (Option.isNone(adapterOption)) continue;
      const adapter = adapterOption.value;
      next.set(id, adapter);
      if (previous.get(id) !== adapter) {
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          processRuntimeEvent(
            {
              instanceId: id,
              provider: adapter.provider,
            },
            event,
          ),
        ).pipe(Effect.forkScoped);
      }
    }
    yield* Ref.set(subscribedAdapters, next);
  });

  const instanceChanges = yield* registry.subscribeChanges;
  yield* reconcileInstanceSubscriptions;
  yield* Stream.runForEach(
    Stream.fromSubscription(instanceChanges),
    () => reconcileInstanceSubscriptions,
  ).pipe(Effect.forkScoped);

  const recoverSessionForThread = Effect.fn("recoverSessionForThread")(function* (input: {
    readonly binding: ProviderRuntimeBinding;
    readonly operation: string;
  }) {
    const bindingInstanceId = yield* requireBindingInstanceId(input.operation, input.binding);
    yield* Effect.annotateCurrentSpan({
      "provider.operation": "recover-session",
      "provider.kind": input.binding.provider,
      "provider.instance_id": bindingInstanceId,
      "provider.thread_id": input.binding.threadId,
    });
    return yield* Effect.gen(function* () {
      const adapter = yield* registry.getByInstance(bindingInstanceId);
      const hasResumeCursor =
        input.binding.resumeCursor !== null && input.binding.resumeCursor !== undefined;
      const hasActiveSession = yield* adapter.hasSession(input.binding.threadId);
      if (hasActiveSession) {
        const activeSessions = yield* adapter.listSessions();
        const existing = activeSessions.find(
          (session) => session.threadId === input.binding.threadId,
        );
        if (existing) {
          yield* upsertSessionBinding(
            { ...existing, providerInstanceId: bindingInstanceId },
            input.binding.threadId,
          );
          yield* analytics.record("provider.session.recovered", {
            provider: existing.provider,
            strategy: "adopt-existing",
            hasResumeCursor: existing.resumeCursor !== undefined,
          });
          return { adapter, session: existing } as const;
        }
      }

      if (!hasResumeCursor) {
        return yield* toValidationError(
          input.operation,
          `Cannot recover thread '${input.binding.threadId}' because no provider resume state is persisted.`,
        );
      }

      const persistedCwd = readPersistedCwd(input.binding.runtimePayload);
      const persistedModelSelection = readPersistedModelSelection(input.binding.runtimePayload);
      const persistedDeveloperInstructions = readPersistedDeveloperInstructions(
        input.binding.runtimePayload,
      );
      const activeTaskStage = yield* activeTaskStageForThread(input.binding.threadId);
      const activeTaskContext =
        activeTaskStage === "build"
          ? yield* activeTaskProviderContextForThread(input.binding.threadId)
          : undefined;
      if (activeTaskStage === "build" && !activeTaskContext) {
        return yield* toValidationError(
          input.operation,
          "The active Build task has no canonical worktree/provider profile.",
        );
      }
      const taskExecutionProfile = activeTaskStage === "build" ? "task-worktree-write" : "planning";
      if (activeTaskStage === "build" && !supportsTaskWorktreeWrite(adapter.capabilities)) {
        return yield* toValidationError(
          input.operation,
          `Provider '${adapter.provider}' cannot enforce task-worktree-write.`,
        );
      }
      const developerInstructions = activeTaskStage
        ? trustedInstructionsForStage(activeTaskStage)
        : persistedDeveloperInstructions;

      yield* prepareMcpSession(
        input.binding.threadId,
        bindingInstanceId,
        activeTaskStage === "build",
      );
      const resumedTaskEnvironment =
        activeTaskStage !== undefined
          ? yield* taskCliEnvironmentForTurn({
              threadId: input.binding.threadId,
              providerInstanceId: bindingInstanceId,
            }).pipe(
              Effect.mapError((cause) => toValidationError(input.operation, cause.message, cause)),
            )
          : undefined;
      if (resumedTaskEnvironment) {
        taskTurnCredentials.set(input.binding.threadId, {
          token: resumedTaskEnvironment.token,
          providerInstanceId: bindingInstanceId,
          sessionGeneration: "recovery-pending",
          leaseTurnId: resumedTaskEnvironment.leaseTurnId,
          environment: resumedTaskEnvironment.environment,
        });
      }
      const resumed = yield* adapter
        .startSession({
          threadId: input.binding.threadId,
          provider: input.binding.provider,
          providerInstanceId: bindingInstanceId,
          ...(activeTaskContext
            ? { cwd: activeTaskContext.worktreePath }
            : persistedCwd
              ? { cwd: persistedCwd }
              : {}),
          ...(activeTaskContext
            ? { modelSelection: activeTaskContext.modelSelection }
            : persistedModelSelection
              ? { modelSelection: persistedModelSelection }
              : {}),
          ...(developerInstructions ? { developerInstructions } : {}),
          ...(resumedTaskEnvironment ? { environment: resumedTaskEnvironment.environment } : {}),
          taskStage: activeTaskStage === "build",
          taskExecutionProfile,
          ...(activeTaskContext ? { taskWorkspaceRoot: activeTaskContext.workspaceRoot } : {}),
          ...(hasResumeCursor ? { resumeCursor: input.binding.resumeCursor } : {}),
          runtimeMode: activeTaskContext
            ? activeTaskContext.runtimeMode
            : (input.binding.runtimeMode ?? "full-access"),
        })
        .pipe(Effect.onError(() => clearMcpSession(input.binding.threadId)));
      if (resumed.provider !== adapter.provider) {
        yield* clearMcpSession(input.binding.threadId);
        return yield* toValidationError(
          input.operation,
          `Adapter/provider mismatch while recovering thread '${input.binding.threadId}'. Expected '${adapter.provider}', received '${resumed.provider}'.`,
        );
      }

      yield* upsertSessionBinding(
        { ...resumed, providerInstanceId: bindingInstanceId },
        input.binding.threadId,
        developerInstructions ? { developerInstructions } : {},
      );
      if (resumedTaskEnvironment) {
        const activeTurnId = resumed.activeTurnId;
        if (activeTurnId === undefined) {
          yield* revokeTaskCredential(input.binding.threadId);
        } else {
          const taskInvocations = yield* Effect.serviceOption(TaskInvocationService);
          if (Option.isSome(taskInvocations)) {
            yield* taskInvocations.value
              .bind({
                token: resumedTaskEnvironment.token,
                threadId: input.binding.threadId,
                providerInstanceId: bindingInstanceId,
                providerTurnId: activeTurnId,
              })
              .pipe(
                Effect.mapError((cause) =>
                  toValidationError(input.operation, cause.message, cause),
                ),
                Effect.onError(() => revokeTaskCredential(input.binding.threadId)),
              );
            taskTurnCredentials.set(input.binding.threadId, {
              token: resumedTaskEnvironment.token,
              providerInstanceId: bindingInstanceId,
              sessionGeneration:
                typeof resumed.sessionGeneration === "string"
                  ? resumed.sessionGeneration
                  : "recovered",
              leaseTurnId: resumedTaskEnvironment.leaseTurnId,
              environment: resumedTaskEnvironment.environment,
              providerTurnId: activeTurnId,
            });
          }
        }
      }
      yield* analytics.record("provider.session.recovered", {
        provider: resumed.provider,
        strategy: "resume-thread",
        hasResumeCursor: resumed.resumeCursor !== undefined,
      });
      return { adapter, session: resumed } as const;
    }).pipe(
      withMetrics({
        counter: providerSessionsTotal,
        attributes: providerMetricAttributes(input.binding.provider, {
          operation: "recover",
        }),
      }),
    );
  });

  const resolveRoutableSession = Effect.fn("resolveRoutableSession")(function* (input: {
    readonly threadId: ThreadId;
    readonly operation: string;
    readonly allowRecovery: boolean;
    readonly alreadyLocked?: boolean;
  }) {
    const bindingOption = yield* directory.getBinding(input.threadId);
    const binding = Option.getOrUndefined(bindingOption);
    if (!binding) {
      return yield* toValidationError(
        input.operation,
        `Cannot route thread '${input.threadId}' because no persisted provider binding exists.`,
      );
    }
    const instanceId = yield* requireBindingInstanceId(input.operation, binding);
    const adapter = yield* registry.getByInstance(instanceId);

    const hasRequestedSession = yield* adapter.hasSession(input.threadId);
    if (hasRequestedSession) {
      return {
        adapter,
        instanceId,
        threadId: input.threadId,
        isActive: true,
      } as const;
    }

    if (!input.allowRecovery) {
      return {
        adapter,
        instanceId,
        threadId: input.threadId,
        isActive: false,
      } as const;
    }

    const recovered = yield* input.alreadyLocked
      ? recoverSessionForThread({ binding, operation: input.operation })
      : withMcpRotationLock(
          input.threadId,
          recoverSessionForThread({
            binding,
            operation: input.operation,
          }),
        );
    return {
      adapter: recovered.adapter,
      instanceId,
      threadId: input.threadId,
      isActive: true,
    } as const;
  });

  const stopStaleSessionsForThread = Effect.fn("stopStaleSessionsForThread")(function* (input: {
    readonly threadId: ThreadId;
    readonly currentInstanceId: ProviderInstanceId;
  }) {
    const currentAdapters = yield* getAdapterEntries;
    yield* Effect.forEach(
      currentAdapters,
      ([instanceId, adapter]) =>
        instanceId === input.currentInstanceId
          ? Effect.void
          : Effect.gen(function* () {
              const hasSession = yield* adapter.hasSession(input.threadId);
              if (!hasSession) {
                return;
              }

              yield* adapter.stopSession(input.threadId).pipe(
                Effect.tap(() =>
                  analytics.record("provider.session.stopped", {
                    provider: adapter.provider,
                  }),
                ),
                Effect.catchCause((cause) =>
                  Effect.logWarning("provider.session.stop-stale-failed", {
                    threadId: input.threadId,
                    provider: adapter.provider,
                    cause,
                  }),
                ),
              );
            }),
      { discard: true },
    );
  });

  const startSession: ProviderServiceShape["startSession"] = Effect.fn("startSession")(
    function* (threadId, rawInput) {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderService.startSession",
        schema: ProviderSessionStartInput,
        payload: rawInput,
      });

      const resolvedInstanceId = yield* requireBindingInstanceId(
        "ProviderService.startSession",
        parsed,
      );
      let metricProvider = parsed.provider ?? String(resolvedInstanceId);
      yield* Effect.annotateCurrentSpan({
        "provider.operation": "start-session",
        "provider.instance_id": resolvedInstanceId,
        "provider.thread_id": threadId,
        "provider.runtime_mode": parsed.runtimeMode,
      });
      return yield* Effect.gen(function* () {
        const instanceInfo = yield* registry.getInstanceInfo(resolvedInstanceId);
        const resolvedProvider = instanceInfo.driverKind;
        metricProvider = resolvedProvider;
        if (parsed.provider !== undefined && parsed.provider !== resolvedProvider) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Provider instance '${resolvedInstanceId}' belongs to driver '${resolvedProvider}', not '${parsed.provider}'.`,
          );
        }
        const input = {
          ...parsed,
          threadId,
          provider: resolvedProvider,
        };
        if (!instanceInfo.enabled) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Provider instance '${resolvedInstanceId}' is disabled in Kata Code settings.`,
          );
        }
        const persistedBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        const effectiveResumeCursor =
          input.resumeCursor ??
          (persistedBinding?.providerInstanceId === resolvedInstanceId
            ? persistedBinding.resumeCursor
            : undefined);
        const effectiveCwd =
          input.cwd ??
          (persistedBinding?.providerInstanceId === resolvedInstanceId
            ? readPersistedCwd(persistedBinding.runtimePayload)
            : undefined);
        yield* Effect.annotateCurrentSpan({
          "provider.kind": resolvedProvider,
          "provider.resume_cursor.source":
            input.resumeCursor !== undefined
              ? "request"
              : effectiveResumeCursor !== undefined &&
                  persistedBinding?.providerInstanceId === resolvedInstanceId
                ? "persisted"
                : "none",
          "provider.resume_cursor.present": effectiveResumeCursor !== undefined,
          "provider.cwd.source":
            input.cwd !== undefined
              ? "request"
              : effectiveCwd !== undefined &&
                  persistedBinding?.providerInstanceId === resolvedInstanceId
                ? "persisted"
                : "none",
          "provider.cwd.effective": effectiveCwd ?? "",
        });
        const adapter = yield* registry.getByInstance(resolvedInstanceId);
        const activeTaskStage = yield* activeTaskStageForThread(threadId);
        const activeTaskContext =
          activeTaskStage === "build"
            ? yield* activeTaskProviderContextForThread(threadId)
            : undefined;
        yield* assertPinnedToActiveBuildTask({
          operation: "ProviderService.startSession",
          activeTaskStage,
          activeTaskContext,
          providerInstanceId: resolvedInstanceId,
        });
        const activeTaskProfile = activeTaskStage === "build" ? "task-worktree-write" : "planning";
        if (activeTaskStage === "build" && !supportsTaskWorktreeWrite(adapter.capabilities)) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Provider '${resolvedProvider}' cannot enforce task-worktree-write.`,
          );
        }
        const persistedDeveloperInstructions =
          persistedBinding?.providerInstanceId === resolvedInstanceId
            ? readPersistedDeveloperInstructions(persistedBinding.runtimePayload)
            : undefined;
        const developerInstructions =
          input.developerInstructions ??
          (activeTaskStage !== undefined
            ? trustedInstructionsForStage(activeTaskStage)
            : persistedDeveloperInstructions);
        const sessionWithInstance = yield* withMcpRotationLock(
          threadId,
          Effect.gen(function* () {
            yield* prepareMcpSession(threadId, resolvedInstanceId, activeTaskStage === "build");
            const startedTaskEnvironment =
              activeTaskStage !== undefined
                ? yield* taskCliEnvironmentForTurn({
                    threadId,
                    providerInstanceId: resolvedInstanceId,
                  }).pipe(
                    Effect.mapError((cause) =>
                      toValidationError("ProviderService.startSession", cause.message, cause),
                    ),
                  )
                : undefined;
            if (startedTaskEnvironment) {
              taskTurnCredentials.set(threadId, {
                token: startedTaskEnvironment.token,
                providerInstanceId: resolvedInstanceId,
                sessionGeneration: "session-pending",
                leaseTurnId: startedTaskEnvironment.leaseTurnId,
                environment: startedTaskEnvironment.environment,
              });
            }
            const sessionEnvironment = mergeSessionEnvironments(
              input.environment,
              startedTaskEnvironment?.environment,
            );
            const session = yield* adapter
              .startSession({
                ...input,
                providerInstanceId: resolvedInstanceId,
                ...(activeTaskContext
                  ? { cwd: activeTaskContext.worktreePath }
                  : effectiveCwd !== undefined
                    ? { cwd: effectiveCwd }
                    : {}),
                ...(activeTaskContext
                  ? { modelSelection: activeTaskContext.modelSelection }
                  : input.modelSelection
                    ? { modelSelection: input.modelSelection }
                    : {}),
                ...(developerInstructions ? { developerInstructions } : {}),
                ...(sessionEnvironment ? { environment: sessionEnvironment } : {}),
                taskStage: activeTaskStage === "build",
                taskExecutionProfile: activeTaskProfile,
                ...(activeTaskContext
                  ? { taskWorkspaceRoot: activeTaskContext.workspaceRoot }
                  : {}),
                runtimeMode: activeTaskContext ? activeTaskContext.runtimeMode : input.runtimeMode,
                ...(effectiveResumeCursor !== undefined
                  ? { resumeCursor: effectiveResumeCursor }
                  : {}),
              })
              .pipe(
                Effect.onError(() =>
                  clearMcpSession(threadId).pipe(
                    Effect.andThen(
                      startedTaskEnvironment ? revokeTaskCredential(threadId) : Effect.void,
                    ),
                  ),
                ),
              );

            if (session.provider !== adapter.provider) {
              yield* clearMcpSession(threadId);
              return yield* toValidationError(
                "ProviderService.startSession",
                `Adapter/provider mismatch: requested '${adapter.provider}', received '${session.provider}'.`,
              );
            }
            const sessionWithInstance = {
              ...session,
              providerInstanceId: resolvedInstanceId,
            };
            yield* stopStaleSessionsForThread({
              threadId,
              currentInstanceId: resolvedInstanceId,
            });
            yield* upsertSessionBinding(sessionWithInstance, threadId, {
              modelSelection: input.modelSelection,
              ...(developerInstructions ? { developerInstructions } : {}),
            });
            if (startedTaskEnvironment) {
              yield* markTaskTurnPending({
                threadId,
                providerInstanceId: resolvedInstanceId,
                turnId: startedTaskEnvironment.leaseTurnId,
              });
            }
            return sessionWithInstance;
          }),
        );
        yield* analytics.record("provider.session.started", {
          provider: sessionWithInstance.provider,
          runtimeMode: input.runtimeMode,
          hasResumeCursor: sessionWithInstance.resumeCursor !== undefined,
          hasCwd: typeof effectiveCwd === "string" && effectiveCwd.trim().length > 0,
          hasModel:
            typeof input.modelSelection?.model === "string" &&
            input.modelSelection.model.trim().length > 0,
        });

        return sessionWithInstance;
      }).pipe(
        withMetrics({
          counter: providerSessionsTotal,
          attributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "start",
            }),
        }),
      );
    },
  );

  const sendTurn: ProviderServiceShape["sendTurn"] = Effect.fn("sendTurn")(function* (rawInput) {
    const parsed = yield* decodeInputOrValidationError({
      operation: "ProviderService.sendTurn",
      schema: ProviderSendTurnInput,
      payload: rawInput,
    });

    const input = {
      ...parsed,
      attachments: parsed.attachments ?? [],
    };
    if (!input.input && input.attachments.length === 0) {
      return yield* toValidationError(
        "ProviderService.sendTurn",
        "Either input text or at least one attachment is required",
      );
    }
    yield* Effect.annotateCurrentSpan({
      "provider.operation": "send-turn",
      "provider.thread_id": input.threadId,
      "provider.interaction_mode": input.interactionMode,
      "provider.attachment_count": input.attachments.length,
    });
    let metricProvider = "unknown";
    let metricModel = input.modelSelection?.model;
    const sendTurnEffect = Effect.gen(function* () {
      const shouldSerializeTaskTurn = yield* isActiveTaskThread(input.threadId);
      const routed = yield* resolveRoutableSession({
        alreadyLocked: true,
        threadId: input.threadId,
        operation: "ProviderService.sendTurn",
        allowRecovery: true,
      });
      metricProvider = routed.adapter.provider;
      metricModel = input.modelSelection?.model;
      yield* validateActiveTaskTurn({
        threadId: input.threadId,
        providerInstanceId: routed.instanceId,
      }).pipe(
        Effect.mapError((cause) =>
          toValidationError("ProviderService.sendTurn", cause.message, cause),
        ),
      );
      // Keep the provider's native Plan mode out of Guided task stages. Kata
      // owns the stage lifecycle; provider-native plan cards cannot complete a
      // planning occurrence. Planning uses `katacode task complete`.
      const activeTaskStage = yield* activeTaskStageForThread(input.threadId);
      const activeTaskContext =
        activeTaskStage === "build"
          ? yield* activeTaskProviderContextForThread(input.threadId)
          : undefined;
      yield* assertPinnedToActiveBuildTask({
        operation: "ProviderService.sendTurn",
        activeTaskStage,
        activeTaskContext,
        providerInstanceId: routed.instanceId,
      });
      const providerInteractionMode = normalizeTaskStageInteractionMode({
        isTaskStage: activeTaskStage !== undefined,
        ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
      });
      const taskExecutionProfile = activeTaskStage === "build" ? "task-worktree-write" : "planning";
      if (activeTaskStage === "build" && !supportsTaskWorktreeWrite(routed.adapter.capabilities)) {
        return yield* toValidationError(
          "ProviderService.sendTurn",
          `Provider '${routed.adapter.provider}' cannot enforce task-worktree-write.`,
        );
      }
      const providerInput =
        activeTaskStage === undefined
          ? { ...input, taskStage: false }
          : {
              ...input,
              ...(activeTaskContext ? { modelSelection: activeTaskContext.modelSelection } : {}),
              developerInstructions: trustedInstructionsForStage(activeTaskStage),
              taskStage: activeTaskStage === "build",
              taskExecutionProfile: taskExecutionProfile as "planning" | "task-worktree-write",
              interactionMode: providerInteractionMode ?? "default",
            };
      yield* Effect.annotateCurrentSpan({
        "provider.kind": routed.adapter.provider,
        ...(input.modelSelection?.model ? { "provider.model": input.modelSelection.model } : {}),
      });
      const isTaskTurn = shouldSerializeTaskTurn;
      const reusedTaskEnvironment = isTaskTurn
        ? reuseSessionInjectedTaskCliEnvironment({
            threadId: input.threadId,
            providerInstanceId: routed.instanceId,
          })
        : undefined;
      const issuedTaskEnvironment =
        isTaskTurn && reusedTaskEnvironment === undefined
          ? yield* taskCliEnvironmentForTurn({
              threadId: input.threadId,
              providerInstanceId: routed.instanceId,
            })
          : undefined;
      const taskEnvironment = reusedTaskEnvironment ?? issuedTaskEnvironment;
      if (taskEnvironment) {
        taskTurnCredentials.set(input.threadId, {
          token: taskEnvironment.token,
          providerInstanceId: routed.instanceId,
          sessionGeneration: "turn-pending",
          leaseTurnId: taskEnvironment.leaseTurnId,
          environment: taskEnvironment.environment,
        });
        yield* markTaskTurnPending({
          threadId: input.threadId,
          providerInstanceId: routed.instanceId,
          turnId: taskEnvironment.leaseTurnId,
        });
      }
      yield* Effect.gen(function* () {
        const mcpPreparation = yield* prepareMcpSession(
          input.threadId,
          routed.instanceId,
          activeTaskStage === "build",
        );
        if (mcpPreparation.rotated || issuedTaskEnvironment) {
          yield* restartSessionForMcpCredential({
            threadId: input.threadId,
            providerInstanceId: routed.instanceId,
            ...(input.developerInstructions !== undefined
              ? { developerInstructions: input.developerInstructions }
              : {}),
            ...(mergeSessionEnvironments(input.environment, taskEnvironment?.environment)
              ? {
                  environment: mergeSessionEnvironments(
                    input.environment,
                    taskEnvironment?.environment,
                  )!,
                }
              : {}),
            adapter: routed.adapter,
          });
        }
      }).pipe(
        Effect.onError(() =>
          taskEnvironment ? revokeTaskCredential(input.threadId) : Effect.void,
        ),
      );
      if (taskEnvironment) {
        yield* markTaskTurnPending({
          threadId: input.threadId,
          providerInstanceId: routed.instanceId,
          turnId: taskEnvironment.leaseTurnId,
        });
      }
      const turn = yield* routed.adapter
        .sendTurn({
          ...providerInput,
          ...(taskEnvironment
            ? {
                environment: mergeSessionEnvironments(
                  providerInput.environment,
                  taskEnvironment.environment,
                ),
              }
            : {}),
        })
        .pipe(
          Effect.onError(() =>
            taskEnvironment ? revokeTaskCredential(input.threadId) : Effect.void,
          ),
        );
      if (taskEnvironment) {
        // Record the native turn before any further yields so a terminal event
        // cannot leave a finished turn bound to a still-active lease.
        const tracked = taskTurnCredentials.get(input.threadId);
        taskTurnCredentials.set(input.threadId, {
          token: taskEnvironment.token,
          providerInstanceId: routed.instanceId,
          sessionGeneration: tracked?.sessionGeneration ?? "turn-active",
          leaseTurnId: taskEnvironment.leaseTurnId,
          environment: taskEnvironment.environment,
          providerTurnId: turn.turnId,
        });
        const activeSessions = yield* routed.adapter.listSessions();
        const generation = activeSessions.find(
          (session) => session.threadId === input.threadId,
        )?.sessionGeneration;
        if (typeof generation === "string") {
          const current = taskTurnCredentials.get(input.threadId);
          if (current !== undefined) {
            taskTurnCredentials.set(input.threadId, {
              ...current,
              sessionGeneration: generation,
            });
          }
        }
      }
      const persistedBindingAfterTurn = Option.getOrUndefined(
        yield* directory.getBinding(input.threadId),
      );
      const developerInstructions =
        input.developerInstructions ??
        readPersistedDeveloperInstructions(persistedBindingAfterTurn?.runtimePayload);
      yield* directory
        .upsert({
          threadId: input.threadId,
          provider: routed.adapter.provider,
          providerInstanceId: routed.instanceId,
          status: "running",
          ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
          runtimePayload: {
            ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
            ...(developerInstructions ? { developerInstructions } : {}),
            activeTurnId: turn.turnId,
            lastRuntimeEvent: "provider.sendTurn",
            lastRuntimeEventAt: yield* nowIso,
          },
        })
        .pipe(
          Effect.onError(() =>
            taskEnvironment ? revokeTaskCredential(input.threadId) : Effect.void,
          ),
        );
      if (taskEnvironment) {
        const taskInvocations = yield* Effect.serviceOption(TaskInvocationService);
        if (Option.isSome(taskInvocations)) {
          yield* taskInvocations.value
            .bind({
              token: taskEnvironment.token,
              threadId: input.threadId,
              providerInstanceId: routed.instanceId,
              providerTurnId: turn.turnId,
            })
            .pipe(
              Effect.mapError((cause) =>
                toValidationError("ProviderService.sendTurn", cause.message, cause),
              ),
              Effect.onError(() => revokeTaskCredential(input.threadId)),
            );
        }
      }
      if (isTaskTurn) {
        const previous = taskTurnWatchdogs.get(input.threadId);
        if (previous !== undefined) {
          yield* Fiber.interrupt(previous);
        }
        const watchdog = yield* Effect.forkDetach(
          Effect.sleep("2 hours").pipe(
            Effect.andThen(
              routed.adapter.interruptTurn(input.threadId, turn.turnId).pipe(
                Effect.tap(() =>
                  Effect.logWarning("task provider turn exceeded the two-hour timeout", {
                    threadId: input.threadId,
                    turnId: turn.turnId,
                  }),
                ),
              ),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("task provider turn timeout recovery failed", {
                threadId: input.threadId,
                turnId: turn.turnId,
                cause,
              }),
            ),
          ),
        );
        taskTurnWatchdogs.set(input.threadId, watchdog);
      }
      yield* analytics.record("provider.turn.sent", {
        provider: routed.adapter.provider,
        model: input.modelSelection?.model,
        interactionMode: input.interactionMode,
        attachmentCount: input.attachments.length,
        hasInput: typeof input.input === "string" && input.input.trim().length > 0,
      });
      return turn;
    }).pipe(
      withMetrics({
        counter: providerTurnsTotal,
        timer: providerTurnDuration,
        attributes: () =>
          providerTurnMetricAttributes({
            provider: metricProvider,
            model: metricModel,
            extra: {
              operation: "send",
            },
          }),
      }),
    );
    return yield* withMcpRotationLock(input.threadId, sendTurnEffect);
  });

  const interruptTurn: ProviderServiceShape["interruptTurn"] = Effect.fn("interruptTurn")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.interruptTurn",
        schema: ProviderInterruptTurnInput,
        payload: rawInput,
      });
      let metricProvider = "unknown";
      return yield* Effect.gen(function* () {
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.interruptTurn",
          allowRecovery: true,
        });
        metricProvider = routed.adapter.provider;
        yield* Effect.annotateCurrentSpan({
          "provider.operation": "interrupt-turn",
          "provider.kind": routed.adapter.provider,
          "provider.thread_id": input.threadId,
          "provider.turn_id": input.turnId,
        });
        yield* routed.adapter.interruptTurn(routed.threadId, input.turnId);
        yield* analytics.record("provider.turn.interrupted", {
          provider: routed.adapter.provider,
        });
      }).pipe(
        withMetrics({
          counter: providerTurnsTotal,
          outcomeAttributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "interrupt",
            }),
        }),
      );
    },
  );

  const respondToRequest: ProviderServiceShape["respondToRequest"] = Effect.fn("respondToRequest")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.respondToRequest",
        schema: ProviderRespondToRequestInput,
        payload: rawInput,
      });
      let metricProvider = "unknown";
      return yield* Effect.gen(function* () {
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.respondToRequest",
          allowRecovery: true,
        });
        metricProvider = routed.adapter.provider;
        yield* Effect.annotateCurrentSpan({
          "provider.operation": "respond-to-request",
          "provider.kind": routed.adapter.provider,
          "provider.thread_id": input.threadId,
          "provider.request_id": input.requestId,
        });
        yield* routed.adapter.respondToRequest(routed.threadId, input.requestId, input.decision);
        yield* analytics.record("provider.request.responded", {
          provider: routed.adapter.provider,
          decision: input.decision,
        });
      }).pipe(
        withMetrics({
          counter: providerTurnsTotal,
          outcomeAttributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "approval-response",
            }),
        }),
      );
    },
  );

  const respondToUserInput: ProviderServiceShape["respondToUserInput"] = Effect.fn(
    "respondToUserInput",
  )(function* (rawInput) {
    const input = yield* decodeInputOrValidationError({
      operation: "ProviderService.respondToUserInput",
      schema: ProviderRespondToUserInputInput,
      payload: rawInput,
    });
    let metricProvider = "unknown";
    return yield* Effect.gen(function* () {
      const routed = yield* resolveRoutableSession({
        threadId: input.threadId,
        operation: "ProviderService.respondToUserInput",
        allowRecovery: true,
      });
      metricProvider = routed.adapter.provider;
      yield* Effect.annotateCurrentSpan({
        "provider.operation": "respond-to-user-input",
        "provider.kind": routed.adapter.provider,
        "provider.thread_id": input.threadId,
        "provider.request_id": input.requestId,
      });
      yield* routed.adapter.respondToUserInput(routed.threadId, input.requestId, input.answers);
    }).pipe(
      withMetrics({
        counter: providerTurnsTotal,
        outcomeAttributes: () =>
          providerMetricAttributes(metricProvider, {
            operation: "user-input-response",
          }),
      }),
    );
  });

  const stopSession: ProviderServiceShape["stopSession"] = Effect.fn("stopSession")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.stopSession",
        schema: ProviderStopSessionInput,
        payload: rawInput,
      });
      let metricProvider = "unknown";
      return yield* withMcpRotationLock(
        input.threadId,
        Effect.gen(function* () {
          const routed = yield* resolveRoutableSession({
            threadId: input.threadId,
            operation: "ProviderService.stopSession",
            allowRecovery: false,
          });
          metricProvider = routed.adapter.provider;
          yield* Effect.annotateCurrentSpan({
            "provider.operation": "stop-session",
            "provider.kind": routed.adapter.provider,
            "provider.thread_id": input.threadId,
          });
          if (routed.isActive) {
            yield* routed.adapter.stopSession(routed.threadId);
          }
          const taskInvocations = yield* Effect.serviceOption(TaskInvocationService);
          if (Option.isSome(taskInvocations)) {
            yield* taskInvocations.value.revokeThread(input.threadId).pipe(Effect.ignore);
          }
          taskTurnCredentials.delete(input.threadId);
          yield* clearMcpSession(input.threadId);
          yield* directory.upsert({
            threadId: input.threadId,
            provider: routed.adapter.provider,
            providerInstanceId: routed.instanceId,
            status: "stopped",
            runtimePayload: {
              activeTurnId: null,
            },
          });
          yield* analytics.record("provider.session.stopped", {
            provider: routed.adapter.provider,
          });
        }).pipe(
          withMetrics({
            counter: providerSessionsTotal,
            outcomeAttributes: () =>
              providerMetricAttributes(metricProvider, {
                operation: "stop",
              }),
          }),
        ),
      );
    },
  );

  const listSessions: ProviderServiceShape["listSessions"] = Effect.fn("listSessions")(
    function* () {
      const currentAdapters = yield* getAdapterEntries;
      const sessionsByProvider = yield* Effect.forEach(currentAdapters, ([instanceId, adapter]) =>
        adapter.listSessions().pipe(
          Effect.map((sessions) =>
            sessions.map((session) => ({
              ...session,
              providerInstanceId: instanceId,
            })),
          ),
        ),
      );
      const activeSessions = sessionsByProvider.flatMap((sessions) => sessions);
      const persistedBindings = yield* directory.listThreadIds().pipe(
        Effect.flatMap((threadIds) =>
          Effect.forEach(
            threadIds,
            (threadId) =>
              directory
                .getBinding(threadId)
                .pipe(Effect.orElseSucceed(() => Option.none<ProviderRuntimeBinding>())),
            { concurrency: "unbounded" },
          ),
        ),
        Effect.orElseSucceed(() => [] as Array<Option.Option<ProviderRuntimeBinding>>),
      );
      const bindingsByThreadId = new Map<ThreadId, ProviderRuntimeBinding>();
      for (const bindingOption of persistedBindings) {
        const binding = Option.getOrUndefined(bindingOption);
        if (binding) {
          bindingsByThreadId.set(binding.threadId, binding);
        }
      }

      const sessions: ProviderSession[] = [];
      for (const session of activeSessions) {
        const binding = bindingsByThreadId.get(session.threadId);
        if (!binding) {
          sessions.push(session);
          continue;
        }

        const overrides: {
          resumeCursor?: ProviderSession["resumeCursor"];
          runtimeMode?: ProviderSession["runtimeMode"];
          providerInstanceId?: ProviderSession["providerInstanceId"];
        } = {};
        overrides.providerInstanceId = dieOnMissingBindingInstanceId(
          "ProviderService.listSessions",
          binding,
        );
        if (binding.provider !== session.provider) {
          return yield* Effect.die(
            new Error(
              `ProviderService.listSessions: thread '${session.threadId}' is active on provider '${session.provider}' but persisted binding names provider '${binding.provider}'.`,
            ),
          );
        }
        if (overrides.providerInstanceId !== session.providerInstanceId) {
          return yield* Effect.die(
            new Error(
              `ProviderService.listSessions: thread '${session.threadId}' is active on provider instance '${session.providerInstanceId}' but persisted binding names '${overrides.providerInstanceId}'.`,
            ),
          );
        }
        if (session.resumeCursor === undefined && binding.resumeCursor !== undefined) {
          overrides.resumeCursor = binding.resumeCursor;
        }
        if (binding.runtimeMode !== undefined) {
          overrides.runtimeMode = binding.runtimeMode;
        }
        sessions.push(Object.assign({}, session, overrides));
      }
      return sessions;
    },
  );

  const getCapabilities: ProviderServiceShape["getCapabilities"] = (instanceId) =>
    registry.getByInstance(instanceId).pipe(Effect.map((adapter) => adapter.capabilities));

  const getInstanceInfo: ProviderServiceShape["getInstanceInfo"] = (instanceId) =>
    registry.getInstanceInfo(instanceId);

  const rollbackConversation: ProviderServiceShape["rollbackConversation"] = Effect.fn(
    "rollbackConversation",
  )(function* (rawInput) {
    const input = yield* decodeInputOrValidationError({
      operation: "ProviderService.rollbackConversation",
      schema: ProviderRollbackConversationInput,
      payload: rawInput,
    });
    if (input.numTurns === 0) {
      return;
    }
    let metricProvider = "unknown";
    return yield* Effect.gen(function* () {
      const routed = yield* resolveRoutableSession({
        threadId: input.threadId,
        operation: "ProviderService.rollbackConversation",
        allowRecovery: true,
      });
      metricProvider = routed.adapter.provider;
      yield* Effect.annotateCurrentSpan({
        "provider.operation": "rollback-conversation",
        "provider.kind": routed.adapter.provider,
        "provider.thread_id": input.threadId,
        "provider.rollback_turns": input.numTurns,
      });
      yield* routed.adapter.rollbackThread(routed.threadId, input.numTurns);
      yield* analytics.record("provider.conversation.rolled_back", {
        provider: routed.adapter.provider,
        turns: input.numTurns,
      });
    }).pipe(
      withMetrics({
        counter: providerTurnsTotal,
        outcomeAttributes: () =>
          providerMetricAttributes(metricProvider, {
            operation: "rollback",
          }),
      }),
    );
  });

  const compactConversation: ProviderServiceShape["compactConversation"] = Effect.fn(
    "compactConversation",
  )(function* (rawInput) {
    const input = yield* decodeInputOrValidationError({
      operation: "ProviderService.compactConversation",
      schema: ProviderCompactThreadInput,
      payload: rawInput,
    });
    let metricProvider = "unknown";
    return yield* Effect.gen(function* () {
      const routed = yield* resolveRoutableSession({
        threadId: input.threadId,
        operation: "ProviderService.compactConversation",
        // Compaction is an operation on an active session. Allowing recovery
        // here would resurrect stopped external sessions (Claude/Codex/etc)
        // just to immediately fail on adapters that stub compaction, recording
        // recovery side effects for an unsupported operation.
        allowRecovery: false,
      });
      metricProvider = routed.adapter.provider;
      yield* Effect.annotateCurrentSpan({
        "provider.operation": "compact-conversation",
        "provider.kind": routed.adapter.provider,
        "provider.thread_id": input.threadId,
      });
      yield* routed.adapter.compactThread(routed.threadId);
      yield* analytics.record("provider.conversation.compacted", {
        provider: routed.adapter.provider,
      });
    }).pipe(
      withMetrics({
        counter: providerTurnsTotal,
        outcomeAttributes: () =>
          providerMetricAttributes(metricProvider, {
            operation: "compact",
          }),
      }),
    );
  });

  const runStopAll = Effect.fn("runStopAll")(function* () {
    const threadIds = yield* directory.listThreadIds();
    const currentAdapters = yield* getAdapterEntries;
    const activeSessions = yield* Effect.forEach(currentAdapters, ([instanceId, adapter]) =>
      adapter.listSessions().pipe(
        Effect.map((sessions) =>
          sessions.map((session) => ({
            ...session,
            providerInstanceId: instanceId,
          })),
        ),
      ),
    ).pipe(Effect.map((sessionsByAdapter) => sessionsByAdapter.flatMap((sessions) => sessions)));
    yield* Effect.forEach(activeSessions, (session) =>
      Effect.flatMap(nowIso, (lastRuntimeEventAt) =>
        upsertSessionBinding(session, session.threadId, {
          lastRuntimeEvent: "provider.stopAll",
          lastRuntimeEventAt,
        }),
      ),
    ).pipe(Effect.asVoid);
    yield* Effect.forEach(currentAdapters, ([, adapter]) => adapter.stopAll()).pipe(Effect.asVoid);
    yield* McpSessionRegistry.revokeAllActiveMcpCredentials();
    const taskInvocations = yield* Effect.serviceOption(TaskInvocationService);
    if (Option.isSome(taskInvocations)) {
      yield* taskInvocations.value.revokeAll.pipe(Effect.ignore);
    }
    taskTurnCredentials.clear();
    McpProviderSession.clearAllMcpProviderSessions();
    const bindings = yield* directory.listBindings().pipe(Effect.orElseSucceed(() => []));
    yield* Effect.forEach(bindings, (binding) =>
      Effect.gen(function* () {
        const providerInstanceId = dieOnMissingBindingInstanceId(
          "ProviderService.stopAll",
          binding,
        );
        return yield* directory.upsert({
          threadId: binding.threadId,
          provider: binding.provider,
          providerInstanceId,
          status: "stopped",
          runtimePayload: {
            activeTurnId: null,
            lastRuntimeEvent: "provider.stopAll",
            lastRuntimeEventAt: yield* nowIso,
          },
        });
      }),
    ).pipe(Effect.asVoid);
    yield* analytics.record("provider.sessions.stopped_all", {
      sessionCount: threadIds.length,
    });
    yield* analytics.flush;
  });

  yield* Effect.addFinalizer(() =>
    runStopAll().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to stop provider service", { cause: Cause.pretty(cause) }),
      ),
    ),
  );

  return {
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    getCapabilities,
    getInstanceInfo,
    rollbackConversation,
    compactConversation,
    // Each access creates a fresh PubSub subscription so that multiple
    // consumers (ProviderRuntimeIngestion, CheckpointReactor, etc.) each
    // independently receive all runtime events.
    get streamEvents(): ProviderServiceShape["streamEvents"] {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  } satisfies ProviderServiceShape;
});

export const ProviderServiceLive = Layer.effect(ProviderService, makeProviderService());

export function makeProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(ProviderService, makeProviderService(options));
}
