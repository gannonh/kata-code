/**
 * PiAdapter — maps the in-process Pi SDK (`AgentSession`) onto Kata's
 * `ProviderAdapterShape`.
 *
 * Implements: start (with resume cursor), send turn, stream assistant text
 * and reasoning deltas, tool lifecycle, interrupt, stop, readThread,
 * rollbackThread, and compactThread. The extension-UI bridge and
 * runtime-mode enforcement remain typed errors, layered on later.
 *
 * @module provider/Layers/PiAdapter
 */
import { randomUUID } from "node:crypto";
import {
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  type ChatAttachment,
  EventId,
  type PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderItemId,
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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape, ProviderThreadSnapshot } from "../Services/ProviderAdapter.ts";
import { classifyPiTurnFailure } from "../piTurnFailure.ts";
import {
  type PiModelShape,
  createPiRegistries,
  piModelSlug,
  resolvePiAgentDir,
} from "./PiProvider.ts";
import { mapPiMessageHistory } from "./piThreadHistory.ts";
import {
  type PiTrackedToolCall,
  toolItemType,
  toolLifecycleData,
  toolResultDetail,
  toolTitle,
} from "./piToolLifecycle.ts";

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

interface PiTrackedTurn {
  readonly id: TurnId;
  leafId?: string;
}

interface PiSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly sdk: PiSdkSession;
  unsubscribe: () => void;
  activeTurnId: TurnId | undefined;
  turnFiber: Fiber.Fiber<void, never> | undefined;
  stopped: boolean;
  activeToolItems: Map<string, PiTrackedToolCall>;
  /** Completed turns in order, each with the SDK leaf id at settlement. */
  turns: PiTrackedTurn[];
}

/**
 * The slice of the Pi SDK `AgentSession` this adapter depends on. Extracted as
 * a type so unit tests can substitute a minimal double without the full SDK.
 */
export interface PiSdkSession {
  readonly sessionId: string;
  /** Session file path, when the session is backed by a file (resume cursor). */
  readonly sessionFile?: string;
  /** Session manager: exposes leaf ids, branching, and entries for rollback/read. */
  readonly sessionManager?: PiSdkSessionManager;
  /** Compact the session's context (emits compaction_start/compaction_end). */
  compact(customInstructions?: string): Promise<void>;
  /** Resolved message history for readThread snapshots. */
  readonly messages?: unknown[];
  prompt(
    text: string,
    options?: { images?: unknown[]; streamingBehavior?: "steer" | "followUp" },
  ): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  readonly isStreaming: boolean;
}

/** The `SessionManager` surface this adapter uses for rollback and reads. */
export interface PiSdkSessionManager {
  getLeafId(): string | null;
  branch(branchFromId: string): void;
  resetLeaf(): void;
  getEntries(): unknown[];
}

type TurnOutcome =
  | { readonly state: "completed" }
  | { readonly state: "failed"; readonly reason: string }
  | { readonly state: "aborted"; readonly reason: string };

