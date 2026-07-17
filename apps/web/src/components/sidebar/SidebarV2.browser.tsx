import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationReadModel,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerConfig,
  type ServerLifecycleWelcomePayload,
  ServerConfig as ServerConfigSchema,
  WS_METHODS,
} from "@kata-sh/code-contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { page } from "vite-plus/test/browser";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { render } from "vitest-browser-react";

import { createAuthenticatedSessionHandlers } from "../../../test/authHttpHandlers";
import { BrowserWsRpcHarness } from "../../../test/wsRpcHarness";
import { useComposerDraftStore } from "../../composerDraftStore";
import { __resetLocalApiForTests } from "../../localApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { getWsConnectionStatus } from "../../rpc/wsConnectionState";
import { getRouter } from "../../router";
import { useUiStateStore } from "../../uiStateStore";
import {
  buildSidebarV2Scenario,
  listSidebarV2Scenarios,
  SIDEBAR_V2_FIXTURE_NOW_ISO,
  SIDEBAR_V2_LOCAL_ENV_ID,
  SIDEBAR_V2_SCENARIO_IDS,
  type SidebarV2Scenario,
  type SidebarV2ScenarioId,
  toSidebarV2ShellSnapshot,
} from "./fixtures/sidebarV2Scenarios";

vi.mock("./useSidebarNowMs", () => ({
  // Keep in sync with SIDEBAR_V2_FIXTURE_NOW_MS in fixtures/sidebarV2Scenarios.ts
  useSidebarNowMs: () => Date.parse("2026-07-16T12:00:00.000Z"),
}));

vi.mock("../../lib/vcsStatusState", () => {
  const status = {
    data: {
      isRepo: true,
      sourceControlProvider: {
        kind: "github",
        name: "GitHub",
        baseUrl: "https://github.com",
      },
      hasPrimaryRemote: true,
      isDefaultRef: true,
      refName: "main",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    },
    error: null,
    cause: null,
    isPending: false,
  };

  return {
    getVcsStatusDataForTarget: (state: typeof status) => state.data,
    getVcsStatusSnapshot: () => status,
    useVcsStatus: () => status,
    useVcsStatuses: () => new Map(),
    refreshVcsStatus: () => Promise.resolve(null),
    resetVcsStatusStateForTests: () => undefined,
  };
});

interface TestFixture {
  scenario: SidebarV2Scenario;
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: ServerLifecycleWelcomePayload;
}

let fixture: TestFixture;
const rpcHarness = new BrowserWsRpcHarness();
const encodeServerConfig = Schema.encodeSync(ServerConfigSchema);
const wsLink = ws.link(/ws(s)?:\/\/.*/);

function createBaseServerConfig(): ServerConfig {
  return {
    environment: {
      environmentId: SIDEBAR_V2_LOCAL_ENV_ID,
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-access-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/kata-code",
    keybindingsConfigPath: "/repo/kata-code/.katacode-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        driver: ProviderDriverKind.make("codex"),
        instanceId: ProviderInstanceId.make("codex"),
        enabled: true,
        installed: true,
        version: "0.116.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: SIDEBAR_V2_FIXTURE_NOW_ISO,
        models: [],
        slashCommands: [],
        skills: [],
      },
    ],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/repo/kata-code/.katacode/logs",
      localTracingEnabled: true,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: false,
      defaultThreadEnvMode: "local" as const,
      textGenerationModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4-mini",
      },
      providers: {
        codex: {
          enabled: true,
          binaryPath: "",
          homePath: "",
          shadowHomePath: "",
          customModels: [],
        },
        claudeAgent: {
          enabled: true,
          binaryPath: "",
          homePath: "",
          customModels: [],
          launchArgs: "",
        },
        cursor: { enabled: true, binaryPath: "", apiEndpoint: "", customModels: [] },
        grok: { enabled: true, binaryPath: "", customModels: [] },
        opencode: {
          enabled: true,
          binaryPath: "",
          serverUrl: "",
          serverPassword: "",
          customModels: [],
        },
        pi: {
          enabled: true,
          binaryPath: "pi",
          agentDir: "",
          projectTrustPolicy: "never",
          customModels: [],
        },
      },
    },
  };
}

