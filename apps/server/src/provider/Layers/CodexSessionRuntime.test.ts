import assert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe, it } from "vite-plus/test";
import { ThreadId } from "@kata-sh/code-contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";

import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
import {
  buildMcpServerElicitationResponse,
  buildPermissionsRequestApprovalResponse,
  buildTurnStartParams,
  makeCodexSessionRuntime,
  hasConfiguredMcpServer,
  isRecoverableThreadResumeError,
  openCodexThread,
} from "./CodexSessionRuntime.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);
const decodeApprovalResponses = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

function makeThreadOpenResponse(
  threadId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "danger-full-access" },
    thread: {
      id: threadId,
      createdAt: "2026-04-18T00:00:00.000Z",
      source: { session: "cli" },
      turns: [],
      status: {
        state: "idle",
        activeFlags: [],
      },
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("buildTurnStartParams", () => {
  it("includes server-owned instructions in the native plan channel", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        developerInstructions: "Use task_stage_context before task data.",
        interactionMode: "plan",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: `${CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS}\n\nUse task_stage_context before task data.`,
        },
      },
    });
  });

  it("keeps task-stage completion out of Codex native Plan Mode", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-task-stage",
        runtimeMode: "approval-required",
        prompt: "Research the task",
        model: "gpt-5.3-codex",
        developerInstructions: "Call task_stage_complete when the Research artifact is ready.",
        interactionMode: "default",
      }),
    );

    assert.equal(params.collaborationMode?.mode, "default");
    assert.equal(
      params.collaborationMode?.settings.developer_instructions,
      `${CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS}\n\nCall task_stage_complete when the Research artifact is ready.`,
    );
  });

  it("allows task-stage MCP calls while retaining read-only execution", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-task-stage",
        runtimeMode: "approval-required",
        prompt: "Research the task",
        taskStage: true,
      }),
    );

    assert.deepStrictEqual(params.sandboxPolicy, {
      networkAccess: true,
      type: "readOnly",
    });
  });

  effectIt.effect(
    "keeps task implementation temp directories writable and scopes writable roots to the worktree",
    () =>
      Effect.gen(function* () {
        const params = yield* buildTurnStartParams({
          threadId: "provider-thread-task-implementation",
          runtimeMode: "auto-accept-edits",
          prompt: "Implement the approved Plan",
          taskExecutionProfile: "task-worktree-write",
          taskSandboxWritableRoots: [
            "/tmp/task/.git/objects",
            "/tmp/task/.git/refs/heads/katacode/task-1",
            "/tmp/task.agent-home",
          ],
        });

        // The shell sandbox must keep the per-user TMPDIR and /tmp writable:
        // with them excluded, git's xcrun cache, python, and the patch helper
        // all fail with "couldn't create cache file ... Operation not
        // permitted" and implementation cannot proceed. Extra write roots are
        // confined to the task's git metadata and agent home.
        assert.deepStrictEqual(params.sandboxPolicy, {
          type: "workspaceWrite",
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
          writableRoots: [
            "/tmp/task/.git/objects",
            "/tmp/task/.git/refs/heads/katacode/task-1",
            "/tmp/task.agent-home",
          ],
        });
      }),
  );

  effectIt.effect(
    "grants no extra writable roots for a task session without approved git metadata",
    () =>
      Effect.gen(function* () {
        const params = yield* buildTurnStartParams({
          threadId: "provider-thread-task-implementation-plain",
          runtimeMode: "auto-accept-edits",
          prompt: "Implement the approved Plan",
          taskExecutionProfile: "task-worktree-write",
        });

        assert.deepStrictEqual(params.sandboxPolicy, {
          type: "workspaceWrite",
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
          writableRoots: [],
        });
      }),
  );

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "image",
          url: "data:image/png;base64,abc",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
        },
      },
    });
  });

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "untrusted",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });
});

describe("Codex approval requests", () => {
  it("accepts only Kata MCP tool approvals during task stages", () => {
    assert.deepStrictEqual(
      buildMcpServerElicitationResponse({
        taskStage: true,
        serverName: "kata",
        meta: { codex_approval_kind: "mcp_tool_call" },
      }),
      { action: "accept" },
    );
    assert.deepStrictEqual(
      buildMcpServerElicitationResponse({
        taskStage: true,
        serverName: "other",
        meta: { codex_approval_kind: "mcp_tool_call" },
      }),
      { action: "decline", content: null },
    );
    assert.deepStrictEqual(
      buildMcpServerElicitationResponse({
        taskStage: true,
        serverName: "kata",
        meta: { codex_approval_kind: "user_input" },
      }),
      { action: "decline", content: null },
    );
  });

  it("grants task-stage network access without granting filesystem permissions", () => {
    assert.deepStrictEqual(
      buildPermissionsRequestApprovalResponse({
        taskStage: true,
        requested: {
          network: { enabled: true },
          fileSystem: { write: ["/tmp/task-stage"] },
        },
      }),
      {
        permissions: {
          network: { enabled: true },
        },
        scope: "turn",
      },
    );
  });

  it("denies permission requests outside task-stage network access", () => {
    assert.deepStrictEqual(
      buildPermissionsRequestApprovalResponse({
        taskStage: false,
        requested: {
          network: { enabled: true },
          fileSystem: { write: ["/tmp/project"] },
        },
      }),
      {
        permissions: {},
        scope: "turn",
      },
    );
    assert.deepStrictEqual(
      buildPermissionsRequestApprovalResponse({
        taskStage: true,
        requested: {
          fileSystem: { write: ["/tmp/project"] },
        },
      }),
      {
        permissions: {},
        scope: "turn",
      },
    );
  });
});

