import {
  EnvironmentId,
  type MessageId,
  type OrchestrationProposedPlanId,
  type OrchestrationReadModel,
  type OrchestrationThreadShell,
  type ProjectId,
  ProviderInstanceId,
  type ThreadId,
  type TurnId,
} from "@kata-sh/code-contracts";

/** Stable clock for deterministic wait/elapsed labels in fixtures. */
export const SIDEBAR_V2_FIXTURE_NOW_MS = Date.parse("2026-07-16T12:00:00.000Z");
export const SIDEBAR_V2_FIXTURE_NOW_ISO = new Date(SIDEBAR_V2_FIXTURE_NOW_MS).toISOString();

export const SIDEBAR_V2_LOCAL_ENV_ID = EnvironmentId.make("environment-local");
export const SIDEBAR_V2_REMOTE_ENV_ID = EnvironmentId.make("environment-remote");

export const SIDEBAR_V2_PROJECT_ALPHA = "project-alpha" as ProjectId;
export const SIDEBAR_V2_PROJECT_BETA = "project-beta" as ProjectId;

export type SidebarV2ScenarioId =
  | "mixed-tiers"
  | "waiting-only"
  | "working-timer"
  | "blocked-failed"
  | "idle-expand"
  | "picker-scope"
  | "meta-remote"
  | "scroll-30";

export const SIDEBAR_V2_SCENARIO_IDS = [
  "mixed-tiers",
  "waiting-only",
  "working-timer",
  "blocked-failed",
  "idle-expand",
  "picker-scope",
  "meta-remote",
  "scroll-30",
] as const satisfies readonly SidebarV2ScenarioId[];

export type SidebarV2ShellFlags = Pick<
  OrchestrationThreadShell,
  "hasPendingApprovals" | "hasPendingUserInput" | "hasActionableProposedPlan"
>;

export interface SidebarV2Scenario {
  readonly id: SidebarV2ScenarioId;
  readonly label: string;
  readonly snapshot: OrchestrationReadModel;
  /** Explicit shell attention flags keyed by thread id (required for tier UI). */
  readonly shellFlagsByThreadId: ReadonlyMap<string, SidebarV2ShellFlags>;
  /** Optional last-visited timestamps for Failed → slim red-dot density. */
  readonly lastVisitedAtByThreadId?: Readonly<Record<string, string>>;
  readonly bootstrapThreadId: ThreadId;
  readonly bootstrapProjectId: ProjectId;
}

function isoMinutesAgo(minutes: number): string {
  return new Date(SIDEBAR_V2_FIXTURE_NOW_MS - minutes * 60_000).toISOString();
}

