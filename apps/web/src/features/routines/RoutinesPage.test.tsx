import { RoutineError } from "@kata-sh/code-contracts";
import * as Cause from "effect/Cause";
import { act, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  command: vi.fn(),
  environments: [
    {
      environmentId: "environment-1",
      label: "Local",
      connection: { phase: "connected" },
    },
  ],
  projects: [
    {
      id: "project-1",
      environmentId: "environment-1",
      title: "Widgets",
      workspaceRoot: "/tmp/widgets",
      repositoryIdentity: null,
    },
  ],
  providers: [
    {
      instanceId: "codex",
      enabled: true,
      installed: true,
      status: "ready",
      auth: { status: "authenticated" },
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: null,
        },
      ],
    },
  ],
  listData: [] as Array<Record<string, unknown>>,
  listDataByEnvironment: {} as Record<string, readonly unknown[]>,
  connectionsData: [] as Array<Record<string, unknown>>,
  metadataData: {
    repositories: [] as Array<{ nameWithOwner: string; defaultBranch: string }>,
    repository: null as null | {
      id: number;
      nameWithOwner: string;
      defaultBranch: string;
      branches: string[];
      labels: Array<{ id: number; name: string }>;
    },
  },
  linearMetadataData: null as null | Record<string, unknown>,
  linearMetadataError: null as string | null,
  linearMetadataPending: false,
  linearMetadataRefresh: vi.fn(),
  queries: {
    list: Symbol("list"),
    connections: Symbol("connections"),
    preview: Symbol("preview"),
    metadata: Symbol("metadata"),
    linearMetadata: Symbol("linear-metadata"),
  },
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => testState.providers,
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: testState.environments, isReady: true }),
  usePrimaryEnvironmentId: () => "environment-1",
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => testState.projects,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    providersValueAtom: () => Symbol("providers"),
  },
}));
vi.mock("../../state/vcs", () => ({
  vcsEnvironment: { listRefs: () => Symbol("refs") },
}));
vi.mock("../../state/routines", () => ({
  routineEnvironment: {
    list: (input: { environmentId: string }) => ({
      tag: testState.queries.list,
      environmentId: input.environmentId,
    }),
    connections: () => testState.queries.connections,
    preview: () => testState.queries.preview,
    gitHubMetadata: () => testState.queries.metadata,
    linearMetadata: (request: { input: Record<string, unknown> }) => ({
      tag: testState.queries.linearMetadata,
      input: request.input,
    }),
    history: () => Symbol("history"),
    save: Symbol("save"),
    change: Symbol("change"),
    test: Symbol("test"),
    createConnection: Symbol("create-connection"),
    beginConnectionAuthorization: Symbol("begin-authorization"),
    verifyConnection: Symbol("verify-connection"),
    disableConnection: Symbol("disable-connection"),
    rotateConnectionSecret: Symbol("rotate-secret"),
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => testState.command,
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: unknown) => {
    const listQuery = query as { tag?: symbol; environmentId?: string } | null;
    if (listQuery?.tag === testState.queries.list) {
      return {
        data: testState.listDataByEnvironment[listQuery.environmentId ?? ""] ?? testState.listData,
        error: null,
        isPending: false,
        isSuccess: true,
        refresh: vi.fn(),
      };
    }
    if (query === testState.queries.connections) {
      return {
        data: testState.connectionsData,
        error: null,
        isPending: false,
        isSuccess: true,
        refresh: vi.fn(),
      };
    }
    if (query === testState.queries.metadata) {
      return {
        data: testState.metadataData,
        error: null,
        isPending: false,
        isSuccess: true,
        refresh: vi.fn(),
      };
    }
    if (listQuery?.tag === testState.queries.linearMetadata) {
      return {
        data: testState.linearMetadataData,
        error: testState.linearMetadataError,
        isPending: testState.linearMetadataPending,
        isSuccess: testState.linearMetadataError === null,
        refresh: testState.linearMetadataRefresh,
      };
    }
    return { data: null, error: null, isPending: false, isSuccess: false, refresh: vi.fn() };
  },
}));
vi.mock("../../components/ui/menu", () => ({
  Menu: ({ children }: { children: ReactNode }) => children,
  MenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" data-slot="menu-item" onClick={onClick}>
      {children}
    </button>
  ),
  MenuPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MenuTrigger: ({ render }: { render: ReactElement }) => render,
}));

import { RoutinesPage } from "./RoutinesPage";
import { RoutineChat } from "./RoutineChat";

function nodeText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : nodeText(child)))
    .join("");
}

