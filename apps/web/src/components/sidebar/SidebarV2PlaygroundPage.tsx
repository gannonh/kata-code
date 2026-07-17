import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";

import type { ExecutionEnvironmentDescriptor } from "@kata-sh/code-contracts";
import { scopedThreadKey, scopeThreadRef } from "@kata-sh/code-client-runtime";

import { CommandPalette } from "../CommandPalette";
import ThreadSidebar from "../Sidebar";
import { AnchoredToastProvider, ToastProvider } from "../ui/toast";
import { Sidebar, SidebarProvider, SidebarRail } from "../ui/sidebar";
import { writePrimaryEnvironmentDescriptor } from "../../environments/primary";
import { useStore } from "../../store";
import { useUiStateStore } from "../../uiStateStore";
import {
  buildSidebarV2Scenario,
  listSidebarV2Scenarios,
  SIDEBAR_V2_FIXTURE_NOW_MS,
  SIDEBAR_V2_LOCAL_ENV_ID,
  SIDEBAR_V2_SCENARIO_IDS,
  type SidebarV2Scenario,
  type SidebarV2ScenarioId,
  toSidebarV2ShellSnapshot,
} from "./fixtures/sidebarV2Scenarios";

const PLAYGROUND_SIDEBAR_WIDTH = 18 * 16;

const PLAYGROUND_ENV_DESCRIPTOR: ExecutionEnvironmentDescriptor = {
  environmentId: SIDEBAR_V2_LOCAL_ENV_ID,
  label: "Local environment",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.0-playground",
  capabilities: { repositoryIdentity: true },
};

function shiftIso(value: string, deltaMs: number): string {
  return new Date(Date.parse(value) + deltaMs).toISOString();
}

/** Rebase fixture clock onto wall clock so wait/elapsed labels look realistic in UAT. */
function rebaseScenarioToWallClock(
  scenario: SidebarV2Scenario,
  nowMs = Date.now(),
): SidebarV2Scenario {
  const deltaMs = nowMs - SIDEBAR_V2_FIXTURE_NOW_MS;
  const snapshot = {
    ...scenario.snapshot,
    updatedAt: shiftIso(scenario.snapshot.updatedAt, deltaMs),
    projects: scenario.snapshot.projects.map((project) => ({
      ...project,
      createdAt: shiftIso(project.createdAt, deltaMs),
      updatedAt: shiftIso(project.updatedAt, deltaMs),
    })),
    threads: scenario.snapshot.threads.map((thread) => ({
      ...thread,
      createdAt: shiftIso(thread.createdAt, deltaMs),
      updatedAt: shiftIso(thread.updatedAt, deltaMs),
      archivedAt: thread.archivedAt ? shiftIso(thread.archivedAt, deltaMs) : null,
      latestTurn: thread.latestTurn
        ? {
            ...thread.latestTurn,
            requestedAt: shiftIso(thread.latestTurn.requestedAt, deltaMs),
            startedAt: thread.latestTurn.startedAt
              ? shiftIso(thread.latestTurn.startedAt, deltaMs)
              : null,
            completedAt: thread.latestTurn.completedAt
              ? shiftIso(thread.latestTurn.completedAt, deltaMs)
              : null,
          }
        : null,
      session: thread.session
        ? {
            ...thread.session,
            updatedAt: shiftIso(thread.session.updatedAt, deltaMs),
          }
        : thread.session,
      messages: thread.messages.map((message) => ({
        ...message,
        createdAt: shiftIso(message.createdAt, deltaMs),
      })),
    })),
  };

  const lastVisitedAtByThreadId = scenario.lastVisitedAtByThreadId
    ? Object.fromEntries(
        Object.entries(scenario.lastVisitedAtByThreadId).map(([key, value]) => [
          key,
          shiftIso(value, deltaMs),
        ]),
      )
    : undefined;

  return {
    ...scenario,
    snapshot,
    ...(lastVisitedAtByThreadId ? { lastVisitedAtByThreadId } : {}),
  };
}

