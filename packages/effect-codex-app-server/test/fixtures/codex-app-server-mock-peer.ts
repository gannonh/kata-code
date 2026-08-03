#!/usr/bin/env node

import * as NodeOS from "node:os";

let nextServerRequestId = 10_000;
let pendingSkillsListRequestId: number | string | null = null;
let pendingUserInputRequestId: number | null = null;
let pendingTurnStartRequestId: number | string | null = null;
const pendingApprovalRequestIds = new Set<number>();
const approvalResponses: Record<string, unknown> = {};

const writeMessage = (message: unknown) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const respond = (id: number | string, result: unknown) => {
  writeMessage({ id, result });
};

const respondError = (id: number | string, code: number, message: string) => {
  writeMessage({
    id,
    error: {
      code,
      message,
    },
  });
};

const sendRequest = (method: string, params: unknown) => {
  const id = nextServerRequestId++;
  writeMessage({ id, method, params });
  return id;
};

const approvalScenarioEnabled = process.env.CODEX_APP_SERVER_TEST_APPROVALS === "1";

const threadResponse = (threadId: string) => ({
  cwd: process.cwd(),
  model: "gpt-5.3-codex",
  modelProvider: "openai",
  approvalPolicy: "untrusted",
  approvalsReviewer: "user",
  sandbox: { type: "readOnly" },
  thread: {
    cliVersion: "0.0.0",
    createdAt: 1_776_000_000,
    cwd: process.cwd(),
    ephemeral: false,
    id: threadId,
    modelProvider: "openai",
    preview: "",
    sessionId: "session-1",
    source: "cli",
    status: { type: "idle" },
    turns: [],
    updatedAt: 1_776_000_000,
  },
});

const finishApprovalScenario = () => {
  if (pendingTurnStartRequestId === null || pendingApprovalRequestIds.size > 0) {
    return;
  }

  writeMessage({
    method: "item/agentMessage/delta",
    params: {
      delta: `approval-responses:${JSON.stringify(approvalResponses)}`,
      itemId: "item-approval-result",
      threadId: "thread-1",
      turnId: "turn-approval-1",
    },
  });
  respond(pendingTurnStartRequestId, {
    turn: {
      id: "turn-approval-1",
      items: [],
      status: "inProgress",
    },
  });
  pendingTurnStartRequestId = null;
};

const requestApprovalScenario = (requestId: number | string) => {
  pendingTurnStartRequestId = requestId;
  const permissionRequestId = sendRequest("item/permissions/requestApproval", {
    cwd: process.cwd(),
    itemId: "item-permission-1",
    permissions: {
      fileSystem: { write: [process.cwd()] },
      network: { enabled: true },
    },
    reason: "The task-stage MCP server needs network access.",
    startedAtMs: 1_776_000_000_000,
    threadId: "thread-1",
    turnId: "turn-approval-1",
  });
  const elicitationRequestId = sendRequest("mcpServer/elicitation/request", {
    _meta: { codex_approval_kind: "mcp_tool_call" },
    elicitationId: "elicitation-1",
    message: "Run the Kata task-stage tool.",
    mode: "url",
    serverName: "kata",
    threadId: "thread-1",
    turnId: "turn-approval-1",
    url: "https://example.test/task-stage",
  });
  pendingApprovalRequestIds.add(permissionRequestId);
  pendingApprovalRequestIds.add(elicitationRequestId);
};

const handleMethod = (message: Record<string, unknown>) => {
  const method = message.method;
  if (typeof method !== "string") {
    return;
  }

  switch (method) {
    case "initialize": {
      // oxlint-disable-next-line kata-code/no-global-process-runtime -- Standalone mock peer process has no Effect runtime.
      const platform = NodeOS.platform();
      const stderrBytes = Number(process.env.CODEX_APP_SERVER_TEST_STDERR_BYTES ?? 0);
      if (Number.isFinite(stderrBytes) && stderrBytes > 0) {
        process.stderr.write("x".repeat(stderrBytes), () => {
          respond(message.id as number | string, {
            userAgent: "mock-codex-app-server",
            codexHome: process.cwd(),
            platformFamily: platform === "win32" ? "windows" : "unix",
            platformOs: platform === "darwin" ? "macos" : platform,
          });
        });
        return;
      }
      respond(message.id as number | string, {
        userAgent: "mock-codex-app-server",
        codexHome: process.cwd(),
        platformFamily: platform === "win32" ? "windows" : "unix",
        platformOs: platform === "darwin" ? "macos" : platform,
      });
      return;
    }
    case "thread/start": {
      respond(message.id as number | string, threadResponse("thread-1"));
      return;
    }
    case "thread/resume": {
      respond(message.id as number | string, threadResponse("thread-1"));
      return;
    }
    case "config/mcpServer/reload": {
      respond(message.id as number | string, {});
      return;
    }
    case "turn/start": {
      if (approvalScenarioEnabled) {
        requestApprovalScenario(message.id as number | string);
        return;
      }
      respond(message.id as number | string, {
        turn: {
          id: "turn-1",
          items: [],
          status: "inProgress",
        },
      });
      return;
    }
    case "initialized": {
      writeMessage({
        method: "item/agentMessage/delta",
        params: {
          delta: "Mock server is ready.",
          itemId: "item-1",
          threadId: "thread-1",
          turnId: "turn-1",
        },
      });
      return;
    }
    case "account/read": {
      respond(message.id as number | string, {
        account: {
          type: "chatgpt",
          email: "mock@example.com",
          planType: "plus",
        },
        requiresOpenaiAuth: false,
      });
      return;
    }
    case "skills/list": {
      pendingSkillsListRequestId = message.id as number | string;
      pendingUserInputRequestId = sendRequest("item/tool/requestUserInput", {
        itemId: "item-approval-1",
        threadId: "thread-1",
        turnId: "turn-1",
        questions: [
          {
            id: "approved",
            header: "Approve",
            question: "Continue with the mock skills request?",
            options: [
              {
                label: "yes",
                description: "Approve the request",
              },
            ],
          },
        ],
      });
      return;
    }
    default: {
      if (message.id !== undefined) {
        respondError(message.id as number | string, -32601, `Unhandled request: ${method}`);
      }
    }
  }
};

const handleResponse = (message: Record<string, unknown>) => {
  const responseId = message.id as number | string;
  if (typeof responseId === "number" && pendingApprovalRequestIds.has(responseId)) {
    pendingApprovalRequestIds.delete(responseId);
    approvalResponses[String(responseId)] = message.result ?? message.error;
    finishApprovalScenario();
    return;
  }

  if (message.id !== pendingUserInputRequestId) {
    return;
  }

  pendingUserInputRequestId = null;

  respond(pendingSkillsListRequestId!, {
    data: [
      {
        cwd: process.cwd(),
        errors: [],
        skills: [],
      },
    ],
  });
  pendingSkillsListRequestId = null;
};

let remainder = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  remainder += chunk;
  const lines = remainder.split("\n");
  remainder = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const message = JSON.parse(trimmed) as Record<string, unknown>;
    if ("method" in message) {
      handleMethod(message);
      continue;
    }
    if ("id" in message) {
      handleResponse(message);
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
