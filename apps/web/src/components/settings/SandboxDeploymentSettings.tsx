"use client";

import { useAuth } from "@clerk/react";
import { ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EnvironmentId,
  SandboxProviderDriverKind,
  SandboxProviderInstanceId,
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
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useHostedConnectAuthPrompt } from "../clerk/useHostedConnectAuthPrompt";
import { ProviderEnvironmentSection } from "./ProviderInstanceCard";
import { ProviderSignInDialog } from "./ProviderSignInDialog";
import { SavedEnvironmentEditor } from "./SavedEnvironmentEditor";
import { SettingsSection } from "./settingsLayout";

const DOCKER_KIND = SandboxProviderDriverKind.make("docker");
const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");

/** Slugify a label into a sandbox instance id suffix (mirrors provider dialog). */
function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

/** Per-instance busy state for the long-running RPCs. */
type BusyOp = "test" | "start" | "dispose";

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
 * Settings panel for sandbox environments (Phase 1: local Docker
 * containers). Lists configured targets with their materialized status, and
 * provides Add / Test connection (streaming) / Start session / Dispose /
 * Remove. Writes go through `useUpdateSettings` against the
 * `sandboxProviderInstances` settings map (no plaintext secrets in settings);
 * the live RPCs (list/test/start/dispose) go through the paired WS client.
 */
