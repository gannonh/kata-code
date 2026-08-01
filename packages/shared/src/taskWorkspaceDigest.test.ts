import { CommandId, ProjectId, TaskWorkspaceCommand } from "@kata-sh/code-contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { canonicalTaskCommandDigest } from "./taskWorkspaceDigest.ts";

const decodeCommand = Schema.decodeUnknownSync(TaskWorkspaceCommand);

function createCommand(overrides: Record<string, unknown> = {}) {
  return decodeCommand({
    type: "task.create",
    commandId: CommandId.make("command-1"),
    taskId: "my-task",
    createdAt: "2026-08-01T17:00:00.000Z",
    title: "Implement onboarding",
    projectId: ProjectId.make("project-1"),
    baseRef: "main",
    preset: "guided",
    approvalPolicy: "before-build",
    operationKey: "op-create-1",
    brief: "Add a guided onboarding flow.",
    source: { kind: "inline", body: "Add a guided onboarding flow." },
    worktreePolicy: "later",
    modelSelection: {
      instanceId: "instance-1",
      model: "claude-sonnet-4",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
    ...overrides,
  });
}

describe("canonicalTaskCommandDigest", () => {
  it("ignores transport identity and audit metadata", () => {
    const first = canonicalTaskCommandDigest(
      createCommand({ commandId: CommandId.make("command-1") }),
    );
    const replayed = canonicalTaskCommandDigest(
      createCommand({
        commandId: CommandId.make("command-999"),
        createdAt: "2026-08-01T18:30:00.000Z",
      }),
    );
    expect(replayed).toBe(first);
  });

  it("distinguishes semantically different payloads", () => {
    const original = canonicalTaskCommandDigest(createCommand());
    const differentBrief = canonicalTaskCommandDigest(
      createCommand({
        brief: "A different brief.",
        source: { kind: "inline", body: "A different brief." },
      }),
    );
    const differentPolicy = canonicalTaskCommandDigest(createCommand({ worktreePolicy: "now" }));
    expect(differentBrief).not.toBe(original);
    expect(differentPolicy).not.toBe(original);
  });
});
