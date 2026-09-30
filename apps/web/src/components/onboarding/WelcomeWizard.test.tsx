// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId, ProjectId } from "@kata-sh/code-contracts";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  importThreads: vi.fn(),
  createProject: vi.fn(),
  complete: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  projects: [] as Array<{ id: string; environmentId: string; workspaceRoot: string }>,
  candidates: [] as Array<{ path: string; title: string; projectId: string }>,
}));
vi.mock("../../state/agentSessions", () => ({ agentSessionImport: "import" }));
vi.mock("../../state/projects", () => ({ projectEnvironment: { create: "create" } }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "import"
      ? mocks.importThreads
      : command === "create"
        ? mocks.createProject
        : mocks.refresh,
}));
vi.mock("../../onboarding/firstRun", () => ({ useCompleteOnboarding: () => mocks.complete }));
vi.mock("../../state/entities", () => ({
  useProjects: () => mocks.projects,
  readProjects: () => mocks.projects,
}));
vi.mock("../../state/environments", () => {
  const environment = {
    environmentId: "test-env",
    label: "Computer",
    connection: { phase: "connected" },
  };
  return {
    useEnvironments: () => ({ environments: [environment] }),
    usePrimaryEnvironment: () => environment,
  };
});
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    providersValueAtom: () => [],
    configValueAtom: () => null,
    refreshProviders: "refresh",
  },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: (value: unknown) => value }));
vi.mock("../../onboarding/useProjectScans", () => ({
  useProjectScans: () => [
    {
      environmentId: "test-env",
      isPending: false,
      error: null,
      refresh: mocks.refresh,
      data: {
        truncated: false,
        candidates: mocks.candidates.map((candidate) => ({
          ...candidate,
          threadCount: 29,
          lastActiveAt: new Date().toISOString(),
          sources: ["codex"],
        })),
      },
    },
  ],
}));
vi.mock("../../connection/onboarding", () => ({ connectPairing: vi.fn() }));
vi.mock("../../state/terminal", () => ({ terminalEnvironment: {} }));
vi.mock("../clerk/useT3ConnectAuthPrompt", () => ({ useT3ConnectAuthPrompt: vi.fn() }));
vi.mock("../../cloud/publicConfig", () => ({ hasCloudPublicConfig: () => false }));
vi.mock("../ThreadTerminalDrawer", () => ({ TerminalViewport: () => null }));
vi.mock("../settings/ChatGptWelcomeCoordinator", () => ({ ChatGptWelcomeCoordinator: () => null }));
vi.mock("../settings/CodexSetupSection", () => ({
  CodexSetupSection: () => null,
  AddManagedCodexAccountDialog: () => null,
}));
vi.mock("../cloud/CloudEnvironmentConnectList", () => ({
  CloudEnvironmentConnectRows: () => null,
}));
vi.mock("../ui/toast", () => ({
  toastManager: { add: mocks.toast, close: vi.fn(), update: vi.fn() },
}));

import { WelcomeWizard } from "./WelcomeWizard";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  mocks.projects = [{ id: "test-project", environmentId: "test-env", workspaceRoot: "/project" }];
  mocks.candidates = [{ path: "/project", title: "project", projectId: "test-project" }];
  mocks.complete.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.importThreads.mockResolvedValue({
    _tag: "Success",
    value: { importedCount: 28, skippedCount: 1 },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}

it("enters the workspace after a partial import and warns after navigation finishes", async () => {
  let finishNavigation = () => {};
  const navigation = new Promise<void>((resolve) => {
    finishNavigation = resolve;
  });
  const onDone = vi.fn(() => navigation);
  await act(async () => root.render(<WelcomeWizard localAvailable onDone={onDone} />));
  await click("Continue");
  await click("Continue");
  await click("Import 1 project");
  expect(onDone).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("test-env"),
    projectId: ProjectId.make("test-project"),
  });
  expect(mocks.toast).not.toHaveBeenCalled();
  await act(async () => finishNavigation());
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "warning",
      description: "Imported 28 threads. 1 thread could not be imported.",
    }),
  );
  expect(mocks.toast.mock.invocationCallOrder[0]).toBeGreaterThan(
    onDone.mock.invocationCallOrder[0]!,
  );
});

it.each([
  [0, 0, null],
  [29, 0, null],
  [1, 0, null],
  [0, 1, "1 thread could not be imported."],
  [0, 2, "2 threads could not be imported."],
] as const)(
  "finishes setup with %i imported and %i skipped threads",
  async (importedCount, skippedCount, warning) => {
    mocks.importThreads.mockResolvedValue({
      _tag: "Success",
      value: { importedCount, skippedCount },
    });
    const onDone = vi.fn();
    await act(async () => root.render(<WelcomeWizard localAvailable onDone={onDone} />));
    await click("Continue");
    await click("Continue");
    await click("Import 1 project");
    expect(onDone).toHaveBeenCalledOnce();
    if (warning === null && importedCount > 0) {
      expect(mocks.toast).toHaveBeenCalledWith({
        type: "success",
        title: `Imported ${importedCount} ${importedCount === 1 ? "thread" : "threads"}`,
      });
    } else if (warning === null) {
      expect(mocks.toast).not.toHaveBeenCalled();
    } else {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "warning", description: warning }),
      );
    }
  },
);

