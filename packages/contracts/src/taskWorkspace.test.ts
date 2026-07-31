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

function slice1Task(overrides: Record<string, unknown>) {
  return {
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
    ...overrides,
  };
}

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

it.effect("decodes Slice 4 Build controls and defaults legacy Build snapshots", () =>
  Effect.gen(function* () {
    const phaseCommand = yield* decodeCommand({
      type: "task.build.phase.start",
      commandId: "command-phase-start",
      taskId: "task-1",
      createdAt: "2026-07-30T17:00:00.000Z",
      phaseId: "phase-1",
    });
    assert.strictEqual(phaseCommand.type, "task.build.phase.start");

    const manualCommand = yield* decodeCommand({
      type: "task.build.check.record-manual",
      commandId: "command-manual-check",
      taskId: "task-1",
      createdAt: "2026-07-30T17:00:01.000Z",
      checkId: "phase-1-check-1",
      status: "pass",
      note: "Reviewed by the operator.",
    });
    assert.strictEqual(manualCommand.type, "task.build.check.record-manual");

    const event = yield* decodeEvent({
      sequence: 1,
      eventId: "event-slice-4-legacy",
      commandId: "command-legacy",
      taskId: "task-1",
      type: "task.plan.approve",
      occurredAt: "2026-07-28T17:00:00.000Z",
      task: slice1Task({
        build: {
          phases: [
            {
              id: "phase-1",
              title: "Legacy phase",
              status: "pending",
              workItems: [
                { id: "work-item-1", title: "Legacy work", status: "pending", summary: null },
              ],
            },
          ],
          resultingCommitSha: null,
        },
      }),
    });
    const phase = event.task.build.phases[0];
    if (phase === undefined) return assert.fail("Expected a legacy phase");
    assert.strictEqual(phase.checkpointPolicy, "never");
    assert.deepStrictEqual([...phase.checkIds], []);
    assert.deepStrictEqual([...phase.workItems[0]!.dependsOn], []);
    assert.strictEqual(event.task.build.activePhaseId, null);
    assert.deepStrictEqual([...event.task.build.checkpoints], []);
    assert.deepStrictEqual([...event.task.build.continuationSessionIds], []);
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
      task: slice1Task({
        sessions: [
          {
            id: "session-1",
            stage: "plan",
            threadId: "thread-1",
            createdAt: "2026-07-28T17:00:00.000Z",
          },
        ],
      }),
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
      task: slice1Task({
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
      }),
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

// TW-S3-AC09: Slice 1 / Slice 2 rows predate the Slice 3b fields. Replaying them
// must yield the pre-3b meaning — Standard preset, unbudgeted manifest, no
// compression — rather than failing or inventing a budget.
it.effect("replays a Slice 1 workflow run that predates the preset union", () =>
  Effect.gen(function* () {
    const event = yield* decodeEvent({
      sequence: 3,
      eventId: "event-3",
      commandId: "command-3",
      taskId: "task-1",
      type: "task.create",
      occurredAt: "2026-07-28T17:00:00.000Z",
      task: slice1Task({
        workflowRuns: [
          {
            id: "standard-run-1",
            definitionVersion: "standard@0.1.0",
            currentStage: "questions",
            approvalPolicy: "before-build",
            createdAt: "2026-07-28T17:00:00.000Z",
            updatedAt: "2026-07-28T17:00:00.000Z",
          },
        ],
      }),
    });

    const run = event.task.workflowRuns[0];
    if (run === undefined) {
      return assert.fail("Expected a decoded workflow run");
    }
    assert.strictEqual(run.preset, "standard");
    assert.strictEqual(run.definitionVersion, "standard@0.1.0");
  }),
);

it.effect("replays a Slice 2 context manifest as unbudgeted and uncompressed", () =>
  Effect.gen(function* () {
    const event = yield* decodeEvent({
      sequence: 4,
      eventId: "event-4",
      commandId: "command-4",
      taskId: "task-1",
      type: "task.context-manifest.create",
      occurredAt: "2026-07-29T17:00:00.000Z",
      task: slice1Task({
        contextManifests: [
          {
            id: "manifest-1",
            taskId: "task-1",
            artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["intro"] }],
            createdAt: "2026-07-29T17:00:00.000Z",
          },
        ],
      }),
    });

    const manifest = event.task.contextManifests[0];
    if (manifest === undefined) {
      return assert.fail("Expected a decoded context manifest");
    }
    assert.strictEqual(manifest.tokenEstimate, 0);
    // `null` budget means "this manifest was never budgeted", which is exactly
    // true of every Slice 2 manifest — distinct from a budget of 0.
    assert.strictEqual(manifest.budget, null);
    assert.strictEqual(manifest.summaryArtifactRef, null);
    assert.strictEqual(manifest.compressedBlockCount, 0);
    assert.strictEqual(manifest.sessionId, null);
    assert.strictEqual(manifest.notes, null);
  }),
);

it.effect("defaults preset to standard on a task.create command that omits it", () =>
  Effect.gen(function* () {
    const command = yield* decodeCommand({
      type: "task.create",
      commandId: "command-legacy-create",
      taskId: "task-1",
      createdAt: "2026-07-28T17:00:00.000Z",
      title: "Slice 1",
      projectId: "project-1",
      workspaceRoot: "/repo",
      baseRef: "main",
      approvalPolicy: "before-build",
    });

    if (command.type !== "task.create") {
      return assert.fail("Expected task.create command");
    }
    assert.strictEqual(command.preset, "standard");
  }),
);

it.effect("decodes the Slice 3b preset, stage, and reasoning-stage commands", () =>
  Effect.gen(function* () {
    for (const preset of ["standard", "guided", "freeform"] as const) {
      const created = yield* decodeCommand({
        type: "task.create",
        commandId: `command-${preset}`,
        taskId: "task-1",
        createdAt: "2026-07-30T17:00:00.000Z",
        title: preset,
        projectId: "project-1",
        workspaceRoot: "/repo",
        baseRef: "main",
        preset,
        approvalPolicy: "before-build",
      });
      if (created.type !== "task.create") {
        return assert.fail("Expected task.create command");
      }
      assert.strictEqual(created.preset, preset);
    }

    const stageStart = yield* decodeCommand({
      type: "task.stage.start",
      commandId: "command-stage-start",
      taskId: "task-1",
      createdAt: "2026-07-30T17:00:00.000Z",
      stage: "research",
    });
    if (stageStart.type !== "task.stage.start") {
      return assert.fail("Expected task.stage.start command");
    }
    assert.strictEqual(stageStart.stage, "research");

    for (const type of ["task.research.complete", "task.design.complete"] as const) {
      const command = yield* decodeCommand({
        type,
        commandId: `command-${type}`,
        taskId: "task-1",
        createdAt: "2026-07-30T17:00:00.000Z",
      });
      assert.strictEqual(command.type, type);
    }

    const budgeted = yield* decodeCommand({
      type: "task.context-manifest.create",
      commandId: "command-budgeted-manifest",
      taskId: "task-1",
      createdAt: "2026-07-30T17:00:00.000Z",
      artifactRefs: [{ kind: "design", revision: 2, blockIds: ["shape"] }],
      budget: 1_000,
    });
    if (budgeted.type !== "task.context-manifest.create") {
      return assert.fail("Expected task.context-manifest.create command");
    }
    assert.strictEqual(budgeted.budget, 1_000);
    assert.strictEqual(budgeted.artifactRefs[0]?.kind, "design");
  }),
);
