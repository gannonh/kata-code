import {
  canCreateProjectInEnvironment,
  getDefaultCloneUrl,
  normalizePastedCloneUrl,
} from "@kata-sh/code-client-runtime/operations/projects";
import type { EnvironmentConnectionPhase } from "@kata-sh/code-client-runtime/connection";
import type { EnvironmentId, SourceControlRepositoryInfo } from "@kata-sh/code-contracts";

export function resolveAddProjectEnvironment<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly connectionState: EnvironmentConnectionPhase;
  },
>(environmentOptions: ReadonlyArray<T>, requestedEnvironmentId: EnvironmentId | null): T | null {
  if (requestedEnvironmentId !== null) {
    return (
      environmentOptions.find(
        (environment) =>
          environment.environmentId === requestedEnvironmentId &&
          canCreateProjectInEnvironment(environment.connectionState),
      ) ?? null
    );
  }

  return (
    environmentOptions.find((environment) =>
      canCreateProjectInEnvironment(environment.connectionState),
    ) ?? null
  );
}

export function getAddProjectCloneConfirmRemoteUrl(input: {
  readonly repository: Pick<SourceControlRepositoryInfo, "provider" | "url" | "sshUrl"> | null;
  readonly pastedInput: string;
}): string {
  return input.repository === null
    ? normalizePastedCloneUrl(input.pastedInput)
    : getDefaultCloneUrl(input.repository);
}
