import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { scopeProjectRef } from "@kata-sh/code-client-runtime";
import type { EnvironmentId } from "@kata-sh/code-contracts";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../../environments/runtime";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useSettings } from "~/hooks/useSettings";
import type { DraftThreadEnvMode } from "../../composerDraftStore";
import { useSidebar } from "../ui/sidebar";
import { projectColorClass, projectInitials, resolveThreadTier } from "../Sidebar.logic";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { SidebarThreadSummary } from "../../types";

type EnvKind = "local" | "sandbox" | "remote";

function resolveEnvKind(input: {
  environmentId: EnvironmentId;
  primaryEnvironmentId: EnvironmentId | null;
  sandbox: { providerKind: string } | undefined;
}): EnvKind {
  if (input.sandbox) return "sandbox";
  if (input.primaryEnvironmentId !== null && input.environmentId === input.primaryEnvironmentId) {
    return "local";
  }
  return "remote";
}

function envKindGlyph(kind: EnvKind): string {
  if (kind === "sandbox") return "▣";
  if (kind === "remote") return "☁";
  return "⌂";
}

function envKindLabel(kind: EnvKind): string {
  if (kind === "sandbox") return "Sandbox";
  if (kind === "remote") return "Remote";
  return "Local";
}

export interface SidebarNewSessionPanelProps {
  open: boolean;
  projects: readonly SidebarProjectSnapshot[];
  threads: readonly SidebarThreadSummary[];
  preselectedProjectKey: string | null;
  openAddProject: () => void;
  handleNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
  onClose: () => void;
}