function emptyFlags(): SidebarV2ShellFlags {
  return {
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function makeProject(input: {
  id: ProjectId;
  title: string;
  workspaceRoot: string;
}): OrchestrationReadModel["projects"][number] {
  return {
    id: input.id,
    title: input.title,
    workspaceRoot: input.workspaceRoot,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
    scripts: [],
    createdAt: SIDEBAR_V2_FIXTURE_NOW_ISO,
    updatedAt: SIDEBAR_V2_FIXTURE_NOW_ISO,
    deletedAt: null,
  };
}

function makeThread(input: {
  id: ThreadId;
  projectId: ProjectId;
  title: string;
  branch?: string | null;
  interactionMode?: "default" | "plan";
  sessionStatus?: "ready" | "running" | "starting" | "error";
  lastError?: string | null;
  latestTurn?: OrchestrationReadModel["threads"][number]["latestTurn"];
  proposedPlans?: OrchestrationReadModel["threads"][number]["proposedPlans"];
  updatedAt?: string;
}): OrchestrationReadModel["threads"][number] {
  const updatedAt = input.updatedAt ?? SIDEBAR_V2_FIXTURE_NOW_ISO;
  return {
    id: input.id,
    projectId: input.projectId,
    title: input.title,
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
    interactionMode: input.interactionMode ?? "default",
    runtimeMode: "full-access",
    branch: input.branch === undefined ? "main" : input.branch,
    worktreePath: null,
    latestTurn: input.latestTurn ?? null,
    createdAt: updatedAt,
    updatedAt,
    archivedAt: null,
    deletedAt: null,
    messages: [
      {
        id: `msg-user-${input.id}` as MessageId,
        role: "user",
        text: `Seed for ${input.title}`,
        turnId: null,
        streaming: false,
        createdAt: updatedAt,
        updatedAt,
      },
    ],
    activities: [],
    proposedPlans: input.proposedPlans ?? [],
    checkpoints: [],
    session: {
      threadId: input.id,
      status: input.sessionStatus ?? "ready",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: input.sessionStatus === "running" ? ("turn-active" as TurnId) : null,
      lastError: input.lastError ?? null,
      updatedAt,
    },
  };
}

function runningTurn(
  startedMinutesAgo: number,
): NonNullable<OrchestrationReadModel["threads"][number]["latestTurn"]> {
  const startedAt = isoMinutesAgo(startedMinutesAgo);
  return {
    turnId: "turn-working" as TurnId,
    state: "running",
    requestedAt: startedAt,
    startedAt,
    completedAt: null,
    assistantMessageId: null,
  };
}

function completedTurn(
  completedMinutesAgo: number,
): NonNullable<OrchestrationReadModel["threads"][number]["latestTurn"]> {
  const completedAt = isoMinutesAgo(completedMinutesAgo);
  const startedAt = isoMinutesAgo(completedMinutesAgo + 2);
  return {
    turnId: "turn-done" as TurnId,
    state: "completed",
    requestedAt: startedAt,
    startedAt,
    completedAt,
    assistantMessageId: null,
  };
}

export function toSidebarV2ShellSnapshot(
  snapshot: OrchestrationReadModel,
  shellFlagsByThreadId: ReadonlyMap<string, SidebarV2ShellFlags>,
) {
  return {
    snapshotSequence: snapshot.snapshotSequence,
    projects: snapshot.projects.map((project) => ({
      id: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      repositoryIdentity: project.repositoryIdentity ?? null,
      defaultModelSelection: project.defaultModelSelection,
      scripts: project.scripts,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })),
    threads: snapshot.threads.map((thread) => {
      const flags = shellFlagsByThreadId.get(thread.id) ?? emptyFlags();
      return {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        latestTurn: thread.latestTurn,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        archivedAt: thread.archivedAt,
        session: thread.session,
        latestUserMessageAt:
          thread.messages.findLast((message) => message.role === "user")?.createdAt ?? null,
        hasPendingApprovals: flags.hasPendingApprovals,
        hasPendingUserInput: flags.hasPendingUserInput,
        hasActionableProposedPlan: flags.hasActionableProposedPlan,
      };
    }),
    updatedAt: snapshot.updatedAt,
  };
}

function snapshotOf(
  projects: OrchestrationReadModel["projects"],
  threads: OrchestrationReadModel["threads"],
): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects,
    threads,
    updatedAt: SIDEBAR_V2_FIXTURE_NOW_ISO,
  };
}

function flags(
  entries: ReadonlyArray<readonly [ThreadId, SidebarV2ShellFlags]>,
): Map<string, SidebarV2ShellFlags> {
  return new Map(entries.map(([id, value]) => [id, value]));
}

const THREAD_APPROVAL = "thread-waiting-approval" as ThreadId;
const THREAD_INPUT = "thread-waiting-input" as ThreadId;
const THREAD_PLAN = "thread-waiting-plan" as ThreadId;
const THREAD_WORKING = "thread-working" as ThreadId;
const THREAD_BLOCKED = "thread-blocked-failed" as ThreadId;
const THREAD_IDLE = "thread-idle" as ThreadId;
const THREAD_IDLE_B = "thread-idle-beta" as ThreadId;
const THREAD_REMOTE = "thread-remote-meta" as ThreadId;

function alphaBetaProjects() {
  return [
    makeProject({
      id: SIDEBAR_V2_PROJECT_ALPHA,
      title: "kata-code",
      workspaceRoot: "/repo/kata-code",
    }),
    makeProject({
      id: SIDEBAR_V2_PROJECT_BETA,
      title: "docs-portal",
      workspaceRoot: "/repo/docs-portal",
    }),
  ];
}

