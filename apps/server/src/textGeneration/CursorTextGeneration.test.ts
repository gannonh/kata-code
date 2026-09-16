// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HostProcessPlatform } from "@kata-sh/code-shared/hostProcess";
import { createModelSelection } from "@kata-sh/code-shared/model";
import { expect } from "vite-plus/test";

import { CursorSettings, ProviderInstanceId } from "@kata-sh/code-contracts";

import * as ServerConfig from "../config.ts";
import * as TextGeneration from "./TextGeneration.ts";
import { makeCursorTextGeneration } from "./CursorTextGeneration.ts";
import { execScriptSource, writeFakeCli } from "../testUtils/fakeCli.ts";
const decodeCursorSettings = Schema.decodeSync(CursorSettings);

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../scripts/acp-mock-agent.ts");
const CURSOR_ROUTINE_MODEL_SELECTION = createModelSelection(
  ProviderInstanceId.make("cursor"),
  "composer-2",
);
const CURSOR_ROUTINE_OUTPUT = {
  draft: {
    name: "Weekday brief",
    instruction: "Summarize repository changes.",
    projectId: "project-1",
    modelSelection: CURSOR_ROUTINE_MODEL_SELECTION,
    trigger: { kind: "weekdays", time: "09:00", timezone: "UTC" },
  },
  assistantMessage: "I drafted a weekday brief.",
};

const cursorRoutineInput = {
  cwd: process.cwd(),
  prompt: "Return one JSON object for the scheduled routine draft.",
  modelSelection: CURSOR_ROUTINE_MODEL_SELECTION,
};

const CursorTextGenerationTestLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-cursor-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

function makeAcpAgentWrapper(dir: string, env: Record<string, string>): string {
  return writeFakeCli({
    directory: NodePath.join(dir, "bin"),
    name: "agent",
    env,
    source: execScriptSource({
      scriptPath: mockAgentPath,
      expectedArgs: ["acp"],
    }),
  });
}

function withFakeAcpAgent<A, E, R>(
  env: Record<string, string>,
  effectFn: (textGeneration: TextGeneration.TextGeneration["Service"]) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-cursor-text-acp-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }),
    );
    const agentPath = makeAcpAgentWrapper(tempDir, env);
    const config = decodeCursorSettings({ binaryPath: agentPath });
    const textGeneration = yield* makeCursorTextGeneration(config);
    return yield* effectFn(textGeneration);
  }).pipe(Effect.scoped);
}

function waitForFileContent(path: string): Effect.Effect<string> {
  return Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + 5_000;
    for (;;) {
      const result = yield* Effect.exit(Effect.sync(() => NodeFS.readFileSync(path, "utf8")));
      if (Exit.isSuccess(result)) {
        return result.value;
      }
      {
        if ((yield* Clock.currentTimeMillis) >= deadline) {
          return yield* Effect.die(result.cause);
        }
      }
      yield* Effect.sleep(25);
    }
  });
}

