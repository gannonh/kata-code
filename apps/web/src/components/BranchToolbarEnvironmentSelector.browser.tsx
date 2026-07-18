import { EnvironmentId, ProjectId } from "@kata-sh/code-contracts";
import "../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import type { EnvironmentOption } from "./BranchToolbar.logic";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";

const environmentId = EnvironmentId.make("environment-vercel");
const projectId = ProjectId.make("project-vercel");

function option(overrides: Partial<EnvironmentOption> = {}): EnvironmentOption {
  return {
    environmentId,
    projectId,
    label: "vercel-test",
    isPrimary: false,
    iconKind: "cloud",
    ...overrides,
  };
}

async function mountSelector(options: readonly EnvironmentOption[]) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <BranchToolbarEnvironmentSelector
      envLocked={false}
      environmentId={options[0]?.environmentId ?? environmentId}
      availableEnvironments={options}
      onEnvironmentChange={vi.fn()}
    />,
    { container: host },
  );
  return {
    host,
    async cleanup() {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("BranchToolbarEnvironmentSelector", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows a single Vercel environment as a static cloud affordance", async () => {
    const mounted = await mountSelector([option()]);
    try {
      expect(mounted.host.textContent).toContain("vercel-test");
      expect(mounted.host.querySelector(".lucide-cloud")).not.toBeNull();
      expect(mounted.host.querySelector('[role="combobox"]')).toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("uses the container icon for a Docker environment", async () => {
    const mounted = await mountSelector([
      option({
        environmentId: EnvironmentId.make("environment-docker"),
        projectId: ProjectId.make("project-docker"),
        label: "docker-test",
        iconKind: "container",
      }),
    ]);
    try {
      expect(mounted.host.textContent).toContain("docker-test");
      expect(mounted.host.querySelector(".lucide-container")).not.toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps multiple environments switchable", async () => {
    const mounted = await mountSelector([
      option({
        environmentId: EnvironmentId.make("environment-local"),
        projectId: ProjectId.make("project-local"),
        label: "This device",
        isPrimary: true,
        iconKind: "device",
      }),
      option(),
    ]);
    try {
      expect(mounted.host.querySelector('[role="combobox"]')).not.toBeNull();
      expect(mounted.host.querySelector(".lucide-monitor")).not.toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });
});
