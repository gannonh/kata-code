import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import * as CodexSchema from "./schema.ts";

it("accepts Codex 0.150 multi-agent values in thread/resume responses", () => {
  const activityKinds = ["started", "interacted", "interrupted", "completed"] as const;
  for (const schema of [
    CodexSchema.ServerNotification__SubAgentActivityKind,
    CodexSchema.V2ItemStartedNotification__SubAgentActivityKind,
    CodexSchema.V2ItemCompletedNotification__SubAgentActivityKind,
    CodexSchema.V2ThreadReadResponse__SubAgentActivityKind,
    CodexSchema.V2ThreadResumeResponse__SubAgentActivityKind,
  ]) {
    for (const kind of activityKinds) {
      assert.equal(Schema.is(schema)(kind), true);
    }
    assert.equal(Schema.is(schema)("future"), false);
  }

  for (const schema of [
    CodexSchema.ServerNotification__CollabAgentTool,
    CodexSchema.V2ItemStartedNotification__CollabAgentTool,
    CodexSchema.V2ItemCompletedNotification__CollabAgentTool,
    CodexSchema.V2ThreadResumeResponse__CollabAgentTool,
  ]) {
    assert.equal(Schema.is(schema)("followupTask"), true);
    assert.equal(Schema.is(schema)("futureTask"), false);
  }

  for (const schema of [
    CodexSchema.ServerNotification__CollabAgentToolCallStatus,
    CodexSchema.V2ItemStartedNotification__CollabAgentToolCallStatus,
    CodexSchema.V2ItemCompletedNotification__CollabAgentToolCallStatus,
    CodexSchema.V2ThreadResumeResponse__CollabAgentToolCallStatus,
  ]) {
    assert.equal(Schema.is(schema)("interrupted"), true);
    assert.equal(Schema.is(schema)("cancelled"), false);
  }

  const resumeResponse = {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    cwd: "/tmp/project",
    model: "gpt-5.6-sol",
    modelProvider: "openai",
    sandbox: { type: "dangerFullAccess" },
    thread: {
      cliVersion: "0.150.0",
      createdAt: 0,
      cwd: "/tmp/project",
      ephemeral: false,
      id: "root-thread",
      modelProvider: "openai",
      preview: "",
      sessionId: "session-1",
      source: "cli",
      status: { type: "idle" },
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            {
              agentPath: "/root/alpha",
              agentThreadId: "child-thread",
              id: "activity-1",
              kind: "completed",
              type: "subAgentActivity",
            },
            {
              agentsStates: {},
              id: "collab-1",
              receiverThreadIds: ["child-thread"],
              senderThreadId: "root-thread",
              status: "interrupted",
              tool: "followupTask",
              type: "collabAgentToolCall",
            },
          ],
        },
      ],
      updatedAt: 0,
    },
  };

  assert.equal(Schema.is(CodexSchema.V2ThreadResumeResponse)(resumeResponse), true);
});