function mixedThreads(): {
  threads: OrchestrationReadModel["threads"];
  shellFlagsByThreadId: Map<string, SidebarV2ShellFlags>;
} {
  const threads = [
    makeThread({
      id: THREAD_APPROVAL,
      projectId: SIDEBAR_V2_PROJECT_ALPHA,
      title: "Needs approval",
      latestTurn: completedTurn(40),
      updatedAt: isoMinutesAgo(40),
    }),
    makeThread({
      id: THREAD_INPUT,
      projectId: SIDEBAR_V2_PROJECT_ALPHA,
      title: "Awaiting your answer",
      latestTurn: completedTurn(25),
      updatedAt: isoMinutesAgo(25),
    }),
    makeThread({
      id: THREAD_WORKING,
      projectId: SIDEBAR_V2_PROJECT_ALPHA,
      title: "Implementing sidebar",
      sessionStatus: "running",
      latestTurn: runningTurn(3),
      updatedAt: isoMinutesAgo(3),
    }),
    makeThread({
      id: THREAD_BLOCKED,
      projectId: SIDEBAR_V2_PROJECT_ALPHA,
      title: "Provider crashed",
      sessionStatus: "error",
      lastError: "Provider exited with code 1",
      latestTurn: completedTurn(12),
      updatedAt: isoMinutesAgo(12),
    }),
    makeThread({
      id: THREAD_IDLE,
      projectId: SIDEBAR_V2_PROJECT_ALPHA,
      title: "Yesterday’s review notes",
      latestTurn: completedTurn(180),
      updatedAt: isoMinutesAgo(180),
    }),
  ];
  return {
    threads,
    shellFlagsByThreadId: flags([
      [THREAD_APPROVAL, { ...emptyFlags(), hasPendingApprovals: true }],
      [THREAD_INPUT, { ...emptyFlags(), hasPendingUserInput: true }],
      [THREAD_WORKING, emptyFlags()],
      [THREAD_BLOCKED, emptyFlags()],
      [THREAD_IDLE, emptyFlags()],
    ]),
  };
}