export function makePiAdapter(
  piSettings: PiSettings,
  options?: PiAdapterLiveOptions,
): Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, never, Scope.Scope> {
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

    const makeEvent = <E extends ProviderRuntimeEvent>(
      threadId: ThreadId,
      partial: Omit<E, "eventId" | "createdAt" | "provider" | "providerInstanceId" | "threadId">,
    ): E => {
      const event: Record<string, unknown> = {
        ...partial,
        ...stampSync(),
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        threadId,
      };
      // exactOptionalPropertyTypes: optional branded fields must be absent,
      // not explicitly undefined.
      for (const key of ["turnId", "itemId", "requestId", "providerRefs", "raw"] as const) {
        if (event[key] === undefined) delete event[key];
      }
      return event as E;
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

    const toolEventRaw = (event: AgentSessionEvent) => ({
      source: "pi.sdk.event" as const,
      messageType: event.type,
      payload: event,
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
      if (event.type === "tool_execution_start") {
        const itemId = RuntimeItemId.make(`pi-tool-${event.toolCallId}`);
        const itemType = toolItemType(event.toolName);
        const tracked: PiTrackedToolCall = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          itemType,
        };
        ctx.activeToolItems.set(event.toolCallId, tracked);
        const title = toolTitle(event.toolName, event.args);
        return [
          makeEvent(ctx.threadId, {
            type: "item.started",
            turnId,
            itemId,
            providerRefs: { providerItemId: ProviderItemId.make(event.toolCallId) },
            payload: {
              itemType,
              status: "inProgress",
              title,
              data: toolLifecycleData({
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
              }),
            },
            raw: toolEventRaw(event),
          }),
        ];
      }
      if (event.type === "tool_execution_update") {
        const tracked = ctx.activeToolItems.get(event.toolCallId);
        if (!tracked) return [];
        const detail = toolResultDetail(event.partialResult);
        return [
          makeEvent(ctx.threadId, {
            type: "item.updated",
            turnId,
            itemId: RuntimeItemId.make(`pi-tool-${event.toolCallId}`),
            providerRefs: { providerItemId: ProviderItemId.make(event.toolCallId) },
            payload: {
              itemType: tracked.itemType,
              status: "inProgress",
              title: toolTitle(event.toolName, tracked.args),
              ...(detail ? { detail } : {}),
              data: toolLifecycleData({
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: tracked.args,
                partialResult: event.partialResult,
              }),
            },
            raw: toolEventRaw(event),
          }),
        ];
      }
      if (event.type === "tool_execution_end") {
        const tracked = ctx.activeToolItems.get(event.toolCallId);
        ctx.activeToolItems.delete(event.toolCallId);
        const itemId = RuntimeItemId.make(`pi-tool-${event.toolCallId}`);
        const itemType = tracked?.itemType ?? toolItemType(event.toolName);
        const args = tracked?.args;
        const title = toolTitle(event.toolName, args);
        const detail = toolResultDetail(event.result);
        return [
          makeEvent(ctx.threadId, {
            type: "item.completed",
            turnId,
            itemId,
            providerRefs: { providerItemId: ProviderItemId.make(event.toolCallId) },
            payload: {
              itemType,
              status: event.isError ? "failed" : "completed",
              title,
              ...(detail ? { detail } : {}),
              data: toolLifecycleData({
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args,
                result: event.result,
                isError: event.isError,
              }),
            },
            raw: toolEventRaw(event),
          }),
        ];
      }
      if (event.type === "compaction_start") {
        const itemId = RuntimeItemId.make(`pi-compaction-${randomUUID()}`);
        return [
          makeEvent(ctx.threadId, {
            type: "item.updated",
            turnId,
            itemId,
            payload: {
              itemType: "context_compaction",
              status: "inProgress",
              title: "Compacting context",
            },
            raw: toolEventRaw(event),
          }),
        ];
      }
      if (event.type === "compaction_end") {
        const itemId = RuntimeItemId.make(`pi-compaction-${randomUUID()}`);
        return [
          makeEvent(ctx.threadId, {
            type: "item.completed",
            turnId,
            itemId,
            payload: {
              itemType: "context_compaction",
              status: event.aborted ? "failed" : "completed",
              title: "Context compacted",
              data: event,
            },
            raw: toolEventRaw(event),
          }),
        ];
      }
      // Turn and item settlement are owned solely by settleTurn (called when
      // prompt() resolves/rejects). SDK turn_end/agent_end events are not
      // mapped here to avoid duplicate turn.completed emissions.
      return [];
    };

    const availableModels = (options?.availableModels ??
      (modelRegistry.getAvailable() as ReadonlyArray<PiModelShape>)) as ReadonlyArray<PiModelShape>;

    const resolveModel = (
      modelSelection: ProviderSessionStartInput["modelSelection"],
    ): PiModelShape | undefined => {
      const slug = modelSelection?.model;
      if (slug) {
        const slash = slug.indexOf("/");
        if (slash > 0) return availableModels.find((model) => piModelSlug(model) === slug);
      }
      return availableModels[0];
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
        const itemId = RuntimeItemId.make(`${turnId}:assistant`);
        if (outcome.state === "aborted") {
          yield* publish(
            makeEvent(threadId, {
              type: "item.completed",
              turnId,
              itemId,
              payload: { itemType: "assistant_message", status: "failed" },
            }),
          );
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
            type: "item.completed",
            turnId,
            itemId,
            payload: {
              itemType: "assistant_message",
              status: outcome.state === "failed" ? "failed" : "completed",
            },
          }),
        );
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
        // Record the completed turn with the SDK session leaf id at
        // settlement so rollbackThread can branch back to this point. Aborted
        // turns are not recorded: they produced no committed history.
        const ctx = sessions.get(threadId);
        if (ctx && outcome.state === "completed") {
          const leafId = ctx.sdk.sessionManager?.getLeafId() ?? undefined;
          ctx.turns.push({ id: turnId, ...(leafId ? { leafId } : {}) });
        }
      });

    /**
     * Tear down a session's SDK resources without publishing a lifecycle
     * event. Aborts an in-flight turn before disposing so the SDK stops
     * cleanly. The `stopped` flag prevents the detached turn fiber from
     * publishing stale settlement events after teardown.
     *
     * Used both by {@link stopSession} (which adds the `session.exited`
     * event) and by {@link startSession} when restarting an existing thread
     * (model switch), where a synthetic exit would confuse the UI.
     */
    const teardownSession = (ctx: PiSessionContext): Effect.Effect<void> =>
      Effect.gen(function* () {
        ctx.stopped = true;
        const fiber = ctx.turnFiber;
        if (ctx.activeTurnId && ctx.sdk.isStreaming) {
          // Abort the in-flight turn. Errors during teardown are non-fatal —
          // the stopped flag prevents stale settlement events from the
          // detached turn fiber.
          yield* Effect.promise(() =>
            ctx.sdk.abort().then(
              () => {},
              () => {},
            ),
          );
        }
        // Wait for the in-flight turn fiber to observe `stopped` and settle
        // before disposing the SDK session, so no settlement work runs after
        // dispose and callers can assert the final event list deterministically.
        // Bounded by a timeout in case the SDK does not honor abort.
        if (fiber) {
          yield* Fiber.join(fiber).pipe(Effect.timeout(Duration.seconds(2)), Effect.ignore);
        }
        ctx.unsubscribe();
        ctx.sdk.dispose();
        ctx.activeTurnId = undefined;
        ctx.turnFiber = undefined;
        ctx.activeToolItems.clear();
        ctx.turns = [];
        sessions.delete(ctx.threadId);
      });

    const startSession = (input: ProviderSessionStartInput) =>
      Effect.gen(function* () {
        // A thread can re-enter startSession when the user switches models
        // mid-conversation. The Pi SDK session is bound to a single model at
        // creation, so restart it rather than rejecting the request.
        const existing = sessions.get(input.threadId);
        if (existing) {
          yield* teardownSession(existing);
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
            // Build the resource loader ourselves so project trust follows
            // `piSettings.projectTrustPolicy`: "never" (default) keeps
            // project-local .pi/.agents/skills resources out of the session,
            // "always" loads them. Without this, the SDK defaults to
            // projectTrusted=true and bypasses the configured policy.
            const resourceLoader = new DefaultResourceLoader({
              cwd,
              agentDir,
            });
            await resourceLoader.reload({
              resolveProjectTrust: () =>
                Promise.resolve(piSettings.projectTrustPolicy === "always"),
            });
            // A resume cursor is a Pi session file path. Open the existing
            // session file instead of creating a fresh in-memory one so the
            // resumed session inherits the prior conversation history.
            const resumeCursor =
              typeof input.resumeCursor === "string" && input.resumeCursor.length > 0
                ? input.resumeCursor
                : undefined;
            const sessionManager = resumeCursor
              ? SessionManager.open(resumeCursor, undefined, cwd)
              : SessionManager.inMemory(cwd);
            return factory({
              cwd,
              ...(agentDir ? { agentDir } : {}),
              model: model as never,
              ...(thinkingLevel ? { thinkingLevel: thinkingLevel as never } : {}),
              authStorage,
              modelRegistry,
              resourceLoader,
              sessionManager,
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

        const sdkSession = created.session as unknown as PiSdkSession;
        const resumeCursor = sdkSession.sessionFile;
        const createdAt = DateTime.formatIso(DateTime.nowUnsafe());
        const providerSession: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          model: `${model.provider}/${model.id}`,
          threadId: input.threadId,
          ...(resumeCursor ? { resumeCursor } : {}),
          createdAt,
          updatedAt: createdAt,
        };

        const ctx: PiSessionContext = {
          threadId: input.threadId,
          session: providerSession,
          sdk: sdkSession,
          unsubscribe: () => {},
          activeTurnId: undefined,
          turnFiber: undefined,
          stopped: false,
          activeToolItems: new Map(),
          turns: [],
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
            payload: { providerThreadId: sdkSession.sessionId },
          }),
        );

        return providerSession;
      });

    /**
     * Materialize image attachments into base64 `ImageContent` blocks for the
     * Pi SDK `prompt(text, { images })` call. ServerConfig and FileSystem are
     * acquired lazily via `Effect.serviceOption` so the no-attachment path
     * stays synchronous and existing tests (which provide neither service)
     * keep working. When attachments are present but ServerConfig is missing,
     * the effect fails loud with a typed validation error.
     */
    const buildPromptImages = (
      attachments: ReadonlyArray<ChatAttachment> | undefined,
    ): Effect.Effect<ReadonlyArray<unknown>, ProviderAdapterError> =>
      Effect.gen(function* () {
        if (!attachments || attachments.length === 0) return [];
        const serverConfigOption = yield* Effect.serviceOption(ServerConfig);
        if (serverConfigOption._tag === "None") {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue:
              "Pi image attachments require ServerConfig, which is not available in this context.",
          });
        }
        const { attachmentsDir } = serverConfigOption.value;
        const fileSystemOption = yield* Effect.serviceOption(FileSystem.FileSystem);
        if (fileSystemOption._tag === "None") {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue:
              "Pi image attachments require FileSystem, which is not available in this context.",
          });
        }
        const fs = fileSystemOption.value;
        const images: Array<unknown> = [];
        for (const attachment of attachments) {
          if (attachment.type !== "image") continue;
          const attachmentPath = resolveAttachmentPath({ attachmentsDir, attachment });
          if (!attachmentPath) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: `Invalid attachment id '${attachment.id}'.`,
            });
          }
          const bytes = yield* fs.readFile(attachmentPath).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "sendTurn",
                  detail: `Failed to read attachment file: ${cause instanceof Error ? cause.message : String(cause)}.`,
                  cause,
                }),
            ),
          );
          images.push({
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: attachment.mimeType,
          });
        }
        return images;
      });

    const sendTurn = (input: ProviderSendTurnInput) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        // `activeTurnId` is the sole concurrent-turn gate. It is set
        // synchronously below and cleared in the turn runner when the prompt
        // settles, so a second sendTurn arriving before the SDK flips
        // `isStreaming` cannot start a overlapping prompt on the same session.
        if (ctx.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `A Pi turn is already active for thread ${input.threadId}.`,
          });
        }

        const text = input.input?.trim() ?? "";
        // Resolve image attachments before starting the turn. Failures (missing
        // services, invalid attachment ids, read errors) surface as typed
        // adapter errors before `turn.started` is published, so no orphaned
        // turn lifecycle is emitted for a rejected image materialization.
        const images = yield* buildPromptImages(input.attachments);

        const turnId = TurnId.make(randomUUID());
        ctx.activeTurnId = turnId;

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
        // aborted) is emitted when the prompt resolves. The `ctx.stopped` flag
        // is checked before settling so teardown doesn't produce stale events.
        const promptOptions = images.length > 0 ? { images: [...images] as unknown[] } : undefined;
        const turnRunner = Effect.tryPromise({
          try: () => (promptOptions ? ctx.sdk.prompt(text, promptOptions) : ctx.sdk.prompt(text)),
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
              if (ctx.stopped) return Effect.void;
              ctx.activeTurnId = undefined;
              ctx.turnFiber = undefined;
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
            onSuccess: () => {
              if (ctx.stopped) return Effect.void;
              ctx.activeTurnId = undefined;
              ctx.turnFiber = undefined;
              return settleTurn(input.threadId, turnId, { state: "completed" });
            },
          }),
          Effect.asVoid,
        );
        ctx.turnFiber = Effect.runFork(turnRunner);

        const resumeCursor = ctx.sdk.sessionFile;
        return {
          threadId: input.threadId,
          turnId,
          ...(resumeCursor ? { resumeCursor } : {}),
        } satisfies ProviderTurnStartResult;
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
        yield* teardownSession(ctx);
        yield* publish(
          makeEvent(threadId, {
            type: "session.exited",
            payload: { reason: "Pi session stopped.", exitKind: "graceful" },
          }),
        );
      });

    const stopAll = () =>
      Effect.gen(function* () {
        const threadIds = Array.from(sessions.keys());
        yield* Effect.forEach(threadIds, (threadId) => stopSession(threadId), { discard: true });
      });

    /**
     * Build a {@link ProviderThreadSnapshot} from the SDK session's message
     * history. The history is rendered as a single synthetic turn so the
     * snapshot preserves message order without needing SDK turn boundaries.
     */
    const snapshotThread = (ctx: PiSessionContext): ProviderThreadSnapshot => {
      const historyItems = mapPiMessageHistory(ctx.sdk.messages ?? []);
      const turns =
        historyItems.length > 0
          ? [
              {
                id: TurnId.make(`pi-history-${ctx.sdk.sessionId}`),
                items: historyItems,
              },
            ]
          : [];
      return { threadId: ctx.threadId, turns };
    };

    const readThread = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        return snapshotThread(ctx);
      });

    const rollbackThread = (threadId: ThreadId, numTurns: number) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const sessionManager = ctx.sdk.sessionManager;
        if (!sessionManager) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "rollbackThread",
            detail: "Pi session does not support rollback (no session manager).",
          });
        }
        const rollbackCount = Math.max(0, Math.floor(numTurns));
        const nextLength = Math.max(0, ctx.turns.length - rollbackCount);
        ctx.turns = ctx.turns.slice(0, nextLength);
        const targetLeafId = ctx.turns[nextLength - 1]?.leafId;
        if (targetLeafId) {
          sessionManager.branch(targetLeafId);
        } else if (nextLength === 0) {
          // Rolling back every tracked turn resets the session leaf to the
          // root so the next turn starts a fresh branch.
          sessionManager.resetLeaf();
        }
        return snapshotThread(ctx);
      });

    const compactThread = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        yield* Effect.tryPromise({
          try: () => ctx.sdk.compact(),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "thread/compact",
              detail: `Failed to compact Pi thread: ${cause instanceof Error ? cause.message : String(cause)}.`,
              cause,
            }),
        });
      });

    // Tear down SDK sessions and the runtime event PubSub when the adapter's
    // scope closes (instance removal/rebuild or registry shutdown). Without
    // this finalizer, old Pi SDK sessions survive rebuilds and
    // `ProviderService` subscription fibers keep waiting because
    // `streamEvents` never terminates.
    yield* Effect.addFinalizer(() =>
      stopAll().pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Failed to shut down Pi adapter sessions.", { cause }),
        ),
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
      ),
    );

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
      readThread,
      rollbackThread,
      compactThread,
      stopAll,
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies ProviderAdapterShape<ProviderAdapterError>;
  });
}
