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

it.effect("decodes a Slice 2 select-revision command", () =>
  Effect.gen(function* () {
    const command = yield* decodeCommand({
      type: "task.artifact.select-revision",
      commandId: "command-select",
      taskId: "task-1",
      createdAt: "2026-07-29T17:00:00.000Z",
      kind: "plan",
      revision: 1,
    });

    assert.strictEqual(command.type, "task.artifact.select-revision");
    if (command.type !== "task.artifact.select-revision") {
      return assert.fail("Expected task.artifact.select-revision command");
    }
    assert.strictEqual(command.kind, "plan");
    assert.strictEqual(command.revision, 1);
  }),
);

it.effect("decodes a Slice 2 comment.create command with a typed author", () =>
  Effect.gen(function* () {
    const command = yield* decodeCommand({
      type: "task.comment.create",
      commandId: "command-comment",
      taskId: "task-1",
      createdAt: "2026-07-29T17:00:00.000Z",
      artifactId: "artifact-plan",
      anchorBlockId: "block-1",
      baseRevisionId: "revision-1",
      author: { kind: "user", id: "user-1", displayName: "Ada" },
      body: "Please clarify this block.",
    });

    assert.strictEqual(command.type, "task.comment.create");
    if (command.type !== "task.comment.create") {
      return assert.fail("Expected task.comment.create command");
    }
    assert.strictEqual(command.anchorBlockId, "block-1");
    assert.strictEqual(command.author.kind, "user");
    assert.strictEqual(command.author.displayName, "Ada");
    assert.strictEqual(command.body, "Please clarify this block.");
  }),
);

it.effect("applies Slice 1 replay defaults when decoding a session without role fields", () =>
  Effect.gen(function* () {
    const event = yield* decodeEvent({
      sequence: 1,
      eventId: "event-1",
      commandId: "command-1",
      taskId: "task-1",
      type: "task.session.link",
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
        sessions: [
          {
            id: "session-1",
            stage: "plan",
            threadId: "thread-1",
            createdAt: "2026-07-28T17:00:00.000Z",
          },
        ],
        artifacts: [],
        comments: [],
        build: { phases: [], resultingCommitSha: null },
        verification: { criteria: [], results: [], signedOffAt: null },
        sourceLinks: [],
        delivery: { state: "unavailable" },
        createdAt: "2026-07-28T17:00:00.000Z",
        updatedAt: "2026-07-28T17:00:00.000Z",
      },
    });

    const session = event.task.sessions[0];
    if (session === undefined) {
      return assert.fail("Expected a decoded session");
    }
    assert.strictEqual(session.role, "primary");
    assert.strictEqual(session.status, "active");
    assert.strictEqual(session.provider, null);
    assert.strictEqual(session.parentSessionId, null);
    assert.strictEqual(session.forkPoint, null);
    assert.strictEqual(session.contextManifestId, null);
    assert.strictEqual(session.stage, "plan");
    assert.deepStrictEqual([...event.task.contextManifests], []);
  }),
);

it.effect("applies Slice 1 replay defaults when decoding an artifact revision", () =>
  Effect.gen(function* () {
    const event = yield* decodeEvent({
      sequence: 2,
      eventId: "event-2",
      commandId: "command-2",
      taskId: "task-1",
      type: "task.artifact.upsert",
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
        artifacts: [
          {
            id: "artifact-plan",
            kind: "plan",
            currentRevision: 0,
            revisions: [
              {
                id: "revision-0",
                kind: "plan",
                title: "Plan",
                markdown: "# Plan",
                revision: 0,
                sourceSessionId: null,
                createdAt: "2026-07-28T17:00:00.000Z",
              },
            ],
          },
        ],
        comments: [],
        build: { phases: [], resultingCommitSha: null },
        verification: { criteria: [], results: [], signedOffAt: null },
        sourceLinks: [],
        delivery: { state: "unavailable" },
        createdAt: "2026-07-28T17:00:00.000Z",
        updatedAt: "2026-07-28T17:00:00.000Z",
      },
    });

    const revision = event.task.artifacts[0]?.revisions[0];
    if (revision === undefined) {
      return assert.fail("Expected a decoded artifact revision");
    }
    assert.strictEqual(revision.supersedesRevisionId, null);
    assert.deepStrictEqual([...revision.blockIndex], []);
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
