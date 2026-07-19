import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  PiSettings,
  ProviderInstanceId,
  TextGenerationError,
  type ModelSelection,
} from "@kata-sh/code-contracts";
import { createModelSelection } from "@kata-sh/code-shared/model";

import { makePiTextGeneration } from "./PiTextGeneration.ts";
import type { PiModelShape } from "../provider/Layers/PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

const MODEL_SELECTION = createModelSelection(
  ProviderInstanceId.make("pi"),
  "anthropic/claude-opus-4-6",
) as ModelSelection;

/** Fixture model matching the MODEL_SELECTION slug so resolveModel succeeds
 *  without relying on real Pi auth/model discovery (CI has no Pi credentials). */
const SAMPLE_MODEL: PiModelShape = {
  id: "claude-opus-4-6",
  name: "Claude Opus 4.6",
  provider: "anthropic",
  reasoning: true,
};
const SAMPLE_MODELS: ReadonlyArray<PiModelShape> = [SAMPLE_MODEL];

// Fixture JSON strings for the fake Pi session's assistant output. Pre-built
// as string literals so the structured-output decoders exercise the real
// parse path without tripping the preferSchemaOverJson lint rule.
const TITLE_JSON = `{"title":"Fix login bug"}`;
const BRANCH_JSON = `{"branch":"feat/pi bridge!!!"}`;
const COMMIT_JSON = `{"subject":"fix: resolve login redirect","body":"- handle google callback"}`;
const PR_JSON = `{"title":"Pi provider parity","body":"## Summary\\n- adds the bridge"}`;
const BAD_JSON = `not json at all`;
const isTextGenerationError = Schema.is(TextGenerationError);

/** A minimal fake Pi SDK session for one-shot text generation. `prompt`
 *  resolves immediately; `messages` returns a single assistant message whose
 *  text content is `jsonText`. */
function makeFakeTextSession(jsonText: string): {
  session: unknown;
  promptCalls: number;
  disposed: boolean;
} {
  const state = { promptCalls: 0, disposed: false };
  const session = {
    sessionId: "pi-text-1",
    sessionFile: undefined,
    isStreaming: false,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: jsonText }],
      },
    ],
    prompt: () => {
      state.promptCalls += 1;
      return Promise.resolve();
    },
    abort: () => Promise.resolve(),
    dispose: () => {
      state.disposed = true;
    },
    subscribe: () => () => {},
    bindExtensions: () => Promise.resolve(),
  };
  return { session, ...state };
}

