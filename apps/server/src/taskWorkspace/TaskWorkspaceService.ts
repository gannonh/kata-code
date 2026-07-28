// @effect-diagnostics nodeBuiltinImport:off - durable NDJSON persistence and deterministic Git fixture execution use Node platform APIs.
// @effect-diagnostics preferSchemaOverJson:off - persisted event lines are decoded through the contract schema after JSON parsing.
// @effect-diagnostics globalErrorInEffectCatch:off - low-level Node I/O is immediately mapped into TaskWorkspaceError at the service boundary.
// @effect-diagnostics globalErrorInEffectFailure:off - low-level Node I/O errors never escape the service boundary.
// @effect-diagnostics tryCatchInEffectGen:off - the command reducer converts synchronous invariant exceptions into TaskWorkspaceError.
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  TaskWorkspaceError,
  type TaskWorkspace,
  type TaskWorkspaceArtifactKind,
  type TaskWorkspaceCommand,
  type TaskWorkspaceDispatchResult,
  TaskWorkspaceEvent as TaskWorkspaceEventSchema,
  type TaskWorkspaceEvent as TaskWorkspaceEventValue,
  type TaskWorkspaceId,
  type TaskWorkspaceSnapshot,
} from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";

const execFileAsync = promisify(execFile);
const decodeTaskWorkspaceEvent = Schema.decodeUnknownSync(TaskWorkspaceEventSchema);
const isTaskWorkspaceError = Schema.is(TaskWorkspaceError);

const TASK_CONTRACT_VERSION = "task-workspace@0.1.0";
const ARTIFACT_CONTRACT_VERSION = "task-artifact@0.1.0";
const STANDARD_WORKFLOW_VERSION = "standard@0.1.0";
const PROMPT_VERSION = "task-workspace-slice-1@0.1.0";
const FIXTURE_FILE = "task-workspace-slice-1.txt";
const FIXTURE_CONTENT = "Kata Code Task Workspaces Slice 1 verified fixture.\n";

function taskError(
  command: Pick<TaskWorkspaceCommand, "type" | "taskId">,
  message: string,
  cause?: unknown,
): TaskWorkspaceError {
  return new TaskWorkspaceError({
    message,
    commandType: command.type,
    taskId: command.taskId,
    ...(cause === undefined ? {} : { cause }),
  });
}

function currentRun(task: TaskWorkspace) {
  const run = task.workflowRuns.at(-1);
  if (!run) {
    throw new Error(`Task '${task.id}' has no workflow run.`);
  }
  return run;
}

function replaceCurrentRun(
  task: TaskWorkspace,
  patch: Partial<TaskWorkspace["workflowRuns"][number]>,
): TaskWorkspace["workflowRuns"] {
  return task.workflowRuns.map((run, index) =>
    index === task.workflowRuns.length - 1 ? { ...run, ...patch } : run,
  );
}

function requireStage(
  task: TaskWorkspace,
  stage: TaskWorkspace["workflowRuns"][number]["currentStage"],
): void {
  const actual = currentRun(task).currentStage;
  if (actual !== stage) {
    throw new Error(`Task '${task.id}' is in '${actual}', not '${stage}'.`);
  }
}

function latestArtifact(task: TaskWorkspace, kind: TaskWorkspaceArtifactKind) {
  const artifact = task.artifacts.find((candidate) => candidate.kind === kind);
  if (!artifact) return null;
  return (
    artifact.revisions.find((revision) => revision.revision === artifact.currentRevision) ?? null
  );
}

function requireArtifact(task: TaskWorkspace, kind: TaskWorkspaceArtifactKind): void {
  if (!latestArtifact(task, kind)) {
    throw new Error(`Task '${task.id}' requires a ${kind} artifact before this transition.`);
  }
}

