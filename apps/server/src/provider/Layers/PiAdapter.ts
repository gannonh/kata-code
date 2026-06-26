/**
 * PiAdapter — maps the in-process Pi SDK (`AgentSession`) onto Kata's
 * `ProviderAdapterShape`.
 *
 * Vertical slice (this file): start a session, send a turn, stream assistant
 * text and reasoning deltas, interrupt, and stop. Tool-lifecycle detail,
 * compaction, the extension-UI bridge, runtime-mode enforcement, rollback,
 * and resume cursors are layered on after the driver is wired end-to-end;
 * their operations exist here as typed errors so the adapter is never
 * silently half-implemented.
 *
 * @module provider/Layers/PiAdapter
 */
import { randomUUID } from "node:crypto";
import {
  type AgentSessionEvent,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  EventId,
  type PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderSendTurnInput,
  type ProviderTurnStartResult,
  RuntimeItemId,
  type ThreadId,
  TurnId,
} from "@kata-sh/code-contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { classifyPiTurnFailure } from "../piTurnFailure.ts";
import {
  type PiModelShape,
  createPiRegistries,
  piModelSlug,
  resolvePiAgentDir,
} from "./PiProvider.ts";

const PROVIDER = ProviderDriverKind.make("pi");

export interface PiAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
  /** Override SDK session creation for tests. */
  readonly createSession?: typeof createAgentSession;
  /** Override the model list used for selection (tests); defaults to the registry. */
  readonly availableModels?: ReadonlyArray<PiModelShape>;
  /** Observe published runtime events without subscribing to the stream (tests). */
  readonly onEvent?: (event: ProviderRuntimeEvent) => void;
}

interface PiSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly sdk: PiSdkSession;
  unsubscribe: () => void;
  activeTurnId: TurnId | undefined;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  stopped: boolean;
}

/**
 * The slice of the Pi SDK `AgentSession` this adapter depends on. Extracted as
 * a type so unit tests can substitute a minimal double without the full SDK.
 */
export interface PiSdkSession {
  readonly sessionId: string;
  prompt(
    text: string,
    options?: { images?: unknown[]; streamingBehavior?: "steer" | "followUp" },
  ): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  readonly isStreaming: boolean;
}

type TurnOutcome =
  | { readonly state: "completed" }
  | { readonly state: "failed"; readonly reason: string }
  | { readonly state: "aborted"; readonly reason: string };