describe("makePiTextGeneration", () => {
  it.effect("generates a thread title from a fixture-backed Pi session", () =>
    Effect.gen(function* () {
      const { session } = makeFakeTextSession(TITLE_JSON);
      const modelRuntime = { getAvailable: () => Promise.resolve(SAMPLE_MODELS) };
      let receivedModelRuntime: unknown;
      const textGeneration = yield* makePiTextGeneration(decodePiSettings({}), {
        createModelRuntime: async () => modelRuntime,
        createSession: ((args: { modelRuntime: unknown }) => {
          receivedModelRuntime = args.modelRuntime;
          return Promise.resolve({ session });
        }) as never,
      });

      const result = yield* textGeneration.generateThreadTitle({
        cwd: "/tmp",
        message: "I can't log in with Google",
        modelSelection: MODEL_SELECTION,
      });

      expect(result.title).toBe("Fix login bug");
      expect(receivedModelRuntime).toBe(modelRuntime);
    }),
  );

  it.effect("recreates model discovery after late sandbox credential seeding", () =>
    Effect.gen(function* () {
      let isCredentialSeeded = false;
      let runtimeCreations = 0;
      const receivedModelRuntimes: unknown[] = [];
      const textGeneration = yield* makePiTextGeneration(decodePiSettings({}), {
        createModelRuntime: async () => {
          runtimeCreations += 1;
          return {
            getAvailable: () => Promise.resolve(isCredentialSeeded ? SAMPLE_MODELS : []),
          };
        },
        createSession: ((args: { modelRuntime: unknown }) => {
          receivedModelRuntimes.push(args.modelRuntime);
          return Promise.resolve({ session: makeFakeTextSession(TITLE_JSON).session });
        }) as never,
      });

      expect(runtimeCreations).toBe(0);
      isCredentialSeeded = true;

      const first = yield* textGeneration.generateThreadTitle({
        cwd: "/tmp",
        message: "credentials are now available",
        modelSelection: MODEL_SELECTION,
      });
      const second = yield* textGeneration.generateThreadTitle({
        cwd: "/tmp",
        message: "discover the current credentials again",
        modelSelection: MODEL_SELECTION,
      });

      expect(first.title).toBe("Fix login bug");
      expect(second.title).toBe("Fix login bug");
      expect(runtimeCreations).toBe(2);
      expect(receivedModelRuntimes).toHaveLength(2);
      expect(receivedModelRuntimes[0]).not.toBe(receivedModelRuntimes[1]);
    }),
  );

  it.effect("generates a branch name and sanitizes the fragment", () =>
    Effect.gen(function* () {
      const { session } = makeFakeTextSession(BRANCH_JSON);
      const textGeneration = yield* makePiTextGeneration(decodePiSettings({}), {
        createSession: (() => Promise.resolve({ session })) as never,
        availableModels: SAMPLE_MODELS,
      });

      const result = yield* textGeneration.generateBranchName({
        cwd: "/tmp",
        message: "add the pi extension ui bridge",
        modelSelection: MODEL_SELECTION,
      });

      expect(result.branch).toBe("feat/pi-bridge");
    }),
  );

  it.effect("generates a commit message with subject and body", () =>
    Effect.gen(function* () {
      const { session } = makeFakeTextSession(COMMIT_JSON);
      const textGeneration = yield* makePiTextGeneration(decodePiSettings({}), {
        createSession: (() => Promise.resolve({ session })) as never,
        availableModels: SAMPLE_MODELS,
      });

      const result = yield* textGeneration.generateCommitMessage({
        cwd: "/tmp",
        branch: "main",
        stagedSummary: "auth.ts",
        stagedPatch: "--- a/auth.ts",
        modelSelection: MODEL_SELECTION,
      });

      expect(result.subject).toBe("fix: resolve login redirect");
      expect(result.body).toBe("- handle google callback");
    }),
  );

  it.effect("generates PR content with title and body", () =>
    Effect.gen(function* () {
      const { session } = makeFakeTextSession(PR_JSON);
      const textGeneration = yield* makePiTextGeneration(decodePiSettings({}), {
        createSession: (() => Promise.resolve({ session })) as never,
        availableModels: SAMPLE_MODELS,
      });

      const result = yield* textGeneration.generatePrContent({
        cwd: "/tmp",
        baseBranch: "main",
        headBranch: "feat/pi",
        commitSummary: "feat: pi bridge",
        diffSummary: "PiAdapter.ts",
        diffPatch: "--- a/PiAdapter.ts",
        modelSelection: MODEL_SELECTION,
      });

      expect(result.title).toBe("Pi provider parity");
      expect(result.body).toBe("## Summary\n- adds the bridge");
    }),
  );

  it.effect("returns TextGenerationError when the Pi output is not valid JSON", () =>
    Effect.gen(function* () {
      const { session } = makeFakeTextSession(BAD_JSON);
      const textGeneration = yield* makePiTextGeneration(decodePiSettings({}), {
        createSession: (() => Promise.resolve({ session })) as never,
        availableModels: SAMPLE_MODELS,
      });

      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: "/tmp",
          message: "hello",
          modelSelection: MODEL_SELECTION,
        }),
      );

      expect(isTextGenerationError(error)).toBe(true);
      expect(error.operation).toBe("generateThreadTitle");
    }),
  );

  it.effect("returns TextGenerationError when the model is not available", () =>
    Effect.gen(function* () {
      const { session } = makeFakeTextSession(TITLE_JSON);
      const textGeneration = yield* makePiTextGeneration(decodePiSettings({}), {
        createSession: (() => Promise.resolve({ session })) as never,
        availableModels: [],
      });

      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: "/tmp",
          message: "hello",
          modelSelection: MODEL_SELECTION,
        }),
      );

      expect(isTextGenerationError(error)).toBe(true);
    }),
  );
});
