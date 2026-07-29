import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { CommandId, ProjectId } from "./baseSchemas.ts";
import {
  TaskWorkspaceCommand,
  TaskWorkspaceEvent,
  TaskWorkspaceStreamItem,
} from "./taskWorkspace.ts";

const decodeCommand = Schema.decodeUnknownEffect(TaskWorkspaceCommand);
const decodeStreamItem = Schema.decodeUnknownEffect(TaskWorkspaceStreamItem);
const decodeEvent = Schema.decodeUnknownEffect(TaskWorkspaceEvent);

it.effect("decodes the Standard task creation contract", () =>
  Effect.gen(function* () {
    const command = yield* decodeCommand({
      type: "task.create",
      commandId: "command-1",
      taskId: "task-1",
      createdAt: "2026-07-28T17:00:00.000Z",
      title: "Slice 1",
      projectId: "project-1",
      workspaceRoot: "/repo",
      baseRef: "main",
      preset: "standard",
      approvalPolicy: "before-build",
    });

    assert.strictEqual(command.type, "task.create");
    if (command.type !== "task.create") {
      return assert.fail("Expected task.create command");
    }
    assert.strictEqual(command.commandId, CommandId.make("command-1"));
    assert.strictEqual(command.projectId, ProjectId.make("project-1"));
    assert.strictEqual(command.preset, "standard");
  }),
);

it.effect("rejects mutable workflow prose as a task command", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeCommand({
        type: "task.advance.from-markdown",
        commandId: "command-2",
        taskId: "task-1",
        createdAt: "2026-07-28T17:00:00.000Z",
        markdownCommand: "advance to build",
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes a task snapshot stream item", () =>
  Effect.gen(function* () {
    const item = yield* decodeStreamItem({
      kind: "snapshot",
      snapshot: {
        sequence: 0,
        tasks: [],
      },
    });

    assert.strictEqual(item.kind, "snapshot");
  }),
);

it.effect("rejects unknown task workspace event types", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeEvent({
        sequence: 1,
        eventId: "event-1",
        commandId: "command-1",
        taskId: "task-1",
        type: "task.unknown.command",
        occurredAt: "2026-07-28T17:00:00.000Z",
        task: {
          id: "task-1",
          title: "Slice 1",
          versions: {
            taskContract: "task-workspace@0.1.0",
            artifactContract: "task-artifact@0.1.0",
            workflowDefinition: "standard@0.1.0",
            prompt: "task-workspace-slice-1@0.1.0",
          },
          workspace: { repositories: [] },
          workflowRuns: [],
          sessions: [],
          artifacts: [],
          comments: [],
          build: { phases: [], resultingCommitSha: null },
          verification: { criteria: [], results: [], signedOffAt: null },
          sourceLinks: [],
          delivery: { state: "unavailable" },
          createdAt: "2026-07-28T17:00:00.000Z",
          updatedAt: "2026-07-28T17:00:00.000Z",
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);