function buildFixture(scenarioId: SidebarV2ScenarioId = "mixed-tiers"): TestFixture {
  const scenario = buildSidebarV2Scenario(scenarioId);
  return {
    scenario,
    snapshot: scenario.snapshot,
    serverConfig: createBaseServerConfig(),
    welcome: {
      environment: {
        environmentId: SIDEBAR_V2_LOCAL_ENV_ID,
        label: "Local environment",
        platform: { os: "darwin" as const, arch: "arm64" as const },
        serverVersion: "0.0.0-test",
        capabilities: { repositoryIdentity: true },
      },
      cwd: "/repo/kata-code",
      projectName: "kata-code",
      bootstrapProjectId: scenario.bootstrapProjectId,
      bootstrapThreadId: scenario.bootstrapThreadId,
    },
  };
}

function resolveWsRpc(tag: string): unknown {
  if (tag === WS_METHODS.serverGetConfig) {
    return encodeServerConfig(fixture.serverConfig);
  }
  if (tag === WS_METHODS.vcsListRefs) {
    return {
      isRepo: true,
      hasPrimaryRemote: true,
      nextCursor: null,
      totalCount: 1,
      refs: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return { entries: [], truncated: false };
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    void rpcHarness.connect(client);
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      void rpcHarness.onMessage(rawData);
    });
  }),
  ...createAuthenticatedSessionHandlers(() => fixture.serverConfig.auth),
  http.get("*/api/assets/*", () => new HttpResponse(null, { status: 204 })),
);

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  return element!;
}

async function waitForSidebarV2(): Promise<HTMLElement> {
  return waitForElement(
    () => document.querySelector<HTMLElement>('[data-testid="sidebar-v2-list"]'),
    "Sidebar v2 list should mount",
  );
}

async function waitForWsConnection(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(getWsConnectionStatus().phase).toBe("connected");
    },
    { timeout: 8_000, interval: 16 },
  );
}

async function setDesktopViewport(): Promise<void> {
  await page.viewport(960, 1_100);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      ).not.toBe("");
    },
    { timeout: 4_000, interval: 16 },
  );
}

function applyLastVisited(scenario: SidebarV2Scenario): void {
  const entries = scenario.lastVisitedAtByThreadId;
  if (!entries) return;
  useUiStateStore.setState((state) => ({
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      ...entries,
    },
  }));
}

function pushScenario(scenarioId: SidebarV2ScenarioId): void {
  const scenario = buildSidebarV2Scenario(scenarioId);
  fixture = {
    ...fixture,
    scenario,
    snapshot: scenario.snapshot,
    welcome: {
      ...fixture.welcome,
      bootstrapProjectId: scenario.bootstrapProjectId,
      bootstrapThreadId: scenario.bootstrapThreadId,
    },
  };
  rpcHarness.emitStreamValue(ORCHESTRATION_WS_METHODS.subscribeShell, {
    kind: "snapshot",
    snapshot: toSidebarV2ShellSnapshot(scenario.snapshot, scenario.shellFlagsByThreadId),
  });
  applyLastVisited(scenario);
}

function mountScenarioSwitcher(): () => void {
  const bar = document.createElement("div");
  bar.dataset.testid = "sidebar-v2-scenario-switcher";
  bar.style.cssText =
    "position:fixed;z-index:99999;top:8px;right:8px;display:flex;flex-wrap:wrap;gap:6px;max-width:420px;padding:8px;background:#111;border:1px solid #333;border-radius:8px;";
  for (const scenario of listSidebarV2Scenarios()) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = scenario.label;
    button.dataset.scenarioId = scenario.id;
    button.style.cssText =
      "font:12px/1.2 ui-sans-serif,system-ui;padding:6px 8px;border-radius:6px;border:1px solid #444;background:#1a1a1e;color:#fff;cursor:pointer;";
    button.addEventListener("click", () => {
      pushScenario(scenario.id);
    });
    bar.append(button);
  }
  document.body.append(bar);
  return () => bar.remove();
}

