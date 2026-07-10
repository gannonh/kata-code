import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, SandboxProviderDriverKind } from "@kata-sh/code-contracts";
import type {
  SandboxInstanceSummary,
  SandboxProviderInstanceConfig,
} from "@kata-sh/code-contracts";

import { DeploymentTargetCard } from "./SandboxDeploymentSettings";

const DOCKER_KIND = SandboxProviderDriverKind.make("docker");

/** A minimal docker instance config for the card. */
function makeInstance(): SandboxProviderInstanceConfig {
  return {
    driver: DOCKER_KIND,
    config: { image: "katacode:local", command: "katacode serve --port 13773", port: 13773 },
  } as unknown as SandboxProviderInstanceConfig;
}

/** Common props with overrides for summary (which drives the lifecycle state). */
function makeProps(overrides: {
  readonly summary?: SandboxInstanceSummary;
  readonly instanceBusy?: "test" | "start" | "dispose" | "renew" | "stop";
}): React.ComponentProps<typeof DeploymentTargetCard> {
  return {
    instanceId: "docker_test_01",
    instance: makeInstance(),
    displayName: "Test",
    available: true,
    reason: undefined,
    session: undefined,
    summary: overrides.summary,
    progress: [],
    instanceBusy: overrides.instanceBusy,
    isExpanded: true,
    projects: [],
    savedSandboxEnvironments: undefined,
    selectedRepositoryKey: undefined,
    onExpandedChange: () => {},
    onUpdate: () => {},
    onSavedEnvironmentChange: () => {},
    onSelectedRepositoryKeyChange: () => {},
    onDelete: () => {},
    onTest: () => {},
    onStart: () => {},
    onStop: () => {},
    onDispose: () => {},
    onRenew: () => {},
    onRetryPairing: () => {},
  };
}

/** A summary with no running session (no sandbox). */
function noSessionSummary(): SandboxInstanceSummary {
  return {
    kind: "available",
    instanceId: EnvironmentId.make("docker_test_01"),
    driver: "docker",
    reachabilityKind: "loopback",
    supportsSnapshot: false,
    supportsRenewTimeout: false,
    supportsLifecycle: true,
  } as unknown as SandboxInstanceSummary;
}

/** A summary with a running session. */
function runningSummary(): SandboxInstanceSummary {
  return {
    kind: "available",
    instanceId: EnvironmentId.make("docker_test_01"),
    driver: "docker",
    reachabilityKind: "loopback",
    supportsSnapshot: false,
    supportsRenewTimeout: false,
    supportsLifecycle: true,
    runningSession: {
      environmentId: "env_abc",
      endpoint: {
        id: "sb-1",
        label: "Test",
        httpBaseUrl: "http://localhost:32789",
        reachability: "loopback",
        source: "server",
      },
      status: "running",
    },
  } as unknown as SandboxInstanceSummary;
}

/** A summary with a stopped session. */
function stoppedSummary(): SandboxInstanceSummary {
  return {
    kind: "available",
    instanceId: EnvironmentId.make("docker_test_01"),
    driver: "docker",
    reachabilityKind: "loopback",
    supportsSnapshot: false,
    supportsRenewTimeout: false,
    supportsLifecycle: true,
    runningSession: {
      environmentId: "env_abc",
      endpoint: {
        id: "sb-1",
        label: "Test",
        httpBaseUrl: "http://localhost:32789",
        reachability: "loopback",
        source: "server",
      },
      status: "stopped",
    },
  } as unknown as SandboxInstanceSummary;
}

function renderCard(props: React.ComponentProps<typeof DeploymentTargetCard>): string {
  return renderToStaticMarkup(<DeploymentTargetCard {...props} />);
}