function buttonWithText(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const button = renderer.root
    .findAll((node) => node.type === "button" && nodeText(node).includes(text))
    .at(-1);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function menuItemWithText(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const item = renderer.root
    .findAll((node) => node.props["data-slot"] === "menu-item" && nodeText(node).includes(text))
    .at(-1);
  if (!item) throw new Error(`Menu item not found: ${text}`);
  return item;
}

function connectionFor(id: string): Record<string, unknown> {
  return {
    id,
    environmentId: "environment-1",
    provider: "github",
    repositoryId: 42,
    repositoryName: "acme/widgets",
    repositoryUrl: "https://github.com/acme/widgets",
    defaultBranch: "main",
    hookId: 1001,
    callbackUrl: `https://env.example/hooks/${id}`,
    status: "verified",
    lastDelivery: null,
    acceptedCount: 0,
    ignoredCount: 0,
    rejectedCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function linearConnectionFor(
  id: string,
  patch: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    environmentId: "environment-1",
    provider: "linear",
    workspaceId: "workspace-1",
    workspaceName: "Acme",
    teamIds: [] as string[],
    allTeams: true,
    webhookId: null,
    metadataAccess: "ok",
    callbackUrl: `https://env.example/hooks/${id}`,
    status: "pending",
    lastDelivery: null,
    acceptedCount: 0,
    ignoredCount: 0,
    rejectedCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function linearRoutineFor(id: string, name = "Linear brief"): Record<string, unknown> {
  const routine = savedRoutineFor(id);
  return {
    ...routine,
    configuration: {
      ...(routine.configuration as Record<string, unknown>),
      name,
      trigger: {
        kind: "linear",
        connectionId: "connection-linear",
        workspaceId: "workspace-1",
        event: "issue_created",
      },
    },
  };
}

function savedRoutineFor(id: string): Record<string, unknown> {
  return {
    id,
    environmentId: "environment-1",
    revision: 4,
    state: "enabled",
    nextDueAt: "2026-09-17T09:00:00.000Z",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    configuration: {
      name: "Daily project brief",
      instruction: "Summarize the latest changes.",
      projectId: "project-1",
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      runtimeMode: "approval-required",
      workspace: { kind: "shared", directory: "/tmp/widgets" },
      trigger: { kind: "daily", time: "09:00", timezone: "UTC" },
    },
  };
}

async function renderRoutinesPage(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<RoutinesPage />);
  });
  return renderer!;
}

async function openRoutineFrom(
  open: (renderer: ReactTestRenderer) => void,
): Promise<ReactTestRenderer> {
  const renderer = await renderRoutinesPage();
  await act(async () => {
    open(renderer);
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

async function openNewRoutineEditor(): Promise<ReactTestRenderer> {
  return openRoutineFrom((renderer) =>
    menuItemWithText(renderer, "Set up manually").props.onClick?.(),
  );
}

async function openSavedRoutineEditor(): Promise<ReactTestRenderer> {
  return openRoutineFrom((renderer) =>
    buttonWithText(renderer, "Daily project brief").props.onClick?.(),
  );
}

describe("RoutinesPage GitHub trigger setup", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    testState.command.mockReset();
    testState.listData.length = 0;
    testState.connectionsData.length = 0;
    testState.metadataData.repository = null;
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it("opens guided setup from GitHub event without inventing a connection", async () => {
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Weekly").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "GitHub event").props.onClick?.();
    });

    expect(renderer!.root.findByProps({ "data-testid": "routine-github-trigger" })).toBeDefined();
    expect(buttonWithText(renderer!, "Connect a repository")).toBeDefined();
    expect(renderer!.root.findByProps({ id: "routine-connection" }).props.value).toBe("");
    expect(buttonWithText(renderer!, "Save").props.disabled).toBe(true);

    await act(async () => {
      buttonWithText(renderer!, "Schedule").props.onClick?.();
    });

    expect(buttonWithText(renderer!, "Weekly").props.className).toContain("bg-primary");
  });

  it("enables saving after guided setup returns a real connection", async () => {
    testState.command.mockImplementation(async (value: unknown) => {
      const input = value as {
        input?: { id?: string; configuration?: unknown };
      };
      if (input.input?.configuration !== undefined) {
        return { _tag: "Failure", cause: new Error("stop after inspecting the save payload") };
      }
      const id = input.input?.id ?? "connection-test";
      const connection = connectionFor(id);
      if (!testState.connectionsData.some((entry) => entry.id === id)) {
        testState.connectionsData.push(connection);
      }
      return { _tag: "Success", value: connection };
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      renderer!.root.findByProps({ id: "routine-name" }).props.onValueChange("GitHub routine");
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-instruction" })
        .props.onChange({ target: { value: "Handle the event" } });
    });
    await act(async () => {
      buttonWithText(renderer!, "GitHub event").props.onClick?.();
    });
    await act(async () => {
      renderer!.root.findByProps({ id: "routine-repository" }).props.onValueChange("acme/widgets");
    });
    await act(async () => {
      buttonWithText(renderer!, "Create webhook").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const connectionId = testState.connectionsData[0]?.id;
    expect(connectionId).toBeTruthy();
    expect(renderer!.root.findByProps({ id: "routine-connection" }).props.value).toBe(connectionId);
    expect(buttonWithText(renderer!, "Save").props.disabled).toBe(false);

    await act(async () => {
      buttonWithText(renderer!, "Save").props.onClick?.();
      await Promise.resolve();
    });

    const saveCall = testState.command.mock.calls.find(
      ([value]) =>
        (value as { input?: { configuration?: unknown } }).input?.configuration !== undefined,
    );
    expect(saveCall?.[0]).toMatchObject({
      input: {
        configuration: {
          trigger: {
            kind: "github",
            connectionId,
            repositoryId: 42,
            event: "pr_opened",
            includeDrafts: false,
          },
        },
      },
    });
  });

  it("drops an issue label filter when the trigger switches to a pull request event", async () => {
    testState.connectionsData.push(connectionFor("connection-filter"));
    testState.metadataData.repository = {
      id: 42,
      nameWithOwner: "acme/widgets",
      defaultBranch: "main",
      branches: ["main"],
      labels: [{ id: 5, name: "bug" }],
    };
    testState.command.mockImplementation(async (value: unknown) => {
      const input = value as { input?: { configuration?: unknown } };
      if (input.input?.configuration !== undefined) {
        return { _tag: "Failure", cause: new Error("stop after inspecting the save payload") };
      }
      return { _tag: "Success", value: connectionFor("connection-filter") };
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      renderer!.root.findByProps({ id: "routine-name" }).props.onValueChange("Event routine");
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-instruction" })
        .props.onChange({ target: { value: "Handle the event" } });
    });
    await act(async () => {
      buttonWithText(renderer!, "GitHub event").props.onClick?.();
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-github-event" })
        .props.onChange({ target: { value: "issue_opened" } });
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-github-label" })
        .props.onChange({ target: { value: "5" } });
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-github-event" })
        .props.onChange({ target: { value: "pr_opened" } });
    });
    await act(async () => {
      buttonWithText(renderer!, "Save").props.onClick?.();
      await Promise.resolve();
    });

    const saveCall = testState.command.mock.calls.find(
      ([value]) =>
        (value as { input?: { configuration?: unknown } }).input?.configuration !== undefined,
    );
    expect(
      (saveCall?.[0] as { input: { configuration: { trigger: Record<string, unknown> } } }).input
        .configuration.trigger,
    ).toEqual({
      kind: "github",
      connectionId: "connection-filter",
      repositoryId: 42,
      event: "pr_opened",
      includeDrafts: false,
    });
  });

  it("drops the branch default when the trigger selects an issue event", async () => {
    testState.connectionsData.push(connectionFor("connection-issue"));
    testState.command.mockImplementation(async (value: unknown) => {
      const input = value as { input?: { configuration?: unknown } };
      if (input.input?.configuration !== undefined) {
        return { _tag: "Failure", cause: new Error("stop after inspecting the save payload") };
      }
      return { _tag: "Success", value: connectionFor("connection-issue") };
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      renderer!.root.findByProps({ id: "routine-name" }).props.onValueChange("Issue routine");
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-instruction" })
        .props.onChange({ target: { value: "Handle the issue" } });
    });
    await act(async () => {
      buttonWithText(renderer!, "GitHub event").props.onClick?.();
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-github-event" })
        .props.onChange({ target: { value: "issue_opened" } });
    });
    await act(async () => {
      buttonWithText(renderer!, "Save").props.onClick?.();
      await Promise.resolve();
    });

    const saveCall = testState.command.mock.calls.find(
      ([value]) =>
        (value as { input?: { configuration?: unknown } }).input?.configuration !== undefined,
    );
    expect(
      (saveCall?.[0] as { input: { configuration: { trigger: Record<string, unknown> } } }).input
        .configuration.trigger,
    ).toEqual({
      kind: "github",
      connectionId: "connection-issue",
      repositoryId: 42,
      event: "issue_opened",
      includeDrafts: false,
    });
  });

  it("clears a saved branch and label filter when the field is emptied", async () => {
    testState.connectionsData.push(connectionFor("connection-clear"));
    testState.metadataData.repository = {
      id: 42,
      nameWithOwner: "acme/widgets",
      defaultBranch: "main",
      branches: ["main"],
      labels: [{ id: 5, name: "bug" }],
    };
    testState.command.mockImplementation(async (value: unknown) => {
      const input = value as { input?: { configuration?: unknown } };
      if (input.input?.configuration !== undefined) {
        return { _tag: "Failure", cause: new Error("stop after inspecting the save payload") };
      }
      return { _tag: "Success", value: connectionFor("connection-clear") };
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      renderer!.root.findByProps({ id: "routine-name" }).props.onValueChange("Clear filters");
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-instruction" })
        .props.onChange({ target: { value: "Handle the event" } });
    });
    await act(async () => {
      buttonWithText(renderer!, "GitHub event").props.onClick?.();
    });
    // Guided setup fills the connection default branch; emptying it clears the filter.
    await act(async () => {
      renderer!.root.findByProps({ id: "routine-github-branch" }).props.onValueChange("");
    });
    const saveTrigger = () => {
      const saveCall = testState.command.mock.calls.find(
        ([value]) =>
          (value as { input?: { configuration?: unknown } }).input?.configuration !== undefined,
      );
      return (saveCall?.[0] as { input: { configuration: { trigger: Record<string, unknown> } } })
        .input.configuration.trigger;
    };
    await act(async () => {
      buttonWithText(renderer!, "Save").props.onClick?.();
      await Promise.resolve();
    });
    expect(saveTrigger()).toEqual({
      kind: "github",
      connectionId: "connection-clear",
      repositoryId: 42,
      event: "pr_opened",
      includeDrafts: false,
    });

    testState.command.mockClear();
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-github-event" })
        .props.onChange({ target: { value: "issue_opened" } });
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-github-label" })
        .props.onChange({ target: { value: "5" } });
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-github-label" })
        .props.onChange({ target: { value: "" } });
    });
    await act(async () => {
      buttonWithText(renderer!, "Save").props.onClick?.();
      await Promise.resolve();
    });
    expect(saveTrigger()).toEqual({
      kind: "github",
      connectionId: "connection-clear",
      repositoryId: 42,
      event: "issue_opened",
      includeDrafts: false,
    });
  });
});

describe("RoutinesPage Linear trigger setup", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    testState.command.mockReset();
    testState.listData.length = 0;
    testState.connectionsData.length = 0;
    testState.linearMetadataData = null;
    testState.linearMetadataError = null;
    testState.linearMetadataRefresh.mockClear();
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it("switches the editor to Linear event fields without a connection", async () => {
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });

    expect(renderer!.root.findByProps({ "data-testid": "routine-linear-trigger" })).toBeDefined();
    expect(buttonWithText(renderer!, "Connect a workspace")).toBeDefined();
    expect(renderer!.root.findByProps({ id: "routine-linear-connection" }).props.value).toBe("");
    expect(buttonWithText(renderer!, "Save").props.disabled).toBe(true);
  });

  it("opens a Linear authorization placeholder before the RPC and navigates it after success", async () => {
    const authorizationWindow = {
      closed: false,
      location: { href: "about:blank" },
      close: vi.fn(),
    };
    const open = vi.fn(() => authorizationWindow);
    vi.stubGlobal("window", { open });
    const authorizeUrl = "https://linear.app/oauth/authorize?client_id=kata";
    let resolveAuthorization:
      | ((value: { _tag: "Success"; value: { authorizeUrl: string } }) => void)
      | undefined;
    const authorizationResult = new Promise<{
      _tag: "Success";
      value: { authorizeUrl: string };
    }>((resolve) => {
      resolveAuthorization = resolve;
    });
    testState.command.mockReturnValue(authorizationResult);
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
    });

    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(testState.command).toHaveBeenCalledTimes(1);
    expect(authorizationWindow.location.href).toBe("about:blank");

    await act(async () => {
      resolveAuthorization?.({ _tag: "Success", value: { authorizeUrl } });
      await authorizationResult;
    });

    const beginCall = testState.command.mock.calls[0]?.[0] as {
      environmentId: string;
      input: { id: string };
    };
    expect(beginCall.environmentId).toBe("environment-1");
    expect(beginCall.input.id).toMatch(/^connection-/);
    expect(authorizationWindow.location.href).toBe(authorizeUrl);
    expect(nodeText(renderer!.root)).toContain(
      "Authorize Kata Code in the Linear window, then check the connection.",
    );
    expect(buttonWithText(renderer!, "Check authorization")).toBeDefined();
  });

  it("shows a recoverable authorization link when the popup is blocked", async () => {
    const authorizeUrl = "https://linear.app/oauth/authorize?client_id=kata";
    vi.stubGlobal("window", { open: vi.fn(() => null) });
    testState.command.mockResolvedValue({
      _tag: "Success",
      value: { authorizeUrl },
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(nodeText(renderer!.root)).toContain(
      "The Linear authorization window was blocked. Open the authorization link below",
    );
    expect(renderer!.root.findByProps({ href: authorizeUrl }).children).toEqual([
      "Open Linear authorization link",
    ]);
  });

  it("closes the authorization placeholder when the start request fails", async () => {
    const authorizationWindow = {
      closed: false,
      location: { href: "about:blank" },
      close: vi.fn(),
    };
    vi.stubGlobal("window", { open: vi.fn(() => authorizationWindow) });
    testState.command.mockResolvedValue({
      _tag: "Failure",
      cause: new Error("Linear authorization is unavailable."),
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authorizationWindow.close).toHaveBeenCalledTimes(1);
    expect(nodeText(renderer!.root)).toContain("Linear authorization is unavailable.");
    expect(renderer!.root.findAll((node) => typeof node.props.href === "string")).toHaveLength(0);
  });

  it("waits for authorization, then shows the workspace scope", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    testState.command.mockImplementation(async () => ({
      _tag: "Success",
      value: { authorizeUrl: "https://linear.app/oauth/authorize" },
    }));
    testState.linearMetadataError = "Connect Linear before reading workspace metadata.";
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(nodeText(renderer!.root)).toContain("Waiting for authorization…");
    expect(renderer!.root.findAllByProps({ id: "routine-linear-all-teams" })).toHaveLength(0);

    await act(async () => {
      testState.linearMetadataError = null;
      testState.linearMetadataData = {
        workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
        teams: [
          { id: "team-1", name: "Engineering", key: "ENG", visibility: "public" },
          { id: "team-2", name: "Design", key: "DES", visibility: "private" },
        ],
        projects: [],
        states: [],
        labels: [],
      };
      buttonWithText(renderer!, "Check authorization").props.onClick?.();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.update(<RoutinesPage />);
    });

    expect(testState.linearMetadataRefresh).toHaveBeenCalled();
    expect(nodeText(renderer!.root)).toContain("Acme");
    expect(renderer!.root.findByProps({ id: "routine-linear-all-teams" }).props.checked).toBe(true);
    expect(buttonWithText(renderer!, "Create webhook")).toBeDefined();
  });

  it("creates the Linear webhook with the authorized scope and verifies the first delivery", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    testState.linearMetadataData = {
      workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
      teams: [
        { id: "team-1", name: "Engineering", key: "ENG", visibility: "public" },
        { id: "team-2", name: "Design", key: "DES", visibility: "private" },
      ],
      projects: [],
      states: [],
      labels: [],
    };
    let authorizationStarted = false;
    let connectionActionCount = 0;
    testState.command.mockImplementation(async (value: unknown) => {
      const input = (value as { input?: Record<string, unknown> }).input ?? {};
      if (input.provider === "linear") {
        const connection = linearConnectionFor(input.id as string, {
          teamIds: [...(input.teamIds as string[])],
          allTeams: input.allTeams === true,
          webhookId: "webhook-1",
        });
        testState.connectionsData.push(connection);
        return { _tag: "Success", value: connection };
      }
      if (!authorizationStarted) {
        authorizationStarted = true;
        return { _tag: "Success", value: { authorizeUrl: "https://linear.app/oauth/authorize" } };
      }
      connectionActionCount += 1;
      return {
        _tag: "Success",
        value: {
          ...linearConnectionFor(input.id as string),
          status: connectionActionCount === 1 ? "verified" : "disabled",
        },
      };
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-all-teams" })
        .props.onChange({ target: { checked: false } });
    });

    const teamScope = renderer!.root.findByProps({ id: "routine-linear-team-scope" });
    expect(nodeText(teamScope)).toContain("Engineering");
    expect(teamScope.props.value).toBe("");

    await act(async () => {
      teamScope.props.onChange({ target: { value: "team-1" } });
    });
    await act(async () => {
      buttonWithText(renderer!, "Create webhook").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const createCall = testState.command.mock.calls.find(
      ([value]) => (value as { input?: { provider?: string } }).input?.provider === "linear",
    );
    const connectionId = (createCall?.[0] as { input: { id: string } }).input.id;
    expect(createCall?.[0]).toMatchObject({
      environmentId: "environment-1",
      input: {
        provider: "linear",
        id: expect.stringMatching(/^connection-/),
        allTeams: false,
        teamIds: ["team-1"],
      },
    });
    expect(nodeText(renderer!.root)).toContain(
      `Callback: https://env.example/hooks/${connectionId}`,
    );
    expect(nodeText(renderer!.root)).toContain("Webhook: webhook-1");
    expect(renderer!.root.findByProps({ id: "routine-linear-connection" }).props.value).toBe(
      connectionId,
    );

    await act(async () => {
      buttonWithText(renderer!, "Verify").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(nodeText(renderer!.root)).toContain("First delivery received. The connection is ready.");
    expect(
      nodeText(
        renderer!.root.findByProps({
          "data-testid": "routine-linear-connection-diagnostics",
        }),
      ),
    ).toContain("Verified");

    await act(async () => {
      buttonWithText(renderer!, "Disable").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(nodeText(renderer!.root)).toContain(
      "Linear connection disabled. The provider webhook was removed; retry cleanup if relay revocation is still pending.",
    );
    expect(nodeText(renderer!.root)).not.toContain(
      "Delete the webhook in Linear's workspace settings to stop provider deliveries.",
    );
    expect(
      nodeText(
        renderer!.root.findByProps({
          "data-testid": "routine-linear-connection-diagnostics",
        }),
      ),
    ).toContain("Disabled");
    expect(buttonWithText(renderer!, "Verify").props.disabled).toBe(true);
    expect(buttonWithText(renderer!, "Retry cleanup").props.disabled).toBe(false);

    const callsBeforeRetry = testState.command.mock.calls.length;
    await act(async () => {
      buttonWithText(renderer!, "Retry cleanup").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(testState.command.mock.calls).toHaveLength(callsBeforeRetry + 1);
    expect(testState.command.mock.calls.at(-1)?.[0]).toEqual({
      environmentId: "environment-1",
      input: { id: connectionId },
    });
  });

  it("shows setup for another Linear workspace after creating a connection", async () => {
    vi.stubGlobal("window", {
      open: vi.fn(() => ({
        closed: false,
        location: { href: "about:blank" },
        close: vi.fn(),
      })),
    });
    testState.linearMetadataData = {
      workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
      teams: [{ id: "team-1", name: "Engineering", key: "ENG", visibility: "public" }],
      projects: [],
      states: [],
      labels: [],
    };
    const authorizationIds: string[] = [];
    testState.command.mockImplementation(async (value: unknown) => {
      const input = (value as { input?: Record<string, unknown> }).input ?? {};
      if (input.provider === "linear") {
        const connection = linearConnectionFor(input.id as string);
        testState.connectionsData.push(connection);
        return { _tag: "Success", value: connection };
      }
      authorizationIds.push(input.id as string);
      return { _tag: "Success", value: { authorizeUrl: "https://linear.app/oauth/authorize" } };
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-all-teams" })
        .props.onChange({ target: { checked: false } });
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-team-scope" })
        .props.onChange({ target: { value: "team-1" } });
    });
    await act(async () => {
      buttonWithText(renderer!, "Create webhook").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(nodeText(renderer!.root)).toContain("Webhook created.");
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(buttonWithText(renderer!, "Create webhook")).toBeDefined();
    expect(renderer!.root.findByProps({ id: "routine-linear-all-teams" }).props.checked).toBe(true);
    expect(renderer!.root.findAllByProps({ id: "routine-linear-team-scope" })).toHaveLength(0);
    expect(authorizationIds).toHaveLength(2);
    expect(authorizationIds[1]).not.toBe(authorizationIds[0]);
  });

  it("uses the selected workspace after creating a different Linear connection", async () => {
    const existingConnection = linearConnectionFor("connection-existing", {
      workspaceName: "Existing workspace",
      status: "verified",
    });
    testState.connectionsData.push(existingConnection);
    testState.linearMetadataData = {
      workspace: { id: "workspace-1", name: "Existing workspace", urlKey: "existing" },
      teams: [],
      projects: [],
      states: [],
      labels: [],
    };
    const createdConnection = linearConnectionFor("connection-created", {
      workspaceId: "workspace-2",
      workspaceName: "Created workspace",
      callbackUrl: "https://env.example/hooks/connection-created",
      webhookId: "webhook-created",
    });
    vi.stubGlobal("window", {
      open: vi.fn(() => ({
        closed: false,
        location: { href: "about:blank" },
        close: vi.fn(),
      })),
    });
    testState.command.mockImplementation(async (value: unknown) => {
      const input = (value as { input?: Record<string, unknown> }).input ?? {};
      if (input.provider === "linear") {
        testState.connectionsData.push(createdConnection);
        return { _tag: "Success", value: createdConnection };
      }
      if (input.id === "connection-existing") {
        return { _tag: "Success", value: existingConnection };
      }
      return { _tag: "Success", value: { authorizeUrl: "https://linear.app/oauth/authorize" } };
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect a workspace").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      buttonWithText(renderer!, "Create webhook").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      renderer!.root.findByProps({ id: "routine-linear-connection" }).props.onChange({
        target: { value: "connection-existing" },
      });
    });

    const diagnostics = renderer!.root.findByProps({
      "data-testid": "routine-linear-connection-diagnostics",
    });
    expect(nodeText(diagnostics)).toContain("Existing workspace");
    expect(nodeText(diagnostics)).not.toContain("Created workspace");

    await act(async () => {
      buttonWithText(renderer!, "Verify").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    const verifyCall = testState.command.mock.calls.find(
      ([value]) => (value as { input?: { id?: string } }).input?.id === "connection-existing",
    );
    expect(verifyCall?.[0]).toEqual({
      environmentId: "environment-1",
      input: { id: "connection-existing" },
    });
  });

  it("synchronizes the displayed connection when chat changes the Linear trigger", async () => {
    const existingConnection = linearConnectionFor("connection-existing", {
      workspaceName: "Existing workspace",
      status: "verified",
    });
    testState.connectionsData.push(existingConnection);
    testState.linearMetadataData = {
      workspace: { id: "workspace-1", name: "Existing workspace", urlKey: "existing" },
      teams: [],
      projects: [],
      states: [],
      labels: [],
    };
    const createdConnection = linearConnectionFor("connection-created", {
      workspaceId: "workspace-2",
      workspaceName: "Created workspace",
      callbackUrl: "https://env.example/hooks/connection-created",
      webhookId: "webhook-created",
    });
    vi.stubGlobal("window", {
      open: vi.fn(() => ({
        closed: false,
        location: { href: "about:blank" },
        close: vi.fn(),
      })),
    });
    testState.command.mockImplementation(async (value: unknown) => {
      const input = (value as { input?: Record<string, unknown> }).input ?? {};
      if (input.provider === "linear") {
        testState.connectionsData.push(createdConnection);
        return { _tag: "Success", value: createdConnection };
      }
      if (input.id === "connection-existing") {
        return { _tag: "Success", value: existingConnection };
      }
      return { _tag: "Success", value: { authorizeUrl: "https://linear.app/oauth/authorize" } };
    });
    renderer = await renderRoutinesPage();
    await act(async () => {
      menuItemWithText(renderer!, "Create in chat").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect a workspace").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      buttonWithText(renderer!, "Create webhook").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const chat = renderer!.root.findByType(RoutineChat);
    const chatDraft = chat.props.draft.configuration as Record<string, unknown>;
    await act(async () => {
      chat.props.onDraftChange({
        ...chatDraft,
        trigger: {
          kind: "linear",
          connectionId: "connection-existing",
          workspaceId: "workspace-1",
          event: "issue_created",
        },
      });
    });

    const diagnostics = renderer!.root.findByProps({
      "data-testid": "routine-linear-connection-diagnostics",
    });
    expect(nodeText(diagnostics)).toContain("Existing workspace");
    expect(nodeText(diagnostics)).not.toContain("Created workspace");

    await act(async () => {
      buttonWithText(renderer!, "Verify").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    const verifyCall = testState.command.mock.calls.find(
      ([value]) => (value as { input?: { id?: string } }).input?.id === "connection-existing",
    );
    expect(verifyCall?.[0]).toEqual({
      environmentId: "environment-1",
      input: { id: "connection-existing" },
    });
  });

  it("resumes a pending Linear authorization and reuses its connection id", async () => {
    const storage = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    };
    vi.stubGlobal("window", {
      localStorage,
      open: vi.fn(() => ({
        closed: false,
        location: { href: "about:blank" },
        close: vi.fn(),
      })),
    });
    testState.linearMetadataError = "Connect Linear before reading workspace metadata.";
    const authorizationIds: string[] = [];
    testState.command.mockImplementation(async (value: unknown) => {
      const input = (value as { input?: Record<string, unknown> }).input ?? {};
      if (typeof input.id === "string" && input.provider === undefined) {
        authorizationIds.push(input.id);
        return {
          _tag: "Success",
          value: { authorizeUrl: "https://linear.app/oauth/authorize" },
        };
      }
      return { _tag: "Success", value: linearConnectionFor(String(input.id)) };
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    const pendingId = authorizationIds[0];
    expect(pendingId).toMatch(/^connection-/);
    if (pendingId === undefined)
      throw new Error("Linear authorization did not return a connection id.");
    expect([...storage.values()]).toEqual([pendingId]);

    testState.linearMetadataError = null;
    testState.linearMetadataData = {
      workspace: { id: "workspace-old", name: "Old workspace", urlKey: "old" },
      teams: [],
      projects: [],
      states: [],
      labels: [],
    };
    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(authorizationIds).toEqual([pendingId, pendingId]);
    expect(nodeText(renderer!.root)).not.toContain("Old workspace");
    expect(
      renderer!.root.findAll((node) => nodeText(node).includes("Create webhook")),
    ).toHaveLength(0);

    testState.linearMetadataPending = true;
    await act(async () => {
      buttonWithText(renderer!, "Check authorization").props.onClick?.();
      await Promise.resolve();
    });
    testState.linearMetadataPending = false;
    testState.linearMetadataData = {
      workspace: { id: "workspace-new", name: "New workspace", urlKey: "new" },
      teams: [],
      projects: [],
      states: [],
      labels: [],
    };
    await act(async () => {
      renderer!.update(<RoutinesPage />);
      await Promise.resolve();
    });
    expect(nodeText(renderer!.root)).toContain("New workspace");
    expect(buttonWithText(renderer!, "Create webhook")).toBeDefined();

    testState.linearMetadataData = null;
    testState.linearMetadataError = "Connect Linear before reading workspace metadata.";
    await act(async () => renderer!.unmount());
    renderer = await openNewRoutineEditor();
    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(nodeText(renderer!.root)).toContain("Waiting for authorization…");

    await act(async () => {
      buttonWithText(renderer!, "Connect Linear").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(authorizationIds).toEqual([pendingId, pendingId, pendingId]);
    expect([...storage.values()]).toEqual([pendingId]);

    testState.connectionsData.push(linearConnectionFor(pendingId));
    await act(async () => renderer!.unmount());
    renderer = await openNewRoutineEditor();
    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(storage.size).toBe(0);
  });

  it("offers only public teams for an all-public Linear webhook", async () => {
    testState.listData.push(linearRoutineFor("routine-linear"));
    testState.connectionsData.push(
      linearConnectionFor("connection-linear", { allTeams: true, teamIds: [] }),
    );
    testState.linearMetadataData = {
      workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
      teams: [
        { id: "team-public", name: "Public team", key: "PUB", visibility: "public" },
        { id: "team-private", name: "Private team", key: "PRI", visibility: "private" },
        {
          id: "team-restricted",
          name: "Restricted team",
          key: "RST",
          visibility: "restricted",
        },
      ],
      projects: [],
      states: [],
      labels: [],
    };

    renderer = await openRoutineEditor("Linear brief");

    const teamPicker = nodeText(renderer.root.findByProps({ id: "routine-linear-team" }));
    expect(teamPicker).toContain("Public team");
    expect(teamPicker).not.toContain("Private team");
    expect(teamPicker).not.toContain("Restricted team");
  });

  it("retains an explicitly scoped private Linear team", async () => {
    testState.listData.push(linearRoutineFor("routine-linear"));
    testState.connectionsData.push(
      linearConnectionFor("connection-linear", {
        allTeams: false,
        teamIds: ["team-private"],
      }),
    );
    testState.linearMetadataData = {
      workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
      teams: [
        { id: "team-public", name: "Public team", key: "PUB", visibility: "public" },
        { id: "team-private", name: "Private team", key: "PRI", visibility: "private" },
      ],
      projects: [],
      states: [],
      labels: [],
    };

    renderer = await openRoutineEditor("Linear brief");

    const teamPicker = nodeText(renderer.root.findByProps({ id: "routine-linear-team" }));
    expect(teamPicker).toContain("Private team");
    expect(teamPicker).not.toContain("Public team");
  });

  it("renders Linear filters from connection metadata and requires the event filter", async () => {
    testState.listData.push(linearRoutineFor("routine-linear"));
    testState.connectionsData.push(
      linearConnectionFor("connection-linear", {
        teamIds: ["team-1"],
        allTeams: false,
        status: "verified",
      }),
    );
    testState.linearMetadataData = {
      workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
      teams: [
        { id: "team-1", name: "Engineering", key: "ENG", visibility: "public" },
        { id: "team-2", name: "Design", key: "DES", visibility: "private" },
      ],
      projects: [
        { id: "project-eng", name: "Engineering roadmap", teamIds: ["team-1"] },
        { id: "project-design", name: "Design system", teamIds: ["team-2"] },
      ],
      states: [
        { id: "state-1", name: "In Progress", teamId: "team-1", type: "started" },
        { id: "state-2", name: "Done", teamId: "team-2", type: "completed" },
      ],
      labels: [
        { id: "label-shared", name: "Bug", teamId: null },
        { id: "label-eng", name: "Backend", teamId: "team-1" },
        { id: "label-design", name: "Figma", teamId: "team-2" },
      ],
    };
    renderer = await openRoutineEditor("Linear brief");

    expect(nodeText(renderer.root.findByProps({ id: "routine-linear-team" }))).toContain(
      "Engineering",
    );
    expect(nodeText(renderer.root.findByProps({ id: "routine-linear-team" }))).not.toContain(
      "Design",
    );
    expect(nodeText(renderer.root.findByProps({ id: "routine-linear-project" }))).toContain(
      "Engineering roadmap",
    );
    expect(nodeText(renderer.root.findByProps({ id: "routine-linear-project" }))).not.toContain(
      "Design system",
    );

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-event" })
        .props.onChange({ target: { value: "status_changed" } });
    });

    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);
    const stateSelect = renderer.root.findByProps({ id: "routine-linear-state" });
    expect(nodeText(stateSelect)).toContain("In Progress");
    expect(nodeText(stateSelect)).not.toContain("Done");
    expect(nodeText(renderer.root)).toContain(
      "Choose the status transition that should start the routine.",
    );

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-state" })
        .props.onChange({ target: { value: "state-1" } });
    });
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(false);
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-state" })
        .props.onChange({ target: { value: "" } });
    });
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-event" })
        .props.onChange({ target: { value: "label_added" } });
    });
    const labelSelect = renderer.root.findByProps({ id: "routine-linear-label" });
    expect(nodeText(labelSelect)).toContain("Bug");
    expect(nodeText(labelSelect)).toContain("Backend");
    expect(nodeText(labelSelect)).not.toContain("Figma");
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-label" })
        .props.onChange({ target: { value: "label-eng" } });
    });
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(false);
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-label" })
        .props.onChange({ target: { value: "" } });
    });
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);
  });

  it("limits Linear statuses and labels to the selected project's teams", async () => {
    testState.listData.push(linearRoutineFor("routine-linear-project-scope"));
    testState.connectionsData.push(
      linearConnectionFor("connection-linear", { teamIds: [], allTeams: true, status: "verified" }),
    );
    testState.linearMetadataData = {
      workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
      teams: [
        { id: "team-1", name: "Engineering", key: "ENG", visibility: "public" },
        { id: "team-2", name: "Design", key: "DES", visibility: "public" },
      ],
      projects: [
        { id: "project-eng", name: "Engineering roadmap", teamIds: ["team-1"] },
        { id: "project-design", name: "Design system", teamIds: ["team-2"] },
      ],
      states: [
        { id: "state-1", name: "Engineering in progress", teamId: "team-1", type: "started" },
        { id: "state-2", name: "Design in progress", teamId: "team-2", type: "started" },
      ],
      labels: [
        { id: "label-shared", name: "Shared", teamId: null },
        { id: "label-eng", name: "Backend", teamId: "team-1" },
        { id: "label-design", name: "Figma", teamId: "team-2" },
      ],
    };
    renderer = await openRoutineEditor("Linear brief");

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-event" })
        .props.onChange({ target: { value: "status_changed" } });
    });
    expect(nodeText(renderer.root.findByProps({ id: "routine-linear-state" }))).toContain(
      "Design in progress",
    );
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-state" })
        .props.onChange({ target: { value: "state-2" } });
    });
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(false);
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-project" })
        .props.onChange({ target: { value: "project-eng" } });
    });
    const states = nodeText(renderer.root.findByProps({ id: "routine-linear-state" }));
    expect(states).toContain("Engineering in progress");
    expect(states).not.toContain("Design in progress");
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-event" })
        .props.onChange({ target: { value: "label_added" } });
    });
    const labels = nodeText(renderer.root.findByProps({ id: "routine-linear-label" }));
    expect(labels).toContain("Shared");
    expect(labels).toContain("Backend");
    expect(labels).not.toContain("Figma");
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-project" })
        .props.onChange({ target: { value: "" } });
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-label" })
        .props.onChange({ target: { value: "label-design" } });
    });
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(false);
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-project" })
        .props.onChange({ target: { value: "project-eng" } });
    });
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);
  });

  it("replaces the Linear pickers with the metadata error when access is revoked", async () => {
    testState.listData.push(linearRoutineFor("routine-linear-revoked"));
    testState.connectionsData.push(
      linearConnectionFor("connection-linear", {
        status: "verified",
        metadataAccess: "revoked",
      }),
    );
    testState.linearMetadataError =
      "Linear metadata access was revoked. Disable this connection and connect Linear again.";
    renderer = await openRoutineEditor("Linear brief");

    expect(nodeText(renderer.root)).toContain("Metadata access revoked");
    expect(nodeText(renderer.root)).toContain(
      "Linear metadata access was revoked. Disable this connection and connect Linear again.",
    );
    expect(renderer.root.findAllByProps({ id: "routine-linear-event" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ id: "routine-linear-team" })).toHaveLength(0);
  });

  it("labels a Linear routine on the library card", async () => {
    testState.listData.push(linearRoutineFor("routine-linear"));
    renderer = await renderRoutinesPage();

    expect(nodeText(renderer.root)).toContain("Linear · Issue created");
  });
});