function applyScenario(scenarioId: SidebarV2ScenarioId): void {
  const scenario = rebaseScenarioToWallClock(buildSidebarV2Scenario(scenarioId));
  writePrimaryEnvironmentDescriptor(PLAYGROUND_ENV_DESCRIPTOR);
  useStore.getState().setActiveEnvironmentId(SIDEBAR_V2_LOCAL_ENV_ID);
  useStore
    .getState()
    .syncServerShellSnapshot(
      toSidebarV2ShellSnapshot(scenario.snapshot, scenario.shellFlagsByThreadId),
      SIDEBAR_V2_LOCAL_ENV_ID,
    );

  useUiStateStore.setState((state) => ({
    ...state,
    threadLastVisitedAtById: {
      ...Object.fromEntries(
        scenario.snapshot.threads.map((thread) => [
          scopedThreadKey(scopeThreadRef(SIDEBAR_V2_LOCAL_ENV_ID, thread.id)),
          thread.updatedAt,
        ]),
      ),
      ...scenario.lastVisitedAtByThreadId,
    },
  }));
}

function ScenarioSwitcher(props: {
  activeId: SidebarV2ScenarioId;
  onSelect: (id: SidebarV2ScenarioId) => void;
}) {
  return (
    <div
      className="pointer-events-auto fixed top-3 right-3 z-50 flex max-w-md flex-wrap gap-1.5 rounded-lg border border-border bg-card/95 p-2 shadow-lg backdrop-blur"
      data-testid="sidebar-v2-scenario-switcher"
    >
      <div className="w-full px-1 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Sidebar v2 fixtures
      </div>
      {listSidebarV2Scenarios().map((scenario) => {
        const active = scenario.id === props.activeId;
        return (
          <button
            key={scenario.id}
            type="button"
            data-scenario-id={scenario.id}
            data-active={active ? "true" : "false"}
            className={
              active
                ? "rounded-md border border-foreground/30 bg-foreground/10 px-2 py-1 text-xs text-foreground"
                : "rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            }
            onClick={() => props.onSelect(scenario.id)}
          >
            {scenario.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Dev-only UAT surface: real Sidebar chrome seeded from `sidebarV2Scenarios`.
 * Open via `/playground/sidebar` while `pnpm run dev` is running.
 */
export function SidebarV2PlaygroundPage() {
  const [scenarioId, setScenarioId] = useState<SidebarV2ScenarioId>("mixed-tiers");

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.title = "Sidebar v2 playground";
    applyScenario(scenarioId);
    return () => {
      // Leave dark class; theme hook will re-sync on next normal navigation.
    };
  }, [scenarioId]);

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <CommandPalette>
          <div className="relative h-dvh bg-background text-foreground">
            <ScenarioSwitcher activeId={scenarioId} onSelect={setScenarioId} />
            <SidebarProvider className="h-dvh! min-h-0!" defaultOpen>
              <Sidebar
                side="left"
                collapsible="offcanvas"
                className="border-r border-border bg-card text-foreground"
                style={
                  {
                    "--sidebar-width": `${PLAYGROUND_SIDEBAR_WIDTH}px`,
                  } as CSSProperties
                }
              >
                <ThreadSidebar />
                <SidebarRail />
              </Sidebar>
              <main className="flex min-w-0 flex-1 flex-col items-start justify-center gap-2 p-8 text-muted-foreground">
                <Link
                  to="/playground"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  ← Playground
                </Link>
                <p className="text-sm font-medium text-foreground">Sidebar v2 fixture playground</p>
                <p className="max-w-md text-sm">
                  Scenario <code className="text-foreground">{scenarioId}</code> — use the switcher
                  (top-right). Compare to{" "}
                  <code className="text-foreground">c-attention-session.html</code>.
                </p>
                <p className="text-xs">Ids: {SIDEBAR_V2_SCENARIO_IDS.join(", ")}</p>
              </main>
            </SidebarProvider>
          </div>
        </CommandPalette>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
