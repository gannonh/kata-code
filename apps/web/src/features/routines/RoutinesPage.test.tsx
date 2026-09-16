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
  queries: {
    list: Symbol("list"),
    connections: Symbol("connections"),
    preview: Symbol("preview"),
    metadata: Symbol("metadata"),
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
    history: () => Symbol("history"),
    save: Symbol("save"),
    change: Symbol("change"),
    test: Symbol("test"),
    createConnection: Symbol("create-connection"),
    verifyConnection: Symbol("verify-connection"),
    disableConnection: Symbol("disable-connection"),
    rotateConnectionSecret: Symbol("rotate-secret"),
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => testState.command,
}));
vi.mock("../../state/query", () => {
  const emptyRoutineList: readonly unknown[] = [];
  return {
    useEnvironmentQuery: (query: unknown) => {
      const listQuery = query as { tag?: symbol; environmentId?: string } | null;
      if (listQuery?.tag === testState.queries.list) {
        return {
          data: testState.listDataByEnvironment[listQuery.environmentId ?? ""] ?? emptyRoutineList,
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
      return { data: null, error: null, isPending: false, isSuccess: false, refresh: vi.fn() };
    },
  };
});
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

async function openNewRoutineEditor(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<RoutinesPage />);
  });
  const current = renderer!;
  await act(async () => {
    menuItemWithText(current, "Set up manually").props.onClick?.();
    await Promise.resolve();
    await Promise.resolve();
  });
  return current;
}

describe("RoutinesPage GitHub trigger setup", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    testState.command.mockReset();
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
