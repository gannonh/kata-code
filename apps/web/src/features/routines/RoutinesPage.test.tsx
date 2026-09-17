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
  listByEnvironment: {} as Record<string, ReadonlyArray<Record<string, unknown>>>,
  emptyRoutineList: [] as ReadonlyArray<Record<string, unknown>>,
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
    list: (target: { environmentId: string }) => ({
      kind: "list",
      environmentId: target.environmentId,
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
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: unknown) => {
    if (
      typeof query === "object" &&
      query !== null &&
      (query as { kind?: unknown }).kind === "list"
    ) {
      return {
        data:
          testState.listByEnvironment[(query as { environmentId: string }).environmentId] ??
          testState.emptyRoutineList,
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

function routineFixture(input: {
  id: string;
  environmentId: string;
  name: string;
  state?: "enabled" | "paused";
}): Record<string, unknown> {
  return {
    id: input.id,
    environmentId: input.environmentId,
    revision: 1,
    configuration: {
      name: input.name,
      instruction: "Reply with exactly: routine-ok",
      projectId: "project-1",
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

function withSingleEnvironment(): void {
  testState.environments = [
    { environmentId: "environment-1", label: "Local", connection: { phase: "connected" } },
  ];
}

async function openRoutineEditor(name: string): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<RoutinesPage />);
  });
  const current = renderer!;
  await act(async () => {
    buttonWithText(current, name).props.onClick?.();
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
    testState.listByEnvironment = {};
    withSingleEnvironment();
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

describe("RoutinesPage offline environments", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    testState.command.mockReset();
    testState.connectionsData.length = 0;
    testState.metadataData.repository = null;
    testState.listByEnvironment = {};
    withEnvironmentPhases("offline");
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it("disables mutations for a routine a disconnected environment serves", async () => {
    testState.listByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-shared",
          environmentId: "environment-1",
          name: "Remote routine",
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
    testState.listByEnvironment = {
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
    testState.listByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-shared",
          environmentId: "environment-1",
          name: "Remote routine",
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
    testState.listByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-shared",
          environmentId: "environment-1",
          name: "Remote routine",
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
    testState.listByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-shared",
          environmentId: "environment-1",
          name: "Remote routine",
        }),
      ],
    };
    testState.command.mockImplementation(async () => ({
      _tag: "Success",
      value: routineFixture({
        id: "routine-shared",
        environmentId: "environment-1",
        name: "Remote routine",
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
    testState.listByEnvironment = {
      "environment-2": [
        routineFixture({
          id: "routine-shared",
          environmentId: "environment-1",
          name: "Remote routine",
        }),
      ],
    };
    renderer = await openRoutineEditor("Remote routine");

    testState.listByEnvironment = {};
    await act(async () => {
      renderer!.update(<RoutinesPage />);
    });

    expect(buttonWithText(renderer, "Test run").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Save").props.disabled).toBe(true);
    expect(buttonWithText(renderer, "Delete").props.disabled).toBe(true);
  });

  it("keeps a connected environment's controls enabled", async () => {
    testState.listByEnvironment = {
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
    testState.listByEnvironment = {};
    testState.connectionsData.length = 0;
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  it("shows the stale-revision conflict message when the save is rejected", async () => {
    testState.listByEnvironment = { "environment-1": [savedRoutineFor("routine-conflict")] };
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
    testState.listByEnvironment = { "environment-1": [savedRoutineFor("routine-validation")] };
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
    testState.listByEnvironment = { "environment-1": [savedRoutineFor("routine-defect")] };
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
