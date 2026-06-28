// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderRuntimeEvent,
  type ProviderRuntimeEvent as ProviderRuntimeEventType,
  ThreadId,
} from "@kata-sh/code-contracts";

import { attachmentRelativePath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { makePiAdapter, type PiSdkSession } from "./PiAdapter.ts";
import type { PiExtensionUIContext } from "./piExtensionUi.ts";
import type { PiModelShape } from "./PiProvider.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";
import type { ProviderAdapterError } from "../Errors.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

type PiSdkSessionEvent = Parameters<Parameters<PiSdkSession["subscribe"]>[0]>[0];

interface FakeSessionOptions {
  /** Session file path exposed as the resume cursor. */
  readonly sessionFile?: string;
  /** Session manager double for rollback/readThread tests. */
  readonly sessionManager?: PiSdkSession["sessionManager"];
  /** Resolved message history for readThread snapshots. */
  readonly messages?: unknown[];
  /** Implementation of compact() for compaction tests. */
  readonly compact?: () => Promise<void>;
}

interface FakeSessionHooks {
  emit: ((event: PiSdkSessionEvent) => void) | undefined;
  promptStarted: Promise<void>;
  resolvePrompt: () => void;
  rejectPrompt: (error: Error) => void;
  /** Args captured from the most recent `prompt` call (for image tests). */
  lastPromptArgs:
    | {
        text: string;
        options?: { images?: unknown[]; streamingBehavior?: "steer" | "followUp" } | undefined;
      }
    | undefined;
  /** Spy for compact() invocations. */
  compactCalls: number;
}

function makeFakeSession(options?: FakeSessionOptions): {
  session: PiSdkSession;
  hooks: FakeSessionHooks;
} {
  let markPromptStarted: () => void = () => {};
  const promptStarted = new Promise<void>((resolve) => {
    markPromptStarted = resolve;
  });
  const hooks: FakeSessionHooks = {
    emit: undefined,
    promptStarted,
    resolvePrompt: () => {},
    rejectPrompt: () => {},
    lastPromptArgs: undefined,
    compactCalls: 0,
  };
  const session: PiSdkSession = {
    sessionId: "pi-session-1",
    ...(options?.sessionFile ? { sessionFile: options.sessionFile } : {}),
    ...(options?.sessionManager ? { sessionManager: options.sessionManager } : {}),
    ...(options?.messages ? { messages: options.messages } : {}),
    compact: options?.compact
      ? () => {
          hooks.compactCalls += 1;
          return options.compact!();
        }
      : () => {
          hooks.compactCalls += 1;
          return Promise.resolve();
        },
    isStreaming: true,
    subscribe: (listener) => {
      hooks.emit = listener;
      return () => {};
    },
    prompt: (text, opts) => {
      hooks.lastPromptArgs = { text, options: opts };
      markPromptStarted();
      return new Promise<void>((resolve, reject) => {
        hooks.resolvePrompt = resolve;
        hooks.rejectPrompt = reject;
      });
    },
    abort: () => {
      hooks.rejectPrompt(new Error("The operation was aborted."));
      return Promise.resolve();
    },
    dispose: () => {},
    bindExtensions: () => Promise.resolve(),
  };
  return { session, hooks };
}

function makeEventRecorder() {
  const events: ProviderRuntimeEventType[] = [];
  let waiters: Array<{
    readonly predicate: (event: ProviderRuntimeEventType) => boolean;
    readonly resolve: () => void;
  }> = [];
  return {
    events,
    onEvent: (event: ProviderRuntimeEventType) => {
      events.push(event);
      const pending: typeof waiters = [];
      for (const waiter of waiters) {
        if (waiter.predicate(event)) waiter.resolve();
        else pending.push(waiter);
      }
      waiters = pending;
    },
    waitFor: (predicate: (event: ProviderRuntimeEventType) => boolean) =>
      new Promise<void>((resolve) => {
        if (events.some(predicate)) {
          resolve();
          return;
        }
        waiters.push({ predicate, resolve });
      }),
  };
}

const SAMPLE_MODEL: PiModelShape = {
  id: "claude-opus-4-6",
  name: "Claude Opus 4.6",
  provider: "anthropic",
  reasoning: true,
};

const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("pi"),
  model: "anthropic/claude-opus-4-6",
} as const;

