import { CommandId, ProjectId } from "@kata-sh/code-contracts";
import { describe, expect, it } from "vite-plus/test";

import { canonicalTaskCommandDigest } from "./taskWorkspaceDigest";

const baseCreate = {
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
} as const;

describe("canonicalTaskCommandDigest", () => {
  it("ignores transport identity and audit metadata", () => {
    const first = canonicalTaskCommandDigest({
      ...baseCreate,
      commandId: CommandId.make("command-1"),
      createdAt: "2026-08-01T17:00:00.000Z",
    });
    const replayed = canonicalTaskCommandDigest({
      ...baseCreate,
      commandId: CommandId.make("command-999"),
      createdAt: "2026-08-01T18:30:00.000Z",
    });
    expect(replayed).toBe(first);
  });

  it("distinguishes semantically different payloads", () => {
    const original = canonicalTaskCommandDigest(baseCreate);
    const differentBrief = canonicalTaskCommandDigest({
      ...baseCreate,
      brief: "A different brief.",
      source: { kind: "inline", body: "A different brief." },
    });
    const differentPolicy = canonicalTaskCommandDigest({
      ...baseCreate,
      worktreePolicy: "now",
    });
    expect(differentBrief).not.toBe(original);
    expect(differentPolicy).not.toBe(original);
  });

  it("is stable across object key order", () => {
    const scrambled = {
      approvalPolicy: "before-build",
      preset: "guided",
      baseRef: "main",
      projectId: ProjectId.make("project-1"),
      title: "Implement onboarding",
      taskId: "my-task",
      brief: "Add a guided onboarding flow.",
      worktreePolicy: "later",
      operationKey: "op-create-1",
      source: { body: "Add a guided onboarding flow.", kind: "inline" },
      modelSelection: {
        options: [{ value: "high", id: "reasoningEffort" }],
        model: "claude-sonnet-4",
        instanceId: "instance-1",
      },
      type: "task.create",
    } as const;
    expect(canonicalTaskCommandDigest(scrambled)).toBe(canonicalTaskCommandDigest(baseCreate));
  });
});