function upsertArtifact(
  task: TaskWorkspace,
  command: Extract<TaskWorkspaceCommand, { type: "task.artifact.upsert" }>,
): TaskWorkspace {
  const existing = task.artifacts.find((artifact) => artifact.kind === command.kind);
  const revision = (existing?.currentRevision ?? 0) + 1;
  const nextRevision = {
    id: `${command.kind}-revision-${revision}`,
    kind: command.kind,
    title: command.title,
    markdown: command.markdown,
    revision,
    sourceSessionId: command.sourceSessionId ?? null,
    createdAt: command.createdAt,
  } as const;
  const nextArtifact = existing
    ? {
        ...existing,
        currentRevision: revision,
        revisions: [...existing.revisions, nextRevision],
      }
    : {
        id: `${command.kind}-artifact`,
        kind: command.kind,
        currentRevision: revision,
        revisions: [nextRevision],
      };
  return {
    ...task,
    artifacts: existing
      ? task.artifacts.map((artifact) => (artifact.id === existing.id ? nextArtifact : artifact))
      : [...task.artifacts, nextArtifact],
    updatedAt: command.createdAt,
  };
}

function initialTask(
  command: Extract<TaskWorkspaceCommand, { type: "task.create" }>,
): TaskWorkspace {
  return {
    id: command.taskId,
    title: command.title,
    versions: {
      taskContract: TASK_CONTRACT_VERSION,
      artifactContract: ARTIFACT_CONTRACT_VERSION,
      workflowDefinition: STANDARD_WORKFLOW_VERSION,
      prompt: PROMPT_VERSION,
    },
    workspace: {
      repositories: [
        {
          id: "primary",
          projectId: command.projectId,
          workspaceRoot: command.workspaceRoot,
          baseRef: command.baseRef,
          branch: null,
          worktreePath: null,
          provisioningStatus: "pending",
        },
      ],
    },
    workflowRuns: [
      {
        id: "standard-run-1",
        preset: command.preset,
        definitionVersion: STANDARD_WORKFLOW_VERSION,
        currentStage: "questions",
        approvalPolicy: command.approvalPolicy,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      },
    ],
    sessions: [],
    artifacts: [],
    comments: [],
    build: {
      phases: [
        {
          id: "phase-1",
          title: "Implement deterministic fixture",
          status: "pending",
          workItems: [
            {
              id: "work-item-1",
              title: `Create and commit ${FIXTURE_FILE}`,
              status: "pending",
              summary: null,
            },
          ],
        },
      ],
      resultingCommitSha: null,
    },
    verification: {
      criteria: [
        {
          id: "criterion-1",
          description: `${FIXTURE_FILE} exists at the resulting commit with the expected content.`,
        },
      ],
      results: [],
      signedOffAt: null,
    },
    sourceLinks: [],
    delivery: { state: "unavailable" },
    createdAt: command.createdAt,
    updatedAt: command.createdAt,
  };
}

function safeBranchSegment(taskId: string): string {
  const normalized = taskId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return (normalized || "task").slice(0, 32);
}

function runGit(cwd: string, args: ReadonlyArray<string>): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", [...args], {
        cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Kata Code Task Workspace",
          GIT_AUTHOR_EMAIL: "tasks@kata.sh",
          GIT_COMMITTER_NAME: "Kata Code Task Workspace",
          GIT_COMMITTER_EMAIL: "tasks@kata.sh",
        },
      });
      return stdout.trim();
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
}

