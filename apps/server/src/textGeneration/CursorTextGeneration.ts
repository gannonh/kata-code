import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import { AcpRequestError } from "effect-acp/errors";

import {
  type CursorSettings,
  type ModelSelection,
  RoutineDraftModelOutput,
} from "@kata-sh/code-contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@kata-sh/code-shared/git";
import { extractJsonObject } from "@kata-sh/code-shared/schemaJson";

import { TextGenerationError } from "@kata-sh/code-contracts";
import * as TextGeneration from "./TextGeneration.ts";
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
import {
  applyCursorAcpModelSelection,
  makeCursorAcpRuntime,
} from "../provider/acp/CursorAcpSupport.ts";

const CURSOR_TIMEOUT_MS = 180_000;

const isTextGenerationError = Schema.is(TextGenerationError);

/**
 * Build a Cursor text-generation closure bound to a specific `CursorSettings`
 * payload. See `makeCodexAdapter` for the overall per-instance rationale.
 */
export const makeCursorTextGeneration = Effect.fn("makeCursorTextGeneration")(function* (
  cursorSettings: CursorSettings,
  environment?: NodeJS.ProcessEnv,
) {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const resolvedEnvironment = environment ?? process.env;

  const runCursorJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
    strictRoutineOutput = false,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle"
      | "generateRoutineDraft";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
    strictRoutineOutput?: boolean;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const outputRef = yield* Ref.make("");
      const rejected = yield* Deferred.make<never, TextGenerationError>();
      const workingDirectory = strictRoutineOutput
        ? yield* fileSystem.makeTempDirectoryScoped({ prefix: "kata-cursor-routine-" }).pipe(
            Effect.mapError(
              (cause) =>
                new TextGenerationError({
                  operation,
                  detail: "Failed to create isolated draft directory.",
                  cause,
                }),
            ),
          )
        : cwd;
      const runtime = yield* makeCursorAcpRuntime({
        cursorSettings,
        runtimeMode: "approval-required",
        environment: resolvedEnvironment,
        childProcessSpawner: commandSpawner,
        cwd: workingDirectory,
        clientInfo: { name: "t3-code-git-text", version: "0.0.0" },
      }).pipe(Effect.provideService(Crypto.Crypto, crypto));

      const reject = (detail: string) =>
        Deferred.fail(rejected, new TextGenerationError({ operation, detail })).pipe(Effect.asVoid);
      const rejectToolRequest = () =>
        reject("Cursor text generation requested a tool or user input.").pipe(
          Effect.andThen(
            Effect.fail(
              new AcpRequestError({
                code: -32601,
                errorMessage: "Tools and user input are disabled for text generation.",
              }),
            ),
          ),
        );

      yield* runtime.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
          return reject("Cursor text generation attempted tool work.");
        }
        if (update.sessionUpdate !== "agent_message_chunk") {
          return Effect.void;
        }
        const content = update.content;
        if (content.type !== "text") {
          return Effect.void;
        }
        return Ref.update(outputRef, (current) => current + content.text);
      });

      yield* runtime.handleRequestPermission(() =>
        reject("Cursor text generation requested a tool permission or user input.").pipe(
          Effect.as({ outcome: { outcome: "cancelled" as const } }),
        ),
      );
      yield* runtime.handleElicitation(() =>
        reject("Cursor text generation requested user input.").pipe(
          Effect.as({ action: { action: "decline" as const } }),
        ),
      );
      yield* runtime.handleReadTextFile(rejectToolRequest);
      yield* runtime.handleWriteTextFile(rejectToolRequest);
      yield* runtime.handleCreateTerminal(rejectToolRequest);
      yield* runtime.handleTerminalOutput(rejectToolRequest);
      yield* runtime.handleTerminalWaitForExit(rejectToolRequest);
      yield* runtime.handleTerminalKill(rejectToolRequest);
      yield* runtime.handleTerminalRelease(rejectToolRequest);
      yield* runtime.handleUnknownExtRequest(rejectToolRequest);
      yield* runtime.handleUnknownExtNotification(() => rejectToolRequest());

      const promptResult = yield* Effect.gen(function* () {
        yield* runtime.start();
        yield* runtime.setMode("ask").pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation,
                detail: "Failed to set Cursor ACP ask mode for text generation.",
                cause,
              }),
          ),
        );
        if (strictRoutineOutput && (yield* runtime.getModeState)?.currentModeId !== "ask") {
          return yield* new TextGenerationError({
            operation,
            detail: "Cursor did not confirm ask mode; routine generation was stopped.",
          });
        }
        yield* applyCursorAcpModelSelection({
          runtime,
          model: modelSelection.model,
          selections: modelSelection.options,
          mapError: ({ cause, configId, step }) =>
            new TextGenerationError({
              operation,
              detail:
                step === "set-config-option"
                  ? `Failed to set Cursor ACP config option "${configId}" for text generation.`
                  : "Failed to set Cursor ACP base model for text generation.",
              cause,
            }),
        });

        return yield* runtime.prompt({
          prompt: [{ type: "text", text: prompt }],
        });
      }).pipe(
        Effect.timeoutOption(CURSOR_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({
                  operation,
                  detail: "Cursor Agent request timed out.",
                }),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation,
                detail: "Cursor ACP request failed.",
                cause,
              }),
        ),
        Effect.raceFirst(Deferred.await(rejected)),
      );

      const rawResult = (yield* Ref.get(outputRef)).trim();
      if (!rawResult) {
        return yield* new TextGenerationError({
          operation,
          detail:
            promptResult.stopReason === "cancelled"
              ? "Cursor ACP request was cancelled."
              : "Cursor Agent returned empty output.",
        });
      }

      const decodeOutput = Schema.decodeEffect(
        Schema.fromJsonString(outputSchemaJson),
        strictRoutineOutput ? { onExcessProperty: "error" } : undefined,
      );
      return yield* decodeOutput(extractJsonObject(rawResult)).pipe(
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Cursor Agent returned invalid structured output.",
                cause,
              }),
            ),
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation,
              detail: "Cursor ACP text generation failed.",
              cause,
            }),
      ),
      Effect.scoped,
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("CursorTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });

      const generated = yield* runCursorJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
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

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("CursorTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });

      const generated = yield* runCursorJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("CursorTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* runCursorJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("CursorTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });

      const generated = yield* runCursorJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizeThreadTitle(generated.title),
      } satisfies TextGeneration.ThreadTitleGenerationResult;
    });

  const generateRoutineDraft: TextGeneration.TextGeneration["Service"]["generateRoutineDraft"] =
    Effect.fn("CursorTextGeneration.generateRoutineDraft")(function* (input) {
      return yield* runCursorJson({
        operation: "generateRoutineDraft",
        cwd: input.cwd,
        prompt: input.prompt,
        outputSchemaJson: RoutineDraftModelOutput,
        modelSelection: input.modelSelection,
        strictRoutineOutput: true,
      });
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
    generateRoutineDraft,
  } satisfies TextGeneration.TextGeneration["Service"];
});
