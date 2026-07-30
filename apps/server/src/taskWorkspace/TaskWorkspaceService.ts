// @effect-diagnostics nodeBuiltinImport:off - durable NDJSON persistence and deterministic Git fixture execution use Node platform APIs.
// @effect-diagnostics preferSchemaOverJson:off - persisted event lines are decoded through the contract schema after JSON parsing.
// @effect-diagnostics globalErrorInEffectCatch:off - low-level Node I/O is immediately mapped into TaskWorkspaceError at the service boundary.
// @effect-diagnostics globalErrorInEffectFailure:off - low-level Node I/O errors never escape the service boundary.
// @effect-diagnostics tryCatchInEffectGen:off - the command reducer converts synchronous invariant exceptions into TaskWorkspaceError.
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import {
  TaskWorkspaceError,
  type TaskWorkspace,
  type TaskWorkspaceArtifact,
  type TaskWorkspaceArtifactKind,
  type TaskWorkspaceArtifactRevision,
  type TaskWorkspaceBlockIndexEntry,
  type TaskWorkspaceCommand,
  type TaskWorkspaceCommentThread,
  type TaskWorkspaceDispatchResult,
  TaskWorkspaceEvent as TaskWorkspaceEventSchema,
  type TaskWorkspaceEvent as TaskWorkspaceEventValue,
  type TaskWorkspaceId,
  type TaskWorkspaceSnapshot,
  type TaskWorkspaceStreamItem,
} from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import {
  allowsExplicitEntry,
  artifactKindForStage,
  currentVersionForPreset,
  resolveWorkflowDefinition,
  transitionFor,
  type WorkflowDefinition,
  type WorkflowTransitionCommandType,
} from "./workflowDefinitions.ts";

const execFileAsync = promisify(execFile);
const decodeTaskWorkspaceEvent = Schema.decodeUnknownSync(TaskWorkspaceEventSchema);
const isTaskWorkspaceError = Schema.is(TaskWorkspaceError);

const TASK_CONTRACT_VERSION = "task-workspace@0.1.0";
const ARTIFACT_CONTRACT_VERSION = "task-artifact@0.1.0";
const FIXTURE_FILE = "task-workspace-slice-1.txt";
const FIXTURE_CONTENT = "Kata Code Task Workspaces Slice 1 verified fixture.\n";
const BLOCK_BOUNDARY_WHITESPACE_PATTERN = /(?:\r?\n[ \t]*)+$/u;

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

/** Resolve the workflow definition this task was pinned to when it was created. */
function definitionFor(task: TaskWorkspace): WorkflowDefinition {
  return resolveWorkflowDefinition(currentRun(task).definitionVersion);
}

/**
 * Validate and apply a table-driven stage transition.
 *
 * The command no longer names its successor stage: the pinned definition does.
 * Returns the `workflowRuns` patch so callers keep control of the rest of the
 * task mutation they perform alongside the transition.
 */
function applyTransition(
  task: TaskWorkspace,
  command: WorkflowTransitionCommandType,
  updatedAt: TaskWorkspace["updatedAt"],
): TaskWorkspace["workflowRuns"] {
  const definition = definitionFor(task);
  const transition = transitionFor(definition, command);
  if (!transition) {
    throw new Error(`Workflow '${definition.version}' does not define a '${command}' transition.`);
  }
  requireStage(task, transition.from);
  if (transition.requiresArtifact) {
    requireArtifact(task, transition.requiresArtifact);
  }
  return replaceCurrentRun(task, { currentStage: transition.to, updatedAt });
}

/**
 * Deterministic local token estimate.
 *
 * Slice 3 deliberately does not call a provider tokenizer: budget behavior has
 * to be reproducible in tests and stable in CI, and manifests carry no target
 * model. Four characters per token is the usual rough ratio for English prose
 * and Markdown; it is a budgeting heuristic, not a billing figure.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Markdown of each block a manifest ref selects, in selection order. */