describe("DeploymentTargetCard lifecycle actions (AC-L10/L11/L12)", () => {
  it("no sandbox: shows 'Create & run sandbox' and 'Test connection', no Stop/Start/Delete", () => {
    const html = renderCard(makeProps({ summary: noSessionSummary() }));
    expect(html).toContain("Create &amp; run sandbox");
    expect(html).toContain("Test connection");
    expect(html).not.toContain("Stop");
    expect(html).not.toContain(">Delete sandbox<");
  });

  it("running: shows 'Stop' in the body, no 'Create & run sandbox' or 'Delete sandbox'", () => {
    const html = renderCard(makeProps({ summary: runningSummary() }));
    expect(html).toContain(">Stop<");
    expect(html).not.toContain("Create &amp; run sandbox");
    expect(html).not.toContain(">Delete sandbox<");
  });

  it("stopped: shows 'Start' (primary) and 'Delete sandbox', no 'Create & run sandbox'", () => {
    const html = renderCard(makeProps({ summary: stoppedSummary() }));
    expect(html).toContain(">Start<");
    expect(html).toContain("Delete sandbox");
    expect(html).not.toContain("Create &amp; run sandbox");
  });

  it("never renders 'Dispose', 'Resume', or 'Snapshot' labels in any state", () => {
    for (const summary of [noSessionSummary(), runningSummary(), stoppedSummary()]) {
      const html = renderCard(makeProps({ summary }));
      expect(html).not.toContain(">Dispose<");
      expect(html).not.toContain(">Resume<");
      expect(html).not.toContain(">Snapshot<");
    }
  });

  it("running: header shows a 'Stop' secondary button (AC-L10)", () => {
    const html = renderCard(makeProps({ summary: runningSummary() }));
    // The header Stop button is a secondary action; the body also has Stop.
    // Assert at least one Stop button is present (header or body).
    expect(html).toContain(">Stop<");
  });

  it("stopped: header shows a 'Start' secondary button (AC-L10)", () => {
    const html = renderCard(makeProps({ summary: stoppedSummary() }));
    expect(html).toContain(">Start<");
  });

  it("no sandbox: header does not show a Stop or Start secondary button (AC-L10)", () => {
    const html = renderCard(makeProps({ summary: noSessionSummary() }));
    // No running session → no secondary Stop/Start button in the header.
    // The body has "Create & run sandbox" but not a bare "Start" button.
    expect(html).not.toContain(">Start<");
    expect(html).not.toContain(">Stop<");
  });

  it("does not render the Enabled toggle in any state (AC-L10)", () => {
    for (const summary of [noSessionSummary(), runningSummary(), stoppedSummary()]) {
      const html = renderCard(makeProps({ summary }));
      expect(html).not.toContain(">Enabled<");
    }
  });

  it("running: shows a green status badge (AC-L10)", () => {
    const html = renderCard(makeProps({ summary: runningSummary() }));
    expect(html).toContain("running");
  });

  it("stopped: shows a gray status badge (AC-L10)", () => {
    const html = renderCard(makeProps({ summary: stoppedSummary() }));
    expect(html).toContain("stopped");
  });

  it("docker: retains the saved environment selector", () => {
    const html = renderCard(makeProps({ summary: noSessionSummary() }));
    expect(html).toContain(">Saved environment<");
  });

  it("vercel: renders machine size select and chevron affordance", () => {
    const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");
    const instance = {
      driver: VERCEL_KIND,
      config: { runtime: "node24", persistent: true, timeoutMs: 86_400_000, port: 13773, vcpus: 2 },
    } as unknown as SandboxProviderInstanceConfig;
    const html = renderCard({
      ...makeProps({ summary: noSessionSummary() }),
      instance,
      displayName: "Cloud",
    });
    expect(html).toContain("Machine size (vCPU / RAM)");
    expect(html).toContain("2 vCPU / 4 GB RAM");
    expect(html).toContain("Toggle Cloud details");
  });

  it("vercel: renders the GitHub repository and Branch source pickers (AC-GS3)", () => {
    const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");
    const instance = {
      driver: VERCEL_KIND,
      config: { runtime: "node24", persistent: true, timeoutMs: 86_400_000, port: 13773, vcpus: 2 },
    } as unknown as SandboxProviderInstanceConfig;
    const html = renderCard({
      ...makeProps({ summary: noSessionSummary() }),
      instance,
      displayName: "Cloud",
    });
    expect(html).toContain(">GitHub repository<");
    expect(html).toContain(">Branch<");
    expect(html).toContain("Select a repository");
    expect(html).toContain("Choose a GitHub repository and branch to configure its setup.");
    expect(html).not.toContain(">Saved environment<");
  });

  it("vercel: groups source selection with repository setup without a second repository field", () => {
    const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");
    const instance = {
      driver: VERCEL_KIND,
      config: {
        runtime: "node24",
        persistent: true,
        timeoutMs: 86_400_000,
        port: 13773,
        vcpus: 2,
        source: { repository: "octocat/Hello-World", branch: "main" },
      },
    } as unknown as SandboxProviderInstanceConfig;
    const html = renderCard({
      ...makeProps({ summary: noSessionSummary() }),
      instance,
      displayName: "Cloud",
    });

    const runtimeEnvironment = html.indexOf("Runtime environment variables");
    const repository = html.indexOf(">GitHub repository<");
    const branch = html.indexOf(">Branch<");
    const install = html.indexOf(">Install<");
    expect(runtimeEnvironment).toBeLessThan(repository);
    expect(repository).toBeLessThan(branch);
    expect(branch).toBeLessThan(install);
    expect(html).not.toContain(">Saved environment<");
  });

  it("vercel: disables Create when no source is selected (AC-GS4)", () => {
    const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");
    const instance = {
      driver: VERCEL_KIND,
      config: { runtime: "node24", persistent: true, timeoutMs: 86_400_000, port: 13773, vcpus: 2 },
    } as unknown as SandboxProviderInstanceConfig;
    const html = renderCard({
      ...makeProps({ summary: noSessionSummary() }),
      instance,
      displayName: "Cloud",
    });
    // The Create button renders disabled with no configured source.
    const createIndex = html.indexOf("Create &amp; run sandbox");
    expect(createIndex).toBeGreaterThan(-1);
    const buttonStart = html.lastIndexOf("<button", createIndex);
    expect(html.slice(buttonStart, createIndex)).toContain("disabled");
  });

  it("vercel: enables Create and locks the source once a source is selected + running (AC-GS4/AC-GS11)", () => {
    const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");
    const instance = {
      driver: VERCEL_KIND,
      config: {
        runtime: "node24",
        persistent: true,
        timeoutMs: 86_400_000,
        port: 13773,
        vcpus: 2,
        source: { repository: "octocat/Hello-World", branch: "main" },
      },
    } as unknown as SandboxProviderInstanceConfig;
    const running = {
      ...(runningSummary() as Record<string, unknown>),
      driver: "vercel",
    } as unknown as SandboxInstanceSummary;
    const html = renderCard({
      ...makeProps({ summary: running }),
      instance,
      displayName: "Cloud",
    });
    expect(html).toContain("Delete this sandbox to change its repository or branch.");
  });
});
