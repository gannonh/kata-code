import type { EnvironmentId } from "@kata-sh/code-contracts";
import { scopeProjectRef } from "@kata-sh/code-client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@kata-sh/code-client-runtime/state/runtime";
import { useRef } from "react";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readProject, useProjects } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { environmentShell } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";

async function waitForVisible(ready: () => boolean, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!ready()) {
    signal.throwIfAborted();
    if (Date.now() >= deadline)
      throw new Error(
        "The sandbox is connected but its project is not visible yet. Open the sandbox to continue.",
      );
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}

export function useOpenSandbox() {
  const ensureProject = useAtomCommand(projectEnvironment.ensureWorkspace, {
    reportFailure: false,
  });
  const newThread = useNewThreadHandler();
  const projects = useProjects();
  const latest = useRef({ newThread, projects });
  latest.current = { newThread, projects };
  return async (environmentId: EnvironmentId, title: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    const result = await ensureProject({
      environmentId,
      input: { workspaceRoot: "/workspace", title },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) throw new Error("Opening the sandbox was interrupted.");
      throw squashAtomCommandFailure(result);
    }
    signal.throwIfAborted();
    const projectRef = scopeProjectRef(environmentId, result.value);
    await waitForVisible(
      () =>
        appAtomRegistry.get(environmentShell.stateValueAtom(environmentId)).status === "live" &&
        readProject(projectRef) !== null &&
        latest.current.projects.some(
          (project) => project.environmentId === environmentId && project.id === result.value,
        ),
      signal,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal.throwIfAborted();
    const opened = await latest.current.newThread(projectRef, { signal });
    if (opened === null)
      throw new Error("The workspace is ready. Open the sandbox to start a thread.");
  };
}
