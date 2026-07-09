import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { EnvironmentId } from "@kata-sh/code-contracts";

const ENV_ID = EnvironmentId.make("env_sandbox_01");

const mockRecord = {
  environmentId: ENV_ID,
  label: "My Container",
  wsBaseUrl: "ws://localhost:1",
  httpBaseUrl: "http://localhost:1",
  createdAt: "",
  lastConnectedAt: null,
  sandbox: { providerKind: "docker" },
};

vi.mock("~/environments/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/environments/runtime")>();
  return {
    ...actual,
    useSavedEnvironmentRegistryStore: (selector: (state: unknown) => unknown) =>
      selector({ byId: { [ENV_ID]: mockRecord } }),
    useSavedEnvironmentRuntimeStore: (selector: (state: unknown) => unknown) =>
      selector({ byId: {} }),
  };
});

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipPopup: ({ children }: { children: React.ReactNode }) => children,
}));

const { SavedBackendListRow } = await import("./ConnectionsSettings");

function renderRow(lifecycleState: "running" | "stopped" | "gone" | "unknown" | undefined) {
  return renderToStaticMarkup(
    <SavedBackendListRow
      environmentId={ENV_ID}
      reconnectingEnvironmentId={null}
      disconnectingEnvironmentId={null}
      sandboxLifecycleState={lifecycleState}
      onConnect={() => {}}
      onDisconnect={() => {}}
      onRemove={() => {}}
    />,
  );
}

describe("SavedBackendListRow sandbox lifecycle rendering (AC-L13)", () => {
  it("running: shows a Connect button (no stopped hint)", () => {
    const html = renderRow("running");
    expect(html).toContain(">Connect<");
    expect(html).not.toContain("Sandbox is stopped");
  });

  it("stopped: shows the 'start it under Environments' hint and no Connect button", () => {
    const html = renderRow("stopped");
    expect(html).toContain("Sandbox is stopped");
    expect(html).toContain("start it under Environments");
    expect(html).not.toContain(">Connect<");
  });

  it("undefined (non-sandbox): shows Connect (unchanged behavior)", () => {
    const html = renderRow(undefined);
    expect(html).toContain(">Connect<");
    expect(html).not.toContain("Sandbox is stopped");
  });

  it("gone: shows an explicit Remove action instead of Connect", () => {
    const html = renderRow("gone");
    expect(html).toContain("Sandbox no longer exists");
    expect(html).toContain(">Remove<");
    expect(html).not.toContain(">Connect<");
  });

  it("unknown (legacy record): shows Connect plus an explicit Remove", () => {
    const html = renderRow("unknown");
    expect(html).toContain(">Connect<");
    expect(html).toContain(">Remove<");
  });
});
