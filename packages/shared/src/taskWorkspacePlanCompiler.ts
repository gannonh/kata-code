import type {
  TaskWorkspace,
  TaskWorkspaceBuildCheck,
  TaskWorkspaceBuildPhase,
  TaskWorkspaceCheckpointPolicy,
  TaskWorkspaceWorkItem,
} from "@kata-sh/code-contracts";

type BuildProjection = TaskWorkspace["build"];
type MutableWorkItem = Omit<TaskWorkspaceWorkItem, "dependsOn" | "checkIds"> & {
  dependsOn: string[];
  checkIds: string[];
};
type MutablePhase = Omit<TaskWorkspaceBuildPhase, "workItems" | "checkIds"> & {
  workItems: MutableWorkItem[];
  checkIds: string[];
};

export type TaskWorkspacePlanCompilerInput =
  | string
  | { readonly markdown: string; readonly planRevisionId: string };

export type TaskWorkspaceCompiledPlan = BuildProjection & {
  readonly planRevisionId: string;
};

const ID = "[a-z][a-z0-9-]{0,63}";
const PHASE_HEADER = new RegExp(`^##\\s+Phase\\s+\\[phase:(${ID})\\]\\s+(.+?)\\s*$`, "gm");
const WORK_HEADER = new RegExp(`^###\\s+Work item\\s+\\[work:(${ID})\\]\\s+(.+?)\\s*$`, "gm");
const CHECK_LINE =
  /^\s*[-*]\s+(Automated|Manual) check\s+\[check:([a-z][a-z0-9-]{0,63})\]:\s*(.+?)\s*$/i;
const DEPENDENCIES = /^\s*Dependencies:\s*(.*?)\s*$/im;
const CHECKPOINT = /^\s*Checkpoint:\s*(.*?)\s*$/im;

function fail(message: string): never {
  throw new Error(`Invalid implementation Plan: ${message}`);
}

function revisionOf(input: TaskWorkspacePlanCompilerInput): {
  markdown: string;
  planRevisionId: string;
} {
  if (typeof input === "string") return { markdown: input, planRevisionId: "plan-revision" };
  if (!input.planRevisionId.trim()) fail("planRevisionId must not be empty.");
  return { markdown: input.markdown, planRevisionId: input.planRevisionId };
}

function emptyPhase(
  id: string,
  title: string,
  checkpointPolicy: TaskWorkspaceCheckpointPolicy,
): MutablePhase {
  return {
    id,
    title,
    status: "pending",
    workItems: [],
    checkpointPolicy,
    checkIds: [],
    checkpointId: null,
    phaseCommitSha: null,
    startedAt: null,
    completedAt: null,
  };
}

function baseProjection(planRevisionId: string): TaskWorkspaceCompiledPlan {
  return {
    phases: [],
    resultingCommitSha: null,
    activePhaseId: null,
    activeWorkItemId: null,
    checks: [],
    checkpoints: [],
    amendments: [],
    checkAttempts: [],
    currentPlanRevisionId: planRevisionId,
    amendmentGateId: null,
    continuationSessionIds: [],
    planRevisionId,
  };
}

