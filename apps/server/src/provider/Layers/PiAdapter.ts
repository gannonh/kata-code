/**
 * PiAdapter — maps the in-process Pi SDK (`AgentSession`) onto Kata's
 * `ProviderAdapterShape`.
 *
 * Implements: start (with resume cursor), send turn, stream assistant text
 * and reasoning deltas, tool lifecycle, interrupt, stop, readThread,
 * rollbackThread, and compactThread. The extension-UI bridge translates Pi
 * `select`/`confirm`/`input`/`notify`/status/progress onto Kata user-input
 * and runtime events, and emits one visible warning per unsupported
 * TUI-only method per session. Runtime-mode enforcement remains a typed
 * error, layered on later.
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
import { APP_BASE_NAME } from "@kata-sh/code-shared/branding";
import {
  ApprovalRequestId,
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
  RuntimeRequestId,
  type ThreadId,
  TurnId,
  type ProviderUserInputAnswers,
  type UserInputQuestion,
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
  type PiExtensionUIContext,
  type PiExtensionUIDialogOptions,
  PLAIN_PI_EXTENSION_THEME,
  firstPiUserInputAnswer,
  makePiUserInputOption,
  makePiUserInputOptions,
  trimToUndefined,
} from "./piExtensionUi.ts";
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

/**
 * Human-readable descriptions of the Pi extension UI capabilities that only
 * work in Pi's terminal (TUI) mode and have no equivalent in Kata Code's
 * graphical interface. Used to phrase the one-time "skipped" warning a Pi
 * extension triggers when it calls one of these APIs. Keyed by the SDK method
 * name passed to `warnUnsupported`.
 */
const PI_TUI_ONLY_CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  onTerminalInput: "to read raw terminal keystrokes",
  setWidget: "to draw a custom terminal widget",
  setFooter: "to replace the terminal footer",
  setHeader: "to replace the terminal header",
  custom: "to render a custom terminal screen",
  pasteToEditor: "to paste text into a terminal editor",
  setEditorComponent: "to replace the input editor",
  addAutocompleteProvider: "to add terminal input autocomplete",
};