async function mountApp(scenarioId: SidebarV2ScenarioId): Promise<{
  cleanup: () => Promise<void>;
}> {
  fixture = buildFixture(scenarioId);
  applyLastVisited(fixture.scenario);
  await setDesktopViewport();
  await waitForProductionStyles();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(
    createMemoryHistory({
      initialEntries: [`/${SIDEBAR_V2_LOCAL_ENV_ID}/${fixture.scenario.bootstrapThreadId}`],
    }),
  );

  const screen = await render(
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
    </AppAtomRegistryProvider>,
    { container: host },
  );

  await waitForElement(
    () => document.querySelector<HTMLElement>('[data-testid="composer-editor"]'),
    "Composer should render",
  );
  await waitForWsConnection();
  await waitForSidebarV2();

  const removeSwitcher = mountScenarioSwitcher();

  return {
    cleanup: async () => {
      removeSwitcher();
      await screen.unmount();
      host.remove();
    },
  };
}

function listSection(label: string): Element | null {
  return (
    (Array.from(document.querySelectorAll(".sb-sec")).find((node) =>
      (node.textContent ?? "").includes(label),
    ) as Element | undefined) ?? null
  );
}

describe("Sidebar v2 fixtures + playground", () => {
  beforeAll(async () => {
    fixture = buildFixture("mixed-tiers");
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  });

  afterAll(async () => {
    await rpcHarness.disconnect();
    await worker.stop();
  });

  beforeEach(async () => {
    fixture = buildFixture("mixed-tiers");
    await rpcHarness.reset({
      resolveUnary: (request) => resolveWsRpc(request._tag),
      getInitialStreamValues: (request) => {
        if (request._tag === WS_METHODS.subscribeServerLifecycle) {
          return [
            {
              version: 1,
              sequence: 1,
              type: "welcome",
              payload: fixture.welcome,
            },
          ];
        }
        if (request._tag === WS_METHODS.subscribeServerConfig) {
          return [
            {
              version: 1,
              type: "snapshot",
              config: encodeServerConfig(fixture.serverConfig),
            },
          ];
        }
        if (request._tag === ORCHESTRATION_WS_METHODS.subscribeShell) {
          return [
            {
              kind: "snapshot",
              snapshot: toSidebarV2ShellSnapshot(
                fixture.snapshot,
                fixture.scenario.shellFlagsByThreadId,
              ),
            },
          ];
        }
        if (request._tag === ORCHESTRATION_WS_METHODS.subscribeThread) {
          const thread = fixture.snapshot.threads.find((entry) => entry.id === request.threadId);
          return thread
            ? [
                {
                  kind: "snapshot",
                  snapshot: {
                    snapshotSequence: fixture.snapshot.snapshotSequence,
                    thread,
                  },
                },
              ]
            : [];
        }
        return [];
      },
    });
    await __resetLocalApiForTests();
    localStorage.clear();
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
    });
    useUiStateStore.setState((state) => ({
      ...state,
      threadLastVisitedAtById: {},
      threadPinnedById: {},
      threadSleptById: {},
    }));
  });

  afterEach(() => {
    // Intentionally empty — each test unmounts via mountApp().cleanup().
  });

  it("exports every planned scenario id", () => {
    expect(listSidebarV2Scenarios().map((scenario) => scenario.id)).toEqual([
      ...SIDEBAR_V2_SCENARIO_IDS,
    ]);
  });

  it("mixed-tiers shows Active / Idle sections with sub-state chips", async () => {
    const mounted = await mountApp("mixed-tiers");
    try {
      expect(listSection("Active")).toBeTruthy();
      expect(listSection("Idle")).toBeTruthy();
      expect(
        document.querySelector('[data-section="active"][data-sub-state="waiting"]'),
      ).toBeTruthy();
      expect(
        document.querySelector('[data-section="active"][data-sub-state="working"]'),
      ).toBeTruthy();
      expect(
        document.querySelector('[data-section="active"][data-sub-state="blocked"]'),
      ).toBeTruthy();
      expect(
        document.querySelector('[data-section="active"][data-sub-state="settled"]'),
      ).toBeTruthy();
      expect(document.querySelector('[data-section="idle"]')).toBeTruthy();
      expect(document.querySelector('[data-testid^="thread-chip-"]')).toBeTruthy();
      expect(document.body.textContent?.toLowerCase() ?? "").not.toContain("show more");
    } finally {
      await mounted.cleanup();
    }
  });

  it("waiting-only lists approval, input, and plan-ready rows under Active", async () => {
    const mounted = await mountApp("waiting-only");
    try {
      expect(listSection("Active")).toBeTruthy();
      expect(listSection("Idle")).toBeNull();
      expect(
        document.querySelectorAll('[data-section="active"][data-sub-state="waiting"]').length,
      ).toBeGreaterThanOrEqual(3);
      expect(document.body.textContent ?? "").toMatch(
        /Pending Approval|Awaiting Input|Plan Ready|Approve|Asked|Plan ready/i,
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("working-timer shows an elapsed clock on the working row", async () => {
    const mounted = await mountApp("working-timer");
    try {
      const elapsed = document.querySelector(".sb-elapsed");
      expect(elapsed).toBeTruthy();
      expect((elapsed?.textContent ?? "").length).toBeGreaterThan(0);
    } finally {
      await mounted.cleanup();
    }
  });

  it("dwell-settled keeps recent settled Active and past-dwell Idle", async () => {
    const mounted = await mountApp("dwell-settled");
    try {
      expect(listSection("Active")).toBeTruthy();
      expect(listSection("Idle")).toBeTruthy();
      expect(
        document.querySelector(
          '[data-testid="thread-row-thread-settled-dwell"][data-section="active"]',
        ),
      ).toBeTruthy();
      expect(
        document.querySelector('[data-testid="thread-row-thread-idle"][data-section="idle"]'),
      ).toBeTruthy();
    } finally {
      await mounted.cleanup();
    }
  });

  it("idle-expand expands a slim idle row in place", async () => {
    const mounted = await mountApp("idle-expand");
    try {
      const slim = document.querySelector<HTMLElement>(
        '[data-section="idle"][data-density="slim"]',
      );
      expect(slim).toBeTruthy();
      slim!.click();
      await vi.waitFor(() => {
        expect(document.querySelector('[data-section="idle"][data-density="slim"]')).toBeNull();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("pin keeps a past-dwell thread in Active", async () => {
    const mounted = await mountApp("dwell-settled");
    try {
      const idleKey = `${SIDEBAR_V2_LOCAL_ENV_ID}:thread-idle`;
      useUiStateStore.getState().setThreadPinned(idleKey, true);
      await vi.waitFor(() => {
        expect(
          document.querySelector('[data-testid="thread-row-thread-idle"][data-section="active"]'),
        ).toBeTruthy();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("sleep moves a within-dwell settled thread to Idle", async () => {
    const mounted = await mountApp("dwell-settled");
    try {
      const settledKey = `${SIDEBAR_V2_LOCAL_ENV_ID}:thread-settled-dwell`;
      useUiStateStore.getState().setThreadSlept(settledKey, true);
      await vi.waitFor(() => {
        expect(
          document.querySelector(
            '[data-testid="thread-row-thread-settled-dwell"][data-section="idle"]',
          ),
        ).toBeTruthy();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("picker-scope shows a waiting-elsewhere hint when another project waits", async () => {
    const mounted = await mountApp("picker-scope");
    try {
      const trigger = document.querySelector<HTMLElement>(
        '[data-testid="sidebar-project-picker-trigger"]',
      );
      expect(trigger).toBeTruthy();
      trigger!.click();
      const option = await waitForElement(
        () =>
          Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid^="sidebar-project-picker-item-"]'),
          ).find((node) => (node.textContent ?? "").includes("kata-code")) ?? null,
        "Project picker should list kata-code",
      );
      option.click();
      await waitForElement(
        () => document.querySelector<HTMLElement>('[data-testid="sidebar-waiting-scope-hint"]'),
        "Scoped waiting hint should appear",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("scroll-30 keeps every seeded thread row in the list", async () => {
    const mounted = await mountApp("scroll-30");
    try {
      expect(document.querySelectorAll("[data-thread-item]").length).toBeGreaterThanOrEqual(30);
    } finally {
      await mounted.cleanup();
    }
  });
});