describe("makePiAdapter (vertical slice)", () => {
  it.effect("streams a successful turn as a canonical event sequence", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session, hooks } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-1");
      const started = yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      expect(started.status).toBe("ready");
      expect(started.model).toBe("anthropic/claude-opus-4-6");

      const turn = yield* adapter.sendTurn({ threadId, input: "hello" });
      expect(turn.threadId).toBe(threadId);
      yield* Effect.tryPromise(() => hooks.promptStarted);

      hooks.emit?.({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hi" },
      } as PiSdkSessionEvent);

      // Emit SDK terminal events (turn_end, agent_end) before prompt resolves.
      // These must NOT produce duplicate turn.completed or item.completed
      // events — settleTurn is the sole settlement owner.
      hooks.emit?.({ type: "turn_end", message: null, toolResults: [] } as never);
      hooks.emit?.({ type: "agent_end", messages: [], willRetry: false } as never);

      hooks.resolvePrompt();
      yield* Effect.tryPromise(() => recorder.waitFor((event) => event.type === "turn.completed"));

      const types = recorder.events.map((event) => event.type);
      expect(types).toEqual(
        expect.arrayContaining([
          "session.started",
          "thread.started",
          "turn.started",
          "item.started",
          "content.delta",
          "item.completed",
          "turn.completed",
        ]),
      );
      // B1: exactly one turn.completed and one item.completed — not duplicated
      // by SDK turn_end/agent_end events.
      expect(types.filter((t) => t === "turn.completed")).toHaveLength(1);
      expect(types.filter((t) => t === "item.completed")).toHaveLength(1);
      const delta = recorder.events.find(
        (event) => event.type === "content.delta" && event.payload.streamKind === "assistant_text",
      );
      expect((delta?.payload as { readonly delta?: string } | undefined)?.delta).toBe("Hi");
    }),
  );

  it.effect("classifies an interrupted turn as aborted, not failed", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session, hooks } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-2");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      yield* adapter.sendTurn({ threadId, input: "long running" });
      yield* Effect.tryPromise(() => hooks.promptStarted);
      yield* adapter.interruptTurn(threadId);
      yield* Effect.tryPromise(() => recorder.waitFor((event) => event.type === "turn.aborted"));

      const types = recorder.events.map((event) => event.type);
      expect(types).toContain("turn.aborted");
      expect(types).not.toContain("turn.completed");
      // B2: item.completed must close the orphaned item.started
      expect(types).toContain("item.completed");
      const itemCompleted = recorder.events.find((event) => event.type === "item.completed");
      expect((itemCompleted?.payload as { readonly status?: string })?.status).toBe("failed");
    }),
  );

  it.effect("emits item.completed with failed status on a failed turn", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session, hooks } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-fail");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      yield* adapter.sendTurn({ threadId, input: "broken" });
      yield* Effect.tryPromise(() => hooks.promptStarted);
      hooks.rejectPrompt(new Error("API rate limit exceeded"));
      yield* Effect.tryPromise(() => recorder.waitFor((event) => event.type === "turn.completed"));

      const types = recorder.events.map((event) => event.type);
      expect(types).toContain("turn.completed");
      expect(types).toContain("item.completed");
      const turnCompleted = recorder.events.find((event) => event.type === "turn.completed");
      expect((turnCompleted?.payload as { readonly state?: string })?.state).toBe("failed");
      const itemCompleted = recorder.events.find((event) => event.type === "item.completed");
      expect((itemCompleted?.payload as { readonly status?: string })?.status).toBe("failed");
    }),
  );

  it.effect("emits session.exited when a session is stopped", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-3");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      yield* adapter.stopSession(threadId);
      yield* Effect.tryPromise(() => recorder.waitFor((event) => event.type === "session.exited"));

      expect(recorder.events.some((event) => event.type === "session.exited")).toBe(true);
    }),
  );

  it.effect("does not emit stale turn events when stopped during streaming", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session, hooks } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-stop-streaming");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      yield* adapter.sendTurn({ threadId, input: "long running" });
      yield* Effect.tryPromise(() => hooks.promptStarted);

      // R1+R2: stopSession during streaming aborts the turn, but the stopped
      // flag prevents the turn fiber from publishing stale settlement events
      // after session.exited. teardownSession awaits the turn fiber before
      // disposing, so by the time stopSession returns the fiber has settled
      // and no late turn.aborted/turn.completed can slip past this assertion.
      yield* adapter.stopSession(threadId);

      // session.exited is published synchronously within stopSession.
      const types = recorder.events.map((event) => event.type);
      expect(types).toContain("session.exited");
      expect(types).not.toContain("turn.aborted");
      expect(types).not.toContain("turn.completed");
    }),
  );

  it.effect("restarts an existing thread session instead of failing (model switch)", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const first = makeFakeSession();
      const second = makeFakeSession();
      let disposedFirst = false;
      first.session.dispose = () => {
        disposedFirst = true;
      };
      const queue = [first.session, second.session];
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session: queue.shift() })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-restart");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });

      const restarted = yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });

      expect(restarted.status).toBe("ready");
      expect(disposedFirst).toBe(true);

      // The restarted session must still accept turns.
      const turn = yield* adapter.sendTurn({ threadId, input: "hello again" });
      expect(turn.threadId).toBe(threadId);
      yield* Effect.tryPromise(() => second.hooks.promptStarted);
    }),
  );

  it.effect("rejects a second concurrent turn while one is active", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session, hooks } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-concurrent");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      yield* adapter.sendTurn({ threadId, input: "first" });
      yield* Effect.tryPromise(() => hooks.promptStarted);

      // A second turn before the first settles must be rejected without
      // dispatching another prompt — `activeTurnId` alone gates concurrency.
      const result = yield* Effect.exit(adapter.sendTurn({ threadId, input: "second" }));
      expect(Exit.isFailure(result)).toBe(true);
    }),
  );

  it.effect("allows a new turn after the previous turn settles", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session, hooks } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-settle-then-resume");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      yield* adapter.sendTurn({ threadId, input: "first" });
      yield* Effect.tryPromise(() => hooks.promptStarted);
      hooks.resolvePrompt();
      yield* Effect.tryPromise(() => recorder.waitFor((event) => event.type === "turn.completed"));

      // activeTurnId is cleared on settlement, so a follow-up turn is accepted.
      const second = yield* adapter.sendTurn({ threadId, input: "second" });
      expect(second.threadId).toBe(threadId);
    }),
  );

  it.effect(
    "includes a resumeCursor on the returned session and opens the session file when resuming",
    () =>
      Effect.gen(function* () {
        const recorder = makeEventRecorder();
        const { session } = makeFakeSession({ sessionFile: "/tmp/pi-session.jsonl" });
        // Spy on the real SessionManager factory methods so the test verifies
        // which construction path the adapter took, through the public
        // startSession interface.
        const openSpy = vi
          .spyOn(SessionManager, "open")
          .mockImplementation(() => ({ getCwd: () => "/tmp" }) as never);
        const inMemorySpy = vi
          .spyOn(SessionManager, "inMemory")
          .mockImplementation(() => ({ getCwd: () => "/tmp" }) as never);
        try {
          const adapter = yield* makePiAdapter(decodePiSettings({}), {
            instanceId: ProviderInstanceId.make("pi"),
            availableModels: [SAMPLE_MODEL],
            createSession: (() => Promise.resolve({ session })) as never,
            onEvent: recorder.onEvent,
          });

          const threadId = ThreadId.make("pi-thread-resume-1");
          const started = yield* adapter.startSession({
            threadId,
            runtimeMode: "full-access",
            modelSelection: MODEL_SELECTION,
          });
          // A fresh in-memory session still surfaces its session file as a
          // resume cursor so callers can persist it for later resumption.
          expect(started.resumeCursor).toBe("/tmp/pi-session.jsonl");
          expect(inMemorySpy).toHaveBeenCalledTimes(1);
          expect(openSpy).not.toHaveBeenCalled();

          // Resuming with the captured cursor opens the session file instead of
          // creating a fresh in-memory session.
          const resumed = yield* adapter.startSession({
            threadId: ThreadId.make("pi-thread-resume-2"),
            runtimeMode: "full-access",
            modelSelection: MODEL_SELECTION,
            resumeCursor: "/tmp/pi-session.jsonl",
          });
          expect(resumed.resumeCursor).toBe("/tmp/pi-session.jsonl");
          expect(openSpy).toHaveBeenCalledTimes(1);
          expect(openSpy).toHaveBeenCalledWith(
            "/tmp/pi-session.jsonl",
            undefined,
            expect.any(String),
          );
          // inMemory is still only the first (fresh) call.
          expect(inMemorySpy).toHaveBeenCalledTimes(1);
        } finally {
          openSpy.mockRestore();
          inMemorySpy.mockRestore();
        }
      }),
  );

  it.effect("readThread maps session message history into a single-turn snapshot", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const messages = [
        { role: "user", content: "hello", timestamp: 1 },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Hi there" },
            { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "npm test" } },
          ],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 2,
        },
      ];
      const { session } = makeFakeSession({ messages });
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-read");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });

      const snapshot = yield* adapter.readThread(threadId);
      expect(snapshot.threadId).toBe(threadId);
      expect(snapshot.turns).toHaveLength(1);
      const items = snapshot.turns[0]?.items as Array<{ type: string }> | undefined;
      expect(items?.map((item) => item.type)).toEqual([
        "user_message",
        "assistant_message",
        "tool_call",
      ]);
    }),
  );

  it.effect("readThread returns an empty turns array when the session has no messages", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-read-empty");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });

      const snapshot = yield* adapter.readThread(threadId);
      expect(snapshot.threadId).toBe(threadId);
      expect(snapshot.turns).toEqual([]);
    }),
  );

  it.effect(
    "rollbackThread branches the session manager to the target leaf and truncates tracked turns",
    () =>
      Effect.gen(function* () {
        const recorder = makeEventRecorder();
        const branchCalls: string[] = [];
        let resetLeafCalls = 0;
        let leafId = "leaf-0";
        const sessionManager = {
          getLeafId: () => leafId,
          branch: (fromId: string) => {
            branchCalls.push(fromId);
            leafId = fromId;
          },
          resetLeaf: () => {
            resetLeafCalls += 1;
            leafId = null as unknown as string;
          },
          getEntries: () => [],
        };
        const { session, hooks } = makeFakeSession({ sessionManager });
        const adapter = yield* makePiAdapter(decodePiSettings({}), {
          instanceId: ProviderInstanceId.make("pi"),
          availableModels: [SAMPLE_MODEL],
          createSession: (() => Promise.resolve({ session })) as never,
          onEvent: recorder.onEvent,
        });

        const threadId = ThreadId.make("pi-thread-rollback");
        yield* adapter.startSession({
          threadId,
          runtimeMode: "full-access",
          modelSelection: MODEL_SELECTION,
        });

        // Complete two turns; each settlement records the session leaf id.
        yield* adapter.sendTurn({ threadId, input: "first" });
        yield* Effect.tryPromise(() => hooks.promptStarted);
        leafId = "leaf-1";
        hooks.resolvePrompt();
        yield* Effect.tryPromise(() =>
          recorder.waitFor((event) => event.type === "turn.completed"),
        );

        yield* adapter.sendTurn({ threadId, input: "second" });
        yield* Effect.tryPromise(() => hooks.promptStarted);
        leafId = "leaf-2";
        hooks.resolvePrompt();
        yield* Effect.tryPromise(() =>
          recorder.waitFor((event) => event.type === "turn.completed"),
        );

        // Roll back one turn: branch back to the first turn's leaf.
        const snapshot = yield* adapter.rollbackThread(threadId, 1);
        expect(branchCalls).toEqual(["leaf-1"]);
        expect(resetLeafCalls).toBe(0);
        expect(snapshot.threadId).toBe(threadId);

        // Rolling back all remaining turns resets the leaf.
        const allSnapshot = yield* adapter.rollbackThread(threadId, 1);
        expect(resetLeafCalls).toBe(1);
        expect(allSnapshot.turns).toEqual([]);
      }),
  );

  it.effect(
    "compactThread calls session.compact and emits compaction lifecycle via thread.state.changed",
    () =>
      Effect.gen(function* () {
        const recorder = makeEventRecorder();
        const { session, hooks } = makeFakeSession({
          // The real SDK emits compaction_start/compaction_end through the
          // subscribed listener while compact() is in flight. The fake mirrors
          // that by emitting both events before resolving the compact promise.
          compact: () => {
            hooks.emit?.({ type: "compaction_start", reason: "manual" } as PiSdkSessionEvent);
            hooks.emit?.({
              type: "compaction_end",
              reason: "manual",
              result: undefined,
              aborted: false,
              willRetry: false,
            } as PiSdkSessionEvent);
            return Promise.resolve();
          },
        });
        const adapter = yield* makePiAdapter(decodePiSettings({}), {
          instanceId: ProviderInstanceId.make("pi"),
          availableModels: [SAMPLE_MODEL],
          createSession: (() => Promise.resolve({ session })) as never,
          onEvent: recorder.onEvent,
        });

        const threadId = ThreadId.make("pi-thread-compact");
        yield* adapter.startSession({
          threadId,
          runtimeMode: "full-access",
          modelSelection: MODEL_SELECTION,
        });

        // compactThread awaits session.compact(); the fake emits the compaction
        // events synchronously inside compact, so by the time compactThread
        // resolves both thread.state.changed events have been published.
        yield* adapter.compactThread(threadId);

        expect(hooks.compactCalls).toBe(1);

        // compaction_start -> thread.state.changed with state "active" and a
        // human-readable detail. This signals the thread is actively
        // compacting without producing an unpaired item lifecycle.
        const activeStateChanged = recorder.events.find(
          (event) => event.type === "thread.state.changed" && event.payload.state === "active",
        );
        expect(activeStateChanged).toBeDefined();
        expect((activeStateChanged?.payload as { detail?: unknown })?.detail).toBe(
          "Compacting context",
        );
        expect((activeStateChanged?.raw as { source?: string })?.source).toBe("pi.sdk.event");

        // compaction_end -> thread.state.changed with state "compacted". The
        // ingestion layer admits this state and renders a context-compaction
        // projection item, so compaction is visible end-to-end. The abort/
        // retry context is carried in `detail` so it reaches the UI.
        const compactedStateChanged = recorder.events.find(
          (event) => event.type === "thread.state.changed" && event.payload.state === "compacted",
        );
        expect(compactedStateChanged).toBeDefined();
        expect((compactedStateChanged?.raw as { source?: string })?.source).toBe("pi.sdk.event");
        const compactedDetail = (
          compactedStateChanged?.payload as { detail?: Record<string, unknown> }
        )?.detail;
        expect(compactedDetail?.aborted).toBe(false);
        expect(compactedDetail?.willRetry).toBe(false);
        // errorMessage/result are omitted when absent/falsy.
        expect(compactedDetail?.errorMessage).toBeUndefined();
        expect(compactedDetail?.result).toBeUndefined();

        // No item.* events with context_compaction itemType remain —
        // compaction now flows through thread.state.changed, which ingestion
        // admits, instead of item.* events that the tool-lifecycle filter
        // drops.
        const compactionItemEvents = recorder.events.filter(
          (event) =>
            (event.type === "item.started" ||
              event.type === "item.updated" ||
              event.type === "item.completed") &&
            event.payload.itemType === "context_compaction",
        );
        expect(compactionItemEvents).toHaveLength(0);

        // Emitted compaction events pass ProviderRuntimeEvent schema
        // validation (thread.state.changed with state/detail and raw source).
        const isSchema = Schema.is(ProviderRuntimeEvent);
        for (const event of recorder.events) {
          expect(isSchema(event)).toBe(true);
        }
      }),
  );

  it.effect("maps tool_execution_start/update/end to item lifecycle events", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session, hooks } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-tools");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      yield* adapter.sendTurn({ threadId, input: "run tests" });
      yield* Effect.tryPromise(() => hooks.promptStarted);

      hooks.emit?.({
        type: "tool_execution_start",
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "npm test" },
      } as PiSdkSessionEvent);
      hooks.emit?.({
        type: "tool_execution_update",
        toolCallId: "tool-1",
        toolName: "bash",
        args: { command: "npm test" },
        partialResult: { stdout: "running...", exitCode: undefined },
      } as PiSdkSessionEvent);
      hooks.emit?.({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "bash",
        result: { stdout: "all passing", exitCode: 0 },
        isError: false,
      } as PiSdkSessionEvent);

      yield* Effect.tryPromise(() => recorder.waitFor((event) => event.type === "item.completed"));

      const started = recorder.events.find(
        (event) => event.type === "item.started" && event.itemId === "pi-tool-tool-1",
      );
      expect(started).toBeDefined();
      expect((started?.payload as { itemType?: string })?.itemType).toBe("command_execution");
      expect((started?.payload as { status?: string })?.status).toBe("inProgress");
      expect((started?.payload as { title?: string })?.title).toBe("npm test");
      expect((started?.payload as { data?: { toolCallId?: string } })?.data?.toolCallId).toBe(
        "tool-1",
      );
      expect((started?.raw as { source?: string })?.source).toBe("pi.sdk.event");

      const updated = recorder.events.find(
        (event) => event.type === "item.updated" && event.itemId === "pi-tool-tool-1",
      );
      expect(updated).toBeDefined();
      expect((updated?.payload as { itemType?: string })?.itemType).toBe("command_execution");
      expect((updated?.payload as { status?: string })?.status).toBe("inProgress");
      expect((updated?.payload as { detail?: string })?.detail).toBe("running...");
      expect(
        (updated?.payload as { data?: { partialResult?: unknown } })?.data?.partialResult,
      ).toEqual({ stdout: "running...", exitCode: undefined });

      const completed = recorder.events.find(
        (event) => event.type === "item.completed" && event.itemId === "pi-tool-tool-1",
      );
      expect(completed).toBeDefined();
      expect((completed?.payload as { itemType?: string })?.itemType).toBe("command_execution");
      expect((completed?.payload as { status?: string })?.status).toBe("completed");
      expect((completed?.payload as { title?: string })?.title).toBe("npm test");
      expect(
        (completed?.payload as { data?: { result?: { stdout?: string }; isError?: boolean } })?.data
          ?.result,
      ).toEqual({ stdout: "all passing", exitCode: 0 });
      expect((completed?.payload as { data?: { isError?: boolean } })?.data?.isError).toBe(false);

      // All emitted tool-lifecycle events must pass ProviderRuntimeEvent schema
      // validation (raw.source = "pi.sdk.event", itemId/itemType/status).
      const isSchema = Schema.is(ProviderRuntimeEvent);
      for (const event of recorder.events) {
        expect(isSchema(event)).toBe(true);
      }

      hooks.resolvePrompt();
      yield* Effect.tryPromise(() => recorder.waitFor((event) => event.type === "turn.completed"));
    }),
  );

  it.effect("maps a failed tool_execution_end to a failed item.completed", () =>
    Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session, hooks } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const threadId = ThreadId.make("pi-thread-tools-failed");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      yield* adapter.sendTurn({ threadId, input: "run tests" });
      yield* Effect.tryPromise(() => hooks.promptStarted);

      hooks.emit?.({
        type: "tool_execution_start",
        toolCallId: "tool-err",
        toolName: "bash",
        args: { command: "npm test" },
      } as PiSdkSessionEvent);
      hooks.emit?.({
        type: "tool_execution_end",
        toolCallId: "tool-err",
        toolName: "bash",
        result: { stdout: "Error: ENOTFOUND", exitCode: 1 },
        isError: true,
      } as PiSdkSessionEvent);

      yield* Effect.tryPromise(() =>
        recorder.waitFor(
          (event) => event.type === "item.completed" && event.itemId === "pi-tool-tool-err",
        ),
      );

      const completed = recorder.events.find(
        (event) => event.type === "item.completed" && event.itemId === "pi-tool-tool-err",
      );
      expect((completed?.payload as { status?: string })?.status).toBe("failed");
      expect((completed?.payload as { data?: { isError?: boolean } })?.data?.isError).toBe(true);

      hooks.resolvePrompt();
      yield* Effect.tryPromise(() => recorder.waitFor((event) => event.type === "turn.completed"));
    }),
  );

  it.effect("passes image attachments to ctx.sdk.prompt as base64 ImageContent", () => {
    const baseDir = mkdtempSync(path.join(os.tmpdir(), "pi-attachments-"));
    const servicesLayer = Layer.provideMerge(
      ServerConfig.layerTest("/tmp/pi-adapter-test", baseDir),
      NodeServices.layer,
    );
    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => rmSync(baseDir, { recursive: true, force: true })),
      );

      const recorder = makeEventRecorder();
      const { session, hooks } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });

      const { attachmentsDir } = yield* ServerConfig;
      const attachment = {
        type: "image" as const,
        id: "pi-image-12345678-1234-1234-1234-123456789abc",
        name: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 4,
      };
      const attachmentPath = path.join(attachmentsDir, attachmentRelativePath(attachment));
      mkdirSync(path.dirname(attachmentPath), { recursive: true });
      writeFileSync(attachmentPath, Uint8Array.from([1, 2, 3, 4]));

      const threadId = ThreadId.make("pi-thread-images");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      yield* adapter.sendTurn({
        threadId,
        input: "What's in this image?",
        attachments: [attachment],
      });
      yield* Effect.tryPromise(() => hooks.promptStarted);

      expect(hooks.lastPromptArgs).toBeDefined();
      expect(hooks.lastPromptArgs?.text).toBe("What's in this image?");
      const images = hooks.lastPromptArgs?.options?.images;
      expect(images).toEqual([{ type: "image", data: "AQIDBA==", mimeType: "image/png" }]);

      hooks.resolvePrompt();
      yield* Effect.tryPromise(() => recorder.waitFor((event) => event.type === "turn.completed"));
    }).pipe(Effect.provide(servicesLayer));
  });
});

