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
  linearPreviewData: null as null | Record<string, unknown>,
  linearPreviewError: null as string | null,
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
    attachConnectionSecret: Symbol("attach-secret"),
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
      const input = (listQuery as { input?: Record<string, unknown> }).input;
      const preview = input !== undefined && "apiKey" in input;
      return {
        data: preview ? testState.linearPreviewData : testState.linearMetadataData,
        error: preview ? testState.linearPreviewError : testState.linearMetadataError,
        isPending: false,
        isSuccess: true,
        refresh: vi.fn(),
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
    testState.linearPreviewData = null;
    testState.linearPreviewError = null;
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

  it("previews a workspace and creates a scoped connection from an API key", async () => {
    testState.linearPreviewData = {
      workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
      teams: [
        { id: "team-1", name: "Engineering", key: "ENG" },
        { id: "team-2", name: "Design", key: "DES" },
      ],
      projects: [],
      states: [],
      labels: [],
    };
    testState.command.mockImplementation(async (value: unknown) => {
      const input = (value as { input?: Record<string, unknown> }).input ?? {};
      if (input.provider === "linear") {
        const connection = linearConnectionFor(input.id as string, {
          teamIds: (input.teamIds as string[]) ?? [],
          allTeams: input.allTeams === true,
        });
        testState.connectionsData.push(connection);
        return { _tag: "Success", value: connection };
      }
      return {
        _tag: "Success",
        value: { ...linearConnectionFor("connection-linear"), status: "verified" },
      };
    });
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-api-key" })
        .props.onValueChange("lin_api_key");
    });
    await act(async () => {
      buttonWithText(renderer!, "Check workspace").props.onClick?.();
    });

    expect(nodeText(renderer!.root)).toContain("Acme");

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-all-teams" })
        .props.onChange({ target: { checked: false } });
    });
    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-team-team-1" })
        .props.onChange({ target: { checked: true } });
    });
    await act(async () => {
      buttonWithText(renderer!, "Create connection").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const createCall = testState.command.mock.calls.find(
      ([value]) => (value as { input?: { provider?: string } }).input?.provider === "linear",
    );
    expect(createCall?.[0]).toMatchObject({
      environmentId: "environment-1",
      input: {
        provider: "linear",
        id: expect.stringMatching(/^connection-/),
        apiKey: "lin_api_key",
        allTeams: false,
        teamIds: ["team-1"],
      },
    });
    const connectionId = (createCall?.[0] as { input: { id: string } }).input.id;
    expect(nodeText(renderer!.root)).toContain(`https://env.example/hooks/${connectionId}`);
    expect(nodeText(renderer!.root)).toContain("Open Linear webhook settings");
    expect(renderer!.root.findByProps({ id: "routine-linear-connection" }).props.value).toBe(
      connectionId,
    );

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-signing-secret" })
        .props.onValueChange("linear_secret");
    });
    await act(async () => {
      buttonWithText(renderer!, "Attach secret").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(nodeText(renderer!.root)).toContain("Signing secret attached.");

    await act(async () => {
      buttonWithText(renderer!, "Verify").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(nodeText(renderer!.root)).toContain("First delivery received. The connection is ready.");

    await act(async () => {
      buttonWithText(renderer!, "Disable").props.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(nodeText(renderer!.root)).toContain(
      "Delete the webhook in Linear's workspace settings to stop provider deliveries.",
    );
  });

  it("shows the workspace preview error for a rejected API key", async () => {
    testState.linearPreviewError =
      "Linear rejected the metadata credential. Check the API key and its access.";
    renderer = await openNewRoutineEditor();

    await act(async () => {
      buttonWithText(renderer!, "Linear event").props.onClick?.();
    });
    await act(async () => {
      renderer!.root.findByProps({ id: "routine-linear-api-key" }).props.onValueChange("bad_key");
    });
    await act(async () => {
      buttonWithText(renderer!, "Check workspace").props.onClick?.();
    });

    expect(nodeText(renderer!.root)).toContain("Linear rejected the metadata credential.");
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
        { id: "team-1", name: "Engineering", key: "ENG" },
        { id: "team-2", name: "Design", key: "DES" },
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
    expect(nodeText(renderer.root.findByProps({ id: "routine-linear-project" }))).toContain(
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
    expect(nodeText(stateSelect)).toContain("Done");
    expect(nodeText(renderer.root)).toContain(
      "Choose the status transition that should start the routine.",
    );

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-state" })
        .props.onChange({ target: { value: "state-2" } });
    });
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(false);

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-event" })
        .props.onChange({ target: { value: "label_added" } });
    });
    const labelSelect = renderer.root.findByProps({ id: "routine-linear-label" });
    expect(nodeText(labelSelect)).toContain("Bug");
    expect(nodeText(labelSelect)).toContain("Backend");
    expect(nodeText(labelSelect)).toContain("Figma");
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);

    await act(async () => {
      renderer!.root
        .findByProps({ id: "routine-linear-label" })
        .props.onChange({ target: { value: "label-eng" } });
    });
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(false);
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
      "Linear metadata access was revoked. Add a new API key for this workspace.";
    renderer = await openRoutineEditor("Linear brief");

    expect(nodeText(renderer.root)).toContain("Metadata access revoked");
    expect(nodeText(renderer.root)).toContain(
      "Linear metadata access was revoked. Add a new API key for this workspace.",
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
