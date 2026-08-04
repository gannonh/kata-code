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
  TASK_BRIEF_MAX_CHARS,
  TaskWorkspaceBootstrapOutboxPayload,
  TaskWorkspaceBootstrapState,
  TaskWorkspaceError,
  TaskWorkspaceWorktreeOutboxPayload,
  CommandId,
  type TaskWorkspace,
  type TaskWorkspaceArtifact,
  type TaskWorkspaceArtifactKind,
  type TaskWorkspaceArtifactRevision,
  type TaskWorkspaceBlockIndexEntry,
  type TaskWorkspaceBuildCheck,
  type TaskWorkspaceBuildCheckpoint,
  type TaskWorkspaceBuildPhase,
  type TaskWorkspaceCommand,
  type TaskWorkspaceCommentThread,
  type TaskWorkspaceCompletionProposal,
  type TaskWorkspaceContextManifest,
  type TaskWorkspaceDispatchOperationStatus,
  type TaskWorkspaceDispatchResult,
  type TaskImplementationContextResult,
  type TaskImplementationProgressAck,
  type TaskImplementationCheckRunAck,
  type TaskImplementationAmendmentAck,
  type TaskImplementationCompleteAck,
  type TaskWorkspaceOperationReceipt,
  type TaskWorkspaceOutboxEntry,
  TaskWorkspaceEvent as TaskWorkspaceEventSchema,
  type TaskWorkspaceEvent as TaskWorkspaceEventValue,
  type TaskWorkspaceId,
  type TaskWorkspaceSnapshot,
  type TaskWorkspaceStage,
  type TaskWorkspaceStageOccurrence,
  type TaskWorkspaceStreamItem,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  type EnvironmentId,
} from "@kata-sh/code-contracts";
import { dependenciesPass } from "@kata-sh/code-shared/taskWorkspaceBuild";
import { canonicalTaskCommandDigest } from "@kata-sh/code-shared/taskWorkspaceDigest";
import {
  compileLegacyTaskWorkspacePlan,
  compileTaskWorkspacePlan,
} from "@kata-sh/code-shared/taskWorkspacePlanCompiler";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { supportsTaskWorktreeWrite } from "../provider/Services/ProviderAdapter.ts";
import { TaskWorkspaceStore } from "../persistence/Services/TaskWorkspaceStore.ts";
import {
  TaskWorkspaceSourceResolver,
  type TaskWorkspaceSourceResolution,
} from "./Services/TaskWorkspaceSourceResolver.ts";
import {
  TASK_ARTIFACT_CONTRACT_VERSION_0_3_0,
  TASK_WORKSPACE_CONTRACT_VERSION_0_3_0,
  deriveImportedEvents,
} from "./taskWorkspaceNormalizer.ts";
import {
  trustedImplementationInstructions,
  trustedStageInstructions,
} from "./taskStageInstructions.ts";
import {
  allowsExplicitEntry,
  artifactKindForStage,
  currentVersionForPreset,
  legacyVersionForPreset,
  resolveWorkflowDefinition,
  transitionFor,
  type WorkflowDefinition,
  type WorkflowTransitionCommandType,
} from "./workflowDefinitions.ts";

const execFileAsync = promisify(execFile);
const decodeTaskWorkspaceEvent = Schema.decodeUnknownSync(TaskWorkspaceEventSchema);
const isTaskWorkspaceError = Schema.is(TaskWorkspaceError);

const TASK_CONTRACT_VERSION = "task-workspace@0.2.0";
const ARTIFACT_CONTRACT_VERSION = "task-artifact@0.2.0";
const FIXTURE_FILE = "task-workspace-slice-1.txt";
const FIXTURE_CONTENT = "Kata Code Task Workspaces Slice 1 verified fixture.\n";
const BLOCK_BOUNDARY_WHITESPACE_PATTERN = /(?:\r?\n[ \t]*)+$/u;
type AutomatedCheckCommand = "fixture.pass" | "fixture.mismatch";
const AUTOMATED_CHECK_COMMANDS: ReadonlySet<AutomatedCheckCommand> = new Set([
  "fixture.pass",
  "fixture.mismatch",
]);

function automatedCheckCommandForLabel(label: string): AutomatedCheckCommand {
  if (AUTOMATED_CHECK_COMMANDS.has(label as AutomatedCheckCommand)) {
    return label as AutomatedCheckCommand;
  }
  throw new Error(
    `Automated Build check '${label}' is not allowlisted. Supported checks: fixture.pass, fixture.mismatch.`,
  );
}

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

/**
 * Semantic operation key for a command, or `null` for legacy commands that
 * predate operation receipts.
 */
function operationKeyFor(command: TaskWorkspaceCommand): string | null {
  switch (command.type) {
    case "task.create":
    case "task.stage.request-changes":
    case "task.worktree.policy.set":
    case "task.session.recover-primary":
    case "task.environment.repair":
    case "task.plan.approve":
    case "task.workflow.upgrade":
    case "task.implementation.start":
    case "task.implementation.check.run":
    case "task.implementation.amendment.propose":
    case "task.implementation.complete":
      return command.operationKey ?? null;
    default:
      return null;
  }
}

const TASK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function describeFailure(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message.slice(0, 2_000);
  return String(cause).slice(0, 2_000);
}

function validateTaskSlug(slug: string): void {
  if (slug.length === 0 || slug.length > 80) {
    throw new Error("The task slug must be between 1 and 80 characters.");
  }
  if (!TASK_SLUG_PATTERN.test(slug)) {
    throw new Error(
      "The task slug must use lowercase letters, digits, and single dashes, and must start and end with an alphanumeric character.",
    );
  }
}

/**
 * First-slice create validation. Runs before any task state is written; every
 * failure rejects the command before creation.
 */
