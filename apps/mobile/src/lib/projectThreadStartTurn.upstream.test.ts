import { ProjectId, ProviderInstanceId } from "@kata-sh/code-contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildProjectThreadStartTurnInput } from "./projectThreadStartTurn";

// Upstream coverage for projectThreadStartTurn.ts. The Kata suite in
// projectThreadStartTurn.test.ts is a preservation-gate trusted file.
describe("project thread title (upstream)", () => {
  it("derives attachment-only titles from prepared image metadata", () => {
    const uploadedAttachments = [
      {
        type: "image" as const,
        id: "prepared-photo",
        name: "photo.png",
        mimeType: "image/png",
        sizeBytes: 3,
      },
    ];
    const input = buildProjectThreadStartTurnInput({
      projectId: ProjectId.make("project"),
      projectCwd: "/workspace",
      threadId: "image-thread",
      commandId: "image-command",
      messageId: "image-message",
      createdAt: "2026-09-04T00:00:00Z",
      text: "",
      uploadedAttachments,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceMode: "local",
      branch: null,
      worktreePath: null,
      startFromOrigin: false,
      worktreeBranchName: "unused",
    });

    expect(input.titleSeed).toBe("Image: photo.png");
    expect(input.bootstrap.createThread.title).toBe(input.titleSeed);
    expect(input.message.attachments).toEqual(uploadedAttachments);
    expect(input.creationSource).toBe("mobile");
  });
});
