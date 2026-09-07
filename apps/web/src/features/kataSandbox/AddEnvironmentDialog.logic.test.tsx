import { EnvironmentId } from "@kata-sh/code-contracts";
import { discoveredList } from "./testFixtures";
import { describe, expect, it } from "vite-plus/test";

import {
  addEnvironmentReducer,
  createInitialAddEnvironmentState,
  createInitialDockerDraft,
  dockerProviderDiagnostic,
  groupSandboxProviders,
  hasSandboxProviderAdvertisement,
  normalizeManagedImageVersion,
  formatSandboxProgress,
  discoverSandboxCreates,
  isCurrentSandboxList,
  sandboxDiscardTarget,
  shouldOfferSandboxImageOverride,
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
      draft: { imageVersion: "0.42.0" },
    });
  });

  it("keeps an accepted sandbox operation on the Docker step", () => {
    const docker = addEnvironmentReducer(
      { step: "sandbox-providers", error: null },
      { type: "choose-docker", docker: createInitialDockerDraft({ serverVersion: "0.42.0" }) },
    );
    const running = addEnvironmentReducer(docker, {
      type: "operation",
      operation: { operationId: "op-1", status: "Running" },
    });

    expect(addEnvironmentReducer(running, { type: "back" })).toBe(running);
    const failed = addEnvironmentReducer(running, {
      type: "operation",
      operation: {
        operationId: "op-1",
        status: "Failed",
      },
    });
    expect(addEnvironmentReducer(failed, { type: "back" })).toEqual({
      step: "sandbox-providers",
      error: null,
    });
  });

  it("keeps server status authoritative when observation fails", () => {
    const docker = addEnvironmentReducer(
      { step: "choice" },
      { type: "choose-docker", docker: createInitialDockerDraft({ serverVersion: "0.42.0" }) },
    );
    const running = addEnvironmentReducer(docker, {
      type: "operation",
      operation: { operationId: "op", status: "Running" },
    });
    expect(
      addEnvironmentReducer(running, { type: "error", error: "Authorization revoked" }),
    ).toMatchObject({ operation: { status: "Running" }, error: "Authorization revoked" });
    expect(createInitialDockerDraft({ serverVersion: "0.42.0" })).not.toHaveProperty("profileId");
  });
  it("formats pull percentage and sizes, and retains the failed stage", () => {
    expect(
      formatSandboxProgress({
        stage: "pulling-image",
        downloadedBytes: 55_000_000,
        totalBytes: 130_000_000,
      }),
    ).toBe("Pulling image (42%, 55 MB of 130 MB)");
    expect(
      formatSandboxProgress({
        stage: "pulling-image",
        downloadedBytes: 55_000_000,
        totalBytes: null,
      }),
    ).toBe("Pulling image (55 MB)");
    expect(
      formatSandboxProgress({
        stage: "failed",
        lastStage: "checking-out-source",
        diagnostic: "Failed",
      }),
    ).toBe("Failed while checking out source");
  });

  it("normalizes server versions for managed images", () => {
    expect(normalizeManagedImageVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeManagedImageVersion("not-a-version")).toBe("0.0.0");
  });

  it("hides the Sandboxes card when the server advertises no providers", () => {
    expect(hasSandboxProviderAdvertisement(undefined)).toBe(false);
    expect(hasSandboxProviderAdvertisement([])).toBe(false);
    expect(
      hasSandboxProviderAdvertisement([
        {
          driverKind: "docker",
          category: "local-container",
          displayName: "Docker",
          profileForm: "docker",
        },
      ]),
    ).toBe(true);
  });

  it("surfaces Docker host diagnostics before form input and opens Advanced for a missing managed image", () => {
    const missingImage = "Managed image for version 0.0.42 was not found.";
    expect(
      dockerProviderDiagnostic([
        {
          driverKind: "docker",
          category: "local-container",
          displayName: "Docker",
          profileForm: "docker",
          availabilityDiagnostic: missingImage,
        },
      ]),
    ).toBe(missingImage);
    expect(shouldOfferSandboxImageOverride(missingImage)).toBe(true);
    expect(shouldOfferSandboxImageOverride("Docker daemon returned 500.")).toBe(false);
  });
});

it("discovers active and finished-while-closed creates, retaining explicit registered continuation", () => {
  expect(discoverSandboxCreates(discoveredList("Running"), []).automatic?.operationId).toBe(
    "operation-0",
  );
  expect(discoverSandboxCreates(discoveredList("Succeeded"), []).automatic?.operationId).toBe(
    "operation-0",
  );
  const registered = discoverSandboxCreates(discoveredList("Succeeded"), [
    EnvironmentId.make("environment-0"),
  ]);
  expect(registered.automatic).toBeUndefined();
  expect(registered.candidates).toHaveLength(1);
  expect(discoverSandboxCreates(discoveredList("Running", 2), []).automatic).toBeUndefined();
  expect(discoverSandboxCreates(discoveredList("Running", 2), []).candidates).toHaveLength(2);
});
it("requires discard confirmation and cancels it without selecting a deletion target", () => {
  const docker = addEnvironmentReducer(
    { step: "choice" },
    { type: "choose-docker", docker: createInitialDockerDraft({ serverVersion: "0.0.42" }) },
  );
  const failed = addEnvironmentReducer(docker, {
    type: "operation",
    operation: {
      operationId: "operation",
      deploymentId: "sandbox",
      status: "Failed",
    },
  });
  expect(sandboxDiscardTarget(failed)).toBeUndefined();
  const confirmed = addEnvironmentReducer(failed, { type: "request-discard" });
  expect(sandboxDiscardTarget(confirmed)).toBe("sandbox");
  expect(
    sandboxDiscardTarget(addEnvironmentReducer(confirmed, { type: "cancel-discard" })),
  ).toBeUndefined();
});

it("requires a successful list from the current open before automatic discovery", () => {
  const previous = new AbortController();
  const reopened = new AbortController();
  expect(isCurrentSandboxList(previous.signal, reopened.signal)).toBe(false);
  expect(isCurrentSandboxList(null, reopened.signal)).toBe(false);
  expect(isCurrentSandboxList(reopened.signal, reopened.signal)).toBe(true);
  reopened.abort();
  expect(isCurrentSandboxList(reopened.signal, reopened.signal)).toBe(false);
});
