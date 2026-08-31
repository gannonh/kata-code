import { describe, expect, it } from "vite-plus/test";

import {
  addEnvironmentReducer,
  createInitialAddEnvironmentState,
  createInitialDockerDraft,
  groupSandboxProviders,
  normalizeManagedImageVersion,
} from "./AddEnvironmentDialog.logic";

describe("Add Environment flow state", () => {
  it("routes through sandbox provider selection into a Docker draft", () => {
    const choice = createInitialAddEnvironmentState("v0.42.0");
    const providers = groupSandboxProviders([
      {
        driverKind: "docker",
        category: "local-container",
        displayName: "Docker",
        profileForm: "docker",
      },
    ]);
    expect(providers.local).toHaveLength(1);
    expect(providers.cloud).toHaveLength(0);

    const providerStep = addEnvironmentReducer(choice, {
      type: "choose",
      choice: "sandbox",
    });
    const dockerStep = addEnvironmentReducer(providerStep, {
      type: "choose-docker",
      docker: createInitialDockerDraft({ serverVersion: "v0.42.0" }),
    });

    expect(dockerStep).toMatchObject({
      step: "docker",
      draft: { imageVersion: "0.42.0", profileMode: "existing" },
    });
  });

  it("keeps an accepted sandbox operation on the Docker step", () => {
    const docker = addEnvironmentReducer(
      { step: "sandbox-providers", error: null },
      { type: "choose-docker", docker: createInitialDockerDraft({ serverVersion: "0.42.0" }) },
    );
    const running = addEnvironmentReducer(docker, {
      type: "operation",
      operation: { phase: "deployment", operationId: "op-1", status: "Running", stage: "starting" },
    });

    expect(addEnvironmentReducer(running, { type: "back" })).toBe(running);
    const failed = addEnvironmentReducer(running, {
      type: "operation",
      operation: {
        phase: "deployment",
        operationId: "op-1",
        status: "Failed",
        stage: "failed",
      },
    });
    expect(addEnvironmentReducer(failed, { type: "back" })).toEqual({
      step: "sandbox-providers",
      error: null,
    });
    expect(addEnvironmentReducer(failed, { type: "retry" })).toMatchObject({
      step: "docker",
      operation: null,
      attachment: null,
      draft: createInitialDockerDraft({ serverVersion: "v0.42.0" }),
    });
  });

  it("normalizes server versions for managed images", () => {
    expect(normalizeManagedImageVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeManagedImageVersion("not-a-version")).toBe("0.0.0");
  });
});