export function SandboxDeploymentSettings() {
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
  const [addOpen, setAddOpen] = useState(false);
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
      return repositoryProjects[0];
    },
    [repositoryProjects, selectedRepositoryKeyByInstance],
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
        const explicitRepositoryKey = selectedRepositoryKeyByInstance[instanceId];
        const project = explicitRepositoryKey ? resolveSelectedProject(instanceId) : undefined;
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

  const resolveConnectAuthToken = useCallback(async (): Promise<string | null> => {
    if (hasCloudPublicConfig() && !isSignedIn) {
      openAuthPrompt();
      return null;
    }
    if (!hasCloudPublicConfig()) return null;
    const token = await getToken(resolveRelayClerkTokenOptions());
    if (!token) {
      throw new Error("Sign in to Kata Code Connect before resuming a deployment session.");
    }
    return token;
  }, [getToken, isSignedIn, openAuthPrompt]);

  const handleResume = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "start", async () => {
        try {
          const connectAuthToken = await resolveConnectAuthToken();
          if (connectAuthToken === null) return;
          const result = await getPrimaryEnvironmentConnection().client.sandbox.resumeSession({
            instanceId: instanceId as never,
            connectAuthToken: connectAuthToken as never,
          });
          setActiveSession((prev) => ({
            ...prev,
            [instanceId]: {
              environmentId: result.environmentId,
              httpBaseUrl: result.endpoint.httpBaseUrl,
            },
          }));
          try {
            await addSavedEnvironment({
              label: result.endpoint.label,
              host: result.endpoint.httpBaseUrl,
              pairingCode: result.pairingToken,
              sandbox: {
                providerKind:
                  ((instanceMap as Record<string, SandboxProviderInstanceConfig>)[instanceId]
                    ?.driver as string) ?? "vercel",
              },
            });
          } catch (error) {
            toastManager.add({
              type: "error",
              title: "Resumed but was not re-added",
              description: error instanceof Error ? error.message : "Unknown error.",
            });
          }
          refreshManagedRelayEnvironments();
          await refreshList();
          toastManager.add({ type: "success", title: "Sandbox resumed" });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Resume failed",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
        }
      }),
    [instanceMap, refreshList, resolveConnectAuthToken, withBusy],
  );

  const handleRenew = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "start", async () => {
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

  const handleSnapshot = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "start", async () => {
        try {
          const result = await getPrimaryEnvironmentConnection().client.sandbox.createSnapshot({
            instanceId: instanceId as never,
          });
          toastManager.add({
            type: "success",
            title: "Snapshot created",
            description: `Snapshot id: ${result.snapshotId}. The session is lapsed; Resume to continue.`,
          });
          await refreshList();
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Snapshot failed",
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
      <SettingsSection
        title="Sandbox environments"
        headerAction={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DialogTrigger
                    render={
                      <Button
                        size="xs"
                        variant="ghost"
                        className="h-5 gap-1 rounded-sm px-1 text-[11px] font-normal text-muted-foreground/60 hover:text-muted-foreground"
                        aria-label="Add sandbox environment"
                      >
                        <PlusIcon className="size-3" />
                        <span>Add sandbox environment</span>
                      </Button>
                    }
                  />
                }
              />
              <TooltipPopup side="top">Add sandbox environment</TooltipPopup>
            </Tooltip>
            <AddDeploymentTargetDialogBody
              existingIds={new Set(instanceEntries.map(([id]) => id))}
              onAdd={(id, instance) => {
                updateSettings({
                  sandboxProviderInstances: { ...instanceMap, [id]: instance },
                });
                setAddOpen(false);
              }}
            />
          </Dialog>
        }
      >
        {instanceEntries.length === 0 ? (
          <div className="border-t border-border/60 px-4 py-3.5 first:border-t-0 sm:px-5">
            <p className="text-xs text-muted-foreground">
              No sandbox environments configured. Add one to provision a container.
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
            const enabled = config.enabled ?? true;
            const selectedProject = resolveSelectedProject(id);
            const selectedRepositoryKey =
              selectedRepositoryKeyByInstance[id] ??
              (selectedProject?.repositoryIdentity?.canonicalKey as string | undefined);
            return (
              <DeploymentTargetCard
                key={id}
                instanceId={id}
                instance={config}
                displayName={displayName}
                enabled={enabled}
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
                onSelectedRepositoryKeyChange={(repositoryKey) =>
                  setSelectedRepositoryKeyByInstance((prev) => ({ ...prev, [id]: repositoryKey }))
                }
                onDelete={() => handleRemove(id)}
                onTest={() => void handleTest(id)}
                onStart={() => void handleStart(id)}
                onDispose={() => void handleDispose(id)}
                onResume={() => void handleResume(id)}
                onRenew={() => void handleRenew(id)}
                onSnapshot={() => void handleSnapshot(id)}
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
  readonly enabled: boolean;
  readonly available: boolean;
  readonly reason: string | undefined;
  readonly session: { environmentId: string; httpBaseUrl: string } | undefined;
  readonly summary: SandboxInstanceSummary | undefined;
  readonly progress: string[];
  readonly instanceBusy: "test" | "start" | "dispose" | undefined;
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
  readonly onDispose: () => void;
  readonly onResume: () => void;
  readonly onRenew: () => void;
  readonly onSnapshot: () => void;
}

/**
 * A single deployment-target row, mirroring `ProviderInstanceCard.tsx`:
 * title + driver/status badges + delete + chevron + enabled switch in the row,
 * and a `Collapsible` with display name, docker config fields, env vars, and
 * the Part B controls (Test connection / Start session / Dispose) + progress.
 */
function DeploymentTargetCard({
  instanceId,
  instance,
  displayName,
  enabled,
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
  onDispose,
  onResume,
  onRenew,
  onSnapshot,
}: DeploymentTargetCardProps) {
  const isVercel = (instance.driver as string) === (VERCEL_KIND as string);
  const runningSession = summary?.kind === "available" ? summary.runningSession : undefined;
  const supportsResume = summary?.kind === "available" ? summary.supportsResume : undefined;
  const supportsSnapshot = summary?.kind === "available" ? summary.supportsSnapshot : undefined;
  const supportsRenewTimeout =
    summary?.kind === "available" ? summary.supportsRenewTimeout : undefined;
  const sessionStatus = runningSession?.status;
  const deadlineEpochMs = runningSession?.deadlineEpochMs;
  const lapsedReason = runningSession?.lapsedReason;
  const snapshotId = runningSession?.snapshotId;
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

  const updateEnabled = (value: boolean) => {
    onUpdate({ ...instance, enabled: value });
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
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => updateEnabled(Boolean(checked))}
              aria-label={`Enable ${displayName}`}
            />
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
              />
              {isVercel ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Add <code>VERCEL_TOKEN</code>, <code>VERCEL_TEAM_ID</code>, and
                  <code>VERCEL_PROJECT_ID</code> as sensitive environment variables.
                </p>
              ) : null}
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
              {sessionStatus === "lapsed" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-amber-600">
                    Lapsed
                  </Badge>
                  {lapsedReason ? (
                    <span className="text-xs text-muted-foreground">{lapsedReason}</span>
                  ) : null}
                  {supportsResume ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={instanceBusy !== undefined}
                      onClick={onResume}
                    >
                      {instanceBusy === "start" ? "Resuming…" : "Resume"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {session && sessionStatus !== "lapsed" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {deadlineEpochMs !== undefined ? (
                    <span className="text-xs text-muted-foreground">
                      Expires in {formatRemaining(deadlineEpochMs)}
                    </span>
                  ) : null}
                  {supportsRenewTimeout ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={instanceBusy !== undefined}
                      onClick={onRenew}
                    >
                      Extend
                    </Button>
                  ) : null}
                  {supportsSnapshot ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={instanceBusy !== undefined}
                      onClick={onSnapshot}
                    >
                      Snapshot
                    </Button>
                  ) : null}
                  {snapshotId ? (
                    <span className="text-xs text-muted-foreground">
                      Snapshot: <code>{snapshotId}</code>
                    </span>
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
                <Button
                  size="sm"
                  variant="outline"
                  disabled={instanceBusy !== undefined || !available}
                  onClick={onTest}
                >
                  {instanceBusy === "test" ? "Testing…" : "Test connection"}
                </Button>
                {session ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={instanceBusy !== undefined}
                    onClick={onDispose}
                  >
                    {instanceBusy === "dispose" ? "Disposing…" : "Dispose"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={instanceBusy !== undefined || !available}
                    onClick={onStart}
                  >
                    {instanceBusy === "start" ? "Starting…" : "Start session"}
                  </Button>
                )}
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

/** Inline editor for the Vercel Sandbox driver config (runtime, boot source,
 *  snapshot id, timeout, port, vCPUs). Mirrors DockerConfigFields' layout. */
function VercelConfigFields({ config, idPrefix, onChange }: VercelConfigFieldsProps) {
  const sourceType = readConfigString(config, "sourceType") || "runtime";
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
        <label htmlFor={`${idPrefix}-sourceType`} className="block">
          <span className="text-xs font-medium text-foreground">Boot source</span>
          <select
            id={`${idPrefix}-sourceType`}
            className="mt-1.5 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={sourceType}
            onChange={(e) => onChange(setConfigField(config, "sourceType", e.target.value))}
          >
            <option value="runtime">Runtime</option>
            <option value="snapshot">Snapshot</option>
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            Boot from a Vercel runtime or a prepared snapshot.
          </span>
        </label>
      </div>
      {sourceType === "snapshot" ? (
        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
          <label htmlFor={`${idPrefix}-snapshotId`} className="block">
            <span className="text-xs font-medium text-foreground">Snapshot id</span>
            <DraftInput
              id={`${idPrefix}-snapshotId`}
              className="mt-1.5"
              value={readConfigString(config, "snapshotId")}
              onCommit={(next) => onChange(setConfigField(config, "snapshotId", next))}
              placeholder="snap_xxx"
              spellCheck={false}
            />
          </label>
        </div>
      ) : null}
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
            placeholder="45"
            spellCheck={false}
            inputMode="numeric"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Sandbox auto-termination timeout. Hobby max is 45 minutes.
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

interface AddDeploymentTargetDialogBodyProps {
  existingIds: Set<string>;
  onAdd: (id: string, instance: SandboxProviderInstanceConfig) => void;
}

function AddDeploymentTargetDialogBody({ existingIds, onAdd }: AddDeploymentTargetDialogBodyProps) {
  const [driver, setDriver] = useState<"docker" | "vercel">("docker");
  // Defaults match the driver's DEFAULT_*_CONFIG. Docker: the `katacode:local`
  // image built by `pnpm run build:docker-image`, started with
  // `katacode serve --port 13773`. Vercel: the `node24` runtime with a 45m
  // timeout. Add -> Test connection provisions the real server.
  const [label, setLabel] = useState("");
  const [image, setImage] = useState("katacode:local");
  const [command, setCommand] = useState("katacode serve --port 13773");
  const [port, setPort] = useState("13773");
  const [error, setError] = useState<string | null>(null);

  const driverKind = driver === "vercel" ? VERCEL_KIND : DOCKER_KIND;
  const instanceId = useMemo(() => {
    const suffix = slugifyLabel(label) || "default";
    return `${driverKind as string}_${suffix}`;
  }, [driverKind, label]);

  const handleSubmit = useCallback(() => {
    if (existingIds.has(instanceId)) {
      setError(`Instance id '${instanceId}' already exists. Choose a different label.`);
      return;
    }
    try {
      const brandedId = SandboxProviderInstanceId.make(instanceId);
      if (driver === "vercel") {
        const instance: SandboxProviderInstanceConfig = {
          driver: VERCEL_KIND,
          enabled: true,
          ...(label.trim().length > 0 ? { displayName: label.trim() } : {}),
          config: { runtime: "node24", sourceType: "runtime", timeoutMs: 2_700_000, port: 13773 },
        };
        onAdd(brandedId as string, instance);
        setLabel("");
        setError(null);
        return;
      }
      const portNumber = parseContainerPort(port);
      if (portNumber === null) {
        setError("Container port must be an integer from 1 to 65535.");
        return;
      }
      const instance: SandboxProviderInstanceConfig = {
        driver: DOCKER_KIND,
        enabled: true,
        ...(label.trim().length > 0 ? { displayName: label.trim() } : {}),
        config: { image, command, port: portNumber },
      };
      onAdd(brandedId as string, instance);
      setLabel("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid instance id.");
    }
  }, [driver, existingIds, instanceId, label, image, command, port, onAdd]);

  return (
    <DialogPopup className="max-w-xl overflow-hidden">
      <DialogHeader>
        <DialogTitle>Add sandbox environment</DialogTitle>
        <DialogDescription>
          Provisions an isolated sandbox running a Kata server. Choose a local container or a Vercel
          Sandbox cloud microVM.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="sandbox-driver">Driver</Label>
          <select
            id="sandbox-driver"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={driver}
            onChange={(e) => setDriver(e.target.value as "docker" | "vercel")}
          >
            <option value="docker">Local container (Docker)</option>
            <option value="vercel">Vercel Sandbox</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sandbox-label">Label</Label>
          <Input
            id="sandbox-label"
            value={label}
            placeholder="e.g. Work"
            onChange={(e) => setLabel(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Instance id: {instanceId}</p>
        </div>
        {driver === "docker" ? (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="sandbox-image">Image</Label>
              <Input id="sandbox-image" value={image} onChange={(e) => setImage(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Must contain your start command's runtime. Use a <code>katacode</code> image once
                published.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="sandbox-command">Start command</Label>
              <Input
                id="sandbox-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Launches the Kata server inside the container. Defaults to
                <code>katacode serve --port 13773</code> against the
                <code>katacode:local</code> image (built by
                <code>pnpm run build:docker-image</code>).
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="sandbox-port">Container port</Label>
              <Input id="sandbox-port" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            After creating, add <code>VERCEL_TOKEN</code>, <code>VERCEL_TEAM_ID</code>, and
            <code>VERCEL_PROJECT_ID</code> as sensitive environment variables on the target.
          </p>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost">Cancel</Button>} />
        <Button onClick={handleSubmit}>Add sandbox environment</Button>
      </DialogFooter>
    </DialogPopup>
  );
}