export function buildSidebarV2Scenario(id: SidebarV2ScenarioId): SidebarV2Scenario {
  switch (id) {
    case "mixed-tiers": {
      const { threads, shellFlagsByThreadId } = mixedThreads();
      return {
        id,
        label: "Mixed tiers",
        snapshot: snapshotOf(alphaBetaProjects().slice(0, 1), threads),
        shellFlagsByThreadId,
        bootstrapThreadId: THREAD_WORKING,
        bootstrapProjectId: SIDEBAR_V2_PROJECT_ALPHA,
      };
    }
    case "waiting-only": {
      const planThread = makeThread({
        id: THREAD_PLAN,
        projectId: SIDEBAR_V2_PROJECT_ALPHA,
        title: "Plan ready for follow-up",
        interactionMode: "plan",
        latestTurn: completedTurn(8),
        proposedPlans: [
          {
            id: "plan-1" as OrchestrationProposedPlanId,
            turnId: "turn-done" as TurnId,
            planMarkdown: "# Plan\n\n- Ship sidebar fixtures",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: isoMinutesAgo(8),
            updatedAt: isoMinutesAgo(8),
          },
        ],
        updatedAt: isoMinutesAgo(8),
      });
      const threads = [
        makeThread({
          id: THREAD_APPROVAL,
          projectId: SIDEBAR_V2_PROJECT_ALPHA,
          title: "Pending approval",
          latestTurn: completedTurn(50),
          updatedAt: isoMinutesAgo(50),
        }),
        makeThread({
          id: THREAD_INPUT,
          projectId: SIDEBAR_V2_PROJECT_ALPHA,
          title: "Awaiting input",
          latestTurn: completedTurn(20),
          updatedAt: isoMinutesAgo(20),
        }),
        planThread,
      ];
      return {
        id,
        label: "Waiting only",
        snapshot: snapshotOf(alphaBetaProjects().slice(0, 1), threads),
        shellFlagsByThreadId: flags([
          [THREAD_APPROVAL, { ...emptyFlags(), hasPendingApprovals: true }],
          [THREAD_INPUT, { ...emptyFlags(), hasPendingUserInput: true }],
          [THREAD_PLAN, { ...emptyFlags(), hasActionableProposedPlan: true }],
        ]),
        bootstrapThreadId: THREAD_APPROVAL,
        bootstrapProjectId: SIDEBAR_V2_PROJECT_ALPHA,
      };
    }
    case "working-timer": {
      const thread = makeThread({
        id: THREAD_WORKING,
        projectId: SIDEBAR_V2_PROJECT_ALPHA,
        title: "Long-running turn",
        sessionStatus: "running",
        latestTurn: runningTurn(7),
        updatedAt: isoMinutesAgo(7),
      });
      return {
        id,
        label: "Working timer",
        snapshot: snapshotOf(alphaBetaProjects().slice(0, 1), [thread]),
        shellFlagsByThreadId: flags([[THREAD_WORKING, emptyFlags()]]),
        bootstrapThreadId: THREAD_WORKING,
        bootstrapProjectId: SIDEBAR_V2_PROJECT_ALPHA,
      };
    }
    case "blocked-failed": {
      const thread = makeThread({
        id: THREAD_BLOCKED,
        projectId: SIDEBAR_V2_PROJECT_ALPHA,
        title: "Failed session",
        sessionStatus: "error",
        lastError: "Authentication failed",
        latestTurn: completedTurn(5),
        updatedAt: isoMinutesAgo(5),
      });
      return {
        id,
        label: "Blocked / Failed",
        snapshot: snapshotOf(alphaBetaProjects().slice(0, 1), [thread]),
        shellFlagsByThreadId: flags([[THREAD_BLOCKED, emptyFlags()]]),
        lastVisitedAtByThreadId: {
          // Visited after failure → slim red-dot density once store is primed.
          [`${SIDEBAR_V2_LOCAL_ENV_ID}:${THREAD_BLOCKED}`]: isoMinutesAgo(1),
        },
        bootstrapThreadId: THREAD_BLOCKED,
        bootstrapProjectId: SIDEBAR_V2_PROJECT_ALPHA,
      };
    }
    case "idle-expand": {
      const thread = makeThread({
        id: THREAD_IDLE,
        projectId: SIDEBAR_V2_PROJECT_ALPHA,
        title: "Collapsed idle row",
        latestTurn: completedTurn(400),
        updatedAt: isoMinutesAgo(400),
      });
      return {
        id,
        label: "Idle expand",
        snapshot: snapshotOf(alphaBetaProjects().slice(0, 1), [thread]),
        shellFlagsByThreadId: flags([[THREAD_IDLE, emptyFlags()]]),
        bootstrapThreadId: THREAD_IDLE,
        bootstrapProjectId: SIDEBAR_V2_PROJECT_ALPHA,
      };
    }
    case "picker-scope": {
      const { threads: alphaThreads, shellFlagsByThreadId } = mixedThreads();
      const betaWaiting = makeThread({
        id: THREAD_IDLE_B,
        projectId: SIDEBAR_V2_PROJECT_BETA,
        title: "Beta waiting elsewhere",
        latestTurn: completedTurn(15),
        updatedAt: isoMinutesAgo(15),
      });
      const shellFlags = new Map(shellFlagsByThreadId);
      shellFlags.set(THREAD_IDLE_B, { ...emptyFlags(), hasPendingUserInput: true });
      return {
        id,
        label: "Picker scope",
        snapshot: snapshotOf(alphaBetaProjects(), [...alphaThreads, betaWaiting]),
        shellFlagsByThreadId: shellFlags,
        bootstrapThreadId: THREAD_WORKING,
        bootstrapProjectId: SIDEBAR_V2_PROJECT_ALPHA,
      };
    }
    case "meta-remote": {
      // Remote badge is derived from environmentId ≠ primary; shell threads are
      // still local-env in this single-environment harness. Meta row still shows
      // project chip · branch · time for review.
      const thread = makeThread({
        id: THREAD_REMOTE,
        projectId: SIDEBAR_V2_PROJECT_ALPHA,
        title: "Feature branch meta",
        branch: "feat/sidebar-v2",
        latestTurn: completedTurn(9),
        updatedAt: isoMinutesAgo(9),
      });
      return {
        id,
        label: "Meta row",
        snapshot: snapshotOf(alphaBetaProjects().slice(0, 1), [thread]),
        shellFlagsByThreadId: flags([[THREAD_REMOTE, emptyFlags()]]),
        bootstrapThreadId: THREAD_REMOTE,
        bootstrapProjectId: SIDEBAR_V2_PROJECT_ALPHA,
      };
    }
    case "scroll-30": {
      const threads = Array.from({ length: 32 }, (_, index) => {
        const id = `thread-scroll-${index}` as ThreadId;
        return makeThread({
          id,
          projectId: SIDEBAR_V2_PROJECT_ALPHA,
          title: `Scroll thread ${index + 1}`,
          latestTurn: completedTurn(10 + index),
          updatedAt: isoMinutesAgo(10 + index),
        });
      });
      return {
        id,
        label: "Scroll 30+",
        snapshot: snapshotOf(alphaBetaProjects().slice(0, 1), threads),
        shellFlagsByThreadId: flags(threads.map((thread) => [thread.id, emptyFlags()] as const)),
        bootstrapThreadId: threads[0]!.id,
        bootstrapProjectId: SIDEBAR_V2_PROJECT_ALPHA,
      };
    }
  }
}

export function listSidebarV2Scenarios(): readonly SidebarV2Scenario[] {
  return SIDEBAR_V2_SCENARIO_IDS.map((id) => buildSidebarV2Scenario(id));
}