export const SidebarNewSessionPanel = memo(function SidebarNewSessionPanel(
  props: SidebarNewSessionPanelProps,
) {
  const {
    open,
    projects,
    threads,
    preselectedProjectKey,
    openAddProject,
    handleNewThread,
    onClose,
  } = props;
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const defaultThreadEnvMode = useSettings<DraftThreadEnvMode>(
    (settings) => settings.defaultThreadEnvMode,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const registryById = useSavedEnvironmentRegistryStore((state) => state.byId);
  const runtimeById = useSavedEnvironmentRuntimeStore((state) => state.byId);

  const [openProjectKey, setOpenProjectKey] = useState<string | null>(preselectedProjectKey);

  useEffect(() => {
    if (open) {
      setOpenProjectKey(preselectedProjectKey);
    }
  }, [open, preselectedProjectKey]);

  const waitingCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) {
      const memberKeys = new Set(
        project.memberProjects.map((member) => `${member.environmentId}:${member.id}`),
      );
      let waiting = 0;
      for (const thread of threads) {
        if (thread.archivedAt !== null) continue;
        if (!memberKeys.has(`${thread.environmentId}:${thread.projectId}`)) continue;
        if (resolveThreadTier({ thread }) === "waiting") {
          waiting += 1;
        }
      }
      counts.set(project.projectKey, waiting);
    }
    return counts;
  }, [projects, threads]);

  const startInMember = useCallback(
    async (environmentId: EnvironmentId, projectId: SidebarProjectSnapshot["id"]) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      onClose();
      await handleNewThread(scopeProjectRef(environmentId, projectId), {
        envMode: defaultThreadEnvMode,
      });
    },
    [defaultThreadEnvMode, handleNewThread, isMobile, onClose, setOpenMobile],
  );

  const handleProjectHeadClick = useCallback(
    (project: SidebarProjectSnapshot) => {
      if (project.memberProjects.length === 1) {
        const member = project.memberProjects[0]!;
        void startInMember(member.environmentId, member.id);
        return;
      }
      setOpenProjectKey((current) => (current === project.projectKey ? null : project.projectKey));
    },
    [startInMember],
  );

  const handleNewProject = useCallback(() => {
    onClose();
    openAddProject();
  }, [onClose, openAddProject]);

  const handleConnectEnvironment = useCallback(() => {
    onClose();
    void router.navigate({ to: "/settings/connections" });
  }, [onClose, router]);

  if (!open) return null;

  return (
    <div
      className="sb-sheet"
      data-testid="sidebar-new-session-panel"
      role="dialog"
      aria-label="New session"
    >
      <div className="sb-sheet-head">
        <div className="sb-sheet-title">New session</div>
        <div className="sb-sheet-sub">click env to start</div>
        <button
          type="button"
          className="sb-sheet-close"
          aria-label="Close"
          data-testid="sidebar-new-session-close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="sb-sheet-body">
        <p className="sb-sheet-hint">
          Single-env: tap the row to start. Multi-env: expand, then tap an environment.
        </p>

        {projects.length === 0 ? (
          <div className="sb-empty">No projects yet</div>
        ) : (
          projects.map((project) => {
            const members = project.memberProjects;
            const single = members.length === 1;
            const isOpen = openProjectKey === project.projectKey;
            const waitingN = waitingCountByProject.get(project.projectKey) ?? 0;
            const pathLabel = project.cwd ?? project.displayName;

            return (
              <div
                key={project.projectKey}
                className={`sb-acc${isOpen ? " open" : ""}${single ? " single" : ""}`}
                data-testid={`sidebar-new-session-project-${project.projectKey}`}
              >
                <button
                  type="button"
                  className="sb-acc-head"
                  data-testid={`sidebar-new-session-project-head-${project.projectKey}`}
                  onClick={() => {
                    handleProjectHeadClick(project);
                  }}
                >
                  <div className={`sb-proj-avatar ${projectColorClass(project.projectKey)}`}>
                    {projectInitials(project.displayName)}
                  </div>
                  <div className="sb-acc-main">
                    <div className="sb-acc-name">
                      {project.displayName}
                      {waitingN > 0 ? (
                        <span style={{ color: "var(--sb-amber)", fontSize: 10, fontWeight: 700 }}>
                          {waitingN} waiting
                        </span>
                      ) : null}
                    </div>
                    <div className="sb-acc-path">
                      {pathLabel} · {members.length} env{members.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="sb-acc-meta">
                    {single ? (
                      <span className="sb-acc-start">Start</span>
                    ) : (
                      <>
                        {members.slice(0, 3).map((member) => {
                          const sandbox = registryById[member.environmentId]?.sandbox;
                          const kind = resolveEnvKind({
                            environmentId: member.environmentId,
                            primaryEnvironmentId,
                            sandbox,
                          });
                          return (
                            <span
                              key={`${member.environmentId}:${member.id}`}
                              className={`sb-env-badge ${kind}`}
                              style={{ padding: "0 4px" }}
                            >
                              <span className="sb-glyph">{envKindGlyph(kind)}</span>
                            </span>
                          );
                        })}
                        <span className="sb-acc-chev">›</span>
                      </>
                    )}
                  </div>
                </button>

                {!single ? (
                  <div className="sb-acc-body">
                    {members.map((member) => {
                      const sandbox = registryById[member.environmentId]?.sandbox;
                      const kind = resolveEnvKind({
                        environmentId: member.environmentId,
                        primaryEnvironmentId,
                        sandbox,
                      });
                      const connectionState =
                        runtimeById[member.environmentId]?.connectionState ?? "connected";
                      const offline =
                        member.environmentId !== primaryEnvironmentId &&
                        connectionState !== "connected" &&
                        connectionState !== "connecting";
                      const statusLabel =
                        connectionState === "connected"
                          ? "ready"
                          : connectionState === "connecting"
                            ? "connecting"
                            : connectionState === "error"
                              ? "error"
                              : "offline";
                      const label =
                        member.environmentLabel ??
                        registryById[member.environmentId]?.label ??
                        runtimeById[member.environmentId]?.descriptor?.label ??
                        envKindLabel(kind);
                      return (
                        <button
                          key={`${member.environmentId}:${member.id}`}
                          type="button"
                          className={`sb-acc-env${offline ? " offline" : ""}`}
                          data-testid={`sidebar-new-session-env-${member.environmentId}-${member.id}`}
                          disabled={offline}
                          onClick={() => {
                            if (offline) return;
                            void startInMember(member.environmentId, member.id);
                          }}
                        >
                          <div className={`sb-env-icon ${kind}`}>{envKindGlyph(kind)}</div>
                          <div className="sb-acc-env-main">
                            <div className="sb-acc-env-name">
                              {label}
                              <span className={`sb-env-status ${statusLabel}`}>{statusLabel}</span>
                            </div>
                            <div className="sb-acc-env-desc">{member.cwd}</div>
                          </div>
                          <span className="sb-acc-env-go">Start →</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="sb-acc-connect"
                      data-testid={`sidebar-new-session-connect-${project.projectKey}`}
                      onClick={handleConnectEnvironment}
                    >
                      + Connect environment
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        <div className="sb-new-proj">
          <button
            type="button"
            className="sb-new-proj-toggle"
            data-testid="sidebar-new-session-new-project"
            onClick={handleNewProject}
          >
            + New project
          </button>
        </div>
      </div>
    </div>
  );
});
