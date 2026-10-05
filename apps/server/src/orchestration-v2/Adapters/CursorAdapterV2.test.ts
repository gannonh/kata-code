import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { AgentOptions, InteractionUpdate, McpServerConfig } from "@cursor/sdk";
import {
  CursorSettings,
  EnvironmentId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@kata-sh/code-contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import * as IdAllocator from "../IdAllocator.ts";
import { cursorWorkspaceSlug } from "../../provider/acp/CursorPluginMcp.ts";
import { ProviderAdapterV2RuntimePolicy } from "../ProviderAdapter.ts";
import {
  cursorMcpServers,
  cursorRuntimeAgentPolicy,
  cursorSdkModelSelection,
  makeCursorAgentOptions,
  makeCursorAdapterV2,
  nestedToolCallFromEnvelope,
} from "./CursorAdapterV2.ts";
import { isCursorCancellationError, loggedCursorAgentOptions } from "./CursorAgentSdk.ts";

const decodeCursorSettings = Schema.decodeEffect(CursorSettings);

describe("CursorAdapterV2", () => {
  it.effect.each([
    { status: "finished", model: undefined },
    { status: "cancelled", model: "claude-opus-4-6" },
    { status: "error", model: "custom-fable" },
  ] as const)(
    "settles missing task completions when the Cursor run is $status",
    ({ status, model }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspace = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "cursor-v2-lifecycle-",
        });
        const instanceId = ProviderInstanceId.make("cursor");
        const threadId = ThreadId.make("cursor-lifecycle-thread");
        const modelSelection = { instanceId, model: "composer-2.5" };
        const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: workspace,
        });
        const adapter = makeCursorAdapterV2({
          instanceId,
          settings: yield* decodeCursorSettings({}),
          environment: { HOME: workspace },
          fileSystem,
          path,
          idAllocator: yield* IdAllocator.IdAllocatorV2,
          serverConfig: yield* ServerConfig.ServerConfig.pipe(
            Effect.provide(
              ServerConfig.layerTest(workspace, { prefix: "cursor-v2-lifecycle-config-" }),
            ),
          ),
          runner: {
            assertComplete: Effect.void,
            open: () =>
              Effect.succeed({
                agentId: "native-cursor-lifecycle",
                listMessages: Effect.succeed([]),
                close: Effect.void,
                send: (input) =>
                  Effect.gen(function* () {
                    // Recorded Cursor task calls (see fixtures/subagent) stream a
                    // partial-tool-call before tool-call-started with the same args.
                    // The run then ends without tool-call-completed, which a live
                    // run cannot produce on demand.
                    const taskToolCall = {
                      type: "task" as const,
                      args: {
                        description: "Review",
                        prompt: "Review the code.",
                        subagentType: { kind: "unspecified" },
                        ...(model === undefined ? {} : { model }),
                        agentId: "cursor-task-agent",
                        mode: "unspecified" as const,
                      },
                    };
                    for (const type of ["partial-tool-call", "tool-call-started"] as const) {
                      yield* input.onDelta!({
                        type,
                        modelCallId: "model-call",
                        callId: "task-call",
                        toolCall: taskToolCall,
                      }).pipe(Effect.orDie);
                    }
                    return {
                      agentId: "native-cursor-lifecycle",
                      runId: "native-cursor-run",
                      wait: Effect.succeed({
                        id: "native-cursor-run",
                        requestId: "native-request",
                        status,
                        model: { id: "composer-2.5" },
                        durationMs: 1,
                      }),
                      cancel: Effect.void,
                    };
                  }),
              }),
          },
        });
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("cursor-lifecycle-session"),
          modelSelection,
          runtimePolicy,
        });
        const providerThread = yield* runtime.ensureThread({
          threadId,
          modelSelection,
          runtimePolicy,
        });
        const now = yield* DateTime.now;
        yield* runtime.startTurn({
          threadId,
          providerThread,
          modelSelection,
          runtimePolicy,
          runId: RunId.make("cursor-lifecycle-run"),
          runOrdinal: 1,
          providerTurnOrdinal: 1,
          attemptId: RunAttemptId.make("cursor-lifecycle-attempt"),
          rootNodeId: NodeId.make("cursor-lifecycle-root"),
          appThread: {
            id: threadId,
            projectId: ProjectId.make("cursor-lifecycle-project"),
            createdBy: "user",
            creationSource: "web",
            title: "Cursor lifecycle",
            providerInstanceId: instanceId,
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: providerThread.id,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
          message: {
            messageId: MessageId.make("cursor-lifecycle-message"),
            createdBy: "user",
            creationSource: "web",
            text: "Review the code.",
            attachments: [],
          },
        });
        const events = yield* runtime.events.pipe(
          Stream.takeUntil((event) => event.type === "turn.terminal"),
          Stream.runCollect,
        );
        const rows = events.filter((event) => event.type === "subagent.updated");
        assert.equal(rows[0]?.subagent.status, "running");
        assert.equal(rows[0]?.subagent.model, model ?? null);
        assert.equal(
          rows.at(-1)?.subagent.status,
          status === "finished" ? "idle" : status === "cancelled" ? "cancelled" : "failed",
        );
        assert.isNotNull(rows.at(-1)?.subagent.completedAt);
      }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect("fails standalone SDK transport diagnostics and sends compaction as /compress", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-errors-" });
      const sentMessages: Array<string> = [];
      let sendCalls = 0;
      const instanceId = ProviderInstanceId.make("cursor");
      const threadId = ThreadId.make("cursor-transport-error-thread");
      const modelSelection = { instanceId, model: "composer-2.5" };
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      const adapter = makeCursorAdapterV2({
        instanceId,
        settings: yield* decodeCursorSettings({}),
        environment: { HOME: workspace },
        fileSystem,
        path,
        idAllocator: yield* IdAllocator.IdAllocatorV2,
        serverConfig: yield* ServerConfig.ServerConfig.pipe(
          Effect.provide(ServerConfig.layerTest(workspace, { prefix: "cursor-v2-error-config-" })),
        ),
        runner: {
          assertComplete: Effect.void,
          open: () =>
            Effect.succeed({
              agentId: "native-cursor-error",
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: (input) =>
                Effect.sync(() => {
                  sendCalls += 1;
                  sentMessages.push(
                    typeof input.message === "string" ? input.message : input.message.text,
                  );
                  const runId = `native-cursor-run-${sendCalls}`;
                  return {
                    agentId: "native-cursor-error",
                    runId,
                    wait: Effect.succeed({
                      id: runId,
                      requestId: `native-request-${sendCalls}`,
                      status: "finished" as const,
                      model: { id: "composer-2.5" },
                      durationMs: 1,
                      ...(sendCalls === 1
                        ? { result: "Error: RetriableError: WritableIterable is closed" }
                        : {}),
                    }),
                    cancel: Effect.void,
                  };
                }),
            }),
        },
      });
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("cursor-error-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      const appThread = {
        id: threadId,
        projectId: ProjectId.make("cursor-error-project"),
        createdBy: "user" as const,
        creationSource: "web" as const,
        title: "Cursor transport failure",
        providerInstanceId: instanceId,
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        activeProviderThreadId: providerThread.id,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      };
      yield* runtime.startTurn({
        threadId,
        providerThread,
        modelSelection,
        runtimePolicy,
        runId: RunId.make("cursor-error-run"),
        runOrdinal: 1,
        providerTurnOrdinal: 1,
        attemptId: RunAttemptId.make("cursor-error-attempt"),
        rootNodeId: NodeId.make("cursor-error-root"),
        appThread,
        message: {
          messageId: MessageId.make("cursor-error-message"),
          createdBy: "user",
          creationSource: "web",
          text: "continue",
          attachments: [],
        },
      });
      const first = yield* runtime.events.pipe(
        Stream.filter((event) => event.type === "turn.terminal"),
        Stream.runHead,
      );
      assert.isTrue(Option.isSome(first));
      if (Option.isSome(first)) {
        assert.equal(first.value.status, "failed");
        assert.equal(first.value.failure?.class, "transport_error");
      }

      assert.isDefined(runtime.compactThread);
      yield* runtime.compactThread!({
        threadId,
        providerThread,
        modelSelection,
        runtimePolicy,
        runId: RunId.make("cursor-compact-run"),
        runOrdinal: 2,
        providerTurnOrdinal: 2,
        attemptId: RunAttemptId.make("cursor-compact-attempt"),
        rootNodeId: NodeId.make("cursor-compact-root"),
        appThread,
        message: {
          messageId: MessageId.make("cursor-compact-message"),
          createdBy: "user",
          creationSource: "web",
          text: "ignored by compactThread",
          attachments: [],
        },
      });
      yield* runtime.events.pipe(
        Stream.filter((event) => event.type === "turn.terminal"),
        Stream.runHead,
      );
      assert.equal(sentMessages[1], "/compress");
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect("sends a bare skill pick as Cursor's /name with no runtime instructions", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-skill-" });
      const skillDirectory = path.join(workspace, ".cursor", "skills", "poteto-mode");
      yield* fileSystem.makeDirectory(skillDirectory, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(skillDirectory, "SKILL.md"),
        "---\ndescription: poteto mode\n---\n",
      );
      const sentMessages: Array<string> = [];
      let sendCalls = 0;
      const instanceId = ProviderInstanceId.make("cursor");
      const threadId = ThreadId.make("cursor-skill-thread");
      const modelSelection = { instanceId, model: "composer-2.5" };
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      const adapter = makeCursorAdapterV2({
        instanceId,
        settings: yield* decodeCursorSettings({}),
        environment: { HOME: workspace },
        fileSystem,
        path,
        idAllocator: yield* IdAllocator.IdAllocatorV2,
        serverConfig: yield* ServerConfig.ServerConfig.pipe(
          Effect.provide(ServerConfig.layerTest(workspace, { prefix: "cursor-v2-skill-config-" })),
        ),
        runner: {
          assertComplete: Effect.void,
          open: () =>
            Effect.succeed({
              agentId: "native-cursor-skill",
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: (input) =>
                Effect.sync(() => {
                  sendCalls += 1;
                  sentMessages.push(
                    typeof input.message === "string" ? input.message : input.message.text,
                  );
                  const runId = `native-cursor-skill-run-${sendCalls}`;
                  return {
                    agentId: "native-cursor-skill",
                    runId,
                    wait: Effect.succeed({
                      id: runId,
                      requestId: `native-skill-request-${sendCalls}`,
                      status: "finished" as const,
                      model: { id: "composer-2.5" },
                      durationMs: 1,
                      result: "done",
                    }),
                    cancel: Effect.void,
                  };
                }),
            }),
        },
      });
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("cursor-skill-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      const appThread = {
        id: threadId,
        projectId: ProjectId.make("cursor-skill-project"),
        createdBy: "user" as const,
        creationSource: "web" as const,
        title: "Cursor skill pick",
        providerInstanceId: instanceId,
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        activeProviderThreadId: providerThread.id,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      };
      const runTurn = (ordinal: number, text: string) =>
        runtime
          .startTurn({
            threadId,
            providerThread,
            modelSelection,
            runtimePolicy,
            runId: RunId.make(`cursor-skill-run-${ordinal}`),
            runOrdinal: ordinal,
            providerTurnOrdinal: ordinal,
            attemptId: RunAttemptId.make(`cursor-skill-attempt-${ordinal}`),
            rootNodeId: NodeId.make(`cursor-skill-root-${ordinal}`),
            appThread,
            message: {
              messageId: MessageId.make(`cursor-skill-message-${ordinal}`),
              createdBy: "user",
              creationSource: "web",
              text,
              attachments: [],
            },
          })
          .pipe(
            Effect.andThen(
              runtime.events.pipe(
                Stream.filter((event) => event.type === "turn.terminal"),
                Stream.runHead,
              ),
            ),
          );

      yield* runTurn(1, "$poteto-mode ");
      yield* runTurn(2, "please $poteto-mode this");

      assert.equal(sentMessages[0], "/poteto-mode");
      assert.isTrue(sentMessages[1]?.startsWith("please /poteto-mode this\n\n<runtime_info>"));
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect("projects Cursor directory trees and lint diagnostics as file search results", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-search-" });
      const instanceId = ProviderInstanceId.make("cursor");
      const threadId = ThreadId.make("cursor-search-thread");
      const modelSelection = { instanceId, model: "composer-2.5" };
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      const emptyLsNode = {
        childrenDirs: [],
        childrenFiles: [],
        childrenWereProcessed: true,
        fullSubtreeExtensionCounts: {},
        numFiles: 0,
      };
      const updates: ReadonlyArray<InteractionUpdate> = [
        ...(["tool-call-started", "tool-call-completed"] as const).map((type) => ({
          type,
          modelCallId: "native-model-call",
          callId: "mcp-weather",
          toolCall: {
            type: "mcp" as const,
            args: {
              providerIdentifier: "weather",
              toolName: "get_weather",
              args: { city: "Berlin" },
            },
            ...(type === "tool-call-completed"
              ? { result: { status: "success" as const, value: { content: [], isError: false } } }
              : {}),
          },
        })),
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "read-file",
          toolCall: {
            type: "read",
            args: { path: "src/env.ts" },
            result: {
              status: "success",
              value: { fileSize: 12, content: "---\nfile body", totalLines: 2 },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "ls-nested",
          toolCall: {
            type: "ls",
            args: { path: workspace },
            result: {
              status: "success",
              value: {
                directoryTreeRoot: {
                  ...emptyLsNode,
                  absPath: workspace,
                  childrenFiles: [{ name: "README.md" }],
                  childrenDirs: [
                    {
                      ...emptyLsNode,
                      absPath: path.join(workspace, "src"),
                      childrenFiles: [{ name: "index.ts" }],
                      childrenDirs: [
                        {
                          ...emptyLsNode,
                          absPath: path.join(workspace, "src", "nested"),
                          childrenFiles: [{ name: "util.ts" }],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "ls-empty",
          toolCall: {
            type: "ls",
            args: { path: path.join(workspace, "empty") },
            result: {
              status: "success",
              value: {
                directoryTreeRoot: { ...emptyLsNode, absPath: path.join(workspace, "empty") },
              },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "ls-failed",
          toolCall: {
            type: "ls",
            args: { path: path.join(workspace, "missing") },
            result: { status: "error", error: "ENOENT" },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "grep-failed",
          toolCall: {
            type: "grep",
            args: { pattern: "TODO", path: "src" },
            result: { status: "error", error: "search failed" },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "glob-failed",
          toolCall: {
            type: "glob",
            args: { globPattern: "*.ts" },
            result: { status: "error", error: "search failed" },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "lints",
          toolCall: {
            type: "readLints",
            args: { paths: ["src/a.ts", "src/b.ts"] },
            result: {
              status: "success",
              value: {
                totalFiles: 2,
                totalDiagnostics: 3,
                fileDiagnostics: [
                  {
                    path: "src/a.ts",
                    diagnosticsCount: 2,
                    diagnostics: [
                      {
                        message: "Unused variable",
                        code: "TS6133",
                        source: "ts",
                        severity: "warning",
                        range: { start: { line: 0, character: 4 } },
                      },
                      {
                        message: "Cannot find name",
                        code: "TS2304",
                        source: "ts",
                        severity: "error",
                        range: { start: { line: 11 } },
                      },
                    ],
                  },
                  {
                    path: "src/b.ts",
                    diagnosticsCount: 1,
                    diagnostics: [
                      {
                        message: "File-level diagnostic",
                        code: "TS0",
                        source: "ts",
                        severity: "information",
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "lints-empty",
          toolCall: {
            type: "readLints",
            args: { paths: ["src/clean.ts"] },
            result: {
              status: "success",
              value: {
                totalFiles: 1,
                totalDiagnostics: 0,
                fileDiagnostics: [{ path: "src/clean.ts", diagnosticsCount: 0, diagnostics: [] }],
              },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "lints-failed",
          toolCall: {
            type: "readLints",
            args: { paths: ["src/a.ts"] },
            result: { status: "error", error: "lint failed" },
          },
        },
      ];
      const adapter = makeCursorAdapterV2({
        instanceId,
        settings: yield* decodeCursorSettings({}),
        environment: { HOME: workspace },
        fileSystem,
        path,
        idAllocator: yield* IdAllocator.IdAllocatorV2,
        serverConfig: yield* ServerConfig.ServerConfig.pipe(
          Effect.provide(ServerConfig.layerTest(workspace, { prefix: "cursor-v2-search-config-" })),
        ),
        runner: {
          assertComplete: Effect.void,
          open: () =>
            Effect.succeed({
              agentId: "native-cursor-search",
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: (input) =>
                Effect.gen(function* () {
                  for (const update of updates) {
                    if (input.onDelta !== undefined) {
                      yield* input.onDelta(update).pipe(Effect.orDie);
                    }
                  }
                  return {
                    agentId: "native-cursor-search",
                    runId: "native-cursor-run",
                    wait: Effect.succeed({
                      id: "native-cursor-run",
                      requestId: "native-request",
                      status: "finished" as const,
                      model: { id: "composer-2.5" },
                      durationMs: 1,
                    }),
                    cancel: Effect.void,
                  };
                }),
            }),
        },
      });
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("cursor-search-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      yield* runtime.startTurn({
        threadId,
        providerThread,
        modelSelection,
        runtimePolicy,
        runId: RunId.make("cursor-search-run"),
        runOrdinal: 1,
        providerTurnOrdinal: 1,
        attemptId: RunAttemptId.make("cursor-search-attempt"),
        rootNodeId: NodeId.make("cursor-search-root"),
        appThread: {
          id: threadId,
          projectId: ProjectId.make("cursor-search-project"),
          createdBy: "user",
          creationSource: "web",
          title: "Cursor search results",
          providerInstanceId: instanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: providerThread.id,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
        message: {
          messageId: MessageId.make("cursor-search-message"),
          createdBy: "user",
          creationSource: "web",
          text: "inspect the workspace",
          attachments: [],
        },
      });
      const events = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
      );
      const mcpItems = events.flatMap((event) =>
        event.type === "turn_item.updated" &&
        event.turnItem.type === "dynamic_tool" &&
        event.turnItem.toolName === "mcp__weather__get_weather"
          ? [event.turnItem]
          : [],
      );
      assert.deepEqual(
        mcpItems.map((item) => item.status),
        ["running", "completed"],
      );
      for (const item of mcpItems) {
        assert.equal(item.title, "get weather");
        assert.deepEqual(item.toolSource, {
          key: "mcp:weather",
          name: "weather",
          kind: "integration",
        });
        assert.deepEqual(item.input, {
          providerIdentifier: "weather",
          toolName: "get_weather",
          args: { city: "Berlin" },
        });
      }
      const fileSearchItems = events.flatMap((event) =>
        event.type === "turn_item.updated" &&
        event.turnItem.type === "file_search" &&
        event.turnItem.status !== "running"
          ? [event.turnItem]
          : [],
      );
      const readItems = events.flatMap((event) =>
        event.type === "turn_item.updated" &&
        event.turnItem.type === "dynamic_tool" &&
        event.turnItem.toolName === "Read" &&
        event.turnItem.status === "completed"
          ? [event.turnItem]
          : [],
      );
      assert.deepEqual(
        readItems.map((item) => ({ title: item.title, input: item.input })),
        [{ title: "Read src/env.ts", input: { path: "src/env.ts" } }],
      );
      assert.deepEqual(
        fileSearchItems.map((item) => ({
          pattern: item.pattern,
          status: item.status,
          results: item.results,
        })),
        [
          {
            pattern: workspace,
            status: "completed",
            results: [
              { fileName: path.join(workspace, "README.md") },
              { fileName: path.join(workspace, "src", "index.ts") },
              { fileName: path.join(workspace, "src", "nested", "util.ts") },
            ],
          },
          {
            pattern: path.join(workspace, "empty"),
            status: "completed",
            results: undefined,
          },
          {
            pattern: path.join(workspace, "missing"),
            status: "failed",
            results: [{ fileName: path.join(workspace, "missing"), preview: "ENOENT" }],
          },
          {
            pattern: "TODO",
            status: "failed",
            results: [{ fileName: "src", preview: "search failed" }],
          },
          {
            pattern: "*.ts",
            status: "failed",
            results: [{ fileName: ".", preview: "search failed" }],
          },
          {
            pattern: "src/a.ts, src/b.ts",
            status: "completed",
            results: [
              { fileName: "src/a.ts", line: 1, column: 5, preview: "Unused variable" },
              { fileName: "src/a.ts", line: 12, preview: "Cannot find name" },
              { fileName: "src/b.ts", preview: "File-level diagnostic" },
            ],
          },
          {
            pattern: "src/clean.ts",
            status: "completed",
            results: undefined,
          },
          {
            pattern: "src/a.ts",
            status: "failed",
            results: [{ fileName: "src/a.ts", preview: "lint failed" }],
          },
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it("maps Cursor auto and model parameters to SDK selections", () => {
    assert.deepEqual(
      cursorSdkModelSelection({
        instanceId: ProviderInstanceId.make("cursor"),
        model: "auto",
        options: [
          { id: "thinking", value: "high" },
          { id: "contextWindow", value: "1m" },
          { id: "fastMode", value: true },
        ],
      }),
      {
        id: "default",
        params: [
          { id: "thinking", value: "high" },
          { id: "context", value: "1m" },
          { id: "fast", value: "true" },
        ],
      },
    );
  });

  it("maps runtime modes to the SDK sandbox and auto-review controls", () => {
    const base = {
      interactionMode: "default" as const,
      cwd: "/tmp/cursor-adapter",
    };
    assert.deepEqual(
      cursorRuntimeAgentPolicy({
        ...base,
        runtimeMode: "full-access",
      }),
      {
        autoReview: false,
        sandboxEnabled: false,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy({
        ...base,
        runtimeMode: "auto-accept-edits",
      }),
      {
        autoReview: false,
        sandboxEnabled: true,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy({
        ...base,
        runtimeMode: "approval-required",
      }),
      {
        autoReview: true,
        sandboxEnabled: true,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy({
        ...base,
        runtimeMode: "full-access",
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" },
      }),
      {
        autoReview: false,
        sandboxEnabled: true,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy({
        ...base,
        runtimeMode: "approval-required",
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      }),
      {
        autoReview: false,
        sandboxEnabled: false,
      },
    );
  });

  it("loads the user's Cursor settings layers in every runtime mode", () => {
    // The SDK loads no rules, skills, hooks, or MCP config from disk unless
    // settingSources names them, so an omitted list silently drops AGENTS.md.
    for (const runtimeMode of ["full-access", "auto-accept-edits", "approval-required"] as const) {
      const options = makeCursorAgentOptions({
        modelSelection: {
          instanceId: ProviderInstanceId.make("cursor"),
          model: "composer-2.5",
        },
        runtimePolicy: { runtimeMode, interactionMode: "default", cwd: "/workspace" },
        threadId: ThreadId.make("thread-cursor-setting-sources"),
      });
      assert.deepEqual(options.local?.settingSources, [
        "project",
        "user",
        "team",
        "mdm",
        "plugins",
      ]);
    }
  });

  it("injects thread-scoped MCP credentials without logging them", () => {
    const threadId = ThreadId.make("thread-cursor-mcp");
    McpProviderSession.setMcpProviderSession({
      environmentId: EnvironmentId.make("environment-cursor-mcp"),
      threadId,
      providerSessionId: "mcp-session-cursor",
      providerInstanceId: ProviderInstanceId.make("cursor"),
      endpoint: "http://127.0.0.1:43123/mcp",
      authorizationHeader: "Bearer secret-cursor-mcp-token",
      browserToolsAvailable: true,
    });

    try {
      assert.deepEqual(cursorMcpServers(threadId), {
        "t3-code": {
          type: "http",
          url: "http://127.0.0.1:43123/mcp",
          headers: {
            Authorization: "Bearer secret-cursor-mcp-token",
          },
        },
      });

      const options = makeCursorAgentOptions({
        apiKey: "secret-cursor-api-key",
        modelSelection: {
          instanceId: ProviderInstanceId.make("cursor"),
          model: "composer-2.5",
        },
        runtimePolicy: {
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: "/workspace",
        },
        threadId,
      });
      assert.deepEqual(options.mcpServers, cursorMcpServers(threadId));

      const logged = JSON.stringify(loggedCursorAgentOptions(options));
      assert.notInclude(logged, "secret-cursor-api-key");
      assert.notInclude(logged, "secret-cursor-mcp-token");
    } finally {
      McpProviderSession.clearMcpProviderSession(threadId);
    }
  });

  it("recognizes direct and SDK-wrapped abort failures as cancellation", () => {
    assert.isTrue(isCursorCancellationError({ name: "AbortError" }));
    assert.isTrue(
      isCursorCancellationError({
        name: "ConnectError",
        cause: {
          name: "ConnectError",
          cause: { name: "AbortError" },
        },
      }),
    );
    assert.isFalse(isCursorCancellationError(new Error("request failed")));
    assert.isFalse(isCursorCancellationError(null));
  });

  it("preserves failed nested read calls when Cursor omits their path", () => {
    assert.deepEqual(
      nestedToolCallFromEnvelope({
        toolCallId: "tool:failed-read",
        readToolCall: {
          args: {},
          result: { error: "File path was not provided." },
        },
      }),
      {
        callId: "tool:failed-read",
        toolCall: {
          type: "read",
          args: { path: "<unknown path>" },
          result: {
            status: "error",
            error: "File path was not provided.",
          },
        },
      },
    );
  });
});

const decodeStoredLinearLogin = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ "plugin-linear-linear": Schema.Struct({ tokens: Schema.Unknown }) }),
  ),
);
const LINEAR_MCP = "https://mcp.linear.app/mcp";
const LINEAR_RESOURCE_METADATA = "https://mcp.linear.app/oauth/resource-metadata";

/**
 * Linear's MCP endpoint, RFC 9728 and RFC 8414 metadata, and token endpoint.
 * The MCP endpoint accepts only `validAccessToken`; nothing leaves the process.
 */
function linearOAuthServer(validAccessToken: string) {
  const probedTokens: Array<string | null> = [];
  const tokenRequests: Array<URLSearchParams> = [];
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  const fetchFn: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === LINEAR_MCP) {
      const authorization = new Headers(init?.headers).get("authorization");
      probedTokens.push(authorization);
      return authorization === `Bearer ${validAccessToken}`
        ? new Response(null, { status: 200 })
        : new Response(null, {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${LINEAR_RESOURCE_METADATA}"`,
            },
          });
    }
    if (url === LINEAR_RESOURCE_METADATA) {
      return json({ resource: LINEAR_MCP, authorization_servers: ["https://mcp.linear.app"] });
    }
    if (url === "https://mcp.linear.app/.well-known/oauth-authorization-server") {
      return json({
        issuer: "https://mcp.linear.app",
        token_endpoint: "https://mcp.linear.app/token",
      });
    }
    if (url === "https://mcp.linear.app/token") {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      return json({
        access_token: validAccessToken,
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
      });
    }
    return new Response(null, { status: 404 });
  };
  return { fetchFn, probedTokens, tokenRequests };
}

/**
 * A Cursor home with the Linear plugin enabled and a Kata project folder with
 * one worktree. `logins` maps a folder to the Linear access token Cursor
 * stored for it; a folder other than `project` or `worktree` names an
 * unrelated folder under `dev/`, and `modifiedAtSeconds` sets its store's mtime.
 */
const makeCursorPluginFixture = Effect.fn("makeCursorPluginFixture")(function* (
  logins: ReadonlyArray<{
    readonly folder: string;
    readonly accessToken: string;
    readonly modifiedAtSeconds?: number;
  }>,
  otherPlugins: ReadonlyArray<{
    readonly folder: string;
    readonly name: string;
    readonly mcpServers: Record<string, unknown>;
  }> = [],
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-plugin-oauth-" });
  const dataDir = path.join(root, "cursor");
  const folders = {
    project: path.join(root, "dev", "kata-code"),
    worktree: path.join(root, ".katacode", "worktrees", "kata-code", "katacode-1"),
  };
  const writeJson = (file: string, value: unknown) =>
    fileSystem
      .makeDirectory(path.dirname(file), { recursive: true })
      .pipe(Effect.andThen(fileSystem.writeFileString(file, JSON.stringify(value))));
  const pluginRoot = path.join(root, "plugins", "linear");
  yield* writeJson(path.join(pluginRoot, ".cursor-plugin", "plugin.json"), { name: "linear" });
  yield* writeJson(path.join(pluginRoot, "mcp.json"), {
    mcpServers: { linear: { url: LINEAR_MCP } },
  });
  const enabledPlugins: Record<string, string> = { linear: pluginRoot };
  for (const plugin of otherPlugins) {
    const otherRoot = path.join(root, "plugins", plugin.folder);
    yield* writeJson(path.join(otherRoot, ".cursor-plugin", "plugin.json"), { name: plugin.name });
    yield* writeJson(path.join(otherRoot, "mcp.json"), { mcpServers: plugin.mcpServers });
    enabledPlugins[plugin.folder] = otherRoot;
  }
  yield* writeJson(path.join(dataDir, "settings.json"), { enabled_plugins: enabledPlugins });
  const authFile = (folder: string) =>
    path.join(dataDir, "projects", cursorWorkspaceSlug(folder), "mcp-auth.json");
  for (const login of logins) {
    const folder =
      login.folder === "project" || login.folder === "worktree"
        ? folders[login.folder]
        : path.join(root, "dev", login.folder);
    yield* writeJson(authFile(folder), {
      "plugin-linear-linear": {
        tokens: {
          access_token: login.accessToken,
          token_type: "bearer",
          refresh_token: `${login.folder}-refresh-token`,
        },
        clientInfo: { client_id: "linear-client" },
      },
    });
    if (login.modifiedAtSeconds !== undefined) {
      yield* fileSystem.utimes(authFile(folder), login.modifiedAtSeconds, login.modifiedAtSeconds);
    }
  }
  return {
    ...folders,
    projectAuthFile: authFile(folders.project),
    env: { HOME: root, CURSOR_DATA_DIR: dataDir } satisfies NodeJS.ProcessEnv,
  };
});

const runCursorTurns = Effect.fn("runCursorTurns")(function* (input: {
  readonly cwd: string;
  readonly projectRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly fetch: typeof globalThis.fetch;
  readonly t3AuthorizationHeaders?: ReadonlyArray<string>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const instanceId = ProviderInstanceId.make("cursor");
  const threadId = ThreadId.make("cursor-plugin-oauth-thread");
  const modelSelection = { instanceId, model: "composer-2.5" };
  const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
    runtimeMode: "full-access",
    interactionMode: "default",
    cwd: input.cwd,
    projectRoot: input.projectRoot,
  });
  const opened: Array<AgentOptions> = [];
  const opens: Array<{ readonly operation: string; readonly agentId: string | undefined }> = [];
  const closed: Array<number> = [];
  const sent: Array<Record<string, McpServerConfig> | undefined> = [];
  const adapter = makeCursorAdapterV2({
    instanceId,
    settings: yield* decodeCursorSettings({}),
    environment: input.env,
    fileSystem,
    path,
    idAllocator: yield* IdAllocator.IdAllocatorV2,
    serverConfig: yield* ServerConfig.ServerConfig.pipe(
      Effect.provide(
        ServerConfig.layerTest(input.cwd, { prefix: "cursor-v2-plugin-oauth-config-" }),
      ),
    ),
    fetch: input.fetch,
    runner: {
      assertComplete: Effect.void,
      open: (openInput) =>
        Effect.sync(() => {
          const index = opened.length;
          opened.push(openInput.options);
          opens.push({ operation: openInput.operation, agentId: openInput.agentId });
          return {
            agentId: "native-cursor-plugin-oauth",
            listMessages: Effect.succeed([]),
            close: Effect.sync(() => {
              closed.push(index);
            }),
            send: (sendInput) =>
              Effect.sync(() => {
                sent.push(sendInput.options?.mcpServers);
                const runId = `native-cursor-plugin-oauth-run-${sent.length}`;
                return {
                  agentId: "native-cursor-plugin-oauth",
                  runId,
                  wait: Effect.succeed({
                    id: runId,
                    requestId: "native-request",
                    status: "finished" as const,
                    model: { id: "composer-2.5" },
                    durationMs: 1,
                  }),
                  cancel: Effect.void,
                };
              }),
          };
        }),
    },
  });
  const setT3McpSession = (authorizationHeader: string) =>
    McpProviderSession.setMcpProviderSession({
      environmentId: EnvironmentId.make("environment-cursor-plugin-oauth"),
      threadId,
      providerSessionId: "mcp-session-cursor-plugin-oauth",
      providerInstanceId: instanceId,
      endpoint: "http://127.0.0.1:43123/mcp",
      authorizationHeader,
      browserToolsAvailable: false,
    });
  const [firstHeader = "Bearer t3-mcp-token", ...laterHeaders] = input.t3AuthorizationHeaders ?? [];
  setT3McpSession(firstHeader);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId)),
  );
  const runtime = yield* adapter.openSession({
    threadId,
    providerSessionId: ProviderSessionId.make("cursor-plugin-oauth-session"),
    modelSelection,
    runtimePolicy,
  });
  const providerThread = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
  const now = yield* DateTime.now;
  for (const [index, header] of [firstHeader, ...laterHeaders].entries()) {
    setT3McpSession(header);
    const ordinal = index + 1;
    yield* runtime.startTurn({
      threadId,
      providerThread,
      modelSelection,
      runtimePolicy,
      runId: RunId.make(`cursor-plugin-oauth-run-${ordinal}`),
      runOrdinal: ordinal,
      providerTurnOrdinal: ordinal,
      attemptId: RunAttemptId.make(`cursor-plugin-oauth-attempt-${ordinal}`),
      rootNodeId: NodeId.make(`cursor-plugin-oauth-root-${ordinal}`),
      appThread: {
        id: threadId,
        projectId: ProjectId.make("cursor-plugin-oauth-project"),
        createdBy: "user",
        creationSource: "web",
        title: "Cursor plugin OAuth",
        providerInstanceId: instanceId,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: input.cwd === input.projectRoot ? null : input.cwd,
        activeProviderThreadId: providerThread.id,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
      message: {
        messageId: MessageId.make(`cursor-plugin-oauth-message-${ordinal}`),
        createdBy: "user",
        creationSource: "web",
        text: "List my Linear issues.",
        attachments: [],
      },
    });
    yield* runtime.events.pipe(
      Stream.takeUntil((event) => event.type === "turn.terminal"),
      Stream.runDrain,
    );
  }
  return { opened: opened.map((options) => options.mcpServers), opens, closed: [...closed], sent };
});

const T3_MCP_SERVER = {
  type: "http",
  url: "http://127.0.0.1:43123/mcp",
  headers: { Authorization: "Bearer t3-mcp-token" },
} as const;

const linearServer = (accessToken: string) =>
  ({
    type: "http",
    url: LINEAR_MCP,
    headers: { Authorization: `Bearer ${accessToken}` },
  }) satisfies McpServerConfig;

describe("CursorAdapterV2 plugin MCP servers", () => {
  it.effect("a worktree thread receives the project's plugin OAuth token", () =>
    Effect.gen(function* () {
      const fixture = yield* makeCursorPluginFixture([
        { folder: "project", accessToken: "project-linear-token" },
      ]);
      const linear = linearOAuthServer("project-linear-token");
      const worktree = yield* runCursorTurns({
        cwd: fixture.worktree,
        projectRoot: fixture.project,
        env: fixture.env,
        fetch: linear.fetchFn,
      });
      const forwarded = {
        "plugin-linear-linear": linearServer("project-linear-token"),
        "t3-code": T3_MCP_SERVER,
      };
      assert.deepEqual(worktree.opened, [forwarded]);
      assert.deepEqual(worktree.sent, [undefined]);
      // One probe per folder pair, not one per turn or per agent open.
      assert.deepEqual(linear.probedTokens, ["Bearer project-linear-token"]);
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect(
    "a project-folder thread's agent options carry the installed plugin servers with T3's server",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeCursorPluginFixture([
          { folder: "project", accessToken: "project-linear-token" },
        ]);
        const linear = linearOAuthServer("project-linear-token");
        const project = yield* runCursorTurns({
          cwd: fixture.project,
          projectRoot: fixture.project,
          env: fixture.env,
          fetch: linear.fetchFn,
        });
        assert.deepEqual(project.opened, [
          {
            "plugin-linear-linear": linearServer("project-linear-token"),
            "t3-code": T3_MCP_SERVER,
          },
        ]);
        assert.deepEqual(project.sent, [undefined]);
      }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect("prefers a login made in the worktree itself", () =>
    Effect.gen(function* () {
      const fixture = yield* makeCursorPluginFixture([
        { folder: "project", accessToken: "project-linear-token" },
        { folder: "worktree", accessToken: "worktree-linear-token" },
      ]);
      const linear = linearOAuthServer("worktree-linear-token");
      const worktree = yield* runCursorTurns({
        cwd: fixture.worktree,
        projectRoot: fixture.project,
        env: fixture.env,
        fetch: linear.fetchFn,
      });
      assert.deepEqual(worktree.opened, [
        { "plugin-linear-linear": linearServer("worktree-linear-token"), "t3-code": T3_MCP_SERVER },
      ]);
      assert.deepEqual(worktree.sent, [undefined]);
      assert.deepEqual(linear.probedTokens, ["Bearer worktree-linear-token"]);
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect(
    "forwards each installed plugin server once under Cursor's identifier, with its own launch config",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeCursorPluginFixture(
          [{ folder: "project", accessToken: "project-linear-token" }],
          [
            {
              // A second copy of Linear: same identifier, so only the first root counts.
              folder: "linear-copy",
              name: "linear",
              mcpServers: { linear: { url: "https://linear-copy.example/mcp" } },
            },
            {
              folder: "tools",
              name: "tools",
              mcpServers: {
                local: { command: "./bin/server", args: ["--root", "${CURSOR_PLUGIN_ROOT}"] },
                keyed: {
                  url: "https://tools.example/mcp",
                  headers: { Authorization: "Bearer ${TOOLS_API_KEY}" },
                },
                cleartext: { url: "http://tools.example/mcp" },
              },
            },
          ],
        );
        const linear = linearOAuthServer("project-linear-token");
        const project = yield* runCursorTurns({
          cwd: fixture.project,
          projectRoot: fixture.project,
          env: { ...fixture.env, TOOLS_API_KEY: "tools-key" },
          fetch: linear.fetchFn,
        });
        const path = yield* Path.Path;
        const toolsRoot = path.join(fixture.env.HOME, "plugins", "tools");
        assert.deepEqual(project.sent, [undefined]);
        assert.deepEqual(project.opened, [
          {
            "plugin-linear-linear": linearServer("project-linear-token"),
            "plugin-tools-local": {
              command: path.join(toolsRoot, "bin", "server"),
              args: ["--root", toolsRoot],
              env: {},
            },
            "plugin-tools-keyed": {
              type: "http",
              url: "https://tools.example/mcp",
              headers: { Authorization: "Bearer tools-key" },
            },
            "plugin-tools-cleartext": {
              type: "http",
              url: "http://tools.example/mcp",
              headers: {},
            },
            "t3-code": T3_MCP_SERVER,
          },
        ]);
      }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect("refreshes a rejected project token and writes it back to the project's store", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const fixture = yield* makeCursorPluginFixture([
        { folder: "project", accessToken: "expired-linear-token" },
      ]);
      const linear = linearOAuthServer("fresh-linear-token");
      const worktree = yield* runCursorTurns({
        cwd: fixture.worktree,
        projectRoot: fixture.project,
        env: fixture.env,
        fetch: linear.fetchFn,
      });
      assert.deepEqual(worktree.opened, [
        { "plugin-linear-linear": linearServer("fresh-linear-token"), "t3-code": T3_MCP_SERVER },
      ]);
      assert.deepEqual(worktree.sent, [undefined]);
      assert.equal(linear.tokenRequests[0]?.get("refresh_token"), "project-refresh-token");
      const stored = yield* decodeStoredLinearLogin(
        yield* fileSystem.readFileString(fixture.projectAuthFile),
      );
      assert.deepEqual(stored["plugin-linear-linear"].tokens, {
        access_token: "fresh-linear-token",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "rotated-refresh-token",
      });
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect("falls back to the newest login another folder holds", () =>
    Effect.gen(function* () {
      const fixture = yield* makeCursorPluginFixture([
        {
          folder: "aaa-older",
          accessToken: "older-linear-token",
          modifiedAtSeconds: 1_767_225_600,
        },
        {
          folder: "zzz-newer",
          accessToken: "newer-linear-token",
          modifiedAtSeconds: 1_780_272_000,
        },
      ]);
      const linear = linearOAuthServer("newer-linear-token");
      const worktree = yield* runCursorTurns({
        cwd: fixture.worktree,
        projectRoot: fixture.project,
        env: fixture.env,
        fetch: linear.fetchFn,
      });
      const forwarded = {
        "plugin-linear-linear": linearServer("newer-linear-token"),
        "t3-code": T3_MCP_SERVER,
      };
      assert.deepEqual(worktree.opened, [forwarded]);
      assert.deepEqual(worktree.sent, [undefined]);
      assert.deepEqual(linear.probedTokens, ["Bearer newer-linear-token"]);
      assert.deepEqual(linear.tokenRequests, []);
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect("tries at most three stored logins, the thread's and project's first", () =>
    Effect.gen(function* () {
      const fixture = yield* makeCursorPluginFixture([
        { folder: "project", accessToken: "project-linear-token" },
        {
          folder: "first-other",
          accessToken: "first-other-token",
          modifiedAtSeconds: 1_780_272_000,
        },
        {
          folder: "second-other",
          accessToken: "second-other-token",
          modifiedAtSeconds: 1_777_593_600,
        },
        {
          folder: "third-other",
          accessToken: "third-other-token",
          modifiedAtSeconds: 1_775_001_600,
        },
      ]);
      const linear = linearOAuthServer("third-other-token");
      // Every stored login is rejected and none refreshes.
      const fetchFn: typeof globalThis.fetch = (input, init) =>
        String(input) === "https://mcp.linear.app/token"
          ? Promise.resolve(new Response(null, { status: 400 }))
          : linear.fetchFn(input, init);
      const worktree = yield* runCursorTurns({
        cwd: fixture.worktree,
        projectRoot: fixture.project,
        env: fixture.env,
        fetch: fetchFn,
      });
      assert.deepEqual(linear.probedTokens, [
        "Bearer project-linear-token",
        "Bearer first-other-token",
        "Bearer second-other-token",
      ]);
      // With no usable login the best one is forwarded unchanged.
      assert.deepEqual(worktree.opened, [
        { "plugin-linear-linear": linearServer("project-linear-token"), "t3-code": T3_MCP_SERVER },
      ]);
      assert.deepEqual(worktree.sent, [undefined]);
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect("keeps one agent across turns while T3's MCP credential is unchanged", () =>
    Effect.gen(function* () {
      const fixture = yield* makeCursorPluginFixture([
        { folder: "project", accessToken: "project-linear-token" },
      ]);
      const linear = linearOAuthServer("project-linear-token");
      const turns = yield* runCursorTurns({
        cwd: fixture.worktree,
        projectRoot: fixture.project,
        env: fixture.env,
        fetch: linear.fetchFn,
        t3AuthorizationHeaders: ["Bearer t3-mcp-token", "Bearer t3-mcp-token"],
      });
      assert.deepEqual(turns.opens, [{ operation: "create", agentId: undefined }]);
      assert.deepEqual(turns.opened, [
        { "plugin-linear-linear": linearServer("project-linear-token"), "t3-code": T3_MCP_SERVER },
      ]);
      assert.deepEqual(turns.closed, []);
      assert.deepEqual(turns.sent, [undefined, undefined]);
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );

  it.effect("reopens the agent with T3's new MCP credential when it changes between turns", () =>
    Effect.gen(function* () {
      const fixture = yield* makeCursorPluginFixture([
        { folder: "project", accessToken: "project-linear-token" },
      ]);
      const linear = linearOAuthServer("project-linear-token");
      const turns = yield* runCursorTurns({
        cwd: fixture.worktree,
        projectRoot: fixture.project,
        env: fixture.env,
        fetch: linear.fetchFn,
        t3AuthorizationHeaders: ["Bearer t3-mcp-token", "Bearer rotated-t3-mcp-token"],
      });
      assert.deepEqual(turns.opens, [
        { operation: "create", agentId: undefined },
        { operation: "resume", agentId: "native-cursor-plugin-oauth" },
      ]);
      assert.deepEqual(turns.opened, [
        { "plugin-linear-linear": linearServer("project-linear-token"), "t3-code": T3_MCP_SERVER },
        {
          "plugin-linear-linear": linearServer("project-linear-token"),
          "t3-code": {
            type: "http",
            url: "http://127.0.0.1:43123/mcp",
            headers: { Authorization: "Bearer rotated-t3-mcp-token" },
          },
        },
      ]);
      assert.deepEqual(turns.closed, [0]);
      assert.deepEqual(turns.sent, [undefined, undefined]);
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, IdAllocator.layer))),
  );
});