describe("makePiAdapter extension UI bridge", () => {
  // Bridge tests grab the uiContext via the `onUiContext` hook, invoke a
  // bridged method, then resolve the pending request through the public
  // `adapter.respondToUserInput` surface. Events are recorded for assertion.
  // Built as an Effect so the adapter shares the `it.effect` Scope instead of
  // spinning up a manual Effect runtime (kata-code/no-manual-effect-runtime-in-tests).
  function startBridgedSession(piSettings: ReturnType<typeof decodePiSettings>) {
    return Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session } = makeFakeSession();
      let capturedUiContext: PiExtensionUIContext | undefined;
      const adapter = yield* makePiAdapter(piSettings, {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
        onUiContext: (uiContext) => {
          capturedUiContext = uiContext;
        },
      });
      const threadId = ThreadId.make("pi-ui-thread");
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      if (!capturedUiContext) {
        return yield* Effect.fail(
          new ProviderAdapterRequestError({
            provider: ProviderDriverKind.make("pi"),
            method: "startSession",
            detail: "onUiContext was not invoked during startSession.",
          }),
        );
      }
      return {
        adapter,
        uiContext: capturedUiContext,
        recorder,
        threadId,
        resolveUserInput: (requestId: string, answers: Record<string, unknown>) =>
          adapter.respondToUserInput(threadId, requestId as never, answers as never),
      };
    });
  }

  it.effect("bridges select onto user-input.requested and resolves the chosen option", () =>
    Effect.gen(function* () {
      const { uiContext, recorder, resolveUserInput } = yield* startBridgedSession(
        decodePiSettings({}),
      );

      const selectPromise = uiContext.select("Pick a tool", ["bash", "edit", "grep"]);
      yield* Effect.tryPromise(() =>
        recorder.waitFor((event) => event.type === "user-input.requested"),
      );

      const requested = recorder.events.find((event) => event.type === "user-input.requested");
      const payload = requested?.payload as unknown as
        | { questions: Array<{ id: string; options: Array<{ label: string }> }> }
        | undefined;
      const question = payload?.questions[0];
      expect(question?.id).toBe("selection");
      expect(question?.options.map((o) => o.label)).toEqual(["bash", "edit", "grep"]);
      expect((requested?.raw as { source?: string })?.source).toBe("pi.sdk.event");
      const requestId = requested?.requestId as unknown as string;

      yield* resolveUserInput(requestId, { selection: "edit" });
      const answer = yield* Effect.tryPromise(() => selectPromise);
      expect(answer).toBe("edit");

      const resolved = recorder.events.find((event) => event.type === "user-input.resolved");
      expect((resolved?.payload as { answers: Record<string, unknown> })?.answers).toEqual({
        selection: "edit",
      });
    }),
  );

  it.effect("bridges confirm onto a Yes/No question and resolves to a boolean", () =>
    Effect.gen(function* () {
      const { uiContext, recorder, resolveUserInput } = yield* startBridgedSession(
        decodePiSettings({}),
      );

      const confirmPromise = uiContext.confirm("Run tests?", "This will execute the suite");
      yield* Effect.tryPromise(() =>
        recorder.waitFor((event) => event.type === "user-input.requested"),
      );
      const requested = recorder.events.find((event) => event.type === "user-input.requested");
      const payload = requested?.payload as unknown as
        | { questions: Array<{ id: string; options: Array<{ label: string }> }> }
        | undefined;
      const question = payload?.questions[0];
      expect(question?.id).toBe("confirmation");
      expect(question?.options.map((o) => o.label)).toEqual(["Yes", "No"]);
      const requestId = requested?.requestId as unknown as string;

      yield* resolveUserInput(requestId, { confirmation: "Yes" });
      const confirmed = yield* Effect.tryPromise(() => confirmPromise);
      expect(confirmed).toBe(true);
    }),
  );

  it.effect("bridges input onto a free-text question and resolves the string", () =>
    Effect.gen(function* () {
      const { uiContext, recorder, resolveUserInput } = yield* startBridgedSession(
        decodePiSettings({}),
      );

      const inputPromise = uiContext.input("Branch name", "feat/...");
      yield* Effect.tryPromise(() =>
        recorder.waitFor((event) => event.type === "user-input.requested"),
      );
      const requested = recorder.events.find((event) => event.type === "user-input.requested");
      const question = (
        requested?.payload as unknown as
          | { questions: Array<{ id: string; options: unknown[] }> }
          | undefined
      )?.questions[0];
      expect(question?.id).toBe("input");
      expect(question?.options).toEqual([]);
      const requestId = requested?.requestId as unknown as string;

      yield* resolveUserInput(requestId, { input: "feat/pi-bridge" });
      const value = yield* Effect.tryPromise(() => inputPromise);
      expect(value).toBe("feat/pi-bridge");
    }),
  );

  it.effect("resolves a pre-aborted select immediately without publishing a request", () =>
    Effect.gen(function* () {
      const { uiContext, recorder } = yield* startBridgedSession(decodePiSettings({}));
      const controller = new AbortController();
      controller.abort();

      const answer = yield* Effect.tryPromise(() =>
        uiContext.select("Pick", ["a", "b"], { signal: controller.signal }),
      );
      expect(answer).toBeUndefined();
      expect(recorder.events.some((event) => event.type === "user-input.requested")).toBe(false);
    }),
  );

  it.effect(
    "resolves to a cancelled value after the timeout and publishes user-input.resolved",
    () =>
      Effect.gen(function* () {
        const { uiContext, recorder } = yield* startBridgedSession(decodePiSettings({}));

        const answer = yield* Effect.tryPromise(() =>
          uiContext.select("Pick", ["a", "b"], { timeout: 50 }),
        );
        expect(answer).toBeUndefined();
        yield* Effect.tryPromise(() =>
          recorder.waitFor((event) => event.type === "user-input.resolved"),
        );
        const resolved = recorder.events.find((event) => event.type === "user-input.resolved");
        expect((resolved?.payload as { answers: Record<string, unknown> })?.answers).toEqual({});
      }),
  );

  it.effect("maps notify(warning/error) to runtime.warning and notify(info) to tool.progress", () =>
    Effect.gen(function* () {
      const { uiContext, recorder } = yield* startBridgedSession(decodePiSettings({}));

      uiContext.notify("careful", "warning");
      uiContext.notify("boom", "error");
      uiContext.notify("hi", "info");
      uiContext.notify("also info");

      const warnings = recorder.events.filter((event) => event.type === "runtime.warning");
      expect(warnings).toHaveLength(2);
      const progress = recorder.events.filter((event) => event.type === "tool.progress");
      expect(progress).toHaveLength(2);
      const firstProgress = progress[0];
      expect((firstProgress?.payload as { summary?: string })?.summary).toBe("hi");
    }),
  );

  it.effect("emits one runtime.warning per TUI-only method per session and no-ops", () =>
    Effect.gen(function* () {
      const { uiContext, recorder } = yield* startBridgedSession(decodePiSettings({}));

      uiContext.setWidget("w", ["x"]);
      uiContext.setWidget("w", ["y"]);
      uiContext.setFooter(undefined);
      uiContext.setHeader(undefined);
      uiContext.pasteToEditor("text");
      uiContext.setEditorComponent(undefined);
      uiContext.addAutocompleteProvider(undefined as never);
      const termUnsub = uiContext.onTerminalInput(() => undefined);
      expect(typeof termUnsub).toBe("function");
      expect(termUnsub()).toBeUndefined();
      yield* Effect.tryPromise(() => uiContext.custom(undefined as never));

      const warnings = recorder.events.filter((event) => event.type === "runtime.warning");
      // One per method: setWidget, setFooter, setHeader, pasteToEditor,
      // setEditorComponent, addAutocompleteProvider, onTerminalInput, custom.
      expect(warnings).toHaveLength(8);
      // Calling a method again does not emit a second warning.
      uiContext.setWidget("w", ["z"]);
      const warningsAfterRepeat = recorder.events.filter(
        (event) => event.type === "runtime.warning",
      );
      expect(warningsAfterRepeat).toHaveLength(8);
    }),
  );

  it.effect("fails loud when respondToUserInput targets an unknown request id", () =>
    Effect.gen(function* () {
      const { adapter, threadId } = yield* startBridgedSession(decodePiSettings({}));
      const result = yield* Effect.exit(
        adapter.respondToUserInput(threadId, "unknown-request-id" as never, {} as never),
      );
      expect(Exit.isFailure(result)).toBe(true);
    }),
  );

  it.effect("emits schema-valid runtime events for the select bridge", () =>
    Effect.gen(function* () {
      const { uiContext, recorder, resolveUserInput } = yield* startBridgedSession(
        decodePiSettings({}),
      );
      const selectPromise = uiContext.select("Pick", ["a", "b"]);
      yield* Effect.tryPromise(() =>
        recorder.waitFor((event) => event.type === "user-input.requested"),
      );
      const requested = recorder.events.find((event) => event.type === "user-input.requested");
      const requestId = requested?.requestId as unknown as string;
      yield* resolveUserInput(requestId, { selection: "a" });
      yield* Effect.tryPromise(() => selectPromise);

      for (const event of recorder.events) {
        expect(Schema.is(ProviderRuntimeEvent)(event)).toBe(true);
      }
    }),
  );
});

