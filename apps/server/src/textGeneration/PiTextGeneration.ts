/**
 * PiTextGeneration — one-shot structured text generation for Kata's git text
 * operations (thread title, branch name, commit message, PR content) using
 * the in-process Pi SDK.
 *
 * Each operation spins up an isolated in-memory `AgentSession`, sends the
 * JSON-only prompt built by the shared `TextGenerationPrompts`, collects the
 * final assistant message text, parses it against the operation's output
 * schema, and disposes the session. Parse/auth/model failures surface as
 * typed `TextGenerationError`s with the operation, provider instance, model,
 * and parse issue.
 *
 * @module textGeneration/PiTextGeneration
 */
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { PiSettings, TextGenerationError, type ModelSelection } from "@kata-sh/code-contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@kata-sh/code-shared/git";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  createPiRegistries,
  type PiModelShape,
  piModelSlug,
  resolvePiAgentDir,
} from "../provider/Layers/PiProvider.ts";
import type {
  BranchNameGenerationInput,
  CommitMessageGenerationInput,
  PrContentGenerationInput,
  TextGenerationShape,
  ThreadTitleGenerationInput,
} from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const PI_TEXT_GENERATION_TIMEOUT_MS = 180_000;

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

/** The slice of the Pi SDK `AgentSession` this module depends on. Extracted
 *  as a type so unit tests can substitute a minimal double without the SDK. */
export interface PiTextSdkSession {
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly messages?: ReadonlyArray<{
    readonly role: string;
    readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  }>;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
  subscribe(listener: (event: unknown) => void): () => void;
}

export interface PiTextGenerationOptions {
  readonly environment?: NodeJS.ProcessEnv;
  /** Override SDK session creation for tests. */
  readonly createSession?: typeof createAgentSession;
  /** Override the model list used for selection (tests). */
  readonly availableModels?: ReadonlyArray<PiModelShape>;
}

/** Find the last assistant text block in a Pi session's message history. */
function lastAssistantText(session: PiTextSdkSession): string | undefined {
  const messages = session.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type === "text" && typeof block.text === "string") return block.text;
    }
  }
  return undefined;
}

/** Read the first string option value for an option id from a model selection. */
function modelSelectionStringOption(
  selection: ModelSelection,
  optionId: string,
): string | undefined {
  const option = selection.options?.find((entry) => entry.id === optionId);
  return typeof option?.value === "string" ? option.value : undefined;
}

export const makePiTextGeneration = Effect.fn("makePiTextGeneration")(function* (
  piSettings: PiSettings,
  options?: PiTextGenerationOptions,
): Effect.fn.Return<TextGenerationShape, never, never> {
  const agentDir = resolvePiAgentDir(piSettings.agentDir);
  const { authStorage, modelRegistry } = createPiRegistries(agentDir);
  const availableModels = (options?.availableModels ??
    modelRegistry.getAvailable()) as ReadonlyArray<PiModelShape>;

  const resolveModel = (selection: ModelSelection): PiModelShape | undefined => {
    const slug = selection.model;
    if (!slug) return availableModels[0];
    const slash = slug.indexOf("/");
    if (slash > 0) return availableModels.find((model) => piModelSlug(model) === slug);
    return availableModels.find((model) => model.id === slug) ?? availableModels[0];
  };

  const fail = (
    operation: TextGenerationOp,
    detail: string,
    cause?: unknown,
  ): TextGenerationError =>
    new TextGenerationError({ operation, detail, ...(cause ? { cause } : {}) });

  /** Run a one-shot Pi session for `prompt`, collect the final assistant text,
   *  and decode it against `outputSchema`. Fails loud on auth/model/timeout or
   *  unparseable output. */
  const runPiJson = <S extends Schema.Top>({
    operation,
    prompt,
    outputSchema,
    modelSelection,
  }: {
    operation: TextGenerationOp;
    prompt: string;
    outputSchema: S;
    modelSelection: ModelSelection;
  }) =>
    Effect.gen(function* () {
      const model = resolveModel(modelSelection);
      if (!model) {
        return yield* Effect.fail(
          fail(
            operation,
            `Pi has no authenticated model available for ${operation}. Configure Pi auth or select a runtime-discovered model.`,
          ),
        );
      }
      const thinkingLevel = modelSelectionStringOption(modelSelection, "thinkingLevel");

      const created = yield* Effect.tryPromise({
        try: async () => {
          const factory = options?.createSession ?? createAgentSession;
          return factory({
            cwd: process.cwd(),
            ...(agentDir ? { agentDir } : {}),
            model: model as never,
            ...(thinkingLevel ? { thinkingLevel: thinkingLevel as never } : {}),
            authStorage,
            modelRegistry,
            sessionManager: SessionManager.inMemory(process.cwd()),
            // Text generation is a one-shot structured query: no tools, so the
            // model returns JSON text directly.
            tools: [],
          });
        },
        catch: (cause) =>
          fail(
            operation,
            `Failed to start Pi text generation session: ${
              cause instanceof Error ? cause.message : String(cause)
            }.`,
            cause,
          ),
      });
      const session = created.session as unknown as PiTextSdkSession;

      const cleanup = Effect.sync(() => session.dispose());

      return yield* Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => session.prompt(prompt),
          catch: (cause) =>
            fail(
              operation,
              `Pi text generation failed: ${
                cause instanceof Error ? cause.message : String(cause)
              }.`,
              cause,
            ),
        }).pipe(
          Effect.timeoutOption(Duration.millis(PI_TEXT_GENERATION_TIMEOUT_MS)),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  fail(
                    operation,
                    `Pi text generation timed out after ${PI_TEXT_GENERATION_TIMEOUT_MS}ms.`,
                  ),
                ),
              onSome: () => Effect.void,
            }),
          ),
        );

        const raw = lastAssistantText(session);
        if (!raw) {
          return yield* Effect.fail(
            fail(operation, "Pi returned no assistant text for structured output."),
          );
        }

        const decode = Schema.decodeEffect(Schema.fromJsonString(outputSchema));
        return yield* decode(raw).pipe(
          Effect.mapError((cause) =>
            fail(
              operation,
              `Pi returned invalid structured output: ${
                cause instanceof Error ? cause.message : String(cause)
              }.`,
              cause,
            ),
          ),
        );
      }).pipe(Effect.ensuring(cleanup));
    });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "PiTextGeneration.generateThreadTitle",
  )(function* (input: ThreadTitleGenerationInput) {
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runPiJson({
      operation: "generateThreadTitle",
      prompt,
      outputSchema,
      modelSelection: input.modelSelection,
    });
    return { title: sanitizeThreadTitle(generated.title) };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "PiTextGeneration.generateBranchName",
  )(function* (input: BranchNameGenerationInput) {
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runPiJson({
      operation: "generateBranchName",
      prompt,
      outputSchema,
      modelSelection: input.modelSelection,
    });
    return { branch: sanitizeBranchFragment(generated.branch) };
  });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "PiTextGeneration.generateCommitMessage",
  )(function* (input: CommitMessageGenerationInput) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });
    const generated = yield* runPiJson({
      operation: "generateCommitMessage",
      prompt,
      outputSchema,
      modelSelection: input.modelSelection,
    });
    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "PiTextGeneration.generatePrContent",
  )(function* (input: PrContentGenerationInput) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });
    const generated = yield* runPiJson({
      operation: "generatePrContent",
      prompt,
      outputSchema,
      modelSelection: input.modelSelection,
    });
    return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationShape;
});
