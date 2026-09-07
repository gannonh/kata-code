import { expect, it, vi, afterEach } from "vite-plus/test";
import { EnvironmentId } from "@kata-sh/code-contracts";
import { SandboxDeploymentId } from "@kata-sh/code-kata-sandbox-contracts/domain";
import { fetchSandboxList, mintSandboxHandoff } from "./api";
import { discoveredList } from "./testFixtures";
vi.mock("./api", () => ({ fetchSandboxList: vi.fn(), mintSandboxHandoff: vi.fn() }));
import { openCreatedSandbox } from "./onboarding";
afterEach(() => vi.resetAllMocks());
const environmentId = EnvironmentId.make("environment-0");
function setup() {
  vi.mocked(fetchSandboxList).mockResolvedValue(discoveredList("Succeeded"));
  vi.mocked(mintSandboxHandoff).mockResolvedValue({
    deploymentId: SandboxDeploymentId.make("sandbox-0"),
    environmentId,
    endpoint: "http://localhost:3774",
    attachment: "direct",
    pairingUrl: "http://localhost:3774/#pair",
    workspaceRoot: "/workspace",
    expiresAt: "2026-09-07T00:05:00Z",
  });
}
it("resumes registered clients through project creation without minting another handoff", async () => {
  setup();
  const connectPairing = vi.fn();
  const openProject = vi.fn();
  await openCreatedSandbox("sandbox-0", {
    signal: new AbortController().signal,
    isRegistered: () => true,
    connectPairing,
    openProject,
  });
  expect(mintSandboxHandoff).not.toHaveBeenCalled();
  expect(connectPairing).not.toHaveBeenCalled();
  expect(openProject).toHaveBeenCalledWith(environmentId, "repo", expect.any(AbortSignal));
});
it("stops continuation when the dialog closes while pairing is pending", async () => {
  setup();
  const controller = new AbortController();
  let complete: ((value: EnvironmentId) => void) | undefined;
  const pairing = new Promise<EnvironmentId>((resolve) => {
    complete = resolve;
  });
  const connectPairing = vi.fn(() => pairing);
  const openProject = vi.fn();
  const pending = openCreatedSandbox("sandbox-0", {
    signal: controller.signal,
    isRegistered: () => false,
    connectPairing,
    openProject,
  });
  await vi.waitFor(() => expect(connectPairing).toHaveBeenCalledTimes(1));
  controller.abort();
  complete?.(environmentId);
  await expect(pending).rejects.toThrow();
  expect(openProject).not.toHaveBeenCalled();
});
it("ignores a late list response from a closed dialog", async () => {
  const controller = new AbortController();
  let complete: ((value: ReturnType<typeof discoveredList>) => void) | undefined;
  vi.mocked(fetchSandboxList).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const connectPairing = vi.fn();
  const openProject = vi.fn();
  const pending = openCreatedSandbox("sandbox-0", {
    signal: controller.signal,
    isRegistered: () => false,
    connectPairing,
    openProject,
  });
  controller.abort();
  complete?.(discoveredList("Succeeded"));
  await expect(pending).rejects.toThrow();
  expect(mintSandboxHandoff).not.toHaveBeenCalled();
  expect(openProject).not.toHaveBeenCalled();
});