function validateCreateV2(command: Extract<TaskWorkspaceCommand, { type: "task.create" }>): void {
  const brief = command.brief?.trim() ?? "";
  if (brief.length === 0) {
    throw new Error("A task brief is required.");
  }
  if (brief.length > TASK_BRIEF_MAX_CHARS) {
    throw new Error(`The task brief exceeds the ${TASK_BRIEF_MAX_CHARS}-character limit.`);
  }
  if (command.source === undefined || command.source.body !== brief) {
    throw new Error("The task source must match the brief.");
  }
  if (command.worktreePolicy === undefined) {
    throw new Error("A worktree policy is required.");
  }
  if (command.modelSelection === undefined) {
    throw new Error("A model selection is required.");
  }
  validateTaskSlug(command.taskId);
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
    if (ref.blockIds.length === 0) {
      // Whole-revision selection: an artifact revision with no `kata:block`
      // markers (e.g. DEFAULT_PLAN or a fixture E2E plan) still contributes
      // its full text so continuation sessions never link to an empty manifest.
      texts.push(revision.markdown);
      continue;
    }
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
  budget: number,
): string {
  const provenance = refs.flatMap((ref) =>
    ref.blockIds.length === 0
      ? [`${ref.kind}@${ref.revision} (whole revision)`]
      : ref.blockIds.map((blockId) => `${ref.kind}@${ref.revision}#${blockId}`),
  );
  const lines = [
    `Compressed ${blockTexts.length} block(s) for ${manifestId}: ${provenance.join(", ")}.`,
    "",
  ];
  let cursor = 0;
  for (const ref of refs) {
    lines.push(`## ${ref.kind} revision ${ref.revision}`, "");
    const blockIds = ref.blockIds.length === 0 ? ["(whole revision)"] : ref.blockIds;
    for (const blockId of blockIds) {
      const text = (blockTexts[cursor] ?? "").trim().replace(/\s+/gu, " ");
      cursor += 1;
      lines.push(`- \`${blockId}\`: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").slice(0, budget * 4);
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
  expectedCommitSha?: string,
  sourceWorkspaceRoot?: string,
): Effect.Effect<{
  readonly worktree: { readonly path: string; readonly refName: string };
} | null> {
  return Effect.tryPromise({
    try: async () => {
      await NodeFs.access(worktreePath);
      const branch = await execFileAsync(
        "git",
        ["-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD"],
        { encoding: "utf8" },
      );
      if (branch.stdout.trim() !== expectedRefName) return null;
      const head = await execFileAsync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
        encoding: "utf8",
      });
      const actualCommitSha = head.stdout.trim();
      if (expectedCommitSha !== undefined && actualCommitSha !== expectedCommitSha) return null;
      if (sourceWorkspaceRoot === undefined) return null;
      const registered = await execFileAsync(
        "git",
        ["-C", sourceWorkspaceRoot, "worktree", "list", "--porcelain"],
        { encoding: "utf8" },
      );
      const expectedPath = NodePath.resolve(worktreePath);
      const isRegistered = registered.stdout.split("\n\n").some((entry) => {
        const lines = entry.split("\n");
        return (
          lines.some((line) => line === `worktree ${expectedPath}`) &&
          lines.some((line) => line === `HEAD ${actualCommitSha}`) &&
          lines.some((line) => line === `branch refs/heads/${expectedRefName}`)
        );
      });
      if (!isRegistered) return null;
      const status = await execFileAsync("git", ["-C", worktreePath, "status", "--porcelain=v2"], {
        encoding: "utf8",
      });
      if (status.stdout.trim().length > 0) return null;
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

function latestPlanRevision(task: TaskWorkspace): TaskWorkspaceArtifactRevision | null {
  return latestArtifact(task, "plan");
}

/**
 * Convert the small, human-authored Plan shape used by the task workspace into
 * a durable Build projection. The parser is deliberately deterministic and
 * conservative: unsupported text remains part of the Plan artifact and does
 * not become executable task state.
 */
function buildFromPlan(task: TaskWorkspace): TaskWorkspace["build"] {
  const plan = latestPlanRevision(task);
  if (!plan) return task.build;

  // The current Guided definition uses the shared strict compiler. Historical
  // definitions retain their replay-compatible parser below.
  if (task.versions.workflowDefinition === "guided@0.3.0") {
    return compileTaskWorkspacePlan({ markdown: plan.markdown, planRevisionId: plan.id });
  }

  const phaseMatches = [...plan.markdown.matchAll(/^##\s+Phase\s+(.+)$/gim)];
  if (phaseMatches.length === 0) {
    return {
      ...task.build,
      currentPlanRevisionId: plan.id,
    };
  }

  const phases: TaskWorkspaceBuildPhase[] = [];
  const checks: TaskWorkspaceBuildCheck[] = [];
  for (let phaseIndex = 0; phaseIndex < phaseMatches.length; phaseIndex += 1) {
    const match = phaseMatches[phaseIndex]!;
    const phaseId = `phase-${phaseIndex + 1}`;
    const sectionStart = match.index ?? 0;
    const sectionEnd = phaseMatches[phaseIndex + 1]?.index ?? plan.markdown.length;
    const section = plan.markdown.slice(sectionStart, sectionEnd);
    const title = match[1]!.trim();
    const policyMatch = section.match(
      /^\s*(?:Checkpoint(?: policy)?|Policy):\s*(always|manual-only|on-failure|never)\s*$/im,
    );
    const checkpointPolicy = (policyMatch?.[1] ??
      "never") as TaskWorkspaceBuildPhase["checkpointPolicy"];
    const workMatches = [...section.matchAll(/^###\s+Work item\s+(.+)$/gim)];
    const workTitles =
      workMatches.length > 0 ? workMatches.map((workMatch) => workMatch[1]!.trim()) : ["Work"];
    const workItems = workTitles.map((title, workIndex) => ({
      id: `${phaseId === "phase-1" ? "work-item" : phaseId + "-work-item"}-${workIndex + 1}`,
      title,
      status: "pending" as const,
      summary: null,
      dependsOn: [] as string[],
      checkIds: [] as string[],
      invalidationReason: null,
    }));
    for (const [workIndex, workMatch] of workMatches.entries()) {
      const workStart = workMatch.index ?? 0;
      const workEnd = workMatches[workIndex + 1]?.index ?? section.length;
      const dependencyLine = section
        .slice(workStart, workEnd)
        .match(/^\s*(?:Depends on|Dependencies?):\s*(.+)$/im)?.[1];
      if (!dependencyLine) continue;
      const dependencyIds = dependencyLine
        .split(",")
        .map((dependency) => dependency.trim())
        .filter(Boolean)
        .map((dependency) => {
          const resolved = workItems.find(
            (candidate) => candidate.id === dependency || candidate.title === dependency,
          );
          if (!resolved) {
            throw new Error(
              `Work item '${workItems[workIndex]!.id}' depends on unknown work item '${dependency}'.`,
            );
          }
          if (resolved.id === workItems[workIndex]!.id) {
            throw new Error(`Work item '${resolved.id}' cannot depend on itself.`);
          }
          return resolved.id;
        });
      workItems[workIndex]!.dependsOn = dependencyIds;
    }
    const phaseChecks = [
      ...section.matchAll(/^\s*[-*]\s*(?:(Automated|Manual)\s+)?Check:\s*(.+)$/gim),
    ];
    const checkIds: string[] = [];
    for (const [checkIndex, checkMatch] of phaseChecks.entries()) {
      const checkKind = checkMatch[1]?.toLowerCase() === "manual" ? "manual" : "automated";
      const label = checkMatch[2]!.trim();
      const checkId = `${phaseId}-check-${checkIndex + 1}`;
      checkIds.push(checkId);
      const checkPosition = checkMatch.index ?? 0;
      const workItemIndex = workMatches.reduce(
        (ownerIndex, workMatch, index) =>
          (workMatch.index ?? 0) <= checkPosition ? index : ownerIndex,
        0,
      );
      const workItem = workItems[workItemIndex] ?? workItems[0];
      const command = checkKind === "manual" ? null : automatedCheckCommandForLabel(label);
      checks.push({
        id: checkId,
        phaseId,
        workItemId: workItem?.id ?? null,
        kind: checkKind,
        status: "pending",
        label,
        command,
        output: null,
        note: null,
        exitCode: null,
        commitSha: null,
        startedAt: null,
        completedAt: null,
        attemptIds: [],
      });
      if (workItem) workItem.checkIds.push(checkId);
    }
    phases.push({
      id: phaseId,
      title,
      status: "pending",
      workItems,
      checkpointPolicy,
      checkIds,
      checkpointId: null,
      phaseCommitSha: null,
      startedAt: null,
      completedAt: null,
    });
  }

  return {
    ...task.build,
    phases,
    resultingCommitSha: null,
    activePhaseId: null,
    activeWorkItemId: null,
    checks,
    checkpoints: task.build.checkpoints,
    amendments: task.build.amendments,
    currentPlanRevisionId: plan.id,
    amendmentGateId: task.build.amendmentGateId,
    continuationSessionIds: task.build.continuationSessionIds,
  };
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
  environmentId: EnvironmentId,
  source?: TaskWorkspaceSourceResolution,
  bootstrap?: TaskWorkspaceBootstrapState,
): TaskWorkspace {
  // Pin the definition the task will resolve for the rest of its life. Later
  // versions of the same preset are registered alongside, never in place, so a
  // task created today keeps its original workflow shape. First-slice creates
  // pin the current catalog version; legacy creates keep the @0.1.0 shape.
  const isFirstSliceCreate = command.operationKey !== undefined;
  const definition = resolveWorkflowDefinition(
    isFirstSliceCreate
      ? currentVersionForPreset(command.preset)
      : legacyVersionForPreset(command.preset),
  );
  const worktreePolicy = command.worktreePolicy ?? "later";
  const brief = command.brief?.trim() ?? command.title;
  const provisioningStatus =
    isFirstSliceCreate && worktreePolicy === "now" ? "pending" : "not-requested";
  return {
    id: command.taskId,
    environmentId,
    title: command.title,
    versions: {
      taskContract: isFirstSliceCreate
        ? TASK_WORKSPACE_CONTRACT_VERSION_0_3_0
        : TASK_CONTRACT_VERSION,
      artifactContract: isFirstSliceCreate
        ? TASK_ARTIFACT_CONTRACT_VERSION_0_3_0
        : ARTIFACT_CONTRACT_VERSION,
      workflowDefinition: definition.version,
      prompt: definition.promptBundleRef,
    },
    intake: {
      brief,
      source: { kind: "inline", body: brief },
    },
    preferences: {
      worktreePolicy,
      modelSelection: command.modelSelection ?? null,
      executionProfile: "planning",
    },
    bootstrap: bootstrap ?? null,
    occurrences: isFirstSliceCreate
      ? [
          {
            id: `occurrence-${definition.initialStage}-0`,
            stage: definition.initialStage,
            ordinal: 0,
            status: "starting" as const,
            sessionId: null,
            threadId: null,
            contextManifestId: null,
            artifactRevisionId: null,
            completionProposalId: null,
            gateOutcome: null,
            feedback: null,
            supersedesOccurrenceId: null,
            createdAt: command.createdAt,
            completedAt: null,
          },
        ]
      : [],
    planGate: null,
    gateHistory: [],
    taskRevision: 0,
    workspace: {
      repositories: [
        {
          id: "primary",
          projectId: command.projectId,
          workspaceRoot: source?.workspaceRoot ?? command.workspaceRoot ?? "",
          baseRef: command.baseRef,
          branch: null,
          worktreePath: null,
          provisioningStatus: isFirstSliceCreate ? provisioningStatus : "pending",
          baseCommitSha: source?.baseCommitSha ?? null,
          planningRootFingerprint: source?.planningRootFingerprint ?? null,
        },
      ],
    },
    workflowRuns: [
      {
        id: `${command.preset}-run-1`,
        preset: command.preset,
        definitionVersion: definition.version,
        promptBundleVersion: definition.promptBundleRef,
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
              dependsOn: [],
              checkIds: [],
              invalidationReason: null,
            },
          ],
          checkpointPolicy: "never",
          checkIds: [],
          checkpointId: null,
          phaseCommitSha: null,
          startedAt: null,
          completedAt: null,
        },
      ],
      resultingCommitSha: null,
      activePhaseId: null,
      activeWorkItemId: null,
      checks: [],
      checkpoints: [],
      amendments: [],
      checkAttempts: [],
      currentPlanRevisionId: null,
      amendmentGateId: null,
      continuationSessionIds: [],
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

function phaseForBuild(task: TaskWorkspace, phaseId: string): TaskWorkspaceBuildPhase {
  const phase = task.build.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) throw new Error(`Build phase '${phaseId}' was not found.`);
  return phase;
}

function workItemForBuild(
  phase: TaskWorkspaceBuildPhase,
  workItemId: string,
): TaskWorkspaceBuildPhase["workItems"][number] {
  const workItem = phase.workItems.find((candidate) => candidate.id === workItemId);
  if (!workItem) throw new Error(`Work item '${workItemId}' was not found.`);
  return workItem;
}

function checkForBuild(task: TaskWorkspace, checkId: string): TaskWorkspaceBuildCheck {
  const check = task.build.checks.find((candidate) => candidate.id === checkId);
  if (!check) throw new Error(`Build check '${checkId}' was not found.`);
  return check;
}

function requiredChecksPass(
  build: TaskWorkspace["build"],
  checkIds: ReadonlyArray<string>,
): boolean {
  return checkIds.every((checkId) =>
    build.checks.some((check) => check.id === checkId && check.status === "pass"),
  );
}

function checkpointReason(policy: TaskWorkspaceBuildPhase["checkpointPolicy"]): string {
  return policy === "on-failure" ? "A required Build check failed." : "Phase checkpoint reached.";
}

function appendCheckpoint(
  build: TaskWorkspace["build"],
  phase: TaskWorkspaceBuildPhase,
  now: string,
  reasonOverride?: string,
): TaskWorkspace["build"] {
  if (
    build.checkpoints.some(
      (checkpoint) => checkpoint.phaseId === phase.id && checkpoint.status === "waiting",
    )
  ) {
    return build;
  }
  const checkpoint: TaskWorkspaceBuildCheckpoint = {
    id: `checkpoint-${build.checkpoints.length + 1}`,
    phaseId: phase.id,
    reason: reasonOverride ?? checkpointReason(phase.checkpointPolicy),
    status: "waiting",
    checkIds: phase.checkIds,
    continuationSessionId: null,
    contextManifestId: null,
    createdAt: now,
    continuedAt: null,
  };
  return {
    ...build,
    checkpoints: [...build.checkpoints, checkpoint],
    phases: build.phases.map((candidate) =>
      candidate.id === phase.id ? { ...candidate, checkpointId: checkpoint.id } : candidate,
    ),
  };
}

function requirePredecessorPhasesComplete(build: TaskWorkspace["build"], phaseId: string): void {
  const phaseIndex = build.phases.findIndex((phase) => phase.id === phaseId);
  if (phaseIndex < 0) throw new Error(`Build phase '${phaseId}' was not found.`);
  if (build.phases.slice(0, phaseIndex).some((phase) => phase.status !== "completed")) {
    throw new Error(`Build phase '${phaseId}' has incomplete predecessor phases.`);
  }
}

function startNextPhase(build: TaskWorkspace["build"], completedPhaseId: string, now: string) {
  const completedPhase = build.phases.find((phase) => phase.id === completedPhaseId);
  if (!completedPhase || completedPhase.status !== "completed") {
    const resumableItem = completedPhase?.workItems.find(
      (item) =>
        item.status === "pending" || item.status === "blocked" || item.status === "invalidated",
    );
    return {
      ...build,
      activePhaseId: completedPhase?.id ?? null,
      activeWorkItemId: resumableItem?.id ?? null,
    };
  }
  const completedIndex = build.phases.findIndex((phase) => phase.id === completedPhaseId);
  const next = build.phases[completedIndex + 1];
  if (!next || next.status !== "pending") {
    return { ...build, activePhaseId: null, activeWorkItemId: null };
  }
  const firstPending = next.workItems.find((item) => item.status === "pending") ?? null;
  return {
    ...build,
    activePhaseId: next.id,
    activeWorkItemId: firstPending?.id ?? null,
    phases: build.phases.map((phase) =>
      phase.id === next.id
        ? { ...phase, status: "running" as const, startedAt: phase.startedAt ?? now }
        : phase,
    ),
  };
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

function planningRootFingerprint(cwd: string): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const headSha = yield* runGit(cwd, ["rev-parse", "HEAD"]);
    const statusPorcelain = yield* runGit(cwd, ["status", "--porcelain=v2"]);
    return createHash("sha256").update(`${headSha}\n${statusPorcelain}`).digest("hex");
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
  readonly implementationContext: (
    taskId: TaskWorkspaceId,
  ) => Effect.Effect<TaskImplementationContextResult, TaskWorkspaceError>;
  readonly implementationProgress: (input: {
    readonly taskId: TaskWorkspaceId;
    readonly expectedTaskRevision: number;
    readonly phaseId: string;
    readonly workItemId: string | null;
    readonly status: "running" | "completed" | "blocked";
    readonly summary: string;
  }) => Effect.Effect<TaskImplementationProgressAck, TaskWorkspaceError>;
  readonly implementationCheckRun: (input: {
    readonly taskId: TaskWorkspaceId;
    readonly expectedTaskRevision: number;
    readonly checkId: string;
    readonly operationKey: string;
  }) => Effect.Effect<TaskImplementationCheckRunAck, TaskWorkspaceError>;
  readonly implementationAmendmentPropose: (input: {
    readonly taskId: TaskWorkspaceId;
    readonly expectedTaskRevision: number;
    readonly phaseId: string;
    readonly workItemId: string;
    readonly triggeringCheckId: string | null;
    readonly expected: string;
    readonly found: string;
    readonly impact: string;
    readonly proposedPlanMarkdown: string;
    readonly operationKey: string;
  }) => Effect.Effect<TaskImplementationAmendmentAck, TaskWorkspaceError>;
  readonly implementationComplete: (input: {
    readonly taskId: TaskWorkspaceId;
    readonly expectedTaskRevision: number;
    readonly summary: string;
    readonly operationKey: string;
    readonly sessionId: string;
    readonly providerTurnId: string;
  }) => Effect.Effect<TaskImplementationCompleteAck, TaskWorkspaceError>;
  readonly getSnapshot: Effect.Effect<TaskWorkspaceSnapshot, never>;
  readonly getTask: (taskId: TaskWorkspaceId) => Effect.Effect<TaskWorkspace | null, never>;
  readonly streamEvents: Stream.Stream<TaskWorkspaceEventValue>;
  readonly subscribe: Effect.Effect<Stream.Stream<TaskWorkspaceStreamItem>, never, Scope.Scope>;
  /**
   * Server-owned bootstrap saga for one outbox row. Idempotent across retries
   * and restart; never allocates a second session or occurrence.
   */
  readonly processBootstrap: (
    entry: TaskWorkspaceOutboxEntry,
  ) => Effect.Effect<void, TaskWorkspaceError>;
  readonly processWorktree: (
    entry: TaskWorkspaceOutboxEntry,
  ) => Effect.Effect<void, TaskWorkspaceError>;
  /**
   * Persist a typed completion proposal for the active stage occurrence and
   * provider turn (the task-stage bridge entry point). One proposal per
   * occurrence and turn; a different payload on the same key conflicts.
   */
  readonly proposeStageCompletion: (input: {
    readonly taskId: TaskWorkspaceId;
    readonly sessionId: string;
    readonly providerTurnId: string;
    readonly payloadDigest: string;
    readonly summary: string;
    readonly markdown: string;
  }) => Effect.Effect<TaskWorkspace, TaskWorkspaceError>;
  /**
   * Settle a proposal once the provider turn reaches a terminal state.
   * Completed turns commit the artifact and handoff atomically; aborted or
   * failed turns reject the proposal and return the occurrence to Running.
   */
  readonly settleProposal: (input: {
    readonly taskId: TaskWorkspaceId;
    readonly occurrence: number;
    readonly providerTurnId: string;
    readonly outcome: "completed" | "aborted" | "failed";
  }) => Effect.Effect<TaskWorkspace, TaskWorkspaceError>;
  readonly settleProviderTurn: (input: {
    readonly threadId: ThreadId;
    readonly providerTurnId: string;
    readonly outcome: "completed" | "aborted" | "failed";
  }) => Effect.Effect<void, TaskWorkspaceError>;
  readonly reconcilePendingProposals: Effect.Effect<void, TaskWorkspaceError>;
  readonly validatePlanningRoot: (
    taskId: TaskWorkspaceId,
  ) => Effect.Effect<void, TaskWorkspaceError>;
  readonly validateProviderTurn: (input: {
    readonly threadId: ThreadId;
    readonly providerInstanceId: string;
  }) => Effect.Effect<void, TaskWorkspaceError>;
  readonly authorizeTaskStage: (input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly providerInstanceId: string;
  }) => Effect.Effect<void, TaskWorkspaceError>;
  readonly getActiveTaskStage: (
    threadId: ThreadId,
  ) => Effect.Effect<TaskWorkspaceStage | undefined>;
  readonly isTaskThread: (threadId: ThreadId) => Effect.Effect<boolean>;
}

export class TaskWorkspaceService extends Context.Service<
  TaskWorkspaceService,
  TaskWorkspaceServiceShape
>()("@kata-sh/code-cli/taskWorkspace/TaskWorkspaceService") {}

let activeTaskWorkspaceService: TaskWorkspaceServiceShape | undefined;

export const validateActiveTaskTurn = (input: {
  readonly threadId: ThreadId;
  readonly providerInstanceId: string;
}): Effect.Effect<void, TaskWorkspaceError> =>
  activeTaskWorkspaceService ? activeTaskWorkspaceService.validateProviderTurn(input) : Effect.void;

export const isActiveTaskThread = (threadId: ThreadId): Effect.Effect<boolean> =>
  activeTaskWorkspaceService
    ? activeTaskWorkspaceService.isTaskThread(threadId)
    : Effect.succeed(false);

export const activeTaskStageForThread = (
  threadId: ThreadId,
): Effect.Effect<TaskWorkspaceStage | undefined> =>
  activeTaskWorkspaceService
    ? activeTaskWorkspaceService.getActiveTaskStage(threadId)
    : Effect.succeed(undefined);

export const authorizeActiveTaskImplementation = (input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerInstanceId: string;
}): Effect.Effect<boolean> =>
  activeTaskWorkspaceService
    ? activeTaskWorkspaceService.authorizeTaskStage(input).pipe(
        Effect.flatMap(() => activeTaskWorkspaceService!.getActiveTaskStage(input.threadId)),
        Effect.map((stage) => stage === "build"),
        Effect.catch(() => Effect.succeed(false)),
      )
    : Effect.succeed(false);

export const authorizeActiveTaskStage = (input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerInstanceId: string;
}): Effect.Effect<boolean> =>
  activeTaskWorkspaceService
    ? activeTaskWorkspaceService.authorizeTaskStage(input).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      )
    : Effect.succeed(false);

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const gitWorkflow = yield* GitWorkflowService;
  const crypto = yield* Crypto.Crypto;
  const store = yield* TaskWorkspaceStore;
  const sourceResolver = yield* TaskWorkspaceSourceResolver;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerInstanceRegistry = yield* Effect.serviceOption(ProviderInstanceRegistry);
  const serverEnvironment = yield* ServerEnvironment;
  const environmentId = yield* serverEnvironment.getEnvironmentId;
  const semaphore = yield* Semaphore.make(1);
  const eventPubSub = yield* PubSub.unbounded<TaskWorkspaceEventValue>();
  const eventLogPath = NodePath.join(config.stateDir, "task-workspace-events.ndjson");
  const serverNow = DateTime.now.pipe(
    Effect.mapError(
      (cause) =>
        new TaskWorkspaceError({
          message: "Failed to read server time.",
          commandType: "task.internal",
          cause,
        }),
    ),
    Effect.map(DateTime.formatIso),
  );
  const serverUuid = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new TaskWorkspaceError({
          message: "Failed to generate a server identifier.",
          commandType: "task.internal",
          cause,
        }),
    ),
  );

  // One-time transactional NDJSON import. The legacy file is retained read-only
  // after a successful import; the store's marker row makes the import idempotent.
  const legacyEvents = yield* readPersistedEvents(eventLogPath).pipe(
    Effect.mapError(
      (cause) =>
        new TaskWorkspaceError({
          message:
            "The legacy task workspace event log contains a record that cannot be decoded. Repair the record or remove the file before starting the server.",
          commandType: "task.replay",
          cause,
        }),
    ),
  );
  if (legacyEvents.length > 0) {
    const imported = deriveImportedEvents(
      legacyEvents,
      environmentId,
      DateTime.formatIso(yield* DateTime.now),
    );
    yield* store
      .importLegacy({
        environmentId,
        events: imported.events,
        migratedEvents: imported.migratedEvents,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new TaskWorkspaceError({
              message: "Failed to import the legacy task workspace event log.",
              commandType: "task.replay",
              cause,
            }),
        ),
      );
  }

  const persistedEvents = yield* store.replayAll().pipe(
    Effect.mapError(
      (cause) =>
        new TaskWorkspaceError({
          message: "Failed to replay the task workspace event store.",
          commandType: "task.replay",
          cause,
        }),
    ),
  );

  let sequence = 0;
  const taskById = new Map<TaskWorkspaceId, TaskWorkspace>();
  const receiptByCommandId = new Map<
    CommandId,
    { readonly sequence: number; readonly task: TaskWorkspace }
  >();
  for (const event of persistedEvents) {
    sequence = Math.max(sequence, event.sequence);
    taskById.set(event.taskId, event.task);
    receiptByCommandId.set(event.commandId, { sequence: event.sequence, task: event.task });
  }

  const settleProviderTurn: TaskWorkspaceServiceShape["settleProviderTurn"] = (input) =>
    Effect.gen(function* () {
      const current = [...taskById.values()].find((candidate) => {
        const run = candidate.workflowRuns.at(-1);
        if (!run) return false;
        const occurrence = candidate.occurrences
          .filter((entry) => entry.stage === run.currentStage)
          .toSorted((left, right) => right.ordinal - left.ordinal)[0];
        return occurrence?.threadId === input.threadId && occurrence.status === "finalizing";
      });
      if (!current) return;
      yield* settleProposal({
        taskId: current.id,
        occurrence: current.occurrences
          .filter((entry) => entry.threadId === input.threadId)
          .toSorted((left, right) => right.ordinal - left.ordinal)[0]!.ordinal,
        providerTurnId: input.providerTurnId,
        outcome: input.outcome,
      }).pipe(
        Effect.catch((cause) =>
          cause.message.includes("No proposal exists") ? Effect.void : Effect.fail(cause),
        ),
        Effect.asVoid,
      );
    });

  const validatePlanningRoot: TaskWorkspaceServiceShape["validatePlanningRoot"] = (taskId) =>
    Effect.gen(function* () {
      const task = taskById.get(taskId);
      if (!task) {
        return yield* new TaskWorkspaceError({
          message: `Task '${taskId}' was not found.`,
          commandType: "task.internal",
          taskId,
        });
      }
      const repository = task.workspace.repositories[0];
      if (!repository || repository.planningRootFingerprint === null) return;
      const planningRoot = repository.worktreePath ?? repository.workspaceRoot;
      const fingerprint = yield* planningRootFingerprint(planningRoot).pipe(
        Effect.mapError(
          (cause) =>
            new TaskWorkspaceError({
              message: "Failed to inspect the planning root.",
              commandType: "task.internal",
              taskId,
              cause,
            }),
        ),
      );
      if (fingerprint !== repository.planningRootFingerprint) {
        return yield* new TaskWorkspaceError({
          message:
            "The planning root drifted since creation; restore the pinned source state before continuing.",
          commandType: "task.internal",
          taskId,
        });
      }
    });

  const isTaskThread: TaskWorkspaceServiceShape["isTaskThread"] = (threadId) =>
    Effect.sync(() =>
      [...taskById.values()].some(
        (task) =>
          task.bootstrap?.reservedThreadId === threadId ||
          task.occurrences.some((occurrence) => occurrence.threadId === threadId),
      ),
    );

  const getActiveTaskStage: TaskWorkspaceServiceShape["getActiveTaskStage"] = (threadId) =>
    Effect.sync(() => {
      for (const task of taskById.values()) {
        const run = task.workflowRuns.at(-1);
        if (!run || run.preset !== "guided") {
          continue;
        }
        const occurrence = task.occurrences
          .filter((candidate) => candidate.stage === run.currentStage)
          .toSorted((left, right) => right.ordinal - left.ordinal)[0];
        const isBootstrapThread =
          task.bootstrap?.status === "running" && task.bootstrap.reservedThreadId === threadId;
        const isActiveOccurrence =
          occurrence?.threadId === threadId &&
          (occurrence.status === "starting" ||
            occurrence.status === "running" ||
            occurrence.status === "finalizing");
        if (isBootstrapThread || isActiveOccurrence) {
          return run.currentStage;
        }
      }
      return undefined;
    });

  const authorizeTaskStage: TaskWorkspaceServiceShape["authorizeTaskStage"] = (input) =>
    Effect.gen(function* () {
      const task = [...taskById.values()].find(
        (candidate) =>
          candidate.environmentId === input.environmentId &&
          (candidate.bootstrap?.reservedThreadId === input.threadId ||
            candidate.occurrences.some((occurrence) => occurrence.threadId === input.threadId)),
      );
      if (!task) {
        return yield* new TaskWorkspaceError({
          message: "No matching task-stage session exists.",
          commandType: "task.internal",
          taskId: "unknown",
        });
      }
      const run = currentRun(task);
      if (run.preset !== "guided") {
        return yield* new TaskWorkspaceError({
          message: `Task '${task.id}' does not use the Guided workflow.`,
          commandType: "task.internal",
          taskId: task.id,
        });
      }
      if (task.preferences.modelSelection?.instanceId !== input.providerInstanceId) {
        return yield* new TaskWorkspaceError({
          message: `Provider instance '${input.providerInstanceId}' is not authorized for task '${task.id}'.`,
          commandType: "task.internal",
          taskId: task.id,
        });
      }
      if (Option.isSome(providerInstanceRegistry)) {
        const providerInstance = yield* providerInstanceRegistry.value.getInstance(
          ProviderInstanceId.make(input.providerInstanceId),
        );
        if (
          !providerInstance ||
          !providerInstance.enabled ||
          providerInstance.adapter.capabilities.supportsTaskStage !== true
        ) {
          return yield* new TaskWorkspaceError({
            message: `Provider instance '${input.providerInstanceId}' is not task-stage capable.`,
            commandType: "task.internal",
            taskId: task.id,
          });
        }
      }
      const occurrence = task.occurrences
        .filter((candidate) => candidate.stage === run.currentStage)
        .toSorted((left, right) => right.ordinal - left.ordinal)[0];
      const reservedThreadId = task.bootstrap?.reservedThreadId;
      const isBootstrapPrimary =
        occurrence?.status === "starting" &&
        task.bootstrap?.status === "running" &&
        reservedThreadId === input.threadId;
      const isActivePrimary =
        (occurrence?.status === "running" || occurrence?.status === "finalizing") &&
        occurrence.threadId === input.threadId &&
        occurrence.sessionId !== null &&
        task.sessions.some(
          (session) =>
            session.id === occurrence.sessionId &&
            session.role === "primary" &&
            session.status === "active",
        );
      if (!isBootstrapPrimary && !isActivePrimary) {
        return yield* new TaskWorkspaceError({
          message: `Thread '${input.threadId}' is not the active task primary.`,
          commandType: "task.internal",
          taskId: task.id,
        });
      }
      yield* validatePlanningRoot(task.id);
    });

  const validateProviderTurn: TaskWorkspaceServiceShape["validateProviderTurn"] = (input) =>
    Effect.gen(function* () {
      const task = [...taskById.values()].find(
        (candidate) =>
          candidate.bootstrap?.reservedThreadId === input.threadId ||
          candidate.occurrences.some((occurrence) => occurrence.threadId === input.threadId),
      );
      if (!task) return;
      const run = currentRun(task);
      const occurrence = task.occurrences
        .filter((candidate) => candidate.stage === run.currentStage)
        .toSorted((left, right) => right.ordinal - left.ordinal)[0];
      const reservedThreadId = task.bootstrap?.reservedThreadId;
      if (
        !occurrence ||
        (occurrence.threadId !== input.threadId && reservedThreadId !== input.threadId)
      ) {
        return;
      }
      if (task.preferences.modelSelection?.instanceId !== input.providerInstanceId) {
        return yield* new TaskWorkspaceError({
          message: `Provider instance '${input.providerInstanceId}' is not authorized for task '${task.id}'.`,
          commandType: "task.internal",
          taskId: task.id,
        });
      }
      if (occurrence.status === "starting" && reservedThreadId === input.threadId) {
        // The deterministic bootstrap kickoff is the one provider turn that
        // precedes the durable Ready transition.
        yield* validatePlanningRoot(task.id);
        return;
      }
      if (occurrence.status !== "running" && occurrence.status !== "finalizing") {
        return yield* new TaskWorkspaceError({
          message: `Task session for '${input.threadId}' is not accepting turns in state '${occurrence.status}'.`,
          commandType: "task.internal",
          taskId: task.id,
        });
      }
      if (!occurrence.sessionId) {
        return yield* new TaskWorkspaceError({
          message: `Task session for '${input.threadId}' is not ready.`,
          commandType: "task.internal",
          taskId: task.id,
        });
      }
      const session = task.sessions.find((candidate) => candidate.id === occurrence.sessionId);
      if (!session || session.role !== "primary" || session.status !== "active") {
        return yield* new TaskWorkspaceError({
          message: `Task session for '${input.threadId}' is no longer active.`,
          commandType: "task.internal",
          taskId: task.id,
        });
      }
      yield* validatePlanningRoot(task.id);
    });

  const makeOperationReceipt = (
    command: TaskWorkspaceCommand,
    input: {
      readonly operationType: string;
      readonly operationKey: string;
      readonly payloadDigest: string;
      readonly status: "pending" | "completed" | "failed";
      readonly attemptCount: number;
      readonly sourceCommandIds: ReadonlyArray<CommandId>;
      readonly error?: string | null;
    },
    now: string,
  ): TaskWorkspaceOperationReceipt => ({
    environmentId,
    taskId: command.taskId,
    operationType: input.operationType,
    operationKey: input.operationKey,
    payloadDigest: input.payloadDigest,
    status: input.status,
    attemptCount: input.attemptCount,
    sourceCommandIds: [...input.sourceCommandIds],
    resultEventId: null,
    resultTaskRevision: null,
    error: input.error ?? null,
    createdAt: now,
    updatedAt: now,
  });

  /**
   * Allocate deterministic bootstrap identities for a first-slice create.
   * The reserved session, thread, command, and message ids are persisted with
   * the create in one transaction so a restart worker reconciles the same
   * targets.
   */
  const allocateBootstrapState = (
    command: Extract<TaskWorkspaceCommand, { type: "task.create" }>,
    workspaceRoot: string | undefined,
  ) =>
    Effect.gen(function* () {
      const stage = "questions" as const;
      const occurrence = 0;
      const operationKey = `${command.taskId}:bootstrap:${stage}:${occurrence}:primary`;
      const sessionId = `${command.taskId}-session-${stage}-${occurrence}`;
      const threadId = ThreadId.make(`thread-task-${yield* serverUuid}`);
      const threadCreateCommandId = CommandId.make(
        `server:task-thread-create:${yield* serverUuid}`,
      );
      const turnStartCommandId = CommandId.make(`server:task-turn-start:${yield* serverUuid}`);
      const kickoffMessageId = MessageId.make(`message-task-${yield* serverUuid}`);
      const now = yield* serverNow;
      const branch =
        command.worktreePolicy === "now" && workspaceRoot
          ? `katacode/task-${safeBranchSegment(command.taskId)}`
          : null;
      const worktreePath =
        branch && workspaceRoot
          ? expectedTaskWorktreePath(config.worktreesDir, workspaceRoot, branch)
          : null;
      const bootstrap: TaskWorkspaceBootstrapState = {
        operationKey,
        executionProfile: "planning",
        presentation: "stage",
        status: "pending",
        currentStep: null,
        reservedSessionId: sessionId,
        reservedThreadId: threadId,
        threadCreateCommandId,
        turnStartCommandId,
        kickoffMessageId,
        conversationTarget: null,
        attemptCount: 0,
        failure: null,
        updatedAt: now,
      };
      const outboxPayload: TaskWorkspaceBootstrapOutboxPayload = {
        stage,
        occurrence,
        executionProfile: "planning",
        presentation: "stage",
        sessionId,
        threadId,
        threadCreateCommandId,
        turnStartCommandId,
        kickoffMessageId,
        trustedInstructions: trustedStageInstructions(stage),
        worktreeBranch: branch,
        worktreePath,
      };
      return { bootstrap, outboxPayload, operationKey };
    });

  const append = (
    command: TaskWorkspaceCommand,
    task: TaskWorkspace,
    input?: {
      readonly eventType?: TaskWorkspaceEventValue["type"];
      readonly operationReceipt?: TaskWorkspaceOperationReceipt;
      readonly proposal?: TaskWorkspaceCompletionProposal;
      readonly outbox?: ReadonlyArray<{
        readonly target: TaskWorkspaceOutboxEntry["target"];
        readonly operationKey: string;
        readonly payload: unknown;
        readonly status?: TaskWorkspaceOutboxEntry["status"];
      }>;
    },
  ) =>
    Effect.gen(function* () {
      const eventId = yield* crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) =>
          taskError(command, "Failed to generate a task event identifier.", cause),
        ),
      );
      const now = DateTime.formatIso(yield* DateTime.now);
      const nextRevision = (taskById.get(command.taskId)?.taskRevision ?? 0) + 1;
      const taskWithRevision: TaskWorkspace = { ...task, taskRevision: nextRevision };
      const event: TaskWorkspaceEventValue = {
        sequence: 0,
        eventId,
        commandId: command.commandId,
        taskId: command.taskId,
        type: input?.eventType ?? command.type,
        occurredAt: command.createdAt,
        task: taskWithRevision,
      };
      const operationReceipt = input?.operationReceipt
        ? {
            ...input.operationReceipt,
            resultEventId: eventId,
            resultTaskRevision: nextRevision,
            updatedAt: now,
          }
        : undefined;
      const outbox = input?.outbox?.map(
        (entry): TaskWorkspaceOutboxEntry => ({
          id: `outbox-${eventId}-${entry.operationKey.slice(-12)}`,
          environmentId,
          taskId: command.taskId,
          operationKey: entry.operationKey,
          target: entry.target,
          status: entry.status ?? "pending",
          payload: entry.payload,
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        }),
      );
      const stored = yield* store
        .commit({
          environmentId,
          events: [event],
          commandReceipt: {
            environmentId,
            commandId: command.commandId,
            taskId: command.taskId,
            commandType: command.type,
            commandDigest: canonicalTaskCommandDigest(command),
            operationKey: operationKeyFor(command),
            status: "accepted",
            resultEventId: eventId,
            error: null,
            createdAt: command.createdAt,
          },
          ...(operationReceipt ? { operationReceipt } : {}),
          ...(input?.proposal ? { proposal: input.proposal } : {}),
          ...(outbox && outbox.length > 0 ? { outbox } : {}),
        })
        .pipe(
          Effect.mapError((cause) => taskError(command, "Failed to persist task event.", cause)),
        );
      const storedEvent = stored[0]!;
      sequence = storedEvent.sequence;
      taskById.set(command.taskId, taskWithRevision);
      const result: TaskWorkspaceDispatchResult = {
        sequence: storedEvent.sequence,
        task: taskWithRevision,
        operation: operationReceipt
          ? {
              key: operationReceipt.operationKey,
              status:
                operationReceipt.status === "completed"
                  ? "completed"
                  : operationReceipt.status === "failed"
                    ? "failed"
                    : "pending",
              attempt: operationReceipt.attemptCount,
              error: operationReceipt.error,
            }
          : { key: command.type, status: "completed", attempt: 0, error: null },
        taskRoute: { environmentId, taskId: taskWithRevision.id },
        conversationTarget: taskWithRevision.bootstrap?.conversationTarget ?? null,
      };
      receiptByCommandId.set(command.commandId, {
        sequence: result.sequence,
        task: taskWithRevision,
      });
      yield* PubSub.publish(eventPubSub, storedEvent);
      return result;
    });

  /**
   * Server-owned lifecycle append. Event type is independent from command
   * type: one semantic operation may emit requested, step-completed, ready, or
   * failed lifecycle events without a client command receipt.
   */
  const internalAppend = (
    eventType: TaskWorkspaceEventValue["type"],
    task: TaskWorkspace,
    input?: {
      readonly operationReceipt?: TaskWorkspaceOperationReceipt;
      readonly proposal?: TaskWorkspaceCompletionProposal;
      readonly outbox?: ReadonlyArray<{
        readonly target: TaskWorkspaceOutboxEntry["target"];
        readonly operationKey: string;
        readonly payload: unknown;
        readonly status?: TaskWorkspaceOutboxEntry["status"];
      }>;
      readonly occurredAt?: string;
    },
  ) =>
    Effect.gen(function* () {
      const eventId = yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(
          (cause) =>
            new TaskWorkspaceError({
              message: "Failed to generate a task event identifier.",
              commandType: "task.internal",
              taskId: task.id,
              cause,
            }),
        ),
      );
      const now = input?.occurredAt ?? (yield* serverNow);
      const commandId = CommandId.make(`server:task:${eventId}`);
      const nextRevision = (taskById.get(task.id)?.taskRevision ?? 0) + 1;
      const taskWithRevision: TaskWorkspace = { ...task, taskRevision: nextRevision };
      const event: TaskWorkspaceEventValue = {
        sequence: 0,
        eventId,
        commandId,
        taskId: task.id,
        type: eventType,
        occurredAt: now,
        task: taskWithRevision,
      };
      const operationReceipt = input?.operationReceipt
        ? {
            ...input.operationReceipt,
            resultEventId: eventId,
            resultTaskRevision: nextRevision,
            updatedAt: now,
          }
        : undefined;
      const outbox = input?.outbox?.map(
        (entry): TaskWorkspaceOutboxEntry => ({
          id: `outbox-${eventId}-${entry.operationKey.slice(-12)}`,
          environmentId,
          taskId: task.id,
          operationKey: entry.operationKey,
          target: entry.target,
          status: entry.status ?? "pending",
          payload: entry.payload,
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        }),
      );
      const stored = yield* store
        .commit({
          environmentId,
          events: [event],
          ...(operationReceipt ? { operationReceipt } : {}),
          ...(input?.proposal ? { proposal: input.proposal } : {}),
          ...(outbox && outbox.length > 0 ? { outbox } : {}),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TaskWorkspaceError({
                message: "Failed to persist task event.",
                commandType: "task.internal",
                taskId: task.id,
                cause,
              }),
          ),
        );
      const storedEvent = stored[0]!;
      sequence = storedEvent.sequence;
      taskById.set(task.id, taskWithRevision);
      yield* PubSub.publish(eventPubSub, storedEvent);
      return taskWithRevision;
    });

  const dispatchUnlocked = Effect.fn("TaskWorkspaceService.dispatch")(function* (
    command: TaskWorkspaceCommand,
  ) {
    const commandDigest = canonicalTaskCommandDigest(command);
    const storedReceipt = yield* store
      .getCommandReceipt({ environmentId, commandId: command.commandId })
      .pipe(
        Effect.mapError((cause) =>
          taskError(command, "Failed to read the command receipt.", cause),
        ),
      );
    if (Option.isSome(storedReceipt)) {
      const receipt = storedReceipt.value;
      if (receipt.commandDigest !== commandDigest) {
        return yield* taskError(
          command,
          `Command '${command.commandId}' was already used with a different payload.`,
        );
      }
      if (receipt.status === "rejected") {
        return yield* taskError(
          command,
          receipt.error ?? `Command '${command.commandId}' was rejected earlier.`,
        );
      }
      const prior = receiptByCommandId.get(command.commandId);
      const currentTask = taskById.get(command.taskId) ?? prior?.task;
      if (!currentTask) {
        return yield* taskError(command, `Task '${command.taskId}' was not found.`);
      }
      // The immutable outcome for a replayed retry reflects the reopened target
      // operation, so a replayed retry never reports a stale attempt count.
      const retryKey = command.type === "task.operation.retry" ? command.targetOperationKey : null;
      const operationKey = receipt.operationKey ?? retryKey;
      const targetReceipt = operationKey
        ? yield* store
            .getOperationReceipt({ environmentId, taskId: command.taskId, operationKey })
            .pipe(
              Effect.mapError((cause) =>
                taskError(command, "Failed to read the operation receipt.", cause),
              ),
            )
        : Option.none();
      const target = Option.isSome(targetReceipt) ? targetReceipt.value : null;
      return {
        sequence: prior?.sequence ?? sequence,
        task: currentTask,
        operation:
          operationKey && target
            ? {
                key: operationKey,
                status: target.status as TaskWorkspaceDispatchOperationStatus,
                attempt: target.attemptCount,
                error: target.error,
              }
            : {
                key: operationKey ?? command.type,
                status: "completed" as const,
                attempt: 0,
                error: null,
              },
        taskRoute: { environmentId, taskId: command.taskId },
        conversationTarget: currentTask.bootstrap?.conversationTarget ?? null,
      };
    }

    const operationKey = operationKeyFor(command);
    if (operationKey !== null && command.type !== "task.operation.retry") {
      const priorOperation = yield* store
        .getOperationReceipt({ environmentId, taskId: command.taskId, operationKey })
        .pipe(
          Effect.mapError((cause) =>
            taskError(command, "Failed to read the operation receipt.", cause),
          ),
        );
      if (Option.isSome(priorOperation)) {
        const prior = priorOperation.value;
        if (prior.payloadDigest !== commandDigest) {
          return yield* taskError(
            command,
            `Operation '${operationKey}' was already used with a different payload.`,
          );
        }
        const currentTask = taskById.get(command.taskId);
        if (currentTask === undefined) {
          return yield* taskError(command, `Task '${command.taskId}' was not found.`);
        }
        if (prior.status === "completed") {
          return {
            sequence,
            task: currentTask,
            operation: {
              key: operationKey,
              status: "completed" as const,
              attempt: prior.attemptCount,
              error: prior.error,
            },
            taskRoute: { environmentId, taskId: command.taskId },
            conversationTarget: currentTask.bootstrap?.conversationTarget ?? null,
          };
        }
        if (prior.status === "pending") {
          return {
            sequence,
            task: currentTask,
            operation: {
              key: operationKey,
              status: "pending" as const,
              attempt: prior.attemptCount,
              error: prior.error,
            },
            taskRoute: { environmentId, taskId: command.taskId },
            conversationTarget: currentTask.bootstrap?.conversationTarget ?? null,
          };
        }
        return yield* taskError(
          command,
          `Operation '${operationKey}' failed and requires 'task.operation.retry'.`,
        );
      }
    }

    try {
      if (command.type === "task.create") {
        if (taskById.has(command.taskId)) {
          return yield* taskError(command, `Task '${command.taskId}' already exists.`);
        }
        if (command.operationKey !== undefined) {
          validateCreateV2(command);
          if (command.preset === "guided" && Option.isSome(providerInstanceRegistry)) {
            const providerInstance = yield* providerInstanceRegistry.value.getInstance(
              command.modelSelection!.instanceId,
            );
            if (
              !providerInstance ||
              !providerInstance.enabled ||
              providerInstance.adapter.capabilities.supportsTaskStage !== true
            ) {
              return yield* taskError(
                command,
                "Guided requires an enabled provider with task-stage tools, trusted instructions, and completion transport.",
              );
            }
          }
        }
        const source =
          command.operationKey !== undefined
            ? yield* sourceResolver
                .resolve({
                  projectId: command.projectId,
                  baseRef: command.baseRef,
                  worktreePolicy: command.worktreePolicy ?? "later",
                })
                .pipe(Effect.mapError((cause) => taskError(command, cause.message, cause)))
            : undefined;
        const bootstrapState =
          command.operationKey !== undefined
            ? yield* allocateBootstrapState(command, source?.workspaceRoot)
            : null;
        const operationReceipt =
          command.operationKey !== undefined
            ? makeOperationReceipt(
                command,
                {
                  operationType: "task.create",
                  operationKey: command.operationKey,
                  payloadDigest: commandDigest,
                  status: "completed",
                  attemptCount: 1,
                  sourceCommandIds: [command.commandId],
                },
                command.createdAt,
              )
            : undefined;
        return yield* append(
          command,
          initialTask(command, environmentId, source, bootstrapState?.bootstrap),
          {
            ...(operationReceipt ? { operationReceipt } : {}),
            ...(bootstrapState
              ? {
                  outbox: [
                    {
                      target: "bootstrap" as const,
                      operationKey: bootstrapState.operationKey,
                      payload: bootstrapState.outboxPayload,
                    },
                  ],
                }
              : {}),
          },
        );
      }

      const task = taskById.get(command.taskId);
      if (!task) {
        return yield* taskError(command, `Task '${command.taskId}' was not found.`);
      }
      const firstSliceGuided =
        task.versions.taskContract === TASK_WORKSPACE_CONTRACT_VERSION_0_3_0 &&
        definitionFor(task).availableInFirstSlice === true;
      if (
        firstSliceGuided &&
        [
          "task.artifact.upsert",
          "task.context-manifest.create",
          "task.session.link",
          "task.session.fork",
          "task.questions.complete",
          "task.research.complete",
          "task.design.complete",
          "task.stage.start",
        ].includes(command.type)
      ) {
        return yield* taskError(
          command,
          "Guided stage work is server-owned; use the task-stage bridge from the active conversation.",
        );
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
          const checkpoint = command.checkpointId
            ? task.build.checkpoints.find((candidate) => candidate.id === command.checkpointId)
            : null;
          if (command.checkpointId && !checkpoint) {
            throw new Error(`Checkpoint '${command.checkpointId}' was not found.`);
          }
          if (checkpoint && checkpoint.status !== "waiting") {
            throw new Error(`Checkpoint '${checkpoint?.id}' is not waiting for context.`);
          }
          if (checkpoint) {
            const plan = latestPlanRevision(task);
            if (
              plan &&
              !command.artifactRefs.some(
                (ref) => ref.kind === "plan" && ref.revision === plan.revision,
              )
            ) {
              throw new Error(
                `Checkpoint '${checkpoint.id}' context must include the approved Plan revision.`,
              );
            }
          }
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
                markdown: summaryMarkdown(
                  manifestId,
                  command.artifactRefs,
                  blockTexts,
                  budget ?? 0,
                ),
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
            build: checkpoint
              ? {
                  ...task.build,
                  checkpoints: task.build.checkpoints.map((candidate) =>
                    candidate.id === checkpoint.id
                      ? { ...candidate, contextManifestId: manifestId }
                      : candidate,
                  ),
                }
              : task.build,
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
        case "task.operation.retry": {
          // Reopen a failed operation receipt for retry. Carries the latest
          // expected revision and never creates a second semantic operation.
          const taskForRetry = taskById.get(command.taskId);
          if (!taskForRetry) {
            return yield* taskError(command, `Task '${command.taskId}' was not found.`);
          }
          if (command.expectedTaskRevision !== taskForRetry.taskRevision) {
            return yield* taskError(
              command,
              `Task revision ${taskForRetry.taskRevision} does not match the expected revision ${command.expectedTaskRevision}.`,
            );
          }
          const priorOperation = yield* store
            .getOperationReceipt({
              environmentId,
              taskId: command.taskId,
              operationKey: command.targetOperationKey,
            })
            .pipe(
              Effect.mapError((cause) =>
                taskError(command, "Failed to read the operation receipt.", cause),
              ),
            );
          if (Option.isNone(priorOperation)) {
            return yield* taskError(
              command,
              `Operation '${command.targetOperationKey}' has no receipt to retry.`,
            );
          }
          const target = priorOperation.value;
          if (target.status !== "failed") {
            return yield* taskError(
              command,
              `Operation '${command.targetOperationKey}' is '${target.status}' and cannot be retried.`,
            );
          }
          const priorOutbox = yield* store
            .getOutboxByOperationKey({
              environmentId,
              taskId: command.taskId,
              operationKey: command.targetOperationKey,
            })
            .pipe(
              Effect.mapError((cause) =>
                taskError(command, "Failed to read the outbox row.", cause),
              ),
            );
          const now = yield* serverNow;
          const retriedReceipt: TaskWorkspaceOperationReceipt = {
            ...target,
            status: "pending",
            attemptCount: target.attemptCount + 1,
            sourceCommandIds: [...target.sourceCommandIds, command.commandId],
            error: null,
            updatedAt: now,
          };
          const reopenedTask: TaskWorkspace =
            Option.isSome(priorOutbox) && priorOutbox.value.target === "worktree"
              ? {
                  ...taskForRetry,
                  workspace: {
                    repositories: taskForRetry.workspace.repositories.map((repository) =>
                      repository.id === "primary"
                        ? { ...repository, provisioningStatus: "pending" as const }
                        : repository,
                    ),
                  },
                }
              : taskForRetry.bootstrap
                ? {
                    ...taskForRetry,
                    bootstrap: {
                      ...taskForRetry.bootstrap,
                      status: "pending",
                      currentStep: null,
                      failure: null,
                      attemptCount: taskForRetry.bootstrap.attemptCount + 1,
                      updatedAt: now,
                    },
                  }
                : taskForRetry;
          return yield* append(command, reopenedTask, {
            operationReceipt: retriedReceipt,
            ...(Option.isSome(priorOutbox)
              ? {
                  outbox: [
                    {
                      target: priorOutbox.value.target,
                      operationKey: priorOutbox.value.operationKey,
                      payload: priorOutbox.value.payload,
                      status: "pending" as const,
                    },
                  ],
                }
              : {}),
          });
        }
        case "task.workflow.upgrade": {
          const run = currentRun(task);
          if (
            command.sourceVersion !== "guided@0.2.0" ||
            command.targetVersion !== "guided@0.3.0"
          ) {
            throw new Error("Only the guided@0.2.0 to guided@0.3.0 upgrade is supported.");
          }
          if (run.definitionVersion !== command.sourceVersion) {
            throw new Error(
              `Task workflow is '${run.definitionVersion}', not '${command.sourceVersion}'.`,
            );
          }
          if (command.expectedTaskRevision !== task.taskRevision) {
            throw new Error(
              `Task revision ${task.taskRevision} does not match the expected revision ${command.expectedTaskRevision}.`,
            );
          }
          const gate = task.gateHistory.at(-1);
          const planOccurrence = latestOccurrence(task, "plan");
          const plan = latestPlanRevision(task);
          if (
            !gate ||
            gate.outcome !== "approved" ||
            !planOccurrence ||
            planOccurrence.status !== "completed" ||
            gate.occurrence !== planOccurrence.ordinal ||
            gate.revision !== plan?.revision
          ) {
            throw new Error("An approved current Plan is required before upgrading the workflow.");
          }
          if (
            task.planGate ||
            task.build.amendmentGateId ||
            task.occurrences.some((candidate) => candidate.stage === "build") ||
            task.occurrences.some((candidate) => candidate.completionProposalId !== null) ||
            (task.bootstrap &&
              (task.bootstrap.status === "pending" || task.bootstrap.status === "running"))
          ) {
            throw new Error(
              "The task has a pending Plan, bootstrap, proposal, or Implement operation.",
            );
          }
          const repository = task.workspace.repositories[0];
          if (
            repository?.provisioningStatus === "pending" ||
            repository?.provisioningStatus === "running"
          ) {
            throw new Error("The task worktree operation is still pending.");
          }
          const pendingOutbox = yield* store
            .readPendingOutbox({ environmentId, limit: 1_000 })
            .pipe(
              Effect.mapError((cause) =>
                taskError(command, "Failed to inspect pending task operations.", cause),
              ),
            );
          if (
            pendingOutbox.some(
              (entry) =>
                entry.taskId === task.id &&
                (entry.target === "worktree" || entry.target === "bootstrap"),
            )
          ) {
            throw new Error("The task has a pending worktree or bootstrap operation.");
          }
          if (!task.preferences.modelSelection)
            throw new Error("The task has no selected provider.");
          if (Option.isSome(providerInstanceRegistry)) {
            const provider = yield* providerInstanceRegistry.value.getInstance(
              task.preferences.modelSelection.instanceId,
            );
            if (
              !provider ||
              !provider.enabled ||
              provider.adapter.capabilities.supportsTaskStage !== true ||
              !supportsTaskWorktreeWrite(provider.adapter.capabilities)
            ) {
              throw new Error("The selected provider cannot enforce task-worktree-write.");
            }
          }
          const target = resolveWorkflowDefinition(command.targetVersion);
          const now = yield* serverNow;
          const upgradedTask: TaskWorkspace = {
            ...task,
            versions: {
              ...task.versions,
              workflowDefinition: target.version,
              prompt: target.promptBundleRef,
            },
            workflowRuns: replaceCurrentRun(task, {
              definitionVersion: target.version,
              promptBundleVersion: target.promptBundleRef,
              updatedAt: now,
            }),
            updatedAt: now,
          };
          return yield* append(command, upgradedTask, {
            eventType: "task.workflow.upgraded",
            operationReceipt: {
              environmentId,
              taskId: task.id,
              operationType: "task.workflow.upgrade",
              operationKey: command.operationKey,
              payloadDigest: canonicalTaskCommandDigest(command),
              status: "completed",
              attemptCount: 1,
              sourceCommandIds: [command.commandId],
              resultEventId: null,
              resultTaskRevision: null,
              error: null,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
        case "task.implementation.start": {
          const run = currentRun(task);
          if (run.definitionVersion !== "guided@0.3.0")
            throw new Error("Implement requires guided@0.3.0.");
          if (command.expectedTaskRevision !== task.taskRevision) {
            throw new Error(
              `Task revision ${task.taskRevision} does not match the expected revision ${command.expectedTaskRevision}.`,
            );
          }
          if (run.currentStage !== "plan" || task.planGate !== null)
            throw new Error("Implement requires an approved current Plan.");
          const planOccurrence = latestOccurrence(task, "plan");
          const gate = task.gateHistory.at(-1);
          const plan = latestPlanRevision(task);
          if (
            !plan ||
            !planOccurrence ||
            planOccurrence.status !== "completed" ||
            planOccurrence.gateOutcome !== "approved" ||
            !gate ||
            gate.occurrence !== planOccurrence.ordinal ||
            gate.revision !== plan.revision ||
            gate.outcome !== "approved"
          ) {
            throw new Error("An approved current Plan is required before Implement.");
          }
          if (
            task.occurrences.some((candidate) => candidate.stage === "build") ||
            (task.bootstrap &&
              (task.bootstrap.status === "pending" || task.bootstrap.status === "running"))
          ) {
            throw new Error("Implement is already starting or has already started.");
          }
          const repository = task.workspace.repositories[0];
          if (
            !repository?.worktreePath ||
            !repository.branch ||
            repository.provisioningStatus !== "ready"
          ) {
            throw new Error("The canonical task worktree is not ready. Choose Now or Later first.");
          }
          const expectedBranch = `katacode/task-${safeBranchSegment(task.id)}`;
          const expectedPath = expectedTaskWorktreePath(
            config.worktreesDir,
            repository.workspaceRoot,
            expectedBranch,
          );
          if (
            repository.branch !== expectedBranch ||
            repository.worktreePath !== expectedPath ||
            !repository.baseCommitSha
          )
            throw new Error("The task worktree reservation is not canonical.");
          const branch = yield* runGit(repository.worktreePath, [
            "symbolic-ref",
            "--short",
            "HEAD",
          ]).pipe(
            Effect.mapError((cause) =>
              taskError(command, "Failed to inspect the task worktree branch.", cause),
            ),
          );
          if (branch !== expectedBranch)
            throw new Error("The task worktree is detached or on an unexpected branch.");
          const head = yield* runGit(repository.worktreePath, ["rev-parse", "HEAD"]).pipe(
            Effect.mapError((cause) =>
              taskError(command, "Failed to inspect the task worktree HEAD.", cause),
            ),
          );
          const branchHead = yield* runGit(repository.workspaceRoot, [
            "rev-parse",
            `refs/heads/${expectedBranch}`,
          ]).pipe(
            Effect.mapError((cause) =>
              taskError(command, "Failed to inspect the task branch HEAD.", cause),
            ),
          );
          if (head !== branchHead)
            throw new Error("The task worktree HEAD does not match its branch.");
          yield* runGit(repository.worktreePath, [
            "merge-base",
            "--is-ancestor",
            repository.baseCommitSha,
            "HEAD",
          ]).pipe(
            Effect.mapError((cause) =>
              taskError(command, "The task worktree base is not an ancestor of HEAD.", cause),
            ),
          );
          if (!task.preferences.modelSelection)
            throw new Error("The task has no selected provider.");
          if (Option.isSome(providerInstanceRegistry)) {
            const provider = yield* providerInstanceRegistry.value.getInstance(
              task.preferences.modelSelection.instanceId,
            );
            if (
              !provider ||
              !provider.enabled ||
              provider.adapter.capabilities.supportsTaskStage !== true ||
              !supportsTaskWorktreeWrite(provider.adapter.capabilities)
            )
              throw new Error("The selected provider cannot enforce task-worktree-write.");
          }
          const build =
            task.build.currentPlanRevisionId === plan.id
              ? task.build
              : compileLegacyTaskWorkspacePlan({
                  markdown: plan.markdown,
                  planRevisionId: plan.id,
                });
          const now = yield* serverNow;
          const approvedTask = { ...task, build };
          const occurrence = allocateOccurrence(approvedTask, "build", now);
          const bootstrap = yield* allocateStageBootstrap(
            approvedTask,
            "build",
            occurrence.ordinal,
            {
              executionProfile: "task-worktree-write",
              presentation: "implementation",
              worktreeBranch: repository.branch,
              worktreePath: repository.worktreePath,
            },
          );
          const startedTask: TaskWorkspace = {
            ...approvedTask,
            preferences: { ...approvedTask.preferences, executionProfile: "task-worktree-write" },
            bootstrap: bootstrapStateFor(
              {
                operationKey: bootstrap.operationKey,
                executionProfile: "task-worktree-write",
                presentation: "implementation",
                sessionId: bootstrap.outboxPayload.sessionId,
                threadId: bootstrap.outboxPayload.threadId,
                threadCreateCommandId: bootstrap.outboxPayload.threadCreateCommandId,
                turnStartCommandId: bootstrap.outboxPayload.turnStartCommandId,
                kickoffMessageId: bootstrap.outboxPayload.kickoffMessageId,
              },
              bootstrap.now,
            ),
            workflowRuns: replaceCurrentRun(approvedTask, {
              currentStage: "build",
              updatedAt: now,
            }),
            occurrences: [...approvedTask.occurrences, occurrence],
            updatedAt: now,
          };
          return yield* append(command, startedTask, {
            operationReceipt: {
              environmentId,
              taskId: task.id,
              operationType: "task.implementation.start",
              operationKey: command.operationKey,
              payloadDigest: canonicalTaskCommandDigest(command),
              status: "completed",
              attemptCount: 1,
              sourceCommandIds: [command.commandId],
              resultEventId: null,
              resultTaskRevision: null,
              error: null,
              createdAt: now,
              updatedAt: now,
            },
            outbox: [
              {
                target: "bootstrap",
                operationKey: bootstrap.operationKey,
                payload: bootstrap.outboxPayload,
                status: "pending",
              },
            ],
          });
        }
        case "task.plan.approve": {
          const definition = definitionFor(task);
          if (definition.version === "guided@0.3.0" && task.planGate) {
            if (
              command.expectedTaskRevision !== undefined &&
              command.expectedTaskRevision !== task.taskRevision
            ) {
              return yield* taskError(
                command,
                `Task revision ${task.taskRevision} does not match the expected revision ${command.expectedTaskRevision}.`,
              );
            }
            const gate = task.planGate;
            if (gate.status !== "open") {
              return yield* taskError(
                command,
                `The Plan gate is '${gate.status}' and cannot be approved.`,
              );
            }
            const occurrence = task.occurrences.find(
              (candidate) => candidate.stage === "plan" && candidate.ordinal === gate.occurrence,
            );
            if (!occurrence || occurrence.status !== "awaiting-approval") {
              return yield* taskError(
                command,
                `Plan occurrence ${gate.occurrence} is not awaiting approval.`,
              );
            }
            const planArtifact = latestPlanRevision(task);
            if (!planArtifact || planArtifact.revision !== gate.revision) {
              return yield* taskError(
                command,
                `The open Plan gate references revision ${gate.revision}, which is not current.`,
              );
            }
            // Strict compilation is part of approval. It validates the exact reviewed
            // Markdown and binds Build to this immutable artifact revision.
            const compiledBuild = compileTaskWorkspacePlan({
              markdown: planArtifact.markdown,
              planRevisionId: planArtifact.id,
            });
            const now = yield* serverNow;
            const actor = "local-user";
            const approvedBase: TaskWorkspace = {
              ...task,
              bootstrap: null,
              planGate: null,
              gateHistory: [
                ...task.gateHistory,
                {
                  occurrence: gate.occurrence,
                  revision: gate.revision,
                  outcome: "approved",
                  feedback: null,
                  actor,
                  resolvedAt: now,
                },
              ],
              occurrences: task.occurrences.map((candidate) =>
                candidate.id === occurrence.id
                  ? {
                      ...candidate,
                      status: "completed" as const,
                      gateOutcome: "approved" as const,
                      completedAt: now,
                    }
                  : candidate,
              ),
              sessions: task.sessions.map((candidate) =>
                candidate.id === occurrence.sessionId
                  ? { ...candidate, status: "completed" as const }
                  : candidate,
              ),
              build: compiledBuild,
            };
            const repository = task.workspace.repositories[0];
            if (!repository)
              return yield* taskError(command, "The task has no repository binding.");
            const ready =
              repository.worktreePath !== null &&
              repository.branch !== null &&
              repository.provisioningStatus === "ready";
            if (task.preferences.worktreePolicy === "never") {
              return yield* append(
                command,
                approvedBase,
                command.operationKey
                  ? {
                      operationReceipt: {
                        environmentId,
                        taskId: task.id,
                        operationType: "task.plan.approve",
                        operationKey: command.operationKey,
                        payloadDigest: canonicalTaskCommandDigest(command),
                        status: "completed",
                        attemptCount: 1,
                        sourceCommandIds: [command.commandId],
                        resultEventId: null,
                        resultTaskRevision: null,
                        error: null,
                        createdAt: now,
                        updatedAt: now,
                      },
                    }
                  : {},
              );
            }
            if (task.preferences.worktreePolicy === "now" && !ready) {
              return yield* taskError(command, "The task worktree is not ready for Implement.");
            }
            if (task.preferences.worktreePolicy === "later" && !ready) {
              const headSha = yield* runGit(repository.workspaceRoot, ["rev-parse", "HEAD"]).pipe(
                Effect.mapError((cause) =>
                  taskError(command, "Failed to revalidate the source checkout.", cause),
                ),
              );
              const statusPorcelain = yield* runGit(repository.workspaceRoot, [
                "status",
                "--porcelain=v2",
              ]).pipe(
                Effect.mapError((cause) =>
                  taskError(command, "Failed to revalidate the source checkout.", cause),
                ),
              );
              const fingerprint = createHash("sha256")
                .update(`${headSha}\n${statusPorcelain}`)
                .digest("hex");
              if (
                repository.planningRootFingerprint === null ||
                fingerprint !== repository.planningRootFingerprint
              ) {
                return yield* taskError(
                  command,
                  "The planning root drifted since creation; restore the pinned source state before provisioning.",
                );
              }
              const branch = `katacode/task-${safeBranchSegment(task.id)}`;
              const path = expectedTaskWorktreePath(
                config.worktreesDir,
                repository.workspaceRoot,
                branch,
              );
              const operationReceipt = command.operationKey
                ? {
                    environmentId,
                    taskId: task.id,
                    operationType: "task.plan.approve",
                    operationKey: command.operationKey,
                    payloadDigest: canonicalTaskCommandDigest(command),
                    status: "completed" as const,
                    attemptCount: 1,
                    sourceCommandIds: [command.commandId],
                    resultEventId: null,
                    resultTaskRevision: null,
                    error: null,
                    createdAt: now,
                    updatedAt: now,
                  }
                : undefined;
              return yield* append(
                command,
                {
                  ...approvedBase,
                  workspace: {
                    repositories: approvedBase.workspace.repositories.map((candidate) =>
                      candidate.id === repository.id
                        ? { ...candidate, provisioningStatus: "pending" as const }
                        : candidate,
                    ),
                  },
                },
                {
                  ...(operationReceipt ? { operationReceipt } : {}),
                  outbox: [
                    {
                      target: "worktree",
                      operationKey: `${task.id}:worktree:${repository.baseCommitSha}:${task.preferences.worktreePolicy}`,
                      payload: {
                        branch,
                        path,
                        baseCommitSha: repository.baseCommitSha,
                        sourceWorkspaceRoot: repository.workspaceRoot,
                      },
                      status: "pending",
                    },
                  ],
                },
              );
            }
            const buildOccurrence = allocateOccurrence(approvedBase, "build", now);
            const bootstrap = yield* allocateStageBootstrap(
              approvedBase,
              "build",
              buildOccurrence.ordinal,
              {
                executionProfile: "task-worktree-write",
                presentation: "implementation",
                worktreeBranch: repository.branch,
                worktreePath: repository.worktreePath,
              },
            );
            const startedTask: TaskWorkspace = {
              ...approvedBase,
              preferences: { ...approvedBase.preferences, executionProfile: "task-worktree-write" },
              bootstrap: bootstrapStateFor(
                {
                  operationKey: bootstrap.operationKey,
                  executionProfile: "task-worktree-write",
                  presentation: "implementation",
                  sessionId: bootstrap.outboxPayload.sessionId,
                  threadId: bootstrap.outboxPayload.threadId,
                  threadCreateCommandId: bootstrap.outboxPayload.threadCreateCommandId,
                  turnStartCommandId: bootstrap.outboxPayload.turnStartCommandId,
                  kickoffMessageId: bootstrap.outboxPayload.kickoffMessageId,
                },
                bootstrap.now,
              ),
              workflowRuns: replaceCurrentRun(approvedBase, {
                currentStage: "build",
                updatedAt: now,
              }),
              occurrences: [...approvedBase.occurrences, buildOccurrence],
            };
            return yield* append(command, startedTask, {
              eventType: "task.plan.approve",
              ...(command.operationKey
                ? {
                    operationReceipt: {
                      environmentId,
                      taskId: task.id,
                      operationType: "task.plan.approve",
                      operationKey: command.operationKey,
                      payloadDigest: canonicalTaskCommandDigest(command),
                      status: "completed" as const,
                      attemptCount: 1,
                      sourceCommandIds: [command.commandId],
                      resultEventId: null,
                      resultTaskRevision: null,
                      error: null,
                      createdAt: now,
                      updatedAt: now,
                    },
                  }
                : {}),
              outbox: [
                {
                  target: "bootstrap",
                  operationKey: bootstrap.operationKey,
                  payload: bootstrap.outboxPayload,
                  status: "pending",
                },
              ],
            });
          }
          if (definition.availableInFirstSlice === true && task.planGate) {
            // First-slice approval: keep the stage `plan`, complete the open
            // occurrence, and apply the worktree policy. No Implement
            // occurrence or session starts in this slice.
            if (
              command.expectedTaskRevision !== undefined &&
              command.expectedTaskRevision !== task.taskRevision
            ) {
              return yield* taskError(
                command,
                `Task revision ${task.taskRevision} does not match the expected revision ${command.expectedTaskRevision}.`,
              );
            }
            const gate = task.planGate;
            if (gate.status !== "open") {
              return yield* taskError(
                command,
                `The Plan gate is '${gate.status}' and cannot be approved.`,
              );
            }
            const occurrence = task.occurrences.find(
              (candidate) => candidate.stage === "plan" && candidate.ordinal === gate.occurrence,
            );
            if (!occurrence || occurrence.status !== "awaiting-approval") {
              return yield* taskError(
                command,
                `Plan occurrence ${gate.occurrence} is not awaiting approval.`,
              );
            }
            const now = yield* serverNow;
            const planArtifact = latestArtifact(task, "plan");
            if (!planArtifact || planArtifact.revision !== gate.revision) {
              return yield* taskError(
                command,
                `The open Plan gate references revision ${gate.revision}, which is not current.`,
              );
            }
            const actor = "local-user";
            const approvedTask: TaskWorkspace = {
              ...task,
              planGate: null,
              gateHistory: [
                ...task.gateHistory,
                {
                  occurrence: gate.occurrence,
                  revision: gate.revision,
                  outcome: "approved",
                  feedback: null,
                  actor,
                  resolvedAt: now,
                },
              ],
              occurrences: task.occurrences.map((candidate) =>
                candidate.id === occurrence.id
                  ? {
                      ...candidate,
                      status: "completed" as const,
                      gateOutcome: "approved" as const,
                      completedAt: now,
                    }
                  : candidate,
              ),
              sessions: task.sessions.map((candidate) =>
                candidate.id === occurrence.sessionId
                  ? { ...candidate, status: "completed" as const }
                  : candidate,
              ),
              workspace:
                task.preferences.worktreePolicy === "later"
                  ? {
                      repositories: task.workspace.repositories.map((repository) =>
                        repository.id === "primary"
                          ? { ...repository, provisioningStatus: "pending" as const }
                          : repository,
                      ),
                    }
                  : task.workspace,
            };
            const worktreePolicy = task.preferences.worktreePolicy;
            if (worktreePolicy === "later") {
              // Revalidate the pinned source state and enqueue provisioning;
              // failure preserves the approved Plan and exposes Retry.
              const repository = task.workspace.repositories[0]!;
              const headSha = yield* runGit(repository.workspaceRoot, ["rev-parse", "HEAD"]).pipe(
                Effect.mapError((cause) =>
                  taskError(command, "Failed to revalidate the source checkout.", cause),
                ),
              );
              const statusPorcelain = yield* runGit(repository.workspaceRoot, [
                "status",
                "--porcelain=v2",
              ]).pipe(
                Effect.mapError((cause) =>
                  taskError(command, "Failed to revalidate the source checkout.", cause),
                ),
              );
              const fingerprint = createHash("sha256")
                .update(`${headSha}\n${statusPorcelain}`)
                .digest("hex");
              if (
                repository.planningRootFingerprint === null ||
                fingerprint !== repository.planningRootFingerprint
              ) {
                return yield* taskError(
                  command,
                  "The planning root drifted since creation; restore the pinned source state before provisioning.",
                );
              }
              const worktreeBranch = `katacode/task-${safeBranchSegment(task.id)}`;
              const worktreePath = expectedTaskWorktreePath(
                config.worktreesDir,
                repository.workspaceRoot,
                worktreeBranch,
              );
              const worktreeOperationKey = `${task.id}:worktree:${repository.baseCommitSha}:${worktreePolicy}`;
              return yield* append(command, approvedTask, {
                ...(command.operationKey
                  ? {
                      operationReceipt: {
                        environmentId,
                        taskId: task.id,
                        operationType: "task.plan.approve",
                        operationKey: command.operationKey,
                        payloadDigest: canonicalTaskCommandDigest(command),
                        status: "completed",
                        attemptCount: 1,
                        sourceCommandIds: [command.commandId],
                        resultEventId: null,
                        resultTaskRevision: null,
                        error: null,
                        createdAt: now,
                        updatedAt: now,
                      },
                    }
                  : {}),
                outbox: [
                  {
                    target: "worktree",
                    operationKey: worktreeOperationKey,
                    payload: {
                      branch: worktreeBranch,
                      path: worktreePath,
                      baseCommitSha: repository.baseCommitSha,
                      sourceWorkspaceRoot: repository.workspaceRoot,
                    },
                    status: "pending",
                  },
                ],
              });
            }
            return yield* append(
              command,
              approvedTask,
              command.operationKey
                ? {
                    operationReceipt: {
                      environmentId,
                      taskId: task.id,
                      operationType: "task.plan.approve",
                      operationKey: command.operationKey,
                      payloadDigest: canonicalTaskCommandDigest(command),
                      status: "completed",
                      attemptCount: 1,
                      sourceCommandIds: [command.commandId],
                      resultEventId: null,
                      resultTaskRevision: null,
                      error: null,
                      createdAt: now,
                      updatedAt: now,
                    },
                  }
                : {},
            );
          }
          // Legacy approval: resolve the transition before provisioning.
          const workflowRuns = applyTransition(task, command.type, command.createdAt);
          const repository = task.workspace.repositories[0];
          if (!repository) throw new Error("The task has no repository binding.");
          const newRefName = `katacode/task-${safeBranchSegment(task.id)}`;
          const worktreePath = expectedTaskWorktreePath(
            config.worktreesDir,
            repository.workspaceRoot,
            newRefName,
          );
          const existingWorktree = yield* tryAdoptExistingWorktree(
            worktreePath,
            newRefName,
            repository.baseCommitSha ?? undefined,
            repository.workspaceRoot,
          );
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
                  tryAdoptExistingWorktree(
                    worktreePath,
                    newRefName,
                    repository.baseCommitSha ?? undefined,
                    repository.workspaceRoot,
                  ).pipe(
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
            build: buildFromPlan(task),
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
        case "task.implementation.progress": {
          requireStage(task, "build");
          if (command.expectedTaskRevision !== task.taskRevision) {
            throw new Error(
              `Task revision ${task.taskRevision} does not match the expected revision ${command.expectedTaskRevision}.`,
            );
          }
          if (task.build.amendmentGateId)
            throw new Error("Implementation is paused at an amendment gate.");
          const phase = phaseForBuild(task, command.phaseId);
          if (phase.status === "blocked" || phase.status === "invalidated")
            throw new Error(`Phase '${phase.id}' is blocked.`);
          if (command.status === "running") {
            requirePredecessorPhasesComplete(task.build, phase.id);
            if (task.build.activePhaseId !== null && task.build.activePhaseId !== phase.id)
              throw new Error(`Phase '${task.build.activePhaseId}' is already active.`);
          }
          let build: TaskWorkspace["build"] = {
            ...task.build,
            activePhaseId: phase.id,
            phases: task.build.phases.map((candidate) =>
              candidate.id === phase.id
                ? {
                    ...candidate,
                    status:
                      command.status === "blocked" ? ("blocked" as const) : ("running" as const),
                    startedAt: candidate.startedAt ?? command.createdAt,
                    workItems: candidate.workItems.map((item) =>
                      item.id === command.workItemId
                        ? { ...item, status: command.status, summary: command.summary }
                        : item,
                    ),
                  }
                : candidate,
            ),
            activeWorkItemId: command.workItemId,
          };
          if (command.workItemId !== null) {
            const item = phase.workItems.find((candidate) => candidate.id === command.workItemId);
            if (!item) throw new Error(`Work item '${command.workItemId}' was not found.`);
            if (command.status === "running" && !dependenciesPass(phase, item))
              throw new Error(`Work item '${item.id}' has incomplete dependencies.`);
            if (command.status === "completed" && !dependenciesPass(phase, item))
              throw new Error(`Work item '${item.id}' has incomplete dependencies.`);
            if (command.status === "completed" && !requiredChecksPass(task.build, item.checkIds))
              throw new Error(`Work item '${item.id}' has checks that have not passed.`);
          }
          return yield* append(
            command,
            { ...task, build, updatedAt: command.createdAt },
            { eventType: "task.implementation.progress" },
          );
        }
        case "task.implementation.check.run": {
          requireStage(task, "build");
          if (command.expectedTaskRevision !== task.taskRevision)
            throw new Error("The implementation task revision is stale.");
          if (task.build.amendmentGateId)
            throw new Error("Implementation is paused at an amendment gate.");
          const check = checkForBuild(task, command.checkId);
          if (check.kind !== "automated" || !check.command)
            throw new Error(`Check '${check.id}' is not an approved automated command.`);
          const plan = latestPlanRevision(task);
          const repository = task.workspace.repositories[0];
          if (!plan || !repository?.worktreePath)
            throw new Error("The approved Plan or canonical worktree is unavailable.");
          const attemptId = `check-attempt-${task.build.checkAttempts.length + 1}`;
          const commandDigest = createHash("sha256").update(check.command).digest("hex");
          const attempt = {
            id: attemptId,
            checkId: check.id,
            planRevisionId: plan.id,
            startingCommitSha:
              task.build.resultingCommitSha ??
              task.workspace.repositories[0]?.baseCommitSha ??
              "unknown",
            commandDigest,
            operationKey: command.operationKey,
            status: "pending" as const,
            output: null,
            exitCode: null,
            timeoutMs: 120_000,
            observedStatus: null,
            startedAt: null,
            completedAt: null,
            endingCommitSha: null,
          };
          const build: TaskWorkspace["build"] = {
            ...task.build,
            checkAttempts: [...task.build.checkAttempts, attempt],
            checks: task.build.checks.map((candidate) =>
              candidate.id === check.id
                ? {
                    ...candidate,
                    status: "running" as const,
                    attemptIds: [...candidate.attemptIds, attemptId],
                    startedAt: command.createdAt,
                  }
                : candidate,
            ),
          };
          return yield* append(
            command,
            { ...task, build, updatedAt: command.createdAt },
            {
              eventType: "task.implementation.check.run",
              outbox: [
                {
                  target: "implementation-check",
                  operationKey: command.operationKey,
                  payload: {
                    attemptId,
                    checkId: check.id,
                    worktreePath: repository.worktreePath,
                    command: check.command,
                    commandDigest,
                    timeoutMs: 120_000,
                  },
                },
              ],
            },
          );
        }
        case "task.implementation.amendment.propose": {
          requireStage(task, "build");
          if (command.expectedTaskRevision !== task.taskRevision)
            throw new Error("The implementation task revision is stale.");
          if (task.build.amendmentGateId)
            throw new Error("An implementation amendment is already open.");
          const plan = latestPlanRevision(task);
          const phase = phaseForBuild(task, command.phaseId);
          const item = workItemForBuild(phase, command.workItemId);
          if (!plan || task.build.currentPlanRevisionId !== plan.id)
            throw new Error("An approved current Plan is required.");
          if (command.triggeringCheckId !== null) {
            const check = checkForBuild(task, command.triggeringCheckId);
            if (check.phaseId !== phase.id || check.workItemId !== item.id)
              throw new Error("The amendment check does not belong to the triggering work item.");
          }
          const amendmentId = `amendment-${task.build.amendments.length + 1}`;
          const amendment = {
            id: amendmentId,
            basePlanRevisionId: plan.id,
            triggeringPhaseId: phase.id,
            triggeringWorkItemId: item.id,
            triggeringCheckId: command.triggeringCheckId,
            expected: command.expected,
            found: command.found,
            impact: command.impact,
            proposedChanges: command.proposedPlanMarkdown,
            proposedPlanMarkdown: command.proposedPlanMarkdown,
            reviewFeedback: null,
            affectedPhaseIds: [phase.id],
            affectedWorkItemIds: [item.id],
            dependentCheckIds: command.triggeringCheckId ? [command.triggeringCheckId] : [],
            status: "requested" as const,
            artifactRevisionId: null,
            planDiff: null,
            requestedAt: command.createdAt,
            approvedAt: null,
            approvedBy: null,
          };
          const build = {
            ...task.build,
            amendmentGateId: amendmentId,
            amendments: [...task.build.amendments, amendment],
          };
          return yield* append(
            command,
            { ...task, build, updatedAt: command.createdAt },
            { eventType: "task.implementation.amendment.propose" },
          );
        }
        case "task.implementation.complete": {
          requireStage(task, "build");
          if (command.expectedTaskRevision !== task.taskRevision)
            throw new Error("The implementation task revision is stale.");
          const occurrence = activeOccurrence(task, "build");
          if (!occurrence?.sessionId || !occurrence.threadId)
            throw new Error("No active implementation occurrence.");
          if (!command.sessionId || !command.providerTurnId)
            throw new Error("Completion requires the active session and provider turn.");
          const proposalId = `proposal-build-${occurrence.ordinal}-${command.operationKey}`;
          const proposal = {
            id: proposalId,
            environmentId,
            taskId: task.id,
            stage: "build" as const,
            occurrence: occurrence.ordinal,
            sessionId: command.sessionId,
            threadId: occurrence.threadId,
            providerTurnId: command.providerTurnId,
            payloadDigest: createHash("sha256").update(command.summary).digest("hex"),
            summary: command.summary,
            markdown: "",
            status: "proposed" as const,
            terminalTurnOutcome: null,
            committedArtifactRevisionId: null,
            rejectionReason: null,
            createdAt: command.createdAt,
            settledAt: null,
          };
          if (command.sessionId !== occurrence.sessionId)
            throw new Error("Completion session is not the active primary session.");
          return yield* append(
            command,
            {
              ...task,
              occurrences: task.occurrences.map((candidate) =>
                candidate.id === occurrence.id
                  ? {
                      ...candidate,
                      status: "finalizing" as const,
                      completionProposalId: proposalId,
                    }
                  : candidate,
              ),
              updatedAt: command.createdAt,
            },
            { eventType: "task.implementation.complete", proposal },
          );
        }
        case "task.build.phase.start": {
          requireStage(task, "build");
          if (task.build.amendmentGateId) {
            throw new Error("Build is paused at an amendment gate.");
          }
          const phase = phaseForBuild(task, command.phaseId);
          if (phase.status === "completed") {
            throw new Error(`Build phase '${phase.id}' is already complete.`);
          }
          if (phase.status === "blocked" || phase.status === "invalidated") {
            throw new Error(`Build phase '${phase.id}' must be resumed before it can start.`);
          }
          requirePredecessorPhasesComplete(task.build, phase.id);
          const firstPending = phase.workItems.find((item) => item.status === "pending") ?? null;
          return yield* append(command, {
            ...task,
            build: {
              ...task.build,
              activePhaseId: phase.id,
              activeWorkItemId: firstPending?.id ?? null,
              phases: task.build.phases.map((candidate) =>
                candidate.id === phase.id
                  ? {
                      ...candidate,
                      status: "running" as const,
                      startedAt: candidate.startedAt ?? command.createdAt,
                    }
                  : candidate,
              ),
            },
            updatedAt: command.createdAt,
          });
        }
        case "task.build.work-item.set-status": {
          requireStage(task, "build");
          if (task.build.amendmentGateId) {
            throw new Error("Build is paused at an amendment gate.");
          }
          const owner = task.build.phases.find((phase) =>
            phase.workItems.some((item) => item.id === command.workItemId),
          );
          if (!owner) throw new Error(`Work item '${command.workItemId}' was not found.`);
          const item = workItemForBuild(owner, command.workItemId);
          if (item.status === "blocked" || item.status === "invalidated") {
            throw new Error(`Work item '${item.id}' must be resumed before it can change status.`);
          }
          if (command.status === "running") {
            if (task.build.activePhaseId !== null && task.build.activePhaseId !== owner.id) {
              throw new Error(
                `Build phase '${task.build.activePhaseId}' is active; finish it before starting '${owner.id}'.`,
              );
            }
            requirePredecessorPhasesComplete(task.build, owner.id);
            if (!dependenciesPass(owner, item)) {
              throw new Error(`Work item '${item.id}' has incomplete dependencies.`);
            }
          }
          if (command.status === "completed") {
            if (item.status !== "running") {
              throw new Error(`Work item '${item.id}' must be running before it can complete.`);
            }
            if (owner.status !== "running" || task.build.activePhaseId !== owner.id) {
              throw new Error(
                `Build phase '${owner.id}' must be the active running phase before work can complete.`,
              );
            }
            requirePredecessorPhasesComplete(task.build, owner.id);
            if (!dependenciesPass(owner, item)) {
              throw new Error(`Work item '${item.id}' has incomplete dependencies.`);
            }
            if (!requiredChecksPass(task.build, item.checkIds)) {
              throw new Error(`Work item '${item.id}' has checks that have not passed.`);
            }
          }
          let build: TaskWorkspace["build"] = {
            ...task.build,
            activePhaseId: owner.id,
            activeWorkItemId: command.status === "completed" ? null : item.id,
            phases: task.build.phases.map((phase) =>
              phase.id === owner.id
                ? {
                    ...phase,
                    status: command.status === "completed" ? phase.status : ("running" as const),
                    startedAt: phase.startedAt ?? command.createdAt,
                    workItems: phase.workItems.map((candidate) =>
                      candidate.id === item.id
                        ? { ...candidate, status: command.status }
                        : candidate,
                    ),
                  }
                : phase,
            ),
          };
          const updatedPhase = phaseForBuild({ ...task, build }, owner.id);
          const phaseComplete =
            updatedPhase.workItems.every((candidate) => candidate.status === "completed") &&
            requiredChecksPass(build, updatedPhase.checkIds);
          if (command.status === "completed" && phaseComplete) {
            build = {
              ...build,
              phases: build.phases.map((phase) =>
                phase.id === owner.id
                  ? { ...phase, status: "completed" as const, completedAt: command.createdAt }
                  : phase,
              ),
              activePhaseId: null,
              activeWorkItemId: null,
            };
            if (owner.checkpointPolicy === "always" || owner.checkpointPolicy === "manual-only") {
              build = appendCheckpoint(
                build,
                { ...updatedPhase, status: "completed" },
                command.createdAt,
              );
            } else {
              build = startNextPhase(build, owner.id, command.createdAt);
            }
          }
          return yield* append(command, {
            ...task,
            build,
            updatedAt: command.createdAt,
          });
        }
        case "task.build.check.run": {
          requireStage(task, "build");
          if (task.build.amendmentGateId) {
            throw new Error("Build is paused at an amendment gate.");
          }
          const check = checkForBuild(task, command.checkId);
          const phase = phaseForBuild(task, check.phaseId);
          if (phase.status !== "running") {
            throw new Error(`Build phase '${phase.id}' must be running before a check can run.`);
          }
          if (check.workItemId) {
            const item = workItemForBuild(phase, check.workItemId);
            if (item.status !== "running") {
              throw new Error(`Work item '${item.id}' must be running before its check can run.`);
            }
          }
          if (check.kind !== "automated") {
            throw new Error(`Build check '${check.id}' is manual and cannot be run automatically.`);
          }
          const failed = check.command === "fixture.mismatch" || /mismatch/i.test(check.label);
          const result: TaskWorkspaceBuildCheck = {
            ...check,
            status: failed ? "fail" : "pass",
            output: failed
              ? "Expected the Plan fixture content, but the codebase contained a deterministic mismatch."
              : "Allowlisted deterministic check passed.",
            exitCode: failed ? 1 : 0,
            commitSha: task.build.resultingCommitSha,
            startedAt: check.startedAt ?? command.createdAt,
            completedAt: command.createdAt,
          };
          let build: TaskWorkspace["build"] = {
            ...task.build,
            checks: task.build.checks.map((candidate) =>
              candidate.id === check.id ? result : candidate,
            ),
          };
          if (failed && check.workItemId) {
            build = {
              ...build,
              phases: build.phases.map((phase) =>
                phase.id === check.phaseId
                  ? {
                      ...phase,
                      status: "blocked" as const,
                      workItems: phase.workItems.map((item) =>
                        item.id === check.workItemId
                          ? {
                              ...item,
                              status: "blocked" as const,
                              invalidationReason: result.output,
                            }
                          : item,
                      ),
                    }
                  : phase,
              ),
            };
            const failedPhase = phaseForBuild({ ...task, build }, check.phaseId);
            if (
              failedPhase.checkpointPolicy === "on-failure" ||
              failedPhase.checkpointPolicy === "always"
            ) {
              build = appendCheckpoint(build, failedPhase, command.createdAt);
            }
          }
          return yield* append(command, { ...task, build, updatedAt: command.createdAt });
        }
        case "task.build.check.record-manual": {
          requireStage(task, "build");
          if (task.build.amendmentGateId) {
            throw new Error("Build is paused at an amendment gate.");
          }
          const check = checkForBuild(task, command.checkId);
          const phase = phaseForBuild(task, check.phaseId);
          if (phase.status !== "running") {
            throw new Error(
              `Build phase '${phase.id}' must be running before a check can be recorded.`,
            );
          }
          if (check.workItemId) {
            const item = workItemForBuild(phase, check.workItemId);
            if (item.status !== "running") {
              throw new Error(
                `Work item '${item.id}' must be running before its check can be recorded.`,
              );
            }
          }
          if (check.kind !== "manual") {
            throw new Error(
              `Build check '${check.id}' is automated and cannot be recorded manually.`,
            );
          }
          const result: TaskWorkspaceBuildCheck = {
            ...check,
            status: command.status,
            note: command.note,
            commitSha: command.commitSha ?? task.build.resultingCommitSha,
            completedAt: command.createdAt,
            startedAt: check.startedAt ?? command.createdAt,
          };
          let build: TaskWorkspace["build"] = {
            ...task.build,
            checks: task.build.checks.map((candidate) =>
              candidate.id === check.id ? result : candidate,
            ),
          };
          if (command.status !== "pass" && check.workItemId) {
            build = {
              ...build,
              phases: build.phases.map((candidate) =>
                candidate.id === check.phaseId
                  ? {
                      ...candidate,
                      status: "blocked" as const,
                      workItems: candidate.workItems.map((item) =>
                        item.id === check.workItemId
                          ? {
                              ...item,
                              status: "blocked" as const,
                              invalidationReason: command.note,
                            }
                          : item,
                      ),
                    }
                  : candidate,
              ),
            };
            const failedPhase = phaseForBuild({ ...task, build }, check.phaseId);
            if (
              failedPhase.checkpointPolicy === "on-failure" ||
              failedPhase.checkpointPolicy === "always"
            ) {
              build = appendCheckpoint(build, failedPhase, command.createdAt);
            }
          }
          return yield* append(command, { ...task, build, updatedAt: command.createdAt });
        }
        case "task.build.checkpoint.continue": {
          requireStage(task, "build");
          if (task.build.amendmentGateId) {
            throw new Error("Approve the pending amendment before continuing Build.");
          }
          const checkpoint = task.build.checkpoints.find(
            (candidate) => candidate.id === command.checkpointId,
          );
          if (!checkpoint) throw new Error(`Checkpoint '${command.checkpointId}' was not found.`);
          if (checkpoint.status !== "waiting") {
            throw new Error(`Checkpoint '${checkpoint.id}' has already continued.`);
          }
          if (
            checkpoint.contextManifestId !== null &&
            checkpoint.contextManifestId !== command.contextManifestId
          ) {
            throw new Error(
              `Checkpoint '${checkpoint.id}' requires context manifest '${checkpoint.contextManifestId}'.`,
            );
          }
          requireContextManifest(task, command.contextManifestId);
          if (task.sessions.some((session) => session.threadId === command.threadId)) {
            throw new Error(`Thread '${command.threadId}' is already linked to this task.`);
          }
          const phase = phaseForBuild(task, checkpoint.phaseId);
          requirePredecessorPhasesComplete(task.build, phase.id);
          if (
            phase.status !== "completed" ||
            !phase.workItems.every((item) => item.status === "completed") ||
            !requiredChecksPass(task.build, checkpoint.checkIds)
          ) {
            throw new Error(
              `Checkpoint '${checkpoint.id}' can continue only after its phase completes successfully.`,
            );
          }
          const sessionId = `session-${task.sessions.length + 1}`;
          let build: TaskWorkspace["build"] = {
            ...task.build,
            checkpoints: task.build.checkpoints.map((candidate) =>
              candidate.id === checkpoint.id
                ? {
                    ...candidate,
                    status: "continued" as const,
                    continuationSessionId: sessionId,
                    continuedAt: command.createdAt,
                  }
                : candidate,
            ),
            continuationSessionIds: [...task.build.continuationSessionIds, sessionId],
          };
          build = startNextPhase(build, phase.id, command.createdAt);
          return yield* append(command, {
            ...task,
            sessions: [
              ...task.sessions,
              {
                id: sessionId,
                stage: "build",
                threadId: command.threadId,
                role: "primary" as const,
                provider: null,
                status: "active" as const,
                parentSessionId: null,
                forkPoint: null,
                contextManifestId: command.contextManifestId,
                createdAt: command.createdAt,
              },
            ],
            build,
            updatedAt: command.createdAt,
          });
        }
        case "task.amendment.request": {
          const stage = currentRun(task).currentStage;
          if (stage !== "build" && stage !== "verify") {
            throw new Error(`Amendments are not available while the task is in '${stage}'.`);
          }
          if (!command.checkId) {
            throw new Error("A failed check is required for this amendment command.");
          }
          const check = checkForBuild(task, command.checkId);
          if (check.status !== "fail" && check.status !== "blocked") {
            throw new Error(`Build check '${check.id}' has no failure requiring an amendment.`);
          }
          const phase = phaseForBuild(task, command.phaseId);
          const item = workItemForBuild(phase, command.workItemId);
          if (check.phaseId !== phase.id || check.workItemId !== item.id) {
            throw new Error(
              "The amendment trigger does not match the selected phase and work item.",
            );
          }
          if (
            command.affectedPhaseIds.some(
              (phaseId) => !task.build.phases.some((candidate) => candidate.id === phaseId),
            ) ||
            command.affectedWorkItemIds.some(
              (workItemId) =>
                !task.build.phases.some((candidate) =>
                  candidate.workItems.some((itemCandidate) => itemCandidate.id === workItemId),
                ),
            ) ||
            command.dependentCheckIds.some(
              (checkId) => !task.build.checks.some((candidate) => candidate.id === checkId),
            )
          ) {
            throw new Error(
              "An amendment may only target existing phases, work items, and checks.",
            );
          }
          if (
            !command.affectedPhaseIds.includes(phase.id) ||
            !command.affectedWorkItemIds.includes(item.id) ||
            !command.dependentCheckIds.includes(check.id)
          ) {
            throw new Error(
              "An amendment must include its triggering phase, work item, and check.",
            );
          }
          const phaseWithoutWorkItem = command.affectedPhaseIds.find(
            (phaseId) =>
              !command.affectedWorkItemIds.some((workItemId) =>
                task.build.phases
                  .find((candidate) => candidate.id === phaseId)
                  ?.workItems.some((candidate) => candidate.id === workItemId),
              ),
          );
          if (phaseWithoutWorkItem) {
            throw new Error(
              `Amendment must name at least one affected work item in phase '${phaseWithoutWorkItem}'.`,
            );
          }
          const affectedWorkItems = new Set(command.affectedWorkItemIds);
          const affectedPhases = new Set(command.affectedPhaseIds);
          const unrelatedWorkItem = command.affectedWorkItemIds.find((workItemId) => {
            const owner = task.build.phases.find((candidate) =>
              candidate.workItems.some((itemCandidate) => itemCandidate.id === workItemId),
            );
            return owner ? !affectedPhases.has(owner.id) : true;
          });
          if (unrelatedWorkItem) {
            throw new Error(
              `Affected work item '${unrelatedWorkItem}' must belong to an affected phase.`,
            );
          }
          const unrelatedCheck = command.dependentCheckIds.find((checkId) => {
            const dependent = task.build.checks.find((candidate) => candidate.id === checkId);
            return (
              dependent === undefined ||
              !affectedPhases.has(dependent.phaseId) ||
              (dependent.workItemId !== null && !affectedWorkItems.has(dependent.workItemId))
            );
          });
          if (unrelatedCheck) {
            throw new Error(
              `Dependent check '${unrelatedCheck}' must belong to an affected phase and work item.`,
            );
          }
          const plan = latestPlanRevision(task);
          if (!plan)
            throw new Error("An approved Plan is required before requesting an amendment.");
          const amendmentId = `amendment-${task.build.amendments.length + 1}`;
          const amendmentArtifactTask = upsertArtifact(task, {
            type: "task.artifact.upsert",
            commandId: command.commandId,
            taskId: command.taskId,
            createdAt: command.createdAt,
            kind: "amendment",
            title: `Build amendment ${amendmentId}`,
            markdown: [
              `# Amendment ${amendmentId}`,
              "",
              `- Expected: ${command.expected}`,
              `- Found: ${command.found}`,
              `- Impact: ${command.impact}`,
              `- Proposed changes: ${command.proposedChanges}`,
            ].join("\n"),
            sourceSessionId: null,
          });
          const amendmentArtifact = latestArtifact(amendmentArtifactTask, "amendment");
          const amendment = {
            id: amendmentId,
            basePlanRevisionId: plan.id,
            triggeringPhaseId: phase.id,
            triggeringWorkItemId: item.id,
            triggeringCheckId: check.id,
            expected: command.expected,
            found: command.found,
            impact: command.impact,
            proposedChanges: command.proposedChanges,
            affectedPhaseIds: command.affectedPhaseIds,
            affectedWorkItemIds: command.affectedWorkItemIds,
            dependentCheckIds: command.dependentCheckIds,
            status: "requested" as const,
            artifactRevisionId: amendmentArtifact?.id ?? null,
            planDiff: null,
            requestedAt: command.createdAt,
            approvedAt: null,
            approvedBy: null,
          };
          return yield* append(command, {
            ...amendmentArtifactTask,
            build: {
              ...amendmentArtifactTask.build,
              amendmentGateId: amendmentId,
              amendments: [...amendmentArtifactTask.build.amendments, amendment],
            },
            updatedAt: command.createdAt,
          });
        }
        case "task.amendment.approve": {
          const stage = currentRun(task).currentStage;
          if (stage !== "build" && stage !== "verify") {
            throw new Error(`Amendments are not available while the task is in '${stage}'.`);
          }
          const amendment = task.build.amendments.find(
            (candidate) => candidate.id === command.amendmentId,
          );
          if (!amendment) throw new Error(`Amendment '${command.amendmentId}' was not found.`);
          if (amendment.status !== "requested") {
            throw new Error(`Amendment '${amendment.id}' has already been approved.`);
          }
          const plan = latestPlanRevision(task);
          if (!plan || plan.id !== amendment.basePlanRevisionId) {
            throw new Error(
              "The approved Plan changed; request a new amendment against its latest revision.",
            );
          }
          const proposedMarkdown = [
            plan.markdown.trimEnd(),
            "",
            `<!-- kata:block:amendment-${amendment.id} -->`,
            `## Amendment ${amendment.id}`,
            "",
            amendment.proposedChanges,
            "",
          ].join("\n");
          const amendedTask = upsertArtifact(task, {
            type: "task.artifact.upsert",
            commandId: command.commandId,
            taskId: command.taskId,
            createdAt: command.createdAt,
            kind: "plan",
            title: "Implementation plan (amended)",
            markdown: proposedMarkdown,
            sourceSessionId: null,
          });
          const proposedPlan = latestPlanRevision(amendedTask);
          if (!proposedPlan) throw new Error("Failed to create the amended Plan revision.");
          const changedBlockIds = [`amendment-${amendment.id}`];
          const invalidatedBuild = {
            ...amendedTask.build,
            currentPlanRevisionId: proposedPlan.id,
            amendmentGateId: null,
            resultingCommitSha: null,
            checkpoints: amendedTask.build.checkpoints.map((checkpoint) =>
              amendment.affectedPhaseIds.includes(checkpoint.phaseId)
                ? { ...checkpoint, contextManifestId: null }
                : checkpoint,
            ),
            amendments: amendedTask.build.amendments.map((candidate) =>
              candidate.id === amendment.id
                ? {
                    ...candidate,
                    status: "approved" as const,
                    artifactRevisionId: latestArtifact(amendedTask, "amendment")?.id ?? null,
                    planDiff: {
                      baseRevisionId: plan.id,
                      proposedRevisionId: proposedPlan.id,
                      summary: `Amendment ${amendment.id} updates the approved Build plan.`,
                      changedBlockIds,
                    },
                    approvedAt: command.createdAt,
                    approvedBy: command.approvedBy,
                  }
                : candidate,
            ),
            phases: amendedTask.build.phases.map((phase) =>
              amendment.affectedPhaseIds.includes(phase.id)
                ? {
                    ...phase,
                    status: "invalidated" as const,
                    // Keep the waiting failure checkpoint attached so the Build panel can
                    // offer the explicit resume path after the amendment is approved.
                    checkpointId: phase.checkpointId,
                    workItems: phase.workItems.map((item) =>
                      amendment.affectedWorkItemIds.includes(item.id)
                        ? {
                            ...item,
                            status: "invalidated" as const,
                            invalidationReason: `Invalidated by approved amendment ${amendment.id}.`,
                          }
                        : item,
                    ),
                  }
                : phase,
            ),
            checks: amendedTask.build.checks.map((check) =>
              amendment.dependentCheckIds.includes(check.id)
                ? {
                    ...check,
                    status: "pending" as const,
                    // Only the check that triggered the reviewed amendment is
                    // re-projected by the deterministic fixture adapter. Other
                    // dependent checks keep their original command so an
                    // amendment cannot silently rewrite unrelated failures.
                    command:
                      check.id === amendment.triggeringCheckId &&
                      check.command === "fixture.mismatch"
                        ? "fixture.pass"
                        : check.command,
                    label:
                      check.id === amendment.triggeringCheckId
                        ? check.label.replace(/mismatch/giu, "amended")
                        : check.label,
                    output: null,
                    note: null,
                    exitCode: null,
                    completedAt: null,
                  }
                : check,
            ),
          };
          // Every invalidated phase must expose a waiting checkpoint so the
          // approved amendment can be recovered. A failed check in a phase with
          // `Checkpoint policy: never` never created one, so approve materializes
          // an amendment recovery checkpoint for any affected phase without one.
          let recoveryBuild: TaskWorkspace["build"] = invalidatedBuild;
          for (const phaseId of amendment.affectedPhaseIds) {
            const affectedPhase = recoveryBuild.phases.find((phase) => phase.id === phaseId);
            if (!affectedPhase) continue;
            if (
              recoveryBuild.checkpoints.some(
                (checkpoint) => checkpoint.phaseId === phaseId && checkpoint.status === "waiting",
              )
            ) {
              continue;
            }
            recoveryBuild = appendCheckpoint(
              recoveryBuild,
              affectedPhase,
              command.createdAt,
              "Recovery after approved amendment.",
            );
          }
          return yield* append(command, {
            ...amendedTask,
            build: recoveryBuild,
            updatedAt: command.createdAt,
          });
        }
        case "task.build.resume": {
          requireStage(task, "build");
          if (task.build.amendmentGateId) {
            throw new Error("Approve the pending amendment before resuming Build.");
          }
          const checkpoint = task.build.checkpoints.find(
            (candidate) => candidate.id === command.checkpointId,
          );
          if (!checkpoint) throw new Error(`Checkpoint '${command.checkpointId}' was not found.`);
          if (checkpoint.status !== "waiting") {
            throw new Error(`Checkpoint '${checkpoint.id}' has already continued.`);
          }
          if (
            checkpoint.contextManifestId !== null &&
            checkpoint.contextManifestId !== command.contextManifestId
          ) {
            throw new Error(
              `Checkpoint '${checkpoint.id}' requires context manifest '${checkpoint.contextManifestId}'.`,
            );
          }
          requireContextManifest(task, command.contextManifestId);
          if (task.sessions.some((session) => session.threadId === command.threadId)) {
            throw new Error(`Thread '${command.threadId}' is already linked to this task.`);
          }
          const phase = phaseForBuild(task, checkpoint.phaseId);
          requirePredecessorPhasesComplete(task.build, phase.id);
          if (
            phase.status === "completed" &&
            phase.workItems.every((item) => item.status === "completed")
          ) {
            throw new Error(`Checkpoint '${checkpoint.id}' has no remaining work to resume.`);
          }
          const firstResumable = phase.workItems.find(
            (item) =>
              item.status === "invalidated" ||
              item.status === "pending" ||
              item.status === "blocked",
          );
          const sessionId = `session-${task.sessions.length + 1}`;
          let build: TaskWorkspace["build"] = {
            ...task.build,
            activePhaseId: phase.id,
            activeWorkItemId: firstResumable?.id ?? null,
            checkpoints: task.build.checkpoints.map((candidate) =>
              candidate.id === checkpoint.id
                ? {
                    ...candidate,
                    status: "continued" as const,
                    continuationSessionId: sessionId,
                    continuedAt: command.createdAt,
                  }
                : candidate,
            ),
            phases: task.build.phases.map((candidate) =>
              candidate.id === phase.id
                ? {
                    ...candidate,
                    status: "running" as const,
                    startedAt: candidate.startedAt ?? command.createdAt,
                    workItems: candidate.workItems.map((item) =>
                      item.status === "invalidated" || item.status === "blocked"
                        ? { ...item, status: "pending" as const, invalidationReason: null }
                        : item,
                    ),
                  }
                : candidate.status === "invalidated"
                  ? {
                      ...candidate,
                      status: "pending" as const,
                      workItems: candidate.workItems.map((item) =>
                        item.status === "invalidated" || item.status === "blocked"
                          ? { ...item, status: "pending" as const, invalidationReason: null }
                          : item,
                      ),
                    }
                  : candidate,
            ),
          };
          const sessions = [
            ...task.sessions,
            {
              id: sessionId,
              stage: "build" as const,
              threadId: command.threadId,
              role: "primary" as const,
              provider: null,
              status: "active" as const,
              parentSessionId: null,
              forkPoint: null,
              contextManifestId: command.contextManifestId,
              createdAt: command.createdAt,
            },
          ];
          build = {
            ...build,
            continuationSessionIds: [...build.continuationSessionIds, sessionId],
          };
          return yield* append(command, { ...task, sessions, build, updatedAt: command.createdAt });
        }
        case "task.fixture.apply": {
          const workflowRuns = applyTransition(task, command.type, command.createdAt);
          if (
            task.build.phases.some((phase) => phase.status !== "completed") ||
            task.build.phases.some((phase) =>
              phase.workItems.some((item) => item.status !== "completed"),
            ) ||
            task.build.checkpoints.some((checkpoint) => checkpoint.status === "waiting") ||
            !requiredChecksPass(
              task.build,
              task.build.checks.map((check) => check.id),
            )
          ) {
            throw new Error(
              "The fixture adapter cannot bypass incomplete phases, waiting checkpoints, or checks that have not passed.",
            );
          }
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
            build: {
              ...task.build,
              phases,
              resultingCommitSha: commitSha,
              activePhaseId: null,
              activeWorkItemId: null,
            },
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
        case "task.stage.request-changes": {
          const definition = definitionFor(task);
          if (definition.availableInFirstSlice !== true || !task.planGate) {
            return yield* taskError(
              command,
              `Workflow '${definition.version}' has no open Plan gate to request changes on.`,
            );
          }
          if (command.expectedTaskRevision !== task.taskRevision) {
            return yield* taskError(
              command,
              `Task revision ${task.taskRevision} does not match the expected revision ${command.expectedTaskRevision}.`,
            );
          }
          const gate = task.planGate;
          if (gate.status !== "open") {
            return yield* taskError(
              command,
              `The Plan gate is '${gate.status}' and cannot accept changes.`,
            );
          }
          const occurrence = task.occurrences.find(
            (candidate) => candidate.stage === "plan" && candidate.ordinal === gate.occurrence,
          );
          if (!occurrence || occurrence.status !== "awaiting-approval") {
            return yield* taskError(
              command,
              `Plan occurrence ${gate.occurrence} is not awaiting approval.`,
            );
          }
          const now = yield* serverNow;
          const nextOccurrence = allocateOccurrence(task, "plan", now);
          const bootstrap = yield* allocateStageBootstrap(task, "plan", nextOccurrence.ordinal);
          const continuationTask: TaskWorkspace = {
            ...task,
            planGate: null,
            gateHistory: [
              ...task.gateHistory,
              {
                occurrence: gate.occurrence,
                revision: gate.revision,
                outcome: "changes-requested",
                feedback: command.feedback,
                actor: "local-user",
                resolvedAt: now,
              },
            ],
            bootstrap: bootstrapStateFor(
              {
                operationKey: bootstrap.operationKey,
                sessionId: bootstrap.outboxPayload.sessionId,
                threadId: bootstrap.outboxPayload.threadId,
                threadCreateCommandId: bootstrap.outboxPayload.threadCreateCommandId,
                turnStartCommandId: bootstrap.outboxPayload.turnStartCommandId,
                kickoffMessageId: bootstrap.outboxPayload.kickoffMessageId,
              },
              bootstrap.now,
            ),
            occurrences: [
              ...task.occurrences.map((candidate) =>
                candidate.id === occurrence.id
                  ? {
                      ...candidate,
                      status: "completed" as const,
                      gateOutcome: "changes-requested" as const,
                      feedback: command.feedback,
                      completedAt: now,
                    }
                  : candidate,
              ),
              nextOccurrence,
            ],
            sessions: task.sessions.map((candidate) =>
              candidate.id === occurrence.sessionId
                ? { ...candidate, status: "completed" as const }
                : candidate,
            ),
          };
          return yield* append(command, continuationTask, {
            operationReceipt: {
              environmentId,
              taskId: task.id,
              operationType: "task.stage.request-changes",
              operationKey: command.operationKey,
              payloadDigest: canonicalTaskCommandDigest(command),
              status: "completed",
              attemptCount: 1,
              sourceCommandIds: [command.commandId],
              resultEventId: null,
              resultTaskRevision: null,
              error: null,
              createdAt: now,
              updatedAt: now,
            },
            outbox: [
              {
                target: "bootstrap" as const,
                operationKey: bootstrap.operationKey,
                payload: bootstrap.outboxPayload,
                status: "pending" as const,
              },
            ],
          });
        }
        case "task.worktree.policy.set": {
          if (command.policy === "never") {
            return yield* taskError(
              command,
              "Post-approval worktree policy can change from Never to Now or Later only.",
            );
          }
          if (command.expectedTaskRevision !== task.taskRevision) {
            return yield* taskError(
              command,
              `Task revision ${task.taskRevision} does not match the expected revision ${command.expectedTaskRevision}.`,
            );
          }
          if (task.preferences.worktreePolicy !== "never" || task.planGate !== null) {
            return yield* taskError(
              command,
              "Worktree policy changes are available only for a Never task after Plan approval.",
            );
          }
          const currentStage = currentRun(task).currentStage;
          const planOccurrence = latestOccurrence(task, "plan");
          const approvedGate = task.gateHistory.at(-1);
          if (
            currentStage !== "plan" ||
            !planOccurrence ||
            planOccurrence.status !== "completed" ||
            planOccurrence.gateOutcome !== "approved" ||
            !approvedGate ||
            approvedGate.occurrence !== planOccurrence.ordinal ||
            approvedGate.outcome !== "approved"
          ) {
            return yield* taskError(
              command,
              "The Plan must be approved before a Never task can provision a worktree.",
            );
          }
          const repository = task.workspace.repositories[0];
          if (!repository || !repository.baseCommitSha) {
            return yield* taskError(command, "The task has no pinned repository base commit.");
          }
          const headSha = yield* runGit(repository.workspaceRoot, ["rev-parse", "HEAD"]).pipe(
            Effect.mapError((cause) =>
              taskError(command, "Failed to revalidate the planning root.", cause),
            ),
          );
          const statusPorcelain = yield* runGit(repository.workspaceRoot, [
            "status",
            "--porcelain=v2",
          ]).pipe(
            Effect.mapError((cause) =>
              taskError(command, "Failed to revalidate the planning root.", cause),
            ),
          );
          const fingerprint = createHash("sha256")
            .update(`${headSha}\n${statusPorcelain}`)
            .digest("hex");
          if (
            repository.planningRootFingerprint === null ||
            repository.planningRootFingerprint !== fingerprint
          ) {
            return yield* taskError(
              command,
              "The planning root drifted since creation; restore the pinned source state before provisioning.",
            );
          }
          const now = yield* serverNow;
          const branch = `katacode/task-${safeBranchSegment(task.id)}`;
          const path = expectedTaskWorktreePath(
            config.worktreesDir,
            repository.workspaceRoot,
            branch,
          );
          const worktreeOperationKey = `${task.id}:worktree:${repository.baseCommitSha}:${command.policy}`;
          const nextTask: TaskWorkspace = {
            ...task,
            preferences: { ...task.preferences, worktreePolicy: command.policy },
            workspace: {
              repositories: task.workspace.repositories.map((candidate) =>
                candidate.id === repository.id
                  ? { ...candidate, provisioningStatus: "pending" as const }
                  : candidate,
              ),
            },
          };
          return yield* append(command, nextTask, {
            operationReceipt: {
              environmentId,
              taskId: task.id,
              operationType: "task.worktree.policy.set",
              operationKey: command.operationKey,
              payloadDigest: canonicalTaskCommandDigest(command),
              status: "completed",
              attemptCount: 1,
              sourceCommandIds: [command.commandId],
              resultEventId: null,
              resultTaskRevision: null,
              error: null,
              createdAt: now,
              updatedAt: now,
            },
            outbox: [
              {
                target: "worktree" as const,
                operationKey: worktreeOperationKey,
                payload: {
                  branch,
                  path,
                  baseCommitSha: repository.baseCommitSha,
                  sourceWorkspaceRoot: repository.workspaceRoot,
                },
                status: "pending" as const,
              },
            ],
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
      const error = isTaskWorkspaceError(cause)
        ? cause
        : taskError(
            command,
            cause instanceof Error ? cause.message : "Task command failed.",
            cause,
          );
      yield* store
        .commit({
          environmentId,
          events: [],
          commandReceipt: {
            environmentId,
            commandId: command.commandId,
            taskId: command.taskId,
            commandType: command.type,
            commandDigest: canonicalTaskCommandDigest(command),
            operationKey: operationKeyFor(command),
            status: "rejected",
            resultEventId: null,
            error: error.message,
            createdAt: command.createdAt,
          },
        })
        .pipe(Effect.catch(() => Effect.void));
      return yield* error;
    }
  });

  const dispatch: TaskWorkspaceServiceShape["dispatch"] = (command) =>
    semaphore.withPermits(1)(dispatchUnlocked(command));

  const implementationContext: TaskWorkspaceServiceShape["implementationContext"] = (taskId) =>
    Effect.gen(function* () {
      const task = taskById.get(taskId);
      if (!task)
        return yield* new TaskWorkspaceError({ message: `Task '${taskId}' was not found.` });
      const plan = latestPlanRevision(task);
      if (!plan || task.build.currentPlanRevisionId !== plan.id) {
        return yield* new TaskWorkspaceError({
          message: "The approved implementation Plan is unavailable.",
        });
      }
      return {
        stage: "build",
        occurrence: latestOccurrence(task, "build")?.ordinal ?? 0,
        brief: task.intake.brief,
        planRevisionId: plan.id,
        planMarkdown: plan.markdown.slice(0, 40_000),
        phases: task.build.phases,
        checks: task.build.checks,
        checkpoints: task.build.checkpoints,
        amendments: task.build.amendments,
        currentCommitSha: task.build.resultingCommitSha,
      } satisfies TaskImplementationContextResult;
    });

  const serverCommand = (taskId: TaskWorkspaceId, type: string, fields: Record<string, unknown>) =>
    Effect.gen(function* () {
      const commandId = CommandId.make(`server:implementation:${yield* serverUuid}`);
      const createdAt = yield* serverNow;
      return yield* dispatch({
        commandId,
        taskId,
        createdAt,
        type,
        ...fields,
      } as TaskWorkspaceCommand);
    });

  const implementationProgress: TaskWorkspaceServiceShape["implementationProgress"] = (input) =>
    serverCommand(input.taskId, "task.implementation.progress", input).pipe(
      Effect.map((result) => ({
        accepted: true as const,
        phaseId: input.phaseId,
        workItemId: input.workItemId,
        status: input.status,
        taskRevision: result.task.taskRevision,
      })),
    );
  const implementationCheckRun: TaskWorkspaceServiceShape["implementationCheckRun"] = (input) =>
    serverCommand(input.taskId, "task.implementation.check.run", input).pipe(
      Effect.map((result) => {
        const check = result.task.build.checks.find((candidate) => candidate.id === input.checkId);
        const attemptId =
          result.task.build.checkAttempts.at(-1)?.id ?? `attempt-${input.operationKey}`;
        return {
          accepted: true as const,
          checkId: input.checkId,
          attemptId,
          status: check?.status ?? "pending",
          taskRevision: result.task.taskRevision,
        };
      }),
    );
  const implementationAmendmentPropose: TaskWorkspaceServiceShape["implementationAmendmentPropose"] =
    (input) =>
      serverCommand(input.taskId, "task.implementation.amendment.propose", input).pipe(
        Effect.map((result) => ({
          accepted: true as const,
          amendmentId: result.task.build.amendments.at(-1)!.id,
          taskRevision: result.task.taskRevision,
        })),
      );
  const implementationComplete: TaskWorkspaceServiceShape["implementationComplete"] = (input) =>
    serverCommand(input.taskId, "task.implementation.complete", input).pipe(
      Effect.map((result) => ({
        accepted: true as const,
        proposalId:
          result.task.occurrences.find((candidate) => candidate.stage === "build")
            ?.completionProposalId ?? `proposal-${input.operationKey}`,
        providerTurnId: input.providerTurnId,
      })),
    );

  const latestOccurrence = (
    task: TaskWorkspace,
    stage: TaskWorkspaceStage,
  ): TaskWorkspaceStageOccurrence | null =>
    task.occurrences
      .filter((occurrence) => occurrence.stage === stage)
      .toSorted((left, right) => right.ordinal - left.ordinal)[0] ?? null;

  const activeOccurrence = (
    task: TaskWorkspace,
    stage: TaskWorkspaceStage,
  ): TaskWorkspaceStageOccurrence | null => {
    const latest = latestOccurrence(task, stage);
    if (!latest) return null;
    if (latest.status === "completed" || latest.status === "failed") return null;
    return latest;
  };

  const allocateOccurrence = (
    task: TaskWorkspace,
    stage: TaskWorkspaceStage,
    createdAt: string,
  ): TaskWorkspaceStageOccurrence => {
    const maxOrdinal = task.occurrences
      .filter((occurrence) => occurrence.stage === stage)
      .reduce((max, occurrence) => Math.max(max, occurrence.ordinal), -1);
    const ordinal = maxOrdinal + 1;
    return {
      id: `occurrence-${stage}-${ordinal}`,
      stage,
      ordinal,
      status: "starting",
      sessionId: null,
      threadId: null,
      contextManifestId: null,
      artifactRevisionId: null,
      completionProposalId: null,
      gateOutcome: null,
      feedback: null,
      supersedesOccurrenceId: null,
      createdAt,
      completedAt: null,
    };
  };

  /** Allocate deterministic bootstrap identities for a stage occurrence. */
  const allocateStageBootstrap = (
    task: TaskWorkspace,
    stage: TaskWorkspaceStage,
    occurrence: number,
    options?: {
      readonly executionProfile?: TaskWorkspace["preferences"]["executionProfile"];
      readonly presentation?: string;
      readonly worktreeBranch?: string | null;
      readonly worktreePath?: string | null;
    },
  ) =>
    Effect.gen(function* () {
      const operationKey = `${task.id}:bootstrap:${stage}:${occurrence}:primary`;
      const sessionId = `${task.id}-session-${stage}-${occurrence}`;
      const threadId = ThreadId.make(`thread-task-${yield* serverUuid}`);
      const threadCreateCommandId = CommandId.make(
        `server:task-thread-create:${yield* serverUuid}`,
      );
      const turnStartCommandId = CommandId.make(`server:task-turn-start:${yield* serverUuid}`);
      const kickoffMessageId = MessageId.make(`message-task-${yield* serverUuid}`);
      const now = yield* serverNow;
      const repository = task.workspace.repositories[0];
      const branch =
        options?.worktreeBranch !== undefined
          ? options.worktreeBranch
          : task.preferences.worktreePolicy === "now" && repository
            ? `katacode/task-${safeBranchSegment(task.id)}`
            : null;
      const worktreePath =
        options?.worktreePath !== undefined
          ? options.worktreePath
          : branch && repository
            ? expectedTaskWorktreePath(config.worktreesDir, repository.workspaceRoot, branch)
            : null;
      const executionProfile = options?.executionProfile ?? task.preferences.executionProfile;
      const presentation =
        options?.presentation ?? (stage === "build" ? "implementation" : "stage");
      const outboxPayload: TaskWorkspaceBootstrapOutboxPayload = {
        stage,
        occurrence,
        executionProfile,
        presentation,
        sessionId,
        threadId,
        threadCreateCommandId,
        turnStartCommandId,
        kickoffMessageId,
        trustedInstructions:
          executionProfile === "task-worktree-write"
            ? trustedImplementationInstructions()
            : trustedStageInstructions(stage),
        worktreeBranch: branch,
        worktreePath,
      };
      return { operationKey, sessionId, threadId, now, outboxPayload };
    });

  const bootstrapStateFor = (
    input: {
      readonly operationKey: string;
      readonly executionProfile?: TaskWorkspace["preferences"]["executionProfile"];
      readonly presentation?: string;
      readonly sessionId: string;
      readonly threadId: ThreadId;
      readonly threadCreateCommandId: CommandId;
      readonly turnStartCommandId: CommandId;
      readonly kickoffMessageId: MessageId;
    },
    now: string,
  ): TaskWorkspaceBootstrapState => ({
    operationKey: input.operationKey,
    executionProfile: input.executionProfile ?? "planning",
    presentation: input.presentation ?? "stage",
    status: "pending",
    currentStep: null,
    reservedSessionId: input.sessionId,
    reservedThreadId: input.threadId,
    threadCreateCommandId: input.threadCreateCommandId,
    turnStartCommandId: input.turnStartCommandId,
    kickoffMessageId: input.kickoffMessageId,
    conversationTarget: null,
    attemptCount: 0,
    failure: null,
    updatedAt: now,
  });

  const decodeBootstrapPayload = Schema.decodeUnknownEffect(TaskWorkspaceBootstrapOutboxPayload);

  const waitForProviderTurnStart = (
    fromSequenceExclusive: number,
    taskId: TaskWorkspaceId,
    threadId: ThreadId,
  ): Effect.Effect<void, TaskWorkspaceError> =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const started = yield* orchestrationEngine.readEvents(fromSequenceExclusive).pipe(
          Stream.filter(
            (event) =>
              (event.type === "thread.session-set" &&
                event.payload.threadId === threadId &&
                event.payload.session.status === "running" &&
                event.payload.session.activeTurnId !== null) ||
              (event.type === "thread.activity-appended" &&
                event.payload.threadId === threadId &&
                event.payload.activity.kind === "provider-turn-terminal" &&
                event.payload.activity.turnId !== null),
          ),
          Stream.runHead,
          Effect.mapError(
            (cause) =>
              new TaskWorkspaceError({
                message: "Failed to observe the provider kickoff turn readiness.",
                commandType: "task.internal",
                taskId,
                cause,
              }),
          ),
        );
        if (Option.isSome(started)) return;
        yield* Effect.sleep("50 millis");
      }
      return yield* new TaskWorkspaceError({
        message: "The provider kickoff turn did not start or reach a terminal state.",
        commandType: "task.internal",
        taskId,
      });
    });

  /**
   * Server-owned bootstrap saga for one outbox row. Runs under the dispatch
   * semaphore; every step reconciles deterministic identities before side
   * effects run, so a restart worker retries the same targets without
   * allocating a second session or occurrence.
   */
  const proposeStageCompletion: TaskWorkspaceServiceShape["proposeStageCompletion"] = (input) =>
    semaphore.withPermits(1)(
      Effect.gen(function* () {
        const task = taskById.get(input.taskId);
        if (!task) {
          return yield* new TaskWorkspaceError({
            message: `Task '${input.taskId}' was not found.`,
            commandType: "task.internal",
            taskId: input.taskId,
          });
        }
        if (!task.bootstrap || task.occurrences.length === 0) {
          return yield* new TaskWorkspaceError({
            message: `Task '${input.taskId}' has no automatic stage flow.`,
            commandType: "task.internal",
            taskId: input.taskId,
          });
        }
        yield* validatePlanningRoot(input.taskId);
        const definition = definitionFor(task);
        const stage = currentRun(task).currentStage;
        const occurrence = activeOccurrence(task, stage);
        if (!occurrence) {
          return yield* new TaskWorkspaceError({
            message: `Stage '${stage}' has no active occurrence.`,
            commandType: "task.internal",
            taskId: input.taskId,
          });
        }
        const expectedSessionId = occurrence.sessionId ?? task.bootstrap?.reservedSessionId;
        if (expectedSessionId !== input.sessionId) {
          return yield* new TaskWorkspaceError({
            message: `Session '${input.sessionId}' is not the active primary for stage '${stage}'.`,
            commandType: "task.internal",
            taskId: input.taskId,
          });
        }
        if (occurrence.status !== "running" && occurrence.status !== "finalizing") {
          return yield* new TaskWorkspaceError({
            message: `Occurrence ${occurrence.ordinal} of '${stage}' is '${occurrence.status}' and cannot accept a proposal.`,
            commandType: "task.internal",
            taskId: input.taskId,
          });
        }
        if (definition.availableInFirstSlice !== true) {
          return yield* new TaskWorkspaceError({
            message: `Workflow '${definition.version}' does not support typed completion.`,
            commandType: "task.internal",
            taskId: input.taskId,
          });
        }
        // A gate-open Plan occurrence rejects replacement proposals until
        // Request changes allocates a continuation.
        if (stage === "plan" && task.planGate?.status === "open") {
          return yield* new TaskWorkspaceError({
            message: "The Plan gate is open; request changes before proposing another Plan.",
            commandType: "task.internal",
            taskId: input.taskId,
          });
        }
        const prior = yield* store
          .getProposal({
            taskId: input.taskId,
            occurrence: occurrence.ordinal,
            providerTurnId: input.providerTurnId,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new TaskWorkspaceError({
                  message: "Failed to read the completion proposal.",
                  commandType: "task.internal",
                  taskId: input.taskId,
                  cause,
                }),
            ),
          );
        if (Option.isSome(prior)) {
          if (prior.value.payloadDigest !== input.payloadDigest) {
            return yield* new TaskWorkspaceError({
              message: `A different completion proposal already exists for turn '${input.providerTurnId}'.`,
              commandType: "task.internal",
              taskId: input.taskId,
            });
          }
          return task;
        }
        const now = yield* serverNow;
        const proposalId = `proposal-${input.taskId}-${occurrence.ordinal}-${input.providerTurnId}`;
        const proposal: TaskWorkspaceCompletionProposal = {
          id: proposalId,
          environmentId,
          taskId: input.taskId,
          stage,
          occurrence: occurrence.ordinal,
          sessionId: input.sessionId,
          threadId: occurrence.threadId ?? ThreadId.make(`thread-${input.sessionId}`),
          providerTurnId: input.providerTurnId,
          payloadDigest: input.payloadDigest,
          summary: input.summary,
          markdown: input.markdown,
          status: "proposed",
          terminalTurnOutcome: null,
          committedArtifactRevisionId: null,
          rejectionReason: null,
          createdAt: now,
          settledAt: null,
        };
        const finalizingTask: TaskWorkspace = {
          ...task,
          occurrences: task.occurrences.map((candidate) =>
            candidate.id === occurrence.id
              ? {
                  ...candidate,
                  status: "finalizing" as const,
                  completionProposalId: proposalId,
                }
              : candidate,
          ),
        };
        const persistedTask = yield* internalAppend("task.proposal.proposed", finalizingTask, {
          occurredAt: now,
          proposal,
        });
        return persistedTask;
      }),
    );

  const commitStageCompletion = (
    task: TaskWorkspace,
    proposal: TaskWorkspaceCompletionProposal,
    now: string,
  ): Effect.Effect<
    {
      readonly task: TaskWorkspace;
      readonly bootstrap: {
        readonly operationKey: string;
        readonly sessionId: string;
        readonly threadId: ThreadId;
        readonly now: string;
        readonly outboxPayload: TaskWorkspaceBootstrapOutboxPayload;
      } | null;
    },
    TaskWorkspaceError
  > =>
    Effect.gen(function* () {
      const definition = definitionFor(task);
      const artifactKind = artifactKindForStage(definition, proposal.stage);
      if (!artifactKind) {
        return yield* new TaskWorkspaceError({
          message: `Stage '${proposal.stage}' produces no artifact.`,
          commandType: "task.internal",
          taskId: task.id,
        });
      }
      const withArtifact = upsertArtifact(task, {
        type: "task.artifact.upsert",
        commandId: CommandId.make(`server:task-proposal:${proposal.id}`),
        taskId: task.id,
        createdAt: now,
        kind: artifactKind,
        title: `${definition.stages.find((s) => s === proposal.stage) ?? proposal.stage} artifact`,
        markdown: proposal.markdown,
        sourceSessionId: proposal.sessionId,
      });
      const artifact = latestArtifact(withArtifact, artifactKind);
      if (!artifact) {
        return yield* new TaskWorkspaceError({
          message: "Failed to persist the stage artifact.",
          commandType: "task.internal",
          taskId: task.id,
        });
      }
      const occurrence = task.occurrences.find(
        (candidate) =>
          candidate.ordinal === proposal.occurrence && candidate.stage === proposal.stage,
      );
      if (!occurrence) {
        return yield* new TaskWorkspaceError({
          message: `Occurrence ${proposal.occurrence} of '${proposal.stage}' was not found.`,
          commandType: "task.internal",
          taskId: task.id,
        });
      }

      if (proposal.stage === "plan") {
        // Plan output opens a human approval gate for this exact revision.
        const planRevision = artifact.revision;
        const awaitingTask: TaskWorkspace = {
          ...withArtifact,
          occurrences: withArtifact.occurrences.map((candidate) =>
            candidate.id === occurrence.id
              ? {
                  ...candidate,
                  status: "awaiting-approval" as const,
                  artifactRevisionId: artifact.id,
                }
              : candidate,
          ),
          planGate: {
            occurrence: occurrence.ordinal,
            revision: planRevision,
            status: "open",
            feedback: null,
            openedAt: now,
            resolvedAt: null,
          },
        };
        return { task: awaitingTask, bootstrap: null };
      }

      // Early stages: complete the source occurrence and queue the next handoff.
      const transition = definition.transitions.find(
        (candidate) =>
          candidate.from === proposal.stage &&
          candidate.command ===
            (proposal.stage === "questions"
              ? "task.questions.complete"
              : proposal.stage === "research"
                ? "task.research.complete"
                : "task.design.complete"),
      );
      if (!transition) {
        return yield* new TaskWorkspaceError({
          message: `Workflow '${definition.version}' has no transition out of '${proposal.stage}'.`,
          commandType: "task.internal",
          taskId: task.id,
        });
      }
      const targetStage = transition.to;
      const nextOccurrence = allocateOccurrence(withArtifact, targetStage, now);
      const bootstrap = yield* allocateStageBootstrap(
        withArtifact,
        targetStage,
        nextOccurrence.ordinal,
      );
      const contextBudget = 12_000;
      let tokenEstimate = 0;
      let compressedBlockCount = 0;
      const contextKinds: ReadonlyArray<TaskWorkspaceArtifactKind> =
        targetStage === "research"
          ? ["questions"]
          : targetStage === "design"
            ? ["questions", "research"]
            : targetStage === "plan"
              ? ["questions", "research", "design"]
              : [];
      const artifactRefs = contextKinds.flatMap((kind) => {
        const artifact = latestArtifact(withArtifact, kind);
        if (!artifact) return [];
        const totalTokens = Math.ceil(artifact.markdown.length / 4);
        const availableTokens = Math.max(0, contextBudget - tokenEstimate);
        const selectedBlockCount =
          totalTokens <= availableTokens || artifact.blockIndex.length === 0
            ? artifact.blockIndex.length
            : Math.max(1, Math.floor((availableTokens / totalTokens) * artifact.blockIndex.length));
        const blockIds = artifact.blockIndex.slice(0, selectedBlockCount).map((block) => block.id);
        tokenEstimate += Math.min(totalTokens, availableTokens);
        compressedBlockCount += Math.max(0, artifact.blockIndex.length - blockIds.length);
        return [
          {
            kind,
            revision: artifact.revision,
            blockIds,
          },
        ];
      });
      const contextManifest: TaskWorkspaceContextManifest = {
        id: `manifest-${task.id}-${targetStage}-${nextOccurrence.ordinal}`,
        taskId: task.id,
        sessionId: bootstrap.outboxPayload.sessionId,
        artifactRefs,
        notes: "Server-selected prior-stage context for this handoff.",
        tokenEstimate,
        budget: contextBudget,
        summaryArtifactRef: null,
        compressedBlockCount,
        createdAt: bootstrap.now,
      };
      const handoffOccurrence = {
        ...nextOccurrence,
        contextManifestId: contextManifest.id,
      };
      const handoffTask: TaskWorkspace = {
        ...withArtifact,
        bootstrap: bootstrapStateFor(
          {
            operationKey: bootstrap.operationKey,
            sessionId: bootstrap.outboxPayload.sessionId,
            threadId: bootstrap.outboxPayload.threadId,
            threadCreateCommandId: bootstrap.outboxPayload.threadCreateCommandId,
            turnStartCommandId: bootstrap.outboxPayload.turnStartCommandId,
            kickoffMessageId: bootstrap.outboxPayload.kickoffMessageId,
          },
          bootstrap.now,
        ),
        workflowRuns: replaceCurrentRun(withArtifact, {
          currentStage: targetStage,
          updatedAt: now,
        }),
        contextManifests: [...withArtifact.contextManifests, contextManifest],
        occurrences: [
          ...withArtifact.occurrences.map((candidate) =>
            candidate.id === occurrence.id
              ? {
                  ...candidate,
                  status: "completed" as const,
                  artifactRevisionId: artifact.id,
                  completedAt: now,
                }
              : candidate,
          ),
          handoffOccurrence,
        ],
        sessions: withArtifact.sessions.map((candidate) =>
          candidate.id === proposal.sessionId
            ? { ...candidate, status: "completed" as const }
            : candidate,
        ),
      };
      return { task: handoffTask, bootstrap };
    });

  const settleProposal: TaskWorkspaceServiceShape["settleProposal"] = (input) =>
    semaphore.withPermits(1)(
      Effect.gen(function* () {
        const task = taskById.get(input.taskId);
        if (!task) {
          return yield* new TaskWorkspaceError({
            message: `Task '${input.taskId}' was not found.`,
            commandType: "task.internal",
            taskId: input.taskId,
          });
        }
        const proposal = yield* store
          .getProposal({
            taskId: input.taskId,
            occurrence: input.occurrence,
            providerTurnId: input.providerTurnId,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new TaskWorkspaceError({
                  message: "Failed to read the completion proposal.",
                  commandType: "task.internal",
                  taskId: input.taskId,
                  cause,
                }),
            ),
          );
        if (Option.isNone(proposal)) {
          return yield* new TaskWorkspaceError({
            message: `No proposal exists for turn '${input.providerTurnId}'.`,
            commandType: "task.internal",
            taskId: input.taskId,
          });
        }
        const pending = proposal.value;
        if (pending.status !== "proposed") {
          // Already settled; return the current task unchanged.
          return task;
        }
        const now = yield* serverNow;
        if (input.outcome !== "completed") {
          // Aborted or failed turn: reject the proposal and return to Running.
          const rejectedTask: TaskWorkspace = {
            ...task,
            occurrences: task.occurrences.map((candidate) =>
              candidate.id ===
              task.occurrences.find(
                (o) => o.ordinal === input.occurrence && o.stage === pending.stage,
              )?.id
                ? {
                    ...candidate,
                    status: "running" as const,
                    completionProposalId: null,
                  }
                : candidate,
            ),
          };
          const persistedTask = yield* internalAppend("task.proposal.rejected", rejectedTask, {
            occurredAt: now,
            proposal: {
              ...pending,
              status: "rejected",
              terminalTurnOutcome: input.outcome,
              rejectionReason:
                input.outcome === "aborted"
                  ? "The provider turn was aborted."
                  : "The provider turn failed.",
              settledAt: now,
            },
          });
          return persistedTask;
        }
        // Completed turn: commit the artifact and handoff atomically.
        const committed = yield* commitStageCompletion(task, pending, now);
        const settledTask: TaskWorkspace = {
          ...committed.task,
          occurrences: committed.task.occurrences.map((candidate) =>
            candidate.ordinal === pending.occurrence && candidate.stage === pending.stage
              ? { ...candidate, completionProposalId: null }
              : candidate,
          ),
        };
        const committedArtifact = committed.task.artifacts
          .find((artifact) => artifact.kind === pending.stage)
          ?.revisions.at(-1);
        const eventType =
          pending.stage === "plan" ? "task.gate.opened" : "task.occurrence.completed";
        const persistedTask = yield* internalAppend(eventType, settledTask, {
          occurredAt: now,
          proposal: {
            ...pending,
            status: "committed",
            terminalTurnOutcome: "completed",
            committedArtifactRevisionId: committedArtifact?.id ?? null,
            settledAt: now,
          },
          ...(pending.stage !== "plan" && committed.bootstrap
            ? {
                outbox: [
                  {
                    target: "bootstrap" as const,
                    operationKey: committed.bootstrap.operationKey,
                    payload: committed.bootstrap.outboxPayload,
                  },
                ],
              }
            : {}),
        });
        return persistedTask;
      }),
    );

  const reconcilePendingProposals: TaskWorkspaceServiceShape["reconcilePendingProposals"] =
    Effect.gen(function* () {
      const pending = yield* store.readPendingProposals().pipe(
        Effect.mapError(
          (cause) =>
            new TaskWorkspaceError({
              message: "Failed to read pending completion proposals.",
              commandType: "task.internal",
              cause,
            }),
        ),
      );
      if (pending.length === 0) return;
      const events = yield* orchestrationEngine.readEvents(0).pipe(
        Stream.runCollect,
        Effect.mapError(
          (cause) =>
            new TaskWorkspaceError({
              message: "Failed to read orchestration history for proposal recovery.",
              commandType: "task.internal",
              cause,
            }),
        ),
        Effect.map((chunk) => Array.from(chunk)),
      );
      for (const proposal of pending) {
        const terminalEvent = events.find(
          (event) =>
            event.type === "thread.activity-appended" &&
            event.payload.threadId === proposal.threadId &&
            event.payload.activity.turnId === proposal.providerTurnId &&
            event.payload.activity.kind === "provider-turn-terminal",
        );
        if (!terminalEvent || terminalEvent.type !== "thread.activity-appended") continue;
        const outcome = (terminalEvent.payload.activity.payload as { readonly outcome?: unknown })
          .outcome;
        if (outcome !== "completed" && outcome !== "aborted" && outcome !== "failed") continue;
        yield* settleProposal({
          taskId: proposal.taskId,
          occurrence: proposal.occurrence,
          providerTurnId: proposal.providerTurnId,
          outcome,
        }).pipe(Effect.asVoid);
      }
    });

  const decodeWorktreePayload = Schema.decodeUnknownEffect(TaskWorkspaceWorktreeOutboxPayload);

  const processWorktree = (
    entry: TaskWorkspaceOutboxEntry,
  ): Effect.Effect<void, TaskWorkspaceError> => {
    const failure = (cause: unknown): Effect.Effect<void, TaskWorkspaceError> =>
      Effect.gen(function* () {
        const task = taskById.get(entry.taskId);
        if (!task) {
          return yield* new TaskWorkspaceError({
            message: `Task '${entry.taskId}' was not found.`,
            commandType: "task.internal",
            taskId: entry.taskId,
          });
        }
        const now = yield* serverNow;
        const failedTask: TaskWorkspace = {
          ...task,
          workspace: {
            repositories: task.workspace.repositories.map((repository) =>
              repository.id === "primary"
                ? { ...repository, provisioningStatus: "failed" as const }
                : repository,
            ),
          },
        };
        yield* internalAppend("task.worktree.failed", failedTask, {
          occurredAt: now,
          operationReceipt: {
            environmentId,
            taskId: entry.taskId,
            operationType: "task.worktree.provision",
            operationKey: entry.operationKey,
            payloadDigest: "server-internal",
            status: "failed",
            attemptCount: entry.attemptCount + 1,
            sourceCommandIds: [],
            resultEventId: null,
            resultTaskRevision: null,
            error: describeFailure(cause),
            createdAt: now,
            updatedAt: now,
          },
          outbox: [{ ...entry, status: "failed" }],
        });
      });

    return semaphore
      .withPermits(1)(
        Effect.gen(function* () {
          const task = taskById.get(entry.taskId);
          if (!task) return yield* failure(new Error(`Task '${entry.taskId}' was not found.`));
          const payload = yield* decodeWorktreePayload(entry.payload).pipe(
            Effect.mapError(
              (cause) =>
                new TaskWorkspaceError({
                  message: "Failed to decode the worktree outbox payload.",
                  commandType: "task.internal",
                  taskId: entry.taskId,
                  cause,
                }),
            ),
          );
          yield* validatePlanningRoot(entry.taskId);
          const repository = task.workspace.repositories.find(
            (candidate) => candidate.workspaceRoot === payload.sourceWorkspaceRoot,
          );
          if (!repository || repository.baseCommitSha !== payload.baseCommitSha) {
            return yield* failure(
              new Error("The worktree outbox row does not match the pinned repository state."),
            );
          }
          const expectedBranch = `katacode/task-${safeBranchSegment(entry.taskId)}`;
          const expectedPath = expectedTaskWorktreePath(
            config.worktreesDir,
            repository.workspaceRoot,
            expectedBranch,
          );
          if (payload.branch !== expectedBranch || expectedPath !== payload.path) {
            return yield* failure(new Error("The worktree path is not the persisted reservation."));
          }
          const existing = yield* tryAdoptExistingWorktree(
            payload.path,
            payload.branch,
            payload.baseCommitSha,
            payload.sourceWorkspaceRoot,
          );
          const worktree =
            existing ??
            (yield* gitWorkflow
              .createWorktree({
                cwd: repository.workspaceRoot,
                refName: payload.baseCommitSha,
                newRefName: payload.branch,
                path: payload.path,
              })
              .pipe(
                Effect.catch((cause) =>
                  tryAdoptExistingWorktree(
                    payload.path,
                    payload.branch,
                    payload.baseCommitSha,
                    payload.sourceWorkspaceRoot,
                  ).pipe(
                    Effect.flatMap((adopted) =>
                      adopted
                        ? Effect.succeed(adopted)
                        : Effect.fail(
                            new TaskWorkspaceError({
                              message: "Failed to provision the task worktree.",
                              commandType: "task.internal",
                              taskId: entry.taskId,
                              cause,
                            }),
                          ),
                    ),
                  ),
                ),
              ));
          const now = yield* serverNow;
          let readyTask: TaskWorkspace = {
            ...task,
            workspace: {
              repositories: task.workspace.repositories.map((candidate) =>
                candidate.id === repository.id
                  ? {
                      ...candidate,
                      branch: worktree.worktree.refName,
                      worktreePath: worktree.worktree.path,
                      provisioningStatus: "ready" as const,
                    }
                  : candidate,
              ),
            },
          };
          const run = currentRun(readyTask);
          const approvedPlan = latestPlanRevision(readyTask);
          const approvedPlanOccurrence = latestOccurrence(readyTask, "plan");
          let implementationEligible = Option.isNone(providerInstanceRegistry);
          if (Option.isSome(providerInstanceRegistry) && readyTask.preferences.modelSelection) {
            const provider = yield* providerInstanceRegistry.value.getInstance(
              readyTask.preferences.modelSelection.instanceId,
            );
            implementationEligible = Boolean(
              provider?.enabled && supportsTaskWorktreeWrite(provider.adapter.capabilities),
            );
          }
          const shouldStartImplementation =
            implementationEligible &&
            run.definitionVersion === "guided@0.3.0" &&
            run.currentStage === "plan" &&
            readyTask.planGate === null &&
            approvedPlan !== null &&
            approvedPlanOccurrence?.status === "completed" &&
            approvedPlanOccurrence.gateOutcome === "approved" &&
            !readyTask.occurrences.some((candidate) => candidate.stage === "build") &&
            readyTask.bootstrap === null;
          let chainedOutbox: ReadonlyArray<{
            readonly target: "bootstrap";
            readonly operationKey: string;
            readonly payload: unknown;
            readonly status: "pending";
          }> = [];
          if (shouldStartImplementation) {
            const buildOccurrence = allocateOccurrence(readyTask, "build", now);
            const bootstrap = yield* allocateStageBootstrap(
              readyTask,
              "build",
              buildOccurrence.ordinal,
              {
                executionProfile: "task-worktree-write",
                presentation: "implementation",
                worktreeBranch: worktree.worktree.refName,
                worktreePath: worktree.worktree.path,
              },
            );
            readyTask = {
              ...readyTask,
              preferences: { ...readyTask.preferences, executionProfile: "task-worktree-write" },
              bootstrap: bootstrapStateFor(
                {
                  operationKey: bootstrap.operationKey,
                  executionProfile: "task-worktree-write",
                  presentation: "implementation",
                  sessionId: bootstrap.outboxPayload.sessionId,
                  threadId: bootstrap.outboxPayload.threadId,
                  threadCreateCommandId: bootstrap.outboxPayload.threadCreateCommandId,
                  turnStartCommandId: bootstrap.outboxPayload.turnStartCommandId,
                  kickoffMessageId: bootstrap.outboxPayload.kickoffMessageId,
                },
                bootstrap.now,
              ),
              workflowRuns: replaceCurrentRun(readyTask, { currentStage: "build", updatedAt: now }),
              occurrences: [...readyTask.occurrences, buildOccurrence],
            };
            chainedOutbox = [
              {
                target: "bootstrap",
                operationKey: bootstrap.operationKey,
                payload: bootstrap.outboxPayload,
                status: "pending",
              },
            ];
          }
          yield* internalAppend("task.worktree.ready", readyTask, {
            occurredAt: now,
            operationReceipt: {
              environmentId,
              taskId: entry.taskId,
              operationType: "task.worktree.provision",
              operationKey: entry.operationKey,
              payloadDigest: "server-internal",
              status: "completed",
              attemptCount: entry.attemptCount + 1,
              sourceCommandIds: [],
              resultEventId: null,
              resultTaskRevision: null,
              error: null,
              createdAt: now,
              updatedAt: now,
            },
            outbox: [{ ...entry, status: "completed" }, ...chainedOutbox],
          });
        }),
      )
      .pipe(
        Effect.catch((cause) => failure(cause)),
        Effect.mapError((cause) =>
          isTaskWorkspaceError(cause)
            ? cause
            : new TaskWorkspaceError({
                message: describeFailure(cause),
                commandType: "task.internal",
                taskId: entry.taskId,
                cause,
              }),
        ),
      );
  };

  const processBootstrap = (
    entry: TaskWorkspaceOutboxEntry,
  ): Effect.Effect<void, TaskWorkspaceError> => {
    const failure = (step: string, cause: unknown): Effect.Effect<void, TaskWorkspaceError> =>
      Effect.gen(function* () {
        const now = yield* serverNow;
        const failedTask: TaskWorkspace = {
          ...taskById.get(entry.taskId)!,
          bootstrap: {
            ...taskById.get(entry.taskId)!.bootstrap!,
            status: "failed",
            currentStep: step,
            attemptCount: (taskById.get(entry.taskId)!.bootstrap!.attemptCount ?? 0) + 1,
            failure: {
              step,
              message: describeFailure(cause),
              occurredAt: now,
            },
            updatedAt: now,
          },
        };
        yield* internalAppend("task.bootstrap.failed", failedTask, {
          occurredAt: now,
          operationReceipt: {
            environmentId,
            taskId: entry.taskId,
            operationType: "task.bootstrap",
            operationKey: entry.operationKey,
            payloadDigest: "server-internal",
            status: "failed",
            attemptCount: entry.attemptCount + 1,
            sourceCommandIds: [],
            resultEventId: null,
            resultTaskRevision: null,
            error: describeFailure(cause),
            createdAt: now,
            updatedAt: now,
          },
          outbox: [{ ...entry, status: "failed" }],
        });
      });
    return semaphore
      .withPermits(1)(
        Effect.gen(function* () {
          const task = taskById.get(entry.taskId);
          if (!task || task.bootstrap?.operationKey !== entry.operationKey) {
            // Stale outbox row for a task that no longer owns this operation.
            yield* store.upsertOutbox({ ...entry, status: "failed" }).pipe(
              Effect.mapError(
                (cause) =>
                  new TaskWorkspaceError({
                    message: "Failed to mark a stale bootstrap row failed.",
                    commandType: "task.internal",
                    taskId: entry.taskId,
                    cause,
                  }),
              ),
            );
            return;
          }
          if (task.bootstrap?.status === "ready") {
            yield* store.upsertOutbox({ ...entry, status: "completed" }).pipe(
              Effect.mapError(
                (cause) =>
                  new TaskWorkspaceError({
                    message: "Failed to reconcile a completed bootstrap.",
                    commandType: "task.internal",
                    taskId: entry.taskId,
                    cause,
                  }),
              ),
            );
            return;
          }
          const payload = yield* decodeBootstrapPayload(entry.payload).pipe(
            Effect.mapError(
              (cause) =>
                new TaskWorkspaceError({
                  message: "Failed to decode the bootstrap outbox payload.",
                  commandType: "task.internal",
                  taskId: entry.taskId,
                  cause,
                }),
            ),
          );
          // Step 1: provision or reconcile the worktree when policy requires it.
          let working = task;
          const repository = working.workspace.repositories[0]!;
          if (payload.executionProfile === "task-worktree-write") {
            const expectedBranch = `katacode/task-${safeBranchSegment(entry.taskId)}`;
            const expectedPath = expectedTaskWorktreePath(
              config.worktreesDir,
              repository.workspaceRoot,
              expectedBranch,
            );
            if (
              payload.worktreeBranch !== expectedBranch ||
              payload.worktreePath !== expectedPath
            ) {
              return yield* failure(
                "worktree",
                new Error("The implementation bootstrap reservation is not canonical."),
              );
            }
          }
          if (working.preferences.worktreePolicy === "now" && repository.worktreePath === null) {
            const branch = payload.worktreeBranch;
            const worktreePath = payload.worktreePath;
            if (!branch || !worktreePath) {
              return yield* failure("worktree", new Error("Missing reserved worktree identity."));
            }
            const baseCommit = repository.baseCommitSha;
            if (!baseCommit) {
              return yield* failure("worktree", new Error("The base commit is not pinned."));
            }
            const existing = yield* tryAdoptExistingWorktree(
              worktreePath,
              branch,
              baseCommit,
              repository.workspaceRoot,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new TaskWorkspaceError({
                    message: "Failed to reconcile the task worktree.",
                    commandType: "task.internal",
                    taskId: entry.taskId,
                    cause,
                  }),
              ),
            );
            const worktree =
              existing ??
              (yield* gitWorkflow
                .createWorktree({
                  cwd: repository.workspaceRoot,
                  refName: baseCommit,
                  newRefName: branch,
                  path: worktreePath,
                })
                .pipe(
                  Effect.catch((cause) =>
                    tryAdoptExistingWorktree(
                      worktreePath,
                      branch,
                      baseCommit,
                      repository.workspaceRoot,
                    ).pipe(
                      Effect.flatMap((adopted) =>
                        adopted
                          ? Effect.succeed(adopted)
                          : Effect.fail(
                              new TaskWorkspaceError({
                                message: "Failed to provision the task worktree.",
                                commandType: "task.internal",
                                taskId: entry.taskId,
                                cause,
                              }),
                            ),
                      ),
                    ),
                  ),
                ));
            const worktreeFingerprint = yield* planningRootFingerprint(worktree.worktree.path).pipe(
              Effect.mapError(
                (cause) =>
                  new TaskWorkspaceError({
                    message: "Failed to fingerprint the task worktree.",
                    commandType: "task.internal",
                    taskId: entry.taskId,
                    cause,
                  }),
              ),
            );
            const worktreeReadyAt = yield* serverNow;
            working = yield* internalAppend(
              "task.bootstrap.step-completed",
              {
                ...working,
                bootstrap: {
                  ...working.bootstrap!,
                  status: "running",
                  currentStep: "worktree",
                  updatedAt: worktreeReadyAt,
                },
                workspace: {
                  repositories: working.workspace.repositories.map((candidate) =>
                    candidate.id === repository.id
                      ? {
                          ...candidate,
                          branch: worktree.worktree.refName,
                          worktreePath: worktree.worktree.path,
                          provisioningStatus: "ready" as const,
                          planningRootFingerprint: worktreeFingerprint,
                        }
                      : candidate,
                  ),
                },
              },
              { occurredAt: worktreeReadyAt },
            );
          }

          // Step 2: create or reconcile the reserved thread through orchestration.
          if (working.bootstrap?.status !== "running") {
            const bootstrapStartedAt = yield* serverNow;
            working = yield* internalAppend(
              "task.bootstrap.step-completed",
              {
                ...working,
                bootstrap: {
                  ...working.bootstrap!,
                  status: "running",
                  currentStep: "thread",
                  updatedAt: bootstrapStartedAt,
                },
              },
              { occurredAt: bootstrapStartedAt },
            );
          }
          const now = yield* serverNow;
          const projectId = working.workspace.repositories[0]!.projectId;
          const modelSelection = working.preferences.modelSelection;
          if (!modelSelection) {
            return yield* failure("thread", new Error("The task has no model selection."));
          }
          yield* orchestrationEngine
            .dispatch({
              type: "thread.create",
              commandId: payload.threadCreateCommandId,
              threadId: payload.threadId,
              projectId,
              title: `Task: ${working.title}`,
              modelSelection,
              runtimeMode:
                payload.executionProfile === "task-worktree-write"
                  ? "auto-accept-edits"
                  : "approval-required",
              interactionMode: "default",
              branch: working.workspace.repositories[0]!.branch,
              worktreePath: working.workspace.repositories[0]!.worktreePath,
              createdAt: now,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new TaskWorkspaceError({
                    message: "Failed to create the task thread.",
                    commandType: "task.internal",
                    taskId: entry.taskId,
                    cause,
                  }),
              ),
            );

          // Step 3: dispatch the deterministic kickoff message.
          const turnStart = yield* orchestrationEngine
            .dispatch({
              type: "thread.turn.start",
              commandId: payload.turnStartCommandId,
              threadId: payload.threadId,
              message: {
                messageId: payload.kickoffMessageId,
                role: "user",
                text:
                  payload.executionProfile === "task-worktree-write"
                    ? `Implement the approved Plan for task '${working.title}'. Use the implementation context tool and begin with the first eligible work item.`
                    : working.intake.brief,
                attachments: [],
              },
              developerInstructions:
                payload.trustedInstructions ??
                (payload.executionProfile === "task-worktree-write"
                  ? trustedImplementationInstructions()
                  : trustedStageInstructions(payload.stage)),
              modelSelection,
              runtimeMode:
                payload.executionProfile === "task-worktree-write"
                  ? "auto-accept-edits"
                  : "approval-required",
              interactionMode: "default",
              createdAt: now,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new TaskWorkspaceError({
                    message: "Failed to start the task kickoff turn.",
                    commandType: "task.internal",
                    taskId: entry.taskId,
                    cause,
                  }),
              ),
            );
          yield* waitForProviderTurnStart(turnStart.sequence, entry.taskId, payload.threadId);

          // Step 4: record Ready. The session is created and linked by Kata;
          // there is no manual thread linking in this workflow.
          const readyTask: TaskWorkspace = {
            ...working,
            bootstrap: {
              operationKey: working.bootstrap!.operationKey,
              executionProfile: payload.executionProfile,
              presentation: payload.presentation,
              status: "ready",
              currentStep: null,
              reservedSessionId: working.bootstrap!.reservedSessionId,
              reservedThreadId: working.bootstrap!.reservedThreadId,
              threadCreateCommandId: working.bootstrap!.threadCreateCommandId,
              turnStartCommandId: working.bootstrap!.turnStartCommandId,
              kickoffMessageId: working.bootstrap!.kickoffMessageId,
              conversationTarget: { environmentId, threadId: payload.threadId },
              attemptCount: working.bootstrap!.attemptCount ?? 0,
              failure: null,
              updatedAt: now,
            },
            sessions: [
              ...working.sessions,
              {
                id: payload.sessionId,
                stage: payload.stage,
                threadId: payload.threadId,
                role: "primary" as const,
                provider: modelSelection.instanceId,
                status: "active" as const,
                parentSessionId: null,
                forkPoint: null,
                contextManifestId: null,
                createdAt: now,
              },
            ],
            occurrences: working.occurrences.map((occurrence) =>
              occurrence.stage === payload.stage && occurrence.ordinal === payload.occurrence
                ? {
                    ...occurrence,
                    status: "running" as const,
                    sessionId: payload.sessionId,
                    threadId: payload.threadId,
                  }
                : occurrence,
            ),
          };
          yield* internalAppend("task.bootstrap.ready", readyTask, {
            occurredAt: now,
            operationReceipt: {
              environmentId,
              taskId: entry.taskId,
              operationType: "task.bootstrap",
              operationKey: entry.operationKey,
              payloadDigest: "server-internal",
              status: "completed",
              attemptCount: entry.attemptCount + 1,
              sourceCommandIds: [payload.threadCreateCommandId, payload.turnStartCommandId],
              resultEventId: null,
              resultTaskRevision: null,
              error: null,
              createdAt: now,
              updatedAt: now,
            },
            outbox: [{ ...entry, status: "completed" }],
          });
        }),
      )
      .pipe(
        Effect.catch((cause) => {
          if (isTaskWorkspaceError(cause)) {
            return failure(
              cause.message.includes("worktree")
                ? "worktree"
                : cause.message.includes("thread")
                  ? "thread"
                  : "bootstrap",
              cause,
            );
          }
          return failure("bootstrap", cause);
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isTaskWorkspaceError(cause)
            ? cause
            : new TaskWorkspaceError({
                message: describeFailure(cause),
                commandType: "task.internal",
                taskId: entry.taskId,
                cause,
              }),
        ),
      );
  };

  return TaskWorkspaceService.of({
    dispatch,
    implementationContext,
    implementationProgress,
    implementationCheckRun,
    implementationAmendmentPropose,
    implementationComplete,
    processBootstrap,
    processWorktree,
    proposeStageCompletion,
    settleProposal,
    settleProviderTurn,
    reconcilePendingProposals,
    validatePlanningRoot,
    validateProviderTurn,
    authorizeTaskStage,
    getActiveTaskStage,
    isTaskThread,
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

const taskWorkspaceLive = Effect.acquireRelease(
  make.pipe(
    Effect.tap((service) =>
      Effect.sync(() => {
        activeTaskWorkspaceService = service;
      }),
    ),
  ),
  (service) =>
    Effect.sync(() => {
      if (activeTaskWorkspaceService === service) activeTaskWorkspaceService = undefined;
    }),
);

export const layer = Layer.effect(TaskWorkspaceService, taskWorkspaceLive);