/** Compile the reviewed Plan Markdown into the durable Build graph. */
export function compileTaskWorkspacePlan(
  input: TaskWorkspacePlanCompilerInput,
  planRevisionId?: string,
): TaskWorkspaceCompiledPlan {
  const resolvedInput =
    typeof input === "string" && planRevisionId !== undefined
      ? { markdown: input, planRevisionId }
      : input;
  const { markdown, planRevisionId: resolvedPlanRevisionId } = revisionOf(resolvedInput);
  // Plans from earlier contract versions used prose headings. They receive the
  // compatibility projection; once the explicit id syntax is present, parsing
  // is strict and malformed sections are rejected.
  const hasExplicitPhaseSyntax = /^##\s+Phase\b.*\[phase:/im.test(markdown);
  if (!hasExplicitPhaseSyntax) {
    const phase = emptyPhase("phase:compatibility", "Implement approved Plan", "never");
    phase.workItems = [
      {
        id: "work:implement-approved-plan",
        title: "Implement approved Plan",
        status: "pending",
        summary: null,
        dependsOn: [],
        checkIds: [],
        invalidationReason: null,
      },
    ];
    return { ...baseProjection(resolvedPlanRevisionId), phases: [phase] };
  }

  const phaseMatches = [...markdown.matchAll(PHASE_HEADER)];
  if (phaseMatches.length === 0) fail("phase headings must use '## Phase [phase:id] Title'.");
  const ids = new Set<string>();
  const workItems: Array<{ item: TaskWorkspaceWorkItem; phaseIndex: number }> = [];
  const phases: MutablePhase[] = [];
  const checks: TaskWorkspaceBuildCheck[] = [];

  for (let phaseIndex = 0; phaseIndex < phaseMatches.length; phaseIndex += 1) {
    const phaseMatch = phaseMatches[phaseIndex]!;
    const phaseId = `phase:${phaseMatch[1]!}`;
    const title = phaseMatch[2]!.trim();
    if (!title) fail(`phase '${phaseId}' has an empty title.`);
    if (ids.has(phaseId)) fail(`duplicate id '${phaseId}'.`);
    ids.add(phaseId);
    const start = phaseMatch.index ?? 0;
    const end = phaseMatches[phaseIndex + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end);
    const checkpointMatch = section.match(CHECKPOINT);
    if (
      !checkpointMatch ||
      !["always", "manual-only", "on-failure", "never"].includes(checkpointMatch[1]!)
    ) {
      fail(`phase '${phaseId}' must declare a valid Checkpoint policy.`);
    }
    const phase = emptyPhase(phaseId, title, checkpointMatch[1] as TaskWorkspaceCheckpointPolicy);
    const workMatches = [...section.matchAll(WORK_HEADER)];
    if (workMatches.length === 0) fail(`phase '${phaseId}' must contain a work item.`);
    if (/^###\s+Work item\b/im.test(section) && workMatches.length === 0) {
      fail(`work item headings in phase '${phaseId}' are malformed.`);
    }

    for (let workIndex = 0; workIndex < workMatches.length; workIndex += 1) {
      const workMatch = workMatches[workIndex]!;
      const workId = `work:${workMatch[1]!}`;
      const workTitle = workMatch[2]!.trim();
      if (!workTitle) fail(`work item '${workId}' has an empty title.`);
      if (ids.has(workId)) fail(`duplicate id '${workId}'.`);
      ids.add(workId);
      const workStart = workMatch.index ?? 0;
      const workEnd = workMatches[workIndex + 1]?.index ?? section.length;
      const workSection = section.slice(workStart, workEnd);
      const dependencyMatch = workSection.match(DEPENDENCIES);
      const dependencies = dependencyMatch?.[1]
        ? dependencyMatch[1]
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
      const item: MutableWorkItem = {
        id: workId,
        title: workTitle,
        status: "pending",
        summary: null,
        dependsOn: dependencies,
        checkIds: [],
        invalidationReason: null,
      };
      phase.workItems.push(item);
      workItems.push({ item, phaseIndex });

      const lines = workSection.split("\n");
      for (const line of lines) {
        const checkMatch = line.match(CHECK_LINE);
        if (!checkMatch) {
          if (/\b(?:Automated|Manual) check\b/i.test(line)) {
            fail(`check in '${workId}' must use '[check:id]: Label | command' syntax.`);
          }
          continue;
        }
        const kind = checkMatch[1]!.toLowerCase() === "manual" ? "manual" : "automated";
        const checkId = `check:${checkMatch[2]!}`;
        if (ids.has(checkId)) fail(`duplicate id '${checkId}'.`);
        ids.add(checkId);
        const checkBody = checkMatch[3]!.trim();
        const separator = checkBody.indexOf("|");
        const label = (separator < 0 ? checkBody : checkBody.slice(0, separator)).trim();
        const command = separator < 0 ? null : checkBody.slice(separator + 1).trim();
        if (!label) fail(`check '${checkId}' has an empty label.`);
        if (kind === "automated" && !command)
          fail(`automated check '${checkId}' has an empty command.`);
        if (kind === "manual" && separator >= 0 && command === "")
          fail(`check '${checkId}' has an empty command.`);
        const check: TaskWorkspaceBuildCheck = {
          id: checkId,
          phaseId,
          workItemId: workId,
          kind,
          status: "pending",
          label,
          command: kind === "automated" ? command : null,
          output: null,
          note: null,
          exitCode: null,
          commitSha: null,
          startedAt: null,
          completedAt: null,
          attemptIds: [],
        };
        checks.push(check);
        phase.checkIds.push(checkId);
        item.checkIds.push(checkId);
      }
    }
    phases.push(phase);
  }

  const knownWork = new Set(workItems.map(({ item }) => item.id));
  for (const [index, { item }] of workItems.entries()) {
    for (const dependency of item.dependsOn) {
      if (!/^work:[a-z][a-z0-9-]{0,63}$/.test(dependency))
        fail(`work item '${item.id}' has invalid dependency '${dependency}'.`);
      if (!knownWork.has(dependency))
        fail(`work item '${item.id}' depends on missing '${dependency}'.`);
      const dependencyIndex = workItems.findIndex(
        ({ item: candidate }) => candidate.id === dependency,
      );
      if (dependencyIndex >= index)
        fail(`work item '${item.id}' depends on a forward work item '${dependency}'.`);
    }
  }
  // Explicit cycle detection keeps this invariant true if dependency ordering changes later.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(workItems.map(({ item }) => [item.id, item]));
  const visit = (id: string): void => {
    if (visiting.has(id)) fail(`work-item dependency cycle includes '${id}'.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const { item } of workItems) visit(item.id);

  // A check outside a work-item section has no deterministic owner.
  const firstWorkStartByPhase = phases.map((_phase, index) => {
    const match = phaseMatches[index]!;
    return match.index ?? 0;
  });
  for (const [index, phaseMatch] of phaseMatches.entries()) {
    const section = markdown.slice(
      phaseMatch.index ?? 0,
      phaseMatches[index + 1]?.index ?? markdown.length,
    );
    const firstWork = section.search(/^###\s+Work item\b/im);
    const prefix = firstWork < 0 ? section : section.slice(0, firstWork);
    if (/^\s*[-*].*\b(?:Automated|Manual) check\b/im.test(prefix)) {
      fail(`check ownership in phase '${phases[index]!.id}' is ambiguous.`);
    }
  }
  // Referencing this local keeps phase positions explicit for future parser changes.
  void firstWorkStartByPhase;
  return { ...baseProjection(resolvedPlanRevisionId), phases, checks };
}

export type TaskWorkspacePlanStructuralDiff = {
  readonly addedPhaseIds: ReadonlyArray<string>;
  readonly removedPhaseIds: ReadonlyArray<string>;
  readonly changedPhaseIds: ReadonlyArray<string>;
  readonly addedWorkItemIds: ReadonlyArray<string>;
  readonly removedWorkItemIds: ReadonlyArray<string>;
  readonly changedWorkItemIds: ReadonlyArray<string>;
  readonly addedCheckIds: ReadonlyArray<string>;
  readonly removedCheckIds: ReadonlyArray<string>;
  readonly changedCheckIds: ReadonlyArray<string>;
};

function mapPhases(plan: TaskWorkspaceCompiledPlan): Map<string, TaskWorkspaceBuildPhase> {
  return new Map(plan.phases.map((phase) => [phase.id, phase]));
}
function mapWork(plan: TaskWorkspaceCompiledPlan): Map<string, TaskWorkspaceWorkItem> {
  return new Map(plan.phases.flatMap((phase) => phase.workItems).map((item) => [item.id, item]));
}
function mapChecks(plan: TaskWorkspaceCompiledPlan): Map<string, TaskWorkspaceBuildCheck> {
  return new Map(plan.checks.map((check) => [check.id, check]));
}
function changed(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Compare two compiled graphs by stable ids, ignoring runtime progress fields. */
export function structuralDiff(
  previous: TaskWorkspaceCompiledPlan,
  next: TaskWorkspaceCompiledPlan,
): TaskWorkspacePlanStructuralDiff {
  const beforePhases = mapPhases(previous);
  const afterPhases = mapPhases(next);
  const beforeWork = mapWork(previous);
  const afterWork = mapWork(next);
  const beforeChecks = mapChecks(previous);
  const afterChecks = mapChecks(next);
  const sorted = (values: string[]) => values.sort();
  return {
    addedPhaseIds: sorted([...afterPhases.keys()].filter((id) => !beforePhases.has(id))),
    removedPhaseIds: sorted([...beforePhases.keys()].filter((id) => !afterPhases.has(id))),
    changedPhaseIds: sorted(
      [...afterPhases.keys()].filter(
        (id) =>
          beforePhases.has(id) &&
          changed(
            {
              title: afterPhases.get(id)!.title,
              checkpointPolicy: afterPhases.get(id)!.checkpointPolicy,
            },
            {
              title: beforePhases.get(id)!.title,
              checkpointPolicy: beforePhases.get(id)!.checkpointPolicy,
            },
          ),
      ),
    ),
    addedWorkItemIds: sorted([...afterWork.keys()].filter((id) => !beforeWork.has(id))),
    removedWorkItemIds: sorted([...beforeWork.keys()].filter((id) => !afterWork.has(id))),
    changedWorkItemIds: sorted(
      [...afterWork.keys()].filter(
        (id) =>
          beforeWork.has(id) &&
          changed(
            {
              title: afterWork.get(id)!.title,
              dependsOn: afterWork.get(id)!.dependsOn,
              checkIds: afterWork.get(id)!.checkIds,
            },
            {
              title: beforeWork.get(id)!.title,
              dependsOn: beforeWork.get(id)!.dependsOn,
              checkIds: beforeWork.get(id)!.checkIds,
            },
          ),
      ),
    ),
    addedCheckIds: sorted([...afterChecks.keys()].filter((id) => !beforeChecks.has(id))),
    removedCheckIds: sorted([...beforeChecks.keys()].filter((id) => !afterChecks.has(id))),
    changedCheckIds: sorted(
      [...afterChecks.keys()].filter(
        (id) =>
          beforeChecks.has(id) &&
          changed(
            {
              phaseId: afterChecks.get(id)!.phaseId,
              workItemId: afterChecks.get(id)!.workItemId,
              kind: afterChecks.get(id)!.kind,
              label: afterChecks.get(id)!.label,
              command: afterChecks.get(id)!.command,
            },
            {
              phaseId: beforeChecks.get(id)!.phaseId,
              workItemId: beforeChecks.get(id)!.workItemId,
              kind: beforeChecks.get(id)!.kind,
              label: beforeChecks.get(id)!.label,
              command: beforeChecks.get(id)!.command,
            },
          ),
      ),
    ),
  };
}

/** Return the server-derived reverse dependency closure for an amendment. */
export function reverseDependencyInvalidation(
  previous: TaskWorkspaceCompiledPlan,
  next: TaskWorkspaceCompiledPlan,
  diff: TaskWorkspacePlanStructuralDiff = structuralDiff(previous, next),
): {
  readonly workItemIds: ReadonlyArray<string>;
  readonly phaseIds: ReadonlyArray<string>;
  readonly checkIds: ReadonlyArray<string>;
} {
  const beforeWork = mapWork(previous);
  const afterWork = mapWork(next);
  const seeds = new Set([
    ...diff.addedWorkItemIds,
    ...diff.removedWorkItemIds,
    ...diff.changedWorkItemIds,
    ...diff.addedCheckIds,
    ...diff.removedCheckIds,
    ...diff.changedCheckIds,
    ...diff.addedPhaseIds,
    ...diff.removedPhaseIds,
    ...diff.changedPhaseIds,
  ]);
  const invalidated = new Set<string>();
  let changedSomething = true;
  while (changedSomething) {
    changedSomething = false;
    for (const item of [...beforeWork.values(), ...afterWork.values()]) {
      if (invalidated.has(item.id)) continue;
      const referencesChanged = item.dependsOn.some(
        (dependency) => seeds.has(dependency) || invalidated.has(dependency),
      );
      const checksChanged = item.checkIds.some((checkId) => seeds.has(checkId));
      if (seeds.has(item.id) || referencesChanged || checksChanged) {
        invalidated.add(item.id);
        changedSomething = true;
      }
    }
  }
  const phaseByWork = new Map<string, string>();
  for (const phase of [...previous.phases, ...next.phases])
    for (const item of phase.workItems) phaseByWork.set(item.id, phase.id);
  const checkIds = [
    ...new Set([...diff.addedCheckIds, ...diff.removedCheckIds, ...diff.changedCheckIds]),
  ].sort();
  return {
    workItemIds: [...invalidated].sort(),
    phaseIds: [
      ...new Set([
        ...diff.addedPhaseIds,
        ...diff.removedPhaseIds,
        ...diff.changedPhaseIds,
        ...[...invalidated]
          .map((id) => phaseByWork.get(id))
          .filter((id): id is string => id !== undefined),
      ]),
    ].sort(),
    checkIds,
  };
}

export function compilePlanToBuild(
  input: TaskWorkspacePlanCompilerInput,
  planRevisionId?: string,
): TaskWorkspaceCompiledPlan {
  return compileTaskWorkspacePlan(input, planRevisionId);
}

export const deriveStructuralDiff = structuralDiff;
export const diffCompiledPlans = structuralDiff;
export const deriveReverseDependencyInvalidation = reverseDependencyInvalidation;
export const deriveInvalidatedWorkItems = reverseDependencyInvalidation;
