import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@kata-sh/code-contracts";

import { makePiAdapter, type PiSdkSession } from "../Layers/PiAdapter.ts";
import {
  createPiModelRuntime,
  type PiModelShape,
  resolvePiAgentDir,
} from "../Layers/PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

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

type PiSdkSessionEvent = Parameters<Parameters<PiSdkSession["subscribe"]>[0]>[0];

/** Minimal fake session that emits a single assistant text delta when a turn
 *  starts, then resolves the prompt. Used to produce a real event on an
 *  adapter's event stream so isolation can assert it does not cross. */
function makeFakeSession(): { session: PiSdkSession; emit: (e: PiSdkSessionEvent) => void } {
  let emit: (e: PiSdkSessionEvent) => void = () => {};
  const session: PiSdkSession = {
    sessionId: "pi-session-iso",
    isStreaming: true,
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
    prompt: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    compact: () => Promise.resolve(),
    dispose: () => {},
    bindExtensions: () => Promise.resolve(),
  };
  return { session, emit: (e) => emit(e) };
}

describe("Pi provider instance isolation (AC 13)", () => {
  it("creates distinct model runtimes per agentDir", async () => {
    const a = await createPiModelRuntime(resolvePiAgentDir("/tmp/pi-agent-a"));
    const b = await createPiModelRuntime(resolvePiAgentDir("/tmp/pi-agent-b"));

    expect(a).not.toBe(b);

    // The default (empty agentDir) path is the SDK default and differs from
    // an explicit dir, so a custom instance never shares state with default.
    const def = await createPiModelRuntime(resolvePiAgentDir(""));
    expect(def).not.toBe(a);
  });

  it.effect("keeps event streams isolated between two Pi adapter instances", () =>
    Effect.gen(function* () {
      const recorderA: ProviderRuntimeEvent[] = [];
      const fakeA = makeFakeSession();
      const adapterA = yield* makePiAdapter(decodePiSettings({ agentDir: "/tmp/pi-agent-a" }), {
        instanceId: ProviderInstanceId.make("pi-a"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session: fakeA.session })) as never,
        onEvent: (event) => recorderA.push(event),
      });

      const recorderB: ProviderRuntimeEvent[] = [];
      const fakeB = makeFakeSession();
      const adapterB = yield* makePiAdapter(decodePiSettings({ agentDir: "/tmp/pi-agent-b" }), {
        instanceId: ProviderInstanceId.make("pi-b"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session: fakeB.session })) as never,
        onEvent: (event) => recorderB.push(event),
      });

      // Start a session on instance A and stream one delta. Instance B's
      // recorder must not see any of instance A's events.
      const threadId = ThreadId.make("pi-iso-thread-a");
      yield* adapterA.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: { ...MODEL_SELECTION, instanceId: ProviderInstanceId.make("pi-a") },
      });
      fakeA.emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "only A sees this" },
      } as PiSdkSessionEvent);

      expect(recorderA.some((event) => event.type === "session.started")).toBe(true);
      expect(recorderA.some((event) => event.type === "content.delta")).toBe(true);
      // Instance B received no events from instance A's session.
      expect(recorderB).toHaveLength(0);

      // The adapters report distinct provider instance ids.
      const sessionsA = yield* adapterA.listSessions();
      const sessionsB = yield* adapterB.listSessions();
      expect(sessionsA[0]?.providerInstanceId).toBe(ProviderInstanceId.make("pi-a"));
      expect(sessionsB[0]?.providerInstanceId).toBeUndefined();
      expect(sessionsA[0]?.provider).toBe(ProviderDriverKind.make("pi"));
    }),
  );

  it.effect("routes respondToUserInput only to the owning instance", () =>
    Effect.gen(function* () {
      const fakeA = makeFakeSession();
      const adapterA = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi-a"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session: fakeA.session })) as never,
      });
      const fakeB = makeFakeSession();
      const adapterB = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi-b"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session: fakeB.session })) as never,
      });

      const threadA = ThreadId.make("pi-route-a");
      const threadB = ThreadId.make("pi-route-b");
      yield* adapterA.startSession({
        threadId: threadA,
        runtimeMode: "full-access",
        modelSelection: { ...MODEL_SELECTION, instanceId: ProviderInstanceId.make("pi-a") },
      });
      yield* adapterB.startSession({
        threadId: threadB,
        runtimeMode: "full-access",
        modelSelection: { ...MODEL_SELECTION, instanceId: ProviderInstanceId.make("pi-b") },
      });

      // A respondToUserInput targeted at instance A's thread on instance B's
      // adapter must fail (B does not own that thread), proving requests do
      // not cross instances.
      const result = yield* Effect.exit(
        adapterB.respondToUserInput(threadA, "any-id" as never, {} as never),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("exposes independent event streams per adapter", () =>
    Effect.gen(function* () {
      const fakeA = makeFakeSession();
      const adapterA = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi-a"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session: fakeA.session })) as never,
      });
      const fakeB = makeFakeSession();
      const adapterB = yield* makePiAdapter(decodePiSettings({}), {
        instanceId: ProviderInstanceId.make("pi-b"),
        availableModels: [SAMPLE_MODEL],
        createSession: (() => Promise.resolve({ session: fakeB.session })) as never,
      });

      // Each adapter owns a distinct PubSub-backed stream. Identity inequality
      // is a coarse check; the behavioral isolation (events from one never
      // surface on the other) is asserted in the event-stream isolation test
      // above via the onEvent recorders.
      expect(adapterA.streamEvents).not.toBe(adapterB.streamEvents);
    }),
  );
});
