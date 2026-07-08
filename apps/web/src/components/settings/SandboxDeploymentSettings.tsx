"use client";

import { useAuth } from "@clerk/react";
import { ChevronDownIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  EnvironmentId,
  SandboxProviderDriverKind,
  type ProviderInstanceEnvironmentVariable,
  type SavedSandboxEnvironmentMap,
  type SandboxInstanceSummary,
  type SandboxProviderInstanceConfig,
  type SandboxProviderInstanceConfigMap,
  type SandboxTestConnectionProgressEvent,
} from "@kata-sh/code-contracts";
import { useShallow } from "zustand/react/shallow";

import { refreshManagedRelayEnvironments } from "../../cloud/managedRelayState";
import { resolveRelayClerkTokenOptions, hasCloudPublicConfig } from "../../cloud/publicConfig";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import {
  addSavedEnvironment,
  getPrimaryEnvironmentConnection,
  removeSavedEnvironment,
} from "../../environments/runtime";
import { cn } from "../../lib/utils";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import type { Project } from "../../types";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { DraftInput } from "../ui/draft-input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useHostedConnectAuthPrompt } from "../clerk/useHostedConnectAuthPrompt";
import { ProviderEnvironmentSection } from "./ProviderInstanceCard";
import { ProviderSignInDialog } from "./ProviderSignInDialog";
import { SavedEnvironmentEditor } from "./SavedEnvironmentEditor";
import { shouldSeedRepositoryForStart } from "./SandboxDeploymentSettings.logic";
import { SettingsSection } from "./settingsLayout";

const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");

/** Per-instance busy state for the long-running RPCs. */
type BusyOp = "test" | "start" | "dispose" | "renew" | "stop";

/** Render a non-empty failure message for the progress log and toasts.
 * Effect fiber failures can surface as objects whose `message` is empty. */
function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  const rendered = String(error ?? "").trim();
  return rendered.length > 0 && rendered !== "[object Object]" ? rendered : "Unknown error.";
}

/**
 * Settings panel for environment definitions. Lists configured targets with
 * their materialized status, and provides Test connection (streaming) / Start
 * session / Dispose / Delete for sandbox-backed environments. Writes go
 * through `useUpdateSettings` against the `sandboxProviderInstances` settings
 * map (no plaintext secrets in settings);
 * the live RPCs (list/test/start/dispose) go through the paired WS client.
 */
interface SandboxDeploymentSettingsProps {
  readonly headerAction?: ReactNode;
  readonly savedEnvironmentRows?: ReactNode;
  readonly hasSavedEnvironmentRows?: boolean;
}

