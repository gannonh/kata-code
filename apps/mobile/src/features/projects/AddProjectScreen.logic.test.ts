import type { EnvironmentConnectionPhase } from "@kata-sh/code-client-runtime/connection";
import { EnvironmentId } from "@kata-sh/code-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  getAddProjectCloneConfirmRemoteUrl,
  resolveAddProjectEnvironment,
} from "./AddProjectScreen.logic";

const ENVIRONMENT_A = EnvironmentId.make("environment-a");
const ENVIRONMENT_B = EnvironmentId.make("environment-b");

function environment(environmentId: EnvironmentId, connectionState: EnvironmentConnectionPhase) {
  return { environmentId, connectionState };
}

describe("resolveAddProjectEnvironment", () => {
  it("does not redirect an explicit unavailable environment to another environment", () => {
    expect(
      resolveAddProjectEnvironment(
        [environment(ENVIRONMENT_A, "offline"), environment(ENVIRONMENT_B, "connected")],
        ENVIRONMENT_A,
      ),
    ).toBeNull();
  });

  it("resolves an explicit connected environment", () => {
    expect(
      resolveAddProjectEnvironment(
        [environment(ENVIRONMENT_A, "connected"), environment(ENVIRONMENT_B, "connected")],
        ENVIRONMENT_A,
      )?.environmentId,
    ).toBe(ENVIRONMENT_A);
  });

  it("defaults to the first connected environment when no environment is requested", () => {
    expect(
      resolveAddProjectEnvironment(
        [environment(ENVIRONMENT_A, "offline"), environment(ENVIRONMENT_B, "connected")],
        null,
      )?.environmentId,
    ).toBe(ENVIRONMENT_B);
  });
});

describe("getAddProjectCloneConfirmRemoteUrl", () => {
  it("passes a provider-selected GitHub repository HTTPS url as the confirm remoteUrl", () => {
    expect(
      getAddProjectCloneConfirmRemoteUrl({
        repository: {
          provider: "github",
          url: "https://github.com/gannonh/kata-code",
          sshUrl: "git@github.com:gannonh/kata-code.git",
        },
        pastedInput: "gannonh/kata-code",
      }),
    ).toBe("https://github.com/gannonh/kata-code");
  });

  it("passes GitLab, Bitbucket, and Azure DevOps SSH urls as the confirm remoteUrl", () => {
    expect(
      getAddProjectCloneConfirmRemoteUrl({
        repository: {
          provider: "gitlab",
          url: "https://gitlab.com/group/project.git",
          sshUrl: "git@gitlab.com:group/project.git",
        },
        pastedInput: "group/project",
      }),
    ).toBe("git@gitlab.com:group/project.git");
    expect(
      getAddProjectCloneConfirmRemoteUrl({
        repository: {
          provider: "bitbucket",
          url: "https://bitbucket.org/workspace/repository.git",
          sshUrl: "git@bitbucket.org:workspace/repository.git",
        },
        pastedInput: "workspace/repository",
      }),
    ).toBe("git@bitbucket.org:workspace/repository.git");
    expect(
      getAddProjectCloneConfirmRemoteUrl({
        repository: {
          provider: "azure-devops",
          url: "https://dev.azure.com/org/project/_git/repo",
          sshUrl: "git@ssh.dev.azure.com:v3/org/project/repo",
        },
        pastedInput: "project/repo",
      }),
    ).toBe("git@ssh.dev.azure.com:v3/org/project/repo");
  });

  it("normalizes pasted GitHub shorthand when no repository is selected", () => {
    expect(
      getAddProjectCloneConfirmRemoteUrl({
        repository: null,
        pastedInput: "imputnet/helium",
      }),
    ).toBe("https://github.com/imputnet/helium.git");
  });
});
