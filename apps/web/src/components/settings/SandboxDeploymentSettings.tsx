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
  type SandboxStartSessionResult,
  type SandboxTestConnectionProgressEvent,
} from "@kata-sh/code-contracts";
import type {
  RelayClientEnvironmentRecord,
  RelayManagedEndpointProviderKind,
} from "@kata-sh/code-contracts/relay";
import { useShallow } from "zustand/react/shallow";

import {
  connectManagedCloudEnvironment,
  listManagedCloudEnvironments,
} from "../../cloud/linkEnvironment";
import { refreshManagedRelayEnvironments } from "../../cloud/managedRelayState";
import { resolveRelayClerkTokenOptions, hasCloudPublicConfig } from "../../cloud/publicConfig";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import {
  addManagedRelayEnvironment,
  getPrimaryEnvironmentConnection,
  removeSavedEnvironment,
} from "../../environments/runtime";
import { webRuntime } from "../../lib/runtime";
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
import { SavedEnvironmentEditor } from "./SavedEnvironmentEditor";
import { SettingsSection } from "./settingsLayout";

const DOCKER_KIND = SandboxProviderDriverKind.make("docker");
const SANDBOX_MANAGED_ENDPOINT_PROVIDER_KIND =
  "cloudflare_tunnel" satisfies RelayManagedEndpointProviderKind;

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

function normalizeSandboxRelayBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
  }
  return url.toString();
}

function toSandboxRelayEnvironmentRecord(
  result: SandboxStartSessionResult,
): RelayClientEnvironmentRecord {
  const httpBaseUrl = normalizeSandboxRelayBaseUrl(result.endpoint.httpBaseUrl);
  const wsBaseUrl = normalizeSandboxRelayBaseUrl(result.endpoint.wsBaseUrl);
  return {
    environmentId: EnvironmentId.make(result.environmentId),
    label: result.endpoint.label,
    endpoint: {
      httpBaseUrl,
      wsBaseUrl,
      providerKind: SANDBOX_MANAGED_ENDPOINT_PROVIDER_KIND,
    },
    linkedAt: new Date().toISOString(),
  };
}

/** Per-instance busy state for the long-running RPCs. */
type BusyOp = "test" | "start" | "dispose";

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
          if (connectAuthToken) {
            try {
              const relayEnvironments = await webRuntime.runPromise(
                listManagedCloudEnvironments({ clerkToken: connectAuthToken }),
              );
              const relayEnvironment =
                relayEnvironments.find(
                  (environment) => environment.environmentId === result.environmentId,
                ) ?? toSandboxRelayEnvironmentRecord(result);
              const connection = await webRuntime.runPromise(
                connectManagedCloudEnvironment({
                  clerkToken: connectAuthToken,
                  environment: relayEnvironment,
                }),
              );
              await addManagedRelayEnvironment(connection);
              refreshManagedRelayEnvironments();
              savedForProjectPicker = true;
              setTestProgress((prev) => ({
                ...prev,
                [instanceId]: [...(prev[instanceId] ?? []), "connect: ok"],
              }));
            } catch (error) {
              const message = error instanceof Error ? error.message : "Unknown error.";
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
          }

          toastManager.add({
            type: "success",
            title: "Sandbox session started",
            description: savedForProjectPicker
              ? "Available from Add project."
              : `Reachable at ${result.endpoint.httpBaseUrl}.`,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error.";
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
      isSignedIn,
      openAuthPrompt,
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
    [activeSession, withBusy],
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
}: DeploymentTargetCardProps) {
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

            <DockerConfigFields
              config={instance.config}
              idPrefix={`sandbox-instance-${instanceId}`}
              onChange={updateConfig}
            />

            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              <ProviderEnvironmentSection
                environment={instance.environment ?? []}
                onChange={updateEnvironment}
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

interface AddDeploymentTargetDialogBodyProps {
  existingIds: Set<string>;
  onAdd: (id: string, instance: SandboxProviderInstanceConfig) => void;
}

function AddDeploymentTargetDialogBody({ existingIds, onAdd }: AddDeploymentTargetDialogBodyProps) {
  // Defaults match the driver's DEFAULT_DOCKER_CONFIG: the `katacode:local`
  // image built by `pnpm run build:docker-image`, started with
  // `katacode serve --port 13773`. Add -> Test connection provisions the real
  // server out of the box (requires the image to be built; the e2e asserts it).
  const [label, setLabel] = useState("");
  const [image, setImage] = useState("katacode:local");
  const [command, setCommand] = useState("katacode serve --port 13773");
  const [port, setPort] = useState("13773");
  const [error, setError] = useState<string | null>(null);

  const instanceId = useMemo(() => {
    const suffix = slugifyLabel(label) || "default";
    return `${DOCKER_KIND}_${suffix}`;
  }, [label]);

  const handleSubmit = useCallback(() => {
    if (existingIds.has(instanceId)) {
      setError(`Instance id '${instanceId}' already exists. Choose a different label.`);
      return;
    }
    const portNumber = parseContainerPort(port);
    if (portNumber === null) {
      setError("Container port must be an integer from 1 to 65535.");
      return;
    }
    try {
      const brandedId = SandboxProviderInstanceId.make(instanceId);
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
  }, [existingIds, instanceId, label, image, command, port, onAdd]);

  return (
    <DialogPopup className="max-w-xl overflow-hidden">
      <DialogHeader>
        <DialogTitle>Add container sandbox environment</DialogTitle>
        <DialogDescription>
          Provisions an isolated Docker container running a Kata server, reached over localhost.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 p-4">
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
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost">Cancel</Button>} />
        <Button onClick={handleSubmit}>Add sandbox environment</Button>
      </DialogFooter>
    </DialogPopup>
  );
}