describe("RoutinesPage save failures", () => {
  const CONFLICT_MESSAGE = "This routine changed. Reload the saved version before saving again.";
  const GENERIC_MESSAGE = "The routine request failed. Try again.";
  let renderer: ReactTestRenderer | undefined;

  const submitSave = async () => {
    await act(async () => {
      buttonWithText(renderer!, "Save").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    testState.command.mockReset();
    testState.listData.length = 0;
    testState.connectionsData.length = 0;
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it("shows the stale-revision conflict message when the save is rejected", async () => {
    testState.listData.push(savedRoutineFor("routine-conflict"));
    testState.command.mockImplementation(async () => ({
      _tag: "Failure",
      cause: Cause.fail(new RoutineError({ code: "conflict", message: CONFLICT_MESSAGE })),
    }));
    renderer = await openSavedRoutineEditor();

    await submitSave();

    const text = nodeText(renderer!.root);
    expect(text).toContain(CONFLICT_MESSAGE);
    expect(text).not.toContain(GENERIC_MESSAGE);
    expect(renderer!.root.findByProps({ id: "routine-name" }).props.value).toBe(
      "Daily project brief",
    );
  });

  it("keeps the message of an unrelated save failure", async () => {
    testState.listData.push(savedRoutineFor("routine-validation"));
    testState.command.mockImplementation(async () => ({
      _tag: "Failure",
      cause: Cause.fail(
        new RoutineError({
          code: "validation",
          message: "Connect the GitHub repository before saving.",
        }),
      ),
    }));
    renderer = await openSavedRoutineEditor();

    await submitSave();

    const text = nodeText(renderer!.root);
    expect(text).toContain("Connect the GitHub repository before saving.");
    expect(text).not.toContain(CONFLICT_MESSAGE);
  });

  it("falls back to the generic message when no failure carries a message", async () => {
    testState.listData.push(savedRoutineFor("routine-defect"));
    testState.command.mockImplementation(async () => ({
      _tag: "Failure",
      cause: Cause.die(new Error("boom")),
    }));
    renderer = await openSavedRoutineEditor();

    await submitSave();

    const text = nodeText(renderer!.root);
    expect(text).toContain(GENERIC_MESSAGE);
    expect(text).not.toContain(CONFLICT_MESSAGE);
  });
});

describe("RoutinesPage routine environment ownership", () => {
  let renderer: ReactTestRenderer | undefined;

  const sharedRoutineConfiguration = {
    name: "Daily brief",
    instruction: "Summarize what changed.",
    projectId: "project-1",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "approval-required",
    workspace: { kind: "shared", directory: "/tmp/widgets" },
    trigger: { kind: "daily", time: "09:00", timezone: "UTC" },
  };

  function copiedRoutine(recordEnvironmentId: string, revision: number) {
    return {
      id: "routine-shared",
      environmentId: recordEnvironmentId,
      revision,
      configuration: sharedRoutineConfiguration,
      state: "enabled",
      nextDueAt: "2026-01-02T09:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  function routineCardsNamed(current: ReactTestRenderer, name: string): ReactTestInstance[] {
    return current.root.findAll(
      (node) =>
        node.type === "button" &&
        node.props["aria-pressed"] !== undefined &&
        nodeText(node).includes(name),
    );
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    testState.command.mockReset();
    testState.command.mockImplementation(async () => ({
      _tag: "Success",
      value: { conversation: { kind: "unconfirmed" } },
    }));
    testState.environments = [
      { environmentId: "environment-1", label: "Local", connection: { phase: "connected" } },
      { environmentId: "environment-2", label: "Copied", connection: { phase: "connected" } },
    ];
    testState.listDataByEnvironment = {
      "environment-1": [copiedRoutine("environment-1", 3)],
      "environment-2": [copiedRoutine("environment-1", 7)],
    };
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
    testState.environments = [
      { environmentId: "environment-1", label: "Local", connection: { phase: "connected" } },
    ];
    testState.listDataByEnvironment = {};
  });

  it("sends a test run for a copied routine to the environment that served it", async () => {
    await act(async () => {
      renderer = create(<RoutinesPage />);
    });
    const current = renderer!;

    const cards = routineCardsNamed(current, "Daily brief");
    expect(cards).toHaveLength(2);
    const copiedCard = cards.find((card) => nodeText(card).includes("Copied"));
    if (!copiedCard) throw new Error("Copied routine card not found");
    await act(async () => {
      copiedCard.props.onClick?.();
    });

    await act(async () => {
      buttonWithText(current, "Test run").props.onClick?.();
      await Promise.resolve();
    });

    const testCalls = testState.command.mock.calls.filter(
      ([value]) => (value as { input?: { id?: string } }).input?.id === "routine-shared",
    );
    expect(testCalls).toHaveLength(1);
    expect(testCalls[0]?.[0]).toEqual({
      environmentId: "environment-2",
      input: {
        id: "routine-shared",
        expectedRevision: 7,
        requestId: expect.any(String),
      },
    });
    expect(
      testState.command.mock.calls.every(
        ([value]) => (value as { environmentId?: string }).environmentId !== "environment-1",
      ),
    ).toBe(true);
  });

  it("keeps an offline copied routine from reaching the environment named in its record", async () => {
    testState.environments = [
      { environmentId: "environment-1", label: "Local", connection: { phase: "connected" } },
      { environmentId: "environment-2", label: "Copied", connection: { phase: "connecting" } },
    ];
    await act(async () => {
      renderer = create(<RoutinesPage />);
    });
    const current = renderer!;

    const cards = routineCardsNamed(current, "Daily brief");
    expect(cards).toHaveLength(2);
    const copiedCard = cards.find((card) => nodeText(card).includes("Copied"));
    if (!copiedCard) throw new Error("Copied routine card not found");
    await act(async () => {
      copiedCard.props.onClick?.();
    });

    expect(
      current.root.findAll((node) => nodeText(node).includes("This environment is offline")).length,
    ).toBeGreaterThan(0);
    const testButton = buttonWithText(current, "Test run");
    expect(testButton.props.disabled).toBe(true);

    await act(async () => {
      testButton.props.onClick?.();
      await Promise.resolve();
    });

    expect(
      testState.command.mock.calls.filter(
        ([value]) => (value as { environmentId?: string }).environmentId === "environment-1",
      ),
    ).toHaveLength(0);
  });
});

const REMOTE_PROJECT = {
  id: "project-2",
  environmentId: "environment-2",
  title: "Remote widgets",
  workspaceRoot: "/tmp/remote-widgets",
  repositoryIdentity: null,
};

function routineFixture(input: {
  id: string;
  environmentId: string;
  name: string;
  state?: "enabled" | "paused";
  projectId?: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    environmentId: input.environmentId,
    revision: 1,
    configuration: {
      name: input.name,
      instruction: "Reply with exactly: routine-ok",
      projectId: input.projectId ?? "project-1",
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      runtimeMode: "approval-required",
      workspace: { kind: "shared", directory: "/tmp/widgets" },
      trigger: { kind: "daily", time: "09:00", timezone: "UTC" },
    },
    state: input.state ?? "enabled",
    nextDueAt: "2026-09-17T09:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function withEnvironmentPhases(secondPhase: string): void {
  testState.environments = [
    { environmentId: "environment-1", label: "Local", connection: { phase: "connected" } },
    { environmentId: "environment-2", label: "Remote", connection: { phase: secondPhase } },
  ];
}

async function openRoutineEditor(name: string): Promise<ReactTestRenderer> {
  return openRoutineFrom((current) => buttonWithText(current, name).props.onClick?.());
}

describe("RoutinesPage offline environments", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    testState.command.mockReset();
    testState.connectionsData.length = 0;
    testState.metadataData.repository = null;
    testState.listData.length = 0;
    testState.listDataByEnvironment = {};
    if (!testState.projects.some((project) => project.id === REMOTE_PROJECT.id)) {
      testState.projects.push(REMOTE_PROJECT);
    }
    withEnvironmentPhases("offline");
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
    testState.environments = [
      { environmentId: "environment-1", label: "Local", connection: { phase: "connected" } },
    ];
    testState.listDataByEnvironment = {};
    const remoteIndex = testState.projects.findIndex((project) => project.id === REMOTE_PROJECT.id);
    if (remoteIndex >= 0) testState.projects.splice(remoteIndex, 1);
  });

  it("disables mutations for a routine a disconnected environment serves", async () => {
    testState.listDataByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-shared",
          environmentId: "environment-1",
          name: "Remote routine",
          projectId: "project-2",
        }),
      ],
    };

    renderer = await openRoutineEditor("Remote routine");

    expect(nodeText(buttonWithText(renderer, "Remote routine"))).toContain("Offline");
    expect(buttonWithText(renderer, "Test run").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Pause").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Delete").props.disabled).toBe(true);
  });

  it("disables Resume for a paused routine a disconnected environment serves", async () => {
    testState.listDataByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-paused",
          environmentId: "environment-1",
          name: "Remote paused",
          state: "paused",
        }),
      ],
    };

    renderer = await openRoutineEditor("Remote paused");

    expect(buttonWithText(renderer, "Resume").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Delete").props.disabled).toBe(true);
  });

  it("re-enables mutations when the environment reconnects without a reload", async () => {
    testState.listDataByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-shared",
          environmentId: "environment-1",
          name: "Remote routine",
          projectId: "project-2",
        }),
      ],
    };
    renderer = await openRoutineEditor("Remote routine");
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);

    withEnvironmentPhases("connected");
    await act(async () => {
      renderer!.update(<RoutinesPage />);
    });

    expect(buttonWithText(renderer, "Test run").props.disabled).toBe(false);
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(false);
    expect(buttonWithText(renderer, "Pause").props.disabled).toBe(false);
    expect(buttonWithText(renderer, "Delete").props.disabled).toBe(false);
  });

  it("disables mutations when the environment disconnects while the editor is open", async () => {
    withEnvironmentPhases("connected");
    testState.listDataByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-shared",
          environmentId: "environment-1",
          name: "Remote routine",
          projectId: "project-2",
        }),
      ],
    };
    renderer = await openRoutineEditor("Remote routine");
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(false);

    withEnvironmentPhases("offline");
    await act(async () => {
      renderer!.update(<RoutinesPage />);
    });

    expect(buttonWithText(renderer, "Test run").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Pause").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Delete").props.disabled).toBe(true);
  });

  it("keeps the offline gate after saving a routine a disconnected environment serves", async () => {
    withEnvironmentPhases("connected");
    testState.listDataByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-shared",
          environmentId: "environment-1",
          name: "Remote routine",
          projectId: "project-2",
        }),
      ],
    };
    testState.command.mockImplementation(async () => ({
      _tag: "Success",
      value: routineFixture({
        id: "routine-shared",
        environmentId: "environment-2",
        name: "Remote routine",
        projectId: "project-2",
      }),
    }));
    renderer = await openRoutineEditor("Remote routine");
    await act(async () => {
      buttonWithText(renderer!, "Save").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    withEnvironmentPhases("offline");
    await act(async () => {
      renderer!.update(<RoutinesPage />);
    });

    expect(buttonWithText(renderer, "Test run").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Delete").props.disabled).toBe(true);
  });

  it("keeps the offline gate when an unavailable environment drops its rows", async () => {
    testState.listDataByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-shared",
          environmentId: "environment-1",
          name: "Remote routine",
          projectId: "project-2",
        }),
      ],
    };
    renderer = await openRoutineEditor("Remote routine");

    testState.listDataByEnvironment = {};
    await act(async () => {
      renderer!.update(<RoutinesPage />);
    });

    expect(buttonWithText(renderer, "Test run").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Delete").props.disabled).toBe(true);
  });

  it("keeps a connected environment's controls enabled", async () => {
    testState.listDataByEnvironment = {
      "environment-1": [
        routineFixture({
          id: "routine-local",
          environmentId: "environment-1",
          name: "Local routine",
        }),
      ],
    };

    renderer = await openRoutineEditor("Local routine");

    expect(buttonWithText(renderer, "Test run").props.disabled).toBe(false);
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(false);
    expect(buttonWithText(renderer, "Pause").props.disabled).toBe(false);
    expect(buttonWithText(renderer, "Delete").props.disabled).toBe(false);
  });
});
