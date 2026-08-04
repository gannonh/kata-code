import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { CommandId, ProjectId } from "./baseSchemas.ts";
import {
  TaskWorkspace,
  TaskWorkspaceBootstrapOutboxPayload,
  TaskWorkspaceCommand,
  TaskWorkspaceEvent,
  TaskWorkspaceStreamItem,
} from "./taskWorkspace.ts";

const decodeCommand = Schema.decodeUnknownEffect(TaskWorkspaceCommand);
const decodeBootstrapPayload = Schema.decodeUnknownEffect(TaskWorkspaceBootstrapOutboxPayload);
const decodeStreamItem = Schema.decodeUnknownEffect(TaskWorkspaceStreamItem);
const decodeEvent = Schema.decodeUnknownEffect(TaskWorkspaceEvent);
const decodeTask = Schema.decodeUnknownEffect(TaskWorkspace);

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

it.effect("decodes Slice 2 workflow and implementation contracts additively", () =>
  Effect.gen(function* () {
    const upgrade = yield* decodeCommand({
      type: "task.workflow.upgrade",
      commandId: "command-upgrade",
      taskId: "task-1",
      createdAt: "2026-08-03T17:00:00.000Z",
      sourceVersion: "guided@0.2.0",
      targetVersion: "guided@0.3.0",
      expectedTaskRevision: 4,
      operationKey: "upgrade-1",
    });
    const progress = yield* decodeCommand({
      type: "task.implementation.progress",
      commandId: "command-progress",
      taskId: "task-1",
      createdAt: "2026-08-03T17:00:01.000Z",
      expectedTaskRevision: 5,
      phaseId: "phase:foundation",
      status: "completed",
      summary: "Done",
    });
    const checkpointContinue = yield* decodeCommand({
      type: "task.build.checkpoint.continue",
      commandId: "command-checkpoint-continue",
      taskId: "task-1",
      createdAt: "2026-08-03T17:00:02.000Z",
      checkpointId: "checkpoint-1",
      expectedTaskRevision: 6,
      operationKey: "checkpoint-continue-1",
    });
    const amendmentRequestChanges = yield* decodeCommand({
      type: "task.amendment.request-changes",
      commandId: "command-amendment-changes",
      taskId: "task-1",
      createdAt: "2026-08-03T17:00:03.000Z",
      amendmentId: "amendment-1",
      feedback: "Keep the original API.",
      expectedTaskRevision: 7,
      operationKey: "amendment-changes-1",
    });
    const amendmentApprove = yield* decodeCommand({
      type: "task.amendment.approve",
      commandId: "command-amendment-approve",
      taskId: "task-1",
      createdAt: "2026-08-03T17:00:04.000Z",
      amendmentId: "amendment-1",
      approvedBy: "operator",
      expectedTaskRevision: 8,
      operationKey: "amendment-approve-1",
    });
    assert.strictEqual(upgrade.type, "task.workflow.upgrade");
    assert.strictEqual(progress.type, "task.implementation.progress");
    assert.strictEqual(checkpointContinue.type, "task.build.checkpoint.continue");
    if (checkpointContinue.type !== "task.build.checkpoint.continue") {
      return assert.fail("Expected task.build.checkpoint.continue command");
    }
    assert.strictEqual(checkpointContinue.contextManifestId, undefined);
    assert.strictEqual(amendmentRequestChanges.type, "task.amendment.request-changes");
    assert.strictEqual(amendmentApprove.type, "task.amendment.approve");
    if (amendmentApprove.type !== "task.amendment.approve") {
      return assert.fail("Expected task.amendment.approve command");
    }
    assert.strictEqual(amendmentApprove.expectedTaskRevision, 8);
    assert.strictEqual(amendmentApprove.operationKey, "amendment-approve-1");

    const continuationPayload = yield* decodeBootstrapPayload({
      stage: "build",
      occurrence: 0,
      executionProfile: "task-worktree-write",
      sessionId: "session-1",
      threadId: "thread-1",
      threadCreateCommandId: "command-thread-1",
      turnStartCommandId: "command-turn-1",
      kickoffMessageId: "message-kickoff-1",
      contextManifestId: "manifest-1",
      continuationCheckpointId: "checkpoint-1",
      continuationMode: "checkpoint",
      continuationActivatePhase: true,
    });
    assert.strictEqual(continuationPayload.continuationCheckpointId, "checkpoint-1");
    assert.strictEqual(continuationPayload.continuationActivatePhase, true);

    const amendment = yield* decodeTask(
      slice1Task({
        build: { phases: [], resultingCommitSha: null },
      }),
    );
    assert.deepStrictEqual([...amendment.build.checkAttempts], []);
  }),
);

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
          checkpoints: [
            {
              id: "checkpoint-1",
              phaseId: "phase-1",
              reason: "Legacy checkpoint",
              status: "waiting",
              checkIds: [],
              continuationSessionId: null,
              contextManifestId: null,
              createdAt: "2026-07-30T17:00:02.000Z",
              continuedAt: null,
            },
          ],
        },
      }),
    });
    const phase = event.task.build.phases[0];
    if (phase === undefined) return assert.fail("Expected a legacy phase");
    assert.strictEqual(phase.checkpointPolicy, "never");
    assert.deepStrictEqual([...phase.checkIds], []);
    assert.deepStrictEqual([...phase.workItems[0]!.dependsOn], []);
    assert.strictEqual(event.task.build.activePhaseId, null);
    assert.strictEqual(event.task.build.checkpoints[0]?.observedCommitSha, null);
    assert.deepStrictEqual([...event.task.build.continuationSessionIds], []);
  }),
);

