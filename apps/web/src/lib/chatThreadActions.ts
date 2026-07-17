import { scopeProjectRef } from "@kata-sh/code-client-runtime";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@kata-sh/code-contracts";
import type { DraftThreadEnvMode } from "../composerDraftStore";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  branch: string | null;
  worktreePath: string | null;
}

interface DraftThreadContextLike extends ThreadContextLike {
  envMode: DraftThreadEnvMode;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
    },
  ): Promise<void>;
}

type NewThreadOptions = NonNullable<Parameters<NewThreadHandler>[1]>;

export interface ChatThreadActionContext {
  readonly activeDraftThread: DraftThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly defaultThreadEnvMode: DraftThreadEnvMode;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

function buildContextualThreadOptions(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): NewThreadOptions {
  // Only inherit branch/worktree when the active thread/draft is in the same project.
  // Cross-project starts should use the default env mode without foreign workspace context.
  const activeThread =
    context.activeThread?.projectId === projectRef.projectId &&
    context.activeThread.environmentId === projectRef.environmentId
      ? context.activeThread
      : null;
  const activeDraftThread =
    context.activeDraftThread?.projectId === projectRef.projectId &&
    context.activeDraftThread.environmentId === projectRef.environmentId
      ? context.activeDraftThread
      : null;

  if (context.defaultThreadEnvMode === "worktree") {
    return { envMode: "worktree" };
  }
  if (activeDraftThread) {
    return {
      branch: activeDraftThread.branch,
      worktreePath: activeDraftThread.worktreePath,
      envMode: activeDraftThread.envMode,
    };
  }
  if (activeThread) {
    return {
      branch: activeThread.branch,
      worktreePath: activeThread.worktreePath,
      envMode: activeThread.worktreePath ? "worktree" : "local",
    };
  }
  return {
    envMode: context.defaultThreadEnvMode,
  };
}

function buildDefaultThreadOptions(context: ChatThreadActionContext): NewThreadOptions {
  return {
    envMode: context.defaultThreadEnvMode,
  };
}

export async function startNewThreadInProjectFromContext(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): Promise<void> {
  await context.handleNewThread(projectRef, buildContextualThreadOptions(context, projectRef));
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await startNewThreadInProjectFromContext(context, projectRef);
  return true;
}

export async function startNewLocalThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef, buildDefaultThreadOptions(context));
  return true;
}