export function SandboxDeploymentSettings({
  headerAction,
  savedEnvironmentRows,
  hasSavedEnvironmentRows = false,
}: SandboxDeploymentSettingsProps) {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const { getToken, isSignedIn } = useAuth();
  const { authPrompt, openAuthPrompt } = useHostedConnectAuthPrompt();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const instanceMap = (settings.sandboxProviderInstances ?? {}) as SandboxProviderInstanceConfigMap;
  const savedSandboxEnvironments = settings.savedSandboxEnvironments as
    | SavedSandboxEnvironmentMap
    | undefined;

  const [summaries, setSummaries] = useState<ReadonlyArray<SandboxInstanceSummary>>([]);
  const [testProgress, setTestProgress] = useState<Record<string, string[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedRepositoryKeyByInstance, setSelectedRepositoryKeyByInstance] = useState<
    Record<string, string>
  >({});
  const [activeSession, setActiveSession] = useState<
    Record<string, { environmentId: string; httpBaseUrl: string }>
  >({});
  const [busy, setBusy] = useState<Record<string, BusyOp>>({});

  /** Mark an instance busy for `op` while `fn` runs, then clear it. Centralizes
   * the `finally { setBusy ... delete }` cleanup that every long-running
   * handler otherwise duplicates. */
  const withBusy = useCallback(
    async <T,>(instanceId: string, op: BusyOp, fn: () => Promise<T>): Promise<T> => {
      setBusy((prev) => ({ ...prev, [instanceId]: op }));
      try {
        return await fn();
      } finally {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[instanceId];
          return next;
        });
      }
    },
    [],
  );

  const refreshList = useCallback(async () => {
    try {
      const result = await getPrimaryEnvironmentConnection().client.sandbox.listInstances();
      setSummaries(result.instances);
      setActiveSession(
        Object.fromEntries(
          result.instances.flatMap((summary) => {
            if (summary.kind !== "available" || !summary.runningSession) return [];
            return [
              [
                summary.instanceId as string,
                {
                  environmentId: summary.runningSession.environmentId,
                  httpBaseUrl: summary.runningSession.endpoint.httpBaseUrl,
                },
              ],
            ];
          }),
        ),
      );
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to list sandbox targets",
        description: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList, settings.sandboxProviderInstances]);

  const summaryById = useMemo(() => {
    const map: Record<string, SandboxInstanceSummary> = {};
    for (const summary of summaries) {
      map[summary.instanceId as string] = summary;
    }
    return map;
  }, [summaries]);

  const repositoryProjects = useMemo(
    () => projects.filter((project) => Boolean(project.repositoryIdentity?.canonicalKey)),
    [projects],
  );

  const resolveSelectedProject = useCallback(
    (instanceId: string): Project | undefined => {
      const selectedKey = selectedRepositoryKeyByInstance[instanceId];
      if (selectedKey) {
        const selectedProject = repositoryProjects.find(
          (project) => project.repositoryIdentity?.canonicalKey === selectedKey,
        );
        if (selectedProject) return selectedProject;
      }
      const instance = (instanceMap as Record<string, SandboxProviderInstanceConfig>)[instanceId];
      if (instance?.repositoryKey) {
        const persistedProject = repositoryProjects.find(
          (project) => project.repositoryIdentity?.canonicalKey === instance.repositoryKey,
        );
        if (persistedProject) return persistedProject;
      }
      return repositoryProjects[0];
    },
    [repositoryProjects, selectedRepositoryKeyByInstance, instanceMap],
  );

  const handleTest = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "test", async () => {
        setTestProgress((prev) => ({ ...prev, [instanceId]: [] }));
        try {
          let failedDetail: string | null = null;
          await getPrimaryEnvironmentConnection().client.sandbox.testConnection(
            instanceId as never,
            (event: SandboxTestConnectionProgressEvent) => {
              if (!event.ok) {
                failedDetail =
                  "detail" in event && event.detail ? event.detail : `${event.stage} failed.`;
              }
              setTestProgress((prev) => ({
                ...prev,
                [instanceId]: [
                  ...(prev[instanceId] ?? []),
                  `${event.stage}: ${event.ok ? "ok" : "failed"}${
                    "detail" in event && event.detail ? ` — ${event.detail}` : ""
                  }`,
                ],
              }));
            },
          );
          if (failedDetail) {
            throw new Error(failedDetail);
          }
          toastManager.add({
            type: "success",
            title: "Test connection complete",
            description: `Sandbox '${instanceId}' validated.`,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Test connection failed",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
        }
      }),
    [withBusy],
  );

  const handleStart = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "start", async () => {
        const instance = (instanceMap as Record<string, SandboxProviderInstanceConfig>)[instanceId];
        const shouldSeedRepository = shouldSeedRepositoryForStart(summaryById[instanceId]);
        const project = shouldSeedRepository ? resolveSelectedProject(instanceId) : undefined;
        const startedRepositoryKey = shouldSeedRepository
          ? (project?.repositoryIdentity?.canonicalKey as string | undefined)
          : undefined;
        if (hasCloudPublicConfig() && !isSignedIn) {
          openAuthPrompt();
          return;
        }
        try {
          const connectAuthToken = hasCloudPublicConfig()
            ? await getToken(resolveRelayClerkTokenOptions())
            : null;
          if (hasCloudPublicConfig() && !connectAuthToken) {
            throw new Error("Sign in to Kata Code Connect before starting a deployment session.");
          }
          const result = await getPrimaryEnvironmentConnection().client.sandbox.startSession({
            instanceId: instanceId as never,
            ...(connectAuthToken ? { connectAuthToken } : {}),
            ...(project?.repositoryIdentity
              ? {
                  repository: {
                    repoRoot: project.cwd,
                    repositoryIdentity: project.repositoryIdentity,
                  },
                }
              : {}),
          });
          setActiveSession((prev) => ({
            ...prev,
            [instanceId]: {
              environmentId: result.environmentId,
              httpBaseUrl: result.endpoint.httpBaseUrl,
            },
          }));
          setTestProgress((prev) => ({
            ...prev,
            [instanceId]: [...(prev[instanceId] ?? []), "start: ok"],
          }));

          let savedForProjectPicker = false;
          try {
            await addSavedEnvironment({
              label: result.endpoint.label,
              host: result.endpoint.httpBaseUrl,
              pairingCode: result.pairingToken,
              sandbox: { providerKind: (instance?.driver as string) ?? "local" },
            });
            savedForProjectPicker = true;
            setTestProgress((prev) => ({
              ...prev,
              [instanceId]: [...(prev[instanceId] ?? []), "connect: ok"],
            }));
          } catch (error) {
            const message = failureMessage(error);
            setTestProgress((prev) => ({
              ...prev,
              [instanceId]: [...(prev[instanceId] ?? []), `connect: failed — ${message}`],
            }));
            toastManager.add({
              type: "error",
              title: "Sandbox started but was not added",
              description: message,
            });
          }
          refreshManagedRelayEnvironments();
          await refreshList();

          if (startedRepositoryKey && instance) {
            updateInstance(instanceId, { ...instance, repositoryKey: startedRepositoryKey });
          }

          if (savedForProjectPicker) {
            toastManager.add({
              type: "success",
              title: "Sandbox session started",
              description: "Available from Add project.",
            });
          }
        } catch (error) {
          const message = failureMessage(error);
          setTestProgress((prev) => ({
            ...prev,
            [instanceId]: [...(prev[instanceId] ?? []), `start: failed — ${message}`],
          }));
          toastManager.add({
            type: "error",
            title: "Start session failed",
            description: message,
          });
        }
      }),
    [
      getToken,
      instanceMap,
      isSignedIn,
      openAuthPrompt,
      refreshList,
      resolveSelectedProject,
      selectedRepositoryKeyByInstance,
      summaryById,
      withBusy,
    ],
  );

  const handleDispose = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "dispose", async () => {
        try {
          const session = activeSession[instanceId];
          await getPrimaryEnvironmentConnection().client.sandbox.disposeSession({
            instanceId: instanceId as never,
          });
          if (session) {
            await removeSavedEnvironment(EnvironmentId.make(session.environmentId)).catch(
              (error) => {
                toastManager.add({
                  type: "error",
                  title: "Sandbox removed but saved environment remains",
                  description: error instanceof Error ? error.message : "Unknown error.",
                });
              },
            );
          }
          refreshManagedRelayEnvironments();
          await refreshList();
          setActiveSession((prev) => {
            const next = { ...prev };
            delete next[instanceId];
            return next;
          });
          toastManager.add({
            type: "success",
            title: "Sandbox disposed",
            description: `Sandbox '${instanceId}' released.`,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Dispose failed",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
        }
      }),
    [activeSession, refreshList, withBusy],
  );

  const handleStop = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "stop", async () => {
        try {
          await getPrimaryEnvironmentConnection().client.sandbox.stopSession({
            instanceId: instanceId as never,
          });
          refreshManagedRelayEnvironments();
          await refreshList();
          toastManager.add({
            type: "success",
            title: "Sandbox stopped",
            description: `Sandbox '${instanceId}' stopped. Start it again to resume.`,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Stop failed",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
        }
      }),
    [refreshList, withBusy],
  );

  const handleRenew = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "renew", async () => {
        try {
          await getPrimaryEnvironmentConnection().client.sandbox.renewSession({
            instanceId: instanceId as never,
          });
          await refreshList();
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Extend failed",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
        }
      }),
    [refreshList, withBusy],
  );

  const handleRemove = useCallback(
    (instanceId: string) => {
      if (activeSession[instanceId]) {
        toastManager.add({
          type: "error",
          title: "Cannot remove sandbox environment",
          description: `Dispose the active session for '${instanceId}' before removing it.`,
        });
        return;
      }
      const nextMap = { ...instanceMap };
      delete nextMap[instanceId as keyof typeof nextMap];
      updateSettings({ sandboxProviderInstances: nextMap });
      toastManager.add({
        type: "success",
        title: "Sandbox environment removed",
        description: `'${instanceId}' removed from Environments.`,
      });
    },
    [activeSession, instanceMap, updateSettings],
  );

  const updateInstance = useCallback(
    (instanceId: string, next: SandboxProviderInstanceConfig) => {
      updateSettings({
        sandboxProviderInstances: { ...instanceMap, [instanceId]: next },
      });
    },
    [instanceMap, updateSettings],
  );

  const instanceEntries = Object.entries(instanceMap);

  return (
    <>
      <SettingsSection title="Environments" headerAction={headerAction}>
        {hasSavedEnvironmentRows ? savedEnvironmentRows : null}
        {instanceEntries.length === 0 && !hasSavedEnvironmentRows ? (
          <div className="border-t border-border/60 px-4 py-3.5 first:border-t-0 sm:px-5">
            <p className="text-xs text-muted-foreground">
              No environments configured. Add one to define a remote link, SSH host, Docker
              container, or cloud provider.
            </p>
          </div>
        ) : (
          instanceEntries.map(([id, config]) => {
            const summary = summaryById[id];
            const available = summary?.kind === "available";
            const reason = summary?.kind === "unavailable" ? summary.reason : undefined;
            const session = activeSession[id];
            const progress = testProgress[id] ?? [];
            const instanceBusy = busy[id];
            const isOpen = expanded[id] ?? false;
            const displayName = config.displayName ?? id;
            const selectedProject = resolveSelectedProject(id);
            const selectedRepositoryKey =
              selectedRepositoryKeyByInstance[id] ??
              (config.repositoryKey as string | undefined) ??
              (selectedProject?.repositoryIdentity?.canonicalKey as string | undefined);
            return (
              <DeploymentTargetCard
                key={id}
                instanceId={id}
                instance={config}
                displayName={displayName}
                available={available}
                reason={reason}
                session={session}
                summary={summary}
                progress={progress}
                instanceBusy={instanceBusy}
                isExpanded={isOpen}
                projects={projects}
                savedSandboxEnvironments={savedSandboxEnvironments}
                selectedRepositoryKey={selectedRepositoryKey}
                onExpandedChange={(open) => setExpanded((prev) => ({ ...prev, [id]: open }))}
                onUpdate={(next) => updateInstance(id, next)}
                onSavedEnvironmentChange={(next) =>
                  updateSettings({ savedSandboxEnvironments: next })
                }
                onSelectedRepositoryKeyChange={(repositoryKey) => {
                  setSelectedRepositoryKeyByInstance((prev) => ({ ...prev, [id]: repositoryKey }));
                  updateInstance(id, { ...config, repositoryKey });
                }}
                onDelete={() => handleRemove(id)}
                onTest={() => void handleTest(id)}
                onStart={() => void handleStart(id)}
                onStop={() => void handleStop(id)}
                onDispose={() => void handleDispose(id)}
                onRenew={() => void handleRenew(id)}
              />
            );
          })
        )}
      </SettingsSection>
      {authPrompt}
    </>
  );
}