describe("makePiAdapter runtime mode mapping", () => {
  function startSessionForMode(
    runtimeMode: "full-access" | "auto-accept-edits" | "approval-required",
  ) {
    return Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });
      yield* adapter.startSession({
        threadId: ThreadId.make("pi-mode-thread"),
        runtimeMode,
        modelSelection: MODEL_SELECTION,
      });
      return recorder;
    });
  }

  it.effect("emits no runtime warning for full-access", () =>
    Effect.gen(function* () {
      const recorder = yield* startSessionForMode("full-access");
      const warnings = recorder.events.filter((event) => event.type === "runtime.warning");
      expect(warnings).toHaveLength(0);
    }),
  );

  it.effect("warns that auto-accept-edits is treated as full-access", () =>
    Effect.gen(function* () {
      const recorder = yield* startSessionForMode("auto-accept-edits");
      const warnings = recorder.events.filter((event) => event.type === "runtime.warning");
      expect(warnings).toHaveLength(1);
      const message = (warnings[0]?.payload as { message?: string })?.message ?? "";
      expect(message).toContain("auto-accept-edits");
      expect(message.toLowerCase()).toContain("full-access");
    }),
  );

  it.effect("warns before the first turn that approval-required cannot be enforced", () =>
    Effect.gen(function* () {
      const recorder = yield* startSessionForMode("approval-required");
      const warnings = recorder.events.filter((event) => event.type === "runtime.warning");
      expect(warnings).toHaveLength(1);
      const message = (warnings[0]?.payload as { message?: string })?.message ?? "";
      expect(message).toContain("approval-required");
      // The warning is emitted at startSession, before any turn is sent.
      const turnStarts = recorder.events.filter((event) => event.type === "turn.started");
      expect(turnStarts).toHaveLength(0);
    }),
  );
});

