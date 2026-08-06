import { ThreadId } from "@kata-sh/code-contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveTaskShellView, taskShellRevisionImpact, taskShellStages } from "./taskShellModel";
import {
  atStage,
  makeArtifact,
  makeOccurrence,
  makeSession,
  makeTaskWorkspace,
} from "./taskWorkspaceFixtures";

describe("taskShellStages", () => {
  it("marks the workflow stage the task is in as active and earlier stages as completed", () => {
    const task = atStage(
      makeTaskWorkspace({
        occurrences: [
          makeOccurrence({ stage: "questions" }),
          makeOccurrence({ stage: "research" }),
          makeOccurrence({ stage: "design", status: "running" }),
        ],
      }),
      "design",
    );

    const stages = taskShellStages(task);

    expect(stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["questions", "completed"],
      ["research", "completed"],
      ["design", "active"],
      ["plan", "upcoming"],
      ["build", "upcoming"],
      ["verify", "upcoming"],
      ["verified", "upcoming"],
    ]);
    expect(stages.find((stage) => stage.stage === "design")?.label).toBe("Design");
    expect(stages.find((stage) => stage.stage === "build")?.label).toBe("Implement");
  });

  it("exposes every occurrence of a repeated stage and marks the newest as current", () => {
    const task = atStage(
      makeTaskWorkspace({
        occurrences: [
          makeOccurrence({ stage: "plan", ordinal: 0, status: "completed" }),
          makeOccurrence({ stage: "plan", ordinal: 1, status: "running" }),
        ],
      }),
      "plan",
    );

    const plan = taskShellStages(task).find((stage) => stage.stage === "plan");

    expect(plan?.occurrences.map((occurrence) => [occurrence.label, occurrence.isCurrent])).toEqual(
      [
        ["Plan v1", false],
        ["Plan v2", true],
      ],
    );
    expect(plan?.isSelectable).toBe(true);
  });

  it("does not offer a stage the task has never entered", () => {
    const task = atStage(
      makeTaskWorkspace({ occurrences: [makeOccurrence({ stage: "questions" })] }),
      "research",
    );

    const stages = taskShellStages(task);

    expect(stages.find((stage) => stage.stage === "questions")?.isSelectable).toBe(true);
    expect(stages.find((stage) => stage.stage === "research")?.isSelectable).toBe(true);
    expect(stages.find((stage) => stage.stage === "verify")?.isSelectable).toBe(false);
  });
});

const guidedTask = atStage(
  makeTaskWorkspace({
    occurrences: [
      makeOccurrence({ stage: "questions", artifactRevisionId: "questions-r1" }),
      makeOccurrence({ stage: "research", artifactRevisionId: "research-r1" }),
      makeOccurrence({ stage: "design", status: "running" }),
    ],
    artifacts: [
      makeArtifact({
        kind: "research",
        revisions: [
          {
            id: "research-r1",
            revision: 1,
            title: "Research findings",
            markdown: "# Research\n\nThe shell already renders a conversation.",
          },
        ],
      }),
    ],
  }),
  "design",
);

describe("resolveTaskShellView", () => {
  it("shows the active stage conversation when nothing has been selected", () => {
    const view = resolveTaskShellView(guidedTask, null);

    expect(view.selectedStage.stage).toBe("design");
    expect(view.selectedOccurrence?.label).toBe("Design v1");
    expect(view.isViewingCurrent).toBe(true);
    expect(view.isReadOnly).toBe(false);
    expect(view.defaultView).toBe("conversation");
  });

  it("treats a completed stage as read-only history and opens on its outcome", () => {
    const view = resolveTaskShellView(guidedTask, { stage: "research", occurrenceId: null });

    expect(view.selectedStage.stage).toBe("research");
    expect(view.isViewingCurrent).toBe(false);
    expect(view.isReadOnly).toBe(true);
    expect(view.defaultView).toBe("outcome");
    expect(view.outcome?.title).toBe("Research findings");
    expect(view.activeStage.stage).toBe("design");
  });

  it("treats a superseded occurrence of the active stage as history", () => {
    const task = atStage(
      makeTaskWorkspace({
        occurrences: [
          makeOccurrence({ stage: "plan", ordinal: 0, status: "completed" }),
          makeOccurrence({ stage: "plan", ordinal: 1, status: "running" }),
        ],
      }),
      "plan",
    );

    const view = resolveTaskShellView(task, { stage: "plan", occurrenceId: "plan-0" });

    expect(view.selectedOccurrence?.label).toBe("Plan v1");
    expect(view.isViewingCurrent).toBe(false);
    expect(view.isReadOnly).toBe(true);
  });

  it("falls back to the live path when the selection no longer exists", () => {
    const view = resolveTaskShellView(guidedTask, { stage: "verify", occurrenceId: "verify-9" });

    expect(view.selectedStage.stage).toBe("design");
    expect(view.isViewingCurrent).toBe(true);
  });

  it("reads the live stage conversation from the active session, not the occurrence record", () => {
    const task = atStage(
      makeTaskWorkspace({
        occurrences: [
          makeOccurrence({
            stage: "build",
            status: "running",
            sessionId: "session-start",
            threadId: ThreadId.make("thread-build-start"),
          }),
        ],
        sessions: [
          makeSession({
            id: "session-start",
            stage: "build",
            threadId: ThreadId.make("thread-build-start"),
            status: "superseded",
          }),
          makeSession({
            id: "session-continuation",
            stage: "build",
            threadId: ThreadId.make("thread-build-continuation"),
            status: "active",
          }),
        ],
        build: {
          ...makeTaskWorkspace().build,
          continuationSessionIds: ["session-continuation"],
        },
      }),
      "build",
    );

    expect(resolveTaskShellView(task, null).conversationThreadId).toBe("thread-build-continuation");
  });

  it("reads a historical conversation from the occurrence that recorded it", () => {
    const view = resolveTaskShellView(guidedTask, { stage: "research", occurrenceId: null });

    expect(view.conversationThreadId).toBe("thread-research-0");
  });
});

describe("taskShellRevisionImpact", () => {
  it("names the next occurrence and the downstream outcomes revision would preserve", () => {
    const task = atStage(
      makeTaskWorkspace({
        occurrences: [
          makeOccurrence({ stage: "questions" }),
          makeOccurrence({ stage: "plan", ordinal: 0, status: "awaiting-approval" }),
          makeOccurrence({ stage: "build", status: "running" }),
        ],
      }),
      "plan",
    );

    const impact = taskShellRevisionImpact(task, "plan");

    expect(impact.nextOccurrenceLabel).toBe("Plan v2");
    expect(impact.preservedStageLabels).toEqual(["Implement"]);
  });

  it("says so plainly when no downstream stage has produced anything yet", () => {
    const impact = taskShellRevisionImpact(guidedTask, "design");

    expect(impact.nextOccurrenceLabel).toBe("Design v2");
    expect(impact.preservedStageLabels).toEqual([]);
  });
});