interface DeploymentTargetCardProps {
  readonly instanceId: string;
  readonly instance: SandboxProviderInstanceConfig;
  readonly displayName: string;
  readonly available: boolean;
  readonly reason: string | undefined;
  readonly session: { environmentId: string; httpBaseUrl: string } | undefined;
  readonly summary: SandboxInstanceSummary | undefined;
  readonly progress: string[];
  readonly instanceBusy: BusyOp | undefined;
  readonly isExpanded: boolean;
  readonly projects: ReadonlyArray<Project>;
  readonly savedSandboxEnvironments: SavedSandboxEnvironmentMap | undefined;
  readonly selectedRepositoryKey: string | undefined;
  readonly onExpandedChange: (open: boolean) => void;
  readonly onUpdate: (next: SandboxProviderInstanceConfig) => void;
  readonly onSavedEnvironmentChange: (next: SavedSandboxEnvironmentMap) => void;
  readonly onSelectedRepositoryKeyChange: (repositoryKey: string) => void;
  readonly onDelete: () => void;
  readonly onTest: () => void;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onDispose: () => void;
  readonly onRenew: () => void;
}

/**
 * A single deployment-target row: title + driver/status badges + delete +
 * status badge + secondary Stop/Start button + chevron in the header, and a
 * `Collapsible` with display name, config fields, env vars, and state-driven
 * actions (Create & run sandbox / Stop / Start / Delete sandbox) + progress.
 */