export function makePiAdapter(
  piSettings: PiSettings,
  options?: PiAdapterLiveOptions,
): Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, never, never> {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("pi");
    const sessions = new Map<ThreadId, PiSessionContext>();
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const agentDir = resolvePiAgentDir(piSettings.agentDir);
    const { authStorage, modelRegistry } = createPiRegistries(agentDir);

    const stampSync = () => ({
      eventId: EventId.make(randomUUID()),
      createdAt: DateTime.formatIso(DateTime.nowUnsafe()),
    });

    const makeEvent = (
      threadId: ThreadId,
      partial: Omit<
        ProviderRuntimeEvent,
        "eventId" | "createdAt" | "provider" | "providerInstanceId" | "threadId"
      >,
    ): ProviderRuntimeEvent => {
      const event: Record<string, unknown> = {
        ...partial,
        ...stampSync(),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId,
      };
      // exactOptionalPropertyTypes: optional branded fields must be absent,
      // not explicitly undefined.
      for (const key of ["turnId", "itemId", "requestId", "raw"]) {
        if (event[key] === undefined) delete event[key];
      }
      return event as unknown as ProviderRuntimeEvent;
    };

    const publish = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Effect.sync(() => options?.onEvent?.(event)).pipe(
        Effect.andThen(PubSub.publish(runtimeEventPubSub, event)),
        Effect.asVoid,
      );

    /** Publish from the synchronous SDK listener. `publish` is R=never, so the
     *  default runtime is sufficient. */
    const offerFromListener = (event: ProviderRuntimeEvent) => {
      Effect.runFork(publish(event));
    };

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<PiSessionContext, ProviderAdapterSessionNotFoundError> =>
      Effect.gen(function* () {
        const ctx = sessions.get(threadId);
        if (!ctx) {
          return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
        }
        return ctx;
      });

    const mapSdkEvent = (
      event: AgentSessionEvent,
      ctx: PiSessionContext,
    ): ReadonlyArray<ProviderRuntimeEvent> => {
      const turnId = ctx.activeTurnId;
      if (event.type === "message_update") {
        const assistant = event.assistantMessageEvent;
        if (assistant.type === "text_delta" && assistant.delta) {
          return [
            makeEvent(ctx.threadId, {
              type: "content.delta",
              turnId,
              payload: { streamKind: "assistant_text", delta: assistant.delta },
            }),
          ];
        }
        if (assistant.type === "thinking_delta" && assistant.delta) {
          return [
            makeEvent(ctx.threadId, {
              type: "content.delta",
              turnId,
              payload: { streamKind: "reasoning_text", delta: assistant.delta },
            }),
          ];
        }
      }
      if (event.type === "turn_end" || event.type === "agent_end") {
        return [
          makeEvent(ctx.threadId, {
            type: "item.completed",
            turnId,
            itemId: RuntimeItemId.make(`${turnId ?? ctx.threadId}:assistant`),
            payload: { itemType: "assistant_message", status: "completed" },
          }),
          makeEvent(ctx.threadId, {
            type: "turn.completed",
            turnId,
            payload: { state: "completed" },
          }),
        ];
      }
      return [];
    };

    const resolveModel = (
      modelSelection: ProviderSessionStartInput["modelSelection"],
    ): PiModelShape | undefined => {
      const override = options?.availableModels;
      const slug = modelSelection?.model;
      if (slug) {
        const slash = slug.indexOf("/");
        if (slash > 0) {
          if (override) {
            return override.find((model) => piModelSlug(model) === slug);
          }
          return modelRegistry.find(slug.slice(0, slash), slug.slice(slash + 1)) as
            | PiModelShape
            | undefined;
        }
      }
      if (override) return override[0];
      return (modelRegistry.getAvailable() as ReadonlyArray<PiModelShape>)[0];
    };

    const resolveThinkingLevel = (
      modelSelection: ProviderSessionStartInput["modelSelection"],
    ): string | undefined => {
      const selection = modelSelection?.options?.find((option) => option.id === "thinkingLevel");
      return typeof selection?.value === "string" ? selection.value : undefined;
    };

    const settleTurn = (
      threadId: ThreadId,
      turnId: TurnId,
      outcome: TurnOutcome,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (outcome.state === "aborted") {
          yield* publish(
            makeEvent(threadId, {
              type: "turn.aborted",
              turnId,
              payload: { reason: outcome.reason },
            }),
          );
          return;
        }
        yield* publish(
          makeEvent(threadId, {
            type: "turn.completed",
            turnId,
            payload:
              outcome.state === "failed"
                ? { state: "failed", errorMessage: outcome.reason }
                : { state: "completed" },
          }),
        );
      });

    /**
     * Tear down a session's SDK resources without publishing a lifecycle
     * event. Used both by {@link stopSession} (which adds the
     * `session.exited` event) and by {@link startSession} when restarting an
     * existing thread (model switch), where a synthetic exit would confuse
     * the UI.
     */
    const teardownSession = (ctx: PiSessionContext) => {
      ctx.unsubscribe();
      ctx.sdk.dispose();
      ctx.stopped = true;
      ctx.activeTurnId = undefined;
      sessions.delete(ctx.threadId);
    };

    const startSession = (input: ProviderSessionStartInput) =>
      Effect.gen(function* () {
        // A thread can re-enter startSession when the user switches models
        // mid-conversation. The Pi SDK session is bound to a single model at
        // creation, so restart it rather than rejecting the request.
        const existing = sessions.get(input.threadId);
        if (existing) {
          if (existing.activeTurnId && existing.sdk.isStreaming) {
            yield* Effect.tryPromise({
              try: () => existing.sdk.abort(),
              catch: (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "startSession",
                  detail: `Failed to stop the active Pi turn before restart: ${cause instanceof Error ? cause.message : String(cause)}.`,
                  cause,
                }),
            });
          }
          teardownSession(existing);
        }

        const cwd = input.cwd?.trim() || process.cwd();
        const model = resolveModel(input.modelSelection);
        if (!model) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue:
              "Pi has no authenticated model available for this session. Configure Pi auth or select a runtime-discovered model.",
          });
        }
        const thinkingLevel = resolveThinkingLevel(input.modelSelection);

        const created = yield* Effect.tryPromise({
          try: async () => {
            const factory = options?.createSession ?? createAgentSession;
            return factory({
              cwd,
              ...(agentDir ? { agentDir } : {}),
              model: model as never,
              ...(thinkingLevel ? { thinkingLevel: thinkingLevel as never } : {}),
              authStorage,
              modelRegistry,
              sessionManager: SessionManager.inMemory(cwd),
              tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
            });
          },
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "startSession",
              detail: `Failed to start Pi session: ${cause instanceof Error ? cause.message : String(cause)}.`,
              cause,
            }),
        });

        const createdAt = DateTime.formatIso(DateTime.nowUnsafe());
        const providerSession: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          model: `${model.provider}/${model.id}`,
          threadId: input.threadId,
          createdAt,
          updatedAt: createdAt,
        };

        const ctx: PiSessionContext = {
          threadId: input.threadId,
          session: providerSession,
          sdk: created.session as unknown as PiSdkSession,
          unsubscribe: () => {},
          activeTurnId: undefined,
          turns: [],
          stopped: false,
        };
        ctx.unsubscribe = created.session.subscribe((event) => {
          for (const mapped of mapSdkEvent(event, ctx)) {
            offerFromListener(mapped);
          }
        });
        sessions.set(input.threadId, ctx);

        yield* publish(makeEvent(input.threadId, { type: "session.started", payload: {} }));
        yield* publish(
          makeEvent(input.threadId, {
            type: "thread.started",
            payload: { providerThreadId: created.session.sessionId },
          }),
        );

        return providerSession;
      });

    const sendTurn = (input: ProviderSendTurnInput) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        if (ctx.activeTurnId && ctx.sdk.isStreaming) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `A Pi turn is already active for thread ${input.threadId}.`,
          });
        }

        const text = input.input?.trim() ?? "";
        const turnId = TurnId.make(randomUUID());
        ctx.activeTurnId = turnId;
        ctx.turns.push({ id: turnId, items: [] });

        yield* publish(
          makeEvent(input.threadId, {
            type: "turn.started",
            turnId,
            payload: input.modelSelection?.model ? { model: input.modelSelection.model } : {},
          }),
        );
        yield* publish(
          makeEvent(input.threadId, {
            type: "item.started",
            turnId,
            itemId: RuntimeItemId.make(`${turnId}:assistant`),
            payload: { itemType: "assistant_message", status: "inProgress" },
          }),
        );

        // Drive the prompt on a detached fiber so sendTurn returns the turn id
        // immediately while content streams. Settlement (completed / failed /
        // aborted) is emitted when the prompt resolves.
        const turnRunner = Effect.tryPromise({
          try: () => ctx.sdk.prompt(text),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "sendTurn",
              detail: `Pi turn failed: ${cause instanceof Error ? cause.message : String(cause)}.`,
              cause,
            }),
        }).pipe(
          Effect.matchEffect({
            onFailure: (cause) => {
              const classification = classifyPiTurnFailure(cause);
              return classification.kind === "interrupted"
                ? settleTurn(input.threadId, turnId, {
                    state: "aborted",
                    reason: classification.reason,
                  })
                : settleTurn(input.threadId, turnId, {
                    state: "failed",
                    reason: classification.reason,
                  });
            },
            onSuccess: () => settleTurn(input.threadId, turnId, { state: "completed" }),
          }),
          Effect.asVoid,
        );
        Effect.runFork(turnRunner);

        return { threadId: input.threadId, turnId } satisfies ProviderTurnStartResult;
      });

    const interruptTurn = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        yield* Effect.tryPromise({
          try: () => ctx.sdk.abort(),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "interruptTurn",
              detail: `Failed to interrupt Pi turn: ${cause instanceof Error ? cause.message : String(cause)}.`,
              cause,
            }),
        });
      });

    const stopSession = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const ctx = sessions.get(threadId);
        if (!ctx) return;
        teardownSession(ctx);
        yield* publish(
          makeEvent(threadId, {
            type: "session.exited",
            payload: { reason: "Pi session stopped.", exitKind: "graceful" },
          }),
        );
      });

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "unsupported" },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest: () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToRequest",
            detail: "Pi approval requests are not yet wired in this build.",
          }),
        ),
      respondToUserInput: () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToUserInput",
            detail: "Pi extension UI bridge is not yet wired in this build.",
          }),
        ),
      stopSession,
      listSessions: () => Effect.succeed(Array.from(sessions.values()).map((ctx) => ctx.session)),
      hasSession: (threadId: ThreadId) => Effect.succeed(sessions.has(threadId)),
      readThread: (threadId: ThreadId) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          return {
            threadId,
            turns: ctx.turns.map((turn) => ({ id: turn.id, items: turn.items })),
          };
        }),
      rollbackThread: () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "rollbackThread",
            detail: "Pi thread rollback is not yet wired in this build.",
          }),
        ),
      stopAll: () =>
        Effect.gen(function* () {
          const threadIds = Array.from(sessions.keys());
          yield* Effect.forEach(threadIds, (threadId) => stopSession(threadId), { discard: true });
        }),
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies ProviderAdapterShape<ProviderAdapterError>;
  });
}