function selectedBlockTexts(
  task: TaskWorkspace,
  refs: ReadonlyArray<TaskWorkspace["contextManifests"][number]["artifactRefs"][number]>,
): ReadonlyArray<string> {
  const texts: string[] = [];
  for (const ref of refs) {
    const artifact = task.artifacts.find((candidate) => candidate.kind === ref.kind);
    const revision = artifact?.revisions.find((candidate) => candidate.revision === ref.revision);
    if (!revision) continue;
    for (const blockId of ref.blockIds) {
      const entry = revision.blockIndex.find((candidate) => candidate.id === blockId);
      if (!entry) continue;
      texts.push(blockContent(revision.markdown, blockId) ?? "");
    }
  }
  return texts;
}

/**
 * Body of the generated `summary` artifact for an over-budget selection.
 *
 * Slice 3 does not call a model to summarize: it records what was selected and
 * a truncated excerpt per block, which is deterministic and keeps the
 * provenance auditable. Model-authored summaries are a later slice.
 */
function summaryMarkdown(
  manifestId: string,
  refs: ReadonlyArray<TaskWorkspace["contextManifests"][number]["artifactRefs"][number]>,
  blockTexts: ReadonlyArray<string>,
): string {
  const lines = [
    `# Context summary for ${manifestId}`,
    "",
    `Compressed ${blockTexts.length} block(s) that exceeded the context budget.`,
    "",
  ];
  let cursor = 0;
  for (const ref of refs) {
    lines.push(`## ${ref.kind} revision ${ref.revision}`, "");
    for (const blockId of ref.blockIds) {
      const text = (blockTexts[cursor] ?? "").trim().replace(/\s+/gu, " ");
      cursor += 1;
      lines.push(`- \`${blockId}\`: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Extract one `<!-- kata:block:<id> -->` region from an artifact revision. */
function blockContent(markdown: string, blockId: string): string | null {
  const markerRe = /<!--\s*kata:block:([\w.-]+)\s*-->/g;
  const markers: Array<{ id: string; markerStart: number; contentStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(markdown)) !== null) {
    markers.push({
      id: match[1]!,
      markerStart: match.index,
      contentStart: match.index + match[0].length,
    });
  }
  const index = markers.findIndex((marker) => marker.id === blockId);
  if (index === -1) return null;
  const end = index + 1 < markers.length ? markers[index + 1]!.markerStart : markdown.length;
  return markdown.slice(markers[index]!.contentStart, end);
}

function requireContextManifest(task: TaskWorkspace, manifestId: string): void {
  if (!task.contextManifests.some((manifest) => manifest.id === manifestId)) {
    throw new Error(`Context manifest '${manifestId}' was not found.`);
  }
}

function validateContextManifestRefs(
  task: TaskWorkspace,
  command: Extract<TaskWorkspaceCommand, { type: "task.context-manifest.create" }>,
): void {
  if (
    command.sessionId !== undefined &&
    command.sessionId !== null &&
    !task.sessions.some((session) => session.id === command.sessionId)
  ) {
    throw new Error(`Session '${command.sessionId}' was not found.`);
  }

  for (const ref of command.artifactRefs) {
    const artifact = task.artifacts.find((candidate) => candidate.kind === ref.kind);
    const revision = artifact?.revisions.find((candidate) => candidate.revision === ref.revision);
    if (!revision) {
      throw new Error(`Revision ${ref.revision} does not exist for the ${ref.kind} artifact.`);
    }
    for (const blockId of ref.blockIds) {
      if (!revision.blockIndex.some((entry) => entry.id === blockId)) {
        throw new Error(
          `Block '${blockId}' does not exist in revision ${ref.revision} of the ${ref.kind} artifact.`,
        );
      }
    }
  }
}

function expectedTaskWorktreePath(
  worktreesDir: string,
  workspaceRoot: string,
  newRefName: string,
): string {
  return NodePath.join(
    worktreesDir,
    NodePath.basename(workspaceRoot),
    newRefName.replace(/\//g, "-"),
  );
}

function tryAdoptExistingWorktree(
  worktreePath: string,
  expectedRefName: string,
): Effect.Effect<{
  readonly worktree: { readonly path: string; readonly refName: string };
} | null> {
  return Effect.tryPromise({
    try: async () => {
      await NodeFs.access(worktreePath);
      const { stdout } = await execFileAsync(
        "git",
        ["-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD"],
        { encoding: "utf8" },
      );
      if (stdout.trim() !== expectedRefName) return null;
      return {
        worktree: {
          path: worktreePath,
          refName: expectedRefName,
        },
      };
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(Effect.orElseSucceed(() => null));
}

/**
 * Parse `<!-- kata:block:<id> -->` markers and build a persisted block index.
 *
 * Each entry captures the stable block `id`, the `headingPath` derived from the
 * first Markdown heading in the block's region, and a `contentHash` over the
 * region spanning from just after the marker to the next marker (or EOF). The
 * hash makes heading/content edits detectable for the comment lifecycle while
 * the stable `id` preserves comment identity across reorders.
 */
function buildBlockIndex(markdown: string): ReadonlyArray<TaskWorkspaceBlockIndexEntry> {
  const markerRe = /<!--\s*kata:block:([\w.-]+)\s*-->/g;
  const markers: Array<{ id: string; markerStart: number; contentStart: number }> = [];
  const seenIds = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = markerRe.exec(markdown)) !== null) {
    const id = match[1]!;
    if (seenIds.has(id)) {
      throw new Error(`Duplicate artifact block id '${id}'.`);
    }
    seenIds.add(id);
    markers.push({
      id,
      markerStart: match.index,
      contentStart: match.index + match[0].length,
    });
  }
  const headingRe = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/m;
  const entries: TaskWorkspaceBlockIndexEntry[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const current = markers[index]!;
    const end = index + 1 < markers.length ? markers[index + 1]!.markerStart : markdown.length;
    // Ignore blank lines at the block boundary, but retain whitespace on the final
    // content line because two trailing spaces before a newline are a Markdown hard break.
    const content = markdown
      .slice(current.contentStart, end)
      .replace(BLOCK_BOUNDARY_WHITESPACE_PATTERN, "");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const headingMatch = content.match(headingRe);
    const headingPath = headingMatch ? [headingMatch[1]!] : [];
    entries.push({ id: current.id, headingPath, contentHash });
  }
  return entries;
}

/**
 * Recompute open/outdated comment threads for an artifact after a new revision.
 *
 * - Block absent from the new revision index -> `orphaned`.
 * - Block present but its `contentHash` differs from the hash recorded at the
 *   thread's `baseRevisionId` -> `outdated`.
 * - Same hash -> `open` (restores a previously `outdated` thread).
 *
 * `resolved` and `orphaned` threads are never revived; threads are never dropped.
 */
function recomputeCommentsForArtifact(
  task: TaskWorkspace,
  artifact: TaskWorkspaceArtifact,
  newRevision: TaskWorkspaceArtifactRevision,
): ReadonlyArray<TaskWorkspaceCommentThread> {
  return task.comments.map((thread) => {
    if (thread.artifactId !== artifact.id) return thread;
    if (thread.status !== "open" && thread.status !== "outdated") return thread;
    const newEntry = newRevision.blockIndex.find((entry) => entry.id === thread.anchorBlockId);
    if (!newEntry) {
      return { ...thread, status: "orphaned" as const };
    }
    const baseRevision = artifact.revisions.find(
      (revision) => revision.id === thread.baseRevisionId,
    );
    const baseHash = baseRevision?.blockIndex.find(
      (entry) => entry.id === thread.anchorBlockId,
    )?.contentHash;
    if (baseHash !== undefined && newEntry.contentHash !== baseHash) {
      return { ...thread, status: "outdated" as const };
    }
    return { ...thread, status: "open" as const };
  });
}

function upsertArtifact(
  task: TaskWorkspace,
  command: Extract<TaskWorkspaceCommand, { type: "task.artifact.upsert" }>,
): TaskWorkspace {
  const existing = task.artifacts.find((artifact) => artifact.kind === command.kind);
  // Allocate the next revision number from the max stored revision, not currentRevision.
  // Select-revision can leave currentRevision behind the latest lineage tip; upserting from
  // that state must still append a unique higher revision (never collide on id/number).
  const maxStoredRevision = existing
    ? existing.revisions.reduce((max, candidate) => Math.max(max, candidate.revision), 0)
    : 0;
  const revision = maxStoredRevision + 1;
  const previousRevisionId =
    existing?.revisions.find((candidate) => candidate.revision === existing.currentRevision)?.id ??
    null;
  const nextRevision: TaskWorkspaceArtifactRevision = {
    id: `${command.kind}-revision-${revision}`,
    kind: command.kind,
    title: command.title,
    markdown: command.markdown,
    revision,
    sourceSessionId: command.sourceSessionId ?? null,
    supersedesRevisionId: previousRevisionId,
    blockIndex: buildBlockIndex(command.markdown),
    createdAt: command.createdAt,
  };
  const nextArtifact: TaskWorkspaceArtifact = existing
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
    comments: recomputeCommentsForArtifact(task, nextArtifact, nextRevision),
    updatedAt: command.createdAt,
  };
}

function initialTask(
  command: Extract<TaskWorkspaceCommand, { type: "task.create" }>,
): TaskWorkspace {
  // Pin the definition the task will resolve for the rest of its life. Later
  // versions of the same preset are registered alongside, never in place, so a
  // task created today keeps its original workflow shape.
  const definition = resolveWorkflowDefinition(currentVersionForPreset(command.preset));
  return {
    id: command.taskId,
    title: command.title,
    versions: {
      taskContract: TASK_CONTRACT_VERSION,
      artifactContract: ARTIFACT_CONTRACT_VERSION,
      workflowDefinition: definition.version,
      prompt: definition.promptBundleRef,
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
        id: `${command.preset}-run-1`,
        preset: command.preset,
        definitionVersion: definition.version,
        currentStage: definition.initialStage,
        approvalPolicy: command.approvalPolicy,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      },
    ],
    sessions: [],
    artifacts: [],
    comments: [],
    contextManifests: [],
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
  readonly subscribe: Effect.Effect<Stream.Stream<TaskWorkspaceStreamItem>, never, Scope.Scope>;
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
          const stage = currentRun(task).currentStage;
          if (command.role === "ad-hoc") {
            if (command.stage !== null) {
              throw new Error("An ad-hoc session must be linked with a null stage.");
            }
          } else {
            if (command.stage === null || stage !== command.stage) {
              throw new Error(
                `A ${command.role} session cannot be linked while the task is in ${stage}.`,
              );
            }
          }
          if (
            (command.role === "alternative" || command.role === "reviewer") &&
            command.contextManifestId == null
          ) {
            throw new Error(`A ${command.role} session requires a context manifest.`);
          }
          if (command.contextManifestId != null) {
            requireContextManifest(task, command.contextManifestId);
          }
          if (task.sessions.some((session) => session.threadId === command.threadId)) {
            throw new Error(`Thread '${command.threadId}' is already linked to this task.`);
          }
          return yield* append(command, {
            ...task,
            sessions: [
              ...task.sessions,
              {
                id: `session-${task.sessions.length + 1}`,
                stage: command.stage,
                threadId: command.threadId,
                role: command.role,
                provider: null,
                status: "active" as const,
                parentSessionId: null,
                forkPoint: null,
                contextManifestId: command.contextManifestId ?? null,
                createdAt: command.createdAt,
              },
            ],
            updatedAt: command.createdAt,
          });
        }
        case "task.session.fork": {
          const stage = currentRun(task).currentStage;
          const parent = task.sessions.find((session) => session.id === command.parentSessionId);
          if (!parent) {
            throw new Error(`Parent session '${command.parentSessionId}' was not found.`);
          }
          if (command.role === "ad-hoc") {
            if (command.stage !== null) {
              throw new Error("An ad-hoc session must be forked with a null stage.");
            }
          } else {
            if (command.stage === null || stage !== command.stage) {
              throw new Error(
                `A ${command.role} session cannot be forked while the task is in ${stage}.`,
              );
            }
          }
          requireContextManifest(task, command.contextManifestId);
          if (task.sessions.some((session) => session.threadId === command.threadId)) {
            throw new Error(`Thread '${command.threadId}' is already linked to this task.`);
          }
          return yield* append(command, {
            ...task,
            sessions: [
              ...task.sessions,
              {
                id: `session-${task.sessions.length + 1}`,
                stage: command.stage,
                threadId: command.threadId,
                role: command.role,
                provider: null,
                status: "active" as const,
                parentSessionId: command.parentSessionId,
                forkPoint: command.forkPoint,
                contextManifestId: command.contextManifestId,
                createdAt: command.createdAt,
              },
            ],
            updatedAt: command.createdAt,
          });
        }
        case "task.artifact.select-revision": {
          const artifact = task.artifacts.find((candidate) => candidate.kind === command.kind);
          if (!artifact) {
            throw new Error(`Task '${task.id}' has no ${command.kind} artifact.`);
          }
          if (!artifact.revisions.some((revision) => revision.revision === command.revision)) {
            throw new Error(
              `Revision ${command.revision} does not exist for the ${command.kind} artifact.`,
            );
          }
          return yield* append(command, {
            ...task,
            artifacts: task.artifacts.map((candidate) =>
              candidate.id === artifact.id
                ? { ...candidate, currentRevision: command.revision }
                : candidate,
            ),
            updatedAt: command.createdAt,
          });
        }
        case "task.context-manifest.create": {
          validateContextManifestRefs(task, command);
          const manifestId = `manifest-${task.contextManifests.length + 1}`;
          const definition = definitionFor(task);
          // Omitting `budget` takes the workflow default; an explicit `null`
          // opts this manifest out of budgeting entirely.
          const budget =
            command.budget === undefined ? definition.contextTokenBudget : command.budget;
          const blockTexts = selectedBlockTexts(task, command.artifactRefs);
          const selectionEstimate = blockTexts.reduce(
            (total, text) => total + estimateTokens(text),
            0,
          );
          const blockCount = blockTexts.length;
          const overflows = budget !== null && selectionEstimate > budget;

          // On overflow the selection is compressed into a `summary` artifact
          // and the manifest points at that instead. The manifest keeps the
          // compressed block count so the inspector can show what happened
          // rather than silently presenting a smaller context as complete.
          const summaryTask = overflows
            ? upsertArtifact(task, {
                ...command,
                type: "task.artifact.upsert" as const,
                kind: "summary" as const,
                title: `Context summary for ${manifestId}`,
                markdown: summaryMarkdown(manifestId, command.artifactRefs, blockTexts),
                sourceSessionId: command.sessionId ?? null,
              })
            : null;
          const summaryArtifact = summaryTask?.artifacts.find(
            (candidate) => candidate.kind === "summary",
          );
          const manifest = {
            id: manifestId,
            taskId: task.id,
            sessionId: command.sessionId ?? null,
            artifactRefs: command.artifactRefs,
            notes: command.notes ?? null,
            tokenEstimate: selectionEstimate,
            budget,
            summaryArtifactRef: summaryArtifact
              ? {
                  kind: "summary" as const,
                  revision: summaryArtifact.currentRevision,
                  blockIds: [],
                }
              : null,
            compressedBlockCount: overflows ? blockCount : 0,
            createdAt: command.createdAt,
          };
          return yield* append(command, {
            ...task,
            contextManifests: [...task.contextManifests, manifest],
            // An overflowing selection is replaced by a generated `summary`
            // artifact, so the manifest can reference the summary instead of
            // the raw blocks.
            artifacts: summaryTask ? summaryTask.artifacts : task.artifacts,
            comments: summaryTask ? summaryTask.comments : task.comments,
            updatedAt: command.createdAt,
          });
        }
        case "task.comment.create": {
          const artifact = task.artifacts.find((candidate) => candidate.id === command.artifactId);
          if (!artifact) {
            throw new Error(`Artifact '${command.artifactId}' was not found.`);
          }
          const baseRevision = artifact.revisions.find(
            (revision) => revision.id === command.baseRevisionId,
          );
          if (!baseRevision) {
            throw new Error(`Revision '${command.baseRevisionId}' was not found.`);
          }
          if (!baseRevision.blockIndex.some((entry) => entry.id === command.anchorBlockId)) {
            throw new Error(
              `Block '${command.anchorBlockId}' is not present in revision '${command.baseRevisionId}'.`,
            );
          }
          const threadId = `comment-${task.comments.length + 1}`;
          return yield* append(command, {
            ...task,
            comments: [
              ...task.comments,
              {
                id: threadId,
                taskId: task.id,
                artifactId: command.artifactId,
                anchorBlockId: command.anchorBlockId,
                baseRevisionId: command.baseRevisionId,
                status: "open" as const,
                messages: [
                  {
                    id: `${threadId}-message-1`,
                    author: command.author,
                    body: command.body,
                    createdAt: command.createdAt,
                  },
                ],
                createdAt: command.createdAt,
                resolvedAt: null,
                resolvedBy: null,
              },
            ],
            updatedAt: command.createdAt,
          });
        }
        case "task.comment.reply": {
          const thread = task.comments.find((candidate) => candidate.id === command.threadId);
          if (!thread) {
            throw new Error(`Comment thread '${command.threadId}' was not found.`);
          }
          if (thread.status !== "open" && thread.status !== "outdated") {
            throw new Error(`Cannot reply to a ${thread.status} comment thread.`);
          }
          return yield* append(command, {
            ...task,
            comments: task.comments.map((candidate) =>
              candidate.id === thread.id
                ? {
                    ...candidate,
                    messages: [
                      ...candidate.messages,
                      {
                        id: `${thread.id}-message-${candidate.messages.length + 1}`,
                        author: command.author,
                        body: command.body,
                        createdAt: command.createdAt,
                      },
                    ],
                  }
                : candidate,
            ),
            updatedAt: command.createdAt,
          });
        }
        case "task.comment.resolve": {
          const thread = task.comments.find((candidate) => candidate.id === command.threadId);
          if (!thread) {
            throw new Error(`Comment thread '${command.threadId}' was not found.`);
          }
          return yield* append(command, {
            ...task,
            comments: task.comments.map((candidate) =>
              candidate.id === thread.id
                ? {
                    ...candidate,
                    status: "resolved" as const,
                    resolvedAt: command.createdAt,
                    resolvedBy: command.resolvedBy,
                  }
                : candidate,
            ),
            updatedAt: command.createdAt,
          });
        }
        case "task.artifact.upsert": {
          const stage = currentRun(task).currentStage;
          const expectedKind = artifactKindForStage(definitionFor(task), stage);
          if (expectedKind !== command.kind) {
            throw new Error(
              `A ${command.kind} artifact cannot be written while the task is in ${stage}.`,
            );
          }
          return yield* append(command, upsertArtifact(task, command));
        }
        case "task.questions.complete":
        case "task.research.complete":
        case "task.design.complete": {
          // Pure reasoning-stage completions: the definition decides both
          // whether the transition exists and where it goes, so Standard
          // (questions -> plan) and Guided (questions -> research -> design ->
          // plan) share one handler.
          const workflowRuns = applyTransition(task, command.type, command.createdAt);
          return yield* append(command, {
            ...task,
            workflowRuns,
            updatedAt: command.createdAt,
          });
        }
        case "task.stage.start": {
          const definition = definitionFor(task);
          if (!allowsExplicitEntry(definition, command.stage)) {
            throw new Error(
              `Workflow '${definition.version}' does not allow explicitly starting '${command.stage}'.`,
            );
          }
          const stage = currentRun(task).currentStage;
          if (stage === command.stage) {
            throw new Error(`Task '${task.id}' is already in '${command.stage}'.`);
          }
          if (stage === definition.terminalStage) {
            throw new Error(`Task '${task.id}' is complete and cannot start another stage.`);
          }
          return yield* append(command, {
            ...task,
            workflowRuns: replaceCurrentRun(task, {
              currentStage: command.stage,
              updatedAt: command.createdAt,
            }),
            updatedAt: command.createdAt,
          });
        }
        case "task.plan.approve": {
          // Resolve the transition before provisioning: an illegal stage or a
          // missing plan artifact must fail before any worktree is created.
          const workflowRuns = applyTransition(task, command.type, command.createdAt);
          const repository = task.workspace.repositories[0];
          if (!repository) throw new Error("The task has no repository binding.");
          const newRefName = `katacode/task-${safeBranchSegment(task.id)}`;
          const worktreePath = expectedTaskWorktreePath(
            config.worktreesDir,
            repository.workspaceRoot,
            newRefName,
          );
          const existingWorktree = yield* tryAdoptExistingWorktree(worktreePath, newRefName);
          const worktree =
            existingWorktree ??
            (yield* gitWorkflow
              .createWorktree({
                cwd: repository.workspaceRoot,
                refName: repository.baseRef,
                newRefName,
                path: worktreePath,
              })
              .pipe(
                Effect.catch((cause) =>
                  tryAdoptExistingWorktree(worktreePath, newRefName).pipe(
                    Effect.flatMap((adopted) =>
                      adopted
                        ? Effect.succeed(adopted)
                        : Effect.fail(
                            taskError(command, "Failed to provision the task worktree.", cause),
                          ),
                    ),
                  ),
                ),
              ));
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
            workflowRuns,
            updatedAt: command.createdAt,
          });
        }
        case "task.build.work-item.set-status": {
          requireStage(task, "build");
          let found = false;
          const phases = task.build.phases.map((phase) => {
            const workItems = phase.workItems.map((item) => {
              if (item.id !== command.workItemId) return item;
              found = true;
              return { ...item, status: command.status };
            });
            const ownsWorkItem = phase.workItems.some((item) => item.id === command.workItemId);
            return {
              ...phase,
              status:
                ownsWorkItem && command.status === "running" ? ("running" as const) : phase.status,
              workItems,
            };
          });
          if (!found) throw new Error(`Work item '${command.workItemId}' was not found.`);
          return yield* append(command, {
            ...task,
            build: { ...task.build, phases },
            updatedAt: command.createdAt,
          });
        }
        case "task.fixture.apply": {
          const workflowRuns = applyTransition(task, command.type, command.createdAt);
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
            Effect.catch((cause) =>
              Effect.gen(function* () {
                const contents = yield* Effect.tryPromise({
                  try: async () => NodeFs.readFile(fixturePath, "utf8"),
                  catch: () => "",
                }).pipe(Effect.orElseSucceed(() => ""));
                const status = yield* runGit(worktreePath, [
                  "status",
                  "--porcelain",
                  "--",
                  FIXTURE_FILE,
                ]).pipe(Effect.orElseSucceed(() => "dirty"));
                if (contents === FIXTURE_CONTENT && status.trim() === "") {
                  return "";
                }
                return yield* taskError(command, "Failed to commit the fixture file.", cause);
              }),
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
            workflowRuns,
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
          const workflowRuns = applyTransition(task, command.type, command.createdAt);
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
            workflowRuns,
            verification: { ...task.verification, signedOffAt: command.createdAt },
            delivery: { state: "unavailable" },
            updatedAt: command.createdAt,
          });
        }
        default: {
          return yield* taskError(
            command,
            `Command '${(command as TaskWorkspaceCommand).type}' is not supported.`,
          );
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
    subscribe: Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(eventPubSub);
      const snapshot: TaskWorkspaceSnapshot = {
        sequence,
        tasks: [...taskById.values()].toSorted((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        ),
      };
      return Stream.concat(
        Stream.succeed({ kind: "snapshot" as const, snapshot }),
        Stream.fromSubscription(subscription).pipe(
          Stream.filter((event) => event.sequence > snapshot.sequence),
          Stream.map(
            (event): TaskWorkspaceStreamItem => ({
              kind: "task-upserted",
              sequence: event.sequence,
              task: event.task,
            }),
          ),
        ),
      );
    }),
  });
});

export const layer = Layer.effect(TaskWorkspaceService, make);