export function DeploymentTargetCard({
  instanceId,
  instance,
  displayName,
  available,
  reason,
  session,
  summary,
  progress,
  instanceBusy,
  isExpanded,
  projects,
  savedSandboxEnvironments,
  selectedRepositoryKey,
  onExpandedChange,
  onUpdate,
  onSavedEnvironmentChange,
  onSelectedRepositoryKeyChange,
  onDelete,
  onTest,
  onStart,
  onStop,
  onDispose,
  onRenew,
}: DeploymentTargetCardProps) {
  const isVercel = (instance.driver as string) === (VERCEL_KIND as string);
  const runningSession = summary?.kind === "available" ? summary.runningSession : undefined;
  const supportsRenewTimeout =
    summary?.kind === "available" ? summary.supportsRenewTimeout : undefined;
  const sessionStatus = runningSession?.status;
  const deadlineEpochMs = runningSession?.deadlineEpochMs;
  const statusDetail = runningSession?.statusDetail;
  const [signInFor, setSignInFor] = useState<string | null>(null);
  const updateDisplayName = (value: string) => {
    const trimmed = value.trim();
    const { displayName: _omit, ...rest } = instance;
    onUpdate(
      trimmed.length > 0
        ? ({ ...rest, displayName: trimmed } as SandboxProviderInstanceConfig)
        : (rest as SandboxProviderInstanceConfig),
    );
  };

  const updateConfig = (nextConfig: Record<string, unknown> | undefined) => {
    const { config: _omit, ...rest } = instance;
    onUpdate(
      nextConfig !== undefined
        ? ({ ...rest, config: nextConfig } as SandboxProviderInstanceConfig)
        : (rest as SandboxProviderInstanceConfig),
    );
  };

  const updateEnvironment = (environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>) => {
    const cleaned = environment.filter((variable) => variable.name.trim().length > 0);
    const { environment: _omit, ...rest } = instance;
    onUpdate(
      cleaned.length > 0
        ? ({ ...rest, environment: cleaned } as SandboxProviderInstanceConfig)
        : (rest as SandboxProviderInstanceConfig),
    );
  };

  return (
    <div className="border-t border-border/60 first:border-t-0">
      <div className="px-4 py-3.5 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
                {displayName}
              </h3>
              <code className="truncate rounded bg-muted/60 px-1 py-0.5 text-[10px] text-muted-foreground">
                {instanceId}
              </code>
              <Badge variant="secondary">{instance.driver}</Badge>
              {available ? (
                <Badge variant="default">available</Badge>
              ) : reason ? (
                <Badge variant="destructive">{reason}</Badge>
              ) : null}
              {sessionStatus === "running" ? (
                <Badge variant="default" className="bg-green-600 text-green-50">
                  running
                </Badge>
              ) : sessionStatus === "stopped" ? (
                <Badge variant="secondary" className="bg-muted text-muted-foreground">
                  stopped
                </Badge>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="size-5 rounded-sm p-0 text-muted-foreground hover:text-destructive"
                      onClick={onDelete}
                      aria-label={`Delete sandbox environment ${instanceId}`}
                    >
                      <Trash2Icon className="size-3" />
                    </Button>
                  }
                />
                <TooltipPopup side="top">Delete sandbox environment</TooltipPopup>
              </Tooltip>
            </div>
            <p className="text-xs text-muted-foreground/80">
              {session
                ? `Session ready: ${session.httpBaseUrl} (env ${session.environmentId})`
                : isVercel
                  ? "Provisions an ephemeral Vercel Sandbox microVM, reached over a public URL."
                  : "Provision an isolated container reached over localhost."}
            </p>
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {sessionStatus === "running" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={instanceBusy !== undefined}
                onClick={onStop}
              >
                {instanceBusy === "stop" ? "Stopping…" : "Stop"}
              </Button>
            ) : sessionStatus === "stopped" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={instanceBusy !== undefined}
                onClick={onStart}
              >
                {instanceBusy === "start" ? "Starting…" : "Start"}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onExpandedChange(!isExpanded)}
              aria-label={`Toggle ${displayName} details`}
            >
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")}
              />
            </Button>
          </div>
        </div>
      </div>

      <Collapsible open={isExpanded} onOpenChange={onExpandedChange}>
        <CollapsibleContent>
          <div className="space-y-0">
            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              <label htmlFor={`sandbox-instance-${instanceId}-display-name`} className="block">
                <span className="text-xs font-medium text-foreground">Display name</span>
                <DraftInput
                  id={`sandbox-instance-${instanceId}-display-name`}
                  className="mt-1.5"
                  value={instance.displayName ?? ""}
                  onCommit={updateDisplayName}
                  placeholder="Instance label"
                  spellCheck={false}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Optional label shown in the deployment list.
                </span>
              </label>
            </div>

            {isVercel ? (
              <VercelConfigFields
                config={instance.config}
                idPrefix={`sandbox-instance-${instanceId}`}
                onChange={updateConfig}
              />
            ) : (
              <DockerConfigFields
                config={instance.config}
                idPrefix={`sandbox-instance-${instanceId}`}
                onChange={updateConfig}
              />
            )}

            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              <ProviderEnvironmentSection
                environment={instance.environment ?? []}
                onChange={updateEnvironment}
                title="Runtime environment variables"
                description={
                  isVercel
                    ? "Apply to every session on this target. Add VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID here as sensitive variables."
                    : "Apply to every session on this target (e.g. API keys the sandbox server needs at boot)."
                }
              />
            </div>

            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              <SavedEnvironmentEditor
                projects={projects}
                savedSandboxEnvironments={savedSandboxEnvironments}
                selectedRepositoryKey={selectedRepositoryKey}
                onSelectedRepositoryKeyChange={onSelectedRepositoryKeyChange}
                onChange={onSavedEnvironmentChange}
              />
            </div>

            <div className="space-y-3 border-t border-border/60 px-4 py-3 sm:px-5">
              {statusDetail ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-amber-600">{statusDetail}</span>
                </div>
              ) : null}
              {sessionStatus === "running" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {session ? (
                    <span className="text-xs text-muted-foreground">
                      {session.httpBaseUrl} (env {session.environmentId})
                    </span>
                  ) : null}
                  {deadlineEpochMs !== undefined ? (
                    <span className="text-xs text-muted-foreground">
                      Expires in {formatRemaining(deadlineEpochMs)}
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={instanceBusy !== undefined}
                    onClick={onStop}
                  >
                    {instanceBusy === "stop" ? "Stopping…" : "Stop"}
                  </Button>
                  {supportsRenewTimeout ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={instanceBusy !== undefined}
                      onClick={onRenew}
                    >
                      {instanceBusy === "renew" ? "Extending…" : "Extend"}
                    </Button>
                  ) : null}
                  {isVercel ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={instanceBusy !== undefined}
                      onClick={() => setSignInFor("claude")}
                    >
                      Sign in Claude
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {sessionStatus === undefined ? (
                  <>
                    <Button
                      size="sm"
                      disabled={instanceBusy !== undefined || !available}
                      onClick={onStart}
                    >
                      {instanceBusy === "start" ? "Starting…" : "Create & run sandbox"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={instanceBusy !== undefined || !available}
                      onClick={onTest}
                    >
                      {instanceBusy === "test" ? "Testing…" : "Test connection"}
                    </Button>
                  </>
                ) : sessionStatus === "stopped" ? (
                  <>
                    <Button size="sm" disabled={instanceBusy !== undefined} onClick={onStart}>
                      {instanceBusy === "start" ? "Starting…" : "Start"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={instanceBusy !== undefined}
                      onClick={onDispose}
                    >
                      {instanceBusy === "dispose" ? "Deleting…" : "Delete sandbox"}
                    </Button>
                  </>
                ) : null}
              </div>
              {progress.length > 0 || instanceBusy === "test" ? (
                <pre className="text-xs whitespace-pre-wrap text-muted-foreground">
                  {progress.join("\n")}
                </pre>
              ) : null}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {signInFor !== null ? (
        <ProviderSignInDialog
          instanceId={instanceId}
          providerId={signInFor}
          onClose={() => setSignInFor(null)}
        />
      ) : null}
    </div>
  );
}

interface DockerConfigFieldsProps {
  readonly config: unknown;
  readonly idPrefix: string;
  readonly onChange: (nextConfig: Record<string, unknown> | undefined) => void;
}

function readConfigString(config: unknown, key: string): string {
  if (config === null || typeof config !== "object") return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function readConfigNumber(config: unknown, key: string): string {
  if (config === null || typeof config !== "object") return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "number" ? String(value) : "";
}

function setConfigField(
  config: unknown,
  key: string,
  value: string,
  clearWhenEmpty: "omit" | "persist" = "omit",
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  const trimmed = value.trim();
  if (clearWhenEmpty === "omit" && trimmed.length === 0) {
    delete base[key];
  } else {
    base[key] = value;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

/** Format the remaining lifetime from an epoch-ms deadline. */
function formatRemaining(deadlineEpochMs: number): string {
  const remaining = deadlineEpochMs - Date.now();
  if (remaining <= 0) return "soon";
  const minutes = Math.floor(remaining / 60_000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  return `${minutes}m`;
}

/** Parse a container port string into a validated integer in 1..65535, or null. */
function parseContainerPort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : null;
}

/** Set a numeric container port field, rejecting non-integer/out-of-range values.
 * An empty input clears the field. */
function setContainerPort(
  config: unknown,
  key: string,
  value: string,
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  if (value.trim().length === 0) {
    delete base[key];
  } else {
    const parsed = parseContainerPort(value);
    if (parsed === null) return base;
    base[key] = parsed;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

/**
 * Inline editor for the docker driver config (image, command, port), mirroring
 * `ProviderSettingsForm`'s card variant layout. The web app cannot import the
 * server-only `@kata-sh/code-sandbox-docker` `DockerSandboxConfig` schema, so
 * this renders the known fields directly against the opaque `config` blob.
 */
function DockerConfigFields({ config, idPrefix, onChange }: DockerConfigFieldsProps) {
  const fields: ReadonlyArray<{
    key: string;
    label: string;
    description: string;
    placeholder: string;
    kind: "text" | "port";
  }> = [
    {
      key: "image",
      label: "Image",
      description: "Container image (must contain your start command's runtime).",
      placeholder: "katacode:local",
      kind: "text",
    },
    {
      key: "command",
      label: "Start command",
      description:
        "Command to launch the Kata server inside the container, e.g. `katacode serve --port 13773`.",
      placeholder: "katacode serve --port 13773",
      kind: "text",
    },
    {
      key: "port",
      label: "Container port",
      description: "In-container port the Kata server listens on.",
      placeholder: "13773",
      kind: "port",
    },
  ];
  return (
    <>
      {fields.map((field) => (
        <div key={field.key} className="border-t border-border/60 px-4 py-3 sm:px-5">
          <label htmlFor={`${idPrefix}-${field.key}`} className="block">
            <span className="text-xs font-medium text-foreground">{field.label}</span>
            <DraftInput
              id={`${idPrefix}-${field.key}`}
              className="mt-1.5"
              value={
                field.kind === "port"
                  ? readConfigNumber(config, field.key)
                  : readConfigString(config, field.key)
              }
              onCommit={(next) =>
                onChange(
                  field.kind === "port"
                    ? setContainerPort(config, field.key, next)
                    : setConfigField(config, field.key, next),
                )
              }
              placeholder={field.placeholder}
              spellCheck={false}
              inputMode={field.kind === "port" ? "numeric" : undefined}
            />
            <span className="mt-1 block text-xs text-muted-foreground">{field.description}</span>
          </label>
        </div>
      ))}
    </>
  );
}

interface VercelConfigFieldsProps {
  readonly config: unknown;
  readonly idPrefix: string;
  readonly onChange: (nextConfig: Record<string, unknown> | undefined) => void;
}

/** Inline editor for the Vercel Sandbox driver config (runtime, persistent,
 *  timeout, port, vCPUs). Mirrors DockerConfigFields' layout. */
function VercelConfigFields({ config, idPrefix, onChange }: VercelConfigFieldsProps) {
  const persistent =
    config !== null &&
    typeof config === "object" &&
    (config as Record<string, unknown>).persistent !== false;
  const timeoutMs = readConfigNumber(config, "timeoutMs");
  const timeoutMinutes = timeoutMs ? String(Math.round(Number(timeoutMs) / 60_000)) : "";
  return (
    <>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <label htmlFor={`${idPrefix}-runtime`} className="block">
          <span className="text-xs font-medium text-foreground">Runtime</span>
          <DraftInput
            id={`${idPrefix}-runtime`}
            className="mt-1.5"
            value={readConfigString(config, "runtime")}
            onCommit={(next) => onChange(setConfigField(config, "runtime", next))}
            placeholder="node24"
            spellCheck={false}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Vercel Sandbox runtime (e.g. node24).
          </span>
        </label>
      </div>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <label htmlFor={`${idPrefix}-persistent`} className="block">
          <span className="text-xs font-medium text-foreground">Persistent filesystem</span>
          <div className="mt-1.5 flex items-center gap-2">
            <Switch
              id={`${idPrefix}-persistent`}
              checked={persistent}
              onCheckedChange={(checked) => {
                const base =
                  config !== null && typeof config === "object"
                    ? { ...(config as Record<string, unknown>) }
                    : {};
                base.persistent = Boolean(checked);
                onChange(base);
              }}
            />
            <span className="text-xs text-muted-foreground">
              Stop auto-saves the sandbox; start resumes it (bounded snapshot storage).
            </span>
          </div>
        </label>
      </div>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <label htmlFor={`${idPrefix}-timeoutMs`} className="block">
          <span className="text-xs font-medium text-foreground">Timeout (minutes)</span>
          <DraftInput
            id={`${idPrefix}-timeoutMs`}
            className="mt-1.5"
            value={timeoutMinutes}
            onCommit={(next) => {
              const trimmed = next.trim();
              if (trimmed.length === 0) {
                onChange(setConfigField(config, "timeoutMs", ""));
                return;
              }
              const minutes = Number(trimmed);
              if (!Number.isFinite(minutes)) return;
              const base =
                config !== null && typeof config === "object"
                  ? { ...(config as Record<string, unknown>) }
                  : {};
              base.timeoutMs = Math.round(minutes * 60_000);
              onChange(base);
            }}
            placeholder="1440"
            spellCheck={false}
            inputMode="numeric"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Sandbox auto-termination timeout. Hobby max is 45 minutes; Pro/Enterprise max is 24
            hours.
          </span>
        </label>
      </div>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <label htmlFor={`${idPrefix}-port`} className="block">
          <span className="text-xs font-medium text-foreground">Sandbox port</span>
          <DraftInput
            id={`${idPrefix}-port`}
            className="mt-1.5"
            value={readConfigNumber(config, "port")}
            onCommit={(next) => onChange(setContainerPort(config, "port", next))}
            placeholder="13773"
            spellCheck={false}
            inputMode="numeric"
          />
        </label>
      </div>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <label htmlFor={`${idPrefix}-vcpus`} className="block">
          <span className="text-xs font-medium text-foreground">vCPUs (optional)</span>
          <DraftInput
            id={`${idPrefix}-vcpus`}
            className="mt-1.5"
            value={readConfigNumber(config, "vcpus")}
            onCommit={(next) => {
              const trimmed = next.trim();
              if (trimmed.length === 0) {
                onChange(setConfigField(config, "vcpus", ""));
                return;
              }
              const n = Number(trimmed);
              if (!Number.isFinite(n)) return;
              const base =
                config !== null && typeof config === "object"
                  ? { ...(config as Record<string, unknown>) }
                  : {};
              base.vcpus = n;
              onChange(base);
            }}
            placeholder="1"
            spellCheck={false}
            inputMode="numeric"
          />
        </label>
      </div>
    </>
  );
}