describe("Codex server request handlers", () => {
  const runApprovalProbe = (taskStage: boolean) =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const mockPeerPath = path.resolve(
          import.meta.dirname,
          "../../../../../packages/effect-codex-app-server/test/fixtures/codex-app-server-mock-peer.ts",
        );
        const runtime = yield* makeCodexSessionRuntime({
          threadId: ThreadId.make("provider-thread-approval-probe"),
          binaryPath: mockPeerPath,
          cwd: process.cwd(),
          runtimeMode: "approval-required",
          ...(taskStage ? { taskStage: true } : {}),
          environment: {
            PATH: process.env.PATH ?? "",
            CODEX_APP_SERVER_TEST_APPROVALS: "1",
          },
        });
        return yield* Effect.gen(function* () {
          const marker = "approval-responses:";
          const approvalEvents = Stream.map(
            Stream.filter(
              runtime.events,
              (event) =>
                event.kind === "notification" &&
                event.method === "item/agentMessage/delta" &&
                typeof event.textDelta === "string" &&
                event.textDelta.startsWith(marker),
            ),
            (event) => event.textDelta!.slice(marker.length),
          );
          const markerFiber = yield* Stream.runHead(approvalEvents).pipe(Effect.forkChild);
          yield* runtime.start();
          yield* runtime.sendTurn({
            input: "Exercise the MCP approval handlers.",
            ...(taskStage ? { taskStage: true } : {}),
          });
          const markerValue = Option.getOrThrow(yield* Fiber.join(markerFiber));
          return decodeApprovalResponses(markerValue);
        }).pipe(Effect.ensuring(runtime.close));
      }),
    );

  effectIt.layer(NodeServices.layer)("runtime dispatch", (it) => {
    it.effect("handles task-stage MCP approval and permission requests", () =>
      Effect.gen(function* () {
        const responses = yield* runApprovalProbe(true);
        const values = Object.values(responses);
        assert.equal(values.length, 2);
        const elicitation = values.find(
          (value) => typeof value === "object" && value !== null && "action" in value,
        );
        const permissions = values.find(
          (value) => typeof value === "object" && value !== null && "permissions" in value,
        );
        assert.deepStrictEqual(elicitation, { action: "accept" });
        assert.deepStrictEqual(permissions, {
          permissions: {
            network: { enabled: true },
          },
          scope: "turn",
        });
      }),
    );

    it.effect("keeps non-task-stage MCP requests on their safe response paths", () =>
      Effect.gen(function* () {
        const responses = yield* runApprovalProbe(false);
        const values = Object.values(responses);
        assert.equal(values.length, 2);
        const elicitation = values.find(
          (value) => typeof value === "object" && value !== null && "action" in value,
        );
        const permissions = values.find(
          (value) => typeof value === "object" && value !== null && "permissions" in value,
        );
        assert.deepStrictEqual(elicitation, {
          action: "decline",
          content: null,
        });
        assert.deepStrictEqual(permissions, {
          permissions: {},
          scope: "turn",
        });
      }),
    );
  });
});

describe("Kata browser developer instructions", () => {
  it("prefers the product-native preview tools in both collaboration modes", () => {
    for (const instructions of [
      CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
      CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
    ]) {
      assert.match(instructions, /kata/);
      assert.match(instructions, /preview_status/);
      assert.match(instructions, /preview_open/);
      assert.match(instructions, /Do not switch to global browser skills/);
    }
  });
});

describe("hasConfiguredMcpServer", () => {
  it("detects inline Codex MCP configuration arguments", () => {
    assert.equal(hasConfiguredMcpServer(undefined), false);
    assert.equal(hasConfiguredMcpServer(["--model", "gpt-5.4"]), false);
    assert.equal(
      hasConfiguredMcpServer(["-c", 'mcp_servers.kata.url="http://127.0.0.1/mcp"']),
      true,
    );
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("matches missing thread errors", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Thread does not exist",
        }),
      ),
      true,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention threads", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexThread", () => {
  effectIt.effect("falls back to thread/start when resume fails recoverably", () => {
    const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
    const started = makeThreadOpenResponse("fresh-thread");
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "thread not found",
            }),
          );
        }
        return Effect.succeed(started as CodexRpc.ClientRequestResponsesByMethod[M]);
      },
    };

    return Effect.gen(function* () {
      const opened = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        developerInstructions: "Use task_stage_context before task data.",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      });

      assert.equal(opened.thread.id, "fresh-thread");
      const startCall = calls.find((call) => call.method === "thread/start");
      assert.ok(startCall);
      assert.equal(
        (startCall.payload as { developerInstructions?: string }).developerInstructions,
        "Use task_stage_context before task data.",
      );
      assert.deepStrictEqual(
        calls.map((call) => call.method),
        ["thread/resume", "thread/start"],
      );
    });
  });

  it("propagates non-recoverable resume failures", async () => {
    const client = {
      request: <M extends "thread/start" | "thread/resume">(
        method: M,
        _payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "timed out waiting for server",
            }),
          );
        }
        return Effect.succeed(
          makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await assert.rejects(
      // oxlint-disable-next-line kata-code/no-manual-effect-runtime-in-tests -- this test asserts a rejected async boundary.
      Effect.runPromise(
        openCodexThread({
          client,
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "full-access",
          cwd: "/tmp/project",
          requestedModel: "gpt-5.3-codex",
          serviceTier: undefined,
          resumeThreadId: "stale-thread",
        }),
      ),
      (error: unknown) =>
        isCodexAppServerRequestError(error) &&
        error.errorMessage === "timed out waiting for server",
    );
  });
});