describe("makePiAdapter project trust policy", () => {
  function startSessionWithPolicy(projectTrustPolicy: "never" | "always") {
    return Effect.gen(function* () {
      const recorder = makeEventRecorder();
      const { session } = makeFakeSession();
      const adapter = yield* makePiAdapter(decodePiSettings({ projectTrustPolicy }), {
        instanceId: ProviderInstanceId.make("pi"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session })) as never,
        onEvent: recorder.onEvent,
      });
      yield* adapter.startSession({
        threadId: ThreadId.make("pi-trust-thread"),
        runtimeMode: "full-access",
        modelSelection: MODEL_SELECTION,
      });
      return recorder;
    });
  }

  it.effect("does not warn and loads no project-local resources when policy is never", () =>
    Effect.gen(function* () {
      const recorder = yield* startSessionWithPolicy("never");
      const trustWarnings = recorder.events
        .filter((event) => event.type === "runtime.warning")
        .filter((event) =>
          ((event.payload as { message?: string })?.message ?? "").includes("project-local"),
        );
      expect(trustWarnings).toHaveLength(0);
    }),
  );

  it.effect("warns that project-local resources are loaded when policy is always", () =>
    Effect.gen(function* () {
      const recorder = yield* startSessionWithPolicy("always");
      const trustWarnings = recorder.events
        .filter((event) => event.type === "runtime.warning")
        .filter((event) =>
          ((event.payload as { message?: string })?.message ?? "").includes("project-local"),
        );
      expect(trustWarnings).toHaveLength(1);
      const message = (trustWarnings[0]?.payload as { message?: string })?.message ?? "";
      expect(message).toContain("always");
    }),
  );
});
