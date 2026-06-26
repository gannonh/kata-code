import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  PiSettings,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@kata-sh/code-contracts";

import { makePiAdapter, type PiSdkSession } from "./PiAdapter.ts";
import type { PiModelShape } from "./PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

type PiSdkSessionEvent = Parameters<Parameters<PiSdkSession["subscribe"]>[0]>[0];

interface FakeSessionHooks {
  emit: ((event: PiSdkSessionEvent) => void) | undefined;
  promptStarted: Promise<void>;
  resolvePrompt: () => void;
  rejectPrompt: (error: Error) => void;
}

function makeFakeSession(): { session: PiSdkSession; hooks: FakeSessionHooks } {
  let markPromptStarted: () => void = () => {};
  const promptStarted = new Promise<void>((resolve) => {
    markPromptStarted = resolve;
  });
  const hooks: FakeSessionHooks = {
    emit: undefined,
    promptStarted,
    resolvePrompt: () => {},
    rejectPrompt: () => {},
  };
  const session: PiSdkSession = {
    sessionId: "pi-session-1",
    isStreaming: true,
    subscribe: (listener) => {
      hooks.emit = listener;
      return () => {};
    },
    prompt: () => {
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
  };
  return { session, hooks };
}

function makeEventRecorder() {
  const events: ProviderRuntimeEvent[] = [];
  let waiters: Array<{
    readonly predicate: (event: ProviderRuntimeEvent) => boolean;
    readonly resolve: () => void;
  }> = [];
  return {
    events,
    onEvent: (event: ProviderRuntimeEvent) => {
      events.push(event);
      const pending: typeof waiters = [];
      for (const waiter of waiters) {
        if (waiter.predicate(event)) waiter.resolve();
        else pending.push(waiter);
      }
      waiters = pending;
    },
    waitFor: (predicate: (event: ProviderRuntimeEvent) => boolean) =>
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
      // after session.exited.
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
});