export interface PiAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
  /** Override SDK session creation for tests. */
  readonly createSession?: typeof createAgentSession;
  /** Override the model list used for selection (tests); defaults to the registry. */
  readonly availableModels?: ReadonlyArray<PiModelShape>;
  /** Observe published runtime events without subscribing to the stream (tests). */
  readonly onEvent?: (event: ProviderRuntimeEvent) => void;
  /** Observe the extension UI context bound to each started session (tests).
   *  Lets a test invoke `uiContext.select(...)` then call
   *  `adapter.respondToUserInput(...)` through the public adapter interface. */
  readonly onUiContext?: (uiContext: PiExtensionUIContext) => void;
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
  /** Pending extension-UI dialog requests keyed by ApprovalRequestId. */
  pendingUserInputs: Map<string, { resolve: (answers: ProviderUserInputAnswers) => void }>;
  /** TUI-only extension methods that have already emitted a warning this session. */
  unsupportedWarnings: Set<string>;
  /** Last status text per key (dedupe so repeated setStatus calls don't spam). */
  statusTexts: Map<string, string>;
  /** Last working message (dedupe so repeated setWorkingMessage calls don't spam). */
  workingMessage: string | undefined;
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
  /** Bind an extension UI context (and other extension bindings) to the
   *  session. The real `AgentSession.bindExtensions` is async; the adapter
   *  calls it after subscribing to events so extension UI requests route
   *  through the Kata user-input runtime event channel. */
  bindExtensions(bindings: { uiContext?: unknown }): Promise<void>;
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

    /** Build a canonical `runtime.warning` event. Callers emit via `publish`
     *  (inside an Effect) or `offerFromListener` (from the sync SDK listener).
     *  Centralizes the `pi.sdk.event` raw envelope so each warning site states
     *  only its `method`, `message`, and `detail`. */
    const piRuntimeWarning = (
      threadId: ThreadId,
      input: {
        readonly method: string;
        readonly message: string;
        readonly detail?: Record<string, unknown>;
        readonly payload?: Record<string, unknown>;
      },
    ): ProviderRuntimeEvent =>
      makeEvent(threadId, {
        type: "runtime.warning",
        payload: {
          message: input.message,
          ...(input.detail ? { detail: input.detail } : {}),
        },
        raw: {
          source: "pi.sdk.event",
          method: input.method,
          payload: input.payload ?? input.detail ?? {},
        },
      });

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
        // Pi compaction flows through the canonical `thread.state.changed`
        // path: ingestion admits `state === "compacted"` and renders a
        // context-compaction projection item, so the lifecycle is visible
        // end-to-end. The `active` state signals compaction is in progress;
        // `compaction_end` below flips it to `compacted`. This avoids the
        // `item.*` mapping, which ingestion drops because
        // `context_compaction` is not a tool-lifecycle item type, and avoids
        // the unpaired-random-itemId problem the item mapping had.
        return [
          makeEvent(ctx.threadId, {
            type: "thread.state.changed",
            turnId,
            payload: { state: "active", detail: "Compacting context" },
            raw: toolEventRaw(event),
          }),
        ];
      }
      if (event.type === "compaction_end") {
        // Carry abort/error/retry context in `detail` so it reaches the UI
        // via the context-compaction projection item. Falsy fields are
        // omitted to keep the payload compact.
        const detail: Record<string, unknown> = {
          aborted: event.aborted,
          willRetry: event.willRetry,
        };
        if (event.errorMessage) detail.errorMessage = event.errorMessage;
        if (event.result) detail.result = event.result;
        return [
          makeEvent(ctx.threadId, {
            type: "thread.state.changed",
            turnId,
            payload: { state: "compacted", detail },
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
      modelRegistry.getAvailable()) as ReadonlyArray<PiModelShape>;

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
        // Resolve any pending extension-UI dialogs as cancelled so the bridged
        // promises don't hang after the session tears down.
        for (const pending of Array.from(ctx.pendingUserInputs.values())) {
          pending.resolve({});
        }
        ctx.pendingUserInputs.clear();
        ctx.unsupportedWarnings.clear();
        ctx.statusTexts.clear();
        ctx.workingMessage = undefined;
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
          pendingUserInputs: new Map(),
          unsupportedWarnings: new Set(),
          statusTexts: new Map(),
          workingMessage: undefined,
        };
        ctx.unsubscribe = created.session.subscribe((event) => {
          for (const mapped of mapSdkEvent(event, ctx)) {
            offerFromListener(mapped);
          }
        });
        sessions.set(input.threadId, ctx);

        // Seed the tracked turn list with the resumed session's current leaf
        // so rollback math is anchored to real history. Without this, a
        // resumed session starts with an empty turn list and the first
        // rollback would reset the SDK leaf to the root, discarding the
        // entire resumed branch. The seed is a single synthetic turn at the
        // current leaf; rolling it back is an explicit user action.
        const resumedLeafId =
          resumeCursor && sdkSession.sessionManager
            ? typeof sdkSession.sessionManager.getLeafId === "function"
              ? sdkSession.sessionManager.getLeafId()
              : null
            : null;
        if (resumeCursor && resumedLeafId) {
          ctx.turns.push({
            id: TurnId.make(`pi-resumed-${createdAt}`),
            leafId: resumedLeafId,
          });
        }

        // Bind the Kata extension UI bridge so Pi extension `select`/`confirm`/
        // `input`/`notify`/status/progress calls route through the user-input
        // and runtime event channel. TUI-only APIs warn once per session.
        const uiContext = makePiExtensionUIContext(ctx);
        options?.onUiContext?.(uiContext);
        yield* Effect.tryPromise({
          try: () => sdkSession.bindExtensions({ uiContext }),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "extension/bind",
              detail: `Failed to bind Pi extension UI: ${
                cause instanceof Error ? cause.message : String(cause)
              }.`,
              cause,
            }),
        }).pipe(
          // Tear down the newly created session if extension binding fails,
          // so a retry on the same thread does not hit leaked session state
          // (live subscription + entry in `sessions`).
          Effect.catch((error: ProviderAdapterRequestError) =>
            teardownSession(ctx).pipe(Effect.andThen(Effect.fail(error))),
          ),
        );

        yield* publish(makeEvent(input.threadId, { type: "session.started", payload: {} }));
        yield* publish(
          makeEvent(input.threadId, {
            type: "thread.started",
            payload: { providerThreadId: sdkSession.sessionId },
          }),
        );

        // Pi's SDK exposes no enforceable approval/sandbox gate (its
        // ToolExecutionMode is only sequential/parallel). Map Kata runtime
        // modes to visible warnings so the limitation is surfaced, not
        // hidden behind a silent fallback. full-access needs no warning;
        // auto-accept-edits and approval-required emit a runtime.warning at
        // startSession so it is visible before the first turn.
        if (input.runtimeMode === "auto-accept-edits") {
          yield* publish(
            piRuntimeWarning(input.threadId, {
              method: "runtime-mode/auto-accept-edits",
              message:
                "Pi cannot enforce auto-accept-edits mode; this session runs as full-access.",
              detail: { runtimeMode: input.runtimeMode, treatedAs: "full-access" },
              payload: { runtimeMode: input.runtimeMode },
            }),
          );
        } else if (input.runtimeMode === "approval-required") {
          yield* publish(
            piRuntimeWarning(input.threadId, {
              method: "runtime-mode/approval-required",
              message:
                "Pi cannot enforce approval-required mode; tool calls will run without Kata approval gates. Review tool output before relying on this session.",
              detail: { runtimeMode: input.runtimeMode },
            }),
          );
        }

        // Surface the active project trust policy so loading project-local
        // .pi resources and project .agents/skills is a visible, explicit
        // decision. The default "never" keeps those resources out and needs
        // no warning; "always" is security-sensitive and states it is loaded.
        if (piSettings.projectTrustPolicy === "always") {
          yield* publish(
            piRuntimeWarning(input.threadId, {
              method: "project-trust/always",
              message:
                "Pi project trust policy is 'always': project-local .pi resources and project .agents/skills are loaded for this session.",
              detail: { projectTrustPolicy: piSettings.projectTrustPolicy },
            }),
          );
        }

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
        if (ctx.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: `Cannot roll back thread ${threadId} while a Pi turn is active.`,
          });
        }
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
        if (ctx.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "compactThread",
            issue: `Cannot compact thread ${threadId} while a Pi turn is active.`,
          });
        }
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

    /**
     * Resolve a pending extension-UI dialog request. Publishes
     * `user-input.resolved` and resolves the bridged promise. Fails loud when
     * no pending request matches `requestId` so a stale or mismatched response
     * is surfaced instead of silently dropped.
     */
    const respondToUserInput = (
      threadId: ThreadId,
      requestId: ApprovalRequestId,
      answers: ProviderUserInputAnswers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const key = requestId as unknown as string;
        const pending = ctx.pendingUserInputs.get(key);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToUserInput",
            detail: `No pending Pi user-input request for id '${key}'.`,
          });
        }
        ctx.pendingUserInputs.delete(key);
        pending.resolve(answers);
        yield* publish(
          makeEvent(threadId, {
            type: "user-input.resolved",
            requestId: RuntimeRequestId.make(key),
            payload: { answers },
            raw: {
              source: "pi.sdk.event",
              method: "extension/ui/answered",
              payload: { requestId: key, answers },
            },
          }),
        );
      });

    /**
     * Bridge a Pi extension UI dialog method (`select`/`confirm`/`input`/`editor`)
     * onto a `user-input.requested` event and wait for `respondToUserInput`.
     * Honors `opts.signal` (pre-aborted resolves immediately) and `opts.timeout`
     * (resolves cancelled after the timeout). Returns the cancelled result on
     * cancellation/timeout.
     */
    const requestExtensionUserInput = <T>(
      ctx: PiSessionContext,
      input: {
        readonly method: string;
        readonly question: UserInputQuestion;
        readonly cancelled: T;
        readonly opts?: PiExtensionUIDialogOptions;
        readonly rawPayload?: Record<string, unknown>;
      },
    ): Promise<T> => {
      const opts = input.opts;
      if (ctx.stopped || opts?.signal?.aborted) {
        return Promise.resolve(input.cancelled);
      }
      const requestId = randomUUID();
      const key = requestId;
      return new Promise<T>((resolve) => {
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        const cleanup = () => {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          if (onAbort && opts?.signal) {
            opts.signal.removeEventListener("abort", onAbort);
          }
        };
        const finish = (answers: ProviderUserInputAnswers) => {
          if (settled) return;
          settled = true;
          cleanup();
          ctx.pendingUserInputs.delete(key);
          // The answered case publishes `user-input.resolved` from
          // `respondToUserInput`. Cancellation/timeout paths publish it here.
          if (Object.keys(answers).length === 0) {
            offerFromListener(
              makeEvent(ctx.threadId, {
                type: "user-input.resolved",
                requestId: RuntimeRequestId.make(key),
                payload: { answers },
                raw: {
                  source: "pi.sdk.event",
                  method: `${input.method}/cancelled`,
                  payload: { requestId: key },
                },
              }),
            );
          }
          resolve(input.cancelled);
        };
        onAbort = () => finish({});
        ctx.pendingUserInputs.set(key, {
          resolve: (answers) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(answers as unknown as T);
          },
        });
        if (typeof opts?.timeout === "number" && opts.timeout > 0) {
          // The Pi extension UI dialog timeout is a plain wall-clock bound; an
          // Effect scheduler would require a runtime the synchronous SDK
          // listener does not own, so setTimeout is intentional here.
          // @effect-diagnostics-next-line globalTimers:off
          timeoutId = setTimeout(onAbort, opts.timeout);
        }
        if (opts?.signal) {
          opts.signal.addEventListener("abort", onAbort, { once: true });
        }
        offerFromListener(
          makeEvent(ctx.threadId, {
            type: "user-input.requested",
            requestId: RuntimeRequestId.make(key),
            payload: { questions: [input.question] },
            raw: {
              source: "pi.sdk.event",
              method: input.method,
              payload: input.rawPayload ?? { requestId: key, question: input.question },
            },
          }),
        );
      });
    };

    /**
     * Build the Kata `ExtensionUIContext` for a Pi session. Dialog methods
     * route through `requestExtensionUserInput`; `notify`/`setStatus`/
     * `setWorkingMessage`/`setTitle` map to `runtime.warning` or `tool.progress`;
     * TUI-only methods emit one `runtime.warning` per method per session then
     * return safe no-op values; harmless getters/state return plain defaults.
     */
    const makePiExtensionUIContext = (ctx: PiSessionContext): PiExtensionUIContext => {
      const emitPluginProgress = (summary: string) => {
        const normalized = trimToUndefined(summary);
        if (!normalized) return;
        offerFromListener(
          makeEvent(ctx.threadId, {
            type: "tool.progress",
            payload: { toolName: "Pi plugin", summary: normalized },
            raw: {
              source: "pi.sdk.event",
              method: "extension/ui-progress",
              payload: { summary: normalized },
            },
          }),
        );
      };
      const warnUnsupported = (method: string) => {
        if (ctx.unsupportedWarnings.has(method)) return;
        ctx.unsupportedWarnings.add(method);
        const capability =
          PI_TUI_ONLY_CAPABILITY_LABELS[method] ?? "a terminal-only display feature";
        offerFromListener(
          piRuntimeWarning(ctx.threadId, {
            method: "extension/ui-unsupported",
            message: `A Pi extension requested ${capability}, which ${APP_BASE_NAME}'s interface can't show. It was skipped; the conversation continues normally.`,
            detail: { method },
          }),
        );
      };
      const uiContext: PiExtensionUIContext = {
        async select(title, options, opts) {
          const questionId = "selection";
          const mappings = makePiUserInputOptions(options);
          const answers = await requestExtensionUserInput<ProviderUserInputAnswers>(ctx, {
            method: "extension/ui/select",
            ...(opts ? { opts } : {}),
            cancelled: {},
            question: {
              id: questionId,
              header: trimToUndefined(title) ?? "Pi plugin",
              question: trimToUndefined(title) ?? "Choose an option.",
              options: mappings.map((mapping) => mapping.option),
            },
            rawPayload: { title, options },
          });
          const answer = firstPiUserInputAnswer(answers, questionId);
          return mappings.find((mapping) => mapping.option.label === answer)?.value;
        },
        async confirm(title, message, opts) {
          const questionId = "confirmation";
          const answers = await requestExtensionUserInput<ProviderUserInputAnswers>(ctx, {
            method: "extension/ui/confirm",
            ...(opts ? { opts } : {}),
            cancelled: {},
            question: {
              id: questionId,
              header: trimToUndefined(title) ?? "Pi plugin",
              question:
                trimToUndefined(message) ?? trimToUndefined(title) ?? "Confirm this action?",
              options: [makePiUserInputOption("Yes"), makePiUserInputOption("No")],
            },
            rawPayload: { title, message },
          });
          return firstPiUserInputAnswer(answers, questionId) === "Yes";
        },
        async input(title, placeholder, opts) {
          const questionId = "input";
          const answers = await requestExtensionUserInput<ProviderUserInputAnswers>(ctx, {
            method: "extension/ui/input",
            ...(opts ? { opts } : {}),
            cancelled: {},
            question: {
              id: questionId,
              header: trimToUndefined(title) ?? "Pi plugin",
              question:
                trimToUndefined(placeholder) ?? trimToUndefined(title) ?? "Type a response.",
              options: [],
            },
            rawPayload: { title, placeholder },
          });
          return firstPiUserInputAnswer(answers, questionId);
        },
        notify(message, type) {
          const normalized = trimToUndefined(message);
          if (!normalized) return;
          if (type === "warning" || type === "error") {
            offerFromListener(
              piRuntimeWarning(ctx.threadId, {
                method: "extension/ui/notify",
                message: normalized,
                detail: { type: type ?? "info" },
                payload: { message: normalized, type },
              }),
            );
            return;
          }
          emitPluginProgress(normalized);
        },
        onTerminalInput() {
          warnUnsupported("onTerminalInput");
          return () => undefined;
        },
        setStatus(key, text) {
          const normalizedKey = trimToUndefined(key) ?? "status";
          const normalizedText = trimToUndefined(text);
          if (!normalizedText) {
            ctx.statusTexts.delete(normalizedKey);
            return;
          }
          if (ctx.statusTexts.get(normalizedKey) === normalizedText) return;
          ctx.statusTexts.set(normalizedKey, normalizedText);
          emitPluginProgress(`${normalizedKey}: ${normalizedText}`);
        },
        setWorkingMessage(message) {
          const normalized = trimToUndefined(message);
          if (!normalized) {
            // Clear the dedupe cache so a later repeat of the same message
            // emits tool.progress again instead of being suppressed.
            ctx.workingMessage = undefined;
            return;
          }
          if (normalized === ctx.workingMessage) return;
          ctx.workingMessage = normalized;
          emitPluginProgress(normalized);
        },
        setWorkingVisible() {},
        setWorkingIndicator() {},
        setHiddenThinkingLabel() {},
        setWidget() {
          warnUnsupported("setWidget");
        },
        setFooter() {
          warnUnsupported("setFooter");
        },
        setHeader() {
          warnUnsupported("setHeader");
        },
        setTitle(title) {
          if (title) emitPluginProgress(title);
        },
        async custom() {
          warnUnsupported("custom");
          return undefined as never;
        },
        pasteToEditor() {
          warnUnsupported("pasteToEditor");
        },
        setEditorText() {},
        getEditorText() {
          return "";
        },
        editor(title, prefill) {
          return uiContext.input(title, prefill);
        },
        addAutocompleteProvider() {
          warnUnsupported("addAutocompleteProvider");
        },
        setEditorComponent() {
          warnUnsupported("setEditorComponent");
        },
        getEditorComponent() {
          return undefined;
        },
        theme: PLAIN_PI_EXTENSION_THEME,
        getAllThemes() {
          return [];
        },
        getTheme() {
          return undefined;
        },
        setTheme() {
          return { success: false, error: `${APP_BASE_NAME} does not expose Pi themes.` };
        },
        getToolsExpanded() {
          return false;
        },
        setToolsExpanded() {},
      };
      return uiContext;
    };

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
      respondToUserInput,
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