function readPersistedEvents(
  filePath: string,
): Effect.Effect<ReadonlyArray<TaskWorkspaceEventValue>, Error> {
  return Effect.tryPromise({
    try: async () => {
      let contents: string;
      try {
        contents = await NodeFs.readFile(filePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const events: TaskWorkspaceEventValue[] = [];
      for (const line of contents.split("\n")) {
        if (!line.trim()) continue;
        events.push(decodeTaskWorkspaceEvent(JSON.parse(line) as unknown));
      }
      return events;
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
}

export interface TaskWorkspaceServiceShape {
  readonly dispatch: (
    command: TaskWorkspaceCommand,
  ) => Effect.Effect<TaskWorkspaceDispatchResult, TaskWorkspaceError>;
  readonly getSnapshot: Effect.Effect<TaskWorkspaceSnapshot, never>;
  readonly getTask: (taskId: TaskWorkspaceId) => Effect.Effect<TaskWorkspace | null, never>;
  readonly streamEvents: Stream.Stream<TaskWorkspaceEventValue>;
}

export class TaskWorkspaceService extends Context.Service<
  TaskWorkspaceService,
  TaskWorkspaceServiceShape
>()("@kata-sh/code-cli/taskWorkspace/TaskWorkspaceService") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const gitWorkflow = yield* GitWorkflowService;
  const crypto = yield* Crypto.Crypto;
  const semaphore = yield* Semaphore.make(1);
  const eventPubSub = yield* PubSub.unbounded<TaskWorkspaceEventValue>();
  const eventLogPath = NodePath.join(config.stateDir, "task-workspace-events.ndjson");
  const loadedEvents = yield* readPersistedEvents(eventLogPath).pipe(
    Effect.mapError(
      (cause) =>
        new TaskWorkspaceError({
          message: "Failed to replay the task workspace event log.",
          commandType: "task.replay",
          cause,
        }),
    ),
  );

  let sequence = 0;
  const taskById = new Map<TaskWorkspaceId, TaskWorkspace>();
  const receiptByCommandId = new Map<string, TaskWorkspaceDispatchResult>();
  for (const event of loadedEvents) {
    sequence = Math.max(sequence, event.sequence);
    taskById.set(event.taskId, event.task);
    receiptByCommandId.set(event.commandId, { sequence: event.sequence, task: event.task });
  }

  const append = (command: TaskWorkspaceCommand, task: TaskWorkspace) =>
    Effect.gen(function* () {
      const eventId = yield* crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) =>
          taskError(command, "Failed to generate a task event identifier.", cause),
        ),
      );
      const event: TaskWorkspaceEventValue = {
        sequence: sequence + 1,
        eventId,
        commandId: command.commandId,
        taskId: command.taskId,
        type: command.type,
        occurredAt: command.createdAt,
        task,
      };
      yield* Effect.tryPromise({
        try: async () => {
          await NodeFs.mkdir(NodePath.dirname(eventLogPath), { recursive: true });
          await NodeFs.appendFile(eventLogPath, `${JSON.stringify(event)}\n`, "utf8");
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(
        Effect.mapError((cause) => taskError(command, "Failed to persist task event.", cause)),
      );
      sequence = event.sequence;
      taskById.set(command.taskId, task);
      const result = { sequence: event.sequence, task };
      receiptByCommandId.set(command.commandId, result);
      yield* PubSub.publish(eventPubSub, event);
      return result;
    });

  const dispatchUnlocked = Effect.fn("TaskWorkspaceService.dispatch")(function* (
    command: TaskWorkspaceCommand,
  ) {
    const prior = receiptByCommandId.get(command.commandId);
    if (prior) return prior;

    try {
      if (command.type === "task.create") {
        if (taskById.has(command.taskId)) {
          return yield* taskError(command, `Task '${command.taskId}' already exists.`);
        }
        return yield* append(command, initialTask(command));
      }

      const task = taskById.get(command.taskId);
      if (!task) {
        return yield* taskError(command, `Task '${command.taskId}' was not found.`);
      }

      switch (command.type) {
        case "task.session.link": {
          if (currentRun(task).currentStage !== command.stage) {
            throw new Error(
              `A ${command.stage} session cannot be linked while the task is in ${currentRun(task).currentStage}.`,
            );
          }
          if (task.sessions.some((session) => session.threadId === command.threadId)) {
            return yield* append(command, { ...task, updatedAt: command.createdAt });
          }
          return yield* append(command, {
            ...task,
            sessions: [
              ...task.sessions,
              {
                id: `session-${task.sessions.length + 1}`,
                stage: command.stage,
                threadId: command.threadId,
                createdAt: command.createdAt,
              },
            ],
            updatedAt: command.createdAt,
          });
        }
        case "task.artifact.upsert": {
          const stage = currentRun(task).currentStage;
          const expectedKind =
            stage === "questions"
              ? "questions"
              : stage === "plan"
                ? "plan"
                : stage === "verify"
                  ? "verification"
                  : null;
          if (expectedKind !== command.kind) {
            throw new Error(
              `A ${command.kind} artifact cannot be written while the task is in ${stage}.`,
            );
          }
          return yield* append(command, upsertArtifact(task, command));
        }
        case "task.questions.complete": {
          requireStage(task, "questions");
          requireArtifact(task, "questions");
          return yield* append(command, {
            ...task,
            workflowRuns: replaceCurrentRun(task, {
              currentStage: "plan",
              updatedAt: command.createdAt,
            }),
            updatedAt: command.createdAt,
          });
        }
        case "task.plan.approve": {
          requireStage(task, "plan");
          requireArtifact(task, "plan");
          const repository = task.workspace.repositories[0];
          if (!repository) throw new Error("The task has no repository binding.");
          const worktree = yield* gitWorkflow
            .createWorktree({
              cwd: repository.workspaceRoot,
              refName: repository.baseRef,
              newRefName: `katacode/task-${safeBranchSegment(task.id)}`,
              path: null,
            })
            .pipe(
              Effect.mapError((cause) =>
                taskError(command, "Failed to provision the task worktree.", cause),
              ),
            );
          return yield* append(command, {
            ...task,
            workspace: {
              repositories: task.workspace.repositories.map((candidate) =>
                candidate.id === repository.id
                  ? {
                      ...candidate,
                      branch: worktree.worktree.refName,
                      worktreePath: worktree.worktree.path,
                      provisioningStatus: "provisioned" as const,
                    }
                  : candidate,
              ),
            },
            workflowRuns: replaceCurrentRun(task, {
              currentStage: "build",
              updatedAt: command.createdAt,
            }),
            updatedAt: command.createdAt,
          });
        }
        case "task.build.work-item.set-status": {
          requireStage(task, "build");
          let found = false;
          const phases = task.build.phases.map((phase) => ({
            ...phase,
            status: command.status === "running" ? ("running" as const) : phase.status,
            workItems: phase.workItems.map((item) => {
              if (item.id !== command.workItemId) return item;
              found = true;
              return { ...item, status: command.status };
            }),
          }));
          if (!found) throw new Error(`Work item '${command.workItemId}' was not found.`);
          return yield* append(command, {
            ...task,
            build: { ...task.build, phases },
            updatedAt: command.createdAt,
          });
        }
        case "task.fixture.apply": {
          requireStage(task, "build");
          const repository = task.workspace.repositories[0];
          const worktreePath = repository?.worktreePath;
          if (!worktreePath) throw new Error("The task worktree has not been provisioned.");
          const fixturePath = NodePath.join(worktreePath, FIXTURE_FILE);
          yield* Effect.tryPromise({
            try: async () => NodeFs.writeFile(fixturePath, FIXTURE_CONTENT, "utf8"),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          }).pipe(
            Effect.mapError((cause) =>
              taskError(command, "Failed to write the fixture file.", cause),
            ),
          );
          yield* runGit(worktreePath, ["add", "--", FIXTURE_FILE]).pipe(
            Effect.mapError((cause) =>
              taskError(command, "Failed to stage the fixture file.", cause),
            ),
          );
          yield* runGit(worktreePath, [
            "commit",
            "-m",
            "feat(task-workspaces): apply slice 1 fixture",
          ]).pipe(
            Effect.mapError((cause) =>
              taskError(command, "Failed to commit the fixture file.", cause),
            ),
          );
          const commitSha = yield* runGit(worktreePath, ["rev-parse", "HEAD"]).pipe(
            Effect.mapError((cause) =>
              taskError(command, "Failed to resolve the fixture commit.", cause),
            ),
          );
          const phases = task.build.phases.map((phase) => ({
            ...phase,
            status: "completed" as const,
            workItems: phase.workItems.map((item) => ({
              ...item,
              status: "completed" as const,
              summary: `${FIXTURE_FILE} committed at ${commitSha.slice(0, 12)}.`,
            })),
          }));
          return yield* append(command, {
            ...task,
            build: { phases, resultingCommitSha: commitSha },
            workflowRuns: replaceCurrentRun(task, {
              currentStage: "verify",
              updatedAt: command.createdAt,
            }),
            updatedAt: command.createdAt,
          });
        }
        case "task.verification.run": {
          requireStage(task, "verify");
          const criterion = task.verification.criteria.find(
            (candidate) => candidate.id === command.criterionId,
          );
          if (!criterion) throw new Error(`Criterion '${command.criterionId}' was not found.`);
          const repository = task.workspace.repositories[0];
          const worktreePath = repository?.worktreePath;
          const expectedCommitSha = task.build.resultingCommitSha;
          if (!worktreePath || !expectedCommitSha) {
            throw new Error("The task has no resulting build commit to verify.");
          }
          const actualCommitSha = yield* runGit(worktreePath, ["rev-parse", "HEAD"]).pipe(
            Effect.mapError((cause) =>
              taskError(command, "Failed to resolve the verification commit.", cause),
            ),
          );
          const actualContents = yield* Effect.tryPromise({
            try: async () => NodeFs.readFile(NodePath.join(worktreePath, FIXTURE_FILE), "utf8"),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          }).pipe(Effect.orElseSucceed(() => ""));
          const status =
            actualCommitSha === expectedCommitSha && actualContents === FIXTURE_CONTENT
              ? ("pass" as const)
              : ("fail" as const);
          const summary =
            status === "pass"
              ? `${FIXTURE_FILE} matches the expected content at ${actualCommitSha.slice(0, 12)}.`
              : `Verification failed: expected commit ${expectedCommitSha.slice(0, 12)} and the canonical fixture content.`;
          const result = {
            id: `verification-${task.verification.results.length + 1}`,
            criterionId: command.criterionId,
            status,
            commitSha: actualCommitSha,
            summary,
            verifiedAt: command.createdAt,
          } as const;
          const verificationMarkdown = [
            "# Verification",
            "",
            `- Criterion: ${criterion.description}`,
            `- Status: ${status.toUpperCase()}`,
            `- Commit: ${actualCommitSha}`,
            `- Evidence: ${summary}`,
          ].join("\n");
          const withResult: TaskWorkspace = {
            ...task,
            verification: {
              ...task.verification,
              results: [
                ...task.verification.results.filter(
                  (candidate) => candidate.criterionId !== command.criterionId,
                ),
                result,
              ],
            },
            updatedAt: command.createdAt,
          };
          return yield* append(
            command,
            upsertArtifact(withResult, {
              type: "task.artifact.upsert",
              commandId: command.commandId,
              taskId: command.taskId,
              createdAt: command.createdAt,
              kind: "verification",
              title: "Slice 1 verification",
              markdown: verificationMarkdown,
              sourceSessionId: null,
            }),
          );
        }
        case "task.verification.signoff": {
          requireStage(task, "verify");
          const commitSha = task.build.resultingCommitSha;
          if (!commitSha) throw new Error("The task has no resulting commit.");
          const allPass = task.verification.criteria.every((criterion) =>
            task.verification.results.some(
              (result) =>
                result.criterionId === criterion.id &&
                result.status === "pass" &&
                result.commitSha === commitSha,
            ),
          );
          if (!allPass) {
            throw new Error(
              "Every criterion must pass against the resulting commit before signoff.",
            );
          }
          return yield* append(command, {
            ...task,
            workflowRuns: replaceCurrentRun(task, {
              currentStage: "verified",
              updatedAt: command.createdAt,
            }),
            verification: { ...task.verification, signedOffAt: command.createdAt },
            delivery: { state: "unavailable" },
            updatedAt: command.createdAt,
          });
        }
      }
    } catch (cause) {
      if (isTaskWorkspaceError(cause)) return yield* cause;
      return yield* taskError(
        command,
        cause instanceof Error ? cause.message : "Task command failed.",
        cause,
      );
    }
  });

  const dispatch: TaskWorkspaceServiceShape["dispatch"] = (command) =>
    semaphore.withPermits(1)(dispatchUnlocked(command));

  return TaskWorkspaceService.of({
    dispatch,
    getSnapshot: Effect.sync(() => ({
      sequence,
      tasks: [...taskById.values()].toSorted((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    })),
    getTask: (taskId) => Effect.sync(() => taskById.get(taskId) ?? null),
    get streamEvents() {
      return Stream.fromPubSub(eventPubSub);
    },
  });
});

export const layer = Layer.effect(TaskWorkspaceService, make);