it.layer(CursorTextGenerationTestLayer)("CursorTextGeneration", (it) => {
  it.effect("uses ACP model config options instead of raw CLI model ids", () => {
    const requestLogDir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3code-cursor-text-log-"),
    );
    const requestLogPath = NodePath.join(requestLogDir, "requests.ndjson");

    return withFakeAcpAgent(
      {
        T3_ACP_REQUEST_LOG_PATH: requestLogPath,
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          subject: "Add generated commit message",
          body: "- verify cursor acp model config path",
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/cursor-text-generation",
            stagedSummary: "M apps/server/src/textGeneration/CursorTextGeneration.ts",
            stagedPatch:
              "diff --git a/apps/server/src/textGeneration/CursorTextGeneration.ts b/apps/server/src/textGeneration/CursorTextGeneration.ts",
            modelSelection: {
              ...createModelSelection(ProviderInstanceId.make("cursor"), "gpt-5.4", [
                { id: "reasoning", value: "xhigh" },
                { id: "fastMode", value: true },
                { id: "contextWindow", value: "1m" },
              ]),
            },
          });

          expect(generated.subject).toBe("Add generated commit message");
          expect(generated.body).toBe("- verify cursor acp model config path");

          const requests = NodeFS.readFileSync(requestLogPath, "utf8")
            .trim()
            .split("\n")
            .filter((line) => line.length > 0)
            .map(
              (line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> },
            );

          expect(
            requests.find((request) => request.method === "initialize")?.params?.clientCapabilities,
          ).toMatchObject({
            _meta: {
              parameterizedModelPicker: true,
            },
          });
          expect(
            requests.some(
              (request) =>
                request.method === "session/set_config_option" &&
                request.params?.configId === "model" &&
                request.params?.value === "gpt-5.4",
            ),
          ).toBe(true);
          expect(
            requests.some(
              (request) =>
                request.method === "session/set_config_option" &&
                request.params?.configId === "reasoning" &&
                request.params?.value === "extra-high",
            ),
          ).toBe(true);
          expect(
            requests.some(
              (request) =>
                request.method === "session/set_config_option" &&
                request.params?.configId === "context" &&
                request.params?.value === "1m",
            ),
          ).toBe(true);
          expect(
            requests.some(
              (request) =>
                request.method === "session/set_config_option" &&
                request.params?.configId === "fast" &&
                request.params?.value === "true",
            ),
          ).toBe(true);
          expect(
            requests.find((request) => request.method === "session/prompt")?.params?.prompt,
          ).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: expect.stringContaining("Staged patch:"),
              }),
            ]),
          );

          NodeFS.rmSync(requestLogDir, { recursive: true, force: true });
        }),
    );
  });

  it.effect("accepts json objects with extra assistant text around them", () =>
    withFakeAcpAgent(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT:
          'Sure, here is the JSON:\n```json\n{\n  "subject": "Update README dummy comment with attribution and date",\n  "body": ""\n}\n```\nDone.',
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/cursor-noisy-json",
            stagedSummary: "M README.md",
            stagedPatch: "diff --git a/README.md b/README.md",
            modelSelection: {
              instanceId: ProviderInstanceId.make("cursor"),
              model: "composer-2",
            },
          });

          expect(generated.subject).toBe("Update README dummy comment with attribution and date");
          expect(generated.body).toBe("");
        }),
    ),
  );

  it.effect("generates thread titles through Cursor ACP text generation", () =>
    withFakeAcpAgent(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          title: '"Trim reconnect spinner status after resume."',
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateThreadTitle({
            cwd: process.cwd(),
            message: "Fix the reconnect spinner after a resumed session.",
            modelSelection: {
              instanceId: ProviderInstanceId.make("cursor"),
              model: "composer-2",
            },
          });

          expect(generated.title).toBe("Trim reconnect spinner status after resume.");
        }),
    ),
  );

  it.effect("generates a strict routine draft with no ACP capabilities", () => {
    const requestLogDir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3code-cursor-routine-log-"),
    );
    const requestLogPath = NodePath.join(requestLogDir, "requests.ndjson");

    return withFakeAcpAgent(
      {
        T3_ACP_REQUEST_LOG_PATH: requestLogPath,
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify(CURSOR_ROUTINE_OUTPUT),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateRoutineDraft(cursorRoutineInput);
          expect(generated).toEqual(CURSOR_ROUTINE_OUTPUT);

          const requests = NodeFS.readFileSync(requestLogPath, "utf8")
            .trim()
            .split("\n")
            .filter((line) => line.length > 0)
            .map(
              (line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> },
            );
          expect(
            requests.find((request) => request.method === "initialize")?.params?.clientCapabilities,
          ).toMatchObject({
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          });
          expect(
            requests.some(
              (request) =>
                request.method === "session/set_config_option" &&
                request.params?.configId === "model" &&
                request.params?.value === "composer-2",
            ),
          ).toBe(true);

          NodeFS.rmSync(requestLogDir, { recursive: true, force: true });
        }),
    );
  });

  it.effect("rejects permission and workspace fields in a routine draft", () =>
    withFakeAcpAgent(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          ...CURSOR_ROUTINE_OUTPUT,
          draft: {
            ...CURSOR_ROUTINE_OUTPUT.draft,
            runtimeMode: "full-access",
            workspace: { kind: "shared", directory: process.cwd() },
          },
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const error = yield* textGeneration
            .generateRoutineDraft(cursorRoutineInput)
            .pipe(Effect.flip);
          expect(error._tag).toBe("TextGenerationError");
          expect(error.operation).toBe("generateRoutineDraft");
          expect(error.detail).toMatch(/invalid structured output/i);
        }),
    ),
  );

  it.effect("accepts a clarification routine response", () =>
    withFakeAcpAgent(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          draft: null,
          assistantMessage: "Which project should own this routine?",
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateRoutineDraft(cursorRoutineInput);
          expect(generated).toEqual({
            draft: null,
            assistantMessage: "Which project should own this routine?",
          });
        }),
    ),
  );

  it.effect("fails closed when a routine helper emits tool work", () =>
    withFakeAcpAgent({ T3_ACP_EMIT_TOOL_CALLS: "1" }, (textGeneration) =>
      Effect.gen(function* () {
        const error = yield* textGeneration
          .generateRoutineDraft(cursorRoutineInput)
          .pipe(Effect.flip);
        expect(error._tag).toBe("TextGenerationError");
        expect(error.operation).toBe("generateRoutineDraft");
        expect(error.detail).toMatch(/tool|user input/i);
      }),
    ),
  );

  // Closing the runtime on Windows is taskkill /F, which never lets the mock
  // agent reach its exit handler, so there is no exit log to assert on.
  it.effect.skipIf(HostProcessPlatform.defaultValue() === "win32")(
    "closes the ACP child process after text generation completes",
    () => {
      const exitLogDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "t3code-cursor-text-exit-log-"),
      );
      const exitLogPath = NodePath.join(exitLogDir, "exit.log");

      return withFakeAcpAgent(
        {
          T3_ACP_EXIT_LOG_PATH: exitLogPath,
          T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
            subject: "Close runtime after generation",
            body: "",
          }),
        },
        (textGeneration) =>
          Effect.gen(function* () {
            const generated = yield* textGeneration.generateCommitMessage({
              cwd: process.cwd(),
              branch: "feature/cursor-runtime-close",
              stagedSummary: "M apps/server/src/textGeneration/CursorTextGeneration.ts",
              stagedPatch:
                "diff --git a/apps/server/src/textGeneration/CursorTextGeneration.ts b/apps/server/src/textGeneration/CursorTextGeneration.ts",
              modelSelection: {
                instanceId: ProviderInstanceId.make("cursor"),
                model: "composer-2",
              },
            });

            expect(generated.subject).toBe("Close runtime after generation");

            const exitLog = yield* waitForFileContent(exitLogPath);
            expect(exitLog).toContain("exit:0");

            NodeFS.rmSync(exitLogDir, { recursive: true, force: true });
          }),
      );
    },
  );
});