it.effect("requires a context manifest and thread for Build resume", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeCommand({
        type: "task.build.resume",
        commandId: "command-resume-without-context",
        taskId: "task-1",
        createdAt: "2026-07-30T17:00:00.000Z",
        checkpointId: "checkpoint-1",
      }),
    );

    assert.strictEqual(result._tag, "Failure");
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

it.effect("decodes first-slice task.create and the new mutation commands", () =>
  Effect.gen(function* () {
    const create = yield* decodeCommand({
      type: "task.create",
      commandId: "command-v2-create",
      taskId: "my-task",
      createdAt: "2026-08-01T17:00:00.000Z",
      title: "Guided onboarding",
      projectId: "project-1",
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
    });
    if (create.type !== "task.create") return assert.fail("Expected task.create");
    assert.strictEqual(create.operationKey, "op-create-1");
    assert.strictEqual(create.brief, "Add a guided onboarding flow.");
    assert.strictEqual(create.worktreePolicy, "later");
    assert.strictEqual(create.modelSelection?.model, "claude-sonnet-4");

    const requestChanges = yield* decodeCommand({
      type: "task.stage.request-changes",
      commandId: "command-changes",
      taskId: "my-task",
      createdAt: "2026-08-01T17:00:00.000Z",
      expectedTaskRevision: 9,
      operationKey: "op-changes-1",
      feedback: "The plan misses rollback handling.",
    });
    if (requestChanges.type !== "task.stage.request-changes") {
      return assert.fail("Expected task.stage.request-changes");
    }
    assert.strictEqual(requestChanges.feedback, "The plan misses rollback handling.");

    const policySet = yield* decodeCommand({
      type: "task.worktree.policy.set",
      commandId: "command-policy",
      taskId: "my-task",
      createdAt: "2026-08-01T17:00:00.000Z",
      expectedTaskRevision: 10,
      operationKey: "op-policy-1",
      policy: "now",
    });
    if (policySet.type !== "task.worktree.policy.set") {
      return assert.fail("Expected task.worktree.policy.set");
    }
    assert.strictEqual(policySet.policy, "now");

    const recover = yield* decodeCommand({
      type: "task.session.recover-primary",
      commandId: "command-recover",
      taskId: "my-task",
      createdAt: "2026-08-01T17:00:00.000Z",
      expectedTaskRevision: 11,
      operationKey: "op-recover-1",
      selection: { kind: "existing", sessionId: "session-3" },
    });
    if (recover.type !== "task.session.recover-primary") {
      return assert.fail("Expected task.session.recover-primary");
    }
    assert.deepStrictEqual(recover.selection, { kind: "existing", sessionId: "session-3" });

    const repair = yield* decodeCommand({
      type: "task.environment.repair",
      commandId: "command-repair",
      taskId: "my-task",
      createdAt: "2026-08-01T17:00:00.000Z",
      expectedTaskRevision: 12,
      operationKey: "op-repair-1",
      projectId: "project-2",
      workspaceRoot: "/repo/other",
      baseRef: "main",
    });
    assert.strictEqual(repair.type, "task.environment.repair");

    const retry = yield* decodeCommand({
      type: "task.operation.retry",
      commandId: "command-retry",
      taskId: "my-task",
      createdAt: "2026-08-01T17:00:00.000Z",
      expectedTaskRevision: 13,
      targetOperationKey: "op-bootstrap-1",
    });
    assert.strictEqual(retry.type, "task.operation.retry");
  }),
);

it.effect("decodes the enriched dispatch result", () =>
  Effect.gen(function* () {
    const result = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        sequence: Schema.Number,
        task: TaskWorkspace,
        operation: Schema.Struct({
          key: Schema.String,
          status: Schema.String,
          attempt: Schema.Number,
        }),
        taskRoute: Schema.Struct({ environmentId: Schema.String, taskId: Schema.String }),
      }),
    )({
      sequence: 3,
      task: slice1Task({}),
      operation: { key: "op-create-1", status: "completed", attempt: 1 },
      taskRoute: { environmentId: "environment-local", taskId: "task-1" },
    });
    assert.strictEqual(result.operation.status, "completed");
    assert.strictEqual(result.taskRoute.taskId, "task-1");
  }),
);

it.effect("decodes durable receipt, proposal, and outbox records", () =>
  Effect.gen(function* () {
    const decodeReceipt = Schema.decodeUnknownEffect(
      Schema.Struct({
        environmentId: Schema.String,
        commandId: Schema.String,
        taskId: Schema.String,
        commandType: Schema.String,
        commandDigest: Schema.String,
        operationKey: Schema.NullOr(Schema.String),
        status: Schema.String,
        resultEventId: Schema.NullOr(Schema.String),
        error: Schema.NullOr(Schema.String),
        createdAt: Schema.String,
      }),
    );
    const receipt = yield* decodeReceipt({
      environmentId: "environment-local",
      commandId: "command-1",
      taskId: "task-1",
      commandType: "task.create",
      commandDigest: "sha256-canonical",
      operationKey: "op-create-1",
      status: "accepted",
      resultEventId: "event-1",
      error: null,
      createdAt: "2026-08-01T17:00:00.000Z",
    });
    assert.strictEqual(receipt.status, "accepted");

    const decodeProposal = Schema.decodeUnknownEffect(
      Schema.Struct({
        id: Schema.String,
        taskId: Schema.String,
        occurrence: Schema.Number,
        providerTurnId: Schema.String,
        status: Schema.String,
      }),
    );
    const proposal = yield* decodeProposal({
      id: "proposal-1",
      taskId: "task-1",
      occurrence: 0,
      providerTurnId: "turn-1",
      status: "proposed",
    });
    assert.strictEqual(proposal.status, "proposed");
  }),
);