it("keeps setup open when saving completion fails and preserves the import warning on retry", async () => {
  mocks.complete.mockRejectedValueOnce(new Error("settings unavailable"));
  const onDone = vi.fn();
  await act(async () => root.render(<WelcomeWizard localAvailable onDone={onDone} />));
  await click("Continue");
  await click("Continue");
  await click("Import 1 project");
  expect(onDone).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ type: "error", title: "Could not finish setup" }),
  );
  await click("Do not import projects");
  expect(onDone).toHaveBeenCalledOnce();
  expect(mocks.importThreads).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "warning",
      description: "Imported 28 threads. 1 thread could not be imported.",
    }),
  );
});

it("keeps both import buttons disabled while setup completion saves after nothing imports", async () => {
  mocks.importThreads.mockResolvedValue({
    _tag: "Success",
    value: { importedCount: 0, skippedCount: 1 },
  });
  let finishSaving = () => {};
  mocks.complete.mockReturnValue(
    new Promise<void>((resolve) => {
      finishSaving = resolve;
    }),
  );
  const onDone = vi.fn();
  await act(async () => root.render(<WelcomeWizard localAvailable onDone={onDone} />));
  await click("Continue");
  await click("Continue");
  await click("Import 1 project");
  const disabled = (label: string) =>
    [...document.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === label,
    )?.disabled;
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(disabled("Importing…")).toBe(true);
  expect(disabled("Do not import projects")).toBe(true);
  await act(async () => finishSaving());
  expect(onDone).toHaveBeenCalledOnce();
  expect(mocks.importThreads).toHaveBeenCalledOnce();
});

it("does not report a save failure when navigation fails after setup is saved", async () => {
  const onDone = vi.fn().mockRejectedValue(new Error("navigation failed"));
  await act(async () => root.render(<WelcomeWizard localAvailable onDone={onDone} />));
  await click("Continue");
  await click("Continue");
  await click("Import 1 project");
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenCalledWith({
    type: "error",
    title: "Could not open your workspace",
    description: "Setup finished and your settings were saved. Reload to continue.",
  });
  expect(mocks.toast).not.toHaveBeenCalledWith(
    expect.objectContaining({ title: "Could not finish setup" }),
  );
});

it("does not double count threads when an import is retried after completion fails", async () => {
  // The server reports threads imported by an earlier attempt as imported again.
  mocks.importThreads
    .mockResolvedValueOnce({ _tag: "Success", value: { importedCount: 28, skippedCount: 1 } })
    .mockResolvedValueOnce({ _tag: "Success", value: { importedCount: 28, skippedCount: 1 } });
  mocks.complete.mockRejectedValueOnce(new Error("settings unavailable"));
  const onDone = vi.fn();
  await act(async () => root.render(<WelcomeWizard localAvailable onDone={onDone} />));
  await click("Continue");
  await click("Continue");
  await click("Import 1 project");
  expect(onDone).not.toHaveBeenCalled();
  await click("Import 1 project");
  expect(mocks.importThreads).toHaveBeenCalledTimes(2);
  expect(onDone).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "warning",
      description: "Imported 28 threads. 1 thread could not be imported.",
    }),
  );
});

it("reports the retry's thread count when a retry imports the rest", async () => {
  // 28 threads from the first attempt plus the 1 that failed make 29 in the retry's report.
  mocks.importThreads
    .mockResolvedValueOnce({ _tag: "Success", value: { importedCount: 28, skippedCount: 1 } })
    .mockResolvedValueOnce({ _tag: "Success", value: { importedCount: 29, skippedCount: 0 } });
  mocks.complete.mockRejectedValueOnce(new Error("settings unavailable"));
  const onDone = vi.fn();
  await act(async () => root.render(<WelcomeWizard localAvailable onDone={onDone} />));
  await click("Continue");
  await click("Continue");
  await click("Import 1 project");
  await click("Import 1 project");
  expect(onDone).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenLastCalledWith({
    type: "success",
    title: "Imported 29 threads",
  });
});

it("keeps skipped threads in the warning when a retry selects different projects", async () => {
  mocks.candidates = [
    { path: "/project-a", title: "project-a", projectId: "project-a" },
    { path: "/project-b", title: "project-b", projectId: "project-b" },
  ];
  mocks.projects = [
    { id: "project-a", environmentId: "test-env", workspaceRoot: "/project-a" },
    { id: "project-b", environmentId: "test-env", workspaceRoot: "/project-b" },
  ];
  let projectBAttempts = 0;
  mocks.importThreads.mockImplementation(async ({ input }: { input: { projectId: string } }) => {
    if (input.projectId === "project-a") {
      return { _tag: "Success", value: { importedCount: 10, skippedCount: 2 } };
    }
    projectBAttempts += 1;
    return projectBAttempts === 1
      ? { _tag: "Failure", cause: Cause.fail(new Error("import failed")) }
      : { _tag: "Success", value: { importedCount: 5, skippedCount: 0 } };
  });
  mocks.complete.mockRejectedValueOnce(new Error("settings unavailable"));
  const onDone = vi.fn();
  await act(async () => root.render(<WelcomeWizard localAvailable onDone={onDone} />));
  await click("Continue");
  await click("Continue");
  await click("Import 2 projects");
  expect(onDone).not.toHaveBeenCalled();
  const rowA = [...document.querySelectorAll("label")].find((element) =>
    element.textContent?.includes("project-a"),
  );
  expect(rowA, "row project-a").toBeDefined();
  await act(async () => rowA!.click());
  await click("Import 1 project");
  expect(onDone).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "warning",
      description: "Imported 15 threads. 2 threads could not be imported.",
    }),
  );
});
