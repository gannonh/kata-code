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

/** Maximum reviewed Plan size accepted by the strict Guided compiler. */
export const TASK_WORKSPACE_PLAN_MAX_CHARS = 100_000;

const ID = "[a-z][a-z0-9-]{0,63}";
const PHASE_HEADER = new RegExp(`^## Phase \\[phase:(${ID})\\] (.+?)\\s*$`, "gm");
const WORK_HEADER = new RegExp(`^### Work item \\[work:(${ID})\\] (.+?)\\s*$`, "gm");
const CHECK_LINE =
  /^\s*[-*]\s+(Automated|Manual) check\s+\[check:([a-z][a-z0-9-]{0,63})\]:\s*(.+?)\s*$/i;
const DEPENDENCIES = /^\s*Dependencies:\s*(.*?)\s*$/im;
const CHECK_PHRASE = /\b(?:Automated|Manual)\s+check\b/i;
const CHECKPOINT_LINE = /^\s*Checkpoint:\s*(.*?)\s*$/im;

type HeadingToken = {
  readonly level: number;
  readonly text: string;
  readonly index: number;
  readonly end: number;
};

function headings(markdown: string): HeadingToken[] {
  const tokens: HeadingToken[] = [];
  const headingPattern = /^(#{1,6})[ \t]+(.*?)\s*$/gm;
  for (const match of markdown.matchAll(headingPattern)) {
    const index = match.index ?? 0;
    tokens.push({
      level: match[1]!.length,
      text: match[2]!,
      index,
      end: index + match[0]!.length,
    });
  }
  return tokens;
}

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

/** Project a legacy or upgraded Plan that has no guided@0.3 structure. */
export function compileLegacyTaskWorkspacePlan(
  input: TaskWorkspacePlanCompilerInput,
  planRevisionId?: string,
): TaskWorkspaceCompiledPlan {
  const resolvedInput =
    typeof input === "string" && planRevisionId !== undefined
      ? { markdown: input, planRevisionId }
      : input;
  const { planRevisionId: resolvedPlanRevisionId } = revisionOf(resolvedInput);
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

/** Compile the reviewed guided@0.3 Plan Markdown into the durable Build graph. */
export function compileTaskWorkspacePlan(
  input: TaskWorkspacePlanCompilerInput,
  planRevisionId?: string,
): TaskWorkspaceCompiledPlan {
  const resolvedInput =
    typeof input === "string" && planRevisionId !== undefined
      ? { markdown: input, planRevisionId }
      : input;
  const { markdown, planRevisionId: resolvedPlanRevisionId } = revisionOf(resolvedInput);
  if (markdown.length > TASK_WORKSPACE_PLAN_MAX_CHARS) {
    fail(
      `Plan Markdown is too large (${markdown.length} chars; maximum is ${TASK_WORKSPACE_PLAN_MAX_CHARS}).`,
    );
  }
  const tokens = headings(markdown);
  const exactPhaseHeading = new RegExp(`^Phase \\[phase:(${ID})\\] (.+?)$`);
  const exactWorkHeading = new RegExp(`^Work item \\[work:(${ID})\\] (.+?)$`);
  for (const token of tokens) {
    if (
      token.level === 2 &&
      (token.text === "Phase" || token.text.startsWith("Phase ")) &&
      !exactPhaseHeading.test(token.text)
    )
      fail("phase headings must use '## Phase [phase:id] Title'.");
    if (
      token.level === 3 &&
      (token.text === "Work item" || token.text.startsWith("Work item ")) &&
      !exactWorkHeading.test(token.text)
    )
      fail("work item headings must use '### Work item [work:id] Title'.");
  }

  const phaseMatches = [...markdown.matchAll(PHASE_HEADER)];
  if (phaseMatches.length === 0) fail("phase headings must use '## Phase [phase:id] Title'.");
  const allWorkMatches = [...markdown.matchAll(WORK_HEADER)];
  const firstPhaseStart = phaseMatches[0]!.index ?? 0;
  if (allWorkMatches.some((match) => (match.index ?? 0) < firstPhaseStart))
    fail("work items must belong to a phase.");
  const lines = markdown.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }
  for (let lineIndex = 0; lineIndex < lineOffsets.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (!CHECK_PHRASE.test(line)) continue;
    const lineOffset = lineOffsets[lineIndex]!;
    const phaseIndex = phaseMatches.findIndex(
      (match, index) =>
        lineOffset >= (match.index ?? 0) &&
        lineOffset < (phaseMatches[index + 1]?.index ?? markdown.length),
    );
    const phaseMatch = phaseIndex < 0 ? undefined : phaseMatches[phaseIndex];
    const workMatches = phaseMatch
      ? allWorkMatches.filter(
          (match) =>
            (match.index ?? 0) >= (phaseMatch.index ?? 0) &&
            (match.index ?? 0) < (phaseMatches[phaseIndex + 1]?.index ?? markdown.length) &&
            (match.index ?? 0) <= lineOffset,
        )
      : [];
    const owner = workMatches.at(-1);
    if (!phaseMatch || !owner) fail("checks must belong to a work-item section.");
    const unknownSibling = tokens.some(
      (token) =>
        token.index > (owner.index ?? 0) &&
        token.index < lineOffset &&
        token.level >= 2 &&
        !(token.level === 3 && exactWorkHeading.test(token.text)),
    );
    if (unknownSibling) fail("checks under unknown sibling headings are ambiguous.");
    if (!CHECK_LINE.test(line)) fail("checks must use '[check:id]: Label | command' syntax.");
  }
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
    const workMatches = [...section.matchAll(WORK_HEADER)];
    if (workMatches.length === 0) fail(`phase '${phaseId}' must contain a work item.`);
    const preamble = section.slice(0, workMatches[0]!.index ?? 0);
    const checkpointMatch = preamble.match(CHECKPOINT_LINE);
    if (
      !checkpointMatch ||
      !["always", "manual-only", "on-failure", "never"].includes(checkpointMatch[1]!)
    ) {
      fail(`phase '${phaseId}' must declare a valid Checkpoint policy before its first work item.`);
    }
    const phase = emptyPhase(phaseId, title, checkpointMatch[1] as TaskWorkspaceCheckpointPolicy);

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
  const beforePhaseOrder = new Map(previous.phases.map((phase, index) => [phase.id, index]));
  const afterPhaseOrder = new Map(next.phases.map((phase, index) => [phase.id, index]));
  const workPosition = (plan: TaskWorkspaceCompiledPlan) => {
    const positions = new Map<string, { phaseId: string; phaseIndex: number; workIndex: number }>();
    plan.phases.forEach((phase, phaseIndex) =>
      phase.workItems.forEach((item, workIndex) =>
        positions.set(item.id, { phaseId: phase.id, phaseIndex, workIndex }),
      ),
    );
    return positions;
  };
  const beforeWorkPosition = workPosition(previous);
  const afterWorkPosition = workPosition(next);
  const sorted = (values: string[]) => values.sort();
  return {
    addedPhaseIds: sorted([...afterPhases.keys()].filter((id) => !beforePhases.has(id))),
    removedPhaseIds: sorted([...beforePhases.keys()].filter((id) => !afterPhases.has(id))),
    changedPhaseIds: sorted(
      [...afterPhases.keys()].filter(
        (id) =>
          (beforePhases.has(id) &&
            changed(
              {
                title: afterPhases.get(id)!.title,
                checkpointPolicy: afterPhases.get(id)!.checkpointPolicy,
              },
              {
                title: beforePhases.get(id)!.title,
                checkpointPolicy: beforePhases.get(id)!.checkpointPolicy,
              },
            )) ||
          beforePhaseOrder.get(id) !== afterPhaseOrder.get(id),
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
              position: afterWorkPosition.get(id),
            },
            {
              title: beforeWork.get(id)!.title,
              dependsOn: beforeWork.get(id)!.dependsOn,
              checkIds: beforeWork.get(id)!.checkIds,
              position: beforeWorkPosition.get(id),
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
  const phaseSeeds = new Set([
    ...diff.addedPhaseIds,
    ...diff.removedPhaseIds,
    ...diff.changedPhaseIds,
  ]);
  const seeds = new Set([
    ...diff.addedWorkItemIds,
    ...diff.removedWorkItemIds,
    ...diff.changedWorkItemIds,
    ...diff.addedCheckIds,
    ...diff.removedCheckIds,
    ...diff.changedCheckIds,
  ]);
  for (const phase of [...previous.phases, ...next.phases]) {
    if (phaseSeeds.has(phase.id)) {
      for (const item of phase.workItems) seeds.add(item.id);
    }
  }
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
  const phaseByWork = new Map<string, Set<string>>();
  for (const phase of [...previous.phases, ...next.phases]) {
    for (const item of phase.workItems) {
      const phaseIds = phaseByWork.get(item.id) ?? new Set<string>();
      phaseIds.add(phase.id);
      phaseByWork.set(item.id, phaseIds);
    }
  }
  const checkIds = [
    ...new Set([
      ...diff.addedCheckIds,
      ...diff.removedCheckIds,
      ...diff.changedCheckIds,
      ...[...previous.checks, ...next.checks]
        .filter((check) => check.workItemId !== null && invalidated.has(check.workItemId))
        .map((check) => check.id),
    ]),
  ].sort();
  return {
    workItemIds: [...invalidated].sort(),
    phaseIds: [
      ...new Set([
        ...diff.addedPhaseIds,
        ...diff.removedPhaseIds,
        ...diff.changedPhaseIds,
        ...[...invalidated].flatMap((id) => [...(phaseByWork.get(id) ?? [])]),
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

export function compileLegacyPlanToBuild(
  input: TaskWorkspacePlanCompilerInput,
  planRevisionId?: string,
): TaskWorkspaceCompiledPlan {
  return compileLegacyTaskWorkspacePlan(input, planRevisionId);
}

export const deriveStructuralDiff = structuralDiff;
export const diffCompiledPlans = structuralDiff;
export const deriveReverseDependencyInvalidation = reverseDependencyInvalidation;
export const deriveInvalidatedWorkItems = reverseDependencyInvalidation;
